//! The Library: free Bibles, commentaries, dictionaries, devotionals and books from the
//! CrossWire Bible Society's SWORD module repository, chosen and downloaded by the user
//! (internet needed only while downloading), converted once into `library.db` in the app's
//! data folder, and from then on shown offline in the same panels as the bundled texts:
//! Bibles in the translation list, commentaries in the Commentary panel, dictionaries in
//! the Dictionary panel, devotionals and books in the Books panel.
//!
//! Catalogue: crosswire.org .../raw/mods.d.tar.gz (every module's .conf); modules:
//! .../packages/rawzip/<Name>.zip. See sword.rs for the file formats, markup.rs for how
//! their markup becomes app text.

pub mod markup;
pub mod refs;
pub mod sword;

use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::commentaries::{CommentaryChapter, CommentaryHit, CommentaryInfo, CommentarySection};
use crate::models::{SearchHit, Verse, Version};
use crate::study::{DictionaryEntry, DictionaryHit, DictionaryInfo};
use markup::Kind;
use sword::Conf;

pub const CATALOG_URL: &str = "https://crosswire.org/ftpmirror/pub/sword/raw/mods.d.tar.gz";
pub const MODULE_URL: &str = "https://crosswire.org/ftpmirror/pub/sword/packages/rawzip/";

/// Library dictionary entries share the Dictionary panel's id space with the bundled
/// study.db entries; ids from here are offset so the two never collide.
pub const LIB_ID_BASE: i64 = 1_000_000_000;

pub struct LibraryState {
    pub conn: Mutex<Connection>,
    pub dir: PathBuf,
    /// modules being installed right now (a second click must not start a second install)
    pub busy: Mutex<HashSet<String>>,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS modules (
    name TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, lang TEXT NOT NULL,
    language TEXT NOT NULL, licence TEXT NOT NULL, about TEXT NOT NULL, version TEXT NOT NULL,
    versification TEXT NOT NULL, entries INTEGER NOT NULL DEFAULT 0,
    installed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS lib_verses (
    id INTEGER PRIMARY KEY, module TEXT NOT NULL, book TEXT NOT NULL, chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS lib_verses_loc ON lib_verses(module, book, chapter, verse);
CREATE VIRTUAL TABLE IF NOT EXISTS lib_verses_fts USING fts5(text, content='lib_verses', content_rowid='id');
CREATE TABLE IF NOT EXISTS lib_comm (
    id INTEGER PRIMARY KEY, module TEXT NOT NULL, book TEXT NOT NULL, chapter INTEGER NOT NULL,
    verse_start INTEGER NOT NULL, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS lib_comm_loc ON lib_comm(module, book, chapter, verse_start);
CREATE VIRTUAL TABLE IF NOT EXISTS lib_comm_fts USING fts5(text, content='lib_comm', content_rowid='id');
CREATE TABLE IF NOT EXISTS lib_dict (
    id INTEGER PRIMARY KEY, module TEXT NOT NULL, key TEXT NOT NULL, headword TEXT NOT NULL,
    headword_fold TEXT NOT NULL, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS lib_dict_head ON lib_dict(module, headword_fold);
CREATE INDEX IF NOT EXISTS lib_dict_fold ON lib_dict(headword_fold);
CREATE VIRTUAL TABLE IF NOT EXISTS lib_dict_fts USING fts5(headword, body, content='lib_dict', content_rowid='id');
CREATE TABLE IF NOT EXISTS lib_book (
    id INTEGER PRIMARY KEY, module TEXT NOT NULL, parent INTEGER, ord INTEGER NOT NULL,
    title TEXT NOT NULL, text TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS lib_book_ord ON lib_book(module, ord);
CREATE VIRTUAL TABLE IF NOT EXISTS lib_book_fts USING fts5(title, text, content='lib_book', content_rowid='id');
";

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn open(app_data: &Path) -> Result<LibraryState, String> {
    let dir = app_data.join("library");
    std::fs::create_dir_all(&dir).map_err(|e| format!("can't create {}: {e}", dir.display()))?;
    let conn = Connection::open(dir.join("library.db")).map_err(err)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;").map_err(err)?;
    conn.execute_batch(SCHEMA).map_err(err)?;
    migrate(&conn, &dir)?;
    Ok(LibraryState { conn: Mutex::new(conn), dir, busy: Mutex::new(HashSet::new()) })
}

fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
    conn.prepare(&format!("PRAGMA table_info({table})"))
        .and_then(|mut s| s.query_map([], |r| r.get::<_, String>(1))?.collect::<Result<Vec<_>, _>>())
        .map(|cols| cols.iter().any(|c| c == column))
        .unwrap_or(false)
}

/// Later additions to the schema, applied to libraries created before them:
/// `modules.features` (the module's Feature= tags, e.g. GreekDef) and `lib_dict.strongs`
/// (an entry's Strong's number in the app's form, "G25"/"H1254", for lexicons keyed by
/// Strong's numbers -- what Word Study looks up).
fn migrate(conn: &Connection, dir: &Path) -> Result<(), String> {
    if !has_column(conn, "modules", "features") {
        conn.execute_batch("ALTER TABLE modules ADD COLUMN features TEXT NOT NULL DEFAULT ''").map_err(err)?;
    }
    if !has_column(conn, "lib_dict", "strongs") {
        conn.execute_batch("ALTER TABLE lib_dict ADD COLUMN strongs TEXT").map_err(err)?;
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS lib_dict_strongs ON lib_dict(strongs)").map_err(err)?;
    // dictionaries installed before `features` existed: take their tags from the cached catalogue
    let missing: Vec<String> = conn
        .prepare("SELECT name FROM modules WHERE kind = 'dictionary' AND features = ''")
        .map_err(err)?
        .query_map([], |r| r.get(0))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    if missing.is_empty() {
        return Ok(());
    }
    let Ok(bytes) = std::fs::read(dir.join("mods.d.tar.gz")) else { return Ok(()) };
    let confs = parse_catalog(&bytes).unwrap_or_default();
    for name in missing {
        let Some(conf) = confs.iter().find(|c| c.name == name) else { continue };
        let features = conf.fields.get("Feature").map(|v| v.join(",")).unwrap_or_default();
        conn.execute("UPDATE modules SET features = ?2 WHERE name = ?1", params![name, if features.is_empty() { "-" } else { &features }]).map_err(err)?;
        let (greek, hebrew) = (features.contains("GreekDef"), features.contains("HebrewDef"));
        let rows: Vec<(i64, String)> = conn
            .prepare("SELECT id, key FROM lib_dict WHERE module = ?1 AND strongs IS NULL")
            .map_err(err)?
            .query_map(params![name], |r| Ok((r.get(0)?, r.get(1)?)))
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)?;
        for (id, key) in rows {
            if let Some(s) = strongs_of_key(&key, greek, hebrew) {
                conn.execute("UPDATE lib_dict SET strongs = ?2 WHERE id = ?1", params![id, s]).map_err(err)?;
            }
        }
    }
    Ok(())
}

/// A lexicon key as a Strong's number in the app's form: "00025", "00025\", "G0025",
/// "H25" -> "G25" / "H25". Bare numbers take their language from the module's
/// GreekDef/HebrewDef feature.
pub fn strongs_of_key(key: &str, greek: bool, hebrew: bool) -> Option<String> {
    let k = key.trim().trim_end_matches('\\').trim();
    let first = k.chars().next()?;
    let (prefix, digits) = match first {
        'G' | 'g' => (Some('G'), &k[1..]),
        'H' | 'h' => (Some('H'), &k[1..]),
        c if c.is_ascii_digit() => (None, k),
        _ => return None,
    };
    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let n: u32 = digits.parse().ok()?;
    if n == 0 {
        return None;
    }
    let lang = prefix.or(match (greek, hebrew) {
        (true, false) => Some('G'),
        (false, true) => Some('H'),
        _ => None,
    })?;
    Some(format!("{lang}{n}"))
}

/// The Greek/Hebrew word a lexicon entry is about, from its markup (<orth> or <foreign>).
fn entry_lemma(raw: &str) -> Option<String> {
    static WORD: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    static TAG: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let word = WORD.get_or_init(|| regex::Regex::new(r#"(?s)<(orth|foreign)\b([^>]*)>(.*?)</(?:orth|foreign)>"#).unwrap());
    let tag = TAG.get_or_init(|| regex::Regex::new(r"<[^>]*>").unwrap());
    let found = word
        .captures_iter(raw)
        .filter(|c| !c[2].contains("writing") && !c[2].contains("trans"))
        .map(|c| markup::unescape(&tag.replace_all(&c[3], "")).trim().to_string())
        .find(|s| !s.is_empty());
    found
}

/// Entries for one Strong's number ("G25") in the installed Library lexicons -- shown in
/// Word Study under the bundled Strong's definition.
pub fn lexicon_entries(conn: &Connection, strongs: &str) -> Result<Vec<DictionaryEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT d.id, d.module, m.title, d.headword, d.body FROM lib_dict d JOIN modules m ON m.name = d.module
             WHERE d.strongs = ?1 ORDER BY m.title, d.id",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![strongs], |r| {
            Ok(DictionaryEntry {
                id: LIB_ID_BASE + r.get::<_, i64>(0)?,
                dict_code: format!("{LIB_PREFIX}{}", r.get::<_, String>(1)?),
                dict_name: r.get(2)?,
                kind: "dictionary".into(),
                headword: r.get(3)?,
                body: r.get(4)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

// ---------------------------------------------------------------- catalogue

/// Works the app already ships, so the Library offers them as "already included" instead
/// of installing a second copy.
const BUILT_IN: &[(&str, &str)] = &[
    ("KJV", "The King James Version is built in."),
    ("ASV", "The American Standard Version is built in."),
    ("YLT", "Young's Literal Translation is built in."),
    ("BSB", "The Berean Standard Bible is built in."),
    ("WEB", "The World English Bible is built in."),
    ("TR", "The Textus Receptus (Greek) is built in."),
    ("WLC", "The Westminster Leningrad Codex (Hebrew) is built in."),
    ("Wesley", "John Wesley's Notes are built in (Commentary panel)."),
    ("Scofield", "The Scofield Reference Notes are built in (Commentary panel)."),
    ("MHC", "Matthew Henry's Complete Commentary is built in (Commentary panel)."),
    ("JFB", "Jamieson-Fausset-Brown is built in (Commentary panel)."),
    ("Clarke", "Adam Clarke's Commentary is built in (Commentary panel)."),
    ("CalvinCommentaries", "Calvin's Commentaries are built in (Commentary panel)."),
    ("KD", "Keil & Delitzsch is built in (Commentary panel)."),
    ("Easton", "Easton's Bible Dictionary is built in (Dictionary panel)."),
    ("Smith", "Smith's Bible Dictionary is built in (Dictionary panel)."),
    ("Nave", "Nave's Topical Bible is built in (Dictionary panel)."),
    ("Torrey", "Torrey's New Topical Textbook is built in (Dictionary panel)."),
];

pub fn language_name(code: &str) -> String {
    let base = code.split(['-', '_']).next().unwrap_or(code);
    match base {
        "en" => "English",
        "af" => "Afrikaans",
        "de" => "German",
        "fr" => "French",
        "nl" => "Dutch",
        "es" => "Spanish",
        "pt" => "Portuguese",
        "it" => "Italian",
        "grc" => "Greek (ancient)",
        "el" => "Greek",
        "hbo" => "Hebrew (ancient)",
        "he" => "Hebrew",
        "la" => "Latin",
        "ru" => "Russian",
        "uk" => "Ukrainian",
        "pl" => "Polish",
        "cs" => "Czech",
        "sk" => "Slovak",
        "hu" => "Hungarian",
        "ro" => "Romanian",
        "bg" => "Bulgarian",
        "sr" => "Serbian",
        "hr" => "Croatian",
        "sl" => "Slovenian",
        "fi" => "Finnish",
        "sv" => "Swedish",
        "da" => "Danish",
        "nb" | "no" => "Norwegian",
        "zh" => "Chinese",
        "ja" => "Japanese",
        "ko" => "Korean",
        "vi" => "Vietnamese",
        "ar" => "Arabic",
        "fa" => "Persian",
        "ur" => "Urdu",
        "hi" => "Hindi",
        "tr" => "Turkish",
        "sw" => "Swahili",
        "zu" => "Zulu",
        "xh" => "Xhosa",
        "tl" => "Tagalog",
        "cop" => "Coptic",
        "syr" => "Syriac",
        "eu" => "Basque",
        "hy" => "Armenian",
        "lv" => "Latvian",
        "lt" => "Lithuanian",
        "et" => "Estonian",
        "my" => "Burmese",
        "br" => "Breton",
        "gez" => "Ge'ez",
        _ => return code.to_string(),
    }
    .to_string()
}

/// What the app does with a module: "bible", "commentary", "dictionary", "devotional",
/// "book" -- or None for a driver it can't read.
pub fn kind_of(conf: &Conf) -> Option<&'static str> {
    Some(match conf.driver() {
        "zText" | "zText4" | "RawText" | "RawText4" => "bible",
        "zCom" | "zCom4" | "RawCom" | "RawCom4" => "commentary",
        "zLD" | "RawLD" | "RawLD4" => {
            if conf.has_value("Feature", "DailyDevotion") || conf.get("Category").is_some_and(|c| c.contains("Devotional")) {
                "devotional"
            } else {
                "dictionary"
            }
        }
        "RawGenBook" => "book",
        _ => return None,
    })
}

/// SWORD's About field is RTF-flavoured ("\par", "\qc"): plain text with line breaks.
pub fn clean_about(s: &str) -> String {
    let s = s.replace("\\par", "\n").replace("\\pard", "\n");
    let s = regex::Regex::new(r"\\[a-z]+\d*\s?").unwrap().replace_all(&s, "");
    let s = markup::unescape(&s);
    s.lines().map(str::trim).collect::<Vec<_>>().join("\n").trim().to_string()
}

#[derive(Serialize, Clone, Debug)]
pub struct CatalogItem {
    pub name: String,
    pub kind: String,
    pub title: String,
    pub lang: String,
    pub language: String,
    pub licence: String,
    pub about: String,
    pub size_kb: i64,
    pub version: String,
    pub category: String,
    /// CrossWire's own "Cults / Unorthodox / Questionable Material" category
    pub questionable: bool,
    pub supported: bool,
    /// why it can't be installed, or that the app already includes it
    pub note: Option<String>,
    pub built_in: bool,
    pub installed: bool,
    pub installed_version: Option<String>,
}

/// Why the app can't use a module, if it can't.
fn unsupported_reason(conf: &Conf) -> Option<String> {
    let Some(kind) = kind_of(conf) else {
        return Some(format!("This kind of module ({}) isn't supported yet.", conf.driver()));
    };
    if conf.get("CipherKey").is_some() {
        return Some("Locked by its publisher (needs an unlock key).".into());
    }
    if let Some(c) = conf.get("CompressType") {
        if !c.eq_ignore_ascii_case("ZIP") {
            return Some(format!("Uses {c} compression, which isn't supported yet."));
        }
    }
    if (kind == "bible" || kind == "commentary") && sword::canon(&conf.versification()).is_none() {
        return Some(format!("Uses the {} verse numbering, which isn't supported.", conf.get("Versification").unwrap_or("?")));
    }
    None
}

/// Every module in the catalogue archive (mods.d.tar.gz).
pub fn parse_catalog(targz: &[u8]) -> Result<Vec<Conf>, String> {
    let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(Cursor::new(targz)));
    let mut out = Vec::new();
    for entry in archive.entries().map_err(err)? {
        let mut entry = entry.map_err(err)?;
        let is_conf = entry.path().map(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("conf"))).unwrap_or(false);
        if !is_conf {
            continue;
        }
        let mut bytes = Vec::new();
        entry.read_to_end(&mut bytes).map_err(err)?;
        if let Some(c) = Conf::parse(&String::from_utf8_lossy(&bytes)) {
            out.push(c);
        }
    }
    Ok(out)
}

pub fn catalog_items(confs: &[Conf], conn: &Connection) -> Result<Vec<CatalogItem>, String> {
    let installed: HashMap<String, String> = conn
        .prepare("SELECT name, version FROM modules")
        .map_err(err)?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    let mut out: Vec<CatalogItem> = confs
        .iter()
        .filter_map(|c| {
            let kind = kind_of(c).unwrap_or("other");
            let lang = c.get("Lang").unwrap_or("").to_string();
            let built_in = BUILT_IN.iter().find(|(n, _)| *n == c.name).map(|(_, note)| note.to_string());
            let reason = unsupported_reason(c);
            let category = c.get("Category").unwrap_or("").to_string();
            Some(CatalogItem {
                name: c.name.clone(),
                kind: kind.to_string(),
                title: c.get("Description").unwrap_or(&c.name).to_string(),
                language: language_name(&lang),
                lang,
                licence: c.get("DistributionLicense").unwrap_or("See the module's notes").to_string(),
                about: clean_about(c.get("About").unwrap_or("")),
                size_kb: c.get("InstallSize").and_then(|s| s.parse::<i64>().ok()).map(|b| (b + 1023) / 1024).unwrap_or(0),
                version: c.get("Version").unwrap_or("").to_string(),
                questionable: category.contains("Cults") || category.contains("Questionable"),
                category,
                supported: reason.is_none() && built_in.is_none(),
                note: built_in.clone().or(reason),
                built_in: built_in.is_some(),
                installed: installed.contains_key(&c.name),
                installed_version: installed.get(&c.name).cloned(),
            })
        })
        .collect();
    out.sort_by(|a, b| a.language.cmp(&b.language).then(a.title.to_lowercase().cmp(&b.title.to_lowercase())));
    Ok(out)
}

// ---------------------------------------------------------------- install / remove

#[derive(Serialize, Clone, Debug)]
pub struct InstallReport {
    pub name: String,
    pub kind: String,
    pub title: String,
    pub entries: i64,
}

/// Unpacks a module .zip into a fresh folder (guarding against paths that escape it).
fn unzip(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| format!("not a module archive: {e}"))?;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(err)?;
        let Some(rel) = f.enclosed_name() else { continue };
        let path = dest.join(rel);
        if f.is_dir() {
            std::fs::create_dir_all(&path).map_err(err)?;
            continue;
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(err)?;
        }
        let mut out = std::fs::File::create(&path).map_err(err)?;
        std::io::copy(&mut f, &mut out).map_err(err)?;
    }
    Ok(())
}

fn find_conf(root: &Path, name: &str) -> Result<Conf, String> {
    let dir = root.join("mods.d");
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("no mods.d in the archive: {e}"))?;
    let mut first = None;
    for e in entries.flatten() {
        let text = std::fs::read(e.path()).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
        if let Some(c) = Conf::parse(&text) {
            if c.name.eq_ignore_ascii_case(name) {
                return Ok(c);
            }
            first.get_or_insert(c);
        }
    }
    first.ok_or_else(|| "no module description (.conf) in the archive".into())
}

fn fold(s: &str) -> String {
    s.to_lowercase()
}

fn delete_module_rows(tx: &Connection, name: &str) -> Result<(), String> {
    for (table, fts, cols) in [
        ("lib_verses", "lib_verses_fts", "text"),
        ("lib_comm", "lib_comm_fts", "text"),
        ("lib_dict", "lib_dict_fts", "headword, body"),
        ("lib_book", "lib_book_fts", "title, text"),
    ] {
        tx.execute(
            &format!("INSERT INTO {fts}({fts}, rowid, {cols}) SELECT 'delete', id, {cols} FROM {table} WHERE module = ?1"),
            params![name],
        )
        .map_err(err)?;
        tx.execute(&format!("DELETE FROM {table} WHERE module = ?1"), params![name]).map_err(err)?;
    }
    tx.execute("DELETE FROM modules WHERE name = ?1", params![name]).map_err(err)?;
    Ok(())
}

/// Converts an unpacked module into library.db. `progress` gets short stage names.
pub fn install_unpacked(conn: &mut Connection, root: &Path, name: &str, progress: &dyn Fn(&str)) -> Result<InstallReport, String> {
    let conf = find_conf(root, name)?;
    if let Some(reason) = unsupported_reason(&conf) {
        return Err(reason);
    }
    let kind = kind_of(&conf).unwrap_or("other");
    let source = conf.get("SourceType").unwrap_or("").to_string();
    let module = conf.name.clone();
    progress("reading");

    let tx = conn.transaction().map_err(err)?;
    delete_module_rows(&tx, &module)?;
    let mut entries: i64 = 0;
    match kind {
        "bible" => {
            let mut stmt = tx.prepare("INSERT INTO lib_verses(module, book, chapter, verse, text) VALUES (?1,?2,?3,?4,?5)").map_err(err)?;
            for e in sword::read_verse_module(root, &conf)? {
                let Some(book) = refs::osis_book(&e.osis_book) else { continue };
                if e.chapter == 0 || e.verse == 0 {
                    continue; // book and chapter introductions/headings
                }
                let text = markup::to_text(&e.text, &source, Kind::Bible);
                if text.is_empty() {
                    continue;
                }
                stmt.execute(params![module, book, e.chapter, e.verse, text]).map_err(err)?;
                entries += 1;
            }
        }
        "commentary" => {
            let mut stmt =
                tx.prepare("INSERT INTO lib_comm(module, book, chapter, verse_start, text) VALUES (?1,?2,?3,?4,?5)").map_err(err)?;
            let mut last_loc = None;
            for e in sword::read_verse_module(root, &conf)? {
                let Some(book) = refs::osis_book(&e.osis_book) else { continue };
                // consecutive verses pointing at the same note are one note on a range
                if last_loc == Some((e.osis_book.clone(), e.loc)) {
                    continue;
                }
                last_loc = Some((e.osis_book.clone(), e.loc));
                let text = markup::to_text(&e.text, &source, Kind::Commentary);
                if text.is_empty() {
                    continue;
                }
                stmt.execute(params![module, book, e.chapter, e.verse, text]).map_err(err)?;
                entries += 1;
            }
        }
        "dictionary" | "devotional" => {
            let mut stmt = tx
                .prepare("INSERT INTO lib_dict(module, key, headword, headword_fold, body, strongs) VALUES (?1,?2,?3,?4,?5,?6)")
                .map_err(err)?;
            let (greek, hebrew) = (conf.has_value("Feature", "GreekDef"), conf.has_value("Feature", "HebrewDef"));
            for (key, raw) in sword::read_lexicon(root, &conf)? {
                let body = markup::to_text(&raw, &source, Kind::Dictionary);
                if body.is_empty() {
                    continue;
                }
                // a lexicon keyed by Strong's numbers: index the number, and head the entry
                // with its Greek/Hebrew word rather than "00025"
                let strongs = if kind == "dictionary" { strongs_of_key(&key, greek, hebrew) } else { None };
                let head = match &strongs {
                    Some(s) => entry_lemma(&raw).map(|l| format!("{l} ({s})")).unwrap_or_else(|| s.clone()),
                    None => markup::headword(&key),
                };
                stmt.execute(params![module, key, head, fold(&head), body, strongs]).map_err(err)?;
                entries += 1;
            }
        }
        "book" => {
            let mut stmt = tx.prepare("INSERT INTO lib_book(module, parent, ord, title, text) VALUES (?1,?2,?3,?4,?5)").map_err(err)?;
            let mut ids: Vec<i64> = Vec::new();
            for (ord, n) in sword::read_genbook(root, &conf)?.into_iter().enumerate() {
                let parent = n.parent.and_then(|p| ids.get(p).copied());
                let text = markup::to_text(&n.text, &source, Kind::Book);
                let title = markup::unescape(n.title.trim());
                stmt.execute(params![module, parent, ord as i64, if title.is_empty() { "Untitled" } else { &title }, text]).map_err(err)?;
                ids.push(tx.last_insert_rowid());
                if !text.is_empty() {
                    entries += 1;
                }
            }
        }
        other => return Err(format!("unsupported module kind {other}")),
    }
    if entries == 0 {
        return Err("The module contained no text this app can read.".into());
    }
    progress("saving");
    for (table, fts, cols) in [
        ("lib_verses", "lib_verses_fts", "text"),
        ("lib_comm", "lib_comm_fts", "text"),
        ("lib_dict", "lib_dict_fts", "headword, body"),
        ("lib_book", "lib_book_fts", "title, text"),
    ] {
        tx.execute(&format!("INSERT INTO {fts}(rowid, {cols}) SELECT id, {cols} FROM {table} WHERE module = ?1"), params![module])
            .map_err(err)?;
    }
    let lang = conf.get("Lang").unwrap_or("").to_string();
    let features = conf.fields.get("Feature").map(|v| v.join(",")).filter(|f| !f.is_empty()).unwrap_or_else(|| "-".into());
    tx.execute(
        "INSERT INTO modules(name, kind, title, lang, language, licence, about, version, versification, entries, features)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![
            module,
            kind,
            conf.get("Description").unwrap_or(&module),
            lang,
            language_name(&lang),
            conf.get("DistributionLicense").unwrap_or(""),
            clean_about(conf.get("About").unwrap_or("")),
            conf.get("Version").unwrap_or(""),
            conf.versification(),
            entries,
            features
        ],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(InstallReport { name: module, kind: kind.into(), title: conf.get("Description").unwrap_or(&conf.name).to_string(), entries })
}

/// Unpacks `zip_bytes` into a temporary folder under the library folder, installs it, and
/// removes the folder again.
pub fn install_zip(state: &LibraryState, zip_bytes: &[u8], name: &str, progress: &dyn Fn(&str)) -> Result<InstallReport, String> {
    let tmp = state.dir.join("tmp").join(name);
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(err)?;
    progress("unpacking");
    let result = unzip(zip_bytes, &tmp).and_then(|_| {
        let mut conn = state.conn.lock().map_err(err)?;
        install_unpacked(&mut conn, &tmp, name, progress)
    });
    let _ = std::fs::remove_dir_all(&tmp);
    result
}

pub fn remove(conn: &mut Connection, name: &str) -> Result<(), String> {
    let tx = conn.transaction().map_err(err)?;
    delete_module_rows(&tx, name)?;
    tx.commit().map_err(err)
}

// ---------------------------------------------------------------- installed modules

#[derive(Serialize, Clone, Debug)]
pub struct InstalledModule {
    pub name: String,
    pub kind: String,
    pub title: String,
    pub language: String,
    pub licence: String,
    pub about: String,
    pub version: String,
    pub entries: i64,
    pub installed_at: String,
}

pub fn installed(conn: &Connection, kind: Option<&str>) -> Result<Vec<InstalledModule>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT name, kind, title, language, licence, about, version, entries, installed_at FROM modules
             WHERE ?1 IS NULL OR kind = ?1 ORDER BY title",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![kind], |r| {
            Ok(InstalledModule {
                name: r.get(0)?,
                kind: r.get(1)?,
                title: r.get(2)?,
                language: r.get(3)?,
                licence: r.get(4)?,
                about: r.get(5)?,
                version: r.get(6)?,
                entries: r.get(7)?,
                installed_at: r.get(8)?,
            })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

// ---------------------------------------------------------------- Bibles

pub fn versions(conn: &Connection) -> Result<Vec<Version>, String> {
    Ok(installed(conn, Some("bible"))?
        .into_iter()
        .map(|m| {
            let lang = conn.query_row("SELECT lang FROM modules WHERE name = ?1", params![m.name], |r| r.get::<_, String>(0)).unwrap_or_default();
            Version { code: m.name, name: m.title, language: m.language, is_original_language: matches!(lang.as_str(), "grc" | "hbo" | "he") }
        })
        .collect())
}

pub fn is_bible(conn: &Connection, code: &str) -> bool {
    conn.query_row("SELECT 1 FROM modules WHERE name = ?1 AND kind = 'bible'", params![code], |_| Ok(())).optional().ok().flatten().is_some()
}

pub fn chapter(conn: &Connection, code: &str, book: &str, chapter: i64) -> Result<Vec<Verse>, String> {
    let mut stmt = conn
        .prepare("SELECT verse, text FROM lib_verses WHERE module = ?1 AND book = ?2 AND chapter = ?3 ORDER BY verse")
        .map_err(err)?;
    let rows = stmt
        .query_map(params![code, book, chapter], |r| Ok(Verse { book: book.to_string(), chapter, verse: r.get(0)?, text: r.get(1)? }))
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

pub fn verse(conn: &Connection, code: &str, book: &str, chapter: i64, verse: i64) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT text FROM lib_verses WHERE module = ?1 AND book = ?2 AND chapter = ?3 AND verse = ?4",
        params![code, book, chapter, verse],
        |r| r.get(0),
    )
    .optional()
    .map_err(err)
}

pub fn verse_range(conn: &Connection, code: &str, book: &str, chapter: i64, start: i64, end: i64) -> Result<Vec<(i64, String)>, String> {
    let mut stmt = conn
        .prepare("SELECT verse, text FROM lib_verses WHERE module = ?1 AND book = ?2 AND chapter = ?3 AND verse BETWEEN ?4 AND ?5 ORDER BY verse")
        .map_err(err)?;
    let rows = stmt.query_map(params![code, book, chapter, start, end], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

pub fn search_bible(conn: &Connection, code: &str, query: &str, limit: i64) -> Result<Vec<SearchHit>, String> {
    let q = format!("\"{}\"", query.replace('"', "\"\""));
    let mut stmt = conn
        .prepare(
            "SELECT v.book, v.chapter, v.verse, v.text FROM lib_verses_fts f JOIN lib_verses v ON v.id = f.rowid
             WHERE lib_verses_fts MATCH ?1 AND v.module = ?2 ORDER BY f.rank LIMIT ?3",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![q, code, limit], |r| {
            Ok(SearchHit { version_code: code.to_string(), book: r.get(0)?, chapter: r.get(1)?, verse: r.get(2)?, text: r.get(3)? })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

// ---------------------------------------------------------------- commentaries

pub const LIB_PREFIX: &str = "lib:";

pub fn commentaries(conn: &Connection) -> Result<Vec<CommentaryInfo>, String> {
    Ok(installed(conn, Some("commentary"))?
        .into_iter()
        .map(|m| CommentaryInfo {
            id: format!("{LIB_PREFIX}{}", m.name),
            name: m.title,
            website: Some("crosswire.org (Library)".into()),
            license_name: Some(m.licence),
            license_url: None,
        })
        .collect())
}

pub fn commentary_chapter(conn: &Connection, id: &str, book: &str, chapter: i64) -> Result<CommentaryChapter, String> {
    let module = id.trim_start_matches(LIB_PREFIX);
    let book_introduction: Option<String> = if chapter == 1 {
        conn.query_row("SELECT text FROM lib_comm WHERE module = ?1 AND book = ?2 AND chapter = 0", params![module, book], |r| r.get(0))
            .optional()
            .map_err(err)?
    } else {
        None
    };
    let mut stmt = conn
        .prepare("SELECT id, verse_start, text FROM lib_comm WHERE module = ?1 AND book = ?2 AND chapter = ?3 ORDER BY verse_start")
        .map_err(err)?;
    let mut chapter_introduction = None;
    let mut sections = Vec::new();
    for row in stmt.query_map(params![module, book, chapter], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))).map_err(err)? {
        let (id, verse_start, text) = row.map_err(err)?;
        if verse_start == 0 {
            chapter_introduction = Some(text);
        } else {
            sections.push(CommentarySection { id, verse_start, text });
        }
    }
    Ok(CommentaryChapter { commentary_id: id.to_string(), book: book.to_string(), chapter, book_introduction, chapter_introduction, sections })
}

pub fn search_commentaries(conn: &Connection, query: &str, id: Option<&str>, limit: i64) -> Result<Vec<CommentaryHit>, String> {
    let Some(expr) = crate::study::fts_expr(query) else { return Ok(Vec::new()) };
    let module = id.map(|i| i.trim_start_matches(LIB_PREFIX).to_string());
    let mut stmt = conn
        .prepare(
            "SELECT c.module, m.title, c.book, c.chapter, c.verse_start, c.text FROM lib_comm_fts f
             JOIN lib_comm c ON c.id = f.rowid JOIN modules m ON m.name = c.module
             WHERE lib_comm_fts MATCH ?1 AND (?2 IS NULL OR c.module = ?2) ORDER BY f.rank LIMIT ?3",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![expr, module, limit], |r| {
            let text: String = r.get(5)?;
            Ok(CommentaryHit {
                commentary_id: format!("{LIB_PREFIX}{}", r.get::<_, String>(0)?),
                commentary_name: r.get(1)?,
                book: r.get(2)?,
                chapter: r.get(3)?,
                verse_start: r.get(4)?,
                snippet: crate::study::plain_snippet(&text, 200),
            })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

// ---------------------------------------------------------------- dictionaries

pub fn dictionaries(conn: &Connection) -> Result<Vec<DictionaryInfo>, String> {
    Ok(installed(conn, Some("dictionary"))?
        .into_iter()
        .map(|m| DictionaryInfo { code: format!("{LIB_PREFIX}{}", m.name), name: m.title, kind: "dictionary".into(), entry_count: m.entries })
        .collect())
}

/// Headword matches first (exact, then prefix), then full-text matches; dictionaries only
/// (devotionals are read in the Books panel).
pub fn search_dictionaries(conn: &Connection, query: &str, code: Option<&str>, limit: i64) -> Result<Vec<DictionaryHit>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let module = code.map(|c| c.trim_start_matches(LIB_PREFIX).to_string());
    let mut hits = Vec::new();
    let mut seen = HashSet::new();
    let like = format!("{}%", q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
    let mut stmt = conn
        .prepare(
            "SELECT d.id, d.module, m.title, d.headword, d.body FROM lib_dict d JOIN modules m ON m.name = d.module
             WHERE m.kind = 'dictionary' AND (d.headword_fold = ?1 OR d.headword_fold LIKE ?2 ESCAPE '\\') AND (?3 IS NULL OR d.module = ?3)
             ORDER BY (d.headword_fold = ?1) DESC, length(d.headword_fold) LIMIT ?4",
        )
        .map_err(err)?;
    let map = |r: &rusqlite::Row| -> rusqlite::Result<(i64, String, String, String, String)> { Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)) };
    for row in stmt.query_map(params![q, like, module, limit], map).map_err(err)? {
        let (id, m, title, head, body) = row.map_err(err)?;
        seen.insert(id);
        hits.push(DictionaryHit { id: LIB_ID_BASE + id, dict_code: format!("{LIB_PREFIX}{m}"), dict_name: title, headword: head, snippet: crate::study::plain_snippet(&body, 160) });
    }
    if (hits.len() as i64) < limit {
        if let Some(expr) = crate::study::fts_expr(&q) {
            let mut stmt = conn
                .prepare(
                    "SELECT d.id, d.module, m.title, d.headword, d.body FROM lib_dict_fts f JOIN lib_dict d ON d.id = f.rowid
                     JOIN modules m ON m.name = d.module
                     WHERE lib_dict_fts MATCH ?1 AND m.kind = 'dictionary' AND (?2 IS NULL OR d.module = ?2) ORDER BY f.rank LIMIT ?3",
                )
                .map_err(err)?;
            for row in stmt.query_map(params![expr, module, limit], map).map_err(err)? {
                let (id, m, title, head, body) = row.map_err(err)?;
                if hits.len() as i64 >= limit {
                    break;
                }
                if seen.insert(id) {
                    hits.push(DictionaryHit { id: LIB_ID_BASE + id, dict_code: format!("{LIB_PREFIX}{m}"), dict_name: title, headword: head, snippet: crate::study::plain_snippet(&body, 160) });
                }
            }
        }
    }
    Ok(hits)
}

pub fn dictionary_entry(conn: &Connection, id: i64) -> Result<Option<DictionaryEntry>, String> {
    conn.query_row(
        "SELECT d.id, d.module, m.title, d.headword, d.body FROM lib_dict d JOIN modules m ON m.name = d.module WHERE d.id = ?1",
        params![id - LIB_ID_BASE],
        |r| {
            Ok(DictionaryEntry {
                id: LIB_ID_BASE + r.get::<_, i64>(0)?,
                dict_code: format!("{LIB_PREFIX}{}", r.get::<_, String>(1)?),
                dict_name: r.get(2)?,
                kind: "dictionary".into(),
                headword: r.get(3)?,
                body: r.get(4)?,
            })
        },
    )
    .optional()
    .map_err(err)
}

// ---------------------------------------------------------------- books and devotionals

#[derive(Serialize, Clone, Debug)]
pub struct TocEntry {
    pub id: i64,
    pub parent: Option<i64>,
    pub title: String,
    pub has_text: bool,
}

/// A book's table of contents; for a devotional, its dated entries (in their own order).
pub fn toc(conn: &Connection, module: &str) -> Result<Vec<TocEntry>, String> {
    let kind: String = conn.query_row("SELECT kind FROM modules WHERE name = ?1", params![module], |r| r.get(0)).map_err(err)?;
    if kind == "devotional" {
        let mut stmt = conn.prepare("SELECT id, headword FROM lib_dict WHERE module = ?1 ORDER BY id").map_err(err)?;
        let rows = stmt
            .query_map(params![module], |r| Ok(TocEntry { id: LIB_ID_BASE + r.get::<_, i64>(0)?, parent: None, title: r.get(1)?, has_text: true }))
            .map_err(err)?;
        return rows.collect::<Result<_, _>>().map_err(err);
    }
    let mut stmt = conn.prepare("SELECT id, parent, title, length(text) > 0 FROM lib_book WHERE module = ?1 ORDER BY ord").map_err(err)?;
    let rows = stmt.query_map(params![module], |r| Ok(TocEntry { id: r.get(0)?, parent: r.get(1)?, title: r.get(2)?, has_text: r.get(3)? })).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[derive(Serialize, Clone, Debug)]
pub struct Section {
    pub id: i64,
    pub module: String,
    pub module_title: String,
    pub title: String,
    pub text: String,
    pub prev: Option<i64>,
    pub next: Option<i64>,
}

/// One section of a book (or, with an id >= LIB_ID_BASE, one devotional entry), with the
/// neighbouring sections that have text, for Previous/Next.
pub fn section(conn: &Connection, id: i64) -> Result<Option<Section>, String> {
    if id >= LIB_ID_BASE {
        let row: Option<(String, String, String)> = conn
            .query_row("SELECT module, headword, body FROM lib_dict WHERE id = ?1", params![id - LIB_ID_BASE], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .optional()
            .map_err(err)?;
        let Some((module, title, text)) = row else { return Ok(None) };
        let raw = id - LIB_ID_BASE;
        let near = |sql: &str| conn.query_row(sql, params![module, raw], |r| r.get::<_, i64>(0)).optional().map(|o| o.map(|v| v + LIB_ID_BASE));
        let prev = near("SELECT id FROM lib_dict WHERE module = ?1 AND id < ?2 ORDER BY id DESC LIMIT 1").map_err(err)?;
        let next = near("SELECT id FROM lib_dict WHERE module = ?1 AND id > ?2 ORDER BY id LIMIT 1").map_err(err)?;
        let module_title = conn.query_row("SELECT title FROM modules WHERE name = ?1", params![module], |r| r.get(0)).unwrap_or_default();
        return Ok(Some(Section { id, module, module_title, title, text, prev, next }));
    }
    let row: Option<(String, i64, String, String)> = conn
        .query_row("SELECT module, ord, title, text FROM lib_book WHERE id = ?1", params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .optional()
        .map_err(err)?;
    let Some((module, ord, title, text)) = row else { return Ok(None) };
    let near = |sql: &str| conn.query_row(sql, params![module, ord], |r| r.get::<_, i64>(0)).optional();
    let prev = near("SELECT id FROM lib_book WHERE module = ?1 AND ord < ?2 AND length(text) > 0 ORDER BY ord DESC LIMIT 1").map_err(err)?;
    let next = near("SELECT id FROM lib_book WHERE module = ?1 AND ord > ?2 AND length(text) > 0 ORDER BY ord LIMIT 1").map_err(err)?;
    let module_title = conn.query_row("SELECT title FROM modules WHERE name = ?1", params![module], |r| r.get(0)).unwrap_or_default();
    Ok(Some(Section { id, module, module_title, title, text, prev, next }))
}

#[derive(Serialize, Clone, Debug)]
pub struct BookHit {
    pub id: i64,
    pub module: String,
    pub module_title: String,
    pub title: String,
    pub snippet: String,
}

/// Full-text search across installed books (or one book or devotional).
pub fn search_books(conn: &Connection, query: &str, module: Option<&str>, limit: i64) -> Result<Vec<BookHit>, String> {
    let Some(expr) = crate::study::fts_expr(query) else { return Ok(Vec::new()) };
    let kind: Option<String> = match module {
        Some(m) => conn.query_row("SELECT kind FROM modules WHERE name = ?1", params![m], |r| r.get(0)).optional().map_err(err)?,
        None => None,
    };
    if kind.as_deref() == Some("devotional") {
        // devotional entries live in lib_dict, keyed by date
        let mut stmt = conn
            .prepare(
                "SELECT d.id, d.module, m.title, d.headword, d.body FROM lib_dict_fts f JOIN lib_dict d ON d.id = f.rowid
                 JOIN modules m ON m.name = d.module WHERE lib_dict_fts MATCH ?1 AND d.module = ?2 ORDER BY d.id LIMIT ?3",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map(params![expr, module, limit], |r| {
                let text: String = r.get(4)?;
                Ok(BookHit { id: LIB_ID_BASE + r.get::<_, i64>(0)?, module: r.get(1)?, module_title: r.get(2)?, title: r.get(3)?, snippet: crate::study::plain_snippet(&text, 200) })
            })
            .map_err(err)?;
        return rows.collect::<Result<_, _>>().map_err(err);
    }
    let mut stmt = conn
        .prepare(
            "SELECT b.id, b.module, m.title, b.title, b.text FROM lib_book_fts f JOIN lib_book b ON b.id = f.rowid
             JOIN modules m ON m.name = b.module WHERE lib_book_fts MATCH ?1 AND (?2 IS NULL OR b.module = ?2)
             ORDER BY f.rank LIMIT ?3",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![expr, module, limit], |r| {
            let text: String = r.get(4)?;
            Ok(BookHit { id: r.get(0)?, module: r.get(1)?, module_title: r.get(2)?, title: r.get(3)?, snippet: crate::study::plain_snippet(&text, 200) })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Parses the real CrossWire catalogue (downloaded to library-probe\mods.d.tar.gz).
    #[test]
    #[ignore]
    fn parses_real_catalog() {
        let path = PathBuf::from(std::env::var("LOCALAPPDATA").unwrap()).join("bible-concordance-build/library-probe/mods.d.tar.gz");
        let confs = parse_catalog(&std::fs::read(path).unwrap()).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        let items = catalog_items(&confs, &conn).unwrap();
        let count = |f: &dyn Fn(&CatalogItem) -> bool| items.iter().filter(|i| f(i)).count();
        println!(
            "{} modules; {} installable; {} built in; {} questionable; english installable {}",
            items.len(),
            count(&|i| i.supported),
            count(&|i| i.built_in),
            count(&|i| i.questionable),
            count(&|i| i.supported && i.language == "English")
        );
        for i in items.iter().filter(|i| !i.supported && !i.built_in && i.language == "English") {
            println!("  not supported: {} ({}) — {}", i.name, i.kind, i.note.as_deref().unwrap_or(""));
        }
        let afr = items.iter().find(|i| i.name == "Afr1953").unwrap();
        println!("Afr1953: {} / {} / {} KB / {} / about: {}", afr.language, afr.licence, afr.size_kb, afr.kind, afr.about.chars().take(120).collect::<String>());
        assert!(items.len() > 400);
    }

    /// Installs real downloaded modules (one per format) into a temporary library and
    /// checks the text that comes out. Needs the sample zips from CrossWire in
    /// %LOCALAPPDATA%\bible-concordance-build\library-probe\zips (see HANDOVER.md):
    ///   cargo test library -- --ignored --nocapture
    #[test]
    #[ignore]
    fn installs_real_modules() {
        let zips = PathBuf::from(std::env::var("LOCALAPPDATA").unwrap()).join("bible-concordance-build/library-probe/zips");
        let dir = std::env::temp_dir().join(format!("bc-library-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = open(&dir).unwrap();
        let noop = |_: &str| {};
        let mut names: Vec<String> = std::fs::read_dir(&zips).unwrap().flatten().map(|e| e.path().file_stem().unwrap().to_string_lossy().into_owned()).collect();
        names.sort();
        for name in &names {
            let bytes = std::fs::read(zips.join(format!("{name}.zip"))).unwrap();
            let t = std::time::Instant::now();
            match install_zip(&state, &bytes, name, &noop) {
                Ok(r) => println!("{name:<12} {:<11} {:>7} entries  {:>6.1?}  {}", r.kind, r.entries, t.elapsed(), r.title),
                Err(e) => println!("{name:<12} FAILED: {e}"),
            }
        }
        let conn = state.conn.lock().unwrap();
        for (code, b, c, v) in [("Geneva1599", "Genesis", 1, 1), ("Afr1953", "John", 3, 16), ("DRC", "John", 3, 16), ("JPS", "Genesis", 1, 1), ("KJVA", "John", 11, 35)] {
            println!("{code} {b} {c}:{v}: {:?}", verse(&conn, code, b, c, v).unwrap());
        }
        let ch = commentary_chapter(&conn, "lib:Barnes", "John", 3).unwrap();
        println!("Barnes John 3: {} sections; v{} {}", ch.sections.len(), ch.sections.first().map(|s| s.verse_start).unwrap_or(0), ch.sections.first().map(|s| s.text.chars().take(200).collect::<String>()).unwrap_or_default());
        let ch = commentary_chapter(&conn, "lib:DTN", "Matthew", 5).unwrap();
        println!("DTN Matt 5: {} notes; first v{}: {}", ch.sections.len(), ch.sections.first().map(|s| s.verse_start).unwrap_or(0), ch.sections.first().map(|s| s.text.chars().take(160).collect::<String>()).unwrap_or_default());
        let ch = commentary_chapter(&conn, "lib:TDavid", "Psalms", 23).unwrap();
        println!("TDavid Ps 23: {} sections, intro: {:?}", ch.sections.len(), ch.chapter_introduction.as_deref().map(|s| s.chars().take(120).collect::<String>()));
        for q in ["aaron", "jerusalem"] {
            for h in search_dictionaries(&conn, q, None, 3).unwrap() {
                println!("dict '{q}': {} — {} — {}", h.dict_name, h.headword, h.snippet.chars().take(100).collect::<String>());
            }
        }
        for m in ["Josephus", "Pilgrim", "Westminster", "SME", "Daily"] {
            let Ok(t) = toc(&conn, m) else {
                println!("{m}: not installed");
                continue;
            };
            let first = t.iter().find(|e| e.has_text).unwrap();
            let s = section(&conn, first.id).unwrap().unwrap();
            println!("{m}: {} toc entries; first '{}' -> {}", t.len(), s.title, s.text.chars().take(160).collect::<String>().replace('\n', " / "));
        }
        for s in ["G25", "H1254"] {
            for e in lexicon_entries(&conn, s).unwrap() {
                println!("lexicon {s}: {} — {} — {}", e.dict_name, e.headword, e.body.chars().take(110).collect::<String>().replace('\n', " / "));
            }
        }
        assert!(lexicon_entries(&conn, "G25").unwrap().len() >= 4, "Strong's-keyed Greek lexicons should all have G25");
        drop(conn);
        remove(&mut state.conn.lock().unwrap(), "Barnes").unwrap();
        assert!(commentaries(&state.conn.lock().unwrap()).unwrap().iter().all(|c| c.id != "lib:Barnes"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
