//! Search by meaning: the words of the Bible grouped by what they mean (love, forgiveness, joy...), Hebrew and Greek, from the UBS open-licence
//! dictionaries (UBS Dictionary of Biblical Hebrew; UBS Dictionary of the Greek New Testament, adapted from Louw and Nida; CC BY-SA 4.0), kept in
//! resources/semantic_domains.json by scripts/build_semantic_domains.mts. The file is read the first time it is needed. A group of meanings is a code
//! of three-digit steps ("025" is a domain, "025003" a sub-domain; Hebrew goes four levels: "002001002018"); the verses where a meaning is used come
//! packed as a first number and the steps between the rest (src/semantic.ts has the same packing). Also here: the Concordance's "by Strong's number".

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::sync::OnceLock;

use rusqlite::params;
use tauri::State;

use crate::db::DbState;
use crate::models::{ConcordanceBook, ConcordanceResult, FrequencyScope, SearchHit};
use crate::study::StudyState;
pub use bible_core::semantic::*;



pub struct SemanticState {
    path: PathBuf,
    data: OnceLock<Result<Data, String>>,
    sil_path: PathBuf,
    sil: OnceLock<Option<RawSil>>,
}

impl SemanticState {
    pub fn new(path: PathBuf, sil_path: PathBuf) -> Self {
        Self { path, data: OnceLock::new(), sil_path, sil: OnceLock::new() }
    }

    /// The everyday-English file; the Meaning screens work without it (no cards).
    fn sil(&self) -> Option<&RawSil> {
        self.sil.get_or_init(|| std::fs::read_to_string(&self.sil_path).ok().and_then(|t| RawSil::from_json(&t).ok())).as_ref()
    }

    fn get(&self) -> Result<&Data, String> {
        self.data
            .get_or_init(|| {
                let text = std::fs::read_to_string(&self.path).map_err(|_| "The meanings are not installed with this copy of the app.".to_string())?;
                Data::from_json(&text)
            })
            .as_ref()
            .map_err(|e| e.clone())
    }
}


// ---------------------------------------------------------------- commands: by meaning

/// Every group of meanings of a language, in order (a group's parent is its code with the last three digits off), with its word and verse counts.
#[tauri::command]
pub fn semantic_tree(state: State<SemanticState>, language: String) -> Result<Vec<DomainNode>, String> {
    Ok(state.get()?.lang(&language)?.nodes.clone())
}

/// The words (and their meanings) inside a group, the most used first.
#[tauri::command]
pub fn semantic_words(state: State<SemanticState>, db: State<DbState>, language: String, code: String) -> Result<Vec<MeaningWord>, String> {
    let lang = state.get()?.lang(&language)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut out = lang.words_in(&code);
    // Strong's transliteration and, for a Hebrew lemma without vowel points, Strong's pointed lemma (one lookup per Strong's number)
    let mut cache: std::collections::HashMap<String, (Option<String>, String)> = std::collections::HashMap::new();
    for w in out.iter_mut() {
        let Some(s) = w.strongs.first().cloned() else { continue };
        let (xlit, lemma) = cache.entry(s.clone()).or_insert_with(|| strongs_xlit_lemma(&conn, &s)).clone();
        w.translit = xlit;
        if language == "hebrew" && !has_hebrew_points(&w.lemma) && has_hebrew_points(&lemma) {
            w.speak = lemma;
        }
    }
    Ok(out)
}

/// Does a Hebrew word carry vowel points? (Without them it cannot be said aloud.)

fn strongs_xlit_lemma(conn: &rusqlite::Connection, strongs: &str) -> (Option<String>, String) {
    conn.query_row("SELECT xlit, lemma FROM strongs_dict WHERE strongs_number = ?1", params![strongs], |r| {
        Ok((r.get::<_, Option<String>>(0)?.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()), r.get::<_, Option<String>>(1)?.unwrap_or_default()))
    })
    .unwrap_or((None, String::new()))
}

fn books_of(conn: &rusqlite::Connection) -> Result<Vec<ConcordanceBook>, String> {
    let mut stmt = conn.prepare("SELECT name, testament, order_index FROM books WHERE testament IN ('OT', 'NT') ORDER BY order_index").map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok(ConcordanceBook { book: r.get(0)?, testament: r.get(1)?, order_index: r.get(2)?, verses: 0, occurrences: 0 }))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

/// A count of verses for every book, for a group, a word in it or one meaning of one word (the Concordance's book grid; "occurrences" is the same as "verses" here).
#[tauri::command]
pub fn semantic_concordance(
    state: State<SemanticState>,
    db: State<DbState>,
    language: String,
    code: String,
    entry: Option<usize>,
    meaning: Option<usize>,
) -> Result<ConcordanceResult, String> {
    let lang = state.get()?.lang(&language)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    concordance_of(lang, &conn, &code, entry, meaning)
}

fn concordance_of(lang: &Lang, conn: &rusqlite::Connection, code: &str, entry: Option<usize>, meaning: Option<usize>) -> Result<ConcordanceResult, String> {
    let verses = lang.select(code, entry, meaning);
    let mut books = books_of(conn)?;
    let mut total = 0i64;
    for v in verses.keys() {
        if let Some(b) = books.iter_mut().find(|b| b.order_index == i64::from(v / 1_000_000)) {
            b.verses += 1;
            b.occurrences += 1;
            total += 1;
        }
    }
    Ok(ConcordanceResult { total_occurrences: total, total_verses: total, books, pattern: String::new(), forms: Vec::new(), found: Vec::new() })
}

/// The verses, with their words in the chosen Bible, of a group (or a word, or a meaning) in one book, or in a whole Testament when no book is given.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn semantic_hits(
    state: State<SemanticState>,
    db: State<DbState>,
    version_code: String,
    language: String,
    code: String,
    entry: Option<usize>,
    meaning: Option<usize>,
    book: Option<String>,
) -> Result<Vec<SearchHit>, String> {
    let lang = state.get()?.lang(&language)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    hits_of(lang, &conn, &version_code, &code, entry, meaning, book.as_deref())
}

fn hits_of(lang: &Lang, conn: &rusqlite::Connection, version_code: &str, code: &str, entry: Option<usize>, meaning: Option<usize>, book: Option<&str>) -> Result<Vec<SearchHit>, String> {
    let verses = lang.select(code, entry, meaning);
    let names: HashMap<i64, String> = books_of(conn)?.into_iter().map(|b| (b.order_index, b.book)).collect();
    let mut stmt = conn
        .prepare(
            "SELECT v.chapter, v.verse, v.text FROM verses v JOIN books b ON v.book_id = b.id JOIN versions ver ON v.version_id = ver.id
             WHERE ver.code = ?1 AND b.order_index = ?2",
        )
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let mut by_book: BTreeMap<i64, Vec<(u32, &Vec<String>)>> = BTreeMap::new();
    for (v, words) in &verses {
        by_book.entry(i64::from(v / 1_000_000)).or_default().push((*v, words));
    }
    for (order, list) in by_book {
        let Some(name) = names.get(&order) else { continue };
        if book.is_some_and(|b| b != name) {
            continue;
        }
        let text: HashMap<(i64, i64), String> = stmt
            .query_map(params![version_code, order], |r| Ok(((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?), r.get::<_, String>(2)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        for (v, words) in list {
            let (chapter, verse) = (i64::from((v % 1_000_000) / 1_000), i64::from(v % 1_000));
            // a verse the chosen Bible does not have (the numbering differs in a few places) is left out
            if let Some(t) = text.get(&(chapter, verse)) {
                out.push(SearchHit { version_code: version_code.to_string(), book: name.clone(), chapter, verse, text: t.clone(), verse_end: None, why: words.clone() });
            }
        }
    }
    Ok(out)
}


/// What a word means where it is used: the dictionary's meanings of a Strong's number, those listed for this verse first and marked "here".
#[tauri::command]
pub fn semantic_word_meanings(state: State<SemanticState>, db: State<DbState>, strongs: String, book: Option<String>, chapter: Option<i64>, verse: Option<i64>) -> Result<Vec<WordMeaning>, String> {
    let Some(s) = norm_strongs(&strongs) else { return Ok(Vec::new()) };
    let data = state.get()?;
    let lang = data.lang_of_strongs(&s);
    let key: Option<u32> = match (book, chapter, verse) {
        (Some(b), Some(c), Some(v)) => {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            let order: Option<i64> = conn.query_row("SELECT order_index FROM books WHERE name = ?1", params![b], |r| r.get(0)).ok();
            order.map(|o| (o * 1_000_000 + c * 1_000 + v) as u32)
        }
        _ => None,
    };
    Ok(lang.word_meanings(&s, key))
}

// ---------------------------------------------------------------- commands: by Strong's number

fn study_conn<'a>(state: &'a State<StudyState>) -> Result<std::sync::MutexGuard<'a, rusqlite::Connection>, String> {
    state.0.as_ref().ok_or_else(|| "The Hebrew and Greek words are not installed with this copy of the app.".to_string())?.lock().map_err(|e| e.to_string())
}

/// How many times a Strong's number is used in each book (the Hebrew or Greek word behind it, counted in the original text).
#[tauri::command]
pub fn strongs_concordance(study: State<StudyState>, db: State<DbState>, strongs: String) -> Result<ConcordanceResult, String> {
    let s = norm_strongs(&strongs).ok_or("Type a Strong's number: G for Greek or H for Hebrew, then the number, like G26 or H157.")?;
    let study = study_conn(&study)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    strongs_counts(&study, &conn, &s)
}

fn strongs_counts(study: &rusqlite::Connection, conn: &rusqlite::Connection, s: &str) -> Result<ConcordanceResult, String> {
    let counts: HashMap<String, (i64, i64)> = {
        let conn = study;
        let mut stmt = conn
            .prepare("SELECT book, COUNT(*), COUNT(DISTINCT chapter * 1000 + verse) FROM interlinear WHERE strongs = ?1 GROUP BY book")
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![s], |r| Ok((r.get::<_, String>(0)?, (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))).map_err(|e| e.to_string())?;
        rows.filter_map(|r| r.ok()).collect()
    };
    let mut books = books_of(conn)?;
    let (mut total, mut verses) = (0, 0);
    for b in books.iter_mut() {
        if let Some((n, v)) = counts.get(&b.book) {
            b.occurrences = *n;
            b.verses = *v;
            total += n;
            verses += v;
        }
    }
    Ok(ConcordanceResult { total_occurrences: total, total_verses: verses, books, pattern: String::new(), forms: Vec::new(), found: Vec::new() })
}

/// The verses of one Strong's number in a book or a Testament, with their words in the chosen Bible.
#[tauri::command]
pub fn strongs_verses(study: State<StudyState>, db: State<DbState>, version_code: String, strongs: String, scope: FrequencyScope) -> Result<Vec<SearchHit>, String> {
    let s = norm_strongs(&strongs).ok_or("Type a Strong's number, like G26 or H157.")?;
    let study = study_conn(&study)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    strongs_hits(&study, &conn, &version_code, &s, &scope)
}

fn strongs_hits(study: &rusqlite::Connection, conn: &rusqlite::Connection, version_code: &str, s: &str, scope: &FrequencyScope) -> Result<Vec<SearchHit>, String> {
    let rows: Vec<(String, i64, i64)> = {
        let conn = study;
        let mut stmt = conn.prepare("SELECT DISTINCT book, chapter, verse FROM interlinear WHERE strongs = ?1").map_err(|e| e.to_string())?;
        let r = stmt.query_map(params![s], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))).map_err(|e| e.to_string())?;
        r.filter_map(|r| r.ok()).collect()
    };
    let books = books_of(conn)?;
    let wanted: HashSet<&str> = books
        .iter()
        .filter(|b| match scope {
            FrequencyScope::Book { book } => &b.book == book,
            FrequencyScope::Testament { testament } => &b.testament == testament,
        })
        .map(|b| b.book.as_str())
        .collect();
    let mut stmt = conn
        .prepare(
            "SELECT v.text FROM verses v JOIN books b ON v.book_id = b.id JOIN versions ver ON v.version_id = ver.id
             WHERE ver.code = ?1 AND b.name = ?2 AND v.chapter = ?3 AND v.verse = ?4",
        )
        .map_err(|e| e.to_string())?;
    let order: HashMap<&str, i64> = books.iter().map(|b| (b.book.as_str(), b.order_index)).collect();
    let mut rows: Vec<(String, i64, i64)> = rows.into_iter().filter(|(b, _, _)| wanted.contains(b.as_str())).collect();
    rows.sort_by_key(|(b, c, v)| (order.get(b.as_str()).copied().unwrap_or(0), *c, *v));
    let mut out = Vec::new();
    for (book, chapter, verse) in rows {
        if let Ok(text) = stmt.query_row(params![version_code, book, chapter, verse], |r| r.get::<_, String>(0)) {
            out.push(SearchHit { version_code: version_code.to_string(), book, chapter, verse, text, verse_end: None, why: Vec::new() });
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------- the plain-English side (SIL Semantic Domains) and the senses of one word


fn verse_key(conn: &rusqlite::Connection, book: Option<String>, chapter: Option<i64>, verse: Option<i64>) -> Option<u32> {
    let (Some(b), Some(c), Some(v)) = (book, chapter, verse) else { return None };
    let order: Option<i64> = conn.query_row("SELECT order_index FROM books WHERE name = ?1", params![b], |r| r.get(0)).ok();
    order.map(|o| (o * 1_000_000 + c * 1_000 + v) as u32)
}

/// Every meaning of a Hebrew or Greek word: how many verses use each, where in the Bible, and what the meaning is called in everyday English. The verse asked
/// about (the one being read) marks the meaning that is used there.
#[tauri::command]
pub fn semantic_senses(state: State<SemanticState>, db: State<DbState>, strongs: String, book: Option<String>, chapter: Option<i64>, verse: Option<i64>) -> Result<SenseReport, String> {
    let s = norm_strongs(&strongs).ok_or("Type a Strong's number, like G26 or H157.")?;
    let hebrew = s.starts_with('H');
    let data = state.get()?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let key = verse_key(&conn, book, chapter, verse);
    let (lemma, senses) = senses_of(if hebrew { &data.hebrew } else { &data.greek }, state.sil(), hebrew, &s, key);
    let dictionary = conn
        .query_row("SELECT lemma, xlit, strongs_def, kjv_def FROM strongs_dict WHERE strongs_number = ?1", params![s], |r| {
            Ok(WordDictionary {
                lemma: r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                translit: r.get::<_, Option<String>>(1)?.filter(|t| !t.trim().is_empty()),
                definition: r.get::<_, Option<String>>(2)?.unwrap_or_default().trim().to_string(),
                kjv: r.get::<_, Option<String>>(3)?.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()),
            })
        })
        .ok();
    let lemma = if lemma.is_empty() { dictionary.as_ref().map(|d| d.lemma.clone()).unwrap_or_default() } else { lemma };
    Ok(SenseReport { strongs: s.clone(), language: if hebrew { "hebrew" } else { "greek" }.to_string(), lemma, senses, dictionary })
}

/// The card for a whole group of meanings (the tree's selected group).
#[tauri::command]
pub fn semantic_group_card(state: State<SemanticState>, language: String, code: String) -> Result<Option<SilCard>, String> {
    Ok(state.sil().and_then(|s| s.card(language == "hebrew", &[code])))
}


/// Example verses for one meaning of a word, in the Bible chosen (the words are marked where that Bible is tagged with Strong's numbers; otherwise the
/// BSB is used). The verse being read comes first when this meaning is used in it.
#[tauri::command]
pub fn semantic_sense_samples(
    state: State<SemanticState>,
    db: State<DbState>,
    lib: State<crate::library::LibraryState>,
    strongs: String,
    entry: usize,
    meaning: usize,
    version_code: String,
    book: Option<String>,
    chapter: Option<i64>,
    verse: Option<i64>,
) -> Result<Vec<Sample>, String> {
    let s = norm_strongs(&strongs).ok_or("Type a Strong's number, like G26 or H157.")?;
    let data = state.get()?;
    let lang = if s.starts_with('G') { &data.greek } else { &data.hebrew };
    let m = lang.entries.get(entry).and_then(|e| e.meanings.get(meaning)).ok_or("That meaning is not in the dictionary.")?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let here = verse_key(&conn, book, chapter, verse);
    // a Bible added to the Library with Strong's numbers is used as it is
    if let Ok(lc) = lib.conn.lock() {
        if crate::library::is_tagged_bible(&lc, &version_code) {
            return library_samples(&conn, &lc, &s, &m.verses, here, &version_code);
        }
    }
    samples_in(&conn, &s, &m.verses, here, &version_code)
}

/// The same for a Library Bible: its verses carry their Strong's-numbered words, so the word is marked in them.
fn library_samples(bible: &rusqlite::Connection, lib: &rusqlite::Connection, s: &str, verses: &[u32], here: Option<u32>, code: &str) -> Result<Vec<Sample>, String> {
    let mut out = Vec::new();
    for k in pick_sample_keys(verses, here, 3) {
        let (b, c, v) = ((k / 1_000_000) as i64, ((k % 1_000_000) / 1_000) as i64, (k % 1_000) as i64);
        let Ok(name) = bible.query_row("SELECT name FROM books WHERE order_index = ?1", params![b], |r| r.get::<_, String>(0)) else { continue };
        let Ok((text, json)) = lib.query_row(
            "SELECT text, words FROM lib_verses WHERE module = ?1 AND book = ?2 AND chapter = ?3 AND verse = ?4",
            params![code, name, c, v],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
        ) else {
            continue;
        };
        let list: Vec<(String, Vec<String>)> = json.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default();
        let words: Vec<String> = list.into_iter().filter(|(_, nums)| nums.iter().any(|n| n.eq_ignore_ascii_case(s))).map(|(w, _)| w).collect();
        out.push(Sample { book: name, chapter: c, verse: v, parts: mark_parts(&text, &words) });
    }
    if out.is_empty() {
        return Err("The verses are not available.".into());
    }
    Ok(out)
}

fn samples_in(conn: &rusqlite::Connection, s: &str, verses: &[u32], here: Option<u32>, version_code: &str) -> Result<Vec<Sample>, String> {
    let keys = pick_sample_keys(verses, here, 3);
    let tagged = |code: &str| -> Option<i64> {
        let id: i64 = conn.query_row("SELECT id FROM versions WHERE code = ?1", params![code], |r| r.get(0)).ok()?;
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM strongs_links sl JOIN verses v ON v.id = sl.verse_id WHERE v.version_id = ?1 AND v.book_id = 43 AND v.chapter = 3 AND v.verse = 16", params![id], |r| r.get(0)).ok()?;
        (n > 0).then_some(id)
    };
    let version_id = tagged(version_code).or_else(|| tagged("BSB")).ok_or("The verses are not available.")?;
    let mut out = Vec::new();
    for k in keys {
        let (b, c, v) = ((k / 1_000_000) as i64, ((k % 1_000_000) / 1_000) as i64, (k % 1_000) as i64);
        let Ok((verse_id, name, text)) = conn.query_row(
            "SELECT v.id, b.name, v.text FROM verses v JOIN books b ON b.id = v.book_id WHERE v.version_id = ?1 AND b.order_index = ?2 AND v.chapter = ?3 AND v.verse = ?4",
            params![version_id, b, c, v],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
        ) else {
            continue;
        };
        let words: Vec<String> = {
            let mut stmt = conn.prepare("SELECT surface_text FROM strongs_links WHERE verse_id = ?1 AND strongs_number = ?2 AND trim(surface_text) <> ''").map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![verse_id, s], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
            rows.filter_map(|r| r.ok()).collect()
        };
        out.push(Sample { book: name, chapter: c, verse: v, parts: mark_parts(&text, &words) });
    }
    Ok(out)
}

// ---- the original words behind an English word


/// The Hebrew and Greek words an English word translates (in a Bible tagged with Strong's numbers), the most often first: "love" is agape, agapao, ahab...
#[tauri::command]
pub fn original_words_for(db: State<DbState>, lib: State<crate::library::LibraryState>, word: String, version_code: String) -> Result<Vec<OriginalWord>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if let Ok(lc) = lib.conn.lock() {
        if crate::library::is_tagged_bible(&lc, &version_code) {
            return library_original_words(&conn, &lc, &word, &version_code);
        }
    }
    original_words_in(&conn, &word, &version_code)
}

/// The same for a Library Bible with Strong's numbers: the tagged words of every verse are read once and counted.
fn library_original_words(bible: &rusqlite::Connection, lib: &rusqlite::Connection, word: &str, code: &str) -> Result<Vec<OriginalWord>, String> {
    let w: String = word.trim().to_lowercase().chars().filter(|c| c.is_alphabetic() || *c == '\'' || *c == ' ').collect();
    if w.is_empty() || w.len() > 40 {
        return Ok(Vec::new());
    }
    let forms = [w.clone(), format!("{w}s"), format!("{w}d"), format!("{w}ed"), format!("{w}ing")];
    let mut counts: HashMap<String, i64> = HashMap::new();
    let mut stmt = lib.prepare("SELECT words FROM lib_verses WHERE module = ?1 AND words IS NOT NULL").map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![code], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?;
    for json in rows.flatten() {
        let Ok(list) = serde_json::from_str::<Vec<(String, Vec<String>)>>(&json) else { continue };
        for (surface, nums) in list {
            if forms.contains(&surface.trim().to_lowercase()) {
                for n in nums {
                    if n != "G3588" {
                        *counts.entry(n).or_insert(0) += 1;
                    }
                }
            }
        }
    }
    let mut out = Vec::new();
    for (n, times) in counts {
        let Ok((lemma, xlit, def)) = bible.query_row("SELECT lemma, xlit, strongs_def FROM strongs_dict WHERE strongs_number = ?1", params![n], |r| {
            Ok((r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?))
        }) else {
            continue;
        };
        let Some(lemma) = lemma else { continue };
        out.push(OriginalWord { strongs: n, lemma, translit: xlit.filter(|t| !t.trim().is_empty()), definition: def.unwrap_or_default().trim().to_string(), times });
    }
    out.sort_by(|a, b| b.times.cmp(&a.times).then(a.strongs.cmp(&b.strongs)));
    out.truncate(12);
    Ok(out)
}

fn original_words_in(conn: &rusqlite::Connection, word: &str, version_code: &str) -> Result<Vec<OriginalWord>, String> {
    let w: String = word.trim().to_lowercase().chars().filter(|c| c.is_alphabetic() || *c == '\'' || *c == ' ').collect();
    if w.is_empty() || w.len() > 40 {
        return Ok(Vec::new());
    }
    let version_id: i64 = conn
        .query_row("SELECT v.id FROM versions v WHERE v.code = ?1 AND EXISTS (SELECT 1 FROM strongs_links sl JOIN verses vv ON vv.id = sl.verse_id WHERE vv.version_id = v.id LIMIT 1)", params![version_code], |r| r.get(0))
        .or_else(|_| conn.query_row("SELECT id FROM versions WHERE code = 'BSB'", [], |r| r.get(0)))
        .map_err(|_| "The words are not available.".to_string())?;
    let forms = [w.clone(), format!("{w}s"), format!("{w}d"), format!("{w}ed"), format!("{w}ing")];
    let mut stmt = conn
        .prepare(
            "SELECT sl.strongs_number, COUNT(*) AS n, d.lemma, d.xlit, d.strongs_def
             FROM strongs_links sl JOIN verses v ON v.id = sl.verse_id LEFT JOIN strongs_dict d ON d.strongs_number = sl.strongs_number
             WHERE v.version_id = ?1 AND lower(trim(sl.surface_text)) IN (?2, ?3, ?4, ?5, ?6) AND sl.strongs_number <> 'G3588' AND d.lemma IS NOT NULL
             GROUP BY sl.strongs_number ORDER BY n DESC LIMIT 12",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![version_id, forms[0], forms[1], forms[2], forms[3], forms[4]], |r| {
            Ok(OriginalWord {
                strongs: r.get(0)?,
                times: r.get(1)?,
                lemma: r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                translit: r.get::<_, Option<String>>(3)?.filter(|t| !t.trim().is_empty()),
                definition: r.get::<_, Option<String>>(4)?.unwrap_or_default().trim().to_string(),
            })
        })
        .map_err(|e| e.to_string())?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{"greek":{"domains":[["025","Attitudes and Emotions"],["025003","Love, Affection, Compassion"],["025009","Hate"]],
        "entries":[
          {"s":["G26"],"l":"agape","m":[{"d":["025003"],"g":["love"],"t":"to love","c":"25.43","v":[40024012,3000000]}]},
          {"s":["G25"],"l":"agapao","m":[{"d":["025003"],"g":[],"t":"love verb","v":[43003016,3]},{"d":["025009"],"g":["hate"],"t":"x","v":[43003017]}]}]},
        "hebrew":{"domains":[["002","Events"],["002001","States"]],"entries":[{"s":["H157"],"l":"ahev","m":[{"d":["002001"],"g":["to love"],"t":"affection","v":[1022002]}]}]}}"#;

    fn data() -> Data {
        Data::from_json(SAMPLE).unwrap()
    }

    #[test]
    fn verse_lists_unpack_and_the_tree_counts_what_is_inside() {
        assert_eq!(unpack(&[40024012, 1000, 5]), vec![40024012, 40025012, 40025017]);
        assert_eq!(unpack(&[]), Vec::<u32>::new());
        let d = data();
        let g = &d.greek.nodes;
        let top = g.iter().find(|n| n.code == "025").unwrap();
        assert_eq!((top.level, top.words, top.verses), (1, 2, 5), "the domain holds the words and verses of the groups under it");
        let love = g.iter().find(|n| n.code == "025003").unwrap();
        assert_eq!((love.level, love.words, love.verses), (2, 2, 4));
        assert_eq!(g.iter().find(|n| n.code == "025009").unwrap().verses, 1);
        assert!(d.hebrew.nodes.iter().any(|n| n.code == "002001" && n.words == 1));
    }

    #[test]
    fn a_group_a_word_or_a_meaning_gives_its_verses() {
        let d = data();
        let all = d.greek.select("025", None, None);
        assert_eq!(all.len(), 5, "{all:?}");
        assert_eq!(all[&40024012], vec!["agape (love)".to_string()]);
        let love = d.greek.select("025003", None, None);
        assert_eq!(love.len(), 4);
        assert!(!love.contains_key(&43003017), "the hate meaning is in another group");
        let one = d.greek.select("025", Some(1), Some(1));
        assert_eq!(one.keys().copied().collect::<Vec<_>>(), vec![43003017]);
        assert_eq!(d.greek.select("999", None, None).len(), 0);
        assert_eq!(d.greek.path_of("025003"), "Attitudes and Emotions > Love, Affection, Compassion");
    }

    #[test]
    fn strongs_numbers_are_read_the_way_the_app_writes_them() {
        assert_eq!(norm_strongs("G0026").as_deref(), Some("G26"));
        assert_eq!(norm_strongs(" h157 ").as_deref(), Some("H157"));
        assert_eq!(norm_strongs("H1697I").as_deref(), Some("H1697"));
        for bad in ["", "26", "X26", "G", "G0", "Gabc", "G999999"] {
            assert_eq!(norm_strongs(bad), None, "{bad:?}");
        }
    }


    // ---------------------------------------------------------------- the senses of one word and the plain-English cards

    const SIL: &str = r#"{"greek":{"025003":"4.3.3","044":"1.6"},"hebrew":{"002001002018":"4.3.3"},
        "domains":{"4.3.3":{"n":"Love","p":["Social behavior"],"d":"Use this domain for words about loving someone.","r":[{"c":"3.4.1.1","n":"Like, love"}],"w":["love","adore"]},
                   "1.6":{"n":"Animal","p":[],"d":"Animals.","r":[],"w":["beast"]}}}"#;

    #[test]
    fn a_group_gets_its_card_and_a_group_without_one_gets_none() {
        let sil = RawSil::from_json(SIL).unwrap();
        let card = sil.card(false, &["025003".to_string()]).unwrap();
        assert_eq!((card.code.as_str(), card.name.as_str(), card.by_louw_nida), ("4.3.3", "Love", true));
        assert_eq!(card.path, vec!["Social behavior".to_string()]);
        assert_eq!(card.related, vec![SilRelated { code: "3.4.1.1".into(), name: "Like, love".into() }]);
        // a sub-group with no match of its own uses the group above it
        assert_eq!(sil.card(false, &["044007".to_string()]).unwrap().code, "1.6");
        assert!(sil.card(false, &["999001".to_string()]).is_none());
        // Hebrew is matched by hand, by meaning
        assert!(!sil.card(true, &["002001002018".to_string()]).unwrap().by_louw_nida);
        assert!(sil.card(true, &["002001002019".to_string()]).is_none());
        assert!(RawSil::from_json("nope").is_err());
    }

    #[test]
    fn the_senses_of_a_word_count_their_verses_by_book_and_mark_the_one_used_here() {
        let d = data();
        let sil = RawSil::from_json(SIL).unwrap();
        // G25 has two meanings: love (John 3:16 and Genesis 0:0..) and hate (John 3:17)
        let (lemma, senses) = senses_of(&d.greek, Some(&sil), false, "G25", Some(43003017));
        assert_eq!(lemma, "agapao");
        assert_eq!(senses.len(), 2);
        assert_eq!((senses[0].entry, senses[0].meaning, senses[0].verses), (1, 0, 2));
        assert_eq!(senses[0].by_book.len(), 66);
        assert_eq!(senses[0].by_book[42], 2, "both verses of the love meaning are in John, book 43");
        assert!(!senses[0].here && senses[1].here, "John 3:17 is the hate meaning");
        assert_eq!(senses[0].sil.as_ref().map(|c| c.name.as_str()), Some("Love"));
        assert!(senses[1].sil.is_none());
        assert_eq!(senses[0].groups, vec!["Attitudes and Emotions > Love, Affection, Compassion".to_string()]);
        // without a card file, or for a word that is not there
        assert!(senses_of(&d.greek, None, false, "G25", None).1.iter().all(|s| s.sil.is_none() && !s.here));
        assert!(senses_of(&d.greek, None, false, "G99999", None).1.is_empty());
        let (hl, hs) = senses_of(&d.hebrew, Some(&sil), true, "H157", None);
        assert_eq!((hl.as_str(), hs.len()), ("ahev", 1));
        assert!(hs[0].sil.is_none(), "002001 has no card in the sample");
    }

    #[test]
    fn example_verses_start_with_the_one_being_read_and_the_words_are_marked() {
        let v: Vec<u32> = (1..=10).map(|n| n * 1000).collect();
        assert_eq!(pick_sample_keys(&v, None, 3), vec![1000, 6000, 10000]);
        assert_eq!(pick_sample_keys(&v, Some(4000), 3), vec![1000, 4000, 6000], "the verse being read is one of them");
        assert_eq!(pick_sample_keys(&v, Some(4500), 3), vec![1000, 6000, 10000], "a verse the meaning is not used in is not added");
        assert_eq!(pick_sample_keys(&[5], None, 3), vec![5]);
        assert!(pick_sample_keys(&[], Some(1), 3).is_empty());

        let parts = mark_parts("And forgive us our debts, as we also have forgiven our debtors.", &["forgive".into(), "have forgiven".into()]);
        let marked: Vec<&str> = parts.iter().filter(|p| p.mark).map(|p| p.text.as_str()).collect();
        assert_eq!(marked, vec!["forgive", "have forgiven"]);
        assert_eq!(parts.iter().map(|p| p.text.as_str()).collect::<String>(), "And forgive us our debts, as we also have forgiven our debtors.");
        // overlapping or missing words never break the verse
        let p = mark_parts("In the beginning God", &["beginning".into(), "begin".into(), "".into(), "absent".into()]);
        assert_eq!(p.iter().map(|x| x.text.as_str()).collect::<String>(), "In the beginning God");
        assert_eq!(p.iter().filter(|x| x.mark).count(), 1);
        assert_eq!(mark_parts("Plain.", &[]), vec![SamplePart { text: "Plain.".into(), mark: false }]);
    }

    /// A Bible added to the Library with Strong's numbers: its words are counted for an English word, and marked in its example verses.
    #[test]
    fn a_library_bible_is_used_for_original_words_and_examples() {
        let bible = rusqlite::Connection::open_in_memory().unwrap();
        bible
            .execute_batch(
                "CREATE TABLE books(id INTEGER PRIMARY KEY, name TEXT, order_index INTEGER);
                 CREATE TABLE strongs_dict(strongs_number TEXT, lemma TEXT, xlit TEXT, strongs_def TEXT);
                 INSERT INTO books VALUES (1, 'Genesis', 1), (43, 'John', 43);
                 INSERT INTO strongs_dict VALUES ('G26', 'ἀγάπη', NULL, 'love'), ('G25', 'ἀγαπάω', NULL, 'to love'), ('G3588', 'ὁ', NULL, 'the');",
            )
            .unwrap();
        let lib = rusqlite::Connection::open_in_memory().unwrap();
        lib.execute_batch("CREATE TABLE lib_verses(id INTEGER PRIMARY KEY, module TEXT, book TEXT, chapter INT, verse INT, text TEXT, red TEXT, words TEXT);").unwrap();
        for (book, c, v, text, words) in [
            ("John", 3, 16, "For God so loved the world.", r#"[["so",["G3779"]],["loved",["G25"]],["the",["G3588"]],["world",["G2889"]]]"#),
            ("John", 13, 34, "Love one another.", r#"[["Love",["G25"]],["another",["G240"]]]"#),
            ("John", 15, 13, "Greater love has no one.", r#"[["love",["G26"]]]"#),
            ("Genesis", 1, 1, "In the beginning.", "null"),
        ] {
            lib.execute("INSERT INTO lib_verses(module, book, chapter, verse, text, words) VALUES ('TG', ?1, ?2, ?3, ?4, ?5)", params![book, c, v, text, if words == "null" { None } else { Some(words) }]).unwrap();
        }
        let found = library_original_words(&bible, &lib, "Love", "TG").unwrap();
        let numbers: Vec<(&str, i64)> = found.iter().map(|w| (w.strongs.as_str(), w.times)).collect();
        assert_eq!(numbers, vec![("G25", 2), ("G26", 1)], "counted from the Bible's own words, 'the' left out");
        assert!(library_original_words(&bible, &lib, "  ", "TG").unwrap().is_empty());

        // examples: the verse being read, with the word marked
        let samples = library_samples(&bible, &lib, "G25", &[43003016, 43013034], Some(43003016), "TG").unwrap();
        assert_eq!(samples.len(), 2);
        let first = &samples[0];
        assert_eq!((first.book.as_str(), first.chapter, first.verse), ("John", 3, 16));
        assert!(first.parts.iter().any(|p| p.mark && p.text == "loved"), "{:?}", first.parts);
        assert!(library_samples(&bible, &lib, "G25", &[1002002], None, "TG").is_err(), "a verse with no text is an error, not an empty list");
    }

    /// The real databases: the original words behind "love", a meaning's example verses with the word marked, and the cards.
    #[test]
    fn the_senses_work_on_the_real_files() {
        let res = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let (Ok(text), Ok(sil_text), true) = (std::fs::read_to_string(res.join("semantic_domains.json")), std::fs::read_to_string(res.join("semantic_sil.json")), res.join("bible.db").exists()) else { return };
        let d = Data::from_json(&text).unwrap();
        let sil = RawSil::from_json(&sil_text).unwrap();
        let bible = rusqlite::Connection::open_with_flags(res.join("bible.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();

        // "love" is translated from several Greek and Hebrew words, the Greek agape and agapao among them
        let love = original_words_in(&bible, "Love", "BSB").unwrap();
        let numbers: Vec<&str> = love.iter().map(|w| w.strongs.as_str()).collect();
        assert!(numbers.contains(&"G26") && numbers.contains(&"G25") && numbers.contains(&"H157"), "{numbers:?}");
        assert!(love.windows(2).all(|w| w[0].times >= w[1].times), "the most often first");
        assert!(original_words_in(&bible, "   ", "BSB").unwrap().is_empty());
        assert!(!original_words_in(&bible, "love", "NoSuchBible").unwrap().is_empty(), "a Bible that is not tagged falls back to the BSB");

        // forgive: the Greek word aphiemi has many senses, the pardon one used in Matthew 6:12, with the English word marked in the verse
        let (lemma, senses) = senses_of(&d.greek, Some(&sil), false, "G863", Some(40006012));
        assert!(!lemma.is_empty() && lemma.starts_with('ἀ'), "{lemma}");
        assert!(senses.len() >= 10, "{}", senses.len());
        let here = senses.iter().find(|s| s.here).expect("Matthew 6:12 is listed for one meaning");
        assert!(here.glosses.iter().any(|g| g.contains("forgive")), "{:?}", here.glosses);
        assert_eq!(here.sil.as_ref().map(|c| c.name.as_str()), Some("Forgive"));
        let verses = &d.greek.entries[here.entry].meanings[here.meaning].verses;
        let samples = samples_in(&bible, "G863", verses, Some(40006012), "BSB").unwrap();
        assert_eq!(samples.len(), 3);
        let matt = samples.iter().find(|s| s.book == "Matthew" && s.chapter == 6 && s.verse == 12).expect("the verse being read is shown");
        assert!(matt.parts.iter().any(|p| p.mark && p.text.contains("forgive")), "{:?}", matt.parts);

        // the Hebrew love word: its meaning gets a card and counts by book (all in the Old Testament)
        let (_, h) = senses_of(&d.hebrew, Some(&sil), true, "H157", None);
        let to_love = h.iter().find(|s| s.glosses.iter().any(|g| g == "to love")).unwrap();
        assert_eq!(to_love.sil.as_ref().map(|c| c.name.as_str()), Some("Love"));
        assert!(to_love.by_book[39..].iter().all(|n| *n == 0), "Hebrew words are in the Old Testament");
        // every Greek and Hebrew match in the file points at a domain the file holds
        assert!(sil.greek.values().chain(sil.hebrew.values()).all(|c| sil.domains.contains_key(c)));
    }

    #[test]
    fn a_broken_file_is_an_error_not_a_crash() {
        assert!(Data::from_json("not json").is_err());
        let state = SemanticState::new(PathBuf::from("does/not/exist.json"), PathBuf::from("does/not/exist-either.json"));
        assert!(state.get().is_err());
    }

    /// The real databases: the book counts, the verses with their words, and a Strong's number's counts agree with each other.
    #[test]
    fn the_searches_work_on_the_real_databases() {
        let res = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let (Ok(text), true, true) = (std::fs::read_to_string(res.join("semantic_domains.json")), res.join("bible.db").exists(), res.join("study.db").exists()) else { return };
        let d = Data::from_json(&text).unwrap();
        let bible = rusqlite::Connection::open_with_flags(res.join("bible.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let study = rusqlite::Connection::open_with_flags(res.join("study.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();

        // love (Greek): books have counts, John's verses come back with text and the words that put them there
        let love = d.greek.nodes.iter().find(|n| n.name == "Love, Affection, Compassion").unwrap();
        let r = concordance_of(&d.greek, &bible, &love.code, None, None).unwrap();
        assert_eq!(r.books.len(), 66);
        assert!(r.total_verses > 100, "{}", r.total_verses);
        assert!(r.books.iter().filter(|b| b.order_index < 40).all(|b| b.verses == 0), "the Greek words are all in the New Testament");
        let john = r.books.iter().find(|b| b.book == "John").unwrap();
        assert!(john.verses > 10);
        let hits = hits_of(&d.greek, &bible, "BSB", &love.code, None, None, Some("John")).unwrap();
        assert_eq!(hits.len() as i64, john.verses, "every verse the count promised comes back with its words");
        assert!(hits.iter().all(|h| h.book == "John" && !h.text.is_empty() && !h.why.is_empty()));
        assert!(hits.windows(2).all(|w| (w[0].chapter, w[0].verse) < (w[1].chapter, w[1].verse)), "in Bible order");
        // the whole Testament at once
        let all = hits_of(&d.greek, &bible, "BSB", &love.code, None, None, None).unwrap();
        assert!(all.len() as i64 >= r.total_verses * 99 / 100, "{} of {}", all.len(), r.total_verses);
        // the Hebrew side: love in the Old Testament, not the New
        let hl = d.hebrew.nodes.iter().find(|n| n.name == "Love").expect("a Hebrew group named Love");
        let hr = concordance_of(&d.hebrew, &bible, &hl.code, None, None).unwrap();
        assert!(hr.total_verses > 50 && hr.books.iter().filter(|b| b.order_index >= 40).all(|b| b.verses == 0));
        // a word in it, one meaning of it
        let (ei, _) = d.greek.entries.iter().enumerate().find(|(_, e)| e.strongs.contains(&"G26".to_string())).unwrap();
        let one = concordance_of(&d.greek, &bible, "025", Some(ei), None).unwrap();
        assert!(one.total_verses > 50 && one.total_verses <= 116 + 20, "agape is used about 116 times: {}", one.total_verses);

        // by Strong's number: G26 (agape) is used 116 times in the Greek New Testament
        let s = strongs_counts(&study, &bible, "G26").unwrap();
        assert!((100..=130).contains(&s.total_occurrences), "{}", s.total_occurrences);
        assert!(s.total_verses <= s.total_occurrences && s.books.iter().filter(|b| b.order_index < 40).all(|b| b.occurrences == 0));
        let v = strongs_hits(&study, &bible, "BSB", "G26", &FrequencyScope::Book { book: "1 John".into() }).unwrap();
        assert_eq!(v.len() as i64, s.books.iter().find(|b| b.book == "1 John").unwrap().verses);
        assert!(v.iter().all(|h| h.book == "1 John" && !h.text.is_empty()));
        let nt = strongs_hits(&study, &bible, "BSB", "G26", &FrequencyScope::Testament { testament: "NT".into() }).unwrap();
        assert_eq!(nt.len() as i64, s.total_verses);
        assert_eq!(strongs_counts(&study, &bible, "G99999").unwrap().total_occurrences, 0);
    }

    /// The real data file: love is where it should be, the counts are big, and the verses are in the right Testament.
    #[test]
    fn the_real_file_loads() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/semantic_domains.json");
        let Ok(text) = std::fs::read_to_string(&path) else { return };
        let d = Data::from_json(&text).unwrap();
        assert!(d.greek.entries.len() > 5000 && d.hebrew.entries.len() > 7000);
        assert!(d.greek.nodes.iter().any(|n| n.level == 1 && n.name.starts_with("Attitudes")));
        let love = d.greek.nodes.iter().find(|n| n.name == "Love, Affection, Compassion").expect("a group about love");
        assert!(love.words >= 3 && love.verses > 50, "{love:?}");
        for (lang, lo, hi) in [(&d.greek, 40, 66), (&d.hebrew, 1, 39)] {
            for e in &lang.entries {
                for m in &e.meanings {
                    assert!(m.verses.windows(2).all(|w| w[0] < w[1]), "sorted, no repeats");
                    assert!(m.verses.iter().all(|v| (lo..=hi).contains(&(v / 1_000_000))));
                }
            }
        }
    }
}
