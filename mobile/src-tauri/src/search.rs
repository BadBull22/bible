//! Reading and searching the Bible on the phone.
//!
//! The search works out what was meant (`bible_core::find`: spelling, names, numbers, the
//! well-known stories), gathers the desktop app's subject search (`sermon::find`: the central
//! passages for a subject, the exact phrase in any translation, every form of the words, the
//! topical Bibles) and, with the Advanced search upgrade, the verses nearest in meaning
//! (`bible_core::meaning`), and ranks them all into passages the way the desktop does. This
//! module shows them in the translation being read and keeps them to a testament or a book
//! when asked.

use std::collections::HashSet;
use std::sync::OnceLock;

use bible_core::find::{self, Curated, Vocab, VerseKey};
use bible_core::meaning::Meaning;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::sermon;

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

#[derive(Serialize, Debug)]
pub struct Version {
    pub code: String,
    pub name: String,
    pub license_note: String,
}

pub fn versions(conn: &Connection) -> Result<Vec<Version>, String> {
    let mut s = conn.prepare("SELECT code, name, license_note FROM versions ORDER BY id").map_err(err)?;
    let rows = s.query_map([], |r| Ok(Version { code: r.get(0)?, name: r.get(1)?, license_note: r.get(2)? })).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[derive(Serialize, Debug)]
pub struct Book {
    pub name: String,
    /// "OT" | "NT"
    pub testament: String,
    pub chapters: i64,
}

pub fn books(conn: &Connection) -> Result<Vec<Book>, String> {
    let mut s = conn
        .prepare(
            "SELECT b.name, b.testament, (SELECT max(v.chapter) FROM verses v WHERE v.book_id = b.id AND v.version_id = (SELECT min(id) FROM versions))
             FROM books b ORDER BY b.order_index",
        )
        .map_err(err)?;
    let rows = s.query_map([], |r| Ok(Book { name: r.get(0)?, testament: r.get(1)?, chapters: r.get::<_, Option<i64>>(2)?.unwrap_or(1) })).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

#[derive(Serialize, Debug)]
pub struct Verse {
    pub verse: i64,
    pub text: String,
    /// the words of Jesus in it: inclusive [first, last] ranges of its words (a word is a run
    /// of letters and digits); empty for most verses
    pub red: Vec<(usize, usize)>,
}

pub fn chapter(conn: &Connection, version: &str, book: &str, chapter: i64) -> Result<Vec<Verse>, String> {
    let mut s = conn
        .prepare(
            "SELECT v.verse, v.text, r.ranges FROM verses v JOIN books b ON b.id = v.book_id JOIN versions ver ON ver.id = v.version_id
             LEFT JOIN red_letter r ON r.version_id = v.version_id AND r.book_id = v.book_id AND r.chapter = v.chapter AND r.verse = v.verse
             WHERE ver.code = ?1 AND b.name = ?2 AND v.chapter = ?3 ORDER BY v.verse",
        )
        .map_err(err)?;
    let rows = s
        .query_map(params![version, book, chapter], |r| {
            let ranges: Option<String> = r.get(2)?;
            Ok(Verse { verse: r.get(0)?, text: r.get(1)?, red: ranges.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default() })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/// The text of a verse, or of a short passage, in one translation ("" if it has none).
pub fn passage(conn: &Connection, version: &str, book: &str, chapter: i64, start: i64, end: i64) -> String {
    let Ok(mut s) = conn.prepare(
        "SELECT v.text FROM verses v JOIN books b ON b.id = v.book_id JOIN versions ver ON ver.id = v.version_id
         WHERE ver.code = ?1 AND b.name = ?2 AND v.chapter = ?3 AND v.verse BETWEEN ?4 AND ?5 ORDER BY v.verse",
    ) else {
        return String::new();
    };
    let rows = s.query_map(params![version, book, chapter, start, end.max(start)], |r| r.get::<_, String>(0));
    rows.map(|r| r.filter_map(Result::ok).collect::<Vec<_>>().join(" ")).unwrap_or_default()
}

#[derive(Serialize, Debug, Clone)]
pub struct Hit {
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub verse_end: i64,
    /// why it was found: "story" | "core" | "phrase" | "words" | "meaning" | "name"
    pub why: Vec<String>,
    /// the found verses of the passage (with their numbers when there are several)
    pub text: String,
}

/// A heading of one of the topical Bibles that fits what was typed.
#[derive(Serialize, Debug)]
pub struct Topic {
    pub id: i64,
    pub name: String,
    /// "Nave's Topical Bible" | "Torrey's New Topical Textbook"
    pub source: String,
    pub verses: i64,
}

#[derive(Serialize, Debug)]
pub struct SearchResult {
    pub hits: Vec<Hit>,
    /// verses with exactly the words typed, in the translation being read (within the scope)
    pub exact: i64,
    pub topics: Vec<Topic>,
    /// dictionary articles on what was typed
    pub articles: Vec<ArticleHead>,
    /// misspelt words and the Bible's words they were taken for
    pub corrected: Vec<(String, String)>,
    /// whether the Advanced search upgrade took part
    pub by_meaning: bool,
}

/// Where to look: everywhere, one testament ("OT" / "NT"), or one book.
#[derive(Default, Clone, Copy)]
pub struct Scope<'a> {
    pub testament: Option<&'a str>,
    pub book: Option<&'a str>,
}

fn phrase_query(query: &str) -> String {
    format!("\"{}\"", query.replace('"', " ").split_whitespace().collect::<Vec<_>>().join(" "))
}

/// Reads the Bibles' words ahead of the first search (on start, off the main thread).
pub fn warm(db: &Connection) {
    vocab(db);
}

/// The words of the Bibles, read once (for putting spelling right).
fn vocab(db: &Connection) -> &'static Vocab {
    static VOCAB: OnceLock<Vocab> = OnceLock::new();
    VOCAB.get_or_init(|| Vocab::load(db).unwrap_or_default())
}

const SUPERSCRIPT: [char; 10] = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];

fn superscript(n: i64) -> String {
    n.to_string().chars().map(|c| SUPERSCRIPT[c.to_digit(10).unwrap_or(0) as usize]).collect()
}

/// A found passage's text: all of it when short, otherwise the verses that were found, with
/// "…" for the ones left out.
fn found_text(db: &Connection, version: &str, f: &find::Found) -> String {
    if f.verse_end - f.verse < 4 {
        return passage(db, version, &f.book, f.chapter, f.verse, f.verse_end);
    }
    let mut out = String::new();
    let mut last: Option<i64> = None;
    for &v in &f.verses {
        let text = passage(db, version, &f.book, f.chapter, v, v);
        if text.is_empty() {
            continue;
        }
        match last {
            Some(l) if v == l + 1 => out.push(' '),
            Some(_) => out.push_str(" … "),
            None => {}
        }
        out.push_str(&superscript(v));
        out.push_str(&text);
        last = Some(v);
    }
    out
}

pub fn search(db: &Connection, study: &Connection, query: &str, version: &str, scope: Scope, limit: usize, meaning: Option<&Meaning>) -> Result<SearchResult, String> {
    let query = query.trim();
    if !query.chars().any(char::is_alphanumeric) {
        return Ok(SearchResult { hits: Vec::new(), exact: 0, topics: Vec::new(), articles: Vec::new(), corrected: Vec::new(), by_meaning: false });
    }
    let understood = find::understand(db, vocab(db), query);
    let near: Vec<VerseKey> = match meaning {
        Some(m) => m.search(&understood.text, 500).map(|n| n.into_iter().map(|x| x.0).collect()).unwrap_or_default(),
        None => Vec::new(),
    };
    // the subject search, with the spelling put right
    let subject = if understood.corrected.is_empty() { query.to_string() } else { understood.text.clone() };
    let curated: Vec<Curated> = sermon::find(db, Some(study), &subject, 80)
        .into_iter()
        .map(|h| Curated { key: VerseKey { book: h.book, chapter: h.chapter, verse: h.verse }, verse_end: h.verse_end.max(h.verse), why: h.why.iter().map(|w| w.to_string()).collect() })
        .collect();
    let found = find::rank(db, &understood, &near, &curated, find::Scope { testament: scope.testament, book: scope.book }, limit)?;
    let hits = found
        .iter()
        .filter_map(|f| {
            let text = found_text(db, version, f);
            (!text.is_empty()).then(|| Hit { book: f.book.clone(), chapter: f.chapter, verse: f.verse, verse_end: f.verse_end, why: f.why.clone(), text })
        })
        .collect();

    // how many verses have exactly these words in the translation being read
    let exact: i64 = db
        .query_row(
            // (the index is asked once for all its verses: joined, SQLite asked it verse by verse,
            // seconds on a phone for "end of days")
            "SELECT COUNT(*) FROM verses v JOIN versions ver ON ver.id = v.version_id JOIN books b ON b.id = v.book_id
             WHERE v.id IN (SELECT rowid FROM verses_fts WHERE verses_fts MATCH ?1)
             AND ver.code = ?2 AND (?3 IS NULL OR b.testament = ?3) AND (?4 IS NULL OR b.name = ?4)",
            params![phrase_query(query), version, scope.testament, scope.book],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(SearchResult {
        hits,
        exact,
        topics: topics(study, &subject)?,
        articles: articles(study, &subject, 6)?,
        corrected: understood.corrected,
        by_meaning: meaning.is_some(),
    })
}

fn source_name(code: &str) -> &'static str {
    match code {
        "nave" => "Nave's Topical Bible",
        "torrey" => "Torrey's New Topical Textbook",
        "easton" => "Easton's Bible Dictionary",
        "smith" => "Smith's Bible Dictionary",
        _ => "Topical Bible",
    }
}

/// Topical headings that are, or begin with, what was typed ("faith", "holy spirit").
pub fn topics(study: &Connection, query: &str) -> Result<Vec<Topic>, String> {
    let fold = query.trim().to_lowercase();
    if fold.len() < 3 {
        return Ok(Vec::new());
    }
    let mut s = study
        .prepare(
            "SELECT e.id, e.headword, e.dict_code, (SELECT count(*) FROM dict_refs r WHERE r.entry_id = e.id AND r.verse IS NOT NULL) AS n
             FROM dict_entries e WHERE e.body = '' AND (e.headword_fold = ?1 OR e.headword_fold LIKE ?2) AND n > 0
             ORDER BY e.headword_fold <> ?1, length(e.headword_fold), n DESC LIMIT 8",
        )
        .map_err(err)?;
    let like = format!("{}%", fold.replace(['%', '_'], " "));
    let rows = s
        .query_map(params![fold, like], |r| Ok(Topic { id: r.get(0)?, name: r.get(1)?, source: source_name(&r.get::<_, String>(2)?).to_string(), verses: r.get(3)? }))
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/// Every verse a topical heading lists, in Bible order.
pub fn topic_verses(db: &Connection, study: &Connection, id: i64, version: &str, limit: usize) -> Result<Vec<Hit>, String> {
    let mut s = study.prepare("SELECT book, chapter, verse, verse_end FROM dict_refs WHERE entry_id = ?1 AND verse IS NOT NULL").map_err(err)?;
    let refs: Vec<(String, i64, i64, Option<i64>)> = s.query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(err)?.filter_map(Result::ok).collect();
    let mut order = db.prepare("SELECT order_index FROM books WHERE name = ?1").map_err(err)?;
    let mut seen = HashSet::new();
    let mut out: Vec<(i64, Hit)> = Vec::new();
    for (book, chapter, verse, end) in refs {
        if !seen.insert((book.clone(), chapter, verse)) {
            continue;
        }
        let Some(at) = order.query_row(params![book], |r| r.get::<_, i64>(0)).optional().map_err(err)? else { continue };
        let verse_end = end.filter(|e| *e > verse && *e - verse <= 12).unwrap_or(verse);
        let text = passage(db, version, &book, chapter, verse, verse_end);
        if !text.is_empty() {
            out.push((at, Hit { book, chapter, verse, verse_end, why: vec!["topical".into()], text }));
        }
    }
    out.sort_by_key(|(at, h)| (*at, h.chapter, h.verse));
    Ok(out.into_iter().map(|(_, h)| h).take(limit).collect())
}

// ---------------------------------------------------------------- the dictionaries

/// A dictionary article's title, for a list.
#[derive(Serialize, Debug)]
pub struct ArticleHead {
    pub id: i64,
    pub name: String,
    pub source: String,
}

/// A dictionary article. `body` is plain text; a Scripture reference in it is marked
/// ⟦Book|chapter|verse|verse_end|label⟧ (as in the desktop app), for the page to make a link of.
#[derive(Serialize, Debug)]
pub struct Article {
    pub id: i64,
    pub name: String,
    pub source: String,
    pub body: String,
}

/// Articles whose title is, begins with, or (for longer words) contains what was typed --
/// in that order, Easton's before Smith's.
pub fn articles(study: &Connection, query: &str, limit: usize) -> Result<Vec<ArticleHead>, String> {
    let fold = query.trim().to_lowercase();
    if fold.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let clean = fold.replace(['%', '_'], " ");
    let mut s = study
        .prepare(
            "SELECT id, headword, dict_code FROM dict_entries
             WHERE body <> '' AND (headword_fold = ?1 OR headword_fold LIKE ?2 OR (?4 AND headword_fold LIKE ?3))
             ORDER BY headword_fold <> ?1, headword_fold NOT LIKE ?2, length(headword_fold), headword_fold, dict_code LIMIT ?5",
        )
        .map_err(err)?;
    let rows = s
        .query_map(params![fold, format!("{clean}%"), format!("%{clean}%"), clean.chars().count() >= 4, limit as i64], |r| {
            Ok(ArticleHead { id: r.get(0)?, name: r.get(1)?, source: source_name(&r.get::<_, String>(2)?).to_string() })
        })
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

pub fn article(study: &Connection, id: i64) -> Result<Option<Article>, String> {
    study
        .query_row("SELECT id, headword, dict_code, body FROM dict_entries WHERE id = ?1 AND body <> ''", params![id], |r| {
            Ok(Article { id: r.get(0)?, name: r.get(1)?, source: source_name(&r.get::<_, String>(2)?).to_string(), body: r.get(3)? })
        })
        .optional()
        .map_err(err)
}

// ---------------------------------------------------------------- one verse, looked at more closely

/// The verses most often read together with this one, the most agreed-on first.
pub fn cross_refs(db: &Connection, version: &str, book: &str, chapter: i64, verse: i64) -> Result<Vec<Hit>, String> {
    let mut s = db
        .prepare(
            "SELECT b.name, x.to_chapter, x.to_verse, x.to_verse_end FROM xrefs x JOIN books a ON a.id = x.book_id JOIN books b ON b.id = x.to_book_id
             WHERE a.name = ?1 AND x.chapter = ?2 AND x.verse = ?3 ORDER BY x.rank",
        )
        .map_err(err)?;
    let refs: Vec<(String, i64, i64, i64)> = s.query_map(params![book, chapter, verse], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).map_err(err)?.filter_map(Result::ok).collect();
    let mut out = Vec::new();
    for (book, chapter, verse, end) in refs {
        // a long range is shown by its first few verses
        let verse_end = end.clamp(verse, verse + 5);
        let text = passage(db, version, &book, chapter, verse, verse_end);
        if !text.is_empty() {
            out.push(Hit { book, chapter, verse, verse_end, why: Vec::new(), text });
        }
    }
    Ok(out)
}

/// The verse in every translation: (code, text), in the app's order.
pub fn compare(db: &Connection, book: &str, chapter: i64, verse: i64) -> Result<Vec<(String, String)>, String> {
    let mut s = db
        .prepare(
            "SELECT ver.code, v.text FROM verses v JOIN books b ON b.id = v.book_id JOIN versions ver ON ver.id = v.version_id
             WHERE b.name = ?1 AND v.chapter = ?2 AND v.verse = ?3 ORDER BY ver.id",
        )
        .map_err(err)?;
    let rows = s.query_map(params![book, chapter, verse], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}
