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
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

pub mod backgrounds;
pub mod bibles;
pub mod db;
pub mod search;
pub mod study;
pub mod study_extra;
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

/// The open databases: the Bible, a second connection to it for the topical index, the
/// reader's own bookmarks and highlights, and the translations the reader downloaded.
pub struct Opened {
    db: Mutex<Connection>,
    study: Mutex<Connection>,
    user: Mutex<Connection>,
    bibles: Mutex<Connection>,
    /// the translations in the bundled database (BSB, KJV, ...)
    bundled: Vec<String>,
    /// the app's data folder (the nature backgrounds are kept in it)
    dir: PathBuf,
}

fn open_all(dir: &Path) -> Result<Opened, String> {
    let bible = unpack_db(dir).map_err(|e| format!("The Bible couldn't be unpacked: {e}"))?;
    let db = db::open_read_only(&bible).map_err(err)?;
    let bundled = search::versions(&db)?.into_iter().map(|v| v.code).collect();
    let more = Connection::open(dir.join("my-bibles.db")).map_err(err)?;
    bibles::init(&more)?;
    Ok(Opened {
        db: Mutex::new(db),
        study: Mutex::new(db::open_read_only(&bible).map_err(err)?),
        user: Mutex::new(userdata::open(&dir.join("my-study.db"))?),
        bibles: Mutex::new(more),
        bundled,
        dir: dir.to_path_buf(),
    })
}

impl Opened {
    fn is_bundled(&self, version: &str) -> bool {
        self.bundled.iter().any(|v| v == version)
    }

    /// The translation to search and to show results in: a downloaded one isn't indexed for
    /// the search, so results come in the BSB.
    fn searchable<'a>(&self, version: &'a str) -> &'a str {
        if self.is_bundled(version) {
            version
        } else {
            "BSB"
        }
    }

    /// A verse or short passage in a bundled or a downloaded translation.
    fn passage(&self, version: &str, book: &str, chapter: i64, start: i64, end: i64) -> Result<String, String> {
        Ok(if self.is_bundled(version) {
            search::passage(&*self.db.lock().map_err(err)?, version, book, chapter, start, end)
        } else {
            bibles::passage(&*self.bibles.lock().map_err(err)?, version, book, chapter, start, end)
        })
    }
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

/// A translation to read: one of the bundled ones, or one the reader downloaded.
#[derive(Serialize)]
struct VersionInfo {
    code: String,
    name: String,
    license_note: String,
    language: String,
    rtl: bool,
    downloaded: bool,
}

#[tauri::command(async)]
fn versions(core: State<Core>) -> Result<Vec<VersionInfo>, String> {
    let core = core.get()?;
    let mut out: Vec<VersionInfo> = search::versions(&*core.db.lock().map_err(err)?)?
        .into_iter()
        .map(|v| VersionInfo { code: v.code, name: v.name, license_note: v.license_note, language: "English".into(), rtl: false, downloaded: false })
        .collect();
    for b in bibles::installed(&*core.bibles.lock().map_err(err)?)? {
        out.push(VersionInfo { code: b.code, name: b.name, license_note: b.copyright, language: b.language, rtl: b.rtl, downloaded: true });
    }
    Ok(out)
}

#[tauri::command(async)]
fn books(core: State<Core>) -> Result<Vec<search::Book>, String> {
    search::books(&*core.get()?.db.lock().map_err(err)?)
}

#[tauri::command(async)]
fn chapter(core: State<Core>, version: String, book: String, chapter: i64) -> Result<Vec<search::Verse>, String> {
    let core = core.get()?;
    if core.is_bundled(&version) {
        search::chapter(&*core.db.lock().map_err(err)?, &version, &book, chapter)
    } else {
        bibles::chapter(&*core.bibles.lock().map_err(err)?, &version, &book, chapter)
    }
}

#[tauri::command(async)]
fn search_bible(core: State<Core>, query: String, version: String, testament: Option<String>, book: Option<String>, limit: Option<usize>) -> Result<search::SearchResult, String> {
    let core = core.get()?;
    let d = core.db.lock().map_err(err)?;
    let s = core.study.lock().map_err(err)?;
    let scope = search::Scope { testament: testament.as_deref(), book: book.as_deref() };
    search::search(&d, &s, &query, core.searchable(&version), scope, limit.unwrap_or(200).min(500))
}

#[tauri::command(async)]
fn topic_verses(core: State<Core>, id: i64, version: String) -> Result<Vec<search::Hit>, String> {
    let core = core.get()?;
    let d = core.db.lock().map_err(err)?;
    let s = core.study.lock().map_err(err)?;
    search::topic_verses(&d, &s, id, core.searchable(&version), 400)
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
    for m in &mut list {
        m.text = core.passage(&version, &m.book, m.chapter, m.verse, m.verse)?;
    }
    Ok(list)
}

/// The text of a verse or short passage (for the verse of the day).
#[tauri::command(async)]
fn passage(core: State<Core>, version: String, book: String, chapter: i64, verse: i64, verse_end: Option<i64>) -> Result<String, String> {
    core.get()?.passage(&version, &book, chapter, verse, verse_end.unwrap_or(verse))
}

#[tauri::command(async)]
fn cross_refs(core: State<Core>, version: String, book: String, chapter: i64, verse: i64) -> Result<Vec<search::Hit>, String> {
    let core = core.get()?;
    let mut hits = search::cross_refs(&*core.db.lock().map_err(err)?, core.searchable(&version), &book, chapter, verse)?;
    if !core.is_bundled(&version) {
        // shown in the downloaded translation where it has the verses
        let more = core.bibles.lock().map_err(err)?;
        for h in &mut hits {
            let text = bibles::passage(&more, &version, &h.book, h.chapter, h.verse, h.verse_end);
            if !text.is_empty() {
                h.text = text;
            }
        }
    }
    Ok(hits)
}

/// The verse in every translation, bundled and downloaded: (code, text).
#[tauri::command(async)]
fn compare(core: State<Core>, book: String, chapter: i64, verse: i64) -> Result<Vec<(String, String)>, String> {
    let core = core.get()?;
    let mut all = search::compare(&*core.db.lock().map_err(err)?, &book, chapter, verse)?;
    all.extend(bibles::compare(&*core.bibles.lock().map_err(err)?, &book, chapter, verse)?);
    Ok(all)
}

// ---------------------------------------------------------------- word study and commentary

#[tauri::command(async)]
fn verse_words(core: State<Core>, version: String, book: String, chapter: i64, verse: i64) -> Result<(String, Vec<study_extra::Word>), String> {
    study_extra::verse_words(&*core.get()?.db.lock().map_err(err)?, &version, &book, chapter, verse)
}

#[tauri::command(async)]
fn strongs_entry(core: State<Core>, number: String) -> Result<Option<study_extra::Entry>, String> {
    study_extra::strongs_entry(&*core.get()?.db.lock().map_err(err)?, &number)
}

#[tauri::command(async)]
fn strongs_uses(core: State<Core>, version: String, number: String) -> Result<Vec<study_extra::Use>, String> {
    study_extra::strongs_uses(&*core.get()?.db.lock().map_err(err)?, &version, &number, 300)
}

#[tauri::command(async)]
fn chapter_notes(core: State<Core>, book: String, chapter: i64) -> Result<Vec<study_extra::Note>, String> {
    study_extra::chapter_notes(&*core.get()?.db.lock().map_err(err)?, &book, chapter)
}

#[tauri::command(async)]
fn verse_notes(core: State<Core>, book: String, chapter: i64, verse: i64) -> Result<Vec<study_extra::Note>, String> {
    study_extra::verse_notes(&*core.get()?.db.lock().map_err(err)?, &book, chapter, verse)
}

#[tauri::command(async)]
fn book_intro(core: State<Core>, book: String) -> Result<String, String> {
    study_extra::book_intro(&*core.get()?.db.lock().map_err(err)?, &book)
}

#[tauri::command(async)]
fn commentary_about(core: State<Core>) -> Result<study_extra::About, String> {
    study_extra::commentary_about(&*core.get()?.db.lock().map_err(err)?)
}

// ---------------------------------------------------------------- more translations

#[tauri::command(async)]
fn bible_catalog(core: State<Core>, today: String, refresh: bool) -> Result<Vec<bibles::Offer>, String> {
    bibles::catalog(&*core.get()?.bibles.lock().map_err(err)?, &today, refresh)
}

#[derive(Serialize, Clone)]
struct DownloadProgress<'a> {
    id: &'a str,
    pct: u8,
}

/// Downloads a translation from eBible.org; "bible-progress" events report the percentage.
/// Returns how many verses it has.
#[tauri::command(async)]
fn bible_install(app: AppHandle, core: State<Core>, id: String, today: String) -> Result<i64, String> {
    let core = core.get()?;
    let offer = bibles::find_offer(&*core.bibles.lock().map_err(err)?, &today, &id)?;
    // the connection is held only for storing, not during the download
    let mut scratch = Connection::open_in_memory().map_err(err)?;
    bibles::init(&scratch)?;
    let n = bibles::install(&mut scratch, &offer, &|pct| {
        let _ = app.emit("bible-progress", DownloadProgress { id: &id, pct });
    })?;
    let mut more = core.bibles.lock().map_err(err)?;
    let tx = more.transaction().map_err(err)?;
    tx.execute("DELETE FROM verses WHERE code = ?1", [&id]).map_err(err)?;
    {
        let mut from = scratch.prepare("SELECT code, book, chapter, verse, text FROM verses").map_err(err)?;
        let mut put = tx.prepare("INSERT OR REPLACE INTO verses (code, book, chapter, verse, text) VALUES (?1,?2,?3,?4,?5)").map_err(err)?;
        let rows = from
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, i64>(3)?, r.get::<_, String>(4)?)))
            .map_err(err)?;
        for row in rows {
            let (c, b, ch, v, t) = row.map_err(err)?;
            put.execute(rusqlite::params![c, b, ch, v, t]).map_err(err)?;
        }
        let (name, language, copyright, rtl): (String, String, String, i64) =
            scratch.query_row("SELECT name, language, copyright, rtl FROM bibles WHERE code = ?1", [&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(err)?;
        tx.execute("INSERT OR REPLACE INTO bibles (code, name, language, copyright, rtl) VALUES (?1,?2,?3,?4,?5)", rusqlite::params![id, name, language, copyright, rtl])
            .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(n)
}

#[tauri::command(async)]
fn bible_remove(core: State<Core>, code: String) -> Result<(), String> {
    bibles::remove(&*core.get()?.bibles.lock().map_err(err)?, &code)
}

// ---------------------------------------------------------------- nature backgrounds for verse pictures

#[derive(Serialize)]
struct BackgroundsStatus {
    count: usize,
    size_mb: u32,
}

#[tauri::command(async)]
fn backgrounds_status(core: State<Core>) -> Result<BackgroundsStatus, String> {
    Ok(BackgroundsStatus { count: backgrounds::count(&core.get()?.dir), size_mb: backgrounds::SIZE_MB })
}

/// Downloads the backgrounds; "backgrounds-progress" events report the percentage.
#[tauri::command(async)]
fn backgrounds_install(app: AppHandle, core: State<Core>) -> Result<usize, String> {
    backgrounds::install(&core.get()?.dir, &|pct| {
        let _ = app.emit("backgrounds-progress", pct);
    })
}

#[tauri::command(async)]
fn backgrounds_thumbs(core: State<Core>) -> Result<Vec<backgrounds::Thumb>, String> {
    backgrounds::thumbs(&core.get()?.dir)
}

#[tauri::command(async)]
fn background_image(core: State<Core>, id: String) -> Result<(String, backgrounds::Background), String> {
    backgrounds::image(&core.get()?.dir, &id)
}

#[tauri::command(async)]
fn backgrounds_remove(core: State<Core>) -> Result<(), String> {
    backgrounds::remove(&core.get()?.dir)
}

// ---------------------------------------------------------------- tags and the reading streak

#[tauri::command(async)]
fn set_tags(core: State<Core>, kind: String, book: String, chapter: i64, verse: i64, tags: Vec<String>) -> Result<(), String> {
    userdata::set_tags(&*core.get()?.user.lock().map_err(err)?, &kind, &book, chapter, verse, &tags)
}

#[tauri::command(async)]
fn tags_of(core: State<Core>, kind: String, book: String, chapter: i64, verse: i64) -> Result<Vec<String>, String> {
    userdata::tags_of(&*core.get()?.user.lock().map_err(err)?, &kind, &book, chapter, verse)
}

#[tauri::command(async)]
fn all_tags(core: State<Core>) -> Result<Vec<(String, i64)>, String> {
    userdata::all_tags(&*core.get()?.user.lock().map_err(err)?)
}

#[tauri::command(async)]
fn mark_read(core: State<Core>, book: String, chapter: i64, day: String) -> Result<(), String> {
    userdata::mark_read(&*core.get()?.user.lock().map_err(err)?, &book, chapter, &day)
}

#[tauri::command(async)]
fn reading_stats(core: State<Core>, today: String) -> Result<userdata::ReadingStats, String> {
    userdata::reading_stats(&*core.get()?.user.lock().map_err(err)?, &today)
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
        .plugin(tauri_plugin_notification::init())
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
            restore,
            verse_words,
            strongs_entry,
            strongs_uses,
            chapter_notes,
            verse_notes,
            book_intro,
            commentary_about,
            bible_catalog,
            bible_install,
            bible_remove,
            set_tags,
            tags_of,
            all_tags,
            mark_read,
            reading_stats,
            backgrounds_status,
            backgrounds_install,
            backgrounds_thumbs,
            background_image,
            backgrounds_remove
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
