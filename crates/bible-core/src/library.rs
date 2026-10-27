//! The library of extra works both apps keep (since the phone has one too): where modules come
//! from (`SOURCES`: CrossWire, eBible.org, ...), their catalogues, and installing a SWORD
//! module or an e-Sword/MySword module into the library database (`modules`, `lib_verses`,
//! `lib_comm`, `lib_dict`, `lib_book` and their search indexes). Reading the library is each
//! app's own business (their screens differ); so is fetching (each app has its own HTTP).

use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::markup::{self, Kind};
use crate::sword::{self, Conf};
use crate::{esword, refs};

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// The works an app has built in, with what to say instead of installing them again:
/// ("KJV", "The King James Version is built in.").
pub type BuiltIn<'a> = &'a [(&'a str, &'a str)];

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

pub const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS modules (
    name TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, lang TEXT NOT NULL,
    language TEXT NOT NULL, licence TEXT NOT NULL, about TEXT NOT NULL, version TEXT NOT NULL,
    versification TEXT NOT NULL, entries INTEGER NOT NULL DEFAULT 0,
    installed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS lib_verses (
    id INTEGER PRIMARY KEY, module TEXT NOT NULL, book TEXT NOT NULL, chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL, text TEXT NOT NULL, red TEXT);
CREATE INDEX IF NOT EXISTS lib_verses_loc ON lib_verses(module, book, chapter, verse);
CREATE VIRTUAL TABLE IF NOT EXISTS lib_verses_fts USING fts5(text, content='lib_verses', content_rowid='id');
CREATE TABLE IF NOT EXISTS lib_atlas_map (
    id INTEGER PRIMARY KEY, module TEXT NOT NULL, ord INTEGER NOT NULL, title TEXT NOT NULL, mime TEXT NOT NULL,
    image BLOB NOT NULL, body TEXT NOT NULL, cols INTEGER NOT NULL, rows INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS lib_atlas_map_loc ON lib_atlas_map(module, ord);
CREATE TABLE IF NOT EXISTS lib_atlas_place (
    id INTEGER PRIMARY KEY, module TEXT NOT NULL, name TEXT NOT NULL, name_fold TEXT NOT NULL,
    map_ord INTEGER NOT NULL, col INTEGER NOT NULL, row INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS lib_atlas_place_name ON lib_atlas_place(module, name_fold);
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
CREATE TABLE IF NOT EXISTS lib_refs (
    module TEXT NOT NULL, tbl TEXT NOT NULL, row_id INTEGER NOT NULL, pos INTEGER NOT NULL,
    book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, verse_end INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS lib_refs_loc ON lib_refs(book, chapter, verse);
CREATE INDEX IF NOT EXISTS lib_refs_module ON lib_refs(module);
CREATE TABLE IF NOT EXISTS lib_refs_done (module TEXT PRIMARY KEY, installed_at TEXT NOT NULL);
";

pub fn has_column(conn: &Connection, table: &str, column: &str) -> bool {
    conn.prepare(&format!("PRAGMA table_info({table})"))
        .and_then(|mut s| s.query_map([], |r| r.get::<_, String>(1))?.collect::<Result<Vec<_>, _>>())
        .map(|cols| cols.iter().any(|c| c == column))
        .unwrap_or(false)
}

/// Later additions to the schema, applied to libraries created before them: `lib_verses.red`
/// (the words of Jesus), `modules.features` (the module's Feature= tags, e.g. GreekDef) and `lib_dict.strongs`
/// (an entry's Strong's number in the app's form, "G25"/"H1254", for lexicons keyed by
/// Strong's numbers -- what Word Study looks up).
pub fn migrate(conn: &Connection, dir: &Path) -> Result<(), String> {
    if !has_column(conn, "modules", "features") {
        conn.execute_batch("ALTER TABLE modules ADD COLUMN features TEXT NOT NULL DEFAULT ''").map_err(err)?;
    }
    if !has_column(conn, "modules", "source") {
        conn.execute_batch("ALTER TABLE modules ADD COLUMN source TEXT NOT NULL DEFAULT 'crosswire'").map_err(err)?;
    }
    // the words of Jesus in a Bible added from a file: a JSON list of inclusive word ranges
    if !has_column(conn, "lib_verses", "red") {
        conn.execute_batch("ALTER TABLE lib_verses ADD COLUMN red TEXT").map_err(err)?;
    }
    if !has_column(conn, "lib_dict", "strongs") {
        conn.execute_batch("ALTER TABLE lib_dict ADD COLUMN strongs TEXT").map_err(err)?;
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS lib_dict_strongs ON lib_dict(strongs)").map_err(err)?;
    // commentaries installed before 2.9.0 kept an empty heading slot that pointed back at an
    // earlier note (Acts 1 showing the note on John 20:31): removed once
    conn.execute_batch("CREATE TABLE IF NOT EXISTS lib_fixes (name TEXT PRIMARY KEY)").map_err(err)?;
    let done: bool = conn.query_row("SELECT 1 FROM lib_fixes WHERE name = 'repeated-headings'", [], |_| Ok(true)).optional().map_err(err)?.unwrap_or(false);
    if !done {
        remove_repeated_headings(conn)?;
        conn.execute("INSERT INTO lib_fixes (name) VALUES ('repeated-headings')", []).map_err(err)?;
    }
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
pub fn entry_lemma(raw: &str) -> Option<String> {
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

pub fn language_name(code: &str) -> String {
    let base = code.split(['-', '_']).next().unwrap_or(code).to_ascii_lowercase();
    // three-letter codes, as e-Sword and MySword modules often give them ("eng")
    let base = match base.as_str() {
        "eng" => "en",
        "afr" => "af",
        "deu" | "ger" => "de",
        "fra" | "fre" => "fr",
        "nld" | "dut" => "nl",
        "spa" => "es",
        "por" => "pt",
        "ita" => "it",
        "ell" | "gre" => "el",
        "heb" => "he",
        "lat" => "la",
        "rus" => "ru",
        "zul" => "zu",
        "xho" => "xh",
        "swa" | "swh" => "sw",
        "kor" => "ko",
        "zho" | "chi" => "zh",
        "jpn" => "ja",
        "ara" => "ar",
        other => other,
    };
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
pub fn unsupported_reason(conf: &Conf) -> Option<String> {
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

pub fn catalog_items(confs: &[Conf], conn: &Connection, source: &str, built_in: BuiltIn) -> Result<Vec<CatalogItem>, String> {
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
            let built_in = built_in.iter().find(|(n, _)| *n == c.name).map(|(_, note)| note.to_string());
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
    /// the works the app has built in (not installed again from a file)
    pub built_in: BuiltIn<'a>,
}

pub const MAX_ZIP_FILES: usize = 4000;

pub const MAX_UNPACKED_BYTES: u64 = 800 * 1024 * 1024;

/// Unpacks a module .zip into a fresh folder (guarding against paths that escape it, and
/// against archives that unpack to something enormous). `strict` is for a file the reader
/// supplied: it must hold exactly one module and nothing else.
pub fn unzip(bytes: &[u8], dest: &Path, strict: bool) -> Result<(), String> {
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

pub fn find_conf(root: &Path, name: &str) -> Result<Conf, String> {
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

pub fn fold(s: &str) -> String {
    s.to_lowercase()
}

pub fn delete_module_rows(tx: &Connection, name: &str) -> Result<(), String> {
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
    tx.execute("DELETE FROM lib_atlas_map WHERE module = ?1", params![name]).map_err(err)?;
    tx.execute("DELETE FROM lib_atlas_place WHERE module = ?1", params![name]).map_err(err)?;
    tx.execute("DELETE FROM lib_refs WHERE module = ?1", params![name]).map_err(err)?;
    tx.execute("DELETE FROM lib_refs_done WHERE module = ?1", params![name]).map_err(err)?;
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
        if let Some((_, note)) = opts.built_in.iter().find(|(n, _)| n.eq_ignore_ascii_case(&conf.name)) {
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
            let mut seen = HashSet::new();
            for e in sword::read_verse_module(root, &conf)? {
                let Some(book) = refs::osis_book(&e.osis_book) else { continue };
                // verses pointing at a note already stored are that note again: consecutive ones
                // are one note on a range, and an empty heading slot (a chapter's "verse 0") can
                // point back at an earlier note -- even in the book before -- which is not a note
                // on this chapter
                if !seen.insert(e.loc) {
                    continue;
                }
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

/// Largest file "Add from file" accepts.
pub const MAX_IMPORT_BYTES: usize = 400 * 1024 * 1024;

/// The library name for an e-Sword or MySword module: a Bible's abbreviation (its version
/// code in the translation list, e.g. "PWL"), or "own-<title>" for anything else.
pub fn esword_name(m: &esword::Module, file_name: Option<&str>) -> String {
    let clean = |s: &str| s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').take(24).collect::<String>();
    if m.kind == "bible" || m.program == "MyBible" {
        let abbr = clean(m.abbreviation.trim());
        if !abbr.is_empty() {
            return abbr;
        }
    }
    let base = if !m.title.trim().is_empty() {
        m.title.clone()
    } else if !m.abbreviation.trim().is_empty() {
        m.abbreviation.clone()
    } else {
        file_name.unwrap_or("module").split('.').next().unwrap_or("module").to_string()
    };
    module_name(&base)
}

/// Adds an e-Sword or MySword module (already read by `esword::read`) to the library, the
/// same way a SWORD module is: one transaction, nothing half-done.
pub fn install_esword(conn: &mut Connection, m: &esword::Module, file_name: Option<&str>, commit: bool, built_in: BuiltIn) -> Result<InstallReport, String> {
    let module = esword_name(m, file_name);
    if !valid_name(&module) {
        return Err("The module's name has characters the app can't use.".into());
    }
    for name in [m.abbreviation.trim(), module.as_str()] {
        if let Some((_, note)) = built_in.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)) {
            return Err(note.to_string());
        }
    }
    let title = if m.title.trim().is_empty() { untitled(m, file_name).unwrap_or_else(|| module.clone()) } else { m.title.trim().to_string() };
    let lang = m.lang.split(['-', '_']).next().unwrap_or("").to_string();
    let language = if lang.is_empty() { String::new() } else { language_name(&lang) };
    let licence = if m.copyright.trim().is_empty() { "Your own copy".to_string() } else { format!("Your own copy · {}", m.copyright.trim()).chars().take(200).collect() };

    let tx = conn.transaction().map_err(err)?;
    let replaces: Option<String> = tx.query_row("SELECT title FROM modules WHERE name = ?1", params![module], |r| r.get(0)).optional().map_err(err)?;
    delete_module_rows(&tx, &module)?;
    let mut entries: i64 = 0;
    let (table, text_col) = match m.kind {
        "bible" => {
            let mut s = tx.prepare("INSERT INTO lib_verses(module, book, chapter, verse, text, red) VALUES (?1,?2,?3,?4,?5,?6)").map_err(err)?;
            let red: std::collections::HashMap<(&str, i64, i64), String> =
                m.red.iter().filter_map(|(b, ch, v, ranges)| serde_json::to_string(ranges).ok().map(|j| ((*b, *ch, *v), j))).collect();
            for (b, ch, v, text) in &m.verses {
                s.execute(params![module, b, ch, v, text, red.get(&(*b, *ch, *v))]).map_err(err)?;
                entries += 1;
            }
            ("lib_verses", "text")
        }
        "commentary" => {
            let mut s = tx.prepare("INSERT INTO lib_comm(module, book, chapter, verse_start, text) VALUES (?1,?2,?3,?4,?5)").map_err(err)?;
            for (b, ch, v, text) in &m.notes {
                s.execute(params![module, b, ch, v, text]).map_err(err)?;
                entries += 1;
            }
            ("lib_comm", "text")
        }
        "dictionary" | "devotional" => {
            let mut s = tx.prepare("INSERT INTO lib_dict(module, key, headword, headword_fold, body, strongs) VALUES (?1,?2,?3,?4,?5,?6)").map_err(err)?;
            for (key, head, body) in &m.entries {
                let strongs = if m.kind == "dictionary" && m.strongs { strongs_of_key(key, false, false) } else { None };
                let head = if m.kind == "devotional" {
                    head.clone()
                } else if let Some(s) = &strongs {
                    // "ἀγάπη (G26)" rather than "G26": the word, from the entry's own text
                    original_word(body).map(|w| format!("{w} ({s})")).unwrap_or_else(|| s.clone())
                } else {
                    markup::headword(head)
                };
                s.execute(params![module, key, head, fold(&head), body, strongs]).map_err(err)?;
                entries += 1;
            }
            ("lib_dict", "body")
        }
        "book" => {
            let mut s = tx.prepare("INSERT INTO lib_book(module, parent, ord, title, text) VALUES (?1, NULL, ?2, ?3, ?4)").map_err(err)?;
            for (ord, (t, text)) in m.sections.iter().enumerate() {
                s.execute(params![module, ord as i64, t, text]).map_err(err)?;
                entries += 1;
            }
            ("lib_book", "text")
        }
        "atlas" => {
            let mut s = tx.prepare("INSERT INTO lib_atlas_map(module, ord, title, mime, image, body, cols, rows) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)").map_err(err)?;
            for mp in &m.maps {
                s.execute(params![module, mp.ord, mp.title, mp.mime, mp.image, mp.body, mp.cols, mp.rows]).map_err(err)?;
                entries += 1;
            }
            let mut s = tx.prepare("INSERT INTO lib_atlas_place(module, name, name_fold, map_ord, col, row) VALUES (?1,?2,?3,?4,?5,?6)").map_err(err)?;
            for (name, map, col, row) in &m.places {
                s.execute(params![module, name, fold(name), map, col, row]).map_err(err)?;
            }
            ("lib_atlas_map", "body")
        }
        other => return Err(format!("unsupported module kind {other}")),
    };
    if entries == 0 {
        return Err("The module contained no text this app can read.".into());
    }
    let garbled: i64 = tx
        .query_row(&format!("SELECT count(*) FROM {table} WHERE module = ?1 AND instr({text_col}, char(65533)) > 0"), params![module], |r| r.get(0))
        .map_err(err)?;
    if garbled * 100 > entries {
        return Err(format!("The text doesn't read correctly ({garbled} of {entries} entries have unreadable characters), so it wasn't added."));
    }
    let mut warnings = m.warnings.clone();
    if garbled > 0 {
        warnings.push(format!("{garbled} of {entries} entries have a character that couldn't be read."));
    }
    let books: i64 = if m.kind == "bible" || m.kind == "commentary" {
        tx.query_row(&format!("SELECT count(DISTINCT book) FROM {table} WHERE module = ?1"), params![module], |r| r.get(0)).map_err(err)?
    } else {
        0
    };
    if m.kind == "bible" {
        if entries < 20 {
            return Err(format!("Only {entries} verses could be read, which is too few to be a Bible or a Bible book."));
        }
        if books < 66 {
            warnings.push(format!("It has {books} of the 66 books of the Bible."));
        }
    }
    for (t, fts, cols) in [
        ("lib_verses", "lib_verses_fts", "text"),
        ("lib_comm", "lib_comm_fts", "text"),
        ("lib_dict", "lib_dict_fts", "headword, body"),
        ("lib_book", "lib_book_fts", "title, text"),
    ] {
        tx.execute(&format!("INSERT INTO {fts}(rowid, {cols}) SELECT id, {cols} FROM {t} WHERE module = ?1"), params![module]).map_err(err)?;
    }
    let about = format!("{} module. {}", m.program, m.about).trim().chars().take(4000).collect::<String>();
    tx.execute(
        "INSERT INTO modules(name, kind, title, lang, language, licence, about, version, versification, entries, features, source)
         VALUES (?1,?2,?3,?4,?5,?6,?7,'','KJV',?8,?9,?10)",
        params![module, m.kind, title, lang, language, licence, about, entries, if m.strongs { "StrongsNumbers" } else { "-" }, SOURCE_FILE],
    )
    .map_err(err)?;
    if commit {
        tx.commit().map_err(err)?;
    }
    Ok(InstallReport { name: module, kind: m.kind.into(), title, entries, books, language, licence, warnings, replaces })
}

/// An e-Sword or MySword module inside the bytes the reader chose: the file itself, or one
/// packed in a .gz or a .zip (as MySword's site gives them). None: not one of these.
/// The footnotes and study notes that come in the same zip as a MyBible Bible
/// ("ESV.zip" holds "ESV.SQLite3" and "ESV.commentaries.SQLite3"): the second file and its name.
pub fn esword_companion(bytes: &[u8]) -> Option<(Vec<u8>, String)> {
    if !bytes.starts_with(b"PK") {
        return None;
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).ok()?;
    let names: Vec<String> = (0..zip.len()).filter_map(|i| zip.by_index(i).ok().map(|f| f.name().to_string())).filter(|n| esword::is_module_name(n)).collect();
    if names.len() < 2 || zip.len() > 3 {
        return None;
    }
    let notes: Vec<&String> = names.iter().filter(|n| n.to_lowercase().contains(".commentaries.")).collect();
    if notes.len() != 1 {
        return None;
    }
    let mut f = zip.by_name(notes[0]).ok()?;
    let mut out = Vec::new();
    (&mut f).take(MAX_IMPORT_BYTES as u64 + 1).read_to_end(&mut out).ok()?;
    if !esword::is_sqlite(&out) {
        return None;
    }
    Some((out, notes[0].rsplit(['/', '\\']).next().unwrap_or(notes[0]).to_string()))
}

pub fn esword_bytes(bytes: &[u8], file_name: Option<&str>) -> Result<Option<(Vec<u8>, String)>, String> {
    let name = file_name.unwrap_or("").to_string();
    if esword::is_sqlite(bytes) {
        return Ok(Some((bytes.to_vec(), name)));
    }
    if bytes.starts_with(&[0x1f, 0x8b]) {
        let mut out = Vec::new();
        flate2::read::GzDecoder::new(bytes)
            .take(MAX_IMPORT_BYTES as u64 + 1)
            .read_to_end(&mut out)
            .map_err(|_| "This .gz file couldn't be unpacked.".to_string())?;
        if esword::is_sqlite(&out) {
            return Ok(Some((out, name.trim_end_matches(".gz").to_string())));
        }
        return Err("The .gz file doesn't hold an e-Sword or MySword module.".into());
    }
    if bytes.starts_with(b"PK") {
        let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "This isn't a zip file the app can open.".to_string())?;
        let mut inner: Vec<String> = (0..zip.len()).filter_map(|i| zip.by_index(i).ok().map(|f| f.name().to_string())).filter(|n| esword::is_module_name(n)).collect();
        // a MyBible Bible comes with a second file for its footnotes ("ESV.commentaries.SQLite3"): the Bible is the one to add
        if inner.len() > 1 {
            inner.retain(|n| !n.to_lowercase().contains(".commentaries."));
        }
        if inner.len() == 1 && zip.len() <= 3 {
            let mut f = zip.by_name(&inner[0]).map_err(err)?;
            let mut out = Vec::new();
            (&mut f).take(MAX_IMPORT_BYTES as u64 + 1).read_to_end(&mut out).map_err(err)?;
            if esword::is_sqlite(&out) {
                let base = inner[0].rsplit(['/', '\\']).next().unwrap_or(&inner[0]).to_string();
                return Ok(Some((out, base)));
            }
        }
    }
    Ok(None)
}

pub fn remove(conn: &mut Connection, name: &str) -> Result<(), String> {
    let tx = conn.transaction().map_err(err)?;
    delete_module_rows(&tx, name)?;
    tx.commit().map_err(err)
}

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

/// A library name for the reader's own book, from its title: "own-he-came-to-set-the-captives-free".
pub fn module_name(title: &str) -> String {
    let mut slug = String::new();
    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
        if slug.len() >= 48 {
            break;
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        // a title with no Latin letters: a stable number from its characters
        let n = title.chars().fold(0u32, |a, c| a.wrapping_mul(31).wrapping_add(c as u32));
        format!("own-book-{n}")
    } else {
        format!("own-{slug}")
    }
}

/// Heading notes (verse 0) that repeat a note stored earlier in the same commentary: what an
/// empty heading slot pointing back at an earlier note left behind.
pub fn remove_repeated_headings(conn: &Connection) -> Result<usize, String> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut doomed: Vec<i64> = Vec::new();
    {
        let mut st = conn.prepare("SELECT id, module, verse_start, text FROM lib_comm ORDER BY module, id").map_err(err)?;
        let mut rows = st.query([]).map_err(err)?;
        let mut module = String::new();
        let mut seen: HashSet<u64> = HashSet::new();
        while let Some(r) = rows.next().map_err(err)? {
            let (id, m, verse, text): (i64, String, i64, String) = (r.get(0).map_err(err)?, r.get(1).map_err(err)?, r.get(2).map_err(err)?, r.get(3).map_err(err)?);
            if m != module {
                module = m;
                seen.clear();
            }
            let mut h = DefaultHasher::new();
            text.hash(&mut h);
            if !seen.insert(h.finish()) && verse == 0 {
                doomed.push(id);
            }
        }
    }
    let tx = conn.unchecked_transaction().map_err(err)?;
    for id in &doomed {
        tx.execute("INSERT INTO lib_comm_fts(lib_comm_fts, rowid, text) SELECT 'delete', id, text FROM lib_comm WHERE id = ?1", params![id]).map_err(err)?;
        tx.execute("DELETE FROM lib_refs WHERE tbl = 'lib_comm' AND row_id = ?1", params![id]).map_err(err)?;
        tx.execute("DELETE FROM lib_comm WHERE id = ?1", params![id]).map_err(err)?;
    }
    tx.commit().map_err(err)?;
    Ok(doomed.len())
}

/// The Greek or Hebrew word a lexicon entry is about, from its text ("Original: ἀγάπη", as
/// MySword's and e-Sword's Strong's lexicons begin), when it is there.
pub fn original_word(body: &str) -> Option<String> {
    let rest = body.trim_start().strip_prefix("Original:")?;
    let w = rest.split_whitespace().next()?.trim_matches(|c: char| c.is_ascii_punctuation());
    (!w.is_empty() && w.chars().any(|c| !c.is_ascii())).then(|| w.to_string())
}

/// A title for a module that gives none: a one-chapter book's chapter title ("Prophecy
/// fulfilled in Jesus"), or else its file's name tidied ("keathley-angelology.topx" ->
/// "Keathley Angelology").
pub fn untitled(m: &esword::Module, file_name: Option<&str>) -> Option<String> {
    if m.kind == "book" && m.sections.len() == 1 {
        let t = m.sections[0].0.trim();
        if !t.is_empty() && t != "Untitled" {
            return Some(t.to_string());
        }
    }
    let f = file_name?;
    let stem = f.rsplit(['/', '\\']).next().unwrap_or(f).split('.').next().unwrap_or(f);
    let words: Vec<String> = stem
        .split(['-', '_', ' '])
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            c.next().map(|first| first.to_uppercase().chain(c).collect()).unwrap_or_default()
        })
        .collect();
    (!words.is_empty()).then(|| words.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_for_modules_that_give_none() {
        let mut m = esword::Module { kind: "book", ..Default::default() };
        m.sections = vec![("Prophecy fufilled in Jesus".into(), "...".into())];
        assert_eq!(untitled(&m, Some("anonymous-messianic-prophecies-fufilled.topx")).as_deref(), Some("Prophecy fufilled in Jesus"));
        m.sections.push(("01 Terms".into(), "...".into()));
        assert_eq!(untitled(&m, Some(r"C:\x\keathley-angelology.topx")).as_deref(), Some("Keathley Angelology"));
    }

    #[test]
    fn words_and_languages() {
        assert_eq!(original_word("Original: ἀγάπη\nTransliteration: agapē").as_deref(), Some("ἀγάπη"));
        assert_eq!(original_word("Original: love"), None);
        assert_eq!(original_word("Love"), None);
        assert_eq!(language_name("eng"), "English");
        assert_eq!(language_name("afr"), "Afrikaans");
        assert_eq!(language_name("en-US"), "English");
    }

    #[test]
    fn a_heading_that_repeats_an_earlier_note_goes() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        for (book, ch, v, text) in [("John", 20, 31, "These are written."), ("John", 21, 1, "After these things."), ("Acts", 1, 0, "These are written."), ("Acts", 1, 1, "The former treatise."), ("Acts", 2, 0, "Pentecost.")] {
            conn.execute("INSERT INTO lib_comm(module, book, chapter, verse_start, text) VALUES ('Barnes', ?1, ?2, ?3, ?4)", params![book, ch, v, text]).unwrap();
        }
        conn.execute("INSERT INTO lib_comm_fts(rowid, text) SELECT id, text FROM lib_comm", []).unwrap();
        assert_eq!(remove_repeated_headings(&conn).unwrap(), 1);
        let left: Vec<String> = conn.prepare("SELECT book || ' ' || chapter || ':' || verse_start FROM lib_comm ORDER BY id").unwrap().query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(left, ["John 20:31", "John 21:1", "Acts 1:1", "Acts 2:0"]);
        let found: i64 = conn.query_row("SELECT count(*) FROM lib_comm_fts WHERE lib_comm_fts MATCH 'written'", [], |r| r.get(0)).unwrap();
        assert_eq!(found, 1, "the search index lost the removed one only");
    }
}
