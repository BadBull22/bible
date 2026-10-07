mod commands;
mod commentaries;
mod db;
pub mod embeddings;
pub mod firsts;
mod genealogy;
pub mod library;
mod library_commands;
mod logging;
mod pictures;
mod original_search;
mod models;
mod online;
pub mod qa;
mod qa_parser;
mod settings;
mod sheet;
mod study;
mod study_commands;
mod update;
mod userdata;
mod voice;

use db::DbState;
use embeddings::Embedder;
use firsts::FirstsData;
use genealogy::GenealogyData;
use settings::AppSettings;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

pub struct ConfigDir(pub PathBuf);
pub struct SettingsState(pub Mutex<AppSettings>);
pub struct EmbedderState(pub Embedder);
pub struct GenealogyState(pub GenealogyData);
pub struct FirstsState(pub FirstsData);
pub struct QaState(pub qa::QaRuntime);

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(update::PendingUpdate::default())
        // Close is intercepted on the FRONTEND, via the window's own onCloseRequested
        // hook (App.tsx) -- not here. This degrades safely if that hook is ever somehow
        // not registered: with no Rust-side prevent_close(), the window just closes
        // normally instead of hanging. (A long chain of apparent unreliability testing
        // this in `tauri dev` turned out to be the test harness itself closing the
        // window before the page had finished loading in a heavily side-loaded dev
        // session, not a real bug -- see HANDOVER.md's Phase 8 notes before mistrusting
        // this design again.)
        .setup(|app| {
            // first, so a failure anywhere below (a missing resource, a locked database)
            // is written to the log as well as ending the start-up
            if let Ok(log_dir) = app.path().app_log_dir() {
                logging::init(&log_dir, &app.package_info().version.to_string());
            }
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

            let qa_path = app
                .path()
                .resolve("resources/qa.json", tauri::path::BaseDirectory::Resource)
                .expect("failed to resolve qa.json resource path");
            let qa_index_path = app
                .path()
                .resolve("resources/qa_index.json", tauri::path::BaseDirectory::Resource)
                .expect("failed to resolve qa_index.json resource path");
            let qa_runtime = qa::QaRuntime::load(&qa_path, &qa_index_path).expect("failed to load qa.json/qa_index.json");
            app.manage(QaState(qa_runtime));

            // Optional: the app still runs without commentaries.db (commands report it missing).
            let commentaries_path = app
                .path()
                .resolve("resources/commentaries.db", tauri::path::BaseDirectory::Resource)
                .expect("failed to resolve commentaries.db resource path");
            app.manage(commentaries::CommentaryState(commentaries::open(&commentaries_path)));

            // Optional, like commentaries.db: interlinear + Bible dictionaries.
            let study_path = app
                .path()
                .resolve("resources/study.db", tauri::path::BaseDirectory::Resource)
                .expect("failed to resolve study.db resource path");
            app.manage(study::StudyState(study::open(&study_path)));

            // The reader's own notes/highlights/bookmarks: writable, in the per-user app
            // data folder (never the install folder), so it survives reinstalls.
            let data_dir = app.path().app_data_dir().expect("no app data dir");
            let user_db = userdata::open(&data_dir).expect("failed to open userdata.db");
            app.manage(userdata::UserDataState(Mutex::new(user_db)));
            app.manage(voice::VoiceState::default());

            // Free modules the user installs from the Library (CrossWire), converted into a
            // writable library.db in the same per-user data folder.
            let library = library::open(&data_dir).expect("failed to open library.db");
            app.manage(library);

            // Bible pictures: the catalogue ships with the app, the pictures themselves are
            // downloaded per collection on request into the same data folder.
            let pictures_catalog = app
                .path()
                .resolve("resources/pictures.json", tauri::path::BaseDirectory::Resource)
                .expect("failed to resolve pictures.json resource path");
            app.manage(pictures::load(&pictures_catalog, &data_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_versions,
            commands::list_books,
            commands::chapter_counts,
            commands::home_stats,
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
            commands::save_highlight_title,
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
            commands::ask_question,
            study_commands::interlinear_verse,
            study_commands::list_dictionaries,
            study_commands::search_dictionaries,
            study_commands::dictionary_entry,
            study_commands::topics_for_verse,
            study_commands::chapter_marks,
            study_commands::toggle_bookmark,
            study_commands::set_highlight,
            study_commands::get_note,
            study_commands::save_note,
            study_commands::chapter_notes,
            logging::log_event,
            logging::log_recent,
            logging::log_path,
            logging::open_log_folder,
            study_commands::note_tags,
            study_commands::list_study,
            study_commands::plan_progress,
            study_commands::start_plan,
            study_commands::stop_plan,
            study_commands::set_plan_day,
            study_commands::export_study,
            study_commands::import_study,
            study_commands::passage_text,
            study_commands::save_study_sheet,
            study_commands::basket_list,
            study_commands::basket_add,
            study_commands::basket_update,
            study_commands::basket_remove,
            study_commands::basket_clear,
            study_commands::basket_reorder,
            voice::voice_status,
            voice::voice_start,
            voice::voice_speak,
            voice::voice_download,
            voice::voice_cancel_download,
            voice::voice_remove,
            update::update_check,
            update::update_install,
            library_commands::library_catalog,
            library_commands::library_sources,
            library_commands::library_import_check,
            library_commands::library_import_install,
            library_commands::library_import_cancel,
            library_commands::library_install,
            library_commands::library_remove,
            library_commands::library_installed,
            library_commands::library_toc,
            library_commands::library_section,
            library_commands::library_book_page,
            library_commands::library_search_books,
            library_commands::library_lexicon_entries,
            original_search::original_word_lookup,
            original_search::original_word_search,
            pictures::pictures_collections,
            pictures::pictures_for_chapter,
            pictures::pictures_gallery,
            pictures::picture_bytes,
            pictures::pictures_download,
            pictures::pictures_cancel,
            pictures::pictures_remove,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
