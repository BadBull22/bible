//! Pictures, video, music and other files added to a sermon, and the nature photos to use as
//! pictures or slide backgrounds.
//!
//! An added file is copied into the app's data folder (`sermon-media\`) under a new name, so
//! the sermon keeps working if the original is moved or deleted; the sermon records that
//! name. Web links (YouTube, music) are kept in the sermon itself and need nothing here.
//!
//! The nature photos are the Android app's: 100 public-domain / CC0 photos from Wikimedia
//! Commons, one zip (about 8 MB) on the app's GitHub releases, made by
//! mobile/data/build_backgrounds.py, downloaded once into `backgrounds\`.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(err)
}

pub fn media_dir(data: &Path) -> PathBuf {
    data.join("sermon-media")
}

/// A file name this module made: letters, digits, "-" and one extension.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() < 80 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.') && !name.starts_with('.') && name.matches('.').count() <= 1
}

/// The extension to keep, from the original name: lower case, letters and digits only.
fn extension(original: &str) -> String {
    let ext = Path::new(original).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !ext.is_empty() && ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        ext
    } else {
        "bin".into()
    }
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct MediaFile {
    /// the name it is kept under in sermon-media
    pub file: String,
    pub size: u64,
}

/// Keeps a copy of a file for a sermon and says what it is now called.
pub fn add(data: &Path, original_name: &str, bytes: &[u8]) -> Result<MediaFile, String> {
    let dir = media_dir(data);
    fs::create_dir_all(&dir).map_err(err)?;
    // named by its contents: the same picture added twice is kept once
    let hash: String = Sha256::digest(bytes).iter().take(10).map(|b| format!("{b:02x}")).collect();
    let file = format!("{hash}.{}", extension(original_name));
    let path = dir.join(&file);
    if !path.exists() {
        fs::write(&path, bytes).map_err(err)?;
    }
    Ok(MediaFile { file, size: bytes.len() as u64 })
}

pub fn path_of(data: &Path, file: &str) -> Result<PathBuf, String> {
    if !valid_name(file) {
        return Err("No such file.".into());
    }
    let p = media_dir(data).join(file);
    if p.exists() {
        Ok(p)
    } else {
        Err("That file is no longer in the app's folder.".into())
    }
}

/// The largest file that can be added (a long video can be bigger: add it as a link).
const MAX_BYTES: usize = 1 << 30;

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if let Some(v) = (b[i] == b'%').then(|| s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok())).flatten() {
            out.push(v);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Adds a file to the app's sermon folder: the file's bytes are the request body, its own
/// name (percent-encoded) the `x-file-name` header.
#[tauri::command]
pub async fn sermon_media_add(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<MediaFile, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("No file was received.".into());
    };
    if bytes.len() > MAX_BYTES {
        return Err("That file is larger than 1 GB. Add it as a link to where it is kept instead.".into());
    }
    let name = request.headers().get("x-file-name").and_then(|v| v.to_str().ok()).map(percent_decode).unwrap_or_default();
    let bytes = bytes.clone();
    let data = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || add(&data, &name, &bytes)).await.map_err(err)?
}

/// A kept file's bytes (to show a picture).
#[tauri::command]
pub async fn sermon_media_bytes(app: AppHandle, file: String) -> Result<tauri::ipc::Response, String> {
    let path = path_of(&data_dir(&app)?, &file)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || fs::read(path)).await.map_err(err)?.map_err(err)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Opens a kept file in the program Windows uses for it (a video player, a music player).
#[tauri::command]
pub fn sermon_media_open(app: AppHandle, file: String) -> Result<(), String> {
    let path = path_of(&data_dir(&app)?, &file)?;
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(err)
}

/// Where a kept file is on disk (for a slide's link to it).
#[tauri::command]
pub fn sermon_media_path(app: AppHandle, file: String) -> Result<String, String> {
    Ok(path_of(&data_dir(&app)?, &file)?.display().to_string())
}

// ---------------------------------------------------------------- the nature photos

pub const BACKGROUNDS_URL: &str = "https://github.com/BadBull22/bible/releases/download/backgrounds-v1/nature-backgrounds-v1.zip";
pub const BACKGROUNDS_SHA256: &str = "86917e58634e3f109f0f9fca1e010b81e51b1fd92ed940d1823a41f459aaef77";

fn backgrounds_dir(data: &Path) -> PathBuf {
    data.join("backgrounds")
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Background {
    pub id: String,
    pub theme: String,
    pub title: String,
    pub author: String,
    pub licence: String,
    pub source: String,
}

fn read_backgrounds(data: &Path) -> Result<Vec<Background>, String> {
    serde_json::from_str(&fs::read_to_string(backgrounds_dir(data).join("backgrounds.json")).map_err(err)?).map_err(err)
}

/// The nature photos, if downloaded (an empty list if not).
#[tauri::command]
pub fn sermon_backgrounds(app: AppHandle) -> Vec<Background> {
    data_dir(&app).ok().and_then(|d| read_backgrounds(&d).ok()).unwrap_or_default()
}

/// A nature photo's bytes (JPEG): its small picture, or the full one.
#[tauri::command]
pub async fn sermon_background_bytes(app: AppHandle, id: String, full: bool) -> Result<tauri::ipc::Response, String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("No such picture.".into());
    }
    let path = backgrounds_dir(&data_dir(&app)?).join(if full { "full" } else { "thumb" }).join(format!("{id}.jpg"));
    let bytes = tauri::async_runtime::spawn_blocking(move || fs::read(path)).await.map_err(err)?.map_err(|_| "That picture hasn't been downloaded.".to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Unpacks the photos' zip (checked against its SHA-256) into `backgrounds\`.
pub fn install_backgrounds(data: &Path, bytes: &[u8]) -> Result<usize, String> {
    let sum: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
    if sum != BACKGROUNDS_SHA256 {
        return Err("The download didn't arrive whole. Please try again.".into());
    }
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(err)?;
    let fresh = data.join("backgrounds.part");
    let _ = fs::remove_dir_all(&fresh);
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(err)?;
        let Some(name) = f.enclosed_name() else { continue };
        let out = fresh.join(name);
        if f.is_dir() {
            fs::create_dir_all(&out).map_err(err)?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(err)?;
        }
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).map_err(err)?;
        fs::write(&out, buf).map_err(err)?;
    }
    let _ = fs::remove_dir_all(backgrounds_dir(data));
    fs::rename(&fresh, backgrounds_dir(data)).map_err(err)?;
    Ok(read_backgrounds(data)?.len())
}

/// Downloads the nature photos (about 8 MB) once; emits "backgrounds-progress" (0-100).
#[tauri::command]
pub async fn sermon_backgrounds_download(app: AppHandle) -> Result<usize, String> {
    let client = reqwest::Client::builder().user_agent(crate::library_commands::USER_AGENT).timeout(std::time::Duration::from_secs(300)).build().map_err(err)?;
    let mut resp = client
        .get(BACKGROUNDS_URL)
        .send()
        .await
        .map_err(|_| "Couldn't download the pictures. Check the internet connection and try again.".to_string())?
        .error_for_status()
        .map_err(|e| format!("Couldn't download the pictures ({e})."))?;
    let total = resp.content_length().unwrap_or(0);
    let mut bytes = Vec::with_capacity(total as usize);
    let mut last = 0u8;
    while let Some(chunk) = resp.chunk().await.map_err(|_| "The download stopped before it was finished. Please try again.".to_string())? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > 64 << 20 {
            return Err("The download is larger than expected.".into());
        }
        if total > 0 {
            let pct = ((bytes.len() as u64 * 100) / total).min(100) as u8;
            if pct >= last + 5 {
                last = pct;
                let _ = app.emit("backgrounds-progress", pct);
            }
        }
    }
    let data = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || install_backgrounds(&data, &bytes)).await.map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn files_are_kept_once_under_safe_names() {
        let dir = std::env::temp_dir().join(format!("bc-media-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let a = add(&dir, "Sunrise over the lake.JPG", b"picture bytes").unwrap();
        assert!(a.file.ends_with(".jpg") && valid_name(&a.file), "{}", a.file);
        // the same bytes again: the same file
        assert_eq!(add(&dir, "copy.jpg", b"picture bytes").unwrap().file, a.file);
        assert_eq!(fs::read(path_of(&dir, &a.file).unwrap()).unwrap(), b"picture bytes");
        assert!(add(&dir, "no extension", b"x").unwrap().file.ends_with(".bin"));
        assert!(add(&dir, "weird.e!x", b"y").unwrap().file.ends_with(".bin"));
        for bad in ["../secret.txt", "..\\x", "a/b.jpg", "", ".hidden", "a.b.c"] {
            assert!(!valid_name(bad), "{bad}");
            assert!(path_of(&dir, bad).is_err());
        }
        assert!(path_of(&dir, "0000000000.jpg").is_err());
        assert!(install_backgrounds(&dir, b"not the zip").is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
