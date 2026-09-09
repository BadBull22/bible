//! Offline commentaries and the Theographic people/places/events dataset, bundled as
//! `resources/commentaries.db` (built by `data-pipeline/build_commentaries.py` from the
//! Free Use Bible API). All text is public domain or CC-licensed; section text is stored
//! zlib-compressed and inflated on read.

use flate2::read::ZlibDecoder;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::io::Read;
use std::path::Path;
use std::sync::Mutex;

pub struct CommentaryState(pub Option<Mutex<Connection>>);

#[derive(Serialize, Clone)]
pub struct CommentaryInfo {
    pub id: String,
    pub name: String,
    pub website: Option<String>,
    pub license_name: Option<String>,
    pub license_url: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct CommentarySection {
    pub id: i64,
    pub verse_start: i64,
    pub text: String,
}

#[derive(Serialize, Clone)]
pub struct CommentaryChapter {
    pub commentary_id: String,
    pub book: String,
    pub chapter: i64,
    pub book_introduction: Option<String>,
    pub chapter_introduction: Option<String>,
    pub sections: Vec<CommentarySection>,
}

#[derive(Serialize, Clone)]
pub struct CommentaryHit {
    pub commentary_id: String,
    pub commentary_name: String,
    pub book: String,
    pub chapter: i64,
    pub verse_start: i64,
    pub snippet: String,
}

#[derive(Serialize, Clone)]
pub struct EntityRef {
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub end_verse: Option<i64>,
}

#[derive(Serialize, Clone)]
pub struct EntitySummary {
    pub kind: String,
    pub id: String,
    pub name: String,
    pub feature_type: Option<String>,
    pub start_date: Option<String>,
    pub reference_count: i64,
    /// verses of the requested chapter this entity is referenced in
    pub verses: Vec<i64>,
}

#[derive(Serialize, Clone)]
pub struct ChapterEntities {
    pub people: Vec<EntitySummary>,
    pub places: Vec<EntitySummary>,
    pub events: Vec<EntitySummary>,
}

#[derive(Serialize, Clone)]
pub struct EntityDetail {
    pub kind: String,
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub gender: Option<String>,
    pub birth_year: Option<i64>,
    pub death_year: Option<i64>,
    pub feature_type: Option<String>,
    pub latitude: Option<f64>,
    pub longitude: Option<f64>,
    pub start_date: Option<String>,
    /// JSON object of relation lists (father, mother, children, locations, ...), as stored
    pub relations_json: Option<String>,
    pub references: Vec<EntityRef>,
}

pub fn open(path: &Path) -> Option<Mutex<Connection>> {
    if !path.exists() {
        eprintln!("commentaries.db not found at {} -- commentary features disabled", path.display());
        return None;
    }
    match Connection::open(path) {
        Ok(conn) => {
            conn.pragma_update(None, "query_only", true).ok();
            Some(Mutex::new(conn))
        }
        Err(e) => {
            eprintln!("failed to open commentaries.db: {e}");
            None
        }
    }
}

fn inflate(blob: Option<Vec<u8>>) -> Result<Option<String>, String> {
    match blob {
        None => Ok(None),
        Some(bytes) => {
            let mut out = String::new();
            ZlibDecoder::new(bytes.as_slice()).read_to_string(&mut out).map_err(|e| e.to_string())?;
            Ok(Some(out))
        }
    }
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

pub fn list(conn: &Connection) -> Result<Vec<CommentaryInfo>, String> {
    let mut stmt = conn
        .prepare("SELECT id, name, website, license_name, license_url FROM commentaries ORDER BY sort_order")
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(CommentaryInfo { id: r.get(0)?, name: r.get(1)?, website: r.get(2)?, license_name: r.get(3)?, license_url: r.get(4)? })
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

pub fn chapter(conn: &Connection, commentary_id: &str, book: &str, chapter: i64) -> Result<CommentaryChapter, String> {
    let book_intro: Option<Vec<u8>> = conn
        .query_row(
            "SELECT introduction_gz FROM commentary_books WHERE commentary_id = ?1 AND book = ?2",
            params![commentary_id, book],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .flatten();
    let chapter_intro: Option<Vec<u8>> = conn
        .query_row(
            "SELECT introduction_gz FROM commentary_chapters WHERE commentary_id = ?1 AND book = ?2 AND chapter = ?3",
            params![commentary_id, book, chapter],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?
        .flatten();
    let mut stmt = conn
        .prepare(
            "SELECT id, verse_start, text_gz FROM commentary_sections
             WHERE commentary_id = ?1 AND book = ?2 AND chapter = ?3 ORDER BY verse_start, id",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![commentary_id, book, chapter], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, Vec<u8>>(2)?)))
        .map_err(err)?;
    let mut sections = Vec::new();
    for row in rows {
        let (id, verse_start, blob) = row.map_err(err)?;
        sections.push(CommentarySection { id, verse_start, text: inflate(Some(blob))?.unwrap_or_default() });
    }
    Ok(CommentaryChapter {
        commentary_id: commentary_id.to_string(),
        book: book.to_string(),
        chapter,
        book_introduction: inflate(book_intro)?,
        chapter_introduction: inflate(chapter_intro)?,
        sections,
    })
}

/// Full-text search over every bundled commentary (or one, if `commentary_id` is given).
/// The FTS table is contentless, so each hit's section is inflated to build a snippet.
pub fn search(conn: &Connection, query: &str, commentary_id: Option<&str>, limit: i64) -> Result<Vec<CommentaryHit>, String> {
    let fts_query = format!("\"{}\"", query.replace('"', "\"\""));
    let mut stmt = conn
        .prepare(
            "SELECT s.commentary_id, c.name, s.book, s.chapter, s.verse_start, s.text_gz
             FROM commentary_fts f
             JOIN commentary_sections s ON s.id = f.rowid
             JOIN commentaries c ON c.id = s.commentary_id
             WHERE commentary_fts MATCH ?1 AND (?2 IS NULL OR s.commentary_id = ?2)
             ORDER BY f.rank
             LIMIT ?3",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![fts_query, commentary_id, limit], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, Vec<u8>>(5)?,
            ))
        })
        .map_err(err)?;
    let needle = query.to_lowercase();
    let mut hits = Vec::new();
    for row in rows {
        let (cid, cname, book, chapter, verse_start, blob) = row.map_err(err)?;
        let text = inflate(Some(blob))?.unwrap_or_default();
        hits.push(CommentaryHit { commentary_id: cid, commentary_name: cname, book, chapter, verse_start, snippet: snippet_around(&text, &needle) });
    }
    Ok(hits)
}

/// ~240 characters of context around the first (case-insensitive) occurrence of `needle`,
/// trimmed to char boundaries and word edges.
fn snippet_around(text: &str, needle: &str) -> String {
    let lower = text.to_lowercase();
    let pos = lower.find(needle).unwrap_or(0);
    let start = text[..pos].char_indices().rev().nth(120).map(|(i, _)| i).unwrap_or(0);
    let end = text[pos..].char_indices().nth(needle.len() + 120).map(|(i, _)| pos + i).unwrap_or(text.len());
    let mut s = text[start..end].trim().to_string();
    if start > 0 {
        if let Some(sp) = s.find(' ') {
            s = s[sp + 1..].to_string();
        }
        s.insert(0, '…');
    }
    if end < text.len() {
        if let Some(sp) = s.rfind(' ') {
            s.truncate(sp);
        }
        s.push('…');
    }
    s
}

pub fn chapter_entities(conn: &Connection, book: &str, chapter: i64) -> Result<ChapterEntities, String> {
    let mut stmt = conn
        .prepare(
            "SELECT e.kind, e.id, e.name, e.feature_type, e.start_date, e.reference_count, r.verse
             FROM entity_refs r JOIN entities e ON e.kind = r.kind AND e.id = r.entity_id
             WHERE r.book = ?1 AND r.chapter = ?2
             ORDER BY e.kind, e.reference_count DESC, e.name, r.verse",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![book, chapter], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, i64>(6)?,
            ))
        })
        .map_err(err)?;
    let mut out = ChapterEntities { people: vec![], places: vec![], events: vec![] };
    for row in rows {
        let (kind, id, name, feature_type, start_date, reference_count, verse) = row.map_err(err)?;
        let list = match kind.as_str() {
            "person" => &mut out.people,
            "place" => &mut out.places,
            _ => &mut out.events,
        };
        match list.iter_mut().find(|e| e.id == id) {
            Some(existing) => {
                if !existing.verses.contains(&verse) {
                    existing.verses.push(verse);
                }
            }
            None => list.push(EntitySummary { kind, id, name, feature_type, start_date, reference_count, verses: vec![verse] }),
        }
    }
    Ok(out)
}

pub fn entity(conn: &Connection, kind: &str, id: &str) -> Result<Option<EntityDetail>, String> {
    let detail = conn
        .query_row(
            "SELECT name, description, gender, birth_year, death_year, feature_type, latitude, longitude, start_date, relations_json
             FROM entities WHERE kind = ?1 AND id = ?2",
            params![kind, id],
            |r| {
                Ok(EntityDetail {
                    kind: kind.to_string(),
                    id: id.to_string(),
                    name: r.get(0)?,
                    description: r.get(1)?,
                    gender: r.get(2)?,
                    birth_year: r.get(3)?,
                    death_year: r.get(4)?,
                    feature_type: r.get(5)?,
                    latitude: r.get(6)?,
                    longitude: r.get(7)?,
                    start_date: r.get(8)?,
                    relations_json: r.get(9)?,
                    references: vec![],
                })
            },
        )
        .optional()
        .map_err(err)?;
    let Some(mut detail) = detail else { return Ok(None) };
    let mut stmt = conn
        .prepare("SELECT book, chapter, verse, end_verse FROM entity_refs WHERE kind = ?1 AND entity_id = ?2 ORDER BY book_order, chapter, verse")
        .map_err(err)?;
    let rows = stmt
        .query_map(params![kind, id], |r| Ok(EntityRef { book: r.get(0)?, chapter: r.get(1)?, verse: r.get(2)?, end_verse: r.get(3)? }))
        .map_err(err)?;
    detail.references = rows.collect::<Result<Vec<_>, _>>().map_err(err)?;
    Ok(Some(detail))
}

pub fn search_entities(conn: &Connection, query: &str, limit: i64) -> Result<Vec<EntitySummary>, String> {
    let pattern = format!("%{}%", query.trim());
    let mut stmt = conn
        .prepare(
            "SELECT kind, id, name, feature_type, start_date, reference_count FROM entities
             WHERE name LIKE ?1 COLLATE NOCASE
             ORDER BY (name LIKE ?2 COLLATE NOCASE) DESC, reference_count DESC LIMIT ?3",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![pattern, format!("{}%", query.trim()), limit], |r| {
            Ok(EntitySummary {
                kind: r.get(0)?,
                id: r.get(1)?,
                name: r.get(2)?,
                feature_type: r.get(3)?,
                start_date: r.get(4)?,
                reference_count: r.get(5)?,
                verses: vec![],
            })
        })
        .map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}
