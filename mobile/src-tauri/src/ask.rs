//! Ask (since 2.9.3): an answer above the search results when what was typed is a question,
//! as the desktop app's "Ask a question" gives one. The same layers, in the same order:
//!
//! 1. **A count** -- "how many times is love mentioned in the New Testament" -- counted live
//!    in the BSB (`qa_parser`, the desktop's own question grammar).
//! 2. **A hand-checked answer** from the desktop's `qa.json` (and the Firsts / Prophecies of
//!    `firsts.json`): the question word for word, or, with the Advanced search upgrade, one
//!    close in meaning (the desktop's `qa_index.json`, packed by build.rs).
//! 3. **A Bible dictionary's entry** for a short who/what question ("who was Moses").
//!
//! Nothing is invented: a question with none of these gets no answer card, only the search
//! results. The data files are the desktop's, compiled into the app, so both apps answer alike.

use std::sync::OnceLock;

use bible_core::meaning::Meaning;
use regex::RegexBuilder;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::firsts::{FirstsData, FirstsEntry};
use crate::qa::{QaConfidence, QaData, QaEntry};
use crate::qa_parser::{self, ParsedScope};

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

static QA_JSON: &str = include_str!("../../../src-tauri/resources/qa.json");
static FIRSTS_JSON: &str = include_str!("../../../src-tauri/resources/firsts.json");
static QA_INDEX: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/qa_index.bin"));

/// Below this, a question close in meaning isn't the same question (the desktop's value).
const SIMILARITY: f32 = 0.6;
/// A dictionary entry for the exact subject of a who/what question beats a curated answer
/// that is only this close (the desktop's value).
const DICTIONARY_OVERRIDE: f32 = 0.8;
/// What was typed doesn't read as a question: only a very close curated question answers it.
const NOT_A_QUESTION: f32 = 0.82;

struct Loaded {
    qa: QaData,
    firsts: FirstsData,
    /// (from qa.json?, id, scale, numbers)
    index: Vec<(bool, String, f32, Vec<i8>)>,
}

fn loaded() -> &'static Loaded {
    static LOADED: OnceLock<Loaded> = OnceLock::new();
    LOADED.get_or_init(|| {
        let mut index = Vec::new();
        let b = QA_INDEX;
        let n = u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize;
        let mut i = 4;
        for _ in 0..n {
            let from_qa = b[i] == 0;
            let len = b[i + 1] as usize;
            let id = String::from_utf8_lossy(&b[i + 2..i + 2 + len]).to_string();
            i += 2 + len;
            let scale = f32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]);
            i += 4;
            let v: Vec<i8> = b[i..i + 384].iter().map(|&x| x as i8).collect();
            i += 384;
            index.push((from_qa, id, scale, v));
        }
        Loaded {
            qa: QaData::from_json(QA_JSON).unwrap_or_else(|_| QaData::from_json(r#"{"entries":[]}"#).unwrap()),
            firsts: FirstsData::from_json(FIRSTS_JSON).unwrap_or_else(|_| FirstsData::from_json(r#"{"entries":[]}"#).unwrap()),
            index,
        }
    })
}

#[derive(Serialize, Debug)]
pub struct Citation {
    pub reference: String,
    /// "stated", "supporting", "foretold", "fulfilled", ...
    pub role: String,
}

/// An answer to show above the search results.
#[derive(Serialize, Debug)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Answer {
    /// "love" appears `total` times in `verses` verses of the BSB (`scope`: "in the New Testament")
    Count { word: String, total: i64, verses: i64, scope: Option<String> },
    /// a hand-checked answer; `by_meaning`: the closest question on file, not the words typed
    Curated {
        question: String,
        /// stated | computed | traditional | commentary_opinion | doctrinal_view | unattested
        confidence: String,
        answer: String,
        citations: Vec<Citation>,
        note: Option<String>,
        by_meaning: bool,
    },
    /// a Bible dictionary's entry (`id`: to open it whole)
    Dictionary { id: i64, headword: String, source: String, preview: String },
}

fn confidence_name(c: &QaConfidence) -> &'static str {
    match c {
        QaConfidence::Stated => "stated",
        QaConfidence::Computed => "computed",
        QaConfidence::Traditional => "traditional",
        QaConfidence::CommentaryOpinion => "commentary_opinion",
        QaConfidence::DoctrinalView => "doctrinal_view",
        QaConfidence::Unattested => "unattested",
    }
}

/// Whether what was typed reads as a question.
fn looks_like_question(q: &str) -> bool {
    let first = q.split_whitespace().next().unwrap_or("").to_lowercase();
    q.trim_end().ends_with('?')
        || ["who", "what", "when", "where", "why", "how", "which", "is", "was", "were", "are", "did", "does", "do", "can", "could", "should", "will", "tell", "define"]
            .contains(&first.as_str())
}

/// The book a scope names ("Romans", "rom"), as the database names it.
fn book_name(db: &Connection, raw: &str) -> Option<String> {
    let needle = raw.trim().to_lowercase();
    let names: Vec<String> = db.prepare("SELECT name FROM books").ok()?.query_map([], |r| r.get(0)).ok()?.filter_map(Result::ok).collect();
    if let Some(n) = names.iter().find(|n| n.to_lowercase() == needle) {
        return Some(n.clone());
    }
    let starts: Vec<&String> = names.iter().filter(|n| n.to_lowercase().starts_with(&needle)).collect();
    (starts.len() == 1).then(|| starts[0].clone())
}

/// How many times a word is in the BSB (whole words, any case), and in how many verses.
fn count_word(db: &Connection, word: &str, testament: Option<&str>, book: Option<&str>) -> Result<(i64, i64), String> {
    let mut st = db
        .prepare(
            // (the index is asked once for all its verses; see search.rs)
            "SELECT v.text FROM verses v JOIN versions ver ON ver.id = v.version_id JOIN books b ON b.id = v.book_id
             WHERE v.id IN (SELECT rowid FROM verses_fts WHERE verses_fts MATCH ?1)
             AND ver.code = 'BSB' AND (?2 IS NULL OR b.testament = ?2) AND (?3 IS NULL OR b.name = ?3)",
        )
        .map_err(err)?;
    let re = RegexBuilder::new(&format!(r"\b{}\b", regex::escape(word))).case_insensitive(true).build().map_err(err)?;
    let (mut total, mut verses) = (0i64, 0i64);
    let rows = st.query_map(params![format!("\"{}\"", word.replace('"', "")), testament, book], |r| r.get::<_, String>(0)).map_err(err)?;
    for text in rows.filter_map(Result::ok) {
        let n = re.find_iter(&text).count() as i64;
        if n > 0 {
            total += n;
            verses += 1;
        }
    }
    Ok((total, verses))
}

/// A live number for a qa.json answer's {{n}} (the desktop's tags, the phone's own data).
fn computed(db: &Connection, firsts: &FirstsData, tag: &str) -> Option<i64> {
    let count = |sql: &str| db.query_row(sql, [], |r| r.get::<_, i64>(0)).ok();
    match tag {
        "books" => count("SELECT COUNT(*) FROM books WHERE testament IN ('OT','NT')"),
        "ot_books" => count("SELECT COUNT(*) FROM books WHERE testament = 'OT'"),
        "nt_books" => count("SELECT COUNT(*) FROM books WHERE testament = 'NT'"),
        "chapters" => count("SELECT COUNT(*) FROM (SELECT DISTINCT v.book_id, v.chapter FROM verses v JOIN versions ver ON ver.id = v.version_id WHERE ver.code = 'BSB')"),
        "verses" => count("SELECT COUNT(*) FROM verses v JOIN versions ver ON ver.id = v.version_id WHERE ver.code = 'KJV'"),
        "cross_references" => count("SELECT COUNT(*) FROM xrefs"),
        "translations" => count("SELECT COUNT(*) FROM versions"),
        "strongs_hebrew" => count("SELECT COUNT(*) FROM strongs_dict WHERE language = 'Hebrew'"),
        "strongs_greek" => count("SELECT COUNT(*) FROM strongs_dict WHERE language = 'Greek'"),
        "prophecy_count" => Some(firsts.all().iter().filter(|e| e.category == "prophecy").count() as i64),
        _ => None,
    }
}

fn curated(db: &Connection, firsts: &FirstsData, e: &QaEntry, by_meaning: bool) -> Option<Answer> {
    let answer = match &e.computed_from {
        Some(tag) => e.answer.replace("{{n}}", &computed(db, firsts, tag)?.to_string()),
        None => e.answer.clone(),
    };
    Some(Answer::Curated {
        question: e.question.clone(),
        confidence: confidence_name(&e.confidence).into(),
        answer,
        citations: e.citations.iter().map(|c| Citation { reference: c.reference.clone(), role: c.role.clone() }).collect(),
        note: e.note.clone(),
        by_meaning,
    })
}

/// A Firsts / Prophecies entry as an answer (a prophecy's answer is its two sides).
fn from_firsts(e: &FirstsEntry) -> Answer {
    if e.category == "prophecy" {
        let mut citations: Vec<Citation> = e.citations.iter().map(|c| Citation { reference: c.clone(), role: "foretold".into() }).collect();
        citations.extend(e.fulfillment.iter().map(|c| Citation { reference: c.clone(), role: "fulfilled".into() }));
        Answer::Curated {
            question: e.question.clone(),
            confidence: "stated".into(),
            answer: format!("Foretold in {}; fulfilled in {}.", e.citations.join("; "), e.fulfillment.join("; ")),
            citations,
            note: e.note.clone(),
            by_meaning: true,
        }
    } else {
        Answer::Curated {
            question: e.question.clone(),
            confidence: "stated".into(),
            answer: e.answer.clone(),
            citations: e.citations.iter().map(|c| Citation { reference: c.clone(), role: "supporting".into() }).collect(),
            note: e.note.clone(),
            by_meaning: true,
        }
    }
}

const DICT_GENERAL: &[&str] = &["easton", "smith", "nave", "torrey"];
const DICT_TOPICAL: &[&str] = &["nave", "torrey", "easton", "smith"];

/// The subject of a short who/what question, and which dictionaries to try first (the
/// desktop's patterns): "who was Aaron?" -> aaron; "what does the Bible say about prayer" ->
/// prayer, the topical Bibles first.
fn dictionary_term(query: &str) -> Option<(String, &'static [&'static str])> {
    static PATTERNS: OnceLock<Vec<(regex::Regex, &'static [&'static str])>> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        [
            (r"(?i)^what\s+does\s+(?:the\s+bible|scripture|god's\s+word)\s+(?:say|teach)\s+(?:about|on|regarding)\s+(.+)$", DICT_TOPICAL),
            (r"(?i)^what\s+does\s+(.+?)\s+mean$", DICT_GENERAL),
            (r"(?i)^(?:who|what|where)\s+(?:is|was|were|are)\s+(.+)$", DICT_GENERAL),
            (r"(?i)^(?:tell\s+me\s+about|define|definition\s+of|meaning\s+of|what\s+is\s+meant\s+by)\s+(.+)$", DICT_GENERAL),
        ]
        .into_iter()
        .map(|(p, pref)| (regex::Regex::new(p).unwrap(), pref))
        .collect()
    });
    let q = query.trim().trim_end_matches(['?', '.', '!']).trim();
    let (raw, prefer) = patterns.iter().find_map(|(re, pref)| re.captures(q).map(|c| (c[1].to_string(), *pref)))?;
    let mut t = raw.to_lowercase();
    for suffix in [" in the bible", " in scripture", " in the old testament", " in the new testament", " biblically"] {
        if let Some(s) = t.strip_suffix(suffix) {
            t = s.to_string();
        }
    }
    for prefix in ["the ", "a ", "an "] {
        if let Some(s) = t.strip_prefix(prefix) {
            t = s.to_string();
        }
    }
    let t = t.trim().to_string();
    (!t.is_empty() && t.split_whitespace().count() <= 4).then_some((t, prefer))
}

/// The dictionary entry for a who/what question's subject (Daniel, prayers -> prayer).
fn dictionary(study: &Connection, query: &str) -> Option<Answer> {
    let (term, prefer) = dictionary_term(query)?;
    let mut tries = vec![term.clone()];
    if let Some(s) = term.strip_suffix("es").filter(|s| s.len() > 2) {
        tries.push(s.to_string());
    }
    if let Some(s) = term.strip_suffix('s').filter(|s| s.len() > 2) {
        tries.push(s.to_string());
    }
    for t in tries {
        for code in prefer {
            let found = study
                .query_row(
                    "SELECT e.id, e.headword, d.name, e.body FROM dict_entries e JOIN dictionaries d ON d.code = e.dict_code
                     WHERE e.dict_code = ?1 AND e.headword_fold = ?2 AND e.body <> '' ORDER BY e.id LIMIT 1",
                    params![code, t],
                    |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)),
                )
                .optional()
                .ok()
                .flatten();
            if let Some((id, headword, source, body)) = found {
                let preview: String = body.split("\n\n").take(2).collect::<Vec<_>>().join("\n\n");
                let preview = if preview.chars().count() > 700 { format!("{}…", preview.chars().take(700).collect::<String>()) } else { preview };
                return Some(Answer::Dictionary { id, headword, source, preview });
            }
        }
    }
    None
}

/// The answer to what was typed, if it is a question the app can answer.
pub fn ask(db: &Connection, study: &Connection, query: &str, meaning: Option<&Meaning>) -> Result<Option<Answer>, String> {
    let query = query.trim();
    if query.chars().filter(|c| c.is_alphanumeric()).count() < 3 {
        return Ok(None);
    }
    let data = loaded();

    // 1. a count
    if let Some(parsed) = qa_parser::parse_frequency_question(query) {
        let (testament, book, scope) = match &parsed.scope {
            ParsedScope::WholeBible => (None, None, None),
            ParsedScope::Testament(t) => (Some(t.clone()), None, Some(if t == "OT" { "in the Old Testament".to_string() } else { "in the New Testament".to_string() })),
            ParsedScope::Book(raw) => match book_name(db, raw) {
                Some(b) => (None, Some(b.clone()), Some(format!("in {b}"))),
                None => return Ok(None),
            },
        };
        let (total, verses) = count_word(db, &parsed.word, testament.as_deref(), book.as_deref())?;
        return Ok(Some(Answer::Count { word: parsed.word, total, verses, scope }));
    }

    // 2. a hand-checked answer: the question word for word ...
    if let Some(e) = data.qa.find_exact(query) {
        return Ok(curated(db, &data.firsts, e, false));
    }
    let question = looks_like_question(query);
    // ... or, with the search upgrade, the closest question on file
    if let Some(m) = meaning {
        let v = m.embedder.embed(query)?;
        let best = data
            .index
            .iter()
            .map(|(from_qa, id, scale, q)| (from_qa, id, q.iter().zip(&v).map(|(&a, b)| a as f32 * b).sum::<f32>() * scale))
            .max_by(|a, b| a.2.total_cmp(&b.2));
        if let Some((&from_qa, id, similarity)) = best {
            let needed = if question { SIMILARITY } else { NOT_A_QUESTION };
            if similarity >= needed {
                let house_view = from_qa && data.qa.get(id).is_some_and(|e| e.confidence == QaConfidence::DoctrinalView);
                // a dictionary entry for the exact subject beats an answer only somewhat close
                if similarity < DICTIONARY_OVERRIDE && !house_view {
                    if let Some(d) = dictionary(study, query) {
                        return Ok(Some(d));
                    }
                }
                if from_qa {
                    if let Some(e) = data.qa.get(id) {
                        return Ok(curated(db, &data.firsts, e, true));
                    }
                } else if let Some(e) = data.firsts.all().iter().find(|e| &e.id == id) {
                    return Ok(Some(from_firsts(e)));
                }
            }
        }
    }

    // 3. a dictionary's entry for a who/what question
    Ok(dictionary(study, query))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_desktop_data_is_carried() {
        let d = loaded();
        assert!(d.qa.all().len() > 100, "qa.json");
        assert!(d.firsts.all().len() > 50, "firsts.json");
        assert!(d.index.len() > 400, "qa_index");
        let norm: f32 = d.index[0].3.iter().map(|&x| (x as f32 * d.index[0].2).powi(2)).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 0.02, "the packed vectors keep their length ({norm})");
    }

    #[test]
    fn questions_and_searches() {
        assert!(looks_like_question("how many days was Jesus on earth after His resurrection"));
        assert!(looks_like_question("Jesus after the resurrection?"));
        assert!(!looks_like_question("Daniels prayer delayed"));
        assert_eq!(dictionary_term("Who was Moses?").map(|t| t.0).as_deref(), Some("moses"));
        assert_eq!(dictionary_term("what does the bible say about prayer").map(|t| t.0).as_deref(), Some("prayer"));
    }

    /// Real questions against the phone's database and the search upgrade:
    /// PHONE_DB=<phone.db> SEARCH_PACK=<folder> cargo test --release --lib ask_examples -- --ignored --nocapture
    #[test]
    #[ignore]
    fn ask_examples() {
        let db = Connection::open(std::env::var("PHONE_DB").unwrap()).unwrap();
        let m = Meaning::load(std::path::Path::new(&std::env::var("SEARCH_PACK").unwrap())).unwrap();
        for q in [
            "how many times is love mentioned in the New Testament",
            "How many days was He still on earth after His resurrection?",
            "how long did jesus stay on earth before he went up to heaven",
            "How old was Joseph the father of Jesus when he died?",
            "How many prophecies were fulfilled with the birth, life, and resurrection of Christ?",
            "How many books are in the Bible?",
            "who was moses?",
            "what does the bible say about prayer",
            "Daniels prayer delayed",
            "the trinity",
            "is the trinity in the bible?",
            "end of days",
        ] {
            let t = std::time::Instant::now();
            let with = ask(&db, &db, q, Some(&m)).unwrap();
            let without = ask(&db, &db, q, None).unwrap();
            let show = |a: &Option<Answer>| match a {
                None => "-".to_string(),
                Some(Answer::Count { total, verses, scope, .. }) => format!("count {total} in {verses} verses {scope:?}"),
                Some(Answer::Curated { question, answer, by_meaning, .. }) => format!("curated{} [{question}] {}", if *by_meaning { " (meaning)" } else { "" }, answer.chars().take(90).collect::<String>()),
                Some(Answer::Dictionary { headword, source, .. }) => format!("dictionary {headword} ({source})"),
            };
            println!("{q} ({:?})
   with upgrade: {}
   without:      {}", t.elapsed(), show(&with), show(&without));
        }
    }
}
