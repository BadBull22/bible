//! Tauri commands for the study features added in v2.2: the interlinear, the four Bible
//! dictionaries / topical indexes, and the reader's own bookmarks, highlights, notes and
//! reading-plan progress. Kept apart from commands.rs (already the whole v1-v2.1 API
//! surface) so each file stays navigable.

use crate::db::DbState;
use crate::library::{self, LibraryState};
use crate::study::{self, DictionaryEntry, DictionaryHit, DictionaryInfo, InterlinearWord, StudyState};
use crate::userdata::{self, Backup, ChapterMarks, ExportResult, ImportResult, PlanProgress, StudyItem, UserDataState};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::sync::MutexGuard;
use tauri::{AppHandle, Manager, State};

fn study_conn<'a>(state: &'a State<StudyState>) -> Result<MutexGuard<'a, Connection>, String> {
    state
        .0
        .as_ref()
        .ok_or_else(|| "Study data is not bundled in this build (resources/study.db is missing).".to_string())?
        .lock()
        .map_err(|e| e.to_string())
}

fn user_conn<'a>(state: &'a State<UserDataState>) -> Result<MutexGuard<'a, Connection>, String> {
    state.0.lock().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- interlinear + dictionaries

#[tauri::command]
pub fn interlinear_verse(state: State<StudyState>, book: String, chapter: i64, verse: i64) -> Result<Vec<InterlinearWord>, String> {
    study::interlinear_verse(&*study_conn(&state)?, &book, chapter, verse)
}

#[tauri::command]
pub fn list_dictionaries(state: State<StudyState>, lib: State<LibraryState>) -> Result<Vec<DictionaryInfo>, String> {
    // the bundled dictionaries, then any installed from the Library
    let mut out = match study_conn(&state) {
        Ok(c) => study::list_dictionaries(&c)?,
        Err(_) => Vec::new(),
    };
    out.extend(library::dictionaries(&*lib.conn.lock().map_err(|e| e.to_string())?)?);
    Ok(out)
}

#[tauri::command]
pub fn search_dictionaries(state: State<StudyState>, lib: State<LibraryState>, query: String, dict_code: Option<String>, limit: i64) -> Result<Vec<DictionaryHit>, String> {
    let lib_only = dict_code.as_deref().is_some_and(|c| c.starts_with(library::LIB_PREFIX));
    let mut hits = if lib_only {
        Vec::new()
    } else {
        match study_conn(&state) {
            Ok(c) => study::search_dictionaries(&c, &query, dict_code.as_deref(), limit)?,
            Err(e) if dict_code.is_some() => return Err(e),
            Err(_) => Vec::new(),
        }
    };
    if lib_only || (dict_code.is_none() && (hits.len() as i64) < limit) {
        let room = limit - hits.len() as i64;
        hits.extend(library::search_dictionaries(&*lib.conn.lock().map_err(|e| e.to_string())?, &query, dict_code.as_deref(), room)?);
    }
    Ok(hits)
}

#[tauri::command]
pub fn dictionary_entry(state: State<StudyState>, lib: State<LibraryState>, id: i64) -> Result<Option<DictionaryEntry>, String> {
    if id >= library::LIB_ID_BASE {
        return library::dictionary_entry(&*lib.conn.lock().map_err(|e| e.to_string())?, id);
    }
    study::dictionary_entry(&*study_conn(&state)?, id)
}

#[tauri::command]
pub fn topics_for_verse(state: State<StudyState>, book: String, chapter: i64, verse: i64) -> Result<Vec<DictionaryHit>, String> {
    study::topics_for_verse(&*study_conn(&state)?, &book, chapter, verse)
}

// ---------------------------------------------------------------- the reader's own study data

#[tauri::command]
pub fn chapter_marks(state: State<UserDataState>, book: String, chapter: i64) -> Result<ChapterMarks, String> {
    userdata::chapter_marks(&*user_conn(&state)?, &book, chapter)
}

#[tauri::command]
pub fn toggle_bookmark(state: State<UserDataState>, book: String, chapter: i64, verse: i64) -> Result<bool, String> {
    userdata::toggle_bookmark(&*user_conn(&state)?, &book, chapter, verse)
}

#[tauri::command]
pub fn set_highlight(state: State<UserDataState>, book: String, chapter: i64, verse: i64, color: Option<String>) -> Result<(), String> {
    userdata::set_highlight(&*user_conn(&state)?, &book, chapter, verse, color.as_deref())
}

#[tauri::command]
pub fn get_note(state: State<UserDataState>, book: String, chapter: i64, verse: i64) -> Result<Option<userdata::Note>, String> {
    userdata::get_note(&*user_conn(&state)?, &book, chapter, verse)
}

#[tauri::command]
pub fn save_note(
    state: State<UserDataState>,
    book: String,
    chapter: i64,
    verse: i64,
    body: String,
    verse_end: Option<i64>,
    tags: Option<Vec<String>>,
) -> Result<(), String> {
    userdata::save_note(&*user_conn(&state)?, &book, chapter, verse, &body, verse_end, &tags.unwrap_or_default())
}

#[tauri::command]
pub fn sermon_list(state: State<UserDataState>) -> Result<Vec<userdata::Sermon>, String> {
    userdata::sermon_list(&*user_conn(&state)?)
}

#[tauri::command]
pub fn sermon_get(state: State<UserDataState>, id: i64) -> Result<Option<userdata::Sermon>, String> {
    userdata::sermon_get(&*user_conn(&state)?, id)
}

/// Saves a sermon (id 0 = a new one) and returns its id.
#[tauri::command]
pub fn sermon_save(state: State<UserDataState>, sermon: userdata::Sermon) -> Result<i64, String> {
    userdata::sermon_save(&*user_conn(&state)?, &sermon)
}

#[tauri::command]
pub fn sermon_delete(state: State<UserDataState>, id: i64) -> Result<(), String> {
    userdata::sermon_delete(&*user_conn(&state)?, id)
}

#[tauri::command]
pub fn chapter_notes(state: State<UserDataState>, book: String, chapter: i64) -> Result<Vec<userdata::Note>, String> {
    userdata::chapter_notes(&*user_conn(&state)?, &book, chapter)
}

#[tauri::command]
pub fn note_tags(state: State<UserDataState>) -> Result<Vec<(String, i64)>, String> {
    userdata::note_tags(&*user_conn(&state)?)
}

#[derive(Serialize)]
pub struct StudyLists {
    pub bookmarks: Vec<StudyItem>,
    pub highlights: Vec<StudyItem>,
    pub notes: Vec<StudyItem>,
}

/// Fill in each item's BSB verse text (for display and export) -- for a note on a range,
/// every verse of it, numbered. The user-data lock is already released by the time this
/// runs, so the two databases are never locked at once.
fn fill_verse_text(db: &Connection, items: &mut [StudyItem]) {
    let mut stmt = match db.prepare(
        "SELECT v.verse, v.text FROM verses v JOIN books b ON b.id = v.book_id JOIN versions ver ON ver.id = v.version_id
         WHERE ver.code = 'BSB' AND b.name = ?1 AND v.chapter = ?2 AND v.verse BETWEEN ?3 AND ?4 ORDER BY v.verse",
    ) {
        Ok(s) => s,
        Err(_) => return,
    };
    for it in items.iter_mut() {
        let end = it.verse_end.unwrap_or(it.verse).max(it.verse);
        let rows: Vec<(i64, String)> = match stmt.query_map(params![it.book, it.chapter, it.verse, end], |r| Ok((r.get(0)?, r.get(1)?))) {
            Ok(rows) => rows.filter_map(Result::ok).collect(),
            Err(_) => continue,
        };
        it.verse_text = if end > it.verse {
            rows.iter().map(|(v, t)| format!("{v} {}", t.trim())).collect::<Vec<_>>().join(" ")
        } else {
            rows.into_iter().next().map(|(_, t)| t).unwrap_or_default()
        };
    }
}

#[tauri::command]
pub fn list_study(user: State<UserDataState>, db: State<DbState>) -> Result<StudyLists, String> {
    let (mut bookmarks, mut highlights, mut notes) = {
        let u = user_conn(&user)?;
        (userdata::list_bookmarks(&u)?, userdata::list_highlights(&u)?, userdata::list_notes(&u)?)
    };
    let d = db.0.lock().map_err(|e| e.to_string())?;
    fill_verse_text(&d, &mut bookmarks);
    fill_verse_text(&d, &mut highlights);
    fill_verse_text(&d, &mut notes);
    Ok(StudyLists { bookmarks, highlights, notes })
}

#[tauri::command]
pub fn plan_progress(state: State<UserDataState>) -> Result<Vec<PlanProgress>, String> {
    userdata::plan_progress(&*user_conn(&state)?)
}

#[tauri::command]
pub fn start_plan(state: State<UserDataState>, plan_id: String, started_on: String) -> Result<(), String> {
    userdata::start_plan(&*user_conn(&state)?, &plan_id, &started_on)
}

#[tauri::command]
pub fn stop_plan(state: State<UserDataState>, plan_id: String) -> Result<(), String> {
    userdata::stop_plan(&*user_conn(&state)?, &plan_id)
}

#[tauri::command]
pub fn set_plan_day(state: State<UserDataState>, plan_id: String, day: i64, done: bool) -> Result<(), String> {
    userdata::set_plan_day(&*user_conn(&state)?, &plan_id, day, done)
}

/// Writes "Bible study notes <date>.md" (readable) and ".json" (a backup that Import can
/// read back) into Documents\Bible Concordance, then shows the file in Explorer.
#[tauri::command]
pub fn export_study(app: AppHandle, user: State<UserDataState>, db: State<DbState>) -> Result<ExportResult, String> {
    let (mut backup, stamp) = {
        let u = user_conn(&user)?;
        let (now, stamp) = userdata::now_stamp(&u);
        let b = Backup {
            format: userdata::BACKUP_FORMAT.to_string(),
            exported_at: now,
            bookmarks: userdata::list_bookmarks(&u)?,
            highlights: userdata::list_highlights(&u)?,
            notes: userdata::list_notes(&u)?,
            plans: userdata::plan_progress(&u)?,
            sermons: userdata::sermons_all(&u)?,
        };
        (b, stamp)
    };
    {
        let d = db.0.lock().map_err(|e| e.to_string())?;
        fill_verse_text(&d, &mut backup.bookmarks);
        fill_verse_text(&d, &mut backup.highlights);
        fill_verse_text(&d, &mut backup.notes);
    }
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("Bible Concordance");
    let result = userdata::write_export(&dir, &stamp, &backup)?;
    let _ = tauri_plugin_opener::reveal_item_in_dir(&result.markdown_path);
    Ok(result)
}

/// Verse text for a passage (one chapter, `verse_start..=verse_end`) in one translation,
/// verses joined with their numbers -- used by the study sheet for cross-reference text.
#[tauri::command]
pub fn passage_text(
    db: State<DbState>,
    lib: State<LibraryState>,
    version_code: String,
    book: String,
    chapter: i64,
    verse_start: i64,
    verse_end: i64,
) -> Result<String, String> {
    let d = db.0.lock().map_err(|e| e.to_string())?;
    let bundled = d.query_row("SELECT 1 FROM versions WHERE code = ?1", params![version_code], |_| Ok(())).is_ok();
    let rows: Vec<(i64, String)> = if bundled {
        let mut stmt = d
            .prepare(
                "SELECT v.verse, v.text FROM verses v JOIN books b ON b.id = v.book_id JOIN versions ver ON ver.id = v.version_id
                 WHERE ver.code = ?1 AND b.name = ?2 AND v.chapter = ?3 AND v.verse BETWEEN ?4 AND ?5 ORDER BY v.verse",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![version_code, book, chapter, verse_start, verse_end.max(verse_start)], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        rows
    } else {
        drop(d);
        let l = lib.conn.lock().map_err(|e| e.to_string())?;
        crate::library::verse_range(&l, &version_code, &book, chapter, verse_start, verse_end.max(verse_start))?
    };
    if rows.len() == 1 {
        return Ok(rows[0].1.trim().to_string());
    }
    Ok(rows.iter().map(|(v, t)| format!("{v} {}", t.trim())).collect::<Vec<_>>().join(" "))
}

/// Saves a study sheet as a Word document in Documents\Bible Concordance and shows it in
/// Explorer. Returns the file path.
#[tauri::command]
pub fn save_study_sheet(app: AppHandle, title: String, blocks: Vec<crate::sheet::SheetBlock>) -> Result<String, String> {
    let dir = app.path().document_dir().map_err(|e| e.to_string())?.join("Bible Concordance");
    let path = crate::sheet::write_docx(&dir, &title, &blocks)?;
    let _ = tauri_plugin_opener::reveal_item_in_dir(&path);
    Ok(path.display().to_string())
}

// ---------------------------------------------------------------- study basket

#[tauri::command]
pub fn basket_list(state: State<UserDataState>) -> Result<Vec<userdata::BasketItem>, String> {
    userdata::basket_list(&*user_conn(&state)?)
}

#[tauri::command]
pub fn basket_add(state: State<UserDataState>, kind: String, title: String, body: String, meta: String) -> Result<i64, String> {
    userdata::basket_add(&*user_conn(&state)?, &kind, &title, &body, &meta)
}

#[tauri::command]
pub fn basket_update(state: State<UserDataState>, id: i64, title: String, body: String) -> Result<(), String> {
    userdata::basket_update(&*user_conn(&state)?, id, &title, &body)
}

#[tauri::command]
pub fn basket_remove(state: State<UserDataState>, id: i64) -> Result<(), String> {
    userdata::basket_remove(&*user_conn(&state)?, id)
}

#[tauri::command]
pub fn basket_clear(state: State<UserDataState>) -> Result<(), String> {
    userdata::basket_clear(&*user_conn(&state)?)
}

#[tauri::command]
pub fn basket_reorder(state: State<UserDataState>, ids: Vec<i64>) -> Result<(), String> {
    userdata::basket_reorder(&mut *user_conn(&state)?, &ids)
}

#[tauri::command]
pub fn import_study(state: State<UserDataState>, json: String) -> Result<ImportResult, String> {
    let mut conn = user_conn(&state)?;
    userdata::import_backup(&mut conn, &json)
}
