//! "Follow along": a read-only page that shows the words of the slide on the screen, for the congregation's phones (or a
//! church that streams its service). It works like the phone remote (`remote.rs`): a page this computer serves over the home
//! Wi-Fi while it is switched on in the presenter, at `http://<this computer>:<port>/f/<code>` with a fresh random code, only
//! for devices on the home network, off until switched on, stopped when the show ends. It has no buttons: a visitor can only
//! read. What it is given is cut down here (the title and words of the slide that is on the screen, and whether the screen is
//! black or cleared), so the preacher's notes and the next slide can never reach it, whatever the presenter pushes.

use std::io::{BufRead, BufReader, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::lan::{is_private, local_address};
use crate::remote::{info, new_code, RemoteInfo};

const PAGE: &str = include_str!("follow_page.html");
const PORT: u16 = 47812;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

struct Running {
    stop: Arc<AtomicBool>,
    url: String,
    shown: Arc<Mutex<String>>,
}

#[derive(Default)]
pub struct FollowState {
    running: Mutex<Option<Running>>,
}

/// Only what a visitor may see: the part's name, the title and words of the slide on the screen, and whether the screen is
/// black or the words are cleared. Everything else the presenter sent (the notes, the next slide) is left out.
pub(crate) fn sanitize(json: &str) -> String {
    let v: serde_json::Value = serde_json::from_str(json).unwrap_or(serde_json::Value::Null);
    let text = |x: Option<&serde_json::Value>, max: usize| x.and_then(|s| s.as_str()).unwrap_or("").chars().take(max).collect::<String>();
    if !v.is_object() {
        return r#"{"idle":true}"#.to_string();
    }
    let now = v.get("now");
    serde_json::json!({
        "part": text(v.get("part"), 120),
        "black": v.get("black").and_then(|b| b.as_bool()).unwrap_or(false),
        "clear": v.get("clear").and_then(|b| b.as_bool()).unwrap_or(false),
        "now": { "title": text(now.and_then(|n| n.get("title")), 160), "body": text(now.and_then(|n| n.get("body")), 600) },
    })
    .to_string()
}

/// Switches "follow along" on (or returns the address if it is already on).
#[tauri::command]
pub fn follow_start(app: AppHandle) -> Result<RemoteInfo, String> {
    let state = app.state::<FollowState>();
    let mut running = state.running.lock().map_err(err)?;
    if let Some(r) = running.as_ref() {
        return info(&r.url);
    }
    let ip = local_address().ok_or("This computer isn't on a home network (Wi-Fi or cable), so a phone can't reach it.")?;
    let listener = TcpListener::bind(("0.0.0.0", PORT)).or_else(|_| TcpListener::bind(("0.0.0.0", 0))).map_err(|e| format!("The app couldn't listen on the network: {e}"))?;
    let port = listener.local_addr().map_err(err)?.port();
    listener.set_nonblocking(true).map_err(err)?;
    let code = new_code()?;
    let url = format!("http://{ip}:{port}/f/{code}");
    let stop = Arc::new(AtomicBool::new(false));
    let shown = Arc::new(Mutex::new(String::new()));
    {
        let (stop, code, shown) = (stop.clone(), code.clone(), shown.clone());
        std::thread::spawn(move || {
            while !stop.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((s, peer)) if is_private(peer.ip()) => {
                        let (code, shown) = (code.clone(), shown.clone());
                        std::thread::spawn(move || {
                            let _ = s.set_nonblocking(false);
                            if let Err(e) = serve(s, &code, &shown) {
                                crate::logging::write_limited("warn", "follow along", &e);
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

/// Switches it off: the address stops answering.
#[tauri::command]
pub fn follow_stop(app: AppHandle) {
    if let Ok(mut running) = app.state::<FollowState>().running.lock() {
        if let Some(r) = running.take() {
            r.stop.store(true, Ordering::Relaxed);
        }
    }
}

/// What the slide show shows now (JSON made by the presenter); it is cut down before it is kept.
#[tauri::command]
pub fn follow_state(app: AppHandle, json: String) {
    if let Ok(running) = app.state::<FollowState>().running.lock() {
        if let Some(r) = running.as_ref() {
            if let Ok(mut s) = r.shown.lock() {
                *s = sanitize(&json);
            }
        }
    }
}

fn reply(s: &mut TcpStream, status: u16, kind: &str, body: &str) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        404 => "Not Found",
        405 => "Method Not Allowed",
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

/// Answers one request: the page and its state, to a visitor who has the code; nothing else (a visitor cannot send anything in).
fn serve(mut s: TcpStream, code: &str, shown: &Mutex<String>) -> Result<(), String> {
    s.set_read_timeout(Some(Duration::from_secs(5))).map_err(err)?;
    s.set_write_timeout(Some(Duration::from_secs(5))).map_err(err)?;
    let mut reader = BufReader::new(s.try_clone().map_err(err)?);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(err)?;
    let mut parts = line.split_whitespace();
    let (method, target) = (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("").to_string());
    let path = target.split('?').next().unwrap_or("");
    let base = format!("/f/{code}");
    if method != "GET" {
        reply(&mut s, 405, "text/plain; charset=utf-8", "Read only.")?;
    } else if path == base || path == format!("{base}/") {
        reply(&mut s, 200, "text/html; charset=utf-8", PAGE)?;
    } else if path == format!("{base}/state") {
        let json = shown.lock().map(|j| j.clone()).unwrap_or_default();
        let json = if json.is_empty() { r#"{"idle":true}"#.to_string() } else { json };
        reply(&mut s, 200, "application/json; charset=utf-8", &json)?;
    } else {
        reply(&mut s, 404, "text/plain; charset=utf-8", "Not found.")?;
    }
    let _ = s.shutdown(Shutdown::Write);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn a_visitor_sees_the_words_and_nothing_else() {
        let pushed = r#"{"part":"Sermon","index":3,"total":9,"black":false,"clear":false,"now":{"title":"John 3:16","body":"For God so loved the world","kind":"scripture"},"next":{"title":"SECRET NEXT","body":"x"},"notes":"SECRET NOTES","parts":["Sermon"],"active":0,"began":1,"count":60}"#;
        let seen = sanitize(pushed);
        assert!(seen.contains("John 3:16") && seen.contains("For God so loved the world") && seen.contains("Sermon"), "{seen}");
        for secret in ["SECRET", "notes", "next", "began", "index"] {
            assert!(!seen.contains(secret), "{secret} leaked: {seen}");
        }
        assert_eq!(sanitize(""), r#"{"idle":true}"#);
        assert_eq!(sanitize("not json"), r#"{"idle":true}"#);
        assert_eq!(sanitize("[1,2]"), r#"{"idle":true}"#);
        let blank = sanitize(r#"{"black":true,"now":{"title":"t","body":"b"}}"#);
        assert!(blank.contains(r#""black":true"#), "{blank}");
        let long = sanitize(&format!(r#"{{"now":{{"body":"{}"}}}}"#, "a".repeat(5000)));
        assert!(long.len() < 900, "the words are cut to a sensible length");
    }

    /// The real server code answers real requests on this computer: the page and the state with the right code, read only, nothing for a wrong code.
    #[test]
    fn serves_the_page_and_the_state_read_only() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let shown = Arc::new(Mutex::new(String::new()));
        let shown2 = shown.clone();
        let server = std::thread::spawn(move || {
            for _ in 0..6 {
                let (s, _) = listener.accept().unwrap();
                serve(s, "abc123", &shown2).unwrap();
            }
        });
        let ask = |request: &str| -> String {
            let mut c = TcpStream::connect(("127.0.0.1", port)).unwrap();
            c.write_all(request.as_bytes()).unwrap();
            let mut out = String::new();
            c.read_to_string(&mut out).unwrap();
            out
        };
        let page = ask("GET /f/abc123 HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(page.starts_with("HTTP/1.1 200") && page.contains("Follow along") && page.contains("no-store"), "{page}");
        assert!(!page.contains("data-k"), "the page has no buttons");
        assert!(ask("GET /f/abc123/state HTTP/1.1\r\n\r\n").ends_with(r#"{"idle":true}"#));
        *shown.lock().unwrap() = sanitize(r#"{"now":{"title":"Psalm 23","body":"The Lord is my shepherd"},"notes":"hidden"}"#);
        let now = ask("GET /f/abc123/state?x=1 HTTP/1.1\r\n\r\n");
        assert!(now.contains("The Lord is my shepherd") && !now.contains("hidden"), "{now}");
        assert!(ask("POST /f/abc123/key HTTP/1.1\r\nContent-Length: 0\r\n\r\n").starts_with("HTTP/1.1 405"), "a visitor cannot send anything in");
        assert!(ask("GET /f/zzz HTTP/1.1\r\n\r\n").starts_with("HTTP/1.1 404"), "a wrong code opens nothing");
        assert!(ask("GET /r/abc123 HTTP/1.1\r\n\r\n").starts_with("HTTP/1.1 404"), "the remote's address is not this server's");
        server.join().unwrap();
    }
}
