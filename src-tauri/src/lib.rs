mod commands;
mod commentaries;
mod db;
pub mod embeddings;
mod firsts;
mod genealogy;
mod models;
mod online;
mod settings;

use db::DbState;
use embeddings::Embedder;
use firsts::FirstsData;
use genealogy::GenealogyData;
use settings::AppSettings;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Emitter, Manager, WindowEvent};

/// Set once the close button has been pressed, so the farewell splash is only triggered
/// once no matter how many times the button is hit.
static CLOSING: AtomicBool = AtomicBool::new(false);

/// How long the frontend gets to show the farewell verse and call `exit_app` before the
/// process leaves anyway. A watchdog matters here because the close button is *prevented*
/// from working: if the frontend never answered (a JS error, a missing event permission),
/// without this the window would refuse to close at all.
const CLOSE_WATCHDOG: std::time::Duration = std::time::Duration::from_secs(6);

pub struct ConfigDir(pub PathBuf);
pub struct SettingsState(pub Mutex<AppSettings>);
pub struct EmbedderState(pub Embedder);
pub struct GenealogyState(pub GenealogyData);
pub struct FirstsState(pub FirstsData);

/// Registers the sqlite-vec extension for every connection subsequently opened in this
/// process (rusqlite's `sqlite3_auto_extension` is process-global, not per-connection).
/// Must be called once, before any connection that needs the `vec0` virtual table type
/// is opened -- both the app itself and the offline corpus-indexing tool call this.
pub fn register_sqlite_vec() {
    unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite_vec::sqlite3_vec_init as *const (),
        )));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    register_sqlite_vec();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Second press skips the farewell and leaves immediately: returning here
                // without calling prevent_close() lets the close proceed normally.
                if CLOSING.swap(true, Ordering::SeqCst) {
                    return;
                }
                api.prevent_close();
                // Emitted from the AppHandle, not from `window`. A Window-scoped emit does
                // not reach the webview's JS `listen()`, which is what left the farewell
                // splash never showing and the 6s watchdog doing the closing instead
                // (measured: the process lived exactly 6020ms and no verse appeared).
                let app = window.app_handle().clone();
                let _ = app.emit("app-close-requested", ());
                std::thread::spawn(move || {
                    std::thread::sleep(CLOSE_WATCHDOG);
                    app.exit(0);
                });
            }
        })
        .setup(|app| {
            let resource_path = app
                .path()
                .resolve("resources/bible.db", tauri::path::BaseDirectory::Resource)
                .expect("failed to resolve bible.db resource path");
            let conn = db::open(resource_path);
            app.manage(DbState(Mutex::new(conn)));

            let config_dir = app.path().app_config_dir().expect("no app config dir");
            let loaded = settings::load(&config_dir);
            app.manage(ConfigDir(config_dir));
            app.manage(SettingsState(Mutex::new(loaded)));

            let model_dir = app
                .path()
                .resolve("resources/model", tauri::path::BaseDirectory::Resource)
                .expect("failed to resolve embedding model resource path");
            let embedder = Embedder::load(&model_dir).expect("failed to load embedding model");
            app.manage(EmbedderState(embedder));

            let genealogy_path = app
                .path()
                .resolve("resources/genealogies.json", tauri::path::BaseDirectory::Resource)
                .expect("failed to resolve genealogies.json resource path");
            let genealogy = GenealogyData::load(&genealogy_path).expect("failed to load genealogies.json");
            app.manage(GenealogyState(genealogy));

            let firsts_path = app
                .path()
                .resolve("resources/firsts.json", tauri::path::BaseDirectory::Resource)
                .expect("failed to resolve firsts.json resource path");
            let firsts = FirstsData::load(&firsts_path).expect("failed to load firsts.json");
            app.manage(FirstsState(firsts));

            // Optional: the app still runs without commentaries.db (commands report it missing).
            let commentaries_path = app
                .path()
                .resolve("resources/commentaries.db", tauri::path::BaseDirectory::Resource)
                .expect("failed to resolve commentaries.db resource path");
            app.manage(commentaries::CommentaryState(commentaries::open(&commentaries_path)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_versions,
            commands::list_books,
            commands::chapter_counts,
            commands::get_chapter,
            commands::get_chapter_with_strongs,
            commands::get_parallel_verse,
            commands::get_verse_with_strongs,
            commands::strongs_lookup,
            commands::strongs_occurrences,
            commands::search_keyword,
            commands::word_frequency,
            commands::cross_references_for,
            commands::get_settings,
            commands::save_api_bible_key,
            commands::save_esv_api_key,
            commands::list_online_versions,
            commands::fetch_online_verse,
            commands::semantic_search,
            commands::list_genealogy_people,
            commands::get_lineage,
            commands::timeline_data,
            commands::list_firsts,
            commands::search_firsts,
            commands::list_commentaries,
            commands::get_commentary_chapter,
            commands::search_commentaries,
            commands::chapter_entities,
            commands::get_entity,
            commands::search_entities,
            commands::map_places,
            commands::exit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
