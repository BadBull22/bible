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
pub mod pdf;
// the module readers and references, shared with the phone app
pub use bible_core::{esword, markup, refs, sword};
// the store both apps share: sources, catalogues, installing, the installed list
pub use bible_core::library::*;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::commentaries::{CommentaryChapter, CommentaryHit, CommentaryInfo, CommentarySection};
use crate::models::{SearchHit, Verse, Version};
use crate::study::{DictionaryEntry, DictionaryHit, DictionaryInfo};


/// Library dictionary entries share the Dictionary panel's id space with the bundled
/// study.db entries; ids from here are offset so the two never collide.
pub const LIB_ID_BASE: i64 = 1_000_000_000;

pub struct LibraryState {
    pub conn: Mutex<Connection>,
    pub dir: PathBuf,
    /// modules being installed right now (a second click must not start a second install)
    pub busy: Mutex<HashSet<String>>,
}


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
pub const BUILT_IN: &[(&str, &str)] = &[
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


// ---------------------------------------------------------------- install / remove


/// Unpacks `zip_bytes` into a temporary folder under the library folder, installs it, and
/// removes the folder again. `source` is the id of the repository it was downloaded from.
pub fn install_zip(state: &LibraryState, zip_bytes: &[u8], name: &str, source: &str, progress: &dyn Fn(&str)) -> Result<InstallReport, String> {
    let tmp = state.dir.join("tmp").join(name);
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(err)?;
    progress("unpacking");
    let result = unzip(zip_bytes, &tmp, false).and_then(|_| {
        let mut conn = state.conn.lock().map_err(err)?;
        install_unpacked(&mut conn, &tmp, name, InstallOptions { source, strict: false, commit: true, built_in: BUILT_IN }, progress)
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
/// an e-Sword or MySword module waiting in the holding folder
const IMPORT_ESWORD: &str = "module.sqlite";


/// The reader's own book, from an EPUB or a PDF.
fn read_book(bytes: &[u8], file_name: Option<&str>) -> Result<epub::Epub, String> {
    if pdf::is_pdf(bytes) {
        pdf::read(bytes, file_name)
    } else {
        epub::read(bytes, file_name)
    }
}
const IMPORT_NAME: &str = "name.txt";
/// The footnotes and study notes that came in the same zip as a MyBible Bible, waiting beside it.
const IMPORT_NOTES: &str = "notes.sqlite";
const IMPORT_NOTES_NAME: &str = "notes-name.txt";

/// Checks a file the reader chose -- an EPUB e-book, a PDF book or a SWORD module zip -- and reports
/// what installing it would add. The file is kept in the holding folder for `import_install`.
pub fn import_check(state: &LibraryState, bytes: &[u8], file_name: Option<&str>) -> Result<InstallReport, String> {
    let dir = import_dir(state);
    let _ = std::fs::remove_dir_all(&dir);
    if bytes.len() > MAX_IMPORT_BYTES {
        return Err("The file is larger than 400 MB, which is too large to add.".into());
    }
    std::fs::create_dir_all(&dir).map_err(err)?;
    let result = if let Some((module_bytes, name)) = esword_bytes(bytes, file_name)? {
        // an e-Sword or MySword module: kept in the holding folder, read, tried
        let path = dir.join(IMPORT_ESWORD);
        std::fs::write(&path, &module_bytes).map_err(err)?;
        std::fs::write(dir.join(IMPORT_NAME), &name).map_err(err)?;
        esword::read(&path, Some(&name)).and_then(|m| install_esword(&mut *state.conn.lock().map_err(err)?, &m, Some(&name), false, BUILT_IN)).map(|mut report| {
            // a MyBible Bible zipped with its footnotes and study notes: they are added as a commentary
            if report.kind == "bible" {
                if let Some((notes, notes_name)) = esword_companion(bytes) {
                    let file = dir.join(IMPORT_NOTES);
                    if std::fs::write(&file, notes).is_ok() && std::fs::write(dir.join(IMPORT_NOTES_NAME), &notes_name).is_ok() {
                        match esword::read(&file, Some(&notes_name)) {
                            Ok(n) => report.warnings.push(format!("Its footnotes and study notes ({} notes) will be added to your commentaries too.", n.notes.len())),
                            Err(_) => {
                                let _ = std::fs::remove_file(&file);
                            }
                        }
                    }
                }
            }
            report
        })
    } else if pdf::is_pdf(bytes) || epub::is_epub(bytes) {
        read_book(bytes, file_name).and_then(|book| {
            std::fs::write(dir.join(IMPORT_EPUB), bytes).map_err(err)?;
            std::fs::write(dir.join(IMPORT_NAME), file_name.unwrap_or("")).map_err(err)?;
            install_epub(&mut *state.conn.lock().map_err(err)?, &book, false)
        })
    } else {
        unzip(bytes, &dir, true).and_then(|_| {
            let mut conn = state.conn.lock().map_err(err)?;
            install_unpacked(&mut conn, &dir, "", InstallOptions { source: SOURCE_FILE, strict: true, commit: false, built_in: BUILT_IN }, &|_| {})
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
    let result = if dir.join(IMPORT_ESWORD).is_file() {
        let name = std::fs::read_to_string(dir.join(IMPORT_NAME)).ok().filter(|n| !n.is_empty());
        progress("reading");
        esword::read(&dir.join(IMPORT_ESWORD), name.as_deref()).and_then(|m| {
            progress("saving");
            install_esword(&mut *state.conn.lock().map_err(err)?, &m, name.as_deref(), true, BUILT_IN)
        })
        .map(|mut report| {
            // the notes that came with a Bible
            let notes = dir.join(IMPORT_NOTES);
            if notes.is_file() {
                let notes_name = std::fs::read_to_string(dir.join(IMPORT_NOTES_NAME)).ok().filter(|n| !n.is_empty());
                let added = esword::read(&notes, notes_name.as_deref()).and_then(|m| install_esword(&mut *state.conn.lock().map_err(err)?, &m, notes_name.as_deref(), true, BUILT_IN));
                match added {
                    Ok(n) => report.warnings.push(format!("Its footnotes and study notes were added to your commentaries ({}, {} notes).", n.title, n.entries)),
                    Err(e) => report.warnings.push(format!("Its footnotes and study notes could not be added: {e}")),
                }
            }
            report
        })
    } else if dir.join(IMPORT_EPUB).is_file() {
        let file_name = std::fs::read_to_string(dir.join(IMPORT_NAME)).ok().filter(|n| !n.is_empty());
        std::fs::read(dir.join(IMPORT_EPUB)).map_err(err).and_then(|bytes| read_book(&bytes, file_name.as_deref())).and_then(|book| install_epub(&mut *state.conn.lock().map_err(err)?, &book, true))
    } else if dir.join("mods.d").is_dir() {
        let mut conn = state.conn.lock().map_err(err)?;
        install_unpacked(&mut conn, &dir, "", InstallOptions { source: SOURCE_FILE, strict: true, commit: true, built_in: BUILT_IN }, progress)
    } else {
        return Err("Choose the file again: there is nothing waiting to be added.".into());
    };
    let _ = std::fs::remove_dir_all(&dir);
    result
}

pub fn import_cancel(state: &LibraryState) {
    let _ = std::fs::remove_dir_all(import_dir(state));
}


// ---------------------------------------------------------------- installed modules


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

// ---------------------------------------------------------------- atlases (pictures of maps the reader added)

#[derive(Serialize)]
pub struct AtlasMapInfo {
    pub id: i64,
    /// the atlas's library name, its title and where it comes from
    pub atlas: String,
    pub atlas_title: String,
    pub licence: String,
    /// the map's number in the atlas and its title
    pub ord: i64,
    pub title: String,
    pub mime: String,
    /// the text under the map (the numbered places, with verse markers)
    pub body: String,
    /// the grid: letters across, numbers down
    pub cols: i64,
    pub rows: i64,
}

/// Every map of every atlas in the library, in the order of the atlas.
pub fn atlas_maps(conn: &Connection) -> Result<Vec<AtlasMapInfo>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT a.id, a.module, m.title, m.licence, a.ord, a.title, a.mime, a.body, a.cols, a.rows
             FROM lib_atlas_map a JOIN modules m ON m.name = a.module ORDER BY m.title, a.ord",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(AtlasMapInfo { id: r.get(0)?, atlas: r.get(1)?, atlas_title: r.get(2)?, licence: r.get(3)?, ord: r.get(4)?, title: r.get(5)?, mime: r.get(6)?, body: r.get(7)?, cols: r.get(8)?, rows: r.get(9)? })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/// A map's picture.
pub fn atlas_image(conn: &Connection, id: i64) -> Result<Option<Vec<u8>>, String> {
    conn.query_row("SELECT image FROM lib_atlas_map WHERE id = ?1", params![id], |r| r.get(0)).optional().map_err(err)
}

#[derive(Serialize)]
pub struct AtlasPlace {
    pub name: String,
    pub map_id: i64,
    pub map_ord: i64,
    pub map_title: String,
    pub atlas: String,
    /// the grid square on that map, counted from 0
    pub col: i64,
    pub row: i64,
}

/// The places whose names contain `query`, with the map and grid square of each (names that start with it first).
pub fn atlas_places(conn: &Connection, query: &str, limit: i64) -> Result<Vec<AtlasPlace>, String> {
    let q = fold(query.trim()).replace('\\', "").replace('%', "").replace('_', "");
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn
        .prepare(
            "SELECT p.name, a.id, a.ord, a.title, a.module, p.col, p.row
             FROM lib_atlas_place p JOIN lib_atlas_map a ON a.module = p.module AND a.ord = p.map_ord
             WHERE p.name_fold LIKE '%' || ?1 || '%'
             ORDER BY (p.name_fold LIKE ?1 || '%') DESC, p.name_fold, a.ord LIMIT ?2",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![q, limit.clamp(1, 200)], |r| Ok(AtlasPlace { name: r.get(0)?, map_id: r.get(1)?, map_ord: r.get(2)?, map_title: r.get(3)?, atlas: r.get(4)?, col: r.get(5)?, row: r.get(6)? }))
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/// The words of Jesus in a chapter of a Bible added from a file: verse -> inclusive word ranges
/// (a word is a run of letters and digits), as the red-letter data of the built-in Bibles.
pub fn red_letter(conn: &Connection, code: &str, book: &str, chapter: i64) -> Result<std::collections::HashMap<String, Vec<(usize, usize)>>, String> {
    let mut stmt = conn.prepare("SELECT verse, red FROM lib_verses WHERE module = ?1 AND book = ?2 AND chapter = ?3 AND red IS NOT NULL").map_err(err)?;
    let rows = stmt.query_map(params![code, book, chapter], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))).map_err(err)?;
    let mut out = std::collections::HashMap::new();
    for row in rows {
        let (verse, json) = row.map_err(err)?;
        if let Ok(ranges) = serde_json::from_str::<Vec<(usize, usize)>>(&json) {
            out.insert(verse.to_string(), ranges);
        }
    }
    Ok(out)
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
            Ok(SearchHit { version_code: code.to_string(), book: r.get(0)?, chapter: r.get(1)?, verse: r.get(2)?, text: r.get(3)?, ..Default::default() })
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

// ---------------------------------------------------------------- where a passage is mentioned
//
// Every Scripture reference inside the installed books, dictionaries, devotionals and
// commentaries is already a ⟦Book|ch|v|v_end|label⟧ marker (markup.rs, epub.rs). lib_refs
// turns them round: from a passage to every place that mentions it. Built for a module the
// first time it is asked for after it is installed (a few seconds for a large library),
// then kept; removing a module removes its rows.

fn marker_rx() -> &'static regex::Regex {
    static CELL: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    CELL.get_or_init(|| regex::Regex::new(r"⟦([^|⟧]+)\|(\d+)\|(\d*)\|(\d*)\|[^⟧]*⟧").unwrap())
}

fn paragraph_break_rx() -> &'static regex::Regex {
    static CELL: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    CELL.get_or_init(|| regex::Regex::new(r"\n{2,}").unwrap())
}

/// The references in one text: (byte position, book, chapter, verse (0 = the whole
/// chapter), last verse), the first mention of each only.
pub fn markers_in(text: &str) -> Vec<(usize, String, i64, i64, i64)> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for c in marker_rx().captures_iter(text) {
        let Ok(chapter) = c[2].parse::<i64>() else { continue };
        let verse = c[3].parse::<i64>().unwrap_or(0);
        let end = c[4].parse::<i64>().ok().filter(|e| *e > verse).unwrap_or(verse);
        if seen.insert((c[1].to_string(), chapter, verse, end)) {
            out.push((c.get(0).unwrap().start(), c[1].to_string(), chapter, verse, end));
        }
    }
    out
}

/// Indexes the references of every installed module (other than Bibles) not indexed since
/// it was installed. Returns how many modules it indexed.
pub fn ensure_ref_index(conn: &mut Connection) -> Result<usize, String> {
    let todo: Vec<(String, String)> = conn
        .prepare(
            "SELECT m.name, m.installed_at FROM modules m LEFT JOIN lib_refs_done d ON d.module = m.name
             WHERE m.kind <> 'bible' AND (d.installed_at IS NULL OR d.installed_at <> m.installed_at)",
        )
        .map_err(err)?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    for (module, installed_at) in &todo {
        let tx = conn.transaction().map_err(err)?;
        tx.execute("DELETE FROM lib_refs WHERE module = ?1", params![module]).map_err(err)?;
        for (tbl, col) in [("lib_book", "text"), ("lib_dict", "body"), ("lib_comm", "text")] {
            let mut read = tx.prepare(&format!("SELECT id, {col} FROM {tbl} WHERE module = ?1 AND instr({col}, '⟦') > 0")).map_err(err)?;
            let mut write = tx
                .prepare("INSERT INTO lib_refs (module, tbl, row_id, pos, book, chapter, verse, verse_end) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
                .map_err(err)?;
            let mut rows = read.query(params![module]).map_err(err)?;
            while let Some(row) = rows.next().map_err(err)? {
                let id: i64 = row.get(0).map_err(err)?;
                let text: String = row.get(1).map_err(err)?;
                for (pos, book, chapter, verse, end) in markers_in(&text) {
                    write.execute(params![module, tbl, id, pos as i64, book, chapter, verse, end]).map_err(err)?;
                }
            }
        }
        tx.execute("INSERT OR REPLACE INTO lib_refs_done (module, installed_at) VALUES (?1, ?2)", params![module, installed_at]).map_err(err)?;
        tx.commit().map_err(err)?;
    }
    Ok(todo.len())
}

#[derive(Serialize, Clone, Debug)]
pub struct RefMention {
    pub module: String,
    pub module_title: String,
    /// the module's kind: "book", "devotional", "dictionary" or "commentary"
    pub kind: String,
    /// for librarySection: a book's section id, or a dictionary or devotional entry's id
    /// (LIB_ID_BASE + its row); for a commentary, its row
    pub id: i64,
    /// a book or devotional: the section's place in its contents and the paragraph, for
    /// opening it there
    pub section: i64,
    pub para: i64,
    /// the section's title, the dictionary's headword, or the passage a commentary is on
    pub title: String,
    /// a commentary: the passage it is on
    pub on_book: Option<String>,
    pub on_chapter: Option<i64>,
    pub on_verse: Option<i64>,
    /// the passage as it is cited there ("John 3:16", "John 3")
    pub cited: String,
    /// the words around the mention, as plain text
    pub snippet: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct RefMentions {
    pub hits: Vec<RefMention>,
    /// every place found, before the limits
    pub total: usize,
}

/// The words around byte `pos` of `text`, whole markers only, as plain text.
fn around(text: &str, pos: usize, before: usize, after: usize) -> String {
    let mut start = pos.saturating_sub(before);
    while !text.is_char_boundary(start) {
        start += 1;
    }
    // begin at a paragraph or a sentence when there is one near
    if let Some(nl) = text[start..pos].rfind('\n') {
        start += nl + 1;
    } else if start > 0 {
        if let Some(dot) = text[start..pos].find(". ") {
            start += dot + 2;
        } else if let Some(space) = text[start..pos].find(char::is_whitespace) {
            // at least a whole word
            start += space + 1;
        }
    }
    // never inside a marker
    if let Some(close) = text[start..pos].find('⟧') {
        if text[start..pos].find('⟦').map_or(true, |o| close < o) {
            start += close + '⟧'.len_utf8();
        }
    }
    let mut end = (pos + after).min(text.len()).max(pos);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    let window = &text[start..end];
    let cut = match (window.rfind('⟦'), window.rfind('⟧')) {
        (Some(o), Some(c)) if o > c => o,
        (Some(o), None) => o,
        _ => window.len(),
    };
    let mut snippet = crate::study::plain_snippet(&window[..cut], before + after + 40);
    if start > 0 && !text[..start].ends_with('\n') {
        snippet.insert_str(0, "… ");
    }
    if end < text.len() {
        snippet.push_str(" …");
    }
    snippet
}

/// Where the installed books, dictionaries, devotionals and commentaries mention a passage
/// (`verse` 0: the whole chapter). Mentions of the verses themselves come before mentions of
/// only the chapter; books and devotionals before dictionaries before commentaries; at most
/// `per_module` from any one. A commentary's own notes on the passage are left out (the
/// commentary panel has them).
pub fn mentions_of(conn: &Connection, book: &str, chapter: i64, verse: i64, verse_end: i64, per_module: usize, limit: usize) -> Result<RefMentions, String> {
    let (first, last) = if verse > 0 { (verse, verse_end.max(verse)) } else { (1, i64::MAX) };
    let mut stmt = conn
        .prepare(
            "SELECT r.module, m.title, m.kind, r.tbl, r.row_id, r.pos, r.verse, r.verse_end
             FROM lib_refs r JOIN modules m ON m.name = r.module
             WHERE r.book = ?1 AND r.chapter = ?2 AND (r.verse = 0 OR (r.verse <= ?4 AND r.verse_end >= ?3))
             ORDER BY r.verse = 0,
                      CASE m.kind WHEN 'book' THEN 0 WHEN 'devotional' THEN 1 WHEN 'dictionary' THEN 2 ELSE 3 END,
                      r.verse_end - r.verse, r.module, r.row_id",
        )
        .map_err(err)?;
    type Cand = (String, String, String, String, i64, i64, i64, i64);
    let cands: Vec<Cand> = stmt
        .query_map(params![book, chapter, first, last], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    let mut hits = Vec::new();
    let mut total = 0;
    let mut per: HashMap<String, usize> = HashMap::new();
    let mut seen_rows = HashSet::new();
    for (module, module_title, kind, tbl, row_id, pos, v, ve) in cands {
        if !seen_rows.insert((tbl.clone(), row_id)) {
            continue;
        }
        // a commentary's note on this very passage is not a mention of it elsewhere
        let on: Option<(String, i64, i64)> = if tbl == "lib_comm" {
            let on: (String, i64, i64) = conn
                .query_row("SELECT book, chapter, verse_start FROM lib_comm WHERE id = ?1", params![row_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .map_err(err)?;
            if on.0 == book && on.1 == chapter && (verse == 0 || (on.2 >= first && on.2 <= last)) {
                continue;
            }
            Some(on)
        } else {
            None
        };
        total += 1;
        let n = per.entry(module.clone()).or_default();
        if *n >= per_module || hits.len() >= limit {
            continue;
        }
        *n += 1;
        let cited = match (v, ve) {
            (0, _) => format!("{book} {chapter}"),
            (v, e) if e > v => format!("{book} {chapter}:{v}-{e}"),
            (v, _) => format!("{book} {chapter}:{v}"),
        };
        let mut hit = RefMention {
            module: module.clone(),
            module_title,
            kind: kind.clone(),
            id: row_id,
            section: 0,
            para: 0,
            title: String::new(),
            on_book: None,
            on_chapter: None,
            on_verse: None,
            cited,
            snippet: String::new(),
        };
        let text: String = match (tbl.as_str(), on) {
            ("lib_comm", Some((b, c, vs))) => {
                hit.title = if vs > 0 { format!("On {b} {c}:{vs}") } else { format!("On {b} {c}") };
                (hit.on_book, hit.on_chapter, hit.on_verse) = (Some(b), Some(c), Some(vs.max(1)));
                conn.query_row("SELECT text FROM lib_comm WHERE id = ?1", params![row_id], |r| r.get(0)).map_err(err)?
            }
            ("lib_dict", _) => {
                let (head, body): (String, String) = conn.query_row("SELECT headword, body FROM lib_dict WHERE id = ?1", params![row_id], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
                hit.id = LIB_ID_BASE + row_id;
                hit.title = head;
                if kind == "devotional" {
                    hit.section = conn.query_row("SELECT count(*) FROM lib_dict WHERE module = ?1 AND id < ?2", params![module, row_id], |r| r.get(0)).map_err(err)?;
                }
                body
            }
            _ => {
                let (title, ord, text): (String, i64, String) = conn
                    .query_row("SELECT title, ord, text FROM lib_book WHERE id = ?1", params![row_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                    .map_err(err)?;
                hit.title = title;
                hit.section = conn.query_row("SELECT count(*) FROM lib_book WHERE module = ?1 AND ord < ?2", params![module, ord], |r| r.get(0)).map_err(err)?;
                text
            }
        };
        let mut pos = (pos as usize).min(text.len());
        while !text.is_char_boundary(pos) {
            pos -= 1;
        }
        hit.para = paragraph_break_rx().find_iter(&text[..pos]).count() as i64;
        hit.snippet = around(&text, pos, 220, 320);
        hits.push(hit);
    }
    Ok(RefMentions { hits, total })
}

// ---------------------------------------------------------------- what the books say on a subject

/// The parts of the installed books and devotionals that are about a subject ("faith in
/// God"), best first: the sections whose words (in any form: "faith", "faithful") include
/// every word of the subject, a section's title counting most, then those with only some of
/// them. At most `per_module` from any one book, each with the paragraph that says most.
pub fn topic_passages(conn: &Connection, query: &str, per_module: usize, limit: usize) -> Result<Vec<RefMention>, String> {
    let stems: Vec<String> = query
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 1 && !crate::sermon::is_stopword(w))
        .map(crate::sermon::stem)
        .filter(|s| s.len() > 1)
        .take(6)
        .collect();
    if stems.is_empty() {
        return Ok(Vec::new());
    }
    let terms: Vec<String> = stems.iter().map(|s| format!("\"{}\"*", s.replace('"', ""))).collect();
    // (table, row, module, module title, module kind, title, text, score: lower is better)
    type Cand = (&'static str, i64, String, String, String, String, String, f64);
    let mut cands: Vec<Cand> = Vec::new();
    let mut seen = HashSet::new();
    let exprs = if terms.len() > 1 { vec![terms.join(" AND "), terms.join(" OR ")] } else { vec![terms[0].clone()] };
    for (pass, expr) in exprs.iter().enumerate() {
        if pass > 0 && cands.len() >= limit {
            break;
        }
        let mut found: Vec<Cand> = Vec::new();
        let mut books = conn
            .prepare(
                "SELECT b.id, b.module, m.title, m.kind, b.title, b.text, bm25(lib_book_fts, 8.0, 1.0) FROM lib_book_fts f
                 JOIN lib_book b ON b.id = f.rowid JOIN modules m ON m.name = b.module
                 WHERE lib_book_fts MATCH ?1 ORDER BY bm25(lib_book_fts, 8.0, 1.0) LIMIT 300",
            )
            .map_err(err)?;
        for row in books.query_map(params![expr], |r| Ok(("lib_book", r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))).map_err(err)? {
            found.push(row.map_err(err)?);
        }
        let mut days = conn
            .prepare(
                "SELECT d.id, d.module, m.title, m.kind, d.headword, d.body, bm25(lib_dict_fts, 8.0, 1.0) FROM lib_dict_fts f
                 JOIN lib_dict d ON d.id = f.rowid JOIN modules m ON m.name = d.module
                 WHERE lib_dict_fts MATCH ?1 AND m.kind = 'devotional' ORDER BY bm25(lib_dict_fts, 8.0, 1.0) LIMIT 100",
            )
            .map_err(err)?;
        for row in days.query_map(params![expr], |r| Ok(("lib_dict", r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?))).map_err(err)? {
            found.push(row.map_err(err)?);
        }
        found.sort_by(|a, b| a.7.partial_cmp(&b.7).unwrap_or(std::cmp::Ordering::Equal));
        for c in found {
            if seen.insert((c.0, c.1)) {
                cands.push(c);
            }
        }
    }

    let mut out = Vec::new();
    let mut per: HashMap<String, usize> = HashMap::new();
    for (tbl, row_id, module, module_title, kind, title, text, _) in cands {
        if out.len() >= limit {
            break;
        }
        let n = per.entry(module.clone()).or_default();
        if *n >= per_module {
            continue;
        }
        *n += 1;
        // the paragraph that has the most of the subject's words (the first, if only the title has them)
        let paras: Vec<&str> = paragraph_break_rx().split(&text).collect();
        let score = |p: &str| {
            let p = p.to_lowercase();
            stems.iter().map(|s| p.matches(s.as_str()).count().min(4) * 3 + usize::from(p.contains(s.as_str())) * 10).sum::<usize>()
        };
        let (para, best) = paras.iter().enumerate().max_by_key(|(i, p)| (score(p), std::cmp::Reverse(*i))).map(|(i, p)| (i, *p)).unwrap_or((0, ""));
        let snippet = {
            let plain = crate::study::plain_snippet(best, 900);
            if plain.trim().is_empty() { crate::study::plain_snippet(&text, 600) } else { plain }
        };
        let section: i64 = if tbl == "lib_book" {
            conn.query_row("SELECT count(*) FROM lib_book WHERE module = ?1 AND ord < (SELECT ord FROM lib_book WHERE id = ?2)", params![module, row_id], |r| r.get(0)).map_err(err)?
        } else {
            conn.query_row("SELECT count(*) FROM lib_dict WHERE module = ?1 AND id < ?2", params![module, row_id], |r| r.get(0)).map_err(err)?
        };
        out.push(RefMention {
            module,
            module_title,
            kind,
            id: if tbl == "lib_dict" { LIB_ID_BASE + row_id } else { row_id },
            section,
            para: para as i64,
            title,
            on_book: None,
            on_chapter: None,
            on_verse: None,
            cited: String::new(),
            snippet,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn finds_what_the_books_say_on_a_subject() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        migrate(&conn, Path::new(".")).unwrap();
        for (name, kind) in [("Warfare", "book"), ("Action", "book"), ("Daily", "devotional")] {
            conn.execute(
                "INSERT INTO modules (name, kind, title, lang, language, licence, about, version, versification) VALUES (?1, ?2, ?1, 'en', 'English', '', '', '1', 'KJV')",
                params![name, kind],
            )
            .unwrap();
        }
        let rows = [
            (1, "Warfare", 0, "The armour", "Put on the whole armour.\n\nThe shield of faith quenches the darts, held up in trust towards God."),
            (2, "Warfare", 1, "Prayer", "Pray always, watching."),
            (3, "Warfare", 2, "Standing firm", "Stand therefore. A faithful soldier trusts God in the battle.\n\nNothing else here."),
            (4, "Warfare", 3, "More on faith", "Faith and God, faith and God, faith and God."),
            (5, "Action", 0, "Faith that works", "Introduction.\n\nFaith without works is dead; faith in God shows itself in deeds."),
        ];
        for (id, module, ord, title, text) in rows {
            conn.execute("INSERT INTO lib_book (id, module, parent, ord, title, text) VALUES (?1, ?2, NULL, ?3, ?4, ?5)", params![id, module, ord, title, text]).unwrap();
        }
        conn.execute("INSERT INTO lib_dict (id, module, key, headword, headword_fold, body) VALUES (9, 'Daily', '01.02', '01.02', '01.02', 'Have faith in God. Mark 11:22')", []).unwrap();
        conn.execute("INSERT INTO lib_book_fts(lib_book_fts) VALUES ('rebuild')", []).unwrap();
        conn.execute("INSERT INTO lib_dict_fts(lib_dict_fts) VALUES ('rebuild')", []).unwrap();

        let hits = topic_passages(&conn, "faith in God", 2, 20).unwrap();
        let found: Vec<(&str, &str)> = hits.iter().map(|h| (h.module.as_str(), h.title.as_str())).collect();
        // every book and the devotional; no more than two from one book; "Prayer" is not about it
        assert!(found.contains(&("Action", "Faith that works")), "{found:?}");
        assert!(found.contains(&("Daily", "01.02")), "{found:?}");
        assert_eq!(found.iter().filter(|(m, _)| *m == "Warfare").count(), 2, "{found:?}");
        assert!(!found.iter().any(|(_, t)| *t == "Prayer"));
        // the paragraph that says it, and where it is
        let action = hits.iter().find(|h| h.module == "Action").unwrap();
        assert_eq!((action.para, action.section), (1, 0));
        assert!(action.snippet.starts_with("Faith without works"), "{}", action.snippet);
        assert_eq!(hits.iter().find(|h| h.module == "Daily").unwrap().id, LIB_ID_BASE + 9);
        // "faithful" counts as faith; words the subject doesn't need are ignored
        assert!(topic_passages(&conn, "the faithful", 5, 20).unwrap().iter().any(|h| h.title == "Standing firm"));
        assert!(topic_passages(&conn, "the and of", 5, 20).unwrap().is_empty());
    }

    #[test]
    fn finds_where_a_passage_is_mentioned() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        migrate(&conn, Path::new(".")).unwrap();
        for (name, kind) in [("Owen", "book"), ("ISBE", "dictionary"), ("Barnes", "commentary"), ("KJV2", "bible")] {
            conn.execute(
                "INSERT INTO modules (name, kind, title, lang, language, licence, about, version, versification) VALUES (?1, ?2, ?1, 'en', 'English', '', '', '1', 'KJV')",
                params![name, kind],
            )
            .unwrap();
        }
        let john316 = "⟦John|3|16||John 3:16⟧";
        conn.execute("INSERT INTO lib_book (id, module, parent, ord, title, text) VALUES (1, 'Owen', NULL, 0, 'Preface', 'Nothing here.')", []).unwrap();
        conn.execute(
            "INSERT INTO lib_book (id, module, parent, ord, title, text) VALUES (2, 'Owen', NULL, 1, 'Of love', ?1)",
            params![format!("First paragraph.\n\nGod so loved, as {john316} says, and ⟦Romans|5|8||Rom 5:8⟧ too. Again {john316}.")],
        )
        .unwrap();
        conn.execute("INSERT INTO lib_dict (id, module, key, headword, headword_fold, body) VALUES (7, 'ISBE', 'LOVE', 'LOVE', 'love', 'See ⟦John|3|||John 3⟧ and ⟦John|3|14|17|John 3:14-17⟧.')", []).unwrap();
        conn.execute("INSERT INTO lib_comm (id, module, book, chapter, verse_start, text) VALUES (1, 'Barnes', 'John', 3, 16, ?1)", params![format!("For God so loved: compare {john316}.")]).unwrap();
        conn.execute("INSERT INTO lib_comm (id, module, book, chapter, verse_start, text) VALUES (2, 'Barnes', 'Romans', 5, 8, ?1)", params![format!("Commendeth his love: as in {john316}.")]).unwrap();
        for fts in ["lib_book_fts", "lib_dict_fts", "lib_comm_fts"] {
            conn.execute(&format!("INSERT INTO {fts}({fts}) VALUES ('rebuild')"), []).unwrap();
        }
        assert_eq!(ensure_ref_index(&mut conn).unwrap(), 3);
        assert_eq!(ensure_ref_index(&mut conn).unwrap(), 0);
        // the second mention in the same section is not indexed again
        let n: i64 = conn.query_row("SELECT count(*) FROM lib_refs WHERE module = 'Owen'", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);

        let m = mentions_of(&conn, "John", 3, 16, 16, 5, 50).unwrap();
        let found: Vec<(&str, &str)> = m.hits.iter().map(|h| (h.module.as_str(), h.title.as_str())).collect();
        // the book, the dictionary (John 3:14-17), the commentary on Romans; Barnes's own note
        // on John 3:16 is left out
        assert_eq!(found, vec![("Owen", "Of love"), ("ISBE", "LOVE"), ("Barnes", "On Romans 5:8")], "{m:?}");
        assert_eq!(m.total, 3);
        let owen = &m.hits[0];
        assert_eq!((owen.section, owen.para, owen.cited.as_str()), (1, 1, "John 3:16"));
        assert!(owen.snippet.starts_with("God so loved, as John 3:16 says") && !owen.snippet.contains('⟦'), "{}", owen.snippet);
        assert_eq!((m.hits[1].id, m.hits[1].cited.as_str()), (LIB_ID_BASE + 7, "John 3:14-17"));
        assert_eq!(m.hits[2].on_book.as_deref(), Some("Romans"));
        // the whole chapter: every place, the commentary on John 3 itself still left out
        assert_eq!(mentions_of(&conn, "John", 3, 0, 0, 5, 50).unwrap().hits.len(), 3);
        assert!(mentions_of(&conn, "John", 4, 1, 1, 5, 50).unwrap().hits.is_empty());
        assert_eq!(mentions_of(&conn, "John", 3, 16, 16, 5, 1).unwrap().hits.len(), 1);

        remove(&mut conn, "Owen").unwrap();
        assert!(mentions_of(&conn, "John", 3, 16, 16, 5, 50).unwrap().hits.iter().all(|h| h.module != "Owen"));
    }

    /// Parses the real CrossWire catalogue (downloaded to library-probe\mods.d.tar.gz).
    #[test]
    #[ignore]
    fn parses_real_catalog() {
        let path = PathBuf::from(std::env::var("LOCALAPPDATA").unwrap()).join("bible-concordance-build/library-probe/mods.d.tar.gz");
        let confs = parse_catalog(&std::fs::read(path).unwrap()).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        migrate(&conn, Path::new(".")).unwrap();
        let items = catalog_items(&confs, &conn, "crosswire", BUILT_IN).unwrap();
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

    /// A small MyBible Bible (ph4.org's format), made here: Genesis 1:1-30 and John 3:16-35, books numbered 10 and 500.
    fn mybible_bible(code: &str, notes_file: bool) -> Vec<u8> {
        let p = std::env::temp_dir().join(format!("bc-mybible-{}-{code}.SQLite3", std::process::id()));
        let _ = std::fs::remove_file(&p);
        {
            let c = Connection::open(&p).unwrap();
            if notes_file {
                c.execute_batch(
                    "CREATE TABLE info(name TEXT, value TEXT); INSERT INTO info VALUES ('description', 'Test MyBible');
                     CREATE TABLE commentaries(book_number NUMERIC, chapter_number_from NUMERIC, verse_number_from NUMERIC, chapter_number_to NUMERIC, verse_number_to NUMERIC, marker TEXT, text TEXT);
                     INSERT INTO commentaries VALUES (10, 1, 1, 1, 1, 'a', 'a note');",
                )
                .unwrap();
            } else {
                c.execute_batch("CREATE TABLE info(name TEXT, value TEXT); CREATE TABLE verses(book_number NUMERIC, chapter NUMERIC, verse NUMERIC, text TEXT);").unwrap();
                c.execute("INSERT INTO info VALUES ('description', ?1), ('language', 'en'), ('detailed_info', 'Your own copy, not to share.')", params![format!("Test MyBible {code}")]).unwrap();
                for v in 1..=30 {
                    c.execute("INSERT INTO verses VALUES (10, 1, ?1, ?2)", params![v, format!("<pb/>Genesis<f>[1]</f> verse {v}.")]).unwrap();
                }
                for v in 16..=35 {
                    c.execute("INSERT INTO verses VALUES (500, 3, ?1, ?2)", params![v, if v == 16 { "<J>John verse</J> 16.".to_string() } else { format!("John verse {v}.") }]).unwrap();
                }
            }
        }
        let bytes = std::fs::read(&p).unwrap();
        let _ = std::fs::remove_file(&p);
        bytes
    }

    /// A small MySword Bible, made here: Genesis 1:1-30 and John 3:16-35.
    fn mysword_bible(abbr: &str) -> Vec<u8> {
        let p = std::env::temp_dir().join(format!("bc-mysword-{}-{abbr}.bbl.mybible", std::process::id()));
        let _ = std::fs::remove_file(&p);
        {
            let c = Connection::open(&p).unwrap();
            c.execute_batch("CREATE TABLE Bible(Book INT, Chapter INT, Verse INT, Scripture TEXT); CREATE TABLE Details(Description TEXT, Abbreviation TEXT, Comments TEXT, Language TEXT);").unwrap();
            c.execute("INSERT INTO Details VALUES (?1, ?2, 'Free to share, not to sell.', 'af')", params![format!("Test Bible {abbr}"), abbr]).unwrap();
            for v in 1..=30 {
                c.execute("INSERT INTO Bible VALUES (1, 1, ?1, ?2)", params![v, format!("<TS>Head<Ts>Genesis verse {v}<RF>note<Rf>.<CM>")]).unwrap();
            }
            for v in 16..=35 {
                c.execute("INSERT INTO Bible VALUES (43, 3, ?1, ?2)", params![v, format!("John verse {v}.")]).unwrap();
            }
        }
        let bytes = std::fs::read(&p).unwrap();
        let _ = std::fs::remove_file(&p);
        bytes
    }

    #[test]
    fn esword_and_mysword_modules_from_a_file() {
        let dir = std::env::temp_dir().join(format!("bc-esword-lib-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let state = open(&dir).unwrap();

        // a MySword Bible: checked (nothing added yet), then added; read like any Bible
        let bytes = mysword_bible("TB1");
        let r = import_check(&state, &bytes, Some("tb1.bbl.mybible")).unwrap();
        assert_eq!((r.kind.as_str(), r.name.as_str(), r.entries, r.books), ("bible", "TB1", 50, 2));
        assert!(r.warnings.iter().any(|w| w.contains("2 of the 66")), "{:?}", r.warnings);
        assert!(versions(&state.conn.lock().unwrap()).unwrap().iter().all(|v| v.code != "TB1"), "a check adds nothing");
        let done = import_install(&state, &|_| {}).unwrap();
        assert_eq!(done.name, "TB1");
        {
            let conn = state.conn.lock().unwrap();
            assert!(versions(&conn).unwrap().iter().any(|v| v.code == "TB1"));
            assert_eq!(verse(&conn, "TB1", "Genesis", 1, 1).unwrap().as_deref(), Some("Genesis verse 1."));
            assert_eq!(chapter(&conn, "TB1", "John", 3).unwrap().len(), 20);
            let m = installed(&conn, None).unwrap().into_iter().find(|m| m.name == "TB1").unwrap();
            assert_eq!((m.source.as_str(), m.language.is_empty()), ("file", false));
            assert!(m.licence.starts_with("Your own copy"));
        }

        // the same, packed in a .gz and in a .zip, as MySword's site gives them
        let gz = {
            let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
            std::io::Write::write_all(&mut e, &mysword_bible("TB2")).unwrap();
            e.finish().unwrap()
        };
        assert_eq!(import_check(&state, &gz, Some("tb2.bbl.mybible.gz")).unwrap().name, "TB2");
        let zipped = {
            let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
            z.start_file("tb3.bbl.mybible", zip::write::SimpleFileOptions::default()).unwrap();
            std::io::Write::write_all(&mut z, &mysword_bible("TB3")).unwrap();
            z.finish().unwrap().into_inner()
        };
        assert_eq!(import_check(&state, &zipped, Some("tb3.zip")).unwrap().name, "TB3");
        import_cancel(&state);

        // a MyBible Bible, zipped with its footnotes file as the downloads come: the Bible is added, as a Bible
        let zipped = {
            let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
            z.start_file("MB4.SQLite3", zip::write::SimpleFileOptions::default()).unwrap();
            std::io::Write::write_all(&mut z, &mybible_bible("MB4", false)).unwrap();
            z.start_file("MB4.commentaries.SQLite3", zip::write::SimpleFileOptions::default()).unwrap();
            std::io::Write::write_all(&mut z, &mybible_bible("MB4", true)).unwrap();
            z.finish().unwrap().into_inner()
        };
        let r = import_check(&state, &zipped, Some("MB4.zip")).unwrap();
        assert_eq!((r.kind.as_str(), r.name.as_str(), r.entries), ("bible", "MB4", 50), "{r:?}");
        assert!(r.warnings.iter().any(|w| w.contains("will be added to your commentaries")), "{:?}", r.warnings);
        let done = import_install(&state, &|_| {}).unwrap();
        assert!(done.warnings.iter().any(|w| w.contains("were added to your commentaries")), "{:?}", done.warnings);
        {
            let conn = state.conn.lock().unwrap();
            // its notes are a commentary of their own, its red letters are kept
            assert!(installed(&conn, Some("commentary")).unwrap().iter().any(|m| m.name == "MB4-notes" && m.entries == 1));
            let red = red_letter(&conn, "MB4", "John", 3).unwrap();
            assert_eq!(red.get("16"), Some(&vec![(0, 1)]), "{red:?}");
            assert!(red_letter(&conn, "MB4", "Genesis", 1).unwrap().is_empty());
            assert!(versions(&conn).unwrap().iter().any(|v| v.code == "MB4"));
            assert_eq!(verse(&conn, "MB4", "Genesis", 1, 2).unwrap().as_deref(), Some("Genesis verse 2."));
            assert_eq!(chapter(&conn, "MB4", "John", 3).unwrap().len(), 20);
        }
        // the same file on its own; and its footnotes file on its own is a commentary
        assert_eq!(import_check(&state, &mybible_bible("MB5", false), Some("MB5.SQLite3")).unwrap().name, "MB5");
        import_cancel(&state);
        let r = import_check(&state, &mybible_bible("MB6", true), Some("MB6.commentaries.SQLite3")).unwrap();
        assert_eq!((r.kind.as_str(), r.name.as_str(), r.entries), ("commentary", "MB6-notes", 1), "{r:?}");
        import_cancel(&state);

        // an atlas (MyBible's form): its maps, the place index and the pictures are kept, and read back
        {
            let atlas = {
                let p = dir.join("bc-atlas.SQLite3");
                let _ = std::fs::remove_file(&p);
                Connection::open(&p)
                    .unwrap()
                    .execute_batch(
                        "CREATE TABLE info(name TEXT, value TEXT); CREATE TABLE dictionary(topic TEXT, definition TEXT); CREATE TABLE content_fragments(id TEXT, fragment TEXT);
                         INSERT INTO info VALUES ('description', 'Test Atlas'), ('type', 'atlas'), ('detailed_info', 'Rights reserved');
                         INSERT INTO content_fragments VALUES ('a.png', '<img src=\"data:image/png;base64,iVBORw0KGgo=\">');
                         INSERT INTO dictionary VALUES ('#01. The Land', '<figure><!-- INCLUDE(a.png) --></figure><ol><li data-marker=\"1.\"><p>Hebron</p></li></ol>'),
                           ('Hebron', 'Hebron: <a href=\"S:#01. The Land\">1:B3</a>.'), ('Hebrew Sea', 'x: <a href=\"S:#01. The Land\">1:C1</a>.');",
                    )
                    .unwrap();
                std::fs::read(&p).unwrap()
            };
            let r = import_check(&state, &atlas, Some("TestAtlas.SQLite3")).unwrap();
            assert_eq!((r.kind.as_str(), r.entries), ("atlas", 1), "{r:?}");
            import_install(&state, &|_| {}).unwrap();
            let conn = state.conn.lock().unwrap();
            let maps = atlas_maps(&conn).unwrap();
            assert_eq!(maps.len(), 1);
            assert_eq!((maps[0].title.as_str(), maps[0].atlas_title.as_str(), maps[0].cols, maps[0].rows, maps[0].mime.as_str()), ("The Land", "Test Atlas", 3, 3, "image/png"));
            assert_eq!(atlas_image(&conn, maps[0].id).unwrap().map(|b| b.len()), Some(8));
            let hits = atlas_places(&conn, "heb", 10).unwrap();
            assert_eq!(hits.iter().map(|h| (h.name.as_str(), h.col, h.row)).collect::<Vec<_>>(), vec![("Hebrew Sea", 2, 0), ("Hebron", 1, 2)]);
            assert!(atlas_places(&conn, "zzz", 10).unwrap().is_empty());
            // removing it takes the maps and places with it
            drop(conn);
            remove(&mut *state.conn.lock().unwrap(), "TestAtlas").unwrap();
            let conn = state.conn.lock().unwrap();
            assert!(atlas_maps(&conn).unwrap().is_empty() && atlas_places(&conn, "heb", 10).unwrap().is_empty());
        }

        // one the app already has is refused, as for SWORD modules
        let e = import_check(&state, &mysword_bible("BSB"), Some("bsb.bbl.mybible")).unwrap_err();
        assert!(e.contains("built in"), "{e}");

        // an e-Sword topics file (RTF) becomes a dictionary of subjects
        let p = dir.join("t.topx");
        Connection::open(&p).unwrap().execute_batch(r"CREATE TABLE Topics(Title TEXT, Notes TEXT); INSERT INTO Topics VALUES ('Joy', '{\rtf1 Joy, as in Gal 5:22.\par}');").unwrap();
        let r = import_check(&state, &std::fs::read(&p).unwrap(), Some("Joy topics.topx")).unwrap();
        assert_eq!((r.kind.as_str(), r.entries), ("dictionary", 1));
        import_install(&state, &|_| {}).unwrap();
        let conn = state.conn.lock().unwrap();
        let body: String = conn.query_row("SELECT body FROM lib_dict WHERE headword = 'Joy'", [], |r| r.get(0)).unwrap();
        assert!(body.contains("⟦Galatians|5|22||Gal 5:22⟧"), "{body}");
        drop(conn);

        // a locked one is refused with the reason, and nothing is left waiting
        let p = dir.join("l.bblx");
        Connection::open(&p)
            .unwrap()
            .execute_batch("CREATE TABLE Bible(Book INT, Chapter INT, Verse INT, Scripture BLOB_TEXT); CREATE TABLE sqliteplus_license(Name TEXT); INSERT INTO Bible VALUES (1,1,1,x'00ff10203040506070809a');")
            .unwrap();
        let e = import_check(&state, &std::fs::read(&p).unwrap(), Some("l.bblx")).unwrap_err();
        assert!(e.contains("locked"), "{e}");
        assert!(import_install(&state, &|_| {}).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
