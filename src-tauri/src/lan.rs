//! Keeping the phone in step over the home Wi-Fi (since 2.8.3): the phone and the computer
//! sync straight to each other while both are on the same home network and the app is open
//! on the computer. No cloud, no account, nothing leaves the house.
//!
//! The computer listens on the private network only (port 47810): answers a phone looking for
//! it (UDP "BIBLE-CONCORDANCE-FIND"), pairs a phone once with a six-digit code shown on the
//! computer, and then takes the phone's sync file and answers with its own (HTTP, the phone
//! proving who it is with the token it got when paired). The merging is the shared engine's
//! (`bible_core::sync`), exactly as through a shared folder. Connections from outside the
//! private address ranges are refused.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, TcpListener, TcpStream, UdpSocket};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bible_core::sync::{self as core, set_setting, setting};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

use crate::userdata::UserDataState;

pub const PORT: u16 = 47810;
const FIND: &[u8] = b"BIBLE-CONCORDANCE-FIND";
/// a pairing code lasts this long, and allows this many wrong tries
const CODE_MINUTES: u64 = 10;
const CODE_TRIES: u32 = 5;
const MAX_BODY: usize = 64 * 1024 * 1024;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[derive(Default)]
pub struct LanState {
    /// set to stop the listening threads
    running: Mutex<Option<Arc<AtomicBool>>>,
    /// the pairing code shown, when it was made, and the wrong tries so far
    code: Mutex<Option<(String, Instant, u32)>>,
    /// why listening failed, if it did
    error: Mutex<Option<String>>,
}

/// A paired phone. Only the token's hash is kept.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Phone {
    pub id: String,
    pub name: String,
    #[serde(default)]
    token: String,
    /// when it last synced (ms)
    #[serde(default)]
    pub last: i64,
}

fn phones(conn: &Connection) -> Vec<Phone> {
    setting(conn, "lan_phones").ok().flatten().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn save_phones(conn: &Connection, list: &[Phone]) -> Result<(), String> {
    set_setting(conn, "lan_phones", Some(&serde_json::to_string(list).map_err(err)?))
}

fn token_hash(token: &str) -> String {
    Sha256::digest(token.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// Home networks only: 10.x, 172.16-31.x, 192.168.x, link-local, this computer, and their
/// IPv6 equivalents.
pub fn is_private(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(a) => a.is_private() || a.is_loopback() || a.is_link_local(),
        IpAddr::V6(a) => {
            if let Some(v4) = a.to_ipv4_mapped() {
                return is_private(IpAddr::V4(v4));
            }
            let s = a.segments()[0];
            a.is_loopback() || (s & 0xffc0) == 0xfe80 || (s & 0xfe00) == 0xfc00
        }
    }
}

/// This computer's address on the home network (the one its default route uses; nothing is
/// sent to find it).
pub fn local_address() -> Option<String> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    let ip = s.local_addr().ok()?.ip();
    is_private(ip).then(|| ip.to_string())
}

fn conn_of(app: &AppHandle) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    app.state::<UserDataState>().inner().0.lock().map_err(err)
}

fn my_name(conn: &Connection) -> String {
    setting(conn, "name").ok().flatten().unwrap_or_else(crate::study_commands::computer_name)
}

/// Starts listening (unless it already is).
pub fn start(app: &AppHandle) -> Result<(), String> {
    let lan = app.state::<LanState>().inner();
    let mut running = lan.running.lock().map_err(err)?;
    if running.is_some() {
        return Ok(());
    }
    let listener = TcpListener::bind(("0.0.0.0", PORT)).map_err(|e| format!("The app couldn't listen on the home network (port {PORT}): {e}"))?;
    listener.set_nonblocking(true).map_err(err)?;
    let stop = Arc::new(AtomicBool::new(false));
    {
        let (stop, app) = (stop.clone(), app.clone());
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((s, peer)) if is_private(peer.ip()) => {
                        let _ = s.set_nonblocking(false);
                        let _ = s.set_read_timeout(Some(Duration::from_secs(30)));
                        let _ = s.set_write_timeout(Some(Duration::from_secs(30)));
                        if let Err(e) = handle(&app, s) {
                            crate::logging::write_limited("warn", "home Wi-Fi sync", &e);
                        }
                    }
                    Ok(_) => {} // not from the home network: closed at once
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(150)),
                    Err(_) => std::thread::sleep(Duration::from_millis(500)),
                }
            }
        });
    }
    // answering a phone that looks for the computer; without it the phone can still be given the address
    if let Ok(udp) = UdpSocket::bind(("0.0.0.0", PORT)) {
        let _ = udp.set_read_timeout(Some(Duration::from_millis(500)));
        let (stop, app) = (stop.clone(), app.clone());
        std::thread::spawn(move || {
            let mut buf = [0u8; 64];
            while !stop.load(Ordering::Relaxed) {
                if let Ok((n, from)) = udp.recv_from(&mut buf) {
                    if &buf[..n] == FIND && is_private(from.ip()) {
                        if let Ok(conn) = conn_of(&app) {
                            let reply = format!("BIBLE-CONCORDANCE {} {PORT} {}", core::device_id(&conn).unwrap_or_default(), my_name(&conn));
                            let _ = udp.send_to(reply.as_bytes(), from);
                        }
                    }
                }
            }
        });
    }
    *running = Some(stop);
    *lan.error.lock().map_err(err)? = None;
    Ok(())
}

pub fn stop(app: &AppHandle) {
    let lan = app.state::<LanState>().inner();
    if let Ok(mut running) = lan.running.lock() {
        if let Some(stop) = running.take() {
            stop.store(true, Ordering::Relaxed);
        }
    }
}

/// At start-up: listening again if the reader turned it on.
pub fn start_if_on(app: &AppHandle) {
    let on = conn_of(app).ok().and_then(|c| setting(&c, "lan").ok().flatten()).as_deref() == Some("1");
    if on {
        if let Err(e) = start(app) {
            crate::logging::write("warn", "home Wi-Fi sync", &e);
            if let Ok(mut slot) = app.state::<LanState>().error.lock() {
                *slot = Some(e);
            }
        }
    }
}

// ---------------------------------------------------------------- the requests

fn handle(app: &AppHandle, mut s: TcpStream) -> Result<(), String> {
    let mut reader = BufReader::new(s.try_clone().map_err(err)?);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(err)?;
    let mut parts = line.split_whitespace();
    let (method, path) = (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("").to_string());
    let (mut length, mut auth) = (0usize, String::new());
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).map_err(err)? == 0 || h.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            match k.trim().to_ascii_lowercase().as_str() {
                "content-length" => length = v.trim().parse().unwrap_or(0),
                "authorization" => auth = v.trim().trim_start_matches("Bearer").trim().to_string(),
                _ => {}
            }
        }
    }
    let (status, body) = if length > MAX_BODY {
        (413, json!({ "error": "Too large." }).to_string())
    } else {
        let mut body = vec![0u8; length];
        reader.read_exact(&mut body).map_err(err)?;
        route(app, &method, &path, &auth, &String::from_utf8_lossy(&body))
    };
    let reason = match status {
        200 => "OK",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        _ => "Error",
    };
    write!(s, "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).map_err(err)?;
    s.write_all(body.as_bytes()).map_err(err)?;
    s.flush().map_err(err)?;
    // close politely: say the answer is complete, then let the phone finish reading before the
    // connection goes (closing at once can cut the answer off on some networks)
    let _ = s.shutdown(std::net::Shutdown::Write);
    let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
    let _ = std::io::copy(&mut reader, &mut std::io::sink());
    Ok(())
}

#[derive(Deserialize)]
struct PairAsk {
    code: String,
    id: String,
    name: String,
}

fn route(app: &AppHandle, method: &str, path: &str, auth: &str, body: &str) -> (u16, String) {
    let fail = |status: u16, msg: &str| (status, json!({ "error": msg }).to_string());
    match (method, path) {
        ("GET", "/hello") => match conn_of(app) {
            Ok(conn) => (200, json!({ "app": "Bible Concordance", "id": core::device_id(&conn).unwrap_or_default(), "name": my_name(&conn) }).to_string()),
            Err(e) => fail(500, &e),
        },
        ("POST", "/pair") => {
            let Ok(ask) = serde_json::from_str::<PairAsk>(body) else { return fail(400, "That isn't a pairing request.") };
            let lan = app.state::<LanState>().inner();
            let Ok(mut code) = lan.code.lock() else { return fail(500, "busy") };
            let ok = match code.as_mut() {
                Some((c, made, tries)) if made.elapsed() < Duration::from_secs(CODE_MINUTES * 60) && *tries < CODE_TRIES => {
                    if *c == ask.code.trim() {
                        true
                    } else {
                        *tries += 1;
                        false
                    }
                }
                _ => return fail(403, "There is no pairing code on the computer now. On the computer, press “Pair a phone” and type the code it shows."),
            };
            if !ok {
                return fail(403, "That code isn't right. Check the code on the computer.");
            }
            *code = None;
            drop(code);
            let Ok(conn) = conn_of(app) else { return fail(500, "busy") };
            let token: String = match conn.query_row("SELECT lower(hex(randomblob(24)))", [], |r| r.get(0)) {
                Ok(t) => t,
                Err(e) => return fail(500, &e.to_string()),
            };
            let mut list = phones(&conn);
            list.retain(|p| p.id != ask.id);
            list.push(Phone { id: ask.id.chars().take(40).collect(), name: ask.name.chars().take(40).collect(), token: token_hash(&token), last: 0 });
            if let Err(e) = save_phones(&conn, &list) {
                return fail(500, &e);
            }
            let reply = json!({ "token": token, "id": core::device_id(&conn).unwrap_or_default(), "name": my_name(&conn) }).to_string();
            drop(conn);
            let _ = app.emit("lan-paired", ());
            (200, reply)
        }
        ("POST", "/sync") => match exchange(app, auth, body) {
            Ok(text) => (200, text),
            Err((status, msg)) => fail(status, &msg),
        },
        _ => fail(404, "Not here."),
    }
}

/// Where each paired phone's latest sync file is kept, so a sync of the computer through its
/// shared folder (another computer) also carries what came from the phone.
fn phones_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("sync-phones"))
}

/// The phone's sync file in, the computer's out: one sync of the computer with what the phone
/// sent (and the shared folder's files, if one is chosen).
fn exchange(app: &AppHandle, auth: &str, body: &str) -> Result<String, (u16, String)> {
    let mut conn = conn_of(app).map_err(|e| (500, e))?;
    let mut list = phones(&conn);
    let hash = token_hash(auth);
    let Some(i) = list.iter().position(|p| !auth.is_empty() && p.token == hash) else {
        return Err((401, "This phone isn't paired with this computer any more. Pair it again.".into()));
    };
    let Some((device, _)) = core::file_device(body) else { return Err((400, "That isn't a sync file.".into())) };
    if device != list[i].id {
        return Err((403, "That sync file is from another device.".into()));
    }
    let mut others: Vec<(String, String)> = Vec::new();
    let shared = setting(&conn, "folder").ok().flatten().filter(|f| std::path::Path::new(f).is_dir()).and_then(|f| core::DirFolder::new(std::path::Path::new(&f)).ok());
    if let Some(f) = &shared {
        others.extend(core::Folder::read_all(f).unwrap_or_default());
    }
    if let Some(dir) = phones_dir(app) {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join(format!("{device}.json")), body);
        // the other paired phones' latest files (this one's is the one just sent)
        for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".json") && name != format!("{device}.json") {
                if let Ok(t) = std::fs::read_to_string(e.path()) {
                    others.push((name, t));
                }
            }
        }
    }
    others.push((format!("{device}.json"), body.to_string()));
    let mem = core::MemFolder { others, ..Default::default() };
    let name = my_name(&conn);
    let report = core::sync(&mut conn, &crate::sync::Desktop, &mem, &name, "computer").map_err(|e| (500, e))?;
    let mine = mem.written.borrow_mut().take().unwrap_or_default();
    if let Some(f) = &shared {
        let me = core::device_id(&conn).unwrap_or_default();
        let _ = core::Folder::write(f, &format!("{me}.json"), &mine);
    }
    list[i].last = core::now_ms();
    let _ = save_phones(&conn, &list);
    let _ = set_setting(&conn, "last", serde_json::to_string(&report).ok().as_deref());
    drop(conn);
    if report.received > 0 {
        let _ = app.emit("sync-received", report.received);
    }
    Ok(mine)
}

// ---------------------------------------------------------------- the commands

#[derive(Serialize)]
pub struct PhoneSeen {
    id: String,
    name: String,
    last: i64,
}

#[derive(Serialize)]
pub struct LanStatus {
    /// turned on by the reader
    enabled: bool,
    /// listening now
    running: bool,
    /// this computer's address on the home network, for typing into the phone
    address: Option<String>,
    port: u16,
    phones: Vec<PhoneSeen>,
    /// the pairing code to type into the phone, while it lasts
    code: Option<String>,
    error: Option<String>,
}

fn status(app: &AppHandle) -> Result<LanStatus, String> {
    let lan = app.state::<LanState>().inner();
    let conn = conn_of(app)?;
    let code = lan
        .code
        .lock()
        .map_err(err)?
        .as_ref()
        .filter(|(_, made, tries)| made.elapsed() < Duration::from_secs(CODE_MINUTES * 60) && *tries < CODE_TRIES)
        .map(|(c, _, _)| c.clone());
    Ok(LanStatus {
        enabled: setting(&conn, "lan")?.as_deref() == Some("1"),
        running: lan.running.lock().map_err(err)?.is_some(),
        address: local_address(),
        port: PORT,
        phones: phones(&conn).into_iter().map(|p| PhoneSeen { id: p.id, name: p.name, last: p.last }).collect(),
        code,
        error: lan.error.lock().map_err(err)?.clone(),
    })
}

#[tauri::command]
pub fn lan_status(app: AppHandle) -> Result<LanStatus, String> {
    status(&app)
}

/// Lets phones on the home Wi-Fi sync with this computer (or stops it).
#[tauri::command]
pub fn lan_enable(app: AppHandle, on: bool) -> Result<LanStatus, String> {
    set_setting(&*conn_of(&app)?, "lan", if on { Some("1") } else { None })?;
    if on {
        if let Err(e) = start(&app) {
            *app.state::<LanState>().error.lock().map_err(err)? = Some(e.clone());
            return Err(e);
        }
    } else {
        stop(&app);
    }
    status(&app)
}

/// A new six-digit code for pairing a phone (for ten minutes).
#[tauri::command]
pub fn lan_pair_code(app: AppHandle) -> Result<LanStatus, String> {
    let n: i64 = conn_of(&app)?.query_row("SELECT abs(random()) % 1000000", [], |r| r.get(0)).map_err(err)?;
    *app.state::<LanState>().code.lock().map_err(err)? = Some((format!("{n:06}"), Instant::now(), 0));
    status(&app)
}

/// Unpairs a phone: it can no longer sync with this computer until paired again.
#[tauri::command]
pub fn lan_forget(app: AppHandle, id: String) -> Result<LanStatus, String> {
    {
        let conn = conn_of(&app)?;
        let mut list = phones(&conn);
        list.retain(|p| p.id != id);
        save_phones(&conn, &list)?;
    }
    if let Some(dir) = phones_dir(&app) {
        let _ = std::fs::remove_file(dir.join(format!("{id}.json")));
    }
    status(&app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_home_networks() {
        for ok in ["192.168.8.20", "10.0.0.5", "172.20.1.1", "127.0.0.1", "169.254.3.4", "fe80::1", "::1", "fd12::1", "::ffff:192.168.1.2"] {
            assert!(is_private(ok.parse().unwrap()), "{ok}");
        }
        for no in ["8.8.8.8", "41.0.0.1", "172.32.0.1", "2001:4860::8888", "::ffff:8.8.8.8"] {
            assert!(!is_private(no.parse().unwrap()), "{no}");
        }
    }
}
