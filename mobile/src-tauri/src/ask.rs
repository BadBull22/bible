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

use std::collections::HashSet;
use std::sync::OnceLock;

use bible_core::meaning::Meaning;
use regex::RegexBuilder;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::answer_gate;
use crate::firsts::{FirstsData, FirstsEntry};
use crate::qa::{QaConfidence, QaData, QaEntry};
use crate::qa_parser::{self, ParsedScope};
use crate::spell;

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
    /// the closest question on file, which did NOT pass the gate (not the same kind of question, or the words that carry the
    /// question are not in it): shown under its own label, "it may not answer your exact question", as on the desktop
    Related { question: String, confidence: String, answer: String, citations: Vec<Citation>, note: Option<String> },
}

/// What the Ask command returns: the answer (if any) and, when the question had a spelling slip that was put right,
/// the question as it was read ("Showing the answer for ...").
#[derive(Serialize, Debug)]
pub struct AskReply {
    pub answer: Option<Answer>,
    pub corrected: Option<String>,
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
    // each PUBLISHED viewpoint follows the answer under its own label, as on the desktop (build_curated_entry);
    // a viewpoint the owner has not published stays hidden. (Until 3.0.0 the phone dropped them all.)
    let answer = e.views.iter().filter(|v| v.publish).fold(answer, |a, v| format!("{a}\n\n{}: {}", v.label, v.text));
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
                // an entry that only says "See COWARDICE" is not an answer: it has no passage and almost no words (the desktop's rule)
                if body.chars().count() < 160 && !body.contains('⟦') {
                    continue;
                }
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
    // ... or a question about a person's family ("who were John the Baptist's parents?"), from the people tables in the database, with the
    // name spelled either way (Elizabeth / Elisabeth). Needs no search upgrade; when the person or the tie is not in the data it says nothing
    // and the layers below go on.
    if let Some(e) = crate::people_qa::answer(study, query)? {
        return Ok(Some(Answer::Curated {
            question: e.question,
            confidence: confidence_name(&e.confidence).into(),
            answer: e.answer,
            citations: e.citations.into_iter().map(|c| Citation { reference: c.reference, role: c.role }).collect(),
            note: e.note,
            by_meaning: false,
        }));
    }
    let question = looks_like_question(query);
    // ... or, with the search upgrade, the closest questions on file (the desktop's layers: the four closest answers, each tried
    // against the gate; the closest that fails the gate is kept as the "related" answer)
    let mut related: Option<Answer> = None;
    if let Some(m) = meaning {
        let candidates = nearest(data, &m.embedder.embed(query)?, 4);
        let needed = if question { SIMILARITY } else { NOT_A_QUESTION };
        // the people and places the app knows (the word list is made once, from the Bible text and the names in the database)
        spell::vocab(db, Some(study), curated_text());
        let is_name = |w: &str| spell::is_name(w);
        for (rank, (from_qa, id, similarity)) in candidates.into_iter().enumerate() {
            if similarity < needed {
                break; // sorted: the rest are further away
            }
            let house_view = from_qa && data.qa.get(id).is_some_and(|e| e.confidence == QaConfidence::DoctrinalView);
            // a dictionary entry for the exact subject beats an answer only somewhat close
            if rank == 0 && similarity < DICTIONARY_OVERRIDE && !house_view {
                if let Some(d) = dictionary(study, query) {
                    return Ok(Some(d));
                }
            }
            if from_qa {
                if let Some(e) = data.qa.get(id) {
                    let mut phrasings: Vec<&str> = vec![e.question.as_str()];
                    phrasings.extend(e.alt_phrasings.iter().map(String::as_str));
                    if answer_gate::agrees(query, &phrasings, similarity, &is_name) {
                        return Ok(curated(db, &data.firsts, e, true));
                    }
                    if related.is_none() {
                        related = curated(db, &data.firsts, e, true).map(into_related);
                    }
                }
            } else if let Some(e) = data.firsts.all().iter().find(|e| &e.id == id) {
                if answer_gate::agrees(query, &[e.question.as_str()], similarity, &is_name) {
                    return Ok(Some(from_firsts(e)));
                }
                if related.is_none() {
                    related = Some(into_related(from_firsts(e)));
                }
            }
        }
    }

    // 3. a dictionary's entry for a who/what question; failing that, the related answer (labelled, never THE answer)
    if let Some(d) = dictionary(study, query) {
        return Ok(Some(d));
    }
    Ok(related)
}

/// The packed model's meanings are not exactly the desktop's (8-bit numbers): the same question comes out up to about 0.003 nearer or
/// further from a stored one. The desktop's cut-offs (0.6, 0.8, 0.93) are knife-edges for a question that sits on one, and a confident
/// wrong answer costs more than an honest "related", so the phone measures every question 0.004 further from the stored ones than it is.
const PACKED_MARGIN: f32 = 0.004;

/// The `n` stored answers closest in meaning to `v` (a question's meaning), each answer once with its best wording, best first:
/// (from qa.json?, id, how close, less PACKED_MARGIN).
fn nearest<'a>(data: &'a Loaded, v: &[f32], n: usize) -> Vec<(bool, &'a String, f32)> {
    let mut scored: Vec<(bool, &String, f32)> = data
        .index
        .iter()
        .map(|(from_qa, id, scale, q)| (*from_qa, id, q.iter().zip(v).map(|(&a, b)| a as f32 * b).sum::<f32>() * scale - PACKED_MARGIN))
        .collect();
    scored.sort_by(|a, b| b.2.total_cmp(&a.2));
    let mut seen: HashSet<(bool, &String)> = HashSet::new();
    scored.into_iter().filter(|(f, id, _)| seen.insert((*f, *id))).take(n).collect()
}

/// The `n` stored answers closest in meaning to `query`, with how close (for the test bench's probe: why an answer was or was not chosen).
pub fn closest(m: &Meaning, query: &str, n: usize) -> Result<Vec<(String, f32)>, String> {
    let data = loaded();
    Ok(nearest(data, &m.embedder.embed(query)?, n)
        .into_iter()
        .map(|(from_qa, id, s)| {
            let question = if from_qa { data.qa.get(id).map(|e| e.question.clone()) } else { data.firsts.all().iter().find(|e| &e.id == id).map(|e| e.question.clone()) };
            (question.unwrap_or_else(|| id.clone()), s)
        })
        .collect())
}

/// A curated answer shown as "related": the same words, under the label that says it may not answer the question.
fn into_related(a: Answer) -> Answer {
    match a {
        Answer::Curated { question, confidence, answer, citations, note, .. } => Answer::Related { question, confidence, answer, citations, note },
        other => other,
    }
}

/// Every word of the hand-checked answers, for the spelling list (so doctrinal words such as "rapture" are known).
fn curated_text() -> &'static Vec<String> {
    static TEXT: OnceLock<Vec<String>> = OnceLock::new();
    TEXT.get_or_init(|| {
        let d = loaded();
        d.qa
            .all()
            .iter()
            .map(|e| format!("{} {} {}", e.question, e.alt_phrasings.join(" "), e.answer))
            .chain(d.firsts.all().iter().map(|e| e.question.clone()))
            .collect()
    })
}

/// Makes Ask's word list ahead of the first question (the Bible's words, the names of people and places, the words of the answers).
/// The phone's one database holds the Bible and the study tables, so it is both connections.
pub fn warm(db: &Connection) {
    spell::vocab(db, Some(db), curated_text());
}

/// The reply to what was typed: the answer to it as typed, or, when a question has a spelling slip ("who betryed jesus") and the
/// question put right has an answer, that answer and the question as it was read. A question that already has its exact stored answer,
/// or is a count, is left as typed.
pub fn ask_with_correction(db: &Connection, study: &Connection, query: &str, meaning: Option<&Meaning>) -> Result<AskReply, String> {
    let q = query.trim();
    let data = loaded();
    if looks_like_question(q) && data.qa.find_exact(q).is_none() && qa_parser::parse_frequency_question(q).is_none() {
        if let Some(fixed) = spell::vocab(db, Some(study), curated_text()).correct(q) {
            let answer = ask(db, study, &fixed, meaning)?;
            if answer.is_some() {
                return Ok(AskReply { answer, corrected: Some(fixed) });
            }
        }
    }
    Ok(AskReply { answer: ask(db, study, q, meaning)?, corrected: None })
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

    fn empty_firsts() -> FirstsData {
        FirstsData::from_json(r#"{"entries":[]}"#).unwrap()
    }

    /// The answer text of a curated answer, built the phone's way.
    fn shown(e: &QaEntry) -> String {
        let db = Connection::open_in_memory().unwrap();
        match curated(&db, &empty_firsts(), e, false) {
            Some(Answer::Curated { answer, .. }) => answer,
            _ => panic!("{} gave no curated answer", e.id),
        }
    }

    #[test]
    fn published_viewpoints_follow_the_answer_and_hidden_ones_stay_hidden() {
        let qa = QaData::from_json(
            r#"{"entries":[{"id":"t","question":"Q?","alt_phrasings":[],"confidence":"doctrinal_view","answer":"What Scripture says.","citations":[],"note":null,
            "views":[{"label":"The Pentecostal reading","text":"First view."},{"label":"Other views","text":"Hidden view.","publish":false},{"label":"A third reading","text":"Third view."}]}]}"#,
        )
        .unwrap();
        let text = shown(&qa.all()[0]);
        assert!(text.starts_with("What Scripture says."), "{text}");
        assert!(text.contains("\n\nThe Pentecostal reading: First view."), "{text}");
        assert!(text.contains("\n\nA third reading: Third view."), "{text}");
        assert!(!text.contains("Hidden view") && !text.contains("Other views"), "a view that is not published must not show: {text}");
        // the order is the order in the data, and the Pentecostal reading comes first
        assert!(text.find("Pentecostal").unwrap() < text.find("third reading").unwrap());
    }

    #[test]
    fn every_published_view_in_the_real_data_reaches_the_phone() {
        let d = loaded();
        let mut checked = 0;
        for e in d.qa.all().iter().filter(|e| e.computed_from.is_none()) {
            let text = shown(e);
            for v in &e.views {
                assert_eq!(text.contains(&v.text), v.publish, "{}: view \"{}\" published={}", e.id, v.label, v.publish);
                checked += 1;
            }
        }
        assert!(checked >= 9, "the real data has viewpoints to check ({checked})");
    }

    /// A small in-memory study database with the dictionaries' tables, as the phone's study pack has them.
    fn study_with(entries: &[(&str, &str, &str)]) -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch("CREATE TABLE dictionaries(code TEXT, name TEXT); CREATE TABLE dict_entries(id INTEGER PRIMARY KEY, dict_code TEXT, headword TEXT, headword_fold TEXT, body TEXT);").unwrap();
        c.execute("INSERT INTO dictionaries VALUES ('easton', 'Easton''s Bible Dictionary')", []).unwrap();
        for (headword, fold, body) in entries {
            c.execute("INSERT INTO dict_entries(dict_code, headword, headword_fold, body) VALUES ('easton', ?1, ?2, ?3)", params![headword, fold, body]).unwrap();
        }
        c
    }

    #[test]
    fn a_dictionary_entry_that_only_points_elsewhere_is_not_an_answer() {
        let long = "A long entry with real words in it. ".repeat(8);
        let study = study_with(&[("Cowardice", "cowardice", "See FEAR"), ("Fear", "fear", &long)]);
        assert!(dictionary(&study, "what is cowardice").is_none(), "an entry of three words is not an answer");
        match dictionary(&study, "what is fear") {
            Some(Answer::Dictionary { headword, .. }) => assert_eq!(headword, "Fear"),
            other => panic!("expected the Fear entry, got {other:?}"),
        }
        // an entry that is short but carries a passage still counts
        let short_with_passage = study_with(&[("Mercy", "mercy", "Mercy, \u{27e6}Psalm 23:6\u{27e7}.")]);
        assert!(dictionary(&short_with_passage, "what is mercy").is_some());
    }

    #[test]
    fn a_failed_curated_answer_is_shown_as_related_and_nothing_else_changes() {
        let curated = Answer::Curated {
            question: "Who betrayed Jesus?".into(),
            confidence: "scripture_plain".into(),
            answer: "Judas.".into(),
            citations: vec![],
            note: Some("n".into()),
            by_meaning: true,
        };
        match into_related(curated) {
            Answer::Related { question, answer, note, .. } => {
                assert_eq!(question, "Who betrayed Jesus?");
                assert_eq!(answer, "Judas.");
                assert_eq!(note.as_deref(), Some("n"));
            }
            other => panic!("expected a related answer, got {other:?}"),
        }
        let dict = Answer::Dictionary { id: 1, headword: "x".into(), source: "s".into(), preview: "p".into() };
        assert!(matches!(into_related(dict), Answer::Dictionary { .. }), "only a curated answer becomes related");
    }

    #[test]
    fn a_spelling_slip_is_put_right_and_reported_but_a_right_question_is_left_alone() {
        let db = Connection::open_in_memory().unwrap();
        let study = study_with(&[]);
        let r = ask_with_correction(&db, &study, "Who betryed Jesus?", None).unwrap();
        assert_eq!(r.corrected.as_deref(), Some("Who betrayed Jesus?"), "the question as it was read is reported");
        match r.answer {
            Some(Answer::Curated { question, .. }) => assert_eq!(question, "Who betrayed Jesus?"),
            other => panic!("expected the stored answer, got {other:?}"),
        }
        let plain = ask_with_correction(&db, &study, "Who betrayed Jesus?", None).unwrap();
        assert!(plain.corrected.is_none(), "a question with nothing to put right is not reported as corrected");
        assert!(plain.answer.is_some());
        // a search that is not a question is never rewritten
        let search = ask_with_correction(&db, &study, "betryed", None).unwrap();
        assert!(search.corrected.is_none() && search.answer.is_none());
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
                Some(Answer::Related { question, .. }) => format!("related [{question}]"),
            };
            println!("{q} ({:?})
   with upgrade: {}
   without:      {}", t.elapsed(), show(&with), show(&without));
        }
    }
}
