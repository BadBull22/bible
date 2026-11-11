//! Additional Bible stories, "Verses for..." pages and children's pages (since 3.0.0). The pages that come inside the app never change; this is a
//! second, optional layer: ONE small data file (JSON, no code) that the reader fetches with the "Fetch additional stories" button, kept in the app's
//! data folder, and added to the three lists. It is how a story can be added without a new version of the app.
//!
//! The file is made on the computer by `scripts/build_extra_pages.mts` (which checks every page against the same rules the built-in pages pass) and
//! lives on the app's GitHub releases (`extra-pages`). Unlike the picture packs it cannot be pinned to a fingerprint inside the app (it changes every
//! time a page is added), so what protects the reader is: only the app's own https address, a size limit, a check that it is a list of pages of the
//! shape this app reads, and the app's own check of every page before it is shown (`mobile/src/extraValidate.ts`). Nothing in it is ever run.

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

/// Where the file comes from. A build made for testing can point somewhere else (`BC_EXTRA_PAGES_URL=http://... ` when it is compiled); a release
/// build never does.
pub const URL: &str = match option_env!("BC_EXTRA_PAGES_URL") {
    Some(url) => url,
    None => "https://github.com/BadBull22/bible/releases/download/extra-pages/extra-pages.json",
};
const FOLDER: &str = "extra-pages";
const FILE: &str = "pages.json";
/// the largest file the app takes (the built-in pages are about 0.5 MB in all)
pub const MAX_BYTES: u64 = 6 << 20;
/// the most pages the file may hold
pub const MAX_PAGES: usize = 1000;

fn path(data: &Path) -> PathBuf {
    data.join(FOLDER).join(FILE)
}

/// The file as it was last fetched (None if nothing was ever fetched).
pub fn load(data: &Path) -> Option<String> {
    std::fs::read_to_string(path(data)).ok()
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Fetched {
    /// the file's own text, for the page to check and show
    pub text: String,
    /// the same file as the one already on the phone
    pub unchanged: bool,
}

/// A page's name as the files spell it: lower-case letters, digits and hyphens only.
fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.len() < 80 && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Checks that these bytes are a list of pages this app can read: a JSON object with `format` 1, `stories`, `topics` and `children` (each a list of
/// pages, any may be missing), every page with a proper `id` and a `title`, no more than `MAX_PAGES` in all. The shape of each page is checked
/// again, page by page, by the app before it is shown.
pub fn check(bytes: &[u8]) -> Result<Value, String> {
    let bad = || "That file isn't a list of stories this version of the app can read.".to_string();
    let v: Value = serde_json::from_slice(bytes).map_err(|_| bad())?;
    let obj = v.as_object().ok_or_else(bad)?;
    if obj.get("format").and_then(Value::as_u64) != Some(1) {
        return Err(bad());
    }
    let mut total = 0usize;
    for key in ["stories", "topics", "children"] {
        let Some(list) = obj.get(key) else { continue };
        let list = list.as_array().ok_or_else(bad)?;
        total += list.len();
        for page in list {
            let p = page.as_object().ok_or_else(bad)?;
            if !p.get("id").and_then(Value::as_str).is_some_and(safe_id) || !p.get("title").is_some_and(Value::is_string) {
                return Err(bad());
            }
        }
    }
    if total > MAX_PAGES {
        return Err(bad());
    }
    Ok(v)
}

/// Fetches the file from `url` (at most `max` bytes), checks it and keeps it. The copy already on the phone is replaced only by a file that passes.
pub fn fetch_from(data: &Path, url: &str, max: u64) -> Result<Fetched, String> {
    let response = match ureq::get(url).set("User-Agent", "BibleConcordance-Android (https://bible4me.org)").timeout(std::time::Duration::from_secs(60)).call() {
        Ok(r) => r,
        // nothing has been published yet (the release does not exist): not a fault of the phone's connection
        Err(ureq::Error::Status(404, _)) => return Err("There are no additional stories yet. Please look again later.".into()),
        Err(_) => return Err("Couldn't fetch them. Check the phone's internet connection and try again.".into()),
    };
    let mut bytes = Vec::new();
    response.into_reader().take(max + 1).read_to_end(&mut bytes).map_err(|_| "The download stopped before it was finished. Please try again.".to_string())?;
    if bytes.len() as u64 > max {
        return Err("That file is larger than this app takes.".into());
    }
    check(&bytes)?;
    let text = String::from_utf8(bytes).map_err(|_| "That file isn't a list of stories this version of the app can read.".to_string())?;
    let unchanged = load(data).as_deref() == Some(text.as_str());
    if !unchanged {
        let dir = data.join(FOLDER);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let part = dir.join(format!("{FILE}.part"));
        std::fs::write(&part, &text).map_err(|e| e.to_string())?;
        std::fs::rename(&part, path(data)).map_err(|e| e.to_string())?;
    }
    Ok(Fetched { text, unchanged })
}

pub fn fetch(data: &Path) -> Result<Fetched, String> {
    fetch_from(data, URL, MAX_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;

    /// A tiny local web server that answers every request with `status` and `body`.
    fn serve(status: u16, body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten().take(8) {
                let mut s = stream;
                let mut buf = [0u8; 2048];
                let _ = s.read(&mut buf);
                let reply = format!("HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = s.write_all(reply.as_bytes());
            }
        });
        format!("http://127.0.0.1:{port}/extra-pages.json")
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bc-extra-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const GOOD: &str = r#"{"format":1,"stories":[{"id":"a-new-story","title":"A new story"}],"topics":[],"children":[{"id":"a-new-page","title":"A new page"}]}"#;

    #[test]
    fn a_good_file_is_kept_and_read_back_and_a_second_fetch_says_nothing_changed() {
        let dir = temp("good");
        assert!(load(&dir).is_none(), "nothing fetched yet");
        let url = serve(200, GOOD);
        let got = fetch_from(&dir, &url, MAX_BYTES).unwrap();
        assert_eq!(got.text, GOOD);
        assert!(!got.unchanged);
        assert_eq!(load(&dir).as_deref(), Some(GOOD));
        assert!(fetch_from(&dir, &url, MAX_BYTES).unwrap().unchanged);
        assert!(!dir.join(FOLDER).join("pages.json.part").exists(), "no half-written file is left");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn nothing_published_yet_says_so_and_a_bad_file_never_replaces_the_good_one() {
        let dir = temp("bad");
        let err = fetch_from(&dir, &serve(404, "Not Found"), MAX_BYTES).unwrap_err();
        assert!(err.starts_with("There are no additional stories yet"), "{err}");
        assert!(load(&dir).is_none());
        // a good copy is on the phone; then the server sends rubbish, something of the wrong shape, and something too large
        fetch_from(&dir, &serve(200, GOOD), MAX_BYTES).unwrap();
        for body in ["<html>sign in</html>", r#"{"format":2,"stories":[]}"#, r#"{"format":1,"stories":[{"id":"../x","title":"X"}]}"#, r#"{"format":1,"stories":[{"id":"ok"}]}"#, r#"{"format":1,"stories":"no"}"#, "[1,2]"] {
            let err = fetch_from(&dir, &serve(200, Box::leak(body.to_string().into_boxed_str())), MAX_BYTES).unwrap_err();
            assert!(err.contains("isn't a list of stories"), "{body}: {err}");
            assert_eq!(load(&dir).as_deref(), Some(GOOD), "{body}");
        }
        let err = fetch_from(&dir, &serve(200, GOOD), 20).unwrap_err();
        assert!(err.contains("larger"), "{err}");
        assert_eq!(load(&dir).as_deref(), Some(GOOD));
        // no connection at all
        let err = fetch_from(&dir, "http://127.0.0.1:9/none.json", MAX_BYTES).unwrap_err();
        assert!(err.contains("internet connection"), "{err}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_check_accepts_each_list_missing_and_refuses_too_many_pages() {
        assert!(check(br#"{"format":1}"#).is_ok());
        assert!(check(br#"{"format":1,"topics":[{"id":"fear-not","title":"Fear not"}]}"#).is_ok());
        let many = format!(r#"{{"format":1,"stories":[{}]}}"#, (0..=MAX_PAGES).map(|i| format!(r#"{{"id":"s{i}","title":"S"}}"#)).collect::<Vec<_>>().join(","));
        assert!(check(many.as_bytes()).is_err());
    }
}
