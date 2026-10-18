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
pub mod lan;
pub mod library;
pub mod meaning_pack;
pub mod modules;
pub mod packs;
pub mod search;
pub mod study;
pub mod study_extra;
pub mod update;
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
    /// commentaries, dictionaries, books and devotionals (since 2.9.0)
    library: Mutex<Connection>,
    /// the translations in the bundled database (BSB, KJV, ...)
    bundled: Vec<String>,
    /// the app's data folder (the nature backgrounds are kept in it)
    dir: PathBuf,
    /// the unpacked Bible database
    bible: PathBuf,
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
        user: Mutex::new({
            let user = userdata::open(&dir.join("my-study.db"))?;
            bible_core::sync::init(&user)?;
            user
        }),
        bibles: Mutex::new(more),
        library: Mutex::new(library::open(dir)?),
        bundled,
        bible: bible.clone(),
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
    let meaning = meaning_pack::get(&core.dir);
    search::search(&d, &s, &query, core.searchable(&version), scope, limit.unwrap_or(200).min(500), meaning.as_deref())
}

// ---------------------------------------------------------------- the Advanced search upgrade

#[derive(Serialize)]
struct SearchUpgradeStatus {
    installed: bool,
    size_mb: u32,
}

#[tauri::command(async)]
fn search_upgrade_status(core: State<Core>) -> Result<SearchUpgradeStatus, String> {
    Ok(SearchUpgradeStatus { installed: meaning_pack::installed(&core.get()?.dir), size_mb: meaning_pack::SIZE_MB })
}

/// Downloads the upgrade; "search-upgrade-progress" events report the percentage.
#[tauri::command(async)]
fn search_upgrade_install(app: AppHandle, core: State<Core>) -> Result<(), String> {
    meaning_pack::install(&core.get()?.dir, &|pct| {
        let _ = app.emit("search-upgrade-progress", pct);
    })
}

#[tauri::command(async)]
fn search_upgrade_remove(core: State<Core>) -> Result<(), String> {
    meaning_pack::remove(&core.get()?.dir)
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

/// Adds the Bible in a file the reader chose (the phone plugin's `open_file` copied it to
/// `path`): an e-Sword, MySword or SWORD Bible.
#[tauri::command(async)]
fn bible_add_file(core: State<Core>, path: String, name: String) -> Result<modules::Added, String> {
    let opened = core.get()?;
    let file = PathBuf::from(&path);
    let added = modules::add_file(&mut *opened.bibles.lock().map_err(err)?, &file, &name, &opened.dir.join("import-work"), &opened.bundled);
    // the copy in the cache is not needed any more
    let _ = fs::remove_file(&file);
    added
}

// ---------------------------------------------------------------- keeping in step through a shared folder (since 0.4.0)
//
// The same as on the computers (bible_core::sync): the reader chooses a folder they share with
// them, and each device keeps a file of its own in it. On a phone the folder is reached through
// Android's folder access (the phone plugin); when the app is tried out on a computer, a path.

/// The chosen folder, through the phone plugin (or a plain folder on a computer).
struct PhoneFolder<'a> {
    app: &'a AppHandle,
    uri: String,
}

impl bible_core::sync::Folder for PhoneFolder<'_> {
    fn read_all(&self) -> Result<Vec<(String, String)>, String> {
        if self.uri.starts_with("content://") {
            tauri_plugin_phone::sync_read(self.app, &self.uri)
        } else {
            bible_core::sync::DirFolder::new(Path::new(&self.uri))?.read_all()
        }
    }
    fn write(&self, name: &str, text: &str) -> Result<(), String> {
        if self.uri.starts_with("content://") {
            tauri_plugin_phone::sync_write(self.app, &self.uri, name, text)
        } else {
            bible_core::sync::DirFolder::new(Path::new(&self.uri))?.write(name, text)
        }
    }
}

#[derive(Serialize)]
struct SyncStatus {
    /// the computer paired over the home Wi-Fi, or null
    computer: Option<String>,
    /// the chosen folder's name, or null when not keeping in step through one
    folder: Option<String>,
    name: String,
    last: Option<bible_core::sync::SyncReport>,
    error: Option<String>,
}

fn sync_status_of(conn: &Connection) -> Result<SyncStatus, String> {
    use bible_core::sync::setting;
    Ok(SyncStatus {
        computer: setting(conn, "lan_token")?.and(setting(conn, "lan_name")?),
        folder: setting(conn, "uri")?.map(|u| setting(conn, "folder_name").ok().flatten().unwrap_or(u)),
        name: setting(conn, "name")?.unwrap_or_else(|| "Phone".into()),
        last: setting(conn, "last")?.and_then(|t| serde_json::from_str(&t).ok()),
        error: setting(conn, "error")?,
    })
}

#[tauri::command(async)]
fn sync_status(core: State<Core>) -> Result<SyncStatus, String> {
    sync_status_of(&*core.get()?.user.lock().map_err(err)?)
}

/// The folder chosen with the phone plugin's `pick_folder` (its uri and name), or none to stop.
#[tauri::command(async)]
fn sync_set_folder(core: State<Core>, uri: Option<String>, name: Option<String>) -> Result<SyncStatus, String> {
    use bible_core::sync::set_setting;
    let conn = core.get()?.user.lock().map_err(err)?;
    set_setting(&conn, "uri", uri.as_deref())?;
    set_setting(&conn, "folder_name", name.as_deref())?;
    set_setting(&conn, "last", None)?;
    set_setting(&conn, "error", None)?;
    sync_status_of(&conn)
}

#[tauri::command(async)]
fn sync_set_name(core: State<Core>, name: String) -> Result<SyncStatus, String> {
    let conn = core.get()?.user.lock().map_err(err)?;
    let name: String = name.trim().chars().take(40).collect();
    bible_core::sync::set_setting(&conn, "name", if name.is_empty() { None } else { Some(&name) })?;
    sync_status_of(&conn)
}

/// One sync: with the computer over the home Wi-Fi (when paired) and through the shared folder
/// (when one is chosen) -- the phone's bookmarks, highlights, notes and reading plans.
#[tauri::command(async)]
fn sync_now(app: AppHandle, core: State<Core>) -> Result<bible_core::sync::SyncReport, String> {
    use bible_core::sync::{set_setting, setting, SyncReport};
    let user = &core.get()?.user;
    let (paired, uri, name) = {
        let conn = user.lock().map_err(err)?;
        (setting(&conn, "lan_token")?.is_some(), setting(&conn, "uri")?, setting(&conn, "name")?.unwrap_or_else(|| "Phone".into()))
    };
    if !paired && uri.is_none() {
        return Err("Pair this phone with your computer first.".into());
    }
    let mut report = SyncReport { at: bible_core::sync::now_ms(), ..Default::default() };
    let add = |r: SyncReport, report: &mut SyncReport| {
        report.received += r.received;
        report.sent += r.sent;
        report.conflicts.extend(r.conflicts);
        report.skipped.extend(r.skipped);
        report.notes.extend(r.notes);
        for d in r.devices {
            if !report.devices.iter().any(|x| x.name == d.name) {
                report.devices.push(d);
            }
        }
    };
    if paired {
        match lan_sync(user, &name) {
            Ok(r) => add(r, &mut report),
            Err(e) => report.notes.push(e),
        }
    }
    if let Some(uri) = uri {
        let mut conn = user.lock().map_err(err)?;
        match bible_core::sync::sync(&mut conn, &bible_core::sync::CommonStore, &PhoneFolder { app: &app, uri }, &name, "phone") {
            Ok(r) => add(r, &mut report),
            Err(e) => report.notes.push(e),
        }
    }
    let conn = user.lock().map_err(err)?;
    set_setting(&conn, "last", Some(&serde_json::to_string(&report).map_err(err)?))?;
    set_setting(&conn, "error", None)?;
    Ok(report)
}

/// One sync with the paired computer: this phone's changes go into its sync file, the file
/// goes to the computer, and the computer's file comes back and is taken in. The database is
/// not held while the network is used.
fn lan_sync(user: &Mutex<Connection>, name: &str) -> Result<bible_core::sync::SyncReport, String> {
    use bible_core::sync::{self as core, set_setting, setting, CommonStore, MemFolder};
    let (address, token, pc_id, mine, sent) = {
        let mut conn = user.lock().map_err(err)?;
        let mem = MemFolder::default();
        let first = core::sync(&mut conn, &CommonStore, &mem, name, "phone")?;
        let mine = mem.written.borrow_mut().take().unwrap_or_default();
        (
            setting(&conn, "lan_address")?.unwrap_or_default(),
            setting(&conn, "lan_token")?.unwrap_or_default(),
            setting(&conn, "lan_id")?.unwrap_or_default(),
            mine,
            first.sent,
        )
    };
    let theirs = match lan::exchange(&address, &token, &mine) {
        Ok(t) => t,
        Err(f) if f.unreachable => {
            // the computer may have a new address on the network: look for it
            let Some(found) = lan::find().into_iter().find(|c| c.id == pc_id) else { return Err(f.message) };
            set_setting(&*user.lock().map_err(err)?, "lan_address", Some(&found.address))?;
            lan::exchange(&found.address, &token, &mine).map_err(|f| f.message)?
        }
        Err(f) => return Err(f.message),
    };
    let mut conn = user.lock().map_err(err)?;
    let mem = MemFolder { others: vec![("computer.json".into(), theirs)], ..Default::default() };
    let mut r = core::sync(&mut conn, &CommonStore, &mem, name, "phone")?;
    r.sent += sent;
    Ok(r)
}

/// The computers on this Wi-Fi that let phones sync with them.
#[tauri::command(async)]
fn lan_find() -> Vec<lan::Found> {
    lan::find()
}

/// Pairs with the computer at `address` (found, or typed) using the code it shows.
#[tauri::command(async)]
fn lan_pair(core: State<Core>, address: String, code: String) -> Result<SyncStatus, String> {
    use bible_core::sync::{device_id, set_setting, setting};
    let user = &core.get()?.user;
    let (me, name) = {
        let conn = user.lock().map_err(err)?;
        (device_id(&conn)?, setting(&conn, "name")?.unwrap_or_else(|| "Phone".into()))
    };
    // a typed address: make sure it is the app before sending the code
    let found = lan::hello(&address).map_err(|f| f.message)?;
    let p = lan::pair(&found.address, &code, &me, &name).map_err(|f| f.message)?;
    let conn = user.lock().map_err(err)?;
    set_setting(&conn, "lan_address", Some(&found.address))?;
    set_setting(&conn, "lan_token", Some(&p.token))?;
    set_setting(&conn, "lan_id", Some(&p.id))?;
    set_setting(&conn, "lan_name", Some(&p.name))?;
    sync_status_of(&conn)
}

/// Stops syncing with the paired computer.
#[tauri::command(async)]
fn lan_forget(core: State<Core>) -> Result<SyncStatus, String> {
    let conn = core.get()?.user.lock().map_err(err)?;
    for k in ["lan_address", "lan_token", "lan_id", "lan_name"] {
        bible_core::sync::set_setting(&conn, k, None)?;
    }
    sync_status_of(&conn)
}

// ---------------------------------------------------------------- the Library (since 2.9.0)

/// What CrossWire offers for the Library (commentaries, dictionaries, books, devotionals).
#[tauri::command(async)]
fn library_catalog(core: State<Core>, refresh: bool) -> Result<Vec<bible_core::library::CatalogItem>, String> {
    let opened = core.get()?;
    library::catalog(&*opened.library.lock().map_err(err)?, &opened.dir, refresh)
}

/// Downloads and installs a module; "library-progress" events report { name, pct }.
#[tauri::command(async)]
fn library_install(app: AppHandle, core: State<Core>, name: String) -> Result<bible_core::library::InstallReport, String> {
    let opened = core.get()?;
    library::install(&mut *opened.library.lock().map_err(err)?, &opened.dir, &name, &|pct| {
        let _ = app.emit("library-progress", serde_json::json!({ "name": name, "pct": pct }));
    })
}

/// Adds a module from a file the reader chose (`phone.openFile` copied it to `path`): to the
/// Library, or, when it is a Bible, to the translations.
#[tauri::command(async)]
fn library_add_file(core: State<Core>, path: String, name: String) -> Result<bible_core::library::InstallReport, String> {
    let opened = core.get()?;
    let file = PathBuf::from(&path);
    let result = match library::add_file(&mut *opened.library.lock().map_err(err)?, &opened.dir, &file, &name) {
        Err(e) if e == library::IS_BIBLE => modules::add_file(&mut *opened.bibles.lock().map_err(err)?, &file, &name, &opened.dir.join("import-work"), &opened.bundled).map(|a| {
            bible_core::library::InstallReport {
                name: a.code,
                kind: "bible".into(),
                title: a.name,
                entries: a.verses,
                books: a.books,
                language: a.language,
                licence: String::new(),
                warnings: a.warnings,
                replaces: None,
            }
        }),
        other => other,
    };
    let _ = fs::remove_file(&file);
    result
}

#[tauri::command(async)]
fn library_installed(core: State<Core>) -> Result<Vec<bible_core::library::InstalledModule>, String> {
    library::installed(&*core.get()?.library.lock().map_err(err)?)
}

#[tauri::command(async)]
fn library_remove(core: State<Core>, name: String) -> Result<(), String> {
    library::remove(&mut *core.get()?.library.lock().map_err(err)?, &name)
}

#[tauri::command(async)]
fn library_commentary(core: State<Core>, book: String, chapter: i64) -> Result<Vec<library::CommentaryOn>, String> {
    library::commentary(&*core.get()?.library.lock().map_err(err)?, &book, chapter)
}

#[tauri::command(async)]
fn library_search(core: State<Core>, query: String) -> Result<Vec<library::DictHit>, String> {
    library::dictionary_search(&*core.get()?.library.lock().map_err(err)?, &query)
}

#[tauri::command(async)]
fn library_entry(core: State<Core>, id: i64) -> Result<Option<library::Entry>, String> {
    library::dictionary_entry(&*core.get()?.library.lock().map_err(err)?, id)
}

#[tauri::command(async)]
fn library_devotional(core: State<Core>, module: String, month: u32, day: u32) -> Result<Option<library::Entry>, String> {
    library::devotional(&*core.get()?.library.lock().map_err(err)?, &module, month, day)
}

#[tauri::command(async)]
fn library_toc(core: State<Core>, module: String) -> Result<Vec<library::TocEntry>, String> {
    library::book_toc(&*core.get()?.library.lock().map_err(err)?, &module)
}

#[tauri::command(async)]
fn library_section(core: State<Core>, id: i64) -> Result<Option<library::Section>, String> {
    library::book_section(&*core.get()?.library.lock().map_err(err)?, id)
}

/// A book's sections that are this day's readings (a book of daily readings), if any.
#[tauri::command(async)]
fn library_today(core: State<Core>, module: String, month: u32, day: u32) -> Result<Vec<i64>, String> {
    library::book_today(&*core.get()?.library.lock().map_err(err)?, &module, month, day)
}

// ---------------------------------------------------------------- the names of the highlight colours

/// The reader's names for the highlight colours (the same as on the computer when they keep in step).
#[tauri::command(async)]
fn highlight_names(core: State<Core>) -> Result<std::collections::HashMap<String, String>, String> {
    bible_core::sync::highlight_names(&*core.get()?.user.lock().map_err(err)?)
}

#[tauri::command(async)]
fn set_highlight_name(core: State<Core>, color: String, title: String) -> Result<(), String> {
    bible_core::sync::set_highlight_name(&*core.get()?.user.lock().map_err(err)?, &color, &title)
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

// ---------------------------------------------------------------- a newer version of the app

/// Where a downloaded update waits for Android's installer: the folder the phone plugin
/// names (Android's own idea of the app's cache is not the one Tauri's paths give).
fn updates_dir(app: &AppHandle) -> Result<PathBuf, String> {
    tauri_plugin_phone::updates_dir(app)
}

/// The newer version on offer, if there is one (asks the website).
#[tauri::command(async)]
fn update_check(app: AppHandle) -> Result<Option<update::Offer>, String> {
    let offer = update::check(env!("CARGO_PKG_VERSION"))?;
    if offer.is_none() {
        // up to date: an update downloaded earlier has been installed, or is no longer wanted
        if let Ok(dir) = updates_dir(&app) {
            update::clear(&dir, None);
        }
    }
    Ok(offer)
}

/// Downloads the version on offer ("update-progress" events report the percentage) and
/// returns the file's path, for the phone plugin's `install_update`. The website is asked
/// again here, so the page cannot name a file of its own.
#[tauri::command(async)]
fn update_download(app: AppHandle) -> Result<String, String> {
    let offer = update::check(env!("CARGO_PKG_VERSION"))?.ok_or("You already have the newest version.")?;
    let path = update::download(&offer, &updates_dir(&app)?, &|pct| {
        let _ = app.emit("update-progress", pct);
    })?;
    Ok(path.to_string_lossy().into_owned())
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
                // the search's word list and the search upgrade, ready before the first search
                // (on a connection of its own, so the first chapter isn't kept waiting)
                if let Ok(core) = handle.state::<Core>().get() {
                    if let Ok(db) = db::open_read_only(&core.bible) {
                        search::warm(&db);
                    }
                }
                let _ = meaning_pack::get(&dir);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            versions,
            books,
            chapter,
            passage,
            search_bible,
            search_upgrade_status,
            search_upgrade_install,
            search_upgrade_remove,
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
            bible_add_file,
            highlight_names,
            set_highlight_name,
            library_catalog,
            library_install,
            library_add_file,
            library_installed,
            library_remove,
            library_commentary,
            library_search,
            library_entry,
            library_devotional,
            library_toc,
            library_section,
            library_today,
            sync_status,
            sync_set_folder,
            sync_set_name,
            sync_now,
            lan_find,
            lan_pair,
            lan_forget,
            set_tags,
            tags_of,
            all_tags,
            mark_read,
            reading_stats,
            backgrounds_status,
            backgrounds_install,
            backgrounds_thumbs,
            background_image,
            backgrounds_remove,
            update_check,
            update_download
        ])
        .run(tauri::generate_context!())
        .expect("error while running the app");
}
