//! The Library on the phone (since 2.9.0): commentaries, dictionaries and lexicons, books and
//! devotionals, downloaded from CrossWire's libraries (since 3.2.1 also Wycliffe, the NET Bible
//! and CrossWire's Attic) or added from a file the reader has (SWORD, e-Sword, MySword).
//! Installing is the desktop app's own code (`bible_core::library`); the library is a database
//! of its own (`library/library.db`), so a new version of the app keeps it. Bibles are not kept
//! here: they go into `my-bibles.db` (see `bibles.rs` and `modules.rs`), and since 3.2.1 the
//! Bibles these sources offer are listed on the Bibles screen (`bible_items`).

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use bible_core::library::{self as lib, CatalogItem, InstallOptions, InstallReport, InstalledModule};
use bible_core::esword;
use bible_core::sword::Conf;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

/// What the phone has built in, said instead of installing it again.
pub const BUILT_IN: &[(&str, &str)] = &[
    ("KJV", "The King James Version is built in."),
    ("BSB", "The Berean Standard Bible is built in."),
    ("ASV", "The American Standard Version is built in."),
    ("YLT", "Young's Literal Translation is built in."),
    ("WEB", "The World English Bible is built in."),
    ("StrongsGreek", "Strong's Greek dictionary is built in (tap a word while reading)."),
    ("StrongsHebrew", "Strong's Hebrew dictionary is built in (tap a word while reading)."),
];

/// Identifies the app to CrossWire (a contact URL, never personal details).
const USER_AGENT: &str = "BibleConcordance-Android/2.9 (https://bible4me.org)";
/// the catalogue is fetched again after this long (or when the reader asks)
const CATALOG_DAYS: u64 = 14;
/// what this Bible says when a file turns out to be a Bible (it goes to the translations)
pub const IS_BIBLE: &str = "__bible__";

pub fn dir_of(app_dir: &Path) -> PathBuf {
    app_dir.join("library")
}

pub fn open(app_dir: &Path) -> Result<Connection, String> {
    let dir = dir_of(app_dir);
    std::fs::create_dir_all(&dir).map_err(err)?;
    let conn = Connection::open(dir.join("library.db")).map_err(err)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;").map_err(err)?;
    conn.execute_batch(lib::SCHEMA).map_err(err)?;
    lib::migrate(&conn, &dir)?;
    Ok(conn)
}

fn get(url: &str, who: &str) -> Result<ureq::Response, String> {
    ureq::get(url)
        .set("User-Agent", USER_AGENT)
        .timeout(Duration::from_secs(300))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(code, _) => format!("{who} answered {code}."),
            _ => format!("Couldn't reach {who}. Check the phone's internet connection and try again."),
        })
}

/// The SWORD repositories the phone uses (since 3.2.1), in the order they win when two hold a module of the same name: CrossWire's main library,
/// Wycliffe's Bibles in minority languages, the NET Bible's free edition (bible.org) and CrossWire's Attic of older works. They are the computer
/// app's sources (`bible_core::library::SOURCES`) minus eBible.org's SWORD copies (the phone takes eBible.org's own list instead, in `bibles.rs`)
/// and CrossWire Beta (unfinished works). Before 3.2.1 the phone used CrossWire's main library only, and left its Bibles out.
pub const PHONE_SOURCES: &[&str] = &["crosswire", "wycliffe", "netbible", "attic"];

fn source_of(id: &str) -> Result<&'static lib::Source, String> {
    if !PHONE_SOURCES.contains(&id) {
        return Err("That isn't a library the app downloads from.".into());
    }
    lib::source(id).ok_or_else(|| "That isn't a library the app downloads from.".to_string())
}

/// One source's catalogue (`mods.d.tar.gz`), at most two weeks old unless `refresh`; the last copy when the phone is offline.
fn source_confs(app_dir: &Path, source: &lib::Source, refresh: bool) -> Result<Vec<Conf>, String> {
    let dir = dir_of(app_dir);
    std::fs::create_dir_all(&dir).map_err(err)?;
    let cache = lib::catalog_cache(&dir, source);
    let fresh = std::fs::metadata(&cache)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_some_and(|age| age < Duration::from_secs(CATALOG_DAYS * 24 * 3600));
    let bytes = if fresh && !refresh {
        std::fs::read(&cache).map_err(err)?
    } else {
        let mut fetched = Vec::new();
        match get(source.catalog_url, source.name).and_then(|r| r.into_reader().take(50 * 1024 * 1024).read_to_end(&mut fetched).map_err(err)) {
            Ok(_) => {
                let _ = std::fs::write(&cache, &fetched);
                fetched
            }
            // offline: the last copy will do
            Err(e) => std::fs::read(&cache).map_err(|_| e)?,
        }
    };
    lib::parse_catalog(&bytes)
}

/// The catalogues of all the phone's sources, fetched (or read from the cache) without touching the library's database, so that reading it is
/// not held up while a slow network answers. A source that can't be reached is left out; only when none can be is it an error.
pub fn source_catalogs(app_dir: &Path, refresh: bool) -> Result<Vec<(&'static lib::Source, Vec<Conf>)>, String> {
    let mut out = Vec::new();
    let mut first_error: Option<String> = None;
    for id in PHONE_SOURCES {
        let source = source_of(id)?;
        match source_confs(app_dir, source, refresh) {
            Ok(confs) => out.push((source, confs)),
            Err(e) => {
                first_error.get_or_insert(e);
            }
        }
    }
    if out.is_empty() {
        return Err(first_error.unwrap_or_else(|| "Couldn't reach CrossWire. Check the phone's internet connection and try again.".into()));
    }
    Ok(out)
}

/// The catalogue items of every source (`keep` decides which), one entry per module name (the first source in `PHONE_SOURCES` wins).
fn items_of(conn: &Connection, catalogs: &[(&'static lib::Source, Vec<Conf>)], keep: &dyn Fn(&CatalogItem) -> bool) -> Result<Vec<(CatalogItem, Conf)>, String> {
    let mut out: Vec<(CatalogItem, Conf)> = Vec::new();
    for (source, confs) in catalogs {
        let by_name: std::collections::HashMap<&str, &Conf> = confs.iter().map(|c| (c.name.as_str(), c)).collect();
        for item in lib::catalog_items(confs, conn, source.id, BUILT_IN)? {
            if !keep(&item) || out.iter().any(|(o, _)| o.name.eq_ignore_ascii_case(&item.name)) {
                continue;
            }
            if let Some(conf) = by_name.get(item.name.as_str()) {
                out.push((item, (*conf).clone()));
            }
        }
    }
    Ok(out)
}

/// Everything the phone's Library holds that its sources offer: commentaries, dictionaries, books and devotionals (Bibles are offered on the
/// Bibles screen, `bible_items`, and go into the translations).
pub fn catalog(conn: &Connection, catalogs: &[(&'static lib::Source, Vec<Conf>)]) -> Result<Vec<CatalogItem>, String> {
    let mut items: Vec<CatalogItem> = items_of(conn, catalogs, &|c| c.kind != "bible" && c.kind != "other")?.into_iter().map(|(i, _)| i).collect();
    items.sort_by(|a, b| a.language.cmp(&b.language).then(a.title.to_lowercase().cmp(&b.title.to_lowercase())));
    Ok(items)
}

/// A Bible a SWORD source offers, with what the Bibles screen needs beyond the catalogue item.
pub struct SwordBible {
    pub item: CatalogItem,
    /// written right to left (Hebrew, Arabic, ...)
    pub rtl: bool,
}

/// The Bibles the phone's sources offer that the app can read and does not have built in (since 3.2.1). The questionable ones (CrossWire's
/// "Cults / Unorthodox / Questionable Material") are left out, as in the Library.
pub fn bible_items(conn: &Connection, catalogs: &[(&'static lib::Source, Vec<Conf>)]) -> Result<Vec<SwordBible>, String> {
    let found = items_of(conn, catalogs, &|c| c.kind == "bible" && c.supported && c.note.is_none() && !c.questionable)?;
    Ok(found
        .into_iter()
        .map(|(item, conf)| SwordBible { rtl: conf.get("Direction").is_some_and(|d| d.eq_ignore_ascii_case("RtoL")), item })
        .collect())
}

/// Downloads a module's zip from one of the phone's sources (`progress`: percent downloaded, up to 99).
pub fn download(source_id: &str, name: &str, progress: &dyn Fn(u8)) -> Result<Vec<u8>, String> {
    if !lib::valid_name(name) {
        return Err("That isn't a module name.".into());
    }
    let source = source_of(source_id)?;
    let resp = get(&format!("{}{name}.zip", source.zip_url), source.name)?;
    let total: u64 = resp.header("Content-Length").and_then(|n| n.parse().ok()).unwrap_or(0);
    let mut reader = resp.into_reader().take(lib::MAX_UNPACKED_BYTES);
    let mut bytes = Vec::new();
    let mut chunk = vec![0u8; 64 * 1024];
    let mut last = 255u8;
    loop {
        let n = reader.read(&mut chunk).map_err(|_| "The download was cut off. Try again.".to_string())?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..n]);
        if total > 0 {
            let pct = ((bytes.len() as u64 * 99) / total).min(99) as u8;
            if pct != last {
                last = pct;
                progress(pct);
            }
        }
    }
    if !bytes.starts_with(b"PK") {
        return Err(format!("{} sent something that isn't a module. Try again later.", source.name));
    }
    Ok(bytes)
}

/// Downloads a module from one of the phone's sources and installs it (`progress`: percent downloaded, then 100 while it is put in place).
pub fn install(conn: &mut Connection, app_dir: &Path, source_id: &str, name: &str, progress: &dyn Fn(u8)) -> Result<InstallReport, String> {
    let source = source_of(source_id)?;
    let bytes = download(source.id, name, progress)?;
    progress(100);
    let tmp = dir_of(app_dir).join("tmp").join(name);
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(err)?;
    let result = lib::unzip(&bytes, &tmp, false)
        .and_then(|_| lib::install_unpacked(conn, &tmp, name, InstallOptions { source: source.id, strict: false, commit: true, built_in: BUILT_IN }, &|_| {}));
    let _ = std::fs::remove_dir_all(&tmp);
    result
}

/// The footnotes and study notes that came in the same zip as a Bible (a MyBible download holds
/// "ESV.SQLite3" and "ESV.commentaries.SQLite3") are added to the library as a commentary.
/// Returns a sentence for the reader, or None when the file had none.
pub fn add_notes_of(conn: &mut Connection, app_dir: &Path, path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let (module, name) = lib::esword_companion(&bytes)?;
    let tmp = dir_of(app_dir).join("tmp").join("_notes");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).ok()?;
    let file = tmp.join("module.sqlite");
    let done = std::fs::write(&file, &module).map_err(err).and_then(|_| esword::read(&file, Some(&name))).and_then(|m| lib::install_esword(conn, &m, Some(&name), true, BUILT_IN));
    let _ = std::fs::remove_dir_all(&tmp);
    Some(match done {
        Ok(r) => format!("Its footnotes and study notes were added to your commentaries ({}, {} notes).", r.title, r.entries),
        Err(e) => format!("Its footnotes and study notes could not be added: {e}"),
    })
}

/// Adds a module from a file the reader chose (the phone plugin copied it to `path`). A Bible
/// is answered with `IS_BIBLE`, for the caller to add it to the translations instead.
pub fn add_file(conn: &mut Connection, app_dir: &Path, path: &Path, name: &str) -> Result<InstallReport, String> {
    let bytes = std::fs::read(path).map_err(err)?;
    if bytes.len() > lib::MAX_IMPORT_BYTES {
        return Err("That file is too large to add.".into());
    }
    let tmp = dir_of(app_dir).join("tmp").join("_import");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(err)?;
    let result = (|| {
        if let Some((module, inner)) = lib::esword_bytes(&bytes, Some(name))? {
            let file = tmp.join("module.sqlite");
            std::fs::write(&file, &module).map_err(err)?;
            let m = esword::read(&file, Some(&inner))?;
            if m.kind == "bible" {
                return Err(IS_BIBLE.to_string());
            }
            if m.kind == "atlas" {
                return Err("An atlas of maps can be added in the computer app; the phone doesn't show maps from a file.".into());
            }
            return lib::install_esword(conn, &m, Some(&inner), true, BUILT_IN);
        }
        if bytes.starts_with(b"PK") {
            lib::unzip(&bytes, &tmp, true)?;
            let conf = lib::find_conf(&tmp, "")?;
            if lib::kind_of(&conf) == Some("bible") {
                return Err(IS_BIBLE.to_string());
            }
            return lib::install_unpacked(conn, &tmp, "", InstallOptions { source: lib::SOURCE_FILE, strict: true, commit: true, built_in: BUILT_IN }, &|_| {});
        }
        Err("This isn't a module the app can read. It can add SWORD modules (.zip) and e-Sword or MySword modules (.cmtx, .dctx, .lexx, .devx, .topx, .refx, .mybible).".into())
    })();
    let _ = std::fs::remove_dir_all(&tmp);
    result
}

/// What is in the library (no Bibles: those are with the translations).
pub fn installed(conn: &Connection) -> Result<Vec<InstalledModule>, String> {
    Ok(lib::installed(conn, None)?.into_iter().filter(|m| m.kind != "bible").collect())
}

pub fn remove(conn: &mut Connection, name: &str) -> Result<(), String> {
    lib::remove(conn, name)
}

// ---------------------------------------------------------------- reading

/// One commentary's notes on a chapter.
#[derive(Serialize)]
pub struct CommentaryOn {
    pub module: String,
    pub title: String,
    /// (first verse, text); verse 0 is on the whole chapter
    pub notes: Vec<(i64, String)>,
}

/// Every installed commentary's notes on a chapter.
pub fn commentary(conn: &Connection, book: &str, chapter: i64) -> Result<Vec<CommentaryOn>, String> {
    let mut st = conn
        .prepare(
            "SELECT m.name, m.title, c.verse_start, c.text FROM lib_comm c JOIN modules m ON m.name = c.module
             WHERE c.book = ?1 AND c.chapter = ?2 ORDER BY m.title, c.verse_start, c.id",
        )
        .map_err(err)?;
    let rows = st.query_map(params![book, chapter], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?))).map_err(err)?;
    let mut out: Vec<CommentaryOn> = Vec::new();
    for row in rows {
        let (module, title, verse, text) = row.map_err(err)?;
        match out.last_mut() {
            Some(c) if c.module == module => c.notes.push((verse, text)),
            _ => out.push(CommentaryOn { module, title, notes: vec![(verse, text)] }),
        }
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct DictHit {
    pub id: i64,
    pub module: String,
    pub title: String,
    pub headword: String,
}

/// Dictionary and lexicon entries for a word ("grace"), or a Strong's number ("G26").
pub fn dictionary_search(conn: &Connection, query: &str) -> Result<Vec<DictHit>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let strongs = lib::strongs_of_key(q, false, false);
    let mut st = conn
        .prepare(
            "SELECT d.id, d.module, m.title, d.headword FROM lib_dict d JOIN modules m ON m.name = d.module
             WHERE m.kind = 'dictionary' AND (d.headword_fold = ?1 OR d.headword_fold LIKE ?1 || '%' OR d.strongs = ?2)
             ORDER BY (d.strongs = ?2) DESC, (d.headword_fold = ?1) DESC, length(d.headword), m.title LIMIT 60",
        )
        .map_err(err)?;
    let rows = st.query_map(params![q.to_lowercase(), strongs], |r| Ok(DictHit { id: r.get(0)?, module: r.get(1)?, title: r.get(2)?, headword: r.get(3)? })).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[derive(Serialize)]
pub struct Entry {
    pub id: i64,
    pub module: String,
    pub title: String,
    pub headword: String,
    pub body: String,
}

/// The entries of the installed lexicons (BDB, Abbott-Smith, Dodson...) for one Strong's number ("G26"), as Word Study shows them.
pub fn lexicon_entries(conn: &Connection, strongs: &str) -> Result<Vec<Entry>, String> {
    let mut st = conn
        .prepare(
            "SELECT d.id, d.module, m.title, d.headword, d.body FROM lib_dict d JOIN modules m ON m.name = d.module
             WHERE m.kind = 'dictionary' AND d.strongs = ?1 ORDER BY m.title, d.id LIMIT 12",
        )
        .map_err(err)?;
    let rows = st.query_map(params![strongs.trim().to_uppercase()], |r| Ok(Entry { id: r.get(0)?, module: r.get(1)?, title: r.get(2)?, headword: r.get(3)?, body: r.get(4)? })).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

pub fn dictionary_entry(conn: &Connection, id: i64) -> Result<Option<Entry>, String> {
    conn.query_row(
        "SELECT d.id, d.module, m.title, d.headword, d.body FROM lib_dict d JOIN modules m ON m.name = d.module WHERE d.id = ?1",
        params![id],
        |r| Ok(Entry { id: r.get(0)?, module: r.get(1)?, title: r.get(2)?, headword: r.get(3)?, body: r.get(4)? }),
    )
    .optional()
    .map_err(err)
}

/// A devotional's reading for a day ("MM.DD" keys, as SWORD and e-Sword keep them).
pub fn devotional(conn: &Connection, module: &str, month: u32, day: u32) -> Result<Option<Entry>, String> {
    conn.query_row(
        "SELECT d.id, d.module, m.title, d.headword, d.body FROM lib_dict d JOIN modules m ON m.name = d.module WHERE d.module = ?1 AND d.key = ?2",
        params![module, format!("{month:02}.{day:02}")],
        |r| Ok(Entry { id: r.get(0)?, module: r.get(1)?, title: r.get(2)?, headword: r.get(3)?, body: r.get(4)? }),
    )
    .optional()
    .map_err(err)
}

#[derive(Serialize)]
pub struct TocEntry {
    pub id: i64,
    pub parent: Option<i64>,
    pub title: String,
}

/// A book's contents, in order.
pub fn book_toc(conn: &Connection, module: &str) -> Result<Vec<TocEntry>, String> {
    let mut st = conn.prepare("SELECT id, parent, title FROM lib_book WHERE module = ?1 ORDER BY ord").map_err(err)?;
    let rows = st.query_map(params![module], |r| Ok(TocEntry { id: r.get(0)?, parent: r.get(1)?, title: r.get(2)? })).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[derive(Serialize)]
pub struct Section {
    pub id: i64,
    pub module: String,
    pub book: String,
    pub title: String,
    pub text: String,
    pub prev: Option<i64>,
    pub next: Option<i64>,
}

/// One section of a book, with the sections before and after it that have text.
pub fn book_section(conn: &Connection, id: i64) -> Result<Option<Section>, String> {
    let Some((module, ord, title, text)) = conn
        .query_row("SELECT module, ord, title, text FROM lib_book WHERE id = ?1", params![id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)))
        .optional()
        .map_err(err)?
    else {
        return Ok(None);
    };
    let near = |sql: &str| conn.query_row(sql, params![module, ord], |r| r.get::<_, i64>(0)).optional().map_err(err);
    let prev = near("SELECT id FROM lib_book WHERE module = ?1 AND ord < ?2 AND text <> '' ORDER BY ord DESC LIMIT 1")?;
    let next = near("SELECT id FROM lib_book WHERE module = ?1 AND ord > ?2 AND text <> '' ORDER BY ord LIMIT 1")?;
    let book: String = conn.query_row("SELECT title FROM modules WHERE name = ?1", params![module], |r| r.get(0)).unwrap_or_default();
    Ok(Some(Section { id, module, book, title, text, prev, next }))
}

const MONTHS: [&str; 12] = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/// Whether a section title names this day: "January 17", "17 Jan", "01 AM Jun", "Jan. 17 —
/// Morning" (a book of daily readings, like Spurgeon's Morning and Evening).
pub fn title_is_day(title: &str, month: u32, day: u32) -> bool {
    let t = title.to_lowercase();
    let words: Vec<&str> = t.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();
    // a date is a short title, with the day next to the month ("01 AM Jun": one word between)
    if words.len() > 5 {
        return false;
    }
    let name = MONTHS[(month as usize).clamp(1, 12) - 1];
    let is_month = |w: &str| w == name || (w.len() >= 3 && name.starts_with(w));
    let months: Vec<usize> = (0..words.len()).filter(|&i| is_month(words[i])).collect();
    let days: Vec<usize> = (0..words.len()).filter(|&i| words[i].parse::<u32>().ok() == Some(day)).collect();
    let other_number = words.iter().any(|w| w.parse::<u32>().is_ok_and(|n| n != day && n <= 31));
    !other_number && months.iter().any(|m| days.iter().any(|d| m.abs_diff(*d) <= 2))
}

/// The sections of a book that are this day's readings (none: it isn't a book of days).
pub fn book_today(conn: &Connection, module: &str, month: u32, day: u32) -> Result<Vec<i64>, String> {
    Ok(book_toc(conn, module)?.into_iter().filter(|t| title_is_day(&t.title, month, day)).map(|t| t.id).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use bible_core::sword;

    /// The phone must not quietly offer less than the computer (in 3.2.0 it left every Bible out and used one source of six): it uses every source
    /// the computer's Library has, except eBible.org's SWORD copies (the Bibles screen reads eBible.org's own list) and CrossWire Beta (unfinished).
    #[test]
    fn the_phone_uses_the_computers_sources() {
        let computer: Vec<&str> = lib::SOURCES.iter().map(|s| s.id).collect();
        for id in PHONE_SOURCES {
            assert!(computer.contains(id), "{id} is one of the computer's sources");
            assert!(source_of(id).is_ok());
        }
        for id in computer {
            assert!(PHONE_SOURCES.contains(&id) || id == "ebible" || id == "beta", "the computer's source {id} is missing on the phone");
        }
        assert!(source_of("beta").is_err() && source_of("elsewhere").is_err(), "nothing outside the list is downloaded from");
        assert_eq!(PHONE_SOURCES[0], "crosswire", "CrossWire's main library wins when two hold a module of the same name");
    }

    #[test]
    fn a_bad_module_name_is_refused_before_anything_is_fetched() {
        assert!(download("crosswire", "../x", &|_| {}).is_err());
        assert!(download("crosswire", "", &|_| {}).is_err());
        assert!(download("beta", "KJV", &|_| {}).is_err());
    }

    #[test]
    fn the_installed_lexicons_answer_for_a_strongs_number() {
        let dir = std::env::temp_dir().join(format!("bc-phone-lex-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let conn = open(&dir).unwrap();
        conn.execute_batch(
            "INSERT INTO modules (name, kind, title, lang, language, licence, about, version, versification) VALUES
                 ('Dodson', 'dictionary', 'Dodson Greek Lexicon', 'en', 'English', 'PD', '', '1', 'KJV'),
                 ('AbbottSmith', 'dictionary', 'Abbott-Smith Manual Greek Lexicon', 'en', 'English', 'PD', '', '1', 'KJV'),
                 ('Easton', 'dictionary', 'Easton Bible Dictionary', 'en', 'English', 'PD', '', '1', 'KJV'),
                 ('Spurgeon', 'book', 'A book', 'en', 'English', 'PD', '', '1', 'KJV');
             INSERT INTO lib_dict (module, key, headword, headword_fold, body, strongs) VALUES
                 ('Dodson', '00025', 'ἀγαπάω', 'αγαπαω', 'to love', 'G25'),
                 ('AbbottSmith', '00025', 'ἀγαπάω', 'αγαπαω', 'to love (LXX)', 'G25'),
                 ('Dodson', '00026', 'ἀγάπη', 'αγαπη', 'love', 'G26'),
                 ('Easton', 'Love', 'Love', 'love', 'Love, in Easton', NULL);",
        )
        .unwrap();
        let g25 = lexicon_entries(&conn, "g25").unwrap();
        assert_eq!(g25.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(), vec!["Abbott-Smith Manual Greek Lexicon", "Dodson Greek Lexicon"], "by the lexicon's name, whatever the case typed");
        assert_eq!(g25[1].body, "to love");
        assert_eq!(lexicon_entries(&conn, "G26").unwrap().len(), 1);
        assert!(lexicon_entries(&conn, "G999").unwrap().is_empty(), "no entry: nothing");
        assert!(lexicon_entries(&conn, "").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn titles_that_are_days() {
        assert!(title_is_day("01 AM Jun", 6, 1));
        assert!(title_is_day("January 17", 1, 17));
        assert!(title_is_day("Jan. 17 — Evening", 1, 17));
        assert!(!title_is_day("01 AM Jun", 6, 2));
        assert!(!title_is_day("June", 6, 1));
        assert!(!title_is_day("Chapter 17: The march of faith", 3, 17), "march as a word, but not a date");
    }

    #[test]
    fn modules_from_files_into_the_library() {
        let dir = std::env::temp_dir().join(format!("bc-phone-lib-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut conn = open(&dir).unwrap();
        // an e-Sword commentary
        let f = dir.join("c.cmtx");
        Connection::open(&f)
            .unwrap()
            .execute_batch(r"CREATE TABLE Details(Title TEXT, Abbreviation TEXT); INSERT INTO Details VALUES ('Test Notes', 'TN');
                CREATE TABLE VerseCommentary(Book INT, ChapterBegin INT, VerseBegin INT, ChapterEnd INT, VerseEnd INT, Comments TEXT);
                INSERT INTO VerseCommentary VALUES (43, 3, 16, 3, 16, '{\rtf1 God so loved. See Rom 5:8.\par}');")
            .unwrap();
        let r = add_file(&mut conn, &dir, &f, "c.cmtx").unwrap();
        assert_eq!(r.kind, "commentary");
        let c = commentary(&conn, "John", 3).unwrap();
        assert_eq!((c.len(), c[0].notes[0].0), (1, 16));
        assert!(c[0].notes[0].1.contains("⟦Romans|5|8"), "{}", c[0].notes[0].1);
        // an e-Sword devotional, read by the day
        let f = dir.join("d.devx");
        Connection::open(&f)
            .unwrap()
            .execute_batch("CREATE TABLE Details(Title TEXT, Abbreviation TEXT); INSERT INTO Details VALUES ('Daily Test', 'DT'); CREATE TABLE Devotions(Month INT, Day INT, Devotion TEXT); INSERT INTO Devotions VALUES (10, 17, '{\\rtf1 Today''s word.}');")
            .unwrap();
        let r = add_file(&mut conn, &dir, &f, "d.devx").unwrap();
        assert_eq!(r.kind, "devotional");
        let d = devotional(&conn, &r.name, 10, 17).unwrap().unwrap();
        assert!(d.body.contains("Today's word"), "{}", d.body);
        // a lexicon keyed by Strong's numbers
        let f = dir.join("l.dct.mybible");
        Connection::open(&f)
            .unwrap()
            .execute_batch("CREATE TABLE details(title TEXT, abbreviation TEXT, strong TEXT); INSERT INTO details VALUES ('Lex', 'LX', '1'); CREATE TABLE dictionary(word TEXT, data TEXT); INSERT INTO dictionary VALUES ('G26', '<p>love</p>');")
            .unwrap();
        add_file(&mut conn, &dir, &f, "l.dct.mybible").unwrap();
        let hits = dictionary_search(&conn, "G26").unwrap();
        assert_eq!(hits.len(), 1);
        assert!(dictionary_entry(&conn, hits[0].id).unwrap().unwrap().body.contains("love"));
        // a Bible goes to the translations instead
        let f = dir.join("b.bbl.mybible");
        let c = Connection::open(&f).unwrap();
        c.execute_batch("CREATE TABLE Bible(Book INT, Chapter INT, Verse INT, Scripture TEXT); CREATE TABLE Details(Description TEXT, Abbreviation TEXT);").unwrap();
        c.execute("INSERT INTO Bible VALUES (43, 3, 16, 'For God so loved')", []).unwrap();
        drop(c);
        assert_eq!(add_file(&mut conn, &dir, &f, "b.bbl.mybible").unwrap_err(), IS_BIBLE);
        assert_eq!(installed(&conn).unwrap().len(), 3);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The real catalogues of the phone's four sources (needs the internet): `cargo test --lib library -- --ignored`. The Library gets
    /// commentaries, dictionaries, books and devotionals from them; the Bibles screen gets their Bibles, the Afrikaans 1933/1953 among them, and
    /// that Bible's zip really is there to download.
    #[test]
    #[ignore]
    fn the_sources_catalogues_and_the_afrikaans_bible() {
        let dir = std::env::temp_dir().join(format!("bc-phone-cat-{}", std::process::id()));
        let conn = open(&dir).unwrap();
        let catalogs = source_catalogs(&dir, true).unwrap();
        println!("sources reached: {:?}", catalogs.iter().map(|(s, c)| (s.id, c.len())).collect::<Vec<_>>());
        assert_eq!(catalogs.len(), PHONE_SOURCES.len(), "all four sources answer");
        let items = catalog(&conn, &catalogs).unwrap();
        let kinds = ["commentary", "dictionary", "book", "devotional"].map(|k| items.iter().filter(|i| i.kind == k && i.supported).count());
        println!("{} items; supported commentaries {}, dictionaries {}, books {}, devotionals {}", items.len(), kinds[0], kinds[1], kinds[2], kinds[3]);
        assert!(kinds.iter().all(|n| *n > 0));
        assert!(items.iter().all(|i| i.kind != "bible"), "Bibles are on the Bibles screen");
        let bibles = bible_items(&conn, &catalogs).unwrap();
        let langs: std::collections::HashSet<&str> = bibles.iter().map(|b| b.item.lang.as_str()).collect();
        println!("{} Bibles in {} language codes", bibles.len(), langs.len());
        let afr = bibles.iter().find(|b| b.item.name == "Afr1953").expect("the Afrikaans 1933/1953 is offered");
        assert_eq!(afr.item.source, "crosswire");
        assert!(bibles.iter().all(|b| b.item.name != "KJV"), "a Bible built into the app is not offered again");
        let zip = download("crosswire", "Afr1953", &|_| {}).unwrap();
        assert!(zip.len() > 500_000, "the Afrikaans zip downloads ({} bytes)", zip.len());
        let _ = sword::canon("kjv");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The whole way a Bible from CrossWire takes on the phone (needs the internet): downloaded, added to the translations as a SWORD file is,
    /// then read and searched. `cargo test --lib afrikaans_end_to_end -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn afrikaans_end_to_end() {
        let dir = std::env::temp_dir().join(format!("bc-phone-afr-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let zip = download("crosswire", "Afr1953", &|_| {}).unwrap();
        let file = dir.join("Afr1953.zip");
        std::fs::write(&file, &zip).unwrap();
        let mut bibles = Connection::open_in_memory().unwrap();
        crate::bibles::init(&bibles).unwrap();
        let added = crate::modules::add_file(&mut bibles, &file, "Afr1953.zip", &dir.join("work"), &["BSB".to_string(), "KJV".to_string()]).unwrap();
        println!("{} ({}): {} verses, {} books, {} · {:?}", added.name, added.code, added.verses, added.books, added.language, added.warnings);
        assert_eq!(added.code, "AFR1953");
        assert_eq!(added.language, "Afrikaans");
        assert!(added.verses > 30_000 && added.books == 66);
        let john = crate::bibles::chapter(&bibles, "AFR1953", "John", 3).unwrap();
        let v16 = john.iter().find(|v| v.verse == 16).unwrap();
        println!("John 3:16: {}", v16.text);
        assert!(v16.text.contains("God"));
        let (hits, exact) = crate::bibles::search(&bibles, "AFR1953", "eniggebore Seun", None, None, 50).unwrap();
        println!("\"eniggebore Seun\": {} verses, {} word for word; first {} {}:{}", hits.len(), exact, hits[0].book, hits[0].chapter, hits[0].verse);
        assert!(hits.iter().any(|h| h.book == "John" && h.chapter == 3 && h.verse == 16));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
