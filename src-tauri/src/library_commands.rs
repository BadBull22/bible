//! Tauri commands for the Library screen (browse / install / remove free CrossWire modules)
//! and the Books panel (read installed books and devotionals). Installed Bibles,
//! commentaries and dictionaries are served through the existing commands in commands.rs
//! and study_commands.rs, which merge them with the bundled texts.

use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::library::{self, BookHit, CatalogItem, InstallReport, InstalledModule, LibraryState, Section, TocEntry};

/// Identifies the app to CrossWire's server (a contact URL, never personal details).
pub const USER_AGENT: &str = "BibleConcordance/2.2 (https://github.com/BadBull22/bible)";
const CATALOG_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 3600);

fn lib_conn(state: &LibraryState) -> Result<std::sync::MutexGuard<'_, rusqlite::Connection>, String> {
    state.conn.lock().map_err(|e| e.to_string())
}

fn http() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().user_agent(USER_AGENT).timeout(Duration::from_secs(300)).build().map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
struct Progress<'a> {
    name: &'a str,
    /// "downloading" | "unpacking" | "reading" | "saving"
    stage: &'a str,
    /// download percentage, when known
    pct: Option<u8>,
}

/// The catalogue of modules, cached for a week in the library folder so browsing works
/// offline; `refresh` fetches it again. Falls back to the cached copy if the download fails.
#[tauri::command]
pub async fn library_catalog(state: State<'_, LibraryState>, refresh: bool) -> Result<Vec<CatalogItem>, String> {
    let cache = state.dir.join("mods.d.tar.gz");
    let fresh = std::fs::metadata(&cache)
        .and_then(|m| m.modified())
        .map(|t| SystemTime::now().duration_since(t).unwrap_or_default() < CATALOG_MAX_AGE)
        .unwrap_or(false);
    let mut bytes = None;
    if refresh || !fresh {
        match async { http()?.get(library::CATALOG_URL).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string()) }.await {
            Ok(b) => {
                let _ = std::fs::write(&cache, &b);
                bytes = Some(b.to_vec());
            }
            Err(e) if !cache.is_file() => return Err(format!("Couldn't reach the CrossWire library ({e}). Connect to the internet to see what's available.")),
            Err(_) => {}
        }
    }
    let bytes = match bytes {
        Some(b) => b,
        None => std::fs::read(&cache).map_err(|e| e.to_string())?,
    };
    let confs = library::parse_catalog(&bytes)?;
    library::catalog_items(&confs, &*lib_conn(&state)?)
}

/// Downloads one module (internet needed) and installs it into the library. Progress is
/// sent as "library-progress" events; "library-changed" fires when it's done.
#[tauri::command]
pub async fn library_install(app: AppHandle, name: String) -> Result<InstallReport, String> {
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') || name.is_empty() {
        return Err("invalid module name".into());
    }
    {
        let state = app.state::<LibraryState>();
        let mut busy = state.busy.lock().map_err(|e| e.to_string())?;
        if !busy.insert(name.clone()) {
            return Err(format!("{name} is already being installed."));
        }
    }
    let result = install(&app, &name).await;
    if let Ok(mut busy) = app.state::<LibraryState>().busy.lock() {
        busy.remove(&name);
    }
    if result.is_ok() {
        let _ = app.emit("library-changed", &name);
    }
    result
}

async fn install(app: &AppHandle, name: &str) -> Result<InstallReport, String> {
    let emit = |stage: &str, pct: Option<u8>| {
        let _ = app.emit("library-progress", Progress { name, stage, pct });
    };
    emit("downloading", Some(0));
    let mut resp = http()?
        .get(format!("{}{name}.zip", library::MODULE_URL))
        .send()
        .await
        .map_err(|e| format!("Couldn't download {name} ({e}). Check the internet connection."))?
        .error_for_status()
        .map_err(|e| format!("Couldn't download {name} ({e})."))?;
    let total = resp.content_length().unwrap_or(0);
    let mut bytes: Vec<u8> = Vec::with_capacity(total as usize);
    let mut last = 0u8;
    while let Some(chunk) = resp.chunk().await.map_err(|e| format!("Download interrupted ({e}).") )? {
        bytes.extend_from_slice(&chunk);
        if total > 0 {
            let pct = ((bytes.len() as u64 * 100) / total).min(100) as u8;
            if pct >= last + 5 {
                last = pct;
                emit("downloading", Some(pct));
            }
        }
    }
    let app2 = app.clone();
    let name2 = name.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app2.state::<LibraryState>();
        let progress = |stage: &str| {
            let _ = app2.emit("library-progress", Progress { name: &name2, stage, pct: None });
        };
        library::install_zip(&state, &bytes, &name2, &progress)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn library_remove(app: AppHandle, state: State<LibraryState>, name: String) -> Result<(), String> {
    library::remove(&mut *lib_conn(&state)?, &name)?;
    let _ = app.emit("library-changed", &name);
    Ok(())
}

#[tauri::command]
pub fn library_installed(state: State<LibraryState>, kind: Option<String>) -> Result<Vec<InstalledModule>, String> {
    library::installed(&*lib_conn(&state)?, kind.as_deref())
}

#[tauri::command]
pub fn library_toc(state: State<LibraryState>, name: String) -> Result<Vec<TocEntry>, String> {
    library::toc(&*lib_conn(&state)?, &name)
}

#[tauri::command]
pub fn library_section(state: State<LibraryState>, id: i64) -> Result<Option<Section>, String> {
    library::section(&*lib_conn(&state)?, id)
}

/// Entries for a Strong's number in installed Library lexicons (for Word Study).
#[tauri::command]
pub fn library_lexicon_entries(state: State<LibraryState>, strongs: String) -> Result<Vec<crate::study::DictionaryEntry>, String> {
    library::lexicon_entries(&*lib_conn(&state)?, &strongs)
}

#[tauri::command]
pub fn library_search_books(state: State<LibraryState>, query: String, name: Option<String>, limit: i64) -> Result<Vec<BookHit>, String> {
    library::search_books(&*lib_conn(&state)?, &query, name.as_deref(), limit)
}
