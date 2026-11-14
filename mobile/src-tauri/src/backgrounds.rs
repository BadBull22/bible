//! Nature photos to put a verse on (since 0.3.0; version 2 has more): public-domain / CC0 photos from
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

/// One pack of photos to put a verse on: where it is downloaded from, the SHA-256 the file must have, and the folder it is kept in. The same files as the
/// computer's (the releases `backgrounds-v2` and `backgrounds-christian-v1`); each zip holds `backgrounds.json`, `full/<id>.jpg` and `thumb/<id>.jpg`.
pub struct Pack {
    /// the name the page uses: "nature" or "christian"
    pub name: &'static str,
    pub dir: &'static str,
    /// the release the zip is on, and the zip's file name
    pub release: &'static str,
    pub file: &'static str,
    pub sha256: &'static str,
    /// about how big the download is, for the button
    pub size_mb: u32,
    /// how many photos the latest pack holds (someone with the first 100 nature photos is offered the rest)
    pub count: usize,
    /// the event that reports the download's percentage
    pub event: &'static str,
}

pub const NATURE: Pack = Pack {
    name: "nature",
    dir: "backgrounds",
    release: "backgrounds-v2",
    file: "nature-backgrounds-v2.zip",
    sha256: "ed2e3a9ae422172f2e4d94e7b33cb5e58d0a55b7e11529cf1b238311c61d688e",
    size_mb: 36,
    count: 331,
    event: "backgrounds-progress",
};

/// 55 Christian pictures (crosses, prayer, worship, stained glass, the Bible, communion, Christmas): Unsplash photographs, used under the Unsplash License.
pub const CHRISTIAN: Pack = Pack {
    name: "christian",
    dir: "backgrounds-christian",
    release: "backgrounds-christian-v1",
    file: "christian-pictures-v1.zip",
    sha256: "dbad4dc9af6b98b6140ca8f53f0fad52f89a536a91f6b0f9571b54d519901649",
    size_mb: 12,
    count: 55,
    event: "backgrounds-progress-christian",
};

impl Pack {
    /// Where the zip is downloaded from: the app's GitHub release. A build made for testing can point somewhere else (`BC_BACKGROUNDS_BASE=http://host:port/` when
    /// it is compiled, the zips' file names after it); a release build never does.
    pub fn url(&self) -> String {
        match option_env!("BC_BACKGROUNDS_BASE") {
            Some(base) => format!("{base}{}", self.file),
            None => format!("https://github.com/BadBull22/bible/releases/download/{}/{}", self.release, self.file),
        }
    }
}

/// The pack a page asked for (nothing asked: the nature photos, as before).
pub fn pack_of(name: Option<&str>) -> Result<&'static Pack, String> {
    match name {
        None | Some("nature") => Ok(&NATURE),
        Some("christian") => Ok(&CHRISTIAN),
        Some(_) => Err("No such set of pictures.".into()),
    }
}

fn folder(data: &Path, pack: &Pack) -> PathBuf {
    data.join(pack.dir)
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

fn read_list(data: &Path, pack: &Pack) -> Result<Vec<Background>, String> {
    let text = fs::read_to_string(folder(data, pack).join("backgrounds.json")).map_err(err)?;
    serde_json::from_str(&text).map_err(err)
}

/// How many backgrounds are here (0: not downloaded).
pub fn count(data: &Path, pack: &Pack) -> usize {
    read_list(data, pack).map(|l| l.len()).unwrap_or(0)
}

/// The backgrounds with small pictures for choosing.
pub fn thumbs(data: &Path, pack: &Pack) -> Result<Vec<Thumb>, String> {
    let dir = folder(data, pack);
    let b64 = base64::engine::general_purpose::STANDARD;
    Ok(read_list(data, pack)?
        .into_iter()
        .filter_map(|b| fs::read(dir.join("thumb").join(format!("{}.jpg", b.id))).ok().map(|bytes| Thumb { id: b.id, theme: b.theme, thumb: b64.encode(bytes) }))
        .collect())
}

/// One background, full size (JPEG, base64), with where it is from.
pub fn image(data: &Path, pack: &Pack, id: &str) -> Result<(String, Background), String> {
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("No such background.".into());
    }
    let info = read_list(data, pack)?.into_iter().find(|b| b.id == id).ok_or("No such background.")?;
    let bytes = fs::read(folder(data, pack).join("full").join(format!("{id}.jpg"))).map_err(err)?;
    Ok((base64::engine::general_purpose::STANDARD.encode(bytes), info))
}

/// Downloads the backgrounds and unpacks them; `progress` is told the percentage downloaded.
pub fn install(data: &Path, pack: &Pack, progress: &dyn Fn(u8)) -> Result<usize, String> {
    crate::packs::install(data, &pack.url(), pack.sha256, pack.dir, 64, progress)?;
    Ok(count(data, pack))
}

pub fn remove(data: &Path, pack: &Pack) -> Result<(), String> {
    crate::packs::remove(data, pack.dir)
}
