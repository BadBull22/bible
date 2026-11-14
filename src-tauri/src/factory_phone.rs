//! Content Factory: show the finished pictures and videos on a phone. While the reader has "On my phone" switched on, this computer serves a small
//! web page on the home Wi-Fi: the phone opens it from a QR code, sees the saved pictures and videos, and saves them to the phone (to post from there).
//! No app to install on the phone, nothing goes through the internet, and nothing can be changed from the phone: it only reads.
//!
//! The same rules as the slide remote (remote.rs): the address holds a code made fresh each time it is switched on and is the only way in, only devices
//! on the home network are answered (`lan::is_private`), and it stops when switched off, when the app closes, or after an hour. Only the Pictures and
//! Videos folders of the Content Factory are ever read (not the reader's own photos in "My pictures", not music, not anything else on the computer).

use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::lan::{is_private, local_address};
use crate::remote::{info, new_code, RemoteInfo};

const PAGE: &str = include_str!("factory_phone_page.html");
const PORT: u16 = 47812;
/// the page lists this many, newest first
const MAX_LIST: usize = 150;
/// it switches itself off after this long
const HOUR: Duration = Duration::from_secs(60 * 60);

struct Running {
    stop: Arc<AtomicBool>,
    url: String,
}

#[derive(Default)]
pub struct PhoneShareState {
    running: Mutex<Option<Running>>,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Switches the phone page on (or returns the address if it is already on).
#[tauri::command]
pub fn factory_phone_start(app: AppHandle) -> Result<RemoteInfo, String> {
    let state = app.state::<PhoneShareState>();
    let mut running = state.running.lock().map_err(err)?;
    if let Some(r) = running.as_ref() {
        if !r.stop.load(Ordering::Relaxed) {
            return info(&r.url);
        }
    }
    let root = crate::factory::root(&app)?;
    let ip = local_address().ok_or("This computer isn't on a home network (Wi-Fi or cable), so a phone can't reach it.")?;
    let listener = TcpListener::bind(("0.0.0.0", PORT)).or_else(|_| TcpListener::bind(("0.0.0.0", 0))).map_err(|e| format!("The app couldn't listen on the network: {e}"))?;
    let port = listener.local_addr().map_err(err)?.port();
    listener.set_nonblocking(true).map_err(err)?;
    let code = new_code()?;
    let url = format!("http://{ip}:{port}/p/{code}");
    let stop = Arc::new(AtomicBool::new(false));
    {
        let (stop, code) = (stop.clone(), code.clone());
        std::thread::spawn(move || {
            let until = Instant::now() + HOUR;
            while !stop.load(Ordering::Relaxed) {
                if Instant::now() > until {
                    stop.store(true, Ordering::Relaxed);
                    break;
                }
                match listener.accept() {
                    Ok((s, peer)) if is_private(peer.ip()) => {
                        let (root, code) = (root.clone(), code.clone());
                        // one thread to a request: a phone that stalls (or a video being fetched) cannot hold up the others
                        std::thread::spawn(move || {
                            let _ = s.set_nonblocking(false);
                            if let Err(e) = serve(s, &code, &root) {
                                crate::logging::write_limited("warn", "phone pictures", &e);
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
    *running = Some(Running { stop, url });
    Ok(out)
}

/// The address, when the phone page is on now (nothing when it is off or has switched itself off).
#[tauri::command]
pub fn factory_phone_info(app: AppHandle) -> Result<Option<RemoteInfo>, String> {
    let state = app.state::<PhoneShareState>();
    let running = state.running.lock().map_err(err)?;
    match running.as_ref() {
        Some(r) if !r.stop.load(Ordering::Relaxed) => Ok(Some(info(&r.url)?)),
        _ => Ok(None),
    }
}

/// Switches it off: the address stops answering.
#[tauri::command]
pub fn factory_phone_stop(app: AppHandle) {
    let state = app.state::<PhoneShareState>();
    let taken = state.running.lock().ok().and_then(|mut running| running.take());
    if let Some(r) = taken {
        r.stop.store(true, Ordering::Relaxed);
    }
}

// ---------------------------------------------------------------- the files

#[derive(Serialize)]
struct Item {
    name: String,
    /// "Pictures" or "Videos"
    kind: &'static str,
    size: u64,
    modified: u64,
}

const PICTURE_ENDINGS: [&str; 3] = ["png", "jpg", "jpeg"];
const VIDEO_ENDINGS: [&str; 2] = ["mp4", "webm"];

fn ending(name: &str) -> String {
    name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default()
}

/// What the saved pictures and videos are, newest first.
fn list(root: &Path) -> Vec<Item> {
    let mut out = Vec::new();
    for (folder, endings) in [("Pictures", &PICTURE_ENDINGS[..]), ("Videos", &VIDEO_ENDINGS[..])] {
        let Ok(entries) = std::fs::read_dir(root.join(folder)) else { continue };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let Ok(meta) = e.metadata() else { continue };
            if !meta.is_file() || name.starts_with('.') || !endings.contains(&ending(&name).as_str()) {
                continue;
            }
            let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
            out.push(Item { name, kind: folder, size: meta.len(), modified });
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.name.cmp(&b.name)));
    out.truncate(MAX_LIST);
    out
}

/// The file a request names, only when it is a picture in Pictures or a video in Videos (a name with a slash, a drive or a dot at the front is nothing).
fn file_for(root: &Path, kind: &str, name: &str) -> Option<PathBuf> {
    let endings: &[&str] = match kind {
        "Pictures" => &PICTURE_ENDINGS,
        "Videos" => &VIDEO_ENDINGS,
        _ => return None,
    };
    if name.is_empty() || name.len() > 200 || name.starts_with('.') || name.contains(['/', '\\', ':', '\0']) || !endings.contains(&ending(name).as_str()) {
        return None;
    }
    let p = root.join(kind).join(name);
    p.is_file().then_some(p)
}

fn kind_of(name: &str) -> &'static str {
    match ending(name).as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

// ---------------------------------------------------------------- the requests

fn head(s: &mut TcpStream, status: u16, reason: &str, kind: &str, length: u64, extra: &str) -> Result<(), String> {
    write!(
        s,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {kind}\r\nContent-Length: {length}\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n{extra}\r\n"
    )
    .map_err(err)
}

fn reply(s: &mut TcpStream, status: u16, kind: &str, body: &str) -> Result<(), String> {
    let reason = if status == 200 { "OK" } else if status == 404 { "Not Found" } else { "Bad Request" };
    head(s, status, reason, kind, body.len() as u64, "Cache-Control: no-store\r\n")?;
    s.write_all(body.as_bytes()).map_err(err)?;
    s.flush().map_err(err)
}

/// "bytes=0-99", "bytes=100-" or "bytes=-50" against a file of `len` bytes: the first and last byte wanted.
fn byte_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    if len == 0 || spec.contains(',') {
        return None;
    }
    let (a, b) = spec.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", n) => {
            let n: u64 = n.parse().ok()?;
            (len.saturating_sub(n.min(len)), len - 1)
        }
        (a, "") => (a.parse().ok()?, len - 1),
        (a, b) => (a.parse().ok()?, b.parse::<u64>().ok()?.min(len - 1)),
    };
    (start <= end && start < len).then_some((start, end))
}

fn send_file(s: &mut TcpStream, path: &Path, range: Option<&str>, download: bool) -> Result<(), String> {
    let mut f = std::fs::File::open(path).map_err(err)?;
    let len = f.metadata().map_err(err)?.len();
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let kind = kind_of(&name);
    // a name with spaces or accents, as the browser needs it for "Save"
    let safe: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || " ._-()".contains(c) { c } else { '-' }).collect();
    let mut extra = String::from("Cache-Control: private, max-age=600\r\nAccept-Ranges: bytes\r\n");
    if download {
        extra.push_str(&format!("Content-Disposition: attachment; filename=\"{safe}\"\r\n"));
    }
    let (from, to) = match range.and_then(|r| byte_range(r, len)) {
        Some((a, b)) => {
            extra.push_str(&format!("Content-Range: bytes {a}-{b}/{len}\r\n"));
            head(s, 206, "Partial Content", kind, b - a + 1, &extra)?;
            (a, b)
        }
        None => {
            head(s, 200, "OK", kind, len, &extra)?;
            (0, len.saturating_sub(1))
        }
    };
    if len == 0 {
        return s.flush().map_err(err);
    }
    f.seek(SeekFrom::Start(from)).map_err(err)?;
    let mut left = to - from + 1;
    let mut buf = vec![0u8; 64 * 1024];
    while left > 0 {
        let want = buf.len().min(left as usize);
        let n = f.read(&mut buf[..want]).map_err(err)?;
        if n == 0 {
            break;
        }
        s.write_all(&buf[..n]).map_err(err)?;
        left -= n as u64;
    }
    s.flush().map_err(err)
}

/// Answers one request.
fn serve(mut s: TcpStream, code: &str, root: &Path) -> Result<(), String> {
    s.set_read_timeout(Some(Duration::from_secs(5))).map_err(err)?;
    s.set_write_timeout(Some(Duration::from_secs(30))).map_err(err)?;
    let mut reader = BufReader::new(s.try_clone().map_err(err)?);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(err)?;
    let mut parts = line.split_whitespace();
    let (method, target) = (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("").to_string());
    let (path, query) = target.split_once('?').unwrap_or((target.as_str(), ""));
    let mut range: Option<String> = None;
    for _ in 0..64 {
        let mut h = String::new();
        if reader.read_line(&mut h).map_err(err)? == 0 || h.trim().is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            if k.trim().eq_ignore_ascii_case("range") {
                range = Some(v.trim().to_string());
            }
        }
    }
    let base = format!("/p/{code}");
    if method != "GET" {
        reply(&mut s, 400, "text/plain; charset=utf-8", "Not allowed.")?;
    } else if path == base || path == format!("{base}/") {
        reply(&mut s, 200, "text/html; charset=utf-8", PAGE)?;
    } else if path == format!("{base}/list") {
        let json = serde_json::to_string(&list(root)).map_err(err)?;
        reply(&mut s, 200, "application/json; charset=utf-8", &json)?;
    } else if let Some(rest) = path.strip_prefix(&format!("{base}/f/")) {
        let found = rest.split_once('/').and_then(|(kind, name)| file_for(root, kind, &crate::sermon_media::percent_decode(name)));
        match found {
            Some(p) => send_file(&mut s, &p, range.as_deref(), query.split('&').any(|q| q == "dl=1"))?,
            None => reply(&mut s, 404, "text/plain; charset=utf-8", "Not found.")?,
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
    fn byte_ranges_are_read_the_way_a_browser_asks() {
        assert_eq!(byte_range("bytes=0-99", 1000), Some((0, 99)));
        assert_eq!(byte_range("bytes=900-", 1000), Some((900, 999)));
        assert_eq!(byte_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(byte_range("bytes=0-5000", 1000), Some((0, 999)), "past the end is the end");
        assert_eq!(byte_range("bytes=1000-", 1000), None);
        assert_eq!(byte_range("bytes=5-2", 1000), None);
        assert_eq!(byte_range("bytes=0-1,5-9", 1000), None);
        assert_eq!(byte_range("items=0-1", 1000), None);
        assert_eq!(byte_range("bytes=0-1", 0), None);
    }

    #[test]
    fn only_made_pictures_and_videos_are_ever_read() {
        let dir = std::env::temp_dir().join(format!("bc-phone-share-{}", std::process::id()));
        for f in ["Pictures", "Videos", "Music", "My pictures"] {
            std::fs::create_dir_all(dir.join(f)).unwrap();
        }
        std::fs::write(dir.join("Pictures").join("John 3-16.png"), b"png").unwrap();
        std::fs::write(dir.join("Pictures").join("notes.txt"), b"x").unwrap();
        std::fs::write(dir.join("Videos").join("clip.mp4"), b"0123456789").unwrap();
        std::fs::write(dir.join("Music").join("song.mp3"), b"m").unwrap();
        std::fs::write(dir.join("My pictures").join("mine.jpg"), b"j").unwrap();
        std::fs::write(dir.join("secret.png"), b"s").unwrap();

        let names: Vec<_> = list(&dir).into_iter().map(|i| format!("{}/{}", i.kind, i.name)).collect();
        assert_eq!(names.len(), 2, "{names:?}");
        assert!(names.contains(&"Pictures/John 3-16.png".to_string()) && names.contains(&"Videos/clip.mp4".to_string()));

        assert!(file_for(&dir, "Pictures", "John 3-16.png").is_some());
        assert!(file_for(&dir, "Videos", "clip.mp4").is_some());
        assert!(file_for(&dir, "Pictures", "notes.txt").is_none(), "a text file is not a picture");
        assert!(file_for(&dir, "Pictures", "clip.mp4").is_none(), "a video is not in Pictures");
        assert!(file_for(&dir, "Music", "song.mp3").is_none());
        assert!(file_for(&dir, "My pictures", "mine.jpg").is_none());
        for bad in ["../secret.png", "..\\secret.png", "C:\\x.png", "a/b.png", ".hidden.png", "", "John 3-16.png\0.txt"] {
            assert!(file_for(&dir, "Pictures", bad).is_none(), "{bad:?}");
        }
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn serves_the_page_the_list_and_the_files_and_nothing_else() {
        let dir = std::env::temp_dir().join(format!("bc-phone-serve-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("Pictures")).unwrap();
        std::fs::create_dir_all(dir.join("Videos")).unwrap();
        std::fs::write(dir.join("Pictures").join("A b.png"), b"PNGDATA").unwrap();
        std::fs::write(dir.join("Videos").join("v.mp4"), b"0123456789").unwrap();
        std::fs::write(dir.join("hidden.png"), b"no").unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let root = dir.clone();
        std::thread::spawn(move || {
            for s in listener.incoming().take(12).flatten() {
                let root = root.clone();
                std::thread::spawn(move || {
                    let _ = serve(s, "abc123", &root);
                });
            }
        });
        let ask = |req: &str| -> String {
            let mut c = TcpStream::connect(addr).unwrap();
            c.write_all(req.as_bytes()).unwrap();
            let mut out = Vec::new();
            c.read_to_end(&mut out).unwrap();
            String::from_utf8_lossy(&out).to_string()
        };
        let page = ask("GET /p/abc123 HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(page.starts_with("HTTP/1.1 200") && page.contains("<title>"), "{page}");
        let list = ask("GET /p/abc123/list HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(list.contains("A b.png") && list.contains("v.mp4") && !list.contains("hidden"), "{list}");
        let pic = ask("GET /p/abc123/f/Pictures/A%20b.png HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(pic.starts_with("HTTP/1.1 200") && pic.contains("image/png") && pic.ends_with("PNGDATA"), "{pic}");
        let saved = ask("GET /p/abc123/f/Pictures/A%20b.png?dl=1 HTTP/1.1\r\nHost: x\r\n\r\n");
        assert!(saved.contains("Content-Disposition: attachment; filename=\"A b.png\""), "{saved}");
        let part = ask("GET /p/abc123/f/Videos/v.mp4 HTTP/1.1\r\nHost: x\r\nRange: bytes=2-4\r\n\r\n");
        assert!(part.starts_with("HTTP/1.1 206") && part.contains("Content-Range: bytes 2-4/10") && part.ends_with("234"), "{part}");
        // a wrong code, a path that climbs out, a folder that is not offered, and anything but a read open nothing
        assert!(ask("GET /p/zzz HTTP/1.1\r\n\r\n").starts_with("HTTP/1.1 404"));
        assert!(ask("GET /p/abc123/f/Pictures/..%2Fhidden.png HTTP/1.1\r\n\r\n").starts_with("HTTP/1.1 404"));
        assert!(ask("GET /p/abc123/f/Music/x.mp3 HTTP/1.1\r\n\r\n").starts_with("HTTP/1.1 404"));
        assert!(ask("POST /p/abc123/list HTTP/1.1\r\nContent-Length: 0\r\n\r\n").starts_with("HTTP/1.1 400"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
