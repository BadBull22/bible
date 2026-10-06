//! Bible pictures: public-domain and openly licensed Bible art from Wikimedia Commons
//! (Doré, Tissot, Sweet Publishing, ...), each picture linked to its passage. The app ships
//! only the catalogue (resources/pictures.json, built by data-pipeline/pictures_build.py);
//! the user chooses which collections to download (internet needed only then) into the
//! per-user data folder, and from then on pictures show offline beside the chapter they
//! illustrate.
//!
//! Downloads are deliberately gentle on Wikimedia's servers (their robot policy): one file
//! at a time, a short pause between files, a User-Agent with a contact URL, and Retry-After
//! honoured on HTTP 429. Each picture is a ~1280 px rendition, not the full-size original.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct Collection {
    pub key: String,
    pub title: String,
    pub artist: String,
    pub year: String,
    pub licence: String,
    pub licence_url: String,
    pub about: String,
    pub count: usize,
    pub approx_mb: u32,
}

/// (book, chapter, first verse, last verse)
pub type PicRef = (String, i64, Option<i64>, Option<i64>);

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct Picture {
    pub id: String,
    pub c: String,
    pub title: String,
    #[serde(default)]
    pub caption: String,
    #[serde(default)]
    pub refs: Vec<PicRef>,
    pub url: String,
    pub w: u32,
    pub h: u32,
    pub page: String,
    #[serde(default)]
    pub credit: String,
}

#[derive(Deserialize, Default)]
pub struct Catalog {
    pub collections: Vec<Collection>,
    pub pictures: Vec<Picture>,
}

pub struct PicturesState {
    pub catalog: Catalog,
    pub dir: PathBuf,
    /// collections downloading now -> their cancel flag
    pub running: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

pub fn load(catalog_path: &Path, data_dir: &Path) -> PicturesState {
    // A missing or unreadable catalogue just means no pictures are offered.
    let catalog = std::fs::read(catalog_path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    PicturesState { catalog, dir: data_dir.join("pictures"), running: Mutex::new(HashMap::new()) }
}

fn file_for(dir: &Path, p: &Picture) -> PathBuf {
    let ext = if p.url.to_lowercase().ends_with(".png") { "png" } else { "jpg" };
    dir.join(&p.c).join(format!("{}.{ext}", p.id))
}

fn downloaded(dir: &Path, p: &Picture) -> bool {
    file_for(dir, p).is_file()
}

#[derive(Serialize, Clone)]
pub struct CollectionStatus {
    #[serde(flatten)]
    pub collection: Collection,
    pub downloaded: usize,
    pub downloading: bool,
}

#[tauri::command]
pub fn pictures_collections(state: State<PicturesState>) -> Vec<CollectionStatus> {
    let running = state.running.lock().map(|r| r.keys().cloned().collect::<Vec<_>>()).unwrap_or_default();
    state
        .catalog
        .collections
        .iter()
        .map(|c| CollectionStatus {
            downloaded: state.catalog.pictures.iter().filter(|p| p.c == c.key && downloaded(&state.dir, p)).count(),
            downloading: running.contains(&c.key),
            collection: c.clone(),
        })
        .collect()
}

#[derive(Serialize, Clone)]
pub struct PictureInfo {
    #[serde(flatten)]
    pub picture: Picture,
    pub collection_title: String,
    pub artist: String,
    pub licence: String,
    pub licence_url: String,
    pub downloaded: bool,
}

fn info(state: &PicturesState, p: &Picture) -> PictureInfo {
    let c = state.catalog.collections.iter().find(|c| c.key == p.c);
    PictureInfo {
        picture: p.clone(),
        collection_title: c.map(|c| c.title.clone()).unwrap_or_default(),
        artist: c.map(|c| c.artist.clone()).unwrap_or_default(),
        licence: c.map(|c| c.licence.clone()).unwrap_or_default(),
        licence_url: c.map(|c| c.licence_url.clone()).unwrap_or_default(),
        downloaded: downloaded(&state.dir, p),
    }
}

#[derive(Serialize, Clone)]
pub struct ChapterPictures {
    /// downloaded pictures of this chapter, in verse order
    pub pictures: Vec<PictureInfo>,
    /// pictures of this chapter in collections not (fully) downloaded, per collection title
    pub available: Vec<(String, usize)>,
}

#[tauri::command]
pub fn pictures_for_chapter(state: State<PicturesState>, book: String, chapter: i64) -> ChapterPictures {
    let mut pictures = Vec::new();
    let mut available: HashMap<String, usize> = HashMap::new();
    let mut matching: Vec<(&Picture, i64)> = state
        .catalog
        .pictures
        .iter()
        .filter_map(|p| p.refs.iter().find(|r| r.0 == book && r.1 == chapter).map(|r| (p, r.2.unwrap_or(0))))
        .collect();
    matching.sort_by_key(|(_, v)| *v);
    for (p, _) in matching {
        if downloaded(&state.dir, p) {
            pictures.push(info(&state, p));
        } else {
            let title = state.catalog.collections.iter().find(|c| c.key == p.c).map(|c| c.title.clone()).unwrap_or_else(|| p.c.clone());
            *available.entry(title).or_default() += 1;
        }
    }
    let mut available: Vec<(String, usize)> = available.into_iter().collect();
    available.sort();
    ChapterPictures { pictures, available }
}

/// One page of a collection for the gallery (downloaded pictures only), in catalogue order.
#[tauri::command]
pub fn pictures_gallery(state: State<PicturesState>, collection: String, offset: usize, limit: usize) -> (Vec<PictureInfo>, usize) {
    let all: Vec<&Picture> = state.catalog.pictures.iter().filter(|p| p.c == collection && downloaded(&state.dir, p)).collect();
    let total = all.len();
    (all.into_iter().skip(offset).take(limit).map(|p| info(&state, p)).collect(), total)
}

/// The picture file's bytes (shown via a blob URL in the page).
#[tauri::command]
pub fn picture_bytes(state: State<PicturesState>, id: String) -> Result<tauri::ipc::Response, String> {
    let p = state.catalog.pictures.iter().find(|p| p.id == id).ok_or("unknown picture")?;
    let bytes = std::fs::read(file_for(&state.dir, p)).map_err(|_| "This picture hasn't been downloaded.".to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[derive(Serialize, Clone)]
struct DownloadProgress<'a> {
    collection: &'a str,
    done: usize,
    total: usize,
    failed: usize,
}

/// Downloads every not-yet-downloaded picture of a collection, one at a time; emits
/// "pictures-progress" and finally "pictures-changed". Stopping (pictures_cancel) keeps
/// what's done, so it resumes where it left off next time.
#[tauri::command]
pub async fn pictures_download(app: AppHandle, collection: String) -> Result<usize, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    let todo: Vec<Picture> = {
        let state = app.state::<PicturesState>();
        let mut running = state.running.lock().map_err(|e| e.to_string())?;
        if running.contains_key(&collection) {
            return Err("This collection is already downloading.".into());
        }
        running.insert(collection.clone(), cancel.clone());
        state.catalog.pictures.iter().filter(|p| p.c == collection && !downloaded(&state.dir, p)).cloned().collect()
    };
    let result = download_all(&app, &collection, &todo, &cancel).await;
    if let Ok(mut running) = app.state::<PicturesState>().running.lock() {
        running.remove(&collection);
    }
    let _ = app.emit("pictures-changed", &collection);
    result
}

async fn download_all(app: &AppHandle, collection: &str, todo: &[Picture], cancel: &AtomicBool) -> Result<usize, String> {
    let dir = app.state::<PicturesState>().dir.clone();
    let client = reqwest::Client::builder()
        .user_agent(crate::library_commands::USER_AGENT)
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let (mut done, mut failed) = (0usize, 0usize);
    let total = todo.len();
    let _ = app.emit("pictures-progress", DownloadProgress { collection, done, total, failed });
    for p in todo {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let path = file_for(&dir, p);
        let mut ok = false;
        for _attempt in 0..4 {
            match client.get(&p.url).send().await {
                Ok(r) if r.status().as_u16() == 429 || r.status().is_server_error() => {
                    let wait = r.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|s| s.parse().ok()).unwrap_or(30u64);
                    tokio::time::sleep(Duration::from_secs(wait.min(120))).await;
                }
                Ok(r) if r.status().is_success() => {
                    if let Ok(bytes) = r.bytes().await {
                        if let Some(parent) = path.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        let tmp = path.with_extension("part");
                        if std::fs::write(&tmp, &bytes).is_ok() && std::fs::rename(&tmp, &path).is_ok() {
                            ok = true;
                        }
                    }
                    break;
                }
                Ok(_) => break, // 404 etc.: skip this picture
                Err(_) => tokio::time::sleep(Duration::from_secs(5)).await,
            }
        }
        if ok {
            done += 1;
        } else {
            failed += 1;
        }
        let _ = app.emit("pictures-progress", DownloadProgress { collection, done, total, failed });
        tokio::time::sleep(Duration::from_millis(400)).await; // be gentle
    }
    Ok(done)
}

#[tauri::command]
pub fn pictures_cancel(state: State<PicturesState>, collection: String) {
    if let Ok(running) = state.running.lock() {
        if let Some(flag) = running.get(&collection) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
pub fn pictures_remove(app: AppHandle, state: State<PicturesState>, collection: String) -> Result<(), String> {
    if state.running.lock().map(|r| r.contains_key(&collection)).unwrap_or(false) {
        return Err("Stop the download first.".into());
    }
    if !collection.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("invalid collection".into());
    }
    let dir = state.dir.join(&collection);
    if dir.is_dir() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    let _ = app.emit("pictures-changed", &collection);
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_catalogue_loads_and_links_chapters() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("pictures.json");
        let state = load(&path, &std::env::temp_dir().join("bc-pictures-test-nothing-downloaded"));
        if state.catalog.pictures.is_empty() {
            return; // an empty placeholder catalogue (before data-pipeline/pictures_build.py ran)
        }
        assert!(state.catalog.collections.len() >= 3);
        for c in &state.catalog.collections {
            let n = state.catalog.pictures.iter().filter(|p| p.c == c.key).count();
            assert_eq!(n, c.count, "{}", c.key);
        }
        // every reference names a real book and a positive chapter
        for p in &state.catalog.pictures {
            for r in &p.refs {
                assert!(r.1 > 0 && !r.0.is_empty(), "{}", p.id);
            }
            assert!(p.url.starts_with("https://") && p.url.split('/').nth(2).is_some_and(|h| h.ends_with(".wikimedia.org")), "{}", p.url);
        }
        let gen1 = state.catalog.pictures.iter().filter(|p| p.refs.iter().any(|r| r.0 == "Genesis" && r.1 == 1)).count();
        assert!(gen1 > 0, "Genesis 1 should have pictures");
        // nothing is downloaded in the empty folder
        assert!(state.catalog.pictures.iter().all(|p| !downloaded(&state.dir, p)));
    }
}
