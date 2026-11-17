//! Search by meaning: the words of the Bible grouped by what they mean (love, forgiveness, joy...), Hebrew and Greek, from the UBS open-licence
//! dictionaries (UBS Dictionary of Biblical Hebrew; UBS Dictionary of the Greek New Testament, adapted from Louw and Nida; CC BY-SA 4.0), kept in
//! resources/semantic_domains.json by scripts/build_semantic_domains.mts. The file is read the first time it is needed. A group of meanings is a code
//! of three-digit steps ("025" is a domain, "025003" a sub-domain; Hebrew goes four levels: "002001002018"); the verses where a meaning is used come
//! packed as a first number and the steps between the rest (src/semantic.ts has the same packing). Also here: the Concordance's "by Strong's number".

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;
use std::sync::OnceLock;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::DbState;
use crate::models::{ConcordanceBook, ConcordanceResult, FrequencyScope, SearchHit};
use crate::study::StudyState;

#[derive(Deserialize)]
struct RawFile {
    greek: RawLang,
    hebrew: RawLang,
}

#[derive(Deserialize)]
struct RawLang {
    domains: Vec<(String, String)>,
    entries: Vec<RawEntry>,
}

#[derive(Deserialize)]
struct RawEntry {
    s: Vec<String>,
    l: String,
    m: Vec<RawMeaning>,
}

#[derive(Deserialize)]
struct RawMeaning {
    d: Vec<String>,
    g: Vec<String>,
    t: String,
    #[serde(default)]
    c: Option<String>,
    v: Vec<u32>,
}

struct Meaning {
    domains: Vec<String>,
    glosses: Vec<String>,
    definition: String,
    ln: Option<String>,
    /// sorted verse numbers (book * 1,000,000 + chapter * 1,000 + verse)
    verses: Vec<u32>,
}

struct Entry {
    strongs: Vec<String>,
    lemma: String,
    meanings: Vec<Meaning>,
}

struct Lang {
    names: HashMap<String, String>,
    entries: Vec<Entry>,
    nodes: Vec<DomainNode>,
}

pub struct Data {
    greek: Lang,
    hebrew: Lang,
}

/// A group of meanings in the tree, with how many words and verses are inside it (the groups under it included).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct DomainNode {
    pub code: String,
    pub name: String,
    /// 1 for a domain, 2 for a sub-domain... (the code's length over three)
    pub level: usize,
    pub words: usize,
    pub verses: usize,
}

/// One meaning of one word, for the list of words inside a group.
#[derive(Serialize, Clone, Debug)]
pub struct MeaningWord {
    pub entry: usize,
    pub meaning: usize,
    pub strongs: Vec<String>,
    pub lemma: String,
    pub glosses: Vec<String>,
    pub definition: String,
    /// the Louw-Nida number of a Greek meaning
    pub ln: Option<String>,
    pub verses: usize,
}

/// What a word means in a verse, or everywhere it is used when the verse is not known to the dictionary.
#[derive(Serialize, Clone, Debug)]
pub struct WordMeaning {
    pub lemma: String,
    pub glosses: Vec<String>,
    pub definition: String,
    pub ln: Option<String>,
    /// "Attitudes and Emotions > Love, Affection, Compassion" for each group the meaning is in
    pub groups: Vec<String>,
    /// the dictionary lists this verse for this meaning
    pub here: bool,
}

pub struct SemanticState {
    path: PathBuf,
    data: OnceLock<Result<Data, String>>,
}

impl SemanticState {
    pub fn new(path: PathBuf) -> Self {
        Self { path, data: OnceLock::new() }
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

fn unpack(packed: &[u32]) -> Vec<u32> {
    let mut at = 0u32;
    packed
        .iter()
        .enumerate()
        .map(|(i, n)| {
            at = if i == 0 { *n } else { at + n };
            at
        })
        .collect()
}

fn parent(code: &str) -> &str {
    if code.len() > 3 {
        &code[..code.len() - 3]
    } else {
        ""
    }
}

impl Lang {
    fn new(raw: RawLang) -> Lang {
        let names: HashMap<String, String> = raw.domains.into_iter().collect();
        let entries: Vec<Entry> = raw
            .entries
            .into_iter()
            .map(|e| Entry {
                strongs: e.s,
                lemma: e.l,
                meanings: e.m.into_iter().map(|m| Meaning { domains: m.d, glosses: m.g, definition: m.t, ln: m.c, verses: unpack(&m.v) }).collect(),
            })
            .collect();
        // for every group and the groups above it: the words and verses inside
        let mut inside: HashMap<&str, (HashSet<usize>, HashSet<u32>)> = HashMap::new();
        for (ei, e) in entries.iter().enumerate() {
            for m in &e.meanings {
                for code in &m.domains {
                    let mut c: &str = code;
                    while !c.is_empty() {
                        let slot = inside.entry(c).or_default();
                        slot.0.insert(ei);
                        slot.1.extend(m.verses.iter().copied());
                        c = parent(c);
                    }
                }
            }
        }
        let mut nodes: Vec<DomainNode> = names
            .iter()
            .filter_map(|(code, name)| {
                let (w, v) = inside.get(code.as_str())?;
                Some(DomainNode { code: code.clone(), name: name.clone(), level: (code.len() / 3).max(1), words: w.len(), verses: v.len() })
            })
            .collect();
        nodes.sort_by(|a, b| a.code.cmp(&b.code));
        Lang { names, entries, nodes }
    }

    /// "Attitudes and Emotions > Love, Affection, Compassion"
    fn path_of(&self, code: &str) -> String {
        let mut parts: Vec<&str> = Vec::new();
        let mut c = code;
        while !c.is_empty() {
            parts.push(self.names.get(c).map(|s| s.as_str()).unwrap_or(c));
            c = parent(c);
        }
        parts.reverse();
        parts.join(" > ")
    }

    /// The verses of a group, or of one word in it, or of one meaning of one word; each with the words that put it there.
    fn select(&self, code: &str, entry: Option<usize>, meaning: Option<usize>) -> BTreeMap<u32, Vec<String>> {
        let mut out: BTreeMap<u32, Vec<String>> = BTreeMap::new();
        for (ei, e) in self.entries.iter().enumerate() {
            if entry.is_some_and(|x| x != ei) {
                continue;
            }
            for (mi, m) in e.meanings.iter().enumerate() {
                if meaning.is_some_and(|x| x != mi) {
                    continue;
                }
                if !m.domains.iter().any(|d| d.starts_with(code)) {
                    continue;
                }
                let label = match m.glosses.first() {
                    Some(g) => format!("{} ({})", e.lemma, g),
                    None => e.lemma.clone(),
                };
                for v in &m.verses {
                    let slot = out.entry(*v).or_default();
                    if !slot.contains(&label) {
                        slot.push(label.clone());
                    }
                }
            }
        }
        out
    }
}

impl Data {
    pub fn from_json(text: &str) -> Result<Data, String> {
        let raw: RawFile = serde_json::from_str(text).map_err(|e| format!("The meanings file could not be read: {e}"))?;
        Ok(Data { greek: Lang::new(raw.greek), hebrew: Lang::new(raw.hebrew) })
    }

    fn lang(&self, language: &str) -> Result<&Lang, String> {
        match language {
            "greek" => Ok(&self.greek),
            "hebrew" => Ok(&self.hebrew),
            _ => Err("Choose Greek or Hebrew.".into()),
        }
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
pub fn semantic_words(state: State<SemanticState>, language: String, code: String) -> Result<Vec<MeaningWord>, String> {
    let lang = state.get()?.lang(&language)?;
    let mut out = Vec::new();
    for (ei, e) in lang.entries.iter().enumerate() {
        for (mi, m) in e.meanings.iter().enumerate() {
            if m.domains.iter().any(|d| d.starts_with(&code)) {
                out.push(MeaningWord { entry: ei, meaning: mi, strongs: e.strongs.clone(), lemma: e.lemma.clone(), glosses: m.glosses.clone(), definition: m.definition.clone(), ln: m.ln.clone(), verses: m.verses.len() });
            }
        }
    }
    out.sort_by(|a, b| b.verses.cmp(&a.verses).then(a.lemma.cmp(&b.lemma)));
    out.truncate(600);
    Ok(out)
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

/// A Strong's number as the app writes it ("G0026" and "g26" are "G26"); None for anything that is not one.
pub fn norm_strongs(raw: &str) -> Option<String> {
    let t = raw.trim();
    let mut chars = t.chars();
    let letter = chars.next()?.to_ascii_uppercase();
    if letter != 'G' && letter != 'H' {
        return None;
    }
    let digits: String = chars.take_while(|c| c.is_ascii_digit()).collect();
    let n: u32 = digits.parse().ok()?;
    (n > 0 && n < 100_000).then(|| format!("{letter}{n}"))
}

/// What a word means where it is used: the dictionary's meanings of a Strong's number, those listed for this verse first and marked "here".
#[tauri::command]
pub fn semantic_word_meanings(state: State<SemanticState>, db: State<DbState>, strongs: String, book: Option<String>, chapter: Option<i64>, verse: Option<i64>) -> Result<Vec<WordMeaning>, String> {
    let Some(s) = norm_strongs(&strongs) else { return Ok(Vec::new()) };
    let data = state.get()?;
    let lang = if s.starts_with('G') { &data.greek } else { &data.hebrew };
    let key: Option<u32> = match (book, chapter, verse) {
        (Some(b), Some(c), Some(v)) => {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            let order: Option<i64> = conn.query_row("SELECT order_index FROM books WHERE name = ?1", params![b], |r| r.get(0)).ok();
            order.map(|o| (o * 1_000_000 + c * 1_000 + v) as u32)
        }
        _ => None,
    };
    let mut out = Vec::new();
    for e in lang.entries.iter().filter(|e| e.strongs.contains(&s)) {
        for m in &e.meanings {
            out.push(WordMeaning {
                lemma: e.lemma.clone(),
                glosses: m.glosses.clone(),
                definition: m.definition.clone(),
                ln: m.ln.clone(),
                groups: m.domains.iter().map(|d| lang.path_of(d)).collect(),
                here: key.is_some_and(|k| m.verses.binary_search(&k).is_ok()),
            });
        }
    }
    out.sort_by_key(|m| !m.here);
    Ok(out)
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

    #[test]
    fn a_broken_file_is_an_error_not_a_crash() {
        assert!(Data::from_json("not json").is_err());
        let state = SemanticState::new(PathBuf::from("does/not/exist.json"));
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
