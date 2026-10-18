//! The Advanced search upgrade (offline, since 2.9.3): finding verses by what a search means,
//! as the desktop app does (`bible_core::meaning`). Downloaded once from the app's GitHub
//! releases (made by the desktop's `make_search_pack`), kept in the data folder, and opened
//! once a run: on start if it is there, or when it has just been downloaded.

use std::path::Path;
use std::sync::{Arc, Mutex};

use bible_core::meaning::Meaning;

/// Where the upgrade is downloaded from, and the SHA-256 the file must have.
pub const URL: &str = "https://github.com/BadBull22/bible/releases/download/search-pack-v1/advanced-search-v1.zip";
pub const SHA256: &str = "48c9fcff0531b6a8a23b64b0e06a5d000ad382710ff9215ed0d05975ca8abdb9";
/// About how big the download is, for the button.
pub const SIZE_MB: u32 = 31;
const FOLDER: &str = "advanced-search";

static OPENED: Mutex<Option<Arc<Meaning>>> = Mutex::new(None);

/// Whether the upgrade has been downloaded.
pub fn installed(data: &Path) -> bool {
    data.join(FOLDER).join("index.json").exists()
}

/// The upgrade, opened (the first time takes a second or so); None if it isn't downloaded or
/// can't be read.
pub fn get(data: &Path) -> Option<Arc<Meaning>> {
    let mut opened = OPENED.lock().ok()?;
    if opened.is_none() && installed(data) {
        *opened = Meaning::load(&data.join(FOLDER)).ok().map(Arc::new);
    }
    opened.clone()
}

/// Downloads and opens the upgrade; `progress` is told the percentage downloaded.
pub fn install(data: &Path, progress: &dyn Fn(u8)) -> Result<(), String> {
    crate::packs::install(data, URL, SHA256, FOLDER, 64, progress)?;
    if let Ok(mut opened) = OPENED.lock() {
        *opened = None;
    }
    get(data).map(|_| ()).ok_or_else(|| "The search upgrade was downloaded but couldn't be opened. Please try again.".into())
}

pub fn remove(data: &Path) -> Result<(), String> {
    if let Ok(mut opened) = OPENED.lock() {
        *opened = None;
    }
    crate::packs::remove(data, FOLDER)
}
