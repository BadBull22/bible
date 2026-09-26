//! Read access to `resources/study.db` (built by data-pipeline/build_study.py): the
//! original-language interlinear with grammar (STEPBible TAHOT/TAGNT, CC BY), the
//! morphology-code expansions (STEPBible TEHMC/TEGMC, CC BY), and four public-domain
//! Bible dictionaries (Easton's, Smith's, Nave's Topical, Torrey's Topical) with a
//! verse -> entry index.
//!
//! Optional like commentaries.db: if the file is missing the app still runs, and these
//! commands report that the study data isn't bundled.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

pub struct StudyState(pub Option<Mutex<Connection>>);

pub fn open(path: &Path) -> Option<Mutex<Connection>> {
    if !path.exists() {
        eprintln!("study.db not found at {} -- interlinear/dictionary features disabled", path.display());
        return None;
    }
    match Connection::open(path) {
        Ok(conn) => {
            conn.pragma_update(None, "query_only", true).ok();
            Some(Mutex::new(conn))
        }
        Err(e) => {
            eprintln!("failed to open study.db: {e}");
            None
        }
    }
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// Greek editions in the order of the `editions` bitmask written by build_study.py.
pub const EDITIONS: [&str; 8] = ["NA28", "NA27", "Tyn", "SBL", "WH", "Treg", "TR", "Byz"];

#[derive(Serialize, Clone)]
pub struct MorphPart {
    pub code: String,
    /// Short plain-English reading, e.g. "Verb Aorist Active Indicative 3rd Singular".
    pub summary: String,
    /// Formal breakdown, e.g. "Function=Verb; Tense=Aorist; ...".
    pub detail: String,
}

#[derive(Serialize, Clone)]
pub struct InterlinearWord {
    pub word_pos: i64,
    /// STEPBible word type: "L" = Leningrad Codex (Hebrew); "K"/"Q" = ketiv/qere
    /// variants; NT types like "NKO" say which traditions contain the word.
    pub word_type: String,
    pub original: String,
    pub translit: String,
    pub gloss: String,
    /// Normalized to this app's Strong's format ("G25", "H430"), so it links straight into
    /// the Word Study panel. Empty for STEPBible-only particle codes.
    pub strongs: String,
    pub lemma: String,
    pub lemma_gloss: String,
    pub morph: String,
    pub morph_parts: Vec<MorphPart>,
    /// Greek editions containing this word (empty for Hebrew).
    pub editions: Vec<String>,
}

fn expand_morph(conn: &Connection, cache: &mut HashMap<(String, &'static str), Option<(String, String)>>, morph: &str, greek: bool) -> Vec<MorphPart> {
    let mut lookup = |code: &str, lang: &'static str| -> Option<(String, String)> {
        cache
            .entry((code.to_string(), lang))
            .or_insert_with(|| {
                conn.query_row("SELECT short, formal FROM morph_codes WHERE code = ?1 AND lang = ?2", params![code, lang], |r| {
                    Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                })
                .optional()
                .ok()
                .flatten()
            })
            .clone()
    };
    let mut out = Vec::new();
    if greek {
        // Crasis words carry two analyses: "P-1NS + G2532=CONJ" (κἀγώ = "and I").
        for (i, part) in morph.split(" + ").enumerate() {
            let code = if i == 0 { part.trim() } else { part.rsplit('=').next().unwrap_or(part).trim() };
            if code.is_empty() {
                continue;
            }
            let (summary, detail) = lookup(code, "gr").unwrap_or_default();
            out.push(MorphPart { code: code.to_string(), summary, detail });
        }
    } else {
        // Hebrew/Aramaic: prefix/word/suffix morphemes joined by '/' ("HR/Ncfsa"); the
        // language letter (H or A) is only written on the first segment.
        let segs: Vec<&str> = morph.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
        let lang_letter = segs.first().and_then(|s| s.chars().next()).filter(|c| *c == 'H' || *c == 'A');
        for (i, seg) in segs.iter().enumerate() {
            let mut candidates = vec![seg.to_string()];
            if i > 0 {
                if let Some(l) = lang_letter {
                    candidates.push(format!("{l}{seg}"));
                }
            }
            if seg.len() > 1 {
                candidates.push(seg[1..].to_string());
            }
            let found = candidates.iter().find_map(|c| lookup(c, "he").map(|v| (c.clone(), v)));
            let (code, (summary, detail)) = found.unwrap_or((seg.to_string(), (String::new(), String::new())));
            out.push(MorphPart { code, summary, detail });
        }
    }
    for p in &mut out {
        if p.summary.is_empty() {
            p.summary = p.detail.clone();
        }
    }
    out
}

pub fn interlinear_verse(conn: &Connection, book: &str, chapter: i64, verse: i64) -> Result<Vec<InterlinearWord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT i.word_pos, i.word_type, i.original, i.translit, i.gloss, i.strongs, i.morph, i.editions,
                    COALESCE(l.lemma, ''), COALESCE(l.gloss, '')
             FROM interlinear i LEFT JOIN lemmas l ON l.key = i.lemma_key
             WHERE i.book = ?1 AND i.chapter = ?2 AND i.verse = ?3
             ORDER BY i.word_pos, i.id",
        )
        .map_err(err)?;
    let rows: Vec<(i64, String, String, String, String, String, String, i64, String, String)> = stmt
        .query_map(params![book, chapter, verse], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?))
        })
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    let mut cache = HashMap::new();
    Ok(rows
        .into_iter()
        .map(|(word_pos, word_type, original, translit, gloss, strongs, morph, mask, lemma, lemma_gloss)| {
            let greek = strongs.starts_with('G') || mask != 0;
            let morph_parts = expand_morph(conn, &mut cache, &morph, greek);
            let editions = EDITIONS.iter().enumerate().filter(|(i, _)| mask & (1 << i) != 0).map(|(_, e)| e.to_string()).collect();
            InterlinearWord { word_pos, word_type, original, translit, gloss, strongs, lemma, lemma_gloss, morph, morph_parts, editions }
        })
        .collect())
}

// ---------------------------------------------------------------- dictionaries

#[derive(Serialize, Clone)]
pub struct DictionaryInfo {
    pub code: String,
    pub name: String,
    /// "dictionary" (Easton's, Smith's) or "topical" (Nave's, Torrey's).
    pub kind: String,
    pub entry_count: i64,
}

#[derive(Serialize, Clone)]
pub struct DictionaryHit {
    pub id: i64,
    pub dict_code: String,
    pub dict_name: String,
    pub headword: String,
    pub snippet: String,
}

#[derive(Serialize, Clone)]
pub struct DictionaryEntry {
    pub id: i64,
    pub dict_code: String,
    pub dict_name: String,
    pub kind: String,
    pub headword: String,
    /// Plain text; scripture references are embedded as
    /// `⟦Book|chapter|verse|verse_end|label⟧` markers for the UI to render as links.
    pub body: String,
}

pub fn list_dictionaries(conn: &Connection) -> Result<Vec<DictionaryInfo>, String> {
    let mut stmt = conn.prepare("SELECT code, name, kind, entry_count FROM dictionaries ORDER BY rowid").map_err(err)?;
    let rows = stmt
        .query_map([], |r| Ok(DictionaryInfo { code: r.get(0)?, name: r.get(1)?, kind: r.get(2)?, entry_count: r.get(3)? }))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    Ok(rows)
}

/// Plain-text preview: markers collapsed to their labels, trimmed to ~`max` characters.
pub fn plain_snippet(body: &str, max: usize) -> String {
    let mut out = String::new();
    let mut rest = body;
    while let Some(start) = rest.find('\u{27e6}') {
        out.push_str(&rest[..start]);
        let after = &rest[start + '\u{27e6}'.len_utf8()..];
        match after.find('\u{27e7}') {
            Some(end) => {
                let inner = &after[..end];
                out.push_str(inner.rsplit('|').next().unwrap_or(""));
                rest = &after[end + '\u{27e7}'.len_utf8()..];
            }
            None => {
                rest = after;
            }
        }
    }
    out.push_str(rest);
    let flat: String = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        flat
    } else {
        let cut: String = flat.chars().take(max).collect();
        format!("{}…", cut.trim_end())
    }
}

fn fts_expr(query: &str) -> Option<String> {
    let words: Vec<String> = query
        .to_lowercase()
        .split(|c: char| !(c.is_alphanumeric() || c == '\''))
        .filter(|w| w.len() > 1)
        .map(|w| format!("\"{}\"", w.replace('"', "")))
        .collect();
    if words.is_empty() {
        None
    } else {
        Some(words.join(" AND "))
    }
}

/// Headword matches first (exact, then prefix), then full-text matches in entry bodies.
pub fn search_dictionaries(conn: &Connection, query: &str, dict_code: Option<&str>, limit: i64) -> Result<Vec<DictionaryHit>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let mut hits: Vec<DictionaryHit> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut stmt = conn
        .prepare(
            "SELECT e.id, e.dict_code, d.name, e.headword, e.body FROM dict_entries e JOIN dictionaries d ON d.code = e.dict_code
             WHERE (e.headword_fold = ?1 OR e.headword_fold LIKE ?2 ESCAPE '\\') AND (?3 IS NULL OR e.dict_code = ?3)
             ORDER BY (e.headword_fold = ?1) DESC, length(e.headword_fold), d.rowid LIMIT ?4",
        )
        .map_err(err)?;
    let like = format!("{}%", q.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
    let rows = stmt
        .query_map(params![q, like, dict_code, limit], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?))
        })
        .map_err(err)?;
    for row in rows {
        let (id, dict_code, dict_name, headword, body) = row.map_err(err)?;
        seen.insert(id);
        hits.push(DictionaryHit { id, dict_code, dict_name, headword, snippet: plain_snippet(&body, 160) });
    }
    if (hits.len() as i64) < limit {
        if let Some(expr) = fts_expr(&q) {
            let mut stmt = conn
                .prepare(
                    "SELECT e.id, e.dict_code, d.name, e.headword, e.body FROM dict_fts f
                     JOIN dict_entries e ON e.id = f.rowid JOIN dictionaries d ON d.code = e.dict_code
                     WHERE dict_fts MATCH ?1 AND (?2 IS NULL OR e.dict_code = ?2) ORDER BY f.rank LIMIT ?3",
                )
                .map_err(err)?;
            let rows = stmt
                .query_map(params![expr, dict_code, limit], |r| {
                    Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?))
                })
                .map_err(err)?;
            for row in rows {
                let (id, dict_code, dict_name, headword, body) = row.map_err(err)?;
                if hits.len() as i64 >= limit {
                    break;
                }
                if seen.insert(id) {
                    hits.push(DictionaryHit { id, dict_code, dict_name, headword, snippet: plain_snippet(&body, 160) });
                }
            }
        }
    }
    Ok(hits)
}

pub fn dictionary_entry(conn: &Connection, id: i64) -> Result<Option<DictionaryEntry>, String> {
    conn.query_row(
        "SELECT e.id, e.dict_code, d.name, d.kind, e.headword, e.body FROM dict_entries e JOIN dictionaries d ON d.code = e.dict_code WHERE e.id = ?1",
        params![id],
        |r| Ok(DictionaryEntry { id: r.get(0)?, dict_code: r.get(1)?, dict_name: r.get(2)?, kind: r.get(3)?, headword: r.get(4)?, body: r.get(5)? }),
    )
    .optional()
    .map_err(err)
}

/// Dictionary/topical entries that cite this verse (or its whole chapter, or a range
/// that includes it) -- e.g. every Nave's and Torrey's topic John 3:16 appears under.
pub fn topics_for_verse(conn: &Connection, book: &str, chapter: i64, verse: i64) -> Result<Vec<DictionaryHit>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT e.id, e.dict_code, d.name, e.headword, e.body FROM dict_refs r
             JOIN dict_entries e ON e.id = r.entry_id JOIN dictionaries d ON d.code = e.dict_code
             WHERE r.book = ?1 AND r.chapter = ?2
               AND (r.verse IS NULL OR r.verse = ?3 OR (r.verse_end IS NOT NULL AND ?3 BETWEEN r.verse AND r.verse_end))
             ORDER BY d.rowid, e.headword",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map(params![book, chapter, verse], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?))
        })
        .map_err(err)?;
    let mut out = Vec::new();
    for row in rows {
        let (id, dict_code, dict_name, headword, body) = row.map_err(err)?;
        out.push(DictionaryHit { id, dict_code, dict_name, headword, snippet: plain_snippet(&body, 140) });
    }
    Ok(out)
}

/// Exact headword lookup used by "Ask a question" for who/what questions: the first
/// dictionary (in the given preference order) with an entry whose headword matches.
pub fn lookup_headword(conn: &Connection, term: &str, prefer: &[&str]) -> Result<Option<DictionaryEntry>, String> {
    let t = term.trim().to_lowercase();
    if t.is_empty() {
        return Ok(None);
    }
    for code in prefer {
        let id: Option<i64> = conn
            .query_row("SELECT id FROM dict_entries WHERE dict_code = ?1 AND headword_fold = ?2 ORDER BY id LIMIT 1", params![code, t], |r| r.get(0))
            .optional()
            .map_err(err)?;
        if let Some(id) = id {
            return dictionary_entry(conn, id);
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn conn() -> Connection {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/study.db");
        Connection::open(p).expect("resources/study.db -- run data-pipeline/build_study.py")
    }

    #[test]
    fn john_3_16_interlinear_has_grammar_and_editions() {
        let c = conn();
        let words = interlinear_verse(&c, "John", 3, 16).unwrap();
        assert!(words.len() >= 25, "got {} words", words.len());
        let loved = words.iter().find(|w| w.strongs == "G25").expect("ἠγάπησεν");
        assert_eq!(loved.morph, "V-AAI-3S");
        assert!(loved.morph_parts[0].summary.contains("Aorist"), "{:?}", loved.morph_parts[0].summary);
        assert_eq!(loved.lemma, "ἀγαπάω");
        // "his" (αὐτοῦ) is in the TR and Byzantine texts but not the critical editions
        let his = words.iter().find(|w| w.word_pos == 11).unwrap();
        assert!(his.editions.contains(&"TR".to_string()) && !his.editions.contains(&"Tyn".to_string()));
    }

    #[test]
    fn hebrew_morphemes_expand_segment_by_segment() {
        let c = conn();
        let words = interlinear_verse(&c, "Genesis", 1, 1).unwrap();
        let first = &words[0];
        assert_eq!(first.morph, "HR/Ncfsa");
        assert_eq!(first.morph_parts.len(), 2);
        assert!(first.morph_parts.iter().all(|p| !p.summary.is_empty()), "{:?}", first.morph_parts.iter().map(|p| &p.code).collect::<Vec<_>>());
        assert_eq!(first.strongs, "H7225");
    }

    #[test]
    fn crasis_greek_word_gets_both_analyses() {
        let c = conn();
        let code: String = c
            .query_row("SELECT morph FROM interlinear WHERE morph LIKE '% + %' LIMIT 1", [], |r| r.get(0))
            .unwrap();
        let mut cache = HashMap::new();
        let parts = expand_morph(&c, &mut cache, &code, true);
        assert_eq!(parts.len(), 2, "{code}");
        assert!(parts.iter().all(|p| !p.summary.is_empty()), "{code}: {:?}", parts.iter().map(|p| &p.code).collect::<Vec<_>>());
    }

    #[test]
    fn dictionary_search_and_topics() {
        let c = conn();
        let dicts = list_dictionaries(&c).unwrap();
        assert_eq!(dicts.len(), 4);
        let hits = search_dictionaries(&c, "aaron", None, 20).unwrap();
        assert!(hits.iter().any(|h| h.dict_code == "easton" && h.headword.eq_ignore_ascii_case("aaron")));
        let body_hits = search_dictionaries(&c, "burning bush", None, 20).unwrap();
        assert!(!body_hits.is_empty());
        let topics = topics_for_verse(&c, "John", 3, 16).unwrap();
        assert!(topics.iter().any(|t| t.dict_code == "nave"));
        assert!(topics.iter().any(|t| t.dict_code == "torrey"));
        let e = lookup_headword(&c, "grace", &["easton", "smith"]).unwrap().expect("Easton's has Grace");
        assert!(e.body.contains('\u{27e6}'), "grace entry should carry reference markers");
    }

    #[test]
    fn snippet_collapses_markers() {
        let s = plain_snippet("See \u{27e6}John|3|16||John 3:16\u{27e7} and more.", 100);
        assert_eq!(s, "See John 3:16 and more.");
    }
}
