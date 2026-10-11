//! Reading and searching the Bible on the phone.
//!
//! The search itself is the desktop app's subject search (`sermon::find`: the central
//! passages for a subject, the exact phrase, every form of the words, and the topical
//! Bibles), so both apps answer a question the same way. This module shows its results in
//! the translation being read, keeps them to a testament or a book when asked, and makes
//! sure no verse with the exact words typed is left out.

use std::collections::HashSet;

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
}

pub fn chapter(conn: &Connection, version: &str, book: &str, chapter: i64) -> Result<Vec<Verse>, String> {
    let mut s = conn
        .prepare(
            "SELECT v.verse, v.text FROM verses v JOIN books b ON b.id = v.book_id JOIN versions ver ON ver.id = v.version_id
             WHERE ver.code = ?1 AND b.name = ?2 AND v.chapter = ?3 ORDER BY v.verse",
        )
        .map_err(err)?;
    let rows = s.query_map(params![version, book, chapter], |r| Ok(Verse { verse: r.get(0)?, text: r.get(1)? })).map_err(err)?;
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
    /// why it was found: "core" | "phrase" | "words" | "topical" | "some"
    pub why: Vec<String>,
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
}

/// Where to look: everywhere, one testament ("OT" / "NT"), or one book.
#[derive(Default, Clone, Copy)]
pub struct Scope<'a> {
    pub testament: Option<&'a str>,
    pub book: Option<&'a str>,
}

fn testament_of(conn: &Connection, book: &str) -> Option<String> {
    conn.query_row("SELECT testament FROM books WHERE name = ?1", params![book], |r| r.get(0)).optional().ok().flatten()
}

fn phrase_query(query: &str) -> String {
    format!("\"{}\"", query.replace('"', " ").split_whitespace().collect::<Vec<_>>().join(" "))
}

pub fn search(db: &Connection, study: &Connection, query: &str, version: &str, scope: Scope, limit: usize) -> Result<SearchResult, String> {
    let query = query.trim();
    if !query.chars().any(char::is_alphanumeric) {
        return Ok(SearchResult { hits: Vec::new(), exact: 0, topics: Vec::new(), articles: Vec::new() });
    }
    let in_scope = |book: &str| {
        scope.book.map_or(true, |b| b == book) && scope.testament.map_or(true, |t| testament_of(db, book).as_deref() == Some(t))
    };

    let mut seen: HashSet<(String, i64, i64)> = HashSet::new();
    let mut hits: Vec<Hit> = Vec::new();
    for h in sermon::find(db, Some(study), query, 400) {
        if !in_scope(&h.book) {
            continue;
        }
        let text = passage(db, version, &h.book, h.chapter, h.verse, h.verse_end);
        if text.is_empty() {
            continue;
        }
        for v in h.verse..=h.verse_end.max(h.verse) {
            seen.insert((h.book.clone(), h.chapter, v));
        }
        hits.push(Hit { book: h.book, chapter: h.chapter, verse: h.verse, verse_end: h.verse_end.max(h.verse), why: h.why.iter().map(|w| w.to_string()).collect(), text });
    }

    // every verse with exactly these words in the translation being read, in Bible order
    let phrase = phrase_query(query);
    let mut exact = 0i64;
    if let Ok(mut s) = db.prepare(
        "SELECT b.name, v.chapter, v.verse, v.text FROM verses_fts f JOIN verses v ON v.id = f.rowid
         JOIN versions ver ON ver.id = v.version_id JOIN books b ON b.id = v.book_id
         WHERE verses_fts MATCH ?1 AND ver.code = ?2 AND (?3 IS NULL OR b.testament = ?3) AND (?4 IS NULL OR b.name = ?4)
         ORDER BY b.order_index, v.chapter, v.verse",
    ) {
        let rows = s.query_map(params![phrase, version, scope.testament, scope.book], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?))
        });
        if let Ok(rows) = rows {
            for (book, chapter, verse, text) in rows.filter_map(Result::ok) {
                exact += 1;
                if seen.insert((book.clone(), chapter, verse)) {
                    hits.push(Hit { book, chapter, verse, verse_end: verse, why: vec!["phrase".into()], text });
                }
            }
        }
    }
    hits.truncate(limit);
    Ok(SearchResult { hits, exact, topics: topics(study, query)?, articles: articles(study, query, 6)? })
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
