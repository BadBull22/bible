//! Additional Bible stories, "Verses for..." pages and children's pages on the computer (since 3.1.0), the same optional layer the phone has had since 3.0.0.
//! The pages that come inside the app never change; this is ONE small data file (JSON, no code, pictures inside it) that the reader fetches with the
//! "Fetch additional stories" button in Browse, kept in the app's data folder and added to the three lists. It is how a story can be added without a new
//! version of the app. The file is made by `scripts/build_extra_pages.mts` and lives on the app's GitHub releases (`extra-pages`), the same file the phone reads.
//! What protects the reader: only the app's own https address, a size limit, a check that it is a list of pages (and pictures) of the shape the app reads,
//! and the app's own check of every page before it is shown (`mobile/src/extraValidate.ts`, shared). Nothing in it is ever run. This file is the
//! phone's `extra_pages.rs` without the picture read-back (the screen reads the pictures out of the file itself).

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

pub const URL: &str = "https://github.com/BadBull22/bible/releases/download/extra-pages/extra-pages.json";
const FOLDER: &str = "extra-pages";
const FILE: &str = "pages.json";
/// the largest file the app takes (the built-in pages are about 0.5 MB in all)
pub const MAX_BYTES: u64 = 6 << 20;
/// the most pages the file may hold
pub const MAX_PAGES: usize = 1000;
/// the most pictures the file may carry in each of its two lists (`pictures` for stories, `child_pictures` for children's pages), and the largest one
pub const MAX_PICTURES: usize = 40;
pub const MAX_PICTURE_BYTES: usize = 600_000;
/// a children's page's picture may come with an outline to colour in (a PNG of black lines on white)
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
    /// the file's own text, for the screen to check and show
    pub text: String,
    /// the same file as the one already here
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

/// Checks these bytes and keeps them as the file, unless they are the same as the one already kept. The copy already here is replaced only by a file that passes.
pub fn keep(data: &Path, bytes: Vec<u8>, max: u64) -> Result<Fetched, String> {
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

/// Fetches the file from `url` (at most `max` bytes) and keeps it.
pub async fn fetch_from(data: &Path, url: &str, max: u64) -> Result<Fetched, String> {
    let client = reqwest::Client::builder().user_agent(crate::library_commands::USER_AGENT).timeout(std::time::Duration::from_secs(60)).build().map_err(|e| e.to_string())?;
    let offline = || "Couldn't fetch them. Check the computer's internet connection and try again.".to_string();
    let response = client.get(url).send().await.map_err(|_| offline())?;
    // nothing has been published yet (the release does not exist): not a fault of the connection
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("There are no additional stories yet. Please look again later.".into());
    }
    if !response.status().is_success() {
        return Err(offline());
    }
    if response.content_length().is_some_and(|n| n > max) {
        return Err("That file is larger than this app takes.".into());
    }
    let bytes = response.bytes().await.map_err(|_| "The download stopped before it was finished. Please try again.".to_string())?;
    keep(data, bytes.to_vec(), max)
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// The additional pages kept from an earlier fetch (the file's text), or nothing.
#[tauri::command]
pub fn extra_pages_load(app: tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(load(&data_dir(&app)?))
}

/// The "Fetch additional stories" button.
#[tauri::command]
pub async fn extra_pages_fetch(app: tauri::AppHandle) -> Result<Fetched, String> {
    fetch_from(&data_dir(&app)?, URL, MAX_BYTES).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("bc-extra-desktop-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const GOOD: &str = r#"{"format":1,"stories":[{"id":"a-new-story","title":"A new story"}],"topics":[],"children":[{"id":"a-new-page","title":"A new page"}]}"#;

    #[test]
    fn a_good_file_is_kept_and_read_back_and_the_same_file_again_changes_nothing() {
        let dir = temp("good");
        assert!(load(&dir).is_none(), "nothing fetched yet");
        let got = keep(&dir, GOOD.as_bytes().to_vec(), MAX_BYTES).unwrap();
        assert_eq!(got.text, GOOD);
        assert!(!got.unchanged);
        assert_eq!(load(&dir).as_deref(), Some(GOOD));
        assert!(keep(&dir, GOOD.as_bytes().to_vec(), MAX_BYTES).unwrap().unchanged);
        assert!(!dir.join(FOLDER).join("pages.json.part").exists(), "no half-written file is left");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_bad_file_never_replaces_the_good_one() {
        let dir = temp("bad");
        keep(&dir, GOOD.as_bytes().to_vec(), MAX_BYTES).unwrap();
        for body in ["<html>sign in</html>", r#"{"format":2,"stories":[]}"#, r#"{"format":1,"stories":[{"id":"../x","title":"X"}]}"#, r#"{"format":1,"stories":[{"id":"ok"}]}"#, r#"{"format":1,"stories":"no"}"#, "[1,2]"] {
            let err = keep(&dir, body.as_bytes().to_vec(), MAX_BYTES).unwrap_err();
            assert!(err.contains("isn't a list of stories"), "{body}: {err}");
            assert_eq!(load(&dir).as_deref(), Some(GOOD), "{body}");
        }
        let err = keep(&dir, GOOD.as_bytes().to_vec(), 20).unwrap_err();
        assert!(err.contains("larger"), "{err}");
        assert_eq!(load(&dir).as_deref(), Some(GOOD));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_check_accepts_each_list_missing_and_refuses_too_many_pages() {
        assert!(check(br#"{"format":1}"#).is_ok());
        assert!(check(br#"{"format":1,"topics":[{"id":"fear-not","title":"Fear not"}]}"#).is_ok());
        let many = format!(r#"{{"format":1,"stories":[{}]}}"#, (0..=MAX_PAGES).map(|i| format!(r#"{{"id":"s{i}","title":"S"}}"#)).collect::<Vec<_>>().join(","));
        assert!(check(many.as_bytes()).is_err());
    }

    // a tiny but real-looking JPEG and PNG (the start marker is all the check looks at)
    const JPEG_B64: &str = "/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==";
    const PNG_B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB";
    const CREDIT: &str = r#""credit":{"title":"T","artist":"A","credit":"C","licence":"Public domain","licence_url":"https://example.org/l","page":"https://example.org/p"}"#;

    #[test]
    fn pictures_inside_the_file_are_taken_only_when_they_are_proper_ones() {
        let story = |image: &str, id: &str, credit: &str| format!(r#"{{"format":1,"stories":[{{"id":"a-new-story","title":"A"}}],"pictures":{{"{id}":{{"image":"{image}",{credit}}}}}}}"#);
        assert!(check(story(JPEG_B64, "a-new-story", CREDIT).as_bytes()).is_ok());
        assert!(check(story("aGVsbG8gd29ybGQ=", "a-new-story", CREDIT).as_bytes()).is_err(), "not a JPEG");
        assert!(check(story("not base64 !!", "a-new-story", CREDIT).as_bytes()).is_err());
        assert!(check(story(JPEG_B64, "a-new-story", r#""credit":{"title":"T"}"#).as_bytes()).is_err(), "a credit with fields missing");
        assert!(check(story(JPEG_B64, "../x", CREDIT).as_bytes()).is_err(), "a bad page name");
        let kid = |extra: &str| format!(r#"{{"format":1,"children":[{{"id":"a-new-page","title":"A"}}],"child_pictures":{{"a-new-page":{{"image":"{JPEG_B64}"{extra},{CREDIT}}}}}}}"#);
        assert!(check(kid("").as_bytes()).is_ok());
        assert!(check(kid(&format!(r#","outline":"{PNG_B64}""#)).as_bytes()).is_ok());
        assert!(check(kid(&format!(r#","outline":"{JPEG_B64}""#)).as_bytes()).is_err(), "the outline must be a PNG");
        let many = format!(r#"{{"format":1,"pictures":{{{}}}}}"#, (0..=MAX_PICTURES).map(|i| format!(r#""p{i}":{{"image":"{JPEG_B64}",{CREDIT}}}"#)).collect::<Vec<_>>().join(","));
        assert!(check(many.as_bytes()).is_err(), "too many pictures");
    }
}
