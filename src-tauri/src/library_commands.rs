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

/// The repositories the Library can browse.
#[tauri::command]
pub fn library_sources() -> Vec<library::Source> {
    library::SOURCES.to_vec()
}

/// One source's catalogue of modules, cached for a week in the library folder so browsing
/// works offline; `refresh` fetches it again. Falls back to the cached copy if the download
/// fails. `source` defaults to CrossWire's main library.
#[tauri::command]
pub async fn library_catalog(state: State<'_, LibraryState>, refresh: bool, source: Option<String>) -> Result<Vec<CatalogItem>, String> {
    let source = library::source(source.as_deref().unwrap_or("crosswire")).ok_or("unknown library source")?;
    let cache = library::catalog_cache(&state.dir, source);
    let fresh = std::fs::metadata(&cache)
        .and_then(|m| m.modified())
        .map(|t| SystemTime::now().duration_since(t).unwrap_or_default() < CATALOG_MAX_AGE)
        .unwrap_or(false);
    let mut bytes = None;
    if refresh || !fresh {
        match async { http()?.get(source.catalog_url).send().await.map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?.bytes().await.map_err(|e| e.to_string()) }.await {
            Ok(b) => {
                let _ = std::fs::write(&cache, &b);
                bytes = Some(b.to_vec());
            }
            Err(e) if !cache.is_file() => return Err(format!("Couldn't reach {} ({e}). Connect to the internet to see what's available.", source.name)),
            Err(_) => {}
        }
    }
    let bytes = match bytes {
        Some(b) => b,
        None => std::fs::read(&cache).map_err(|e| e.to_string())?,
    };
    let confs = library::parse_catalog(&bytes)?;
    library::catalog_items(&confs, &*lib_conn(&state)?, source.id)
}

/// Downloads one module (internet needed) and installs it into the library. Progress is
/// sent as "library-progress" events; "library-changed" fires when it's done.
#[tauri::command]
pub async fn library_install(app: AppHandle, name: String, source: Option<String>) -> Result<InstallReport, String> {
    if !library::valid_name(&name) {
        return Err("invalid module name".into());
    }
    let source = library::source(source.as_deref().unwrap_or("crosswire")).ok_or("unknown library source")?;
    {
        let state = app.state::<LibraryState>();
        let mut busy = state.busy.lock().map_err(|e| e.to_string())?;
        if !busy.insert(name.clone()) {
            return Err(format!("{name} is already being installed."));
        }
    }
    let result = install(&app, &name, source).await;
    if let Ok(mut busy) = app.state::<LibraryState>().busy.lock() {
        busy.remove(&name);
    }
    if result.is_ok() {
        let _ = app.emit("library-changed", &name);
    }
    result
}

async fn install(app: &AppHandle, name: &str, source: &'static library::Source) -> Result<InstallReport, String> {
    let emit = |stage: &str, pct: Option<u8>| {
        let _ = app.emit("library-progress", Progress { name, stage, pct });
    };
    emit("downloading", Some(0));
    let mut resp = http()?
        .get(format!("{}{name}.zip", source.zip_url))
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
        if bytes.len() > library::MAX_IMPORT_BYTES {
            return Err(format!("{name} is larger than 400 MB, which is too large for a module."));
        }
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
        library::install_zip(&state, &bytes, &name2, source.id, &progress)
    })
    .await
    .map_err(|e| e.to_string())?
}

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

/// "Add from file", step 1: checks a module zip the reader chose (sent as the raw request
/// body) and reports what it holds. Nothing is installed yet.
#[tauri::command]
pub async fn library_import_check(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<InstallReport, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("No file was received.".into());
    };
    let bytes = bytes.clone();
    // the file's own name, percent-encoded by the page (used as a title if the book has none)
    let name = request.headers().get("x-file-name").and_then(|v| v.to_str().ok()).map(percent_decode).filter(|n| !n.is_empty());
    tauri::async_runtime::spawn_blocking(move || library::import_check(&app.state::<LibraryState>(), &bytes, name.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

/// "Add from file", step 2: installs the file that was just checked.
#[tauri::command]
pub async fn library_import_install(app: AppHandle) -> Result<InstallReport, String> {
    let app2 = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || library::import_install(&app2.state::<LibraryState>(), &|_| {}))
        .await
        .map_err(|e| e.to_string())?;
    if let Ok(r) = &result {
        let _ = app.emit("library-changed", &r.name);
    }
    result
}

#[tauri::command]
pub fn library_import_cancel(state: State<LibraryState>) {
    library::import_cancel(&state);
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

/// The books beyond the 66 (the Apocrypha) in an installed Bible: (name, chapters).
#[tauri::command]
pub fn library_extra_books(state: State<LibraryState>, version: String) -> Result<Vec<(String, i64)>, String> {
    library::extra_books(&*lib_conn(&state)?, &version)
}

/// Where printed page `page` of a book added from a PDF starts: (section id, page found).
#[tauri::command]
pub fn library_book_page(state: State<LibraryState>, name: String, page: i64) -> Result<Option<(i64, i64)>, String> {
    library::book_page(&*lib_conn(&state)?, &name, page)
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
