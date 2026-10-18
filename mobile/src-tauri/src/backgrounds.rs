//! Nature photos to put a verse on (since 0.3.0): 100 public-domain / CC0 photos from
//! Wikimedia Commons (lakes, mountains, the sea, sunrises, animals, ...), downloaded once
//! from the app's GitHub releases and kept in the app's data folder. Made by
//! `data/build_backgrounds.py`; the zip holds `backgrounds.json`, `full/<id>.jpg` and
//! `thumb/<id>.jpg`.

use std::fs;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::{Deserialize, Serialize};

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
    crate::packs::install(data, URL, SHA256, "backgrounds", 64, progress)?;
    Ok(count(data))
}

pub fn remove(data: &Path) -> Result<(), String> {
    crate::packs::remove(data, "backgrounds")
}
