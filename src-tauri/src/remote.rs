//! The phone remote: a phone on the same Wi-Fi works the slide show (next, back, black, hide the words) from a small
//! web page that this computer serves while the reader has the remote switched on in the presenter. No app to
//! install on the phone, nothing goes through the internet.
//!
//! The page lives at `http://<this computer>:<port>/r/<code>`; the code is made fresh each time the remote is
//! switched on and is the only way in. Only devices on the home network are answered (the same rule as the Wi-Fi
//! sync, `lan::is_private`), and the server stops when the remote is switched off or the show ends. The presenter
//! (SlideShow.tsx) pushes what is on the screen (`remote_state`) and receives the phone's buttons as the same keys
//! a keyboard sends (event "remote:key").

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::lan::{is_private, local_address};

const PAGE: &str = include_str!("remote_page.html");
const PORT: u16 = 47811;
const MAX_BODY: usize = 512;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

struct Running {
    stop: Arc<AtomicBool>,
    url: String,
    /// what the phone is shown (the presenter's latest state, as JSON)
    shown: Arc<Mutex<String>>,
}

#[derive(Default)]
pub struct RemoteState {
    running: Mutex<Option<Running>>,
}

#[derive(Serialize)]
pub struct RemoteInfo {
    pub on: bool,
    /// the address the phone opens (and the QR code holds)
    pub url: String,
    /// the QR code as an SVG picture
    pub qr_svg: String,
}

fn info(url: &str) -> Result<RemoteInfo, String> {
    use qrcode::render::svg;
    let qr = qrcode::QrCode::new(url.as_bytes()).map_err(err)?;
    let qr_svg = qr
        .render::<svg::Color>()
        .min_dimensions(220, 220)
        .quiet_zone(true)
        .dark_color(svg::Color("#000000"))
        .light_color(svg::Color("#ffffff"))
        .build();
    Ok(RemoteInfo { on: true, url: url.to_string(), qr_svg })
}

/// A code nobody can guess: 12 hex digits from SQLite's own random source.
fn new_code() -> Result<String, String> {
    let c = rusqlite::Connection::open_in_memory().map_err(err)?;
    c.query_row("SELECT lower(hex(randomblob(6)))", [], |r| r.get(0)).map_err(err)
}

/// Switches the remote on (or returns the address if it is already on).
#[tauri::command]
pub fn remote_start(app: AppHandle) -> Result<RemoteInfo, String> {
    let state = app.state::<RemoteState>();
    let mut running = state.running.lock().map_err(err)?;
    if let Some(r) = running.as_ref() {
        return info(&r.url);
    }
    let ip = local_address().ok_or("This computer isn't on a home network (Wi-Fi or cable), so a phone can't reach it.")?;
    let listener = TcpListener::bind(("0.0.0.0", PORT)).or_else(|_| TcpListener::bind(("0.0.0.0", 0))).map_err(|e| format!("The app couldn't listen on the network: {e}"))?;
    let port = listener.local_addr().map_err(err)?.port();
    listener.set_nonblocking(true).map_err(err)?;
    let code = new_code()?;
    let url = format!("http://{ip}:{port}/r/{code}");
    let stop = Arc::new(AtomicBool::new(false));
    let shown = Arc::new(Mutex::new(String::new()));
    {
        let (stop, app, code, shown) = (stop.clone(), app.clone(), code.clone(), shown.clone());
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((s, peer)) if is_private(peer.ip()) => {
                        let (app, code, shown) = (app.clone(), code.clone(), shown.clone());
                        // one thread to a request: a phone that stalls cannot hold up the others
                        std::thread::spawn(move || {
                            let _ = s.set_nonblocking(false);
                            if let Err(e) = serve(&|k| drop(app.emit("remote:key", k)), s, &code, &shown) {
                                crate::logging::write_limited("warn", "phone remote", &e);
                            }
                        });
                    }
                    Ok(_) => {} // not from the home network: closed at once
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(60)),
                    Err(_) => std::thread::sleep(Duration::from_millis(300)),
                }
            }
        });
    }
    let out = info(&url)?;
    *running = Some(Running { stop, url, shown });
    Ok(out)
}

/// Switches the remote off: the address stops answering.
#[tauri::command]
pub fn remote_stop(app: AppHandle) {
    if let Ok(mut running) = app.state::<RemoteState>().running.lock() {
        if let Some(r) = running.take() {
            r.stop.store(true, Ordering::Relaxed);
        }
    }
}

/// What the slide show shows now, for the phone's page (JSON made by the presenter).
#[tauri::command]
pub fn remote_state(app: AppHandle, json: String) {
    if let Ok(running) = app.state::<RemoteState>().running.lock() {
        if let Some(r) = running.as_ref() {
            if let Ok(mut s) = r.shown.lock() {
                *s = json;
            }
        }
    }
}

// ---------------------------------------------------------------- the requests

#[derive(Deserialize)]
struct KeyAsk {
    k: String,
}

/// The phone's button as the key the presenter understands (nothing else gets through).
fn key_of(k: &str) -> Option<&'static str> {
    Some(match k {
        "next" => "ArrowRight",
        "back" => "ArrowLeft",
        "black" => "b",
        "clear" => "Escape",
        "first" => "Home",
        "last" => "End",
        "1" => "1",
        "2" => "2",
        "3" => "3",
        "4" => "4",
        "5" => "5",
        "6" => "6",
        "7" => "7",
        "8" => "8",
        "9" => "9",
        _ => return None,
    })
}

fn reply(s: &mut TcpStream, status: u16, kind: &str, body: &str) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        413 => "Payload Too Large",
        _ => "Bad Request",
    };
    write!(
        s,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {kind}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .map_err(err)?;
    s.write_all(body.as_bytes()).map_err(err)?;
    s.flush().map_err(err)
}

/// Answers one request. `on_key` is told which key a phone button stands for (the app sends it on to the presenter).
fn serve(on_key: &dyn Fn(&'static str), mut s: TcpStream, code: &str, shown: &Mutex<String>) -> Result<(), String> {
    s.set_read_timeout(Some(Duration::from_secs(5))).map_err(err)?;
    s.set_write_timeout(Some(Duration::from_secs(5))).map_err(err)?;
    let mut reader = BufReader::new(s.try_clone().map_err(err)?);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(err)?;
    let mut parts = line.split_whitespace();
    let (method, target) = (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("").to_string());
    let path = target.split('?').next().unwrap_or("");
    let mut length = 0usize;
    for _ in 0..64 {
        let mut h = String::new();
        if reader.read_line(&mut h).map_err(err)? == 0 || h.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                length = v.trim().parse().unwrap_or(0);
            }
        }
    }
    let base = format!("/r/{code}");
    if length > MAX_BODY {
        reply(&mut s, 413, "text/plain; charset=utf-8", "Too large.")?;
    } else if method == "GET" && (path == base || path == format!("{base}/")) {
        reply(&mut s, 200, "text/html; charset=utf-8", PAGE)?;
    } else if method == "GET" && path == format!("{base}/state") {
        let json = shown.lock().map(|j| j.clone()).unwrap_or_default();
        let json = if json.is_empty() { r#"{"idle":true}"#.to_string() } else { json };
        reply(&mut s, 200, "application/json; charset=utf-8", &json)?;
    } else if method == "POST" && path == format!("{base}/key") {
        let mut body = vec![0u8; length];
        reader.read_exact(&mut body).map_err(err)?;
        match serde_json::from_slice::<KeyAsk>(&body).ok().and_then(|a| key_of(&a.k)) {
            Some(key) => {
                on_key(key);
                reply(&mut s, 200, "application/json; charset=utf-8", "{}")?;
            }
            None => reply(&mut s, 400, "text/plain; charset=utf-8", "Not a button.")?,
        }
    } else {
        reply(&mut s, 404, "text/plain; charset=utf-8", "Not found.")?;
    }
    let _ = s.shutdown(Shutdown::Write);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_remote_buttons_become_keys() {
        assert_eq!(key_of("next"), Some("ArrowRight"));
        assert_eq!(key_of("back"), Some("ArrowLeft"));
        assert_eq!(key_of("black"), Some("b"));
        assert_eq!(key_of("clear"), Some("Escape"));
        assert_eq!(key_of("3"), Some("3"));
        for bad in ["", "0", "10", "Enter", "ArrowRight", "q", "Delete", " "] {
            assert_eq!(key_of(bad), None, "{bad:?}");
        }
    }

    #[test]
    fn the_code_is_random_and_the_qr_picture_is_made() {
        let (a, b) = (new_code().unwrap(), new_code().unwrap());
        assert_eq!(a.len(), 12);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
        let i = info("http://192.168.1.20:47811/r/abcdef123456").unwrap();
        assert!(i.on && i.qr_svg.contains("<svg") && i.qr_svg.contains("</svg>"));
    }

    /// The real server code answers real requests on this computer: the page, the state, a button, and nothing for a wrong code.
    #[test]
    fn serves_the_page_the_state_and_the_buttons() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let shown = Arc::new(Mutex::new(String::new()));
        let keys = Arc::new(Mutex::new(Vec::<&'static str>::new()));
        let (shown2, keys2) = (shown.clone(), keys.clone());
        let server = std::thread::spawn(move || {
            for _ in 0..7 {
                let (s, _) = listener.accept().unwrap();
                serve(&|k| keys2.lock().unwrap().push(k), s, "abc123", &shown2).unwrap();
            }
        });
        let ask = |request: &str| -> String {
            let mut c = TcpStream::connect(("127.0.0.1", port)).unwrap();
            c.write_all(request.as_bytes()).unwrap();
            let mut out = String::new();
            c.read_to_string(&mut out).unwrap();
            out
        };
        let post = |path: &str, body: &str| ask(&format!("POST {path} HTTP/1.1
Host: x
Content-Length: {}

{body}", body.len()));

        let page = ask("GET /r/abc123 HTTP/1.1
Host: x

");
        assert!(page.starts_with("HTTP/1.1 200") && page.contains("Slide remote") && page.contains("no-store"), "{page}");
        let idle = ask("GET /r/abc123/state HTTP/1.1

");
        assert!(idle.ends_with(r#"{"idle":true}"#), "{idle}");
        *shown.lock().unwrap() = r#"{"index":2,"total":9}"#.to_string();
        let now = ask("GET /r/abc123/state?x=1 HTTP/1.1

");
        assert!(now.ends_with(r#"{"index":2,"total":9}"#), "{now}");
        assert!(post("/r/abc123/key", r#"{"k":"next"}"#).starts_with("HTTP/1.1 200"));
        assert!(post("/r/abc123/key", r#"{"k":"Delete"}"#).starts_with("HTTP/1.1 400"));
        assert!(post("/r/zzz/key", r#"{"k":"back"}"#).starts_with("HTTP/1.1 404"), "a wrong code opens nothing");
        assert!(ask("GET /r/zzz HTTP/1.1

").starts_with("HTTP/1.1 404"));
        server.join().unwrap();
        assert_eq!(*keys.lock().unwrap(), vec!["ArrowRight"], "only the one real button reached the show");
    }
}
