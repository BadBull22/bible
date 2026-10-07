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

pub mod epub;
pub mod markup;
pub mod pdf;
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

/// A repository of SWORD modules the Library can browse: its catalogue (`mods.d.tar.gz`)
/// and the folder of per-module zips. All are fetched over HTTPS. The list follows
/// CrossWire's own master list of repositories (masterRepoList.conf), minus the ones that
/// are FTP-only or hold only locked (paid) modules.
#[derive(Serialize, Clone, Copy, Debug)]
pub struct Source {
    pub id: &'static str,
    pub name: &'static str,
    pub about: &'static str,
    #[serde(skip)]
    pub catalog_url: &'static str,
    #[serde(skip)]
    pub zip_url: &'static str,
}

pub const SOURCES: &[Source] = &[
    Source {
        id: "crosswire",
        name: "CrossWire",
        about: "The main CrossWire Bible Society library: Bibles, commentaries, dictionaries, devotionals and books.",
        catalog_url: "https://crosswire.org/ftpmirror/pub/sword/raw/mods.d.tar.gz",
        zip_url: "https://crosswire.org/ftpmirror/pub/sword/packages/rawzip/",
    },
    Source {
        id: "ebible",
        name: "eBible.org",
        about: "About 1,500 Bibles and Bible portions in a very wide range of languages, from eBible.org.",
        catalog_url: "https://ebible.org/sword/mods.d.tar.gz",
        zip_url: "https://ebible.org/sword/zip/",
    },
    Source {
        id: "attic",
        name: "CrossWire Attic",
        about: "Older works CrossWire has retired from its main library, often replaced by newer editions.",
        catalog_url: "https://crosswire.org/ftpmirror/pub/sword/atticraw/mods.d.tar.gz",
        zip_url: "https://crosswire.org/ftpmirror/pub/sword/atticpackages/rawzip/",
    },
    Source {
        id: "wycliffe",
        name: "Wycliffe",
        about: "Bibles in minority languages from Wycliffe Bible Translators, hosted by CrossWire.",
        catalog_url: "https://crosswire.org/ftpmirror/pub/sword/wyclifferaw/mods.d.tar.gz",
        zip_url: "https://crosswire.org/ftpmirror/pub/sword/wycliffepackages/rawzip/",
    },
    Source {
        id: "netbible",
        name: "NET Bible (bible.org)",
        about: "The NET Bible's free edition from bible.org. The full edition with all notes is locked by its publisher.",
        catalog_url: "https://crosswire.org/ftpmirror/pub/bible.org/sword/mods.d.tar.gz",
        zip_url: "https://crosswire.org/ftpmirror/pub/bible.org/sword/packages/",
    },
    Source {
        id: "beta",
        name: "CrossWire Beta",
        about: "Works CrossWire is still testing. They may have mistakes.",
        catalog_url: "https://crosswire.org/ftpmirror/pub/sword/betaraw/mods.d.tar.gz",
        zip_url: "https://crosswire.org/ftpmirror/pub/sword/betapackages/rawzip/",
    },
];

/// `modules.source` for something the reader added from a file of their own.
pub const SOURCE_FILE: &str = "file";

pub fn source(id: &str) -> Option<&'static Source> {
    SOURCES.iter().find(|s| s.id == id)
}

/// Where a source's catalogue is cached in the library folder.
pub fn catalog_cache(dir: &Path, source: &Source) -> PathBuf {
    if source.id == "crosswire" {
        dir.join("mods.d.tar.gz") // its name before there were other sources
    } else {
        dir.join(format!("mods.d.{}.tar.gz", source.id))
    }
}

/// A module name the app accepts: it becomes part of file paths and of the translation code.
pub fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

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
    if !has_column(conn, "modules", "source") {
        conn.execute_batch("ALTER TABLE modules ADD COLUMN source TEXT NOT NULL DEFAULT 'crosswire'").map_err(err)?;
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
    /// id of the source (repository) this entry comes from
    pub source: String,
}

/// Why the app can't use a module, if it can't.
fn unsupported_reason(conf: &Conf) -> Option<String> {
    if !valid_name(&conf.name) {
        return Some("Its name has characters the app can't use.".into());
    }
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

pub fn catalog_items(confs: &[Conf], conn: &Connection, source: &str) -> Result<Vec<CatalogItem>, String> {
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
                source: source.to_string(),
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
    /// verses, notes, entries or sections with text
    pub entries: i64,
    /// Bibles and commentaries: how many of the 66 books have text
    pub books: i64,
    pub language: String,
    pub licence: String,
    /// things the reader should know before installing a file of their own
    pub warnings: Vec<String>,
    /// title of an installed work this one would replace
    pub replaces: Option<String>,
}

/// How a module is being installed.
#[derive(Clone, Copy)]
pub struct InstallOptions<'a> {
    /// a `Source` id, or `SOURCE_FILE`
    pub source: &'a str,
    /// a file the reader supplied: refuse anything doubtful instead of installing what can be read
    pub strict: bool,
    /// false = a trial run that reports what would be installed and changes nothing
    pub commit: bool,
}

const MAX_ZIP_FILES: usize = 4000;
const MAX_UNPACKED_BYTES: u64 = 800 * 1024 * 1024;

/// Unpacks a module .zip into a fresh folder (guarding against paths that escape it, and
/// against archives that unpack to something enormous). `strict` is for a file the reader
/// supplied: it must hold exactly one module and nothing else.
fn unzip(bytes: &[u8], dest: &Path, strict: bool) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "This isn't a zip file the app can open.".to_string())?;
    if zip.len() > MAX_ZIP_FILES {
        return Err("The archive has too many files to be a single module.".into());
    }
    let mut total: u64 = 0;
    let mut confs = 0;
    for i in 0..zip.len() {
        let f = zip.by_index(i).map_err(err)?;
        total += f.size();
        if f.is_dir() {
            continue;
        }
        let Some(rel) = f.enclosed_name() else {
            return Err("The archive has a file path the app won't unpack.".into());
        };
        let parts: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().to_lowercase()).collect();
        let is_conf = parts.len() == 2 && parts[0] == "mods.d" && parts[1].ends_with(".conf");
        if is_conf {
            confs += 1;
        }
        if strict && !is_conf && parts.first().map(String::as_str) != Some("modules") {
            return Err(format!(
                "This isn't a SWORD module: it contains \"{}\". A module zip holds only a mods.d folder and a modules folder.",
                rel.display()
            ));
        }
    }
    if total > MAX_UNPACKED_BYTES {
        return Err("The archive unpacks to more than 800 MB, which is too large for a module.".into());
    }
    if strict && confs != 1 {
        return Err(if confs == 0 {
            "This isn't a SWORD module: there is no module description (mods.d/*.conf) in the zip.".to_string()
        } else {
            format!("The zip holds {confs} modules. Add them one at a time, each in its own zip.")
        });
    }
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
pub fn install_unpacked(conn: &mut Connection, root: &Path, name: &str, opts: InstallOptions, progress: &dyn Fn(&str)) -> Result<InstallReport, String> {
    let conf = find_conf(root, name)?;
    if let Some(reason) = unsupported_reason(&conf) {
        return Err(reason);
    }
    if opts.strict {
        if let Some((_, note)) = BUILT_IN.iter().find(|(n, _)| n.eq_ignore_ascii_case(&conf.name)) {
            return Err(note.to_string());
        }
    }
    let kind = kind_of(&conf).unwrap_or("other");
    let source = conf.get("SourceType").unwrap_or("").to_string();
    let module = conf.name.clone();
    progress("reading");

    let tx = conn.transaction().map_err(err)?;
    let replaces: Option<String> = tx.query_row("SELECT title FROM modules WHERE name = ?1", params![module], |r| r.get(0)).optional().map_err(err)?;
    delete_module_rows(&tx, &module)?;
    let mut entries: i64 = 0;
    // books of a Bible/commentary the app has no name for
    let mut other_books: HashSet<String> = HashSet::new();
    // books of a Bible beyond the 66 (the Apocrypha) that are kept
    let mut apocrypha: HashSet<&'static str> = HashSet::new();
    match kind {
        "bible" => {
            let mut stmt = tx.prepare("INSERT INTO lib_verses(module, book, chapter, verse, text) VALUES (?1,?2,?3,?4,?5)").map_err(err)?;
            for e in sword::read_verse_module(root, &conf)? {
                let extra = refs::apocrypha_book(&e.osis_book);
                let Some(book) = refs::osis_book(&e.osis_book).or(extra) else {
                    other_books.insert(e.osis_book.clone());
                    continue;
                };
                if e.chapter == 0 || e.verse == 0 {
                    continue; // book and chapter introductions/headings
                }
                let text = markup::to_text(&e.text, &source, Kind::Bible);
                if text.is_empty() {
                    continue;
                }
                if let Some(x) = extra {
                    apocrypha.insert(x);
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
    let (table, text_col) = match kind {
        "bible" => ("lib_verses", "text"),
        "commentary" => ("lib_comm", "text"),
        "book" => ("lib_book", "text"),
        _ => ("lib_dict", "body"),
    };
    let books: i64 = if kind == "bible" || kind == "commentary" {
        tx.query_row(&format!("SELECT count(DISTINCT book) FROM {table} WHERE module = ?1"), params![module], |r| r.get(0)).map_err(err)?
    } else {
        0
    };
    let mut warnings: Vec<String> = Vec::new();
    if opts.strict {
        // text that didn't decode cleanly shows as U+FFFD: a little is a damaged character,
        // a lot means the file's encoding is wrong and it would read as rubbish
        let garbled: i64 = tx
            .query_row(&format!("SELECT count(*) FROM {table} WHERE module = ?1 AND instr({text_col}, char(65533)) > 0"), params![module], |r| r.get(0))
            .map_err(err)?;
        if garbled * 100 > entries {
            return Err(format!("The text doesn't read correctly ({garbled} of {entries} entries have unreadable characters), so it wasn't added."));
        }
        if garbled > 0 {
            warnings.push(format!("{garbled} of {entries} entries have a character that couldn't be read."));
        }
        if kind == "bible" && entries < 20 {
            return Err(format!("Only {entries} verses could be read, which is too few to be a Bible or a Bible book."));
        }
        let canonical = books - apocrypha.len() as i64;
        if kind == "bible" && canonical < 66 {
            warnings.push(format!("It has {canonical} of the 66 books of the Bible."));
        }
    }
    if !apocrypha.is_empty() {
        warnings.push(format!(
            "It also has {} book(s) of the Apocrypha. They are listed under Apocrypha in the book list while you read this Bible.",
            apocrypha.len()
        ));
    }
    if !other_books.is_empty() {
        warnings.push(format!("{} book(s) the app has no name for are left out.", other_books.len()));
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
        "INSERT INTO modules(name, kind, title, lang, language, licence, about, version, versification, entries, features, source)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
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
            features,
            opts.source
        ],
    )
    .map_err(err)?;
    if opts.commit {
        tx.commit().map_err(err)?;
    } // otherwise the transaction rolls back as it drops: nothing changed
    Ok(InstallReport {
        name: module,
        kind: kind.into(),
        title: conf.get("Description").unwrap_or(&conf.name).to_string(),
        entries,
        books,
        language: language_name(&lang),
        licence: conf.get("DistributionLicense").unwrap_or("").to_string(),
        warnings,
        replaces,
    })
}

/// Unpacks `zip_bytes` into a temporary folder under the library folder, installs it, and
/// removes the folder again. `source` is the id of the repository it was downloaded from.
pub fn install_zip(state: &LibraryState, zip_bytes: &[u8], name: &str, source: &str, progress: &dyn Fn(&str)) -> Result<InstallReport, String> {
    let tmp = state.dir.join("tmp").join(name);
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(err)?;
    progress("unpacking");
    let result = unzip(zip_bytes, &tmp, false).and_then(|_| {
        let mut conn = state.conn.lock().map_err(err)?;
        install_unpacked(&mut conn, &tmp, name, InstallOptions { source, strict: false, commit: true }, progress)
    });
    let _ = std::fs::remove_dir_all(&tmp);
    result
}

// ---------------------------------------------------------------- the reader's own files
//
// "Add from file": a SWORD module zip the reader already has. It is checked first
// (`import_check`: unpacked into a holding folder and run through the whole conversion as
// a trial, which changes nothing) and only installed on a second, explicit step
// (`import_install`). Anything that fails a check is refused with the reason; nothing is
// ever half-installed, because the conversion runs inside one database transaction.

fn import_dir(state: &LibraryState) -> PathBuf {
    state.dir.join("tmp").join("_import")
}

/// Largest file "Add from file" accepts.
pub const MAX_IMPORT_BYTES: usize = 400 * 1024 * 1024;

/// Adds an e-book or PDF book (already read and checked by `epub::read` / `pdf::read`) as
/// a book in the library.
pub fn install_epub(conn: &mut Connection, book: &epub::Epub, commit: bool) -> Result<InstallReport, String> {
    let module = epub::module_name(&book.title);
    let title = if book.author.is_empty() { book.title.clone() } else { format!("{} — {}", book.title, book.author) };
    let lang = book.lang.split(['-', '_']).next().unwrap_or("").to_lowercase();
    let language = if lang.is_empty() { String::new() } else { language_name(&lang) };
    let licence = if book.rights.is_empty() { "Your own copy".to_string() } else { book.rights.chars().take(200).collect() };

    let tx = conn.transaction().map_err(err)?;
    let replaces: Option<String> = tx.query_row("SELECT title FROM modules WHERE name = ?1", params![module], |r| r.get(0)).optional().map_err(err)?;
    delete_module_rows(&tx, &module)?;
    let mut garbled = 0i64;
    {
        let mut stmt = tx.prepare("INSERT INTO lib_book(module, parent, ord, title, text) VALUES (?1, NULL, ?2, ?3, ?4)").map_err(err)?;
        for (ord, (section, text)) in book.sections.iter().enumerate() {
            if text.contains('\u{FFFD}') {
                garbled += 1;
            }
            stmt.execute(params![module, ord as i64, section, text]).map_err(err)?;
        }
    }
    let entries = book.sections.len() as i64;
    if garbled * 4 > entries {
        return Err("The text of this e-book doesn't read correctly (unreadable characters in many chapters), so it wasn't added.".into());
    }
    let mut warnings = book.warnings.clone();
    if garbled > 0 {
        warnings.push(format!("{garbled} chapter(s) have a character that couldn't be read."));
    }
    tx.execute("INSERT INTO lib_book_fts(rowid, title, text) SELECT id, title, text FROM lib_book WHERE module = ?1", params![module]).map_err(err)?;
    tx.execute(
        "INSERT INTO modules(name, kind, title, lang, language, licence, about, version, versification, entries, features, source)
         VALUES (?1, 'book', ?2, ?3, ?4, ?5, ?6, '', '', ?7, ?9, ?8)",
        params![
            module,
            title,
            lang,
            language,
            licence,
            if book.author.is_empty() { String::new() } else { format!("By {}", book.author) },
            entries,
            SOURCE_FILE,
            if book.pages > 0 { format!("pages={}", book.pages) } else { "-".to_string() }
        ],
    )
    .map_err(err)?;
    if commit {
        tx.commit().map_err(err)?;
    }
    Ok(InstallReport { name: module, kind: "book".into(), title, entries, books: 0, language, licence, warnings, replaces })
}

const IMPORT_EPUB: &str = "book.bin";

/// The reader's own book, from an EPUB or a PDF.
fn read_book(bytes: &[u8], file_name: Option<&str>) -> Result<epub::Epub, String> {
    if pdf::is_pdf(bytes) {
        pdf::read(bytes, file_name)
    } else {
        epub::read(bytes, file_name)
    }
}
const IMPORT_NAME: &str = "name.txt";

/// Checks a file the reader chose -- an EPUB e-book, a PDF book or a SWORD module zip -- and reports
/// what installing it would add. The file is kept in the holding folder for `import_install`.
pub fn import_check(state: &LibraryState, bytes: &[u8], file_name: Option<&str>) -> Result<InstallReport, String> {
    let dir = import_dir(state);
    let _ = std::fs::remove_dir_all(&dir);
    if bytes.len() > MAX_IMPORT_BYTES {
        return Err("The file is larger than 400 MB, which is too large to add.".into());
    }
    std::fs::create_dir_all(&dir).map_err(err)?;
    let result = if pdf::is_pdf(bytes) || epub::is_epub(bytes) {
        read_book(bytes, file_name).and_then(|book| {
            std::fs::write(dir.join(IMPORT_EPUB), bytes).map_err(err)?;
            std::fs::write(dir.join(IMPORT_NAME), file_name.unwrap_or("")).map_err(err)?;
            install_epub(&mut *state.conn.lock().map_err(err)?, &book, false)
        })
    } else {
        unzip(bytes, &dir, true).and_then(|_| {
            let mut conn = state.conn.lock().map_err(err)?;
            install_unpacked(&mut conn, &dir, "", InstallOptions { source: SOURCE_FILE, strict: true, commit: false }, &|_| {})
        })
    };
    if result.is_err() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    result
}

/// Installs the file last checked with `import_check`.
pub fn import_install(state: &LibraryState, progress: &dyn Fn(&str)) -> Result<InstallReport, String> {
    let dir = import_dir(state);
    let result = if dir.join(IMPORT_EPUB).is_file() {
        let file_name = std::fs::read_to_string(dir.join(IMPORT_NAME)).ok().filter(|n| !n.is_empty());
        std::fs::read(dir.join(IMPORT_EPUB)).map_err(err).and_then(|bytes| read_book(&bytes, file_name.as_deref())).and_then(|book| install_epub(&mut *state.conn.lock().map_err(err)?, &book, true))
    } else if dir.join("mods.d").is_dir() {
        let mut conn = state.conn.lock().map_err(err)?;
        install_unpacked(&mut conn, &dir, "", InstallOptions { source: SOURCE_FILE, strict: true, commit: true }, progress)
    } else {
        return Err("Choose the file again: there is nothing waiting to be added.".into());
    };
    let _ = std::fs::remove_dir_all(&dir);
    result
}

pub fn import_cancel(state: &LibraryState) {
    let _ = std::fs::remove_dir_all(import_dir(state));
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
    /// a `Source` id, or "file" for something the reader added themselves
    pub source: String,
    /// a book added from a PDF: how many printed pages it has (0 = it has no page numbers)
    pub pages: i64,
}

/// The section of a book where printed page `page` starts (or the nearest earlier page that
/// has text), with that page's number.
pub fn book_page(conn: &Connection, module: &str, page: i64) -> Result<Option<(i64, i64)>, String> {
    let mut stmt = conn.prepare("SELECT id FROM lib_book WHERE module = ?1 AND instr(text, ?2) > 0 ORDER BY ord LIMIT 1").map_err(err)?;
    for p in (1..=page.max(1)).rev().take(40) {
        if let Some(id) = stmt.query_row(params![module, epub::page_mark(p as u32)], |r| r.get::<_, i64>(0)).optional().map_err(err)? {
            return Ok(Some((id, p)));
        }
    }
    Ok(None)
}

pub fn installed(conn: &Connection, kind: Option<&str>) -> Result<Vec<InstalledModule>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT name, kind, title, language, licence, about, version, entries, installed_at, source, features FROM modules
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
                source: r.get(9)?,
                pages: r.get::<_, String>(10)?.strip_prefix("pages=").and_then(|n| n.parse().ok()).unwrap_or(0),
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

/// The books beyond the 66 that an installed Bible has, in customary order, each with
/// its number of chapters.
pub fn extra_books(conn: &Connection, code: &str) -> Result<Vec<(String, i64)>, String> {
    let mut stmt = conn.prepare("SELECT book, max(chapter) FROM lib_verses WHERE module = ?1 GROUP BY book").map_err(err)?;
    let found: HashMap<String, i64> = stmt.query_map(params![code], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    Ok(refs::APOCRYPHA.iter().filter_map(|(_, name)| found.get(*name).map(|n| (name.to_string(), *n))).collect())
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
    /// length of the section's text, for showing how far through the book a place is
    pub chars: i64,
}

/// A book's table of contents; for a devotional, its dated entries (in their own order).
pub fn toc(conn: &Connection, module: &str) -> Result<Vec<TocEntry>, String> {
    let kind: String = conn.query_row("SELECT kind FROM modules WHERE name = ?1", params![module], |r| r.get(0)).map_err(err)?;
    if kind == "devotional" {
        let mut stmt = conn.prepare("SELECT id, headword, length(body) FROM lib_dict WHERE module = ?1 ORDER BY id").map_err(err)?;
        let rows = stmt
            .query_map(params![module], |r| Ok(TocEntry { id: LIB_ID_BASE + r.get::<_, i64>(0)?, parent: None, title: r.get(1)?, has_text: true, chars: r.get(2)? }))
            .map_err(err)?;
        return rows.collect::<Result<_, _>>().map_err(err);
    }
    let mut stmt = conn.prepare("SELECT id, parent, title, length(text) > 0, length(text) FROM lib_book WHERE module = ?1 ORDER BY ord").map_err(err)?;
    let rows = stmt.query_map(params![module], |r| Ok(TocEntry { id: r.get(0)?, parent: r.get(1)?, title: r.get(2)?, has_text: r.get(3)?, chars: r.get(4)? })).map_err(err)?;
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
        migrate(&conn, Path::new(".")).unwrap();
        let items = catalog_items(&confs, &conn, "crosswire").unwrap();
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

    /// A real Bible with the Apocrypha (eBible's KJV 1769), if the reader's download is
    /// still there:  cargo test apocrypha_real -- --ignored --nocapture
    #[test]
    #[ignore]
    fn apocrypha_real() {
        let file = PathBuf::from(std::env::var("USERPROFILE").unwrap()).join("Downloads/engKJV1769eb.zip");
        let dir = std::env::temp_dir().join(format!("bc-apoc-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = open(&dir).unwrap();
        let r = import_check(&state, &std::fs::read(file).unwrap(), None).unwrap();
        println!("{} {} entries, {} books, {:?}", r.title, r.entries, r.books, r.warnings);
        let done = import_install(&state, &|_| {}).unwrap();
        let conn = state.conn.lock().unwrap();
        let extra = extra_books(&conn, &done.name).unwrap();
        println!("{extra:?}");
        assert!(extra.iter().any(|(b, n)| b == "Tobit" && *n == 14));
        println!("Tobit 1:1 {:?}", verse(&conn, &done.name, "Tobit", 1, 1).unwrap());
        println!("Sirach 1:1 {:?}", verse(&conn, &done.name, "Sirach", 1, 1).unwrap());
        assert!(verse(&conn, &done.name, "John", 3, 16).unwrap().is_some());
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Data-pipeline helper, not a test of the app: dumps every cross-reference note in the
    /// Bibles in ...\library-probe\xref (public-domain Bibles that include the Apocrypha) to
    /// xref\notes.tsv as  module, versification, book, chapter, verse, note-markup.
    ///   cargo test dump_xref_notes -- --ignored --nocapture
    #[test]
    #[ignore]
    fn dump_xref_notes() {
        use std::io::Write;
        let dir = PathBuf::from(std::env::var("LOCALAPPDATA").unwrap()).join("bible-concordance-build/library-probe/xref");
        let note = regex::Regex::new(r#"(?s)<note\b[^>]*>.*?</note>|<reference\b[^>]*>.*?</reference>|<RX>.*?<Rx>|<scripRef\b[^>]*>.*?</scripRef>"#).unwrap();
        let mut out = std::fs::File::create(dir.join("notes.tsv")).unwrap();
        let mut zips: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "zip")).collect();
        zips.sort();
        for zip_path in zips {
            let tmp = std::env::temp_dir().join(format!("bc-xref-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&tmp);
            std::fs::create_dir_all(&tmp).unwrap();
            unzip(&std::fs::read(&zip_path).unwrap(), &tmp, false).unwrap();
            let conf = find_conf(&tmp, "").unwrap();
            let entries = match sword::read_verse_module(&tmp, &conf) {
                Ok(e) => e,
                Err(e) => {
                    println!("{}: {e}", conf.name);
                    continue;
                }
            };
            let (mut verses, mut with, mut apoc_with) = (0, 0, 0);
            let mut sample = String::new();
            for e in &entries {
                verses += 1;
                let notes: Vec<&str> = note.find_iter(&e.text).map(|m| m.as_str()).filter(|n| n.contains("crossReference") || n.contains("osisRef") || n.starts_with("<RX") || n.starts_with("<scripRef")).collect();
                if notes.is_empty() {
                    continue;
                }
                with += 1;
                if refs::apocrypha_book(&e.osis_book).is_some() {
                    apoc_with += 1;
                    if sample.is_empty() {
                        sample = format!("{} {}:{} {}", e.osis_book, e.chapter, e.verse, notes[0].chars().take(400).collect::<String>());
                    }
                }
                for n in notes {
                    writeln!(out, "{}\t{}\t{}\t{}\t{}\t{}", conf.name, conf.versification(), e.osis_book, e.chapter, e.verse, n.replace(['\t', '\n', '\r'], " ")).unwrap();
                }
            }
            println!("{:<16} {:<8} {:>6} verses, {:>6} with notes, {:>5} of them in the Apocrypha\n      {}", conf.name, conf.versification(), verses, with, apoc_with, sample);
            let _ = std::fs::remove_dir_all(&tmp);
        }
    }

    fn zip_of(files: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in files {
            z.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(data).unwrap();
        }
        z.finish().unwrap().into_inner()
    }

    /// "Add from file" refuses everything that isn't exactly one readable module, with a
    /// reason, and leaves the library untouched.
    #[test]
    fn import_refuses_what_it_cannot_vouch_for() {
        let dir = std::env::temp_dir().join(format!("bc-import-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = open(&dir).unwrap();
        let conf = b"[MyBible]\nDataPath=./modules/texts/ztext/mybible/\nModDrv=zText\nCompressType=ZIP\nLang=en\n";
        let refused = |bytes: &[u8]| import_check(&state, bytes, None).expect_err("must be refused");

        assert!(refused(b"this is not a book").contains("isn't a zip"));
        assert!(refused(b"%PDF-1.7 ...").contains("damaged"));
        // a PDF book goes the same way as an e-book
        let r = import_check(&state, &pdf::tests::sample(Some("Grace and Truth")), Some("g.pdf")).unwrap();
        assert_eq!((r.kind.as_str(), r.title.as_str()), ("book", "Grace and Truth — A. Writer"));
        assert!(r.warnings.iter().any(|w| w.contains("PDF stores printed pages")));
        let pdf_book = import_install(&state, &|_| {}).unwrap();
        {
            let conn = state.conn.lock().unwrap();
            let books = installed(&conn, Some("book")).unwrap();
            assert_eq!((books.len(), books[0].pages), (1, 8));
            let (id, page) = book_page(&conn, &pdf_book.name, 5).unwrap().unwrap();
            assert!(page == 5 && section(&conn, id).unwrap().unwrap().text.contains("⟪5⟫"));
            assert_eq!(book_page(&conn, &pdf_book.name, 500).unwrap(), None);
        }
        remove(&mut state.conn.lock().unwrap(), &pdf_book.name).unwrap();

        // an EPUB e-book: checked first (nothing added), then added as a book of the reader's own
        let book = epub::tests::sample();
        let r = import_check(&state, &book, Some("grace.epub")).unwrap();
        assert_eq!((r.kind.as_str(), r.entries, r.title.as_str(), r.language.as_str()), ("book", 2, "Grace & Truth — A. Writer", "English"));
        assert!(installed(&state.conn.lock().unwrap(), None).unwrap().is_empty(), "the check adds nothing");
        let done = import_install(&state, &|_| {}).unwrap();
        {
            let conn = state.conn.lock().unwrap();
            let m = &installed(&conn, Some("book")).unwrap()[0];
            assert_eq!((m.name.as_str(), m.source.as_str()), (done.name.as_str(), SOURCE_FILE));
            let contents = toc(&conn, &m.name).unwrap();
            assert_eq!(contents.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(), ["One: The Beginning", "Two"]);
            let first = section(&conn, contents[0].id).unwrap().unwrap();
            assert!(first.text.contains("⟦John|3|16||John 3:16⟧") && first.next == Some(contents[1].id));
            assert_eq!(search_books(&conn, "quoted", None, 5).unwrap().len(), 1);
        }
        assert!(import_check(&state, &book, None).unwrap().replaces.is_some(), "adding it again says what it replaces");
        import_cancel(&state);
        remove(&mut state.conn.lock().unwrap(), &done.name).unwrap();
        assert!(refused(&zip_of(&[("book.epub", b"x")])).contains("isn't a SWORD module"));
        assert!(refused(&zip_of(&[("modules/texts/x.bzz", b"x")])).contains("no module description"));
        // something extra beside the module
        assert!(refused(&zip_of(&[("mods.d/my.conf", conf), ("setup.exe", b"MZ")])).contains("setup.exe"));
        assert!(refused(&zip_of(&[("mods.d/a.conf", conf), ("mods.d/b.conf", conf)])).contains("2 modules"));
        // a description with no data behind it
        refused(&zip_of(&[("mods.d/my.conf", conf)]));
        // drivers, locks and names the app can't use
        assert!(refused(&zip_of(&[("mods.d/my.conf", b"[My]\nModDrv=HREFCom\n")])).contains("isn't supported"));
        assert!(refused(&zip_of(&[("mods.d/my.conf", b"[My]\nModDrv=zText\nCipherKey=\n")])).contains("Locked"));
        assert!(refused(&zip_of(&[("mods.d/my.conf", b"[My Bible!]\nModDrv=zText\n")])).contains("name"));
        // a second copy of something built in
        assert!(refused(&zip_of(&[("mods.d/kjv.conf", b"[KJV]\nModDrv=zText\nDataPath=./modules/texts/ztext/kjv/\n")])).contains("built in"));

        assert!(installed(&state.conn.lock().unwrap(), None).unwrap().is_empty());
        assert!(!import_dir(&state).exists(), "a refused file leaves nothing behind");
        assert!(import_install(&state, &|_| {}).is_err(), "nothing is waiting to be installed");
        assert!(SOURCES.iter().all(|s| s.catalog_url.starts_with("https://") && s.zip_url.starts_with("https://") && s.zip_url.ends_with('/')));
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// A real module added from a file: the check changes nothing, the install does, and
    /// it's recorded as the reader's own. Also installs one real module from each of the
    /// other sources (zips in ...\library-probe\other):
    ///   cargo test import_real -- --ignored --nocapture
    #[test]
    #[ignore]
    fn import_real_modules() {
        let probe = PathBuf::from(std::env::var("LOCALAPPDATA").unwrap()).join("bible-concordance-build/library-probe");
        let dir = std::env::temp_dir().join(format!("bc-import-real-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = open(&dir).unwrap();
        for (file, kind) in [("zips/Geneva1599.zip", "bible"), ("zips/Barnes.zip", "commentary"), ("zips/Hitchcock.zip", "dictionary"), ("zips/Pilgrim.zip", "book"), ("zips/Daily.zip", "devotional")] {
            let bytes = std::fs::read(probe.join(file)).unwrap();
            let r = import_check(&state, &bytes, None).unwrap();
            println!("check {file}: {} {} entries, {} books, {:?}", r.kind, r.entries, r.books, r.warnings);
            assert_eq!(r.kind, kind);
            assert!(installed(&state.conn.lock().unwrap(), None).unwrap().iter().all(|m| m.name != r.name), "the check installs nothing");
            let done = import_install(&state, &|_| {}).unwrap();
            assert_eq!((done.entries, done.replaces.clone()), (r.entries, None));
            let m = installed(&state.conn.lock().unwrap(), None).unwrap().into_iter().find(|m| m.name == r.name).unwrap();
            assert_eq!(m.source, SOURCE_FILE);
        }
        // adding the same file again says what it replaces
        let again = import_check(&state, &std::fs::read(probe.join("zips/Hitchcock.zip")).unwrap(), None).unwrap();
        assert!(again.replaces.is_some());
        import_cancel(&state);
        assert_eq!(verse(&state.conn.lock().unwrap(), "Geneva1599", "John", 3, 16).unwrap().map(|t| t.contains("God so loued")), Some(true));

        for (file, source) in [("aai2009eb", "ebible"), ("NETfree", "netbible"), ("amu_BL_1999", "wycliffe"), ("Aleppo", "attic"), ("ACDC", "beta")] {
            let bytes = std::fs::read(probe.join(format!("other/{file}.zip"))).unwrap();
            match install_zip(&state, &bytes, file, source, &|_| {}) {
                Ok(r) => println!("{source:<9} {file:<12} {:<10} {:>6} entries {:>2} books  {} [{}] {:?}", r.kind, r.entries, r.books, r.title, r.language, r.warnings),
                Err(e) => panic!("{source} {file}: {e}"),
            }
        }
        let conn = state.conn.lock().unwrap();
        for (code, b, c, v) in [("NETfree", "John", 3, 16), ("aai2009eb", "John", 3, 16), ("amu_BL_1999", "Mark", 1, 1), ("Aleppo", "Genesis", 1, 1)] {
            println!("{code} {b} {c}:{v}: {:?}", verse(&conn, code, b, c, v).unwrap().map(|t| t.chars().take(90).collect::<String>()));
        }
        drop(conn);
        let _ = std::fs::remove_dir_all(&dir);
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
            match install_zip(&state, &bytes, name, "crosswire", &noop) {
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
