//! Content Factory: keeps the pictures, videos, music and captions the studio makes in
//! Documents\Bible Concordance\Content Factory\<Pictures|Videos|Music|Captions|My pictures>, and shows them.
//! The page makes the files (canvas, video encoder); this only writes them, safely.

use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// The largest file taken (a minute of 1080p video is about 50 MB).
const MAX_BYTES: usize = 800 * 1024 * 1024;
const FOLDERS: [&str; 5] = ["Pictures", "Videos", "Music", "Captions", "My pictures"];
const EXTENSIONS: [&str; 12] = ["png", "jpg", "jpeg", "mp4", "m4a", "txt", "webm", "mp3", "ogg", "oga", "wav", "flac"];

pub(crate) fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().document_dir().map_err(|e| e.to_string())?.join("Bible Concordance").join("Content Factory"))
}

/// A file name that is safe on Windows: no folders, no reserved characters, not too long, a known extension.
fn safe_name(raw: &str) -> Result<String, String> {
    let cleaned: String = raw
        .chars()
        .map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { '-' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim().to_string();
    let (stem, ext) = cleaned.rsplit_once('.').ok_or("The file needs a name with an ending such as .png.")?;
    let ext = ext.to_ascii_lowercase();
    if !EXTENSIONS.contains(&ext.as_str()) {
        return Err("That kind of file cannot be saved here.".into());
    }
    let stem: String = stem.trim().chars().take(110).collect();
    let stem = stem.trim().trim_matches('.').trim();
    if stem.is_empty() {
        return Err("The file needs a name.".into());
    }
    Ok(format!("{stem}.{ext}"))
}

/// The first name not already taken: "name.png", "name (2).png", ...
fn free_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    let mut n = 2;
    loop {
        let p = dir.join(format!("{stem} ({n}).{ext}"));
        if !p.exists() {
            return p;
        }
        n += 1;
    }
}

/// Saves a file the studio made. The bytes are the request body; the header `x-folder` says which folder
/// (Pictures, Videos, Music or Captions) and `x-name` is the file name (percent-encoded). Never overwrites:
/// a second "John 3-16.png" becomes "John 3-16 (2).png". Returns the full path.
#[tauri::command]
pub async fn factory_save(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("No file was received.".into());
    };
    if bytes.is_empty() {
        return Err("The file is empty.".into());
    }
    if bytes.len() > MAX_BYTES {
        return Err("That file is too large to save here.".into());
    }
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(crate::sermon_media::percent_decode).unwrap_or_default();
    let folder = header("x-folder");
    if !FOLDERS.contains(&folder.as_str()) {
        return Err("No such folder.".into());
    }
    let name = safe_name(&header("x-name"))?;
    let dir = root(&app)?.join(&folder);
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let path = free_path(&dir, &name);
        fs::write(&path, bytes).map_err(|e| e.to_string())?;
        Ok(path.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Shows a saved file in its folder (only files inside the Content Factory folder).
#[tauri::command]
pub fn factory_reveal(app: AppHandle, path: String) -> Result<(), String> {
    let root = root(&app)?;
    let p = PathBuf::from(&path);
    if !p.starts_with(&root) || !p.exists() {
        return Err("That file is not in the Content Factory folder.".into());
    }
    tauri_plugin_opener::reveal_item_in_dir(&p).map_err(|e| e.to_string())
}

/// Opens the Content Factory folder (made if it is not there yet) and returns its path.
#[tauri::command]
pub fn factory_open_folder(app: AppHandle) -> Result<String, String> {
    let root = root(&app)?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(&root, None::<&str>).map_err(|e| e.to_string())?;
    Ok(root.display().to_string())
}

// ---------------------------------------------------------------- what the factory made, for the sermon builder to use

#[derive(serde::Serialize, Debug)]
pub struct FactoryFile {
    pub path: String,
    pub name: String,
    /// "Pictures", "Videos" or "Music"
    pub folder: String,
    pub size: u64,
    /// seconds since 1970
    pub modified: u64,
}

/// The pictures, videos and music the Content Factory has saved, the newest first (at most 300), so the sermon builder and the
/// slide editor can offer them.
#[tauri::command]
pub fn factory_files(app: AppHandle) -> Result<Vec<FactoryFile>, String> {
    let base = root(&app)?;
    let mut out: Vec<FactoryFile> = Vec::new();
    for folder in ["Pictures", "Videos", "Music"] {
        let Ok(entries) = fs::read_dir(base.join(folder)) else { continue };
        for e in entries.flatten() {
            let path = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            let Ok(meta) = e.metadata() else { continue };
            let ext_ok = name.rsplit_once('.').map(|(_, x)| EXTENSIONS.contains(&x.to_ascii_lowercase().as_str()) && x != "txt").unwrap_or(false);
            if !meta.is_file() || !ext_ok {
                continue;
            }
            let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
            out.push(FactoryFile { path: path.display().to_string(), name, folder: folder.to_string(), size: meta.len(), modified });
        }
    }
    out.sort_by(|a, b| b.modified.cmp(&a.modified));
    out.truncate(300);
    Ok(out)
}

/// One saved file's bytes (only inside the Content Factory folder).
#[tauri::command]
pub async fn factory_file_bytes(app: AppHandle, path: String) -> Result<tauri::ipc::Response, String> {
    let base = root(&app)?;
    let p = PathBuf::from(&path);
    if !p.starts_with(&base) || !p.is_file() {
        return Err("That file is not in the Content Factory folder.".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || fs::read(p)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Opens the gallery of finished work in a window of its own (or brings it forward when it is already open): the pictures and videos saved
/// in the Content Factory folder, as little pictures. It can be moved to another screen, left open beside the studio or closed. Built like the
/// slide screen: with the same WebView settings as the main window, which WebView2 requires of every window of an app.
#[tauri::command]
pub async fn factory_gallery_open(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("gallery") {
        let _ = w.unminimize();
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let mut b = tauri::WebviewWindowBuilder::new(&app, "gallery", tauri::WebviewUrl::App("index.html".into()))
        .title("Content Factory: made pictures and videos")
        .inner_size(1100.0, 760.0)
        .min_inner_size(520.0, 420.0)
        .resizable(true)
        .center();
    if let Some(args) = app.config().app.windows.first().and_then(|w| w.additional_browser_args.clone()) {
        b = b.additional_browser_args(&args);
    }
    b.build().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------- the reader's own pictures
// Documents\Bible Concordance\Content Factory\My pictures: photographs the reader downloaded (from Unsplash, Pexels, Pixabay or anywhere they may be
// used) or took, to put behind the words. The studio shrinks them as it adds them (the page does that, then saves them with `factory_save`); a picture
// put in the folder by hand is listed too.

const MY_PICTURES: &str = "My pictures";
const PICTURE_EXTENSIONS: [&str; 4] = ["jpg", "jpeg", "png", "webp"];

#[derive(serde::Serialize, Debug)]
pub struct MyPicture {
    pub path: String,
    pub name: String,
    pub size: u64,
    /// seconds since 1970
    pub modified: u64,
}

/// The pictures in a folder, by name (letters and numbers in their natural order), at most 1000.
fn pictures_in(dir: &Path) -> Vec<MyPicture> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<MyPicture> = Vec::new();
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let Ok(meta) = e.metadata() else { continue };
        let ok = name.rsplit_once('.').map(|(_, x)| PICTURE_EXTENSIONS.contains(&x.to_ascii_lowercase().as_str())).unwrap_or(false);
        if !meta.is_file() || !ok || name.starts_with('.') {
            continue;
        }
        let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
        out.push(MyPicture { path: e.path().display().to_string(), name, size: meta.len(), modified });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out.truncate(1000);
    out
}

/// The reader's own pictures, by name.
#[tauri::command]
pub fn factory_pictures_list(app: AppHandle) -> Result<Vec<MyPicture>, String> {
    Ok(pictures_in(&root(&app)?.join(MY_PICTURES)))
}

/// Opens the "My pictures" folder (made if it is not there yet).
#[tauri::command]
pub fn factory_pictures_folder(app: AppHandle) -> Result<String, String> {
    let dir = root(&app)?.join(MY_PICTURES);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(&dir, None::<&str>).map_err(|e| e.to_string())?;
    Ok(dir.display().to_string())
}

// ---------------------------------------------------------------- the music library
// Documents\Bible Concordance\Content Factory\Music library\<group>\<file>. A group is a folder: "Southern Cross Music" (the
// owner's own songs: credited automatically, "Music: <song> by Southern Cross Music"), "Free recordings" (downloaded on request,
// public domain and CC0 only, each with its credit in credits.json) and any other folder or loose file ("My music").

const LIBRARY: &str = "Music library";
const SOUTHERN_CROSS: &str = "Southern Cross Music";
const FREE: &str = "Free recordings";
const AUDIO: [&str; 6] = ["mp3", "m4a", "ogg", "oga", "wav", "flac"];

#[derive(serde::Serialize, Clone, Debug)]
pub struct LibTrack {
    /// "Group/file.ext": what to ask for it by
    pub id: String,
    pub title: String,
    pub artist: String,
    /// the credit that goes with it ("Music: Aria - Kimiko Ishizaka (CC0)"), empty when none is needed
    pub credit: String,
    pub link: String,
    pub group: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
struct CreditEntry {
    #[serde(default)]
    title: String,
    #[serde(default)]
    artist: String,
    #[serde(default)]
    credit: String,
    #[serde(default)]
    link: String,
}

fn library_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(root(app)?.join(LIBRARY))
}

fn is_audio(name: &str) -> bool {
    name.rsplit_once('.').map(|(_, e)| AUDIO.contains(&e.to_ascii_lowercase().as_str())).unwrap_or(false)
}

/// "03 - Be Still_Final.mp3" -> "Be Still Final"
fn title_from(file: &str) -> String {
    let stem = file.rsplit_once('.').map(|(s, _)| s).unwrap_or(file);
    let stem = stem.replace('_', " ");
    let trimmed = stem.trim_start_matches(|c: char| c.is_ascii_digit() || c == ' ' || c == '-' || c == '.');
    let t = if trimmed.is_empty() { stem.trim() } else { trimmed.trim() };
    t.to_string()
}

fn read_credits(dir: &Path) -> std::collections::HashMap<String, CreditEntry> {
    fs::read_to_string(dir.join("credits.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

fn track_of(group: &str, file: &str, credits: &std::collections::HashMap<String, CreditEntry>) -> LibTrack {
    let c = credits.get(file).cloned().unwrap_or_default();
    let title = if c.title.is_empty() { title_from(file) } else { c.title.clone() };
    let (artist, credit, link) = if group == SOUTHERN_CROSS {
        let artist = if c.artist.is_empty() { SOUTHERN_CROSS.to_string() } else { c.artist.clone() };
        let credit = if c.credit.is_empty() { format!("Music: {title} by {artist}") } else { c.credit.clone() };
        let link = if c.link.is_empty() { "https://music.youtube.com/channel/UCOmYicXYhihT-vUOFE99ETw".to_string() } else { c.link.clone() };
        (artist, credit, link)
    } else {
        (c.artist.clone(), c.credit.clone(), c.link.clone())
    };
    LibTrack { id: format!("{group}/{file}"), title, artist, credit, link, group: group.to_string() }
}

/// Every piece of music in the library folder: the Southern Cross Music songs first, then the free recordings, then the rest.
#[tauri::command]
pub fn factory_library_list(app: AppHandle) -> Result<Vec<LibTrack>, String> {
    let lib = library_root(&app)?;
    let mut out: Vec<LibTrack> = Vec::new();
    let Ok(entries) = fs::read_dir(&lib) else { return Ok(out) };
    let mut loose: Vec<String> = Vec::new();
    for e in entries.flatten() {
        let path = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            let credits = read_credits(&path);
            let group = if name.eq_ignore_ascii_case(SOUTHERN_CROSS) { SOUTHERN_CROSS.to_string() } else if name.eq_ignore_ascii_case(FREE) { FREE.to_string() } else { name.clone() };
            if let Ok(files) = fs::read_dir(&path) {
                for f in files.flatten() {
                    let fname = f.file_name().to_string_lossy().to_string();
                    if f.path().is_file() && is_audio(&fname) {
                        let mut t = track_of(&group, &fname, &credits);
                        t.id = format!("{name}/{fname}");
                        out.push(t);
                    }
                }
            }
        } else if path.is_file() && is_audio(&name) {
            loose.push(name);
        }
    }
    for name in loose {
        let mut t = track_of("My music", &name, &Default::default());
        t.id = name;
        out.push(t);
    }
    let rank = |g: &str| if g == SOUTHERN_CROSS { 0 } else if g == FREE { 1 } else { 2 };
    out.sort_by(|a, b| rank(&a.group).cmp(&rank(&b.group)).then(a.group.cmp(&b.group)).then(a.title.to_lowercase().cmp(&b.title.to_lowercase())));
    Ok(out)
}

/// A track's file path, only inside the library folder.
fn library_file(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let parts: Vec<&str> = id.split('/').collect();
    if parts.is_empty() || parts.len() > 2 || parts.iter().any(|p| p.is_empty() || *p == ".." || *p == "." || p.contains('\\') || p.contains(':')) || !is_audio(parts[parts.len() - 1]) {
        return Err("No such music.".into());
    }
    let path = parts.iter().fold(library_root(app)?, |p, part| p.join(part));
    if !path.is_file() {
        return Err("That music is no longer in the folder.".into());
    }
    Ok(path)
}

/// A track's bytes, to play it and to mix it into a video.
#[tauri::command]
pub async fn factory_library_read(app: AppHandle, id: String) -> Result<tauri::ipc::Response, String> {
    let path = library_file(&app, &id)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || fs::read(path)).await.map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Opens the music library folder (made, with the Southern Cross Music folder inside, if it is not there yet).
#[tauri::command]
pub fn factory_library_folder(app: AppHandle) -> Result<String, String> {
    let lib = library_root(&app)?;
    fs::create_dir_all(lib.join(SOUTHERN_CROSS)).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(&lib, None::<&str>).map_err(|e| e.to_string())?;
    Ok(lib.display().to_string())
}

/// May this address be downloaded from? Only the two places the free recordings are kept, over https.
fn allowed_source(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    if host.contains('@') {
        return false;
    }
    host == "upload.wikimedia.org" || host == "archive.org" || host.ends_with(".archive.org")
}

/// Downloads one free recording into "Free recordings" and writes its credit beside it. Public domain and CC0 recordings only:
/// the page lists them (src/factory/freeMusic.ts); this refuses any other address.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn factory_library_download(app: AppHandle, url: String, file: String, title: String, artist: String, credit: String, link: String) -> Result<String, String> {
    if !allowed_source(&url) {
        return Err("That address is not one the app downloads music from.".into());
    }
    let name = safe_name(&file).map_err(|_| "A bad file name.".to_string())?;
    if !is_audio(&name) {
        return Err("That is not a music file.".into());
    }
    let dir = library_root(&app)?.join(FREE);
    let target = dir.join(&name);
    if target.exists() {
        return Ok(format!("{FREE}/{name}"));
    }
    let client = reqwest::Client::builder().user_agent(crate::library_commands::USER_AGENT).timeout(std::time::Duration::from_secs(300)).build().map_err(|e| e.to_string())?;
    let mut resp = client
        .get(&url)
        .send()
        .await
        .map_err(|_| "Couldn't download the music. Check the internet connection and try again.".to_string())?
        .error_for_status()
        .map_err(|e| format!("Couldn't download the music ({e})."))?;
    let mut bytes: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|_| "The download stopped before it was finished. Please try again.".to_string())? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > 40 << 20 {
            return Err("The download is larger than expected.".into());
        }
    }
    if bytes.len() < 10_000 {
        return Err("The download did not give a music file.".into());
    }
    let id = format!("{FREE}/{name}");
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let tmp = dir.join(format!("{name}.part"));
        fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        fs::rename(&tmp, dir.join(&name)).map_err(|e| e.to_string())?;
        let mut credits = read_credits(&dir);
        credits.insert(name, CreditEntry { title, artist, credit, link });
        let text = serde_json::to_string_pretty(&credits).map_err(|e| e.to_string())?;
        fs::write(dir.join("credits.json"), text).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_made_safe() {
        assert_eq!(safe_name("John 3-16 - Square.png").unwrap(), "John 3-16 - Square.png");
        assert_eq!(safe_name("..\\..\\evil:name?.PNG").unwrap(), "-..-evil-name-.png");
        assert!(safe_name("x.exe").is_err());
        assert!(safe_name("noending").is_err());
        assert!(safe_name(".png").is_err());
        assert_eq!(safe_name("a/b.mp4").unwrap(), "a-b.mp4");
    }

    #[test]
    fn the_readers_pictures_are_listed_by_name() {
        let dir = std::env::temp_dir().join(format!("cf-pics-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        for n in ["b-cross.JPG", "A-dove.jpg", "notes.txt", "c.png", ".hidden.jpg", "d.exe"] {
            fs::write(dir.join(n), b"x").unwrap();
        }
        fs::create_dir_all(dir.join("sub.jpg")).unwrap();
        let names: Vec<String> = pictures_in(&dir).into_iter().map(|p| p.name).collect();
        assert_eq!(names, vec!["A-dove.jpg", "b-cross.JPG", "c.png"]);
        assert!(pictures_in(&dir.join("nothing-here")).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_taken_name_is_numbered() {
        let dir = std::env::temp_dir().join(format!("cf-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("a.png"), b"x").unwrap();
        assert_eq!(free_path(&dir, "a.png"), dir.join("a (2).png"));
        fs::write(dir.join("a (2).png"), b"x").unwrap();
        assert_eq!(free_path(&dir, "a.png"), dir.join("a (3).png"));
        assert_eq!(free_path(&dir, "b.png"), dir.join("b.png"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn music_titles_and_sources() {
        assert_eq!(title_from("03 - Be Still_Final.mp3"), "Be Still Final");
        assert_eq!(title_from("Everyday Angel.m4a"), "Everyday Angel");
        assert_eq!(title_from("7.ogg"), "7");
        assert!(is_audio("a.MP3") && is_audio("b.flac") && !is_audio("c.exe") && !is_audio("noext"));
        assert!(allowed_source("https://upload.wikimedia.org/wikipedia/commons/c/c9/x.ogg"));
        assert!(allowed_source("https://archive.org/download/x/y.ogg"));
        assert!(allowed_source("https://ia800000.us.archive.org/x/y.ogg"));
        assert!(!allowed_source("http://archive.org/x.ogg"));
        assert!(!allowed_source("https://evil.example.com/archive.org/x.ogg"));
        assert!(!allowed_source("https://archive.org.evil.com/x.ogg"));
        assert!(!allowed_source("https://user@evil.com@archive.org/x"));
    }

    #[test]
    fn southern_cross_songs_are_credited_by_themselves() {
        let none = Default::default();
        let t = track_of(SOUTHERN_CROSS, "05 - Everyday_Angel.mp3", &none);
        assert_eq!(t.title, "Everyday Angel");
        assert_eq!(t.credit, "Music: Everyday Angel by Southern Cross Music");
        assert!(t.link.contains("music.youtube.com"));
        let other = track_of("My music", "x.mp3", &none);
        assert!(other.credit.is_empty());
    }
}
