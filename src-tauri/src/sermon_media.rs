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
use std::io::{Read, Write};
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

/// Keeps a copy of a file that is on this computer (a looping background of tens of megabytes, say), copying it in
/// pieces so it is never all in memory; named by its contents, as `add` does.
pub fn import_file(data: &Path, source: &Path) -> Result<MediaFile, String> {
    let dir = media_dir(data);
    fs::create_dir_all(&dir).map_err(err)?;
    let mut input = fs::File::open(source).map_err(err)?;
    let tmp = dir.join(format!("import-{}.tmp", std::process::id()));
    let result = (|| -> Result<(String, u64), String> {
        let mut out = fs::File::create(&tmp).map_err(err)?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 1 << 20];
        let mut size = 0u64;
        loop {
            let n = input.read(&mut buf).map_err(err)?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            out.write_all(&buf[..n]).map_err(err)?;
            size += n as u64;
            if size > MAX_BYTES as u64 {
                return Err("That file is larger than 1 GB.".into());
            }
        }
        out.flush().map_err(err)?;
        Ok((hasher.finalize().iter().take(10).map(|b| format!("{b:02x}")).collect(), size))
    })();
    let (hash, size) = match result {
        Ok(v) => v,
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            return Err(e);
        }
    };
    let file = format!("{hash}.{}", extension(&source.to_string_lossy()));
    let dest = dir.join(&file);
    if dest.exists() {
        let _ = fs::remove_file(&tmp);
    } else {
        fs::rename(&tmp, &dest).map_err(err)?;
    }
    Ok(MediaFile { file, size })
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

pub(crate) fn percent_decode(s: &str) -> String {
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

// ---------------------------------------------------------------- the photo packs (nature photos, Christian pictures)

/// The nature photos: version 2 holds the first 100 (the same numbers) and more. Made by mobile/data/build_backgrounds.py, which also
/// prints the size and the SHA-256; the zip is the release `backgrounds-v2` (never marked latest). The phone uses the same file.
pub const BACKGROUNDS_URL: &str = "https://github.com/BadBull22/bible/releases/download/backgrounds-v2/nature-backgrounds-v2.zip";
pub const BACKGROUNDS_SHA256: &str = "ed2e3a9ae422172f2e4d94e7b33cb5e58d0a55b7e11529cf1b238311c61d688e";
/// How many photos the latest pack holds, and about how big it is (to offer "more photos" to someone who has the first 100).
pub const BACKGROUNDS_COUNT: usize = 331;
pub const BACKGROUNDS_MB: u32 = 36;

/// A pack of pictures to put behind words, downloaded once: where it comes from, its checksum, what it holds and where it is kept.
pub struct Pack {
    pub name: &'static str,
    /// the folder it is unpacked into, inside the app's data folder
    pub dir: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub count: usize,
    pub mb: u32,
    /// the event that reports how much has been downloaded (0-100)
    pub event: &'static str,
}

pub const NATURE: Pack = Pack { name: "nature", dir: "backgrounds", url: BACKGROUNDS_URL, sha256: BACKGROUNDS_SHA256, count: BACKGROUNDS_COUNT, mb: BACKGROUNDS_MB, event: "backgrounds-progress" };

/// The Christian pictures (crosses, prayer, worship, stained glass, the Bible, Christmas): 55 photographs the owner chose from Unsplash (the Unsplash
/// License: free for any use, no credit needed), kept apart from the nature photos so they can be left out or taken away on their own. Made by
/// mobile/data/build_christian_pack.py; the zip is the release `backgrounds-christian-v1` (never marked latest).
pub const CHRISTIAN: Pack = Pack {
    name: "christian",
    dir: "backgrounds-christian",
    url: "https://github.com/BadBull22/bible/releases/download/backgrounds-christian-v1/christian-pictures-v1.zip",
    sha256: "dbad4dc9af6b98b6140ca8f53f0fad52f89a536a91f6b0f9571b54d519901649",
    count: 55,
    mb: 12,
    event: "christian-progress",
};

/// The pack a page asks for by name (none: the nature photos).
fn pack_of(name: &Option<String>) -> Result<&'static Pack, String> {
    match name.as_deref() {
        None | Some("") | Some("nature") => Ok(&NATURE),
        Some("christian") => Ok(&CHRISTIAN),
        Some(_) => Err("No such pack of pictures.".into()),
    }
}

fn pack_dir(data: &Path, pack: &Pack) -> PathBuf {
    data.join(pack.dir)
}

fn backgrounds_dir(data: &Path) -> PathBuf {
    pack_dir(data, &NATURE)
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

fn read_pack(data: &Path, pack: &Pack) -> Result<Vec<Background>, String> {
    serde_json::from_str(&fs::read_to_string(pack_dir(data, pack).join("backgrounds.json")).map_err(err)?).map_err(err)
}

fn read_backgrounds(data: &Path) -> Result<Vec<Background>, String> {
    read_pack(data, &NATURE)
}

/// The photos of a pack, if downloaded (an empty list if not). With no pack named: the nature photos.
#[tauri::command]
pub fn sermon_backgrounds(app: AppHandle, pack: Option<String>) -> Vec<Background> {
    let Ok(p) = pack_of(&pack) else { return Vec::new() };
    data_dir(&app).ok().and_then(|d| read_pack(&d, p).ok()).unwrap_or_default()
}

/// How many photos the latest pack holds and how big the download is.
#[tauri::command]
pub fn sermon_backgrounds_info(pack: Option<String>) -> (usize, u32) {
    pack_of(&pack).map(|p| (p.count, p.mb)).unwrap_or((0, 0))
}

/// A photo's bytes (JPEG): its small picture, or the full one.
#[tauri::command]
pub async fn sermon_background_bytes(app: AppHandle, id: String, full: bool, pack: Option<String>) -> Result<tauri::ipc::Response, String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("No such picture.".into());
    }
    let p = pack_of(&pack)?;
    let path = pack_dir(&data_dir(&app)?, p).join(if full { "full" } else { "thumb" }).join(format!("{id}.jpg"));
    let bytes = tauri::async_runtime::spawn_blocking(move || fs::read(path)).await.map_err(err)?.map_err(|_| "That picture hasn't been downloaded.".to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Unpacks a pack's zip (checked against its SHA-256) into its own folder.
pub fn install_pack(data: &Path, bytes: &[u8], pack: &Pack) -> Result<usize, String> {
    let sum: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
    if sum != pack.sha256 {
        return Err("The download didn't arrive whole. Please try again.".into());
    }
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(err)?;
    let fresh = data.join(format!("{}.part", pack.dir));
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
    let _ = fs::remove_dir_all(pack_dir(data, pack));
    fs::rename(&fresh, pack_dir(data, pack)).map_err(err)?;
    Ok(read_pack(data, pack)?.len())
}

/// Unpacks the nature photos' zip.
pub fn install_backgrounds(data: &Path, bytes: &[u8]) -> Result<usize, String> {
    install_pack(data, bytes, &NATURE)
}

/// Downloads a pack of photos once (the nature photos, or the Christian pictures); emits the pack's progress event (0-100).
#[tauri::command]
pub async fn sermon_backgrounds_download(app: AppHandle, pack: Option<String>) -> Result<usize, String> {
    let p = pack_of(&pack)?;
    let client = reqwest::Client::builder().user_agent(crate::library_commands::USER_AGENT).timeout(std::time::Duration::from_secs(300)).build().map_err(err)?;
    let mut resp = client
        .get(p.url)
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
                let _ = app.emit(p.event, pct);
            }
        }
    }
    let data = data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || install_pack(&data, &bytes, p)).await.map_err(err)?
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

    /// The real pack, from a file on this computer: `BACKGROUNDS_ZIP=<path to nature-backgrounds-v2.zip> cargo test --lib real_nature_pack -- --ignored`.
    /// Checks that the pack's checksum is the one in the code, that it unpacks, and that it holds the number of photos the code says.
    #[test]
    #[ignore]
    fn real_nature_pack_installs() {
        let Ok(path) = std::env::var("BACKGROUNDS_ZIP") else { panic!("set BACKGROUNDS_ZIP to the pack's path") };
        let bytes = fs::read(path).unwrap();
        let dir = std::env::temp_dir().join(format!("bc-pack-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let n = install_backgrounds(&dir, &bytes).unwrap();
        assert_eq!(n, BACKGROUNDS_COUNT);
        let list = read_backgrounds(&dir).unwrap();
        assert!(list.iter().all(|b| b.licence.to_lowercase().starts_with("cc0") && backgrounds_dir(&dir).join("full").join(format!("{}.jpg", b.id)).is_file() && backgrounds_dir(&dir).join("thumb").join(format!("{}.jpg", b.id)).is_file()));
        let _ = fs::remove_dir_all(&dir);
    }

    /// The real Christian pictures pack: `CHRISTIAN_ZIP=<path to christian-pictures-v1.zip> cargo test --lib real_christian_pack -- --ignored`.
    #[test]
    #[ignore]
    fn real_christian_pack_installs() {
        let Ok(path) = std::env::var("CHRISTIAN_ZIP") else { panic!("set CHRISTIAN_ZIP to the pack's path") };
        let bytes = fs::read(path).unwrap();
        let dir = std::env::temp_dir().join(format!("bc-christian-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(install_pack(&dir, &bytes, &CHRISTIAN).unwrap(), CHRISTIAN.count);
        let list = read_pack(&dir, &CHRISTIAN).unwrap();
        assert!(list.iter().all(|b| b.licence == "Unsplash License" && b.source.starts_with("https://unsplash.com/photos/") && pack_dir(&dir, &CHRISTIAN).join("full").join(format!("{}.jpg", b.id)).is_file() && pack_dir(&dir, &CHRISTIAN).join("thumb").join(format!("{}.jpg", b.id)).is_file()));
        // the nature photos are a different folder and a different checksum
        assert!(install_pack(&dir, &bytes, &NATURE).is_err());
        assert!(!pack_dir(&dir, &NATURE).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_pack_is_found_by_name() {
        assert_eq!(pack_of(&None).unwrap().name, "nature");
        assert_eq!(pack_of(&Some("christian".into())).unwrap().dir, "backgrounds-christian");
        assert!(pack_of(&Some("../x".into())).is_err());
        assert_ne!(NATURE.dir, CHRISTIAN.dir);
    }
}
