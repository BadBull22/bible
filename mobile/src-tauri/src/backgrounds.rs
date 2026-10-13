//! Nature photos to put a verse on (since 0.3.0): 100 public-domain / CC0 photos from
//! Wikimedia Commons (lakes, mountains, the sea, sunrises, animals, ...), downloaded once
//! from the app's GitHub releases and kept in the app's data folder. Made by
//! `data/build_backgrounds.py`; the zip holds `backgrounds.json`, `full/<id>.jpg` and
//! `thumb/<id>.jpg`.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

/// Where the backgrounds are downloaded from, and the SHA-256 the file must have.
pub const URL: &str = "https://github.com/BadBull22/bible/releases/download/backgrounds-v1/nature-backgrounds-v1.zip";
pub const SHA256: &str = "86917e58634e3f109f0f9fca1e010b81e51b1fd92ed940d1823a41f459aaef77";
/// About how big the download is, for the button.
pub const SIZE_MB: u32 = 8;

fn folder(data: &Path) -> PathBuf {
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

#[derive(Serialize, Debug)]
pub struct Thumb {
    pub id: String,
    pub theme: String,
    /// JPEG, base64
    pub thumb: String,
}

fn read_list(data: &Path) -> Result<Vec<Background>, String> {
    let text = fs::read_to_string(folder(data).join("backgrounds.json")).map_err(err)?;
    serde_json::from_str(&text).map_err(err)
}

/// How many backgrounds are here (0: not downloaded).
pub fn count(data: &Path) -> usize {
    read_list(data).map(|l| l.len()).unwrap_or(0)
}

/// The backgrounds with small pictures for choosing.
pub fn thumbs(data: &Path) -> Result<Vec<Thumb>, String> {
    let dir = folder(data);
    let b64 = base64::engine::general_purpose::STANDARD;
    Ok(read_list(data)?
        .into_iter()
        .filter_map(|b| fs::read(dir.join("thumb").join(format!("{}.jpg", b.id))).ok().map(|bytes| Thumb { id: b.id, theme: b.theme, thumb: b64.encode(bytes) }))
        .collect())
}

/// One background, full size (JPEG, base64), with where it is from.
pub fn image(data: &Path, id: &str) -> Result<(String, Background), String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("No such background.".into());
    }
    let info = read_list(data)?.into_iter().find(|b| b.id == id).ok_or("No such background.")?;
    let bytes = fs::read(folder(data).join("full").join(format!("{id}.jpg"))).map_err(err)?;
    Ok((base64::engine::general_purpose::STANDARD.encode(bytes), info))
}

/// Downloads the backgrounds and unpacks them; `progress` is told the percentage downloaded.
pub fn install(data: &Path, progress: &dyn Fn(u8)) -> Result<usize, String> {
    let response = ureq::get(URL)
        .set("User-Agent", "BibleConcordance-Android/0.3 (https://bible4me.org)")
        .timeout(std::time::Duration::from_secs(300))
        .call()
        .map_err(|_| "Couldn't download the backgrounds. Check the phone's internet connection and try again.".to_string())?;
    let total: Option<usize> = response.header("Content-Length").and_then(|v| v.parse().ok());
    let mut bytes = Vec::with_capacity(total.unwrap_or(8 << 20));
    let mut reader = response.into_reader().take(64 << 20);
    let mut chunk = [0u8; 64 * 1024];
    let mut last = 0u8;
    loop {
        let n = reader.read(&mut chunk).map_err(|_| "The download stopped before it was finished. Please try again.".to_string())?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..n]);
        if let Some(t) = total.filter(|&t| t > 0) {
            let pct = ((bytes.len() * 100) / t).min(100) as u8;
            if pct != last {
                last = pct;
                progress(pct);
            }
        }
    }
    let sum = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect::<String>();
    if sum != SHA256 {
        return Err("The download didn't arrive whole. Please try again.".into());
    }
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(err)?;
    // unpacked beside the old copy, then swapped in
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
    let _ = fs::remove_dir_all(folder(data));
    fs::rename(&fresh, folder(data)).map_err(err)?;
    Ok(count(data))
}

pub fn remove(data: &Path) -> Result<(), String> {
    match fs::remove_dir_all(folder(data)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(err(e)),
        _ => Ok(()),
    }
}
