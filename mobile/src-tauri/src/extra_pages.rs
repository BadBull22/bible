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
/// the most pictures the file may carry in each of its two lists (`pictures` for stories, `child_pictures` for children's pages), and the largest one
/// (a painting at about 1500 pixels is 100 to 400 KB)
pub const MAX_PICTURES: usize = 40;
pub const MAX_PICTURE_BYTES: usize = 600_000;
/// a children's page's picture may come with an outline to colour in (a PNG of black lines on white, 30 to 100 KB)
pub const MAX_OUTLINE_BYTES: usize = 300_000;

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
    for key in ["pictures", "child_pictures"] {
        let Some(pictures) = obj.get(key) else { continue };
        let pictures = pictures.as_object().ok_or_else(bad)?;
        if pictures.len() > MAX_PICTURES {
            return Err(bad());
        }
        for (id, pic) in pictures {
            if !safe_id(id) || picture_of(pic).is_none() {
                return Err(bad());
            }
        }
    }
    Ok(v)
}

/// A page's picture inside the file: `{"image": "<base64 JPEG>", "outline": "<base64 PNG, optional>", "credit": {"title", "artist", "credit", "licence",
/// "licence_url", "page", ...}}`. The picture must be a JPEG of at most `MAX_PICTURE_BYTES`, the outline (a children's page's drawing to colour in) a PNG
/// of at most `MAX_OUTLINE_BYTES`, and the credit must say who made it, where it is from and the licence (the same fields the downloaded story pictures
/// carry); anything else is refused. Returns the picture's base64 text and its credit.
fn picture_of(pic: &Value) -> Option<(&str, &Value)> {
    use base64::Engine;
    let o = pic.as_object()?;
    let image = o.get("image")?.as_str()?;
    let credit = o.get("credit")?;
    if image.len() > MAX_PICTURE_BYTES * 4 / 3 + 8 {
        return None;
    }
    let head = base64::engine::general_purpose::STANDARD.decode(image).ok()?;
    if head.len() > MAX_PICTURE_BYTES || head.len() < 4 || head[..3] != [0xFF, 0xD8, 0xFF] {
        return None;
    }
    if let Some(outline) = o.get("outline") {
        let outline = outline.as_str()?;
        if outline.len() > MAX_OUTLINE_BYTES * 4 / 3 + 8 {
            return None;
        }
        let png = base64::engine::general_purpose::STANDARD.decode(outline).ok()?;
        if png.len() > MAX_OUTLINE_BYTES || png.len() < 8 || png[..4] != [0x89, b'P', b'N', b'G'] {
            return None;
        }
    }
    let c = credit.as_object()?;
    for field in ["title", "artist", "credit", "licence", "licence_url", "page"] {
        if !c.get(field).and_then(Value::as_str).is_some_and(|t| !t.trim().is_empty() && t.len() < 600) {
            return None;
        }
    }
    Some((image, credit))
}

/// The picture that came with an additional story (the file's `pictures`), with its credit, when the file on the phone has one for this page.
/// The story-picture downloads are tried first (`picture_packs::story_picture`); this is only for pages the app was not made with.
pub fn picture(data: &Path, id: &str) -> Option<(String, Value)> {
    let (image, _, credit) = picture_in(data, "pictures", id)?;
    Some((image, credit))
}

/// The picture that came with an additional children's page (the file's `child_pictures`): the picture, its outline to colour in when it has one, and
/// the credit.
pub fn child_picture(data: &Path, id: &str) -> Option<(String, Option<String>, Value)> {
    picture_in(data, "child_pictures", id)
}

fn picture_in(data: &Path, list: &str, id: &str) -> Option<(String, Option<String>, Value)> {
    if !safe_id(id) {
        return None;
    }
    let v: Value = serde_json::from_str(&load(data)?).ok()?;
    let pic = v.get(list)?.get(id)?;
    let (image, credit) = picture_of(pic)?;
    Some((image.to_string(), pic.get("outline").and_then(Value::as_str).map(str::to_string), credit.clone()))
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
                let _ = s.set_read_timeout(Some(std::time::Duration::from_secs(5)));
                let mut request = Vec::new();
                let mut buf = [0u8; 2048];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    match s.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => request.extend_from_slice(&buf[..n]),
                    }
                }
                let reply = format!("HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                let _ = s.write_all(reply.as_bytes());
                let _ = s.flush();
                let _ = s.shutdown(std::net::Shutdown::Write);
                // wait for the client to finish reading and close, so nothing is reset
                while matches!(s.read(&mut buf), Ok(n) if n > 0) {}
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

    // a tiny but real-looking JPEG (the start marker is all the check looks at)
    const JPEG_B64: &str = "/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==";
    fn with_picture(credit_fields: &[(&str, &str)], image: &str) -> String {
        let credit = credit_fields.iter().map(|(k, v)| format!("\"{k}\":\"{v}\"")).collect::<Vec<_>>().join(",");
        format!(r#"{{"format":1,"stories":[{{"id":"a-new-story","title":"A new story"}}],"pictures":{{"a-new-story":{{"image":"{image}","credit":{{{credit}}}}}}}}}"#)
    }
    const CREDIT: [(&str, &str); 6] = [("title", "T"), ("artist", "A"), ("credit", "C"), ("licence", "Public domain"), ("licence_url", "https://example.org/l"), ("page", "https://example.org/p")];

    #[test]
    fn a_story_can_bring_its_picture_and_only_a_proper_one_is_taken() {
        assert!(check(with_picture(&CREDIT, JPEG_B64).as_bytes()).is_ok());
        // not a JPEG, not base64, a credit with a field missing, a picture for a bad name, too many
        assert!(check(with_picture(&CREDIT, "aGVsbG8gd29ybGQ=").as_bytes()).is_err());
        assert!(check(with_picture(&CREDIT, "not base64 !!").as_bytes()).is_err());
        assert!(check(with_picture(&CREDIT[..5], JPEG_B64).as_bytes()).is_err());
        assert!(check(with_picture(&CREDIT, JPEG_B64).replace("\"a-new-story\":{\"image", "\"../x\":{\"image").as_bytes()).is_err());
        let many = format!(r#"{{"format":1,"pictures":{{{}}}}}"#, (0..=MAX_PICTURES).map(|i| format!(r#""p{i}":{{"image":"{JPEG_B64}","credit":{{"title":"T","artist":"A","credit":"C","licence":"L","licence_url":"u","page":"p"}}}}"#)).collect::<Vec<_>>().join(","));
        assert!(check(many.as_bytes()).is_err());
    }

    // a tiny PNG header is all the check looks at
    const PNG_B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    fn with_child_picture(extra: &str, image: &str) -> String {
        format!(
            r#"{{"format":1,"children":[{{"id":"a-new-child-page","title":"A new page"}}],"child_pictures":{{"a-new-child-page":{{"image":"{image}"{extra},"credit":{{"title":"T","artist":"A","credit":"C","licence":"CC BY-SA 3.0","licence_url":"https://example.org/l","page":"https://example.org/p"}}}}}}}}"#
        )
    }

    #[test]
    fn a_children_page_can_bring_its_picture_and_an_outline_to_colour_in() {
        assert!(check(with_child_picture("", JPEG_B64).as_bytes()).is_ok());
        assert!(check(with_child_picture(&format!(r#","outline":"{PNG_B64}""#), JPEG_B64).as_bytes()).is_ok());
        // the outline must be a PNG, and the picture a JPEG
        assert!(check(with_child_picture(&format!(r#","outline":"{JPEG_B64}""#), JPEG_B64).as_bytes()).is_err());
        assert!(check(with_child_picture(r#","outline":"not base64 !!""#, JPEG_B64).as_bytes()).is_err());
        assert!(check(with_child_picture(r#","outline":5"#, JPEG_B64).as_bytes()).is_err());
        assert!(check(with_child_picture("", PNG_B64).as_bytes()).is_err());
        // a bad page name in the list is refused, and so are too many
        assert!(check(with_child_picture("", JPEG_B64).replace("\"a-new-child-page\":{\"image", "\"../x\":{\"image").as_bytes()).is_err());
        let many = format!(r#"{{"format":1,"child_pictures":{{{}}}}}"#, (0..=MAX_PICTURES).map(|i| format!(r#""p{i}":{{"image":"{JPEG_B64}","credit":{{"title":"T","artist":"A","credit":"C","licence":"L","licence_url":"u","page":"p"}}}}"#)).collect::<Vec<_>>().join(","));
        assert!(check(many.as_bytes()).is_err());
    }

    #[test]
    fn a_kept_children_picture_is_read_back_for_children_pages_only() {
        let dir = temp("child-picture");
        assert!(child_picture(&dir, "a-new-child-page").is_none(), "nothing fetched yet");
        let body: &'static str = Box::leak(with_child_picture(&format!(r#","outline":"{PNG_B64}""#), JPEG_B64).into_boxed_str());
        fetch_from(&dir, &serve(200, body), MAX_BYTES).unwrap();
        let (image, outline, credit) = child_picture(&dir, "a-new-child-page").unwrap();
        assert_eq!(image, JPEG_B64);
        assert_eq!(outline.as_deref(), Some(PNG_B64));
        assert_eq!(credit["licence"], "CC BY-SA 3.0");
        // a children's page's picture is not a story's picture
        assert!(picture(&dir, "a-new-child-page").is_none());
        assert!(child_picture(&dir, "another-page").is_none());
        for bad in ["", "../a-new-child-page", "A-New-Child-Page", "a/b"] {
            assert!(child_picture(&dir, bad).is_none(), "{bad}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_kept_picture_is_read_back_by_the_page_name_only() {
        let dir = temp("picture");
        assert!(picture(&dir, "a-new-story").is_none(), "nothing fetched yet");
        let body: &'static str = Box::leak(with_picture(&CREDIT, JPEG_B64).into_boxed_str());
        fetch_from(&dir, &serve(200, body), MAX_BYTES).unwrap();
        let (image, credit) = picture(&dir, "a-new-story").unwrap();
        assert_eq!(image, JPEG_B64);
        assert_eq!(credit["artist"], "A");
        assert!(picture(&dir, "another-story").is_none());
        for bad in ["", "../a-new-story", "A-New-Story", "a/b"] {
            assert!(picture(&dir, bad).is_none(), "{bad}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
