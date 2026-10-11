//! Bible Concordance for phones: the Bible, one search box, bookmarks and highlights.
//!
//! The Bible database is compiled into the app (gzip, about 16 MB) and unpacked into the
//! app's data folder the first time a version runs: on Android the app's bundled files sit
//! inside the APK, where SQLite cannot open them, and this way is the same on every platform.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use rusqlite::Connection;
use tauri::{Manager, State};

pub mod db;
pub mod search;
pub mod study;
pub mod userdata;

// The desktop app's subject search, used from its source so both apps search alike. It
// carries a desktop command (and its own tests, which need the desktop databases) that
// the phone doesn't use.
#[allow(dead_code)]
#[path = "../../../src-tauri/src/sermon.rs"]
pub mod sermon;

static PHONE_DB_GZ: &[u8] = include_bytes!("../resources/phone.db.gz");

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

/// Unpacks the Bible database into `dir` unless this build's copy is already there, and
/// clears out copies left by earlier versions. Returns its path.
pub fn unpack_db(dir: &Path) -> io::Result<PathBuf> {
    fs::create_dir_all(dir)?;
    // named by size and the gzip trailer's checksum of the contents, so a new database gets a new file
    let n = PHONE_DB_GZ.len();
    let sum = &PHONE_DB_GZ[n.saturating_sub(8)..n.saturating_sub(4)];
    let name = format!("bible-{}-{:02x}{:02x}{:02x}{:02x}.db", n, sum[0], sum[1], sum[2], sum[3]);
    let path = dir.join(&name);
    if !path.exists() {
        let part = dir.join(format!("{name}.part"));
        let mut out = fs::File::create(&part)?;
        io::copy(&mut flate2::read::GzDecoder::new(PHONE_DB_GZ), &mut out)?;
        out.sync_all()?;
        drop(out);
        fs::rename(&part, &path)?;
    }
    for entry in fs::read_dir(dir)?.flatten() {
        let file = entry.file_name().to_string_lossy().to_string();
        if file.starts_with("bible-") && file != name {
            fs::remove_file(entry.path()).ok();
        }
    }
    Ok(path)
}

/// The open databases: the Bible, a second connection to it for the topical index, and
/// the reader's own bookmarks and highlights.
pub struct Opened {
    db: Mutex<Connection>,
    study: Mutex<Connection>,
    user: Mutex<Connection>,
}

fn open_all(dir: &Path) -> Result<Opened, String> {
    let bible = unpack_db(dir).map_err(|e| format!("The Bible couldn't be unpacked: {e}"))?;
    Ok(Opened {
        db: Mutex::new(db::open_read_only(&bible).map_err(err)?),
        study: Mutex::new(db::open_read_only(&bible).map_err(err)?),
        user: Mutex::new(userdata::open(&dir.join("my-study.db"))?),
    })
}

/// The app's state. It is there from the start but filled in a moment later: on a phone the
/// page is up and asking for the chapter before the databases are open (the first run also
/// unpacks the Bible), so every command waits here for them.
#[derive(Default)]
pub struct Core(OnceLock<Result<Opened, String>>);

impl Core {
    fn get(&self) -> Result<&Opened, String> {
        for _ in 0..1200 {
            if let Some(opened) = self.0.get() {
                return opened.as_ref().map_err(Clone::clone);
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        Err("The Bible is taking too long to open. Please close the app and open it again.".into())
    }
}

// Every command is `async` so that it runs off the main thread, where it may wait.

#[tauri::command(async)]
fn versions(core: State<Core>) -> Result<Vec<search::Version>, String> {
    search::versions(&*core.get()?.db.lock().map_err(err)?)
}

#[tauri::command(async)]
fn books(core: State<Core>) -> Result<Vec<search::Book>, String> {
    search::books(&*core.get()?.db.lock().map_err(err)?)
}

#[tauri::command(async)]
fn chapter(core: State<Core>, version: String, book: String, chapter: i64) -> Result<Vec<search::Verse>, String> {
    search::chapter(&*core.get()?.db.lock().map_err(err)?, &version, &book, chapter)
}

#[tauri::command(async)]
fn search_bible(core: State<Core>, query: String, version: String, testament: Option<String>, book: Option<String>, limit: Option<usize>) -> Result<search::SearchResult, String> {
    let core = core.get()?;
    let d = core.db.lock().map_err(err)?;
    let s = core.study.lock().map_err(err)?;
    let scope = search::Scope { testament: testament.as_deref(), book: book.as_deref() };
    search::search(&d, &s, &query, &version, scope, limit.unwrap_or(200).min(500))
}

#[tauri::command(async)]
fn topic_verses(core: State<Core>, id: i64, version: String) -> Result<Vec<search::Hit>, String> {
    let core = core.get()?;
    let d = core.db.lock().map_err(err)?;
    let s = core.study.lock().map_err(err)?;
    search::topic_verses(&d, &s, id, &version, 400)
}

#[tauri::command(async)]
fn chapter_marks(core: State<Core>, book: String, chapter: i64) -> Result<userdata::ChapterMarks, String> {
    userdata::chapter_marks(&*core.get()?.user.lock().map_err(err)?, &book, chapter)
}

#[tauri::command(async)]
fn toggle_bookmark(core: State<Core>, book: String, chapter: i64, verse: i64) -> Result<bool, String> {
    userdata::toggle_bookmark(&*core.get()?.user.lock().map_err(err)?, &book, chapter, verse)
}

#[tauri::command(async)]
fn set_highlight(core: State<Core>, book: String, chapter: i64, verse: i64, color: Option<String>) -> Result<(), String> {
    userdata::set_highlight(&*core.get()?.user.lock().map_err(err)?, &book, chapter, verse, color.as_deref())
}

/// The reader's bookmarks ("bookmarks"), highlights ("highlights") or notes ("notes"), newest
/// first, with each verse's text in the translation being read.
#[tauri::command(async)]
fn marks(core: State<Core>, kind: String, version: String) -> Result<Vec<userdata::Mark>, String> {
    let core = core.get()?;
    let mut list = {
        let u = core.user.lock().map_err(err)?;
        match kind.as_str() {
            "highlights" => userdata::highlights(&u)?,
            "notes" => userdata::notes(&u)?,
            _ => userdata::bookmarks(&u)?,
        }
    };
    let d = core.db.lock().map_err(err)?;
    for m in &mut list {
        m.text = search::passage(&d, &version, &m.book, m.chapter, m.verse, m.verse);
    }
    Ok(list)
}

/// The text of a verse or short passage (for the verse of the day).
#[tauri::command(async)]
fn passage(core: State<Core>, version: String, book: String, chapter: i64, verse: i64, verse_end: Option<i64>) -> Result<String, String> {
    Ok(search::passage(&*core.get()?.db.lock().map_err(err)?, &version, &book, chapter, verse, verse_end.unwrap_or(verse)))
}

#[tauri::command(async)]
fn cross_refs(core: State<Core>, version: String, book: String, chapter: i64, verse: i64) -> Result<Vec<search::Hit>, String> {
    search::cross_refs(&*core.get()?.db.lock().map_err(err)?, &version, &book, chapter, verse)
}

#[tauri::command(async)]
fn compare(core: State<Core>, book: String, chapter: i64, verse: i64) -> Result<Vec<(String, String)>, String> {
    search::compare(&*core.get()?.db.lock().map_err(err)?, &book, chapter, verse)
}

#[tauri::command(async)]
fn articles(core: State<Core>, query: String) -> Result<Vec<search::ArticleHead>, String> {
    search::articles(&*core.get()?.study.lock().map_err(err)?, &query, 60)
}

#[tauri::command(async)]
fn article(core: State<Core>, id: i64) -> Result<Option<search::Article>, String> {
    search::article(&*core.get()?.study.lock().map_err(err)?, id)
}

#[tauri::command(async)]
fn note(core: State<Core>, book: String, chapter: i64, verse: i64) -> Result<String, String> {
    userdata::note(&*core.get()?.user.lock().map_err(err)?, &book, chapter, verse)
}

#[tauri::command(async)]
fn set_note(core: State<Core>, book: String, chapter: i64, verse: i64, body: String) -> Result<(), String> {
    userdata::set_note(&*core.get()?.user.lock().map_err(err)?, &book, chapter, verse, &body)
}

#[tauri::command(async)]
fn plan_progress(core: State<Core>) -> Result<Vec<userdata::PlanProgress>, String> {
    userdata::plan_progress(&*core.get()?.user.lock().map_err(err)?)
}

#[tauri::command(async)]
fn start_plan(core: State<Core>, plan_id: String, started_on: String) -> Result<(), String> {
    userdata::start_plan(&*core.get()?.user.lock().map_err(err)?, &plan_id, &started_on)
}

#[tauri::command(async)]
fn stop_plan(core: State<Core>, plan_id: String) -> Result<(), String> {
    userdata::stop_plan(&*core.get()?.user.lock().map_err(err)?, &plan_id)
}

#[tauri::command(async)]
fn set_plan_day(core: State<Core>, plan_id: String, day: i64, done: bool) -> Result<(), String> {
    userdata::set_plan_day(&*core.get()?.user.lock().map_err(err)?, &plan_id, day, done)
}

/// Everything the reader has made, as the text of a backup file, and how much it holds.
#[tauri::command(async)]
fn backup(core: State<Core>) -> Result<(String, userdata::Counts), String> {
    userdata::backup_json(&*core.get()?.user.lock().map_err(err)?)
}

/// Adds a backup file's contents to what is here (nothing is deleted).
#[tauri::command(async)]
fn restore(core: State<Core>, json: String) -> Result<userdata::Counts, String> {
    userdata::restore(&mut *core.get()?.user.lock().map_err(err)?, &json)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_phone::init())
        .manage(Core::default())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let handle = app.handle().clone();
            // off the main thread, so the window is up at once even on the first run
            std::thread::spawn(move || {
                let _ = handle.state::<Core>().0.set(open_all(&dir));
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            versions,
            books,
            chapter,
            passage,
            search_bible,
            topic_verses,
            cross_refs,
            compare,
            articles,
            article,
            chapter_marks,
            toggle_bookmark,
            set_highlight,
            note,
            set_note,
            marks,
            plan_progress,
            start_plan,
            stop_plan,
            set_plan_day,
            backup,
            restore
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
