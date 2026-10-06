//! Original-language search: every occurrence of a Hebrew or Greek word in the bundled
//! interlinear (STEPBible TAHOT/TAGNT in study.db), narrowed by its grammar -- "every
//! aorist passive of ἀγαπάω", "Hiphil forms of בָּרָא". The grammar filters aren't a fixed
//! list: each occurrence's morphology code is spelled out from the `morph_codes` table
//! ("Function=Verb; Tense=Aorist; Voice=Passive; ..."), and the filters offered are the
//! features that actually occur for the chosen word, with counts (facets).

use std::collections::{BTreeMap, HashMap};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::study::StudyState;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// "G0025" / "g25" / "H1254a" -> the app's format "G25" / "H1254" (None if it isn't one).
pub fn normalize_strongs(s: &str) -> Option<String> {
    let s = s.trim();
    let mut chars = s.chars();
    let lang = chars.next()?.to_ascii_uppercase();
    if lang != 'G' && lang != 'H' {
        return None;
    }
    let digits: String = chars.clone().take_while(|c| c.is_ascii_digit()).collect();
    let rest: String = chars.skip(digits.len()).collect();
    if digits.is_empty() || rest.chars().count() > 1 || !rest.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let n: u32 = digits.parse().ok()?;
    Some(format!("{lang}{n}"))
}

/// Greek and Hebrew without accents, breathings and vowel points, lower-cased -- so
/// "αγαπαω" finds ἀγαπάω and "ברא" finds בָּרָא.
pub fn fold(s: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    s.nfd()
        .filter(|c| {
            let u = *c as u32;
            // combining diacritics; Hebrew points and cantillation (U+0591-U+05C7)
            !(0x0300..=0x036F).contains(&u) && !(0x0591..=0x05C7).contains(&u) && *c != '/'
        })
        .collect::<String>()
        .to_lowercase()
        .replace('ς', "σ")
}

#[derive(Serialize, Clone, Debug)]
pub struct WordCandidate {
    pub strongs: String,
    pub lemma: String,
    pub gloss: String,
    /// "Greek" or "Hebrew" (Aramaic words are in the Hebrew Strong's range)
    pub language: String,
    pub count: i64,
}

/// Words matching what the reader typed: a Strong's number, the Greek/Hebrew word (accents
/// optional), or an English meaning. Most frequent first.
pub fn lookup(conn: &Connection, query: &str, limit: usize) -> Result<Vec<WordCandidate>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    // lemma key -> (lemma, gloss); keys look like "G0025", "H1254A"
    let mut keys: Vec<String> = Vec::new();
    if let Some(s) = normalize_strongs(q) {
        // its lemma keys ("G0025", "H1254A", "H1254B"...), most frequent first
        let mut stmt = conn.prepare("SELECT lemma_key FROM interlinear WHERE strongs = ?1 GROUP BY lemma_key ORDER BY COUNT(*) DESC").map_err(err)?;
        keys = stmt.query_map(params![s], |r| r.get(0)).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    } else {
        let fq = fold(q);
        let english = q.chars().all(|c| c.is_ascii());
        let mut stmt = conn.prepare("SELECT key, lemma, gloss FROM lemmas").map_err(err)?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))).map_err(err)?;
        for row in rows {
            let (key, lemma, gloss) = row.map_err(err)?;
            let hit = if english {
                // whole word inside the gloss: "love" finds "to love" and "love, beloved", not "glove"
                let g = gloss.to_lowercase();
                g.split(|c: char| !c.is_alphanumeric()).any(|w| w == fq)
            } else {
                fold(&lemma).starts_with(&fq)
            };
            if hit {
                keys.push(key);
            }
        }
    }
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    // Group by the app's Strong's number ("G0025"/"H1254A" -> "G25"/"H1254"), counted via
    // the strongs index (study.db has none on lemma_key, and it's read-only).
    let mut by_strongs: HashMap<String, WordCandidate> = HashMap::new();
    let mut lemma_stmt = conn.prepare("SELECT lemma, gloss FROM lemmas WHERE key = ?1").map_err(err)?;
    let mut count_stmt = conn.prepare("SELECT COUNT(*) FROM interlinear WHERE strongs = ?1").map_err(err)?;
    for key in keys.iter().take(400) {
        let Some(strongs) = normalize_strongs(key) else { continue };
        if by_strongs.contains_key(&strongs) {
            continue;
        }
        let (lemma, gloss): (String, String) = lemma_stmt.query_row(params![key], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(err)?.unwrap_or_default();
        let count: i64 = count_stmt.query_row(params![strongs], |r| r.get(0)).map_err(err)?;
        if count == 0 {
            continue;
        }
        by_strongs.insert(
            strongs.clone(),
            WordCandidate { language: if strongs.starts_with('G') { "Greek" } else { "Hebrew" }.into(), strongs, lemma, gloss, count },
        );
    }
    let mut out: Vec<WordCandidate> = by_strongs.into_values().collect();
    out.sort_by(|a, b| b.count.cmp(&a.count).then(a.strongs.cmp(&b.strongs)));
    out.truncate(limit);
    Ok(out)
}

/// "Function=Verb ; Stem=Qal (hence Action=Simple; Voice=Active); Form=Perfect (...)" ->
/// [("Function","Verb"), ("Stem","Qal"), ("Form","Perfect"), ...] -- the "(hence ...)"
/// explanations are dropped, and semicolons inside them don't split.
pub fn parse_formal(formal: &str) -> Vec<(String, String)> {
    let mut parts = Vec::new();
    let mut depth = 0;
    let mut cur = String::new();
    for c in formal.chars() {
        match c {
            '(' => {
                depth += 1;
                cur.push(c);
            }
            ')' => {
                depth -= 1;
                cur.push(c);
            }
            ';' if depth == 0 => parts.push(std::mem::take(&mut cur)),
            _ => cur.push(c),
        }
    }
    parts.push(cur);
    parts
        .into_iter()
        .filter_map(|p| {
            let (k, v) = p.split_once('=')?;
            let v = v.split(" (").next().unwrap_or(v).trim();
            let k = k.trim();
            (!k.is_empty() && !v.is_empty()).then(|| (k.to_string(), v.to_string()))
        })
        .collect()
}

/// The grammar of one word: the features of its main morpheme (for Hebrew, the verb/noun
/// itself, not a prefixed "and"/"the"/preposition or a pronoun suffix).
fn features(conn: &Connection, cache: &mut HashMap<String, Vec<(String, String)>>, morph: &str, greek: bool) -> Vec<(String, String)> {
    if let Some(f) = cache.get(morph) {
        return f.clone();
    }
    let lookup = |code: &str, lang: &str| -> Option<String> {
        conn.query_row("SELECT formal FROM morph_codes WHERE code = ?1 AND lang = ?2", params![code, lang], |r| r.get(0)).optional().ok().flatten()
    };
    let result = if greek {
        let code = morph.split(" + ").next().unwrap_or(morph).trim();
        lookup(code, "gr").map(|f| parse_formal(&f)).unwrap_or_default()
    } else {
        let segs: Vec<&str> = morph.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
        let lang_letter = segs.first().and_then(|s| s.chars().next()).filter(|c| *c == 'H' || *c == 'A');
        let mut best: Vec<(String, String)> = Vec::new();
        for (i, seg) in segs.iter().enumerate() {
            let mut candidates = vec![seg.to_string()];
            if i > 0 {
                if let Some(l) = lang_letter {
                    candidates.push(format!("{l}{seg}"));
                }
            }
            let Some(f) = candidates.iter().find_map(|c| lookup(c, "he")) else { continue };
            let feats = parse_formal(&f);
            let function = feats.iter().find(|(k, _)| k == "Function").map(|(_, v)| v.as_str()).unwrap_or("");
            let minor = matches!(function, "Conjunction" | "Preposition" | "Particle" | "Suffix");
            if best.is_empty() || !minor {
                best = feats;
                if !minor {
                    break;
                }
            }
        }
        best
    };
    cache.insert(morph.to_string(), result.clone());
    result
}

/// Facet order: Greek, then Hebrew grammar categories; anything else after.
const FACET_ORDER: [&str; 12] = ["Function", "Tense", "Voice", "Mood", "Stem", "Form", "Person", "Gender", "Number", "Case", "State", "Extra"];

#[derive(Serialize, Clone, Debug)]
pub struct Facet {
    pub key: String,
    pub values: Vec<(String, usize)>,
}

#[derive(Serialize, Clone, Debug)]
pub struct OriginalHit {
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub original: String,
    pub translit: String,
    pub gloss: String,
    /// the word's grammar in words, e.g. "Aorist Passive Indicative 3rd Singular"
    pub parsing: String,
    /// the verse in the BSB (filled in by the command)
    pub text: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct OriginalSearchResult {
    pub word: Option<WordCandidate>,
    /// occurrences of the word at all
    pub total: usize,
    /// occurrences matching the grammar filters
    pub matched: usize,
    pub facets: Vec<Facet>,
    pub by_book: Vec<(String, usize)>,
    /// the first `limit` matches, in Bible order
    pub hits: Vec<OriginalHit>,
}

pub fn search(conn: &Connection, strongs: &str, filters: &BTreeMap<String, String>, limit: usize) -> Result<OriginalSearchResult, String> {
    let strongs = normalize_strongs(strongs).ok_or("Not a Strong's number")?;
    let greek = strongs.starts_with('G');
    let word = lookup(conn, &strongs, 1)?.into_iter().next();
    let mut stmt = conn
        .prepare(
            "SELECT book, chapter, verse, original, translit, gloss, morph, word_type FROM interlinear
             WHERE strongs = ?1 ORDER BY id",
        )
        .map_err(err)?;
    let rows: Vec<(String, i64, i64, String, String, String, String, String)> = stmt
        .query_map(params![strongs], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    let mut cache = HashMap::new();
    let mut facet_counts: BTreeMap<String, BTreeMap<String, usize>> = BTreeMap::new();
    let mut by_book: Vec<(String, usize)> = Vec::new();
    let (mut total, mut matched) = (0usize, 0usize);
    let mut hits = Vec::new();
    for (book, chapter, verse, original, translit, gloss, morph, word_type) in rows {
        // Hebrew ketiv ("as written") rows duplicate their qere ("as read"); count the qere
        if !greek && word_type.starts_with(['K', 'k']) {
            continue;
        }
        total += 1;
        let feats = features(conn, &mut cache, &morph, greek);
        let has = |k: &str, v: &str| feats.iter().any(|(fk, fv)| fk == k && fv == v);
        let fails: Vec<&String> = filters.iter().filter(|(k, v)| !has(k, v)).map(|(k, _)| k).collect();
        // a facet counts the occurrences that pass every *other* filter, so its values can be switched
        for (k, v) in &feats {
            if fails.is_empty() || (fails.len() == 1 && fails[0] == k) {
                *facet_counts.entry(k.clone()).or_default().entry(v.clone()).or_default() += 1;
            }
        }
        if !fails.is_empty() {
            continue;
        }
        matched += 1;
        match by_book.last_mut() {
            Some((b, n)) if *b == book => *n += 1,
            _ => by_book.push((book.clone(), 1)),
        }
        if hits.len() < limit {
            let parsing = feats.iter().filter(|(k, _)| k != "Function" || feats.len() == 1).map(|(_, v)| v.as_str()).collect::<Vec<_>>().join(" ");
            hits.push(OriginalHit {
                book,
                chapter,
                verse,
                original: original.replace('/', ""),
                translit: translit.replace('/', ""),
                gloss: gloss.replace(['<', '>'], "").replace('/', " "),
                parsing,
                text: String::new(),
            });
        }
    }
    let mut facets: Vec<Facet> = facet_counts
        .into_iter()
        .map(|(key, vals)| {
            let mut values: Vec<(String, usize)> = vals.into_iter().collect();
            values.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
            Facet { key, values }
        })
        .filter(|f| f.values.len() > 1 || filters.contains_key(&f.key))
        .collect();
    facets.sort_by_key(|f| FACET_ORDER.iter().position(|k| *k == f.key).unwrap_or(99));
    Ok(OriginalSearchResult { word, total, matched, facets, by_book, hits })
}

// ---------------------------------------------------------------- commands

fn study_conn<'a>(state: &'a State<StudyState>) -> Result<std::sync::MutexGuard<'a, Connection>, String> {
    state
        .0
        .as_ref()
        .ok_or_else(|| "The interlinear data (study.db) isn't included in this build.".to_string())?
        .lock()
        .map_err(err)
}

#[tauri::command]
pub fn original_word_lookup(state: State<StudyState>, query: String, limit: usize) -> Result<Vec<WordCandidate>, String> {
    lookup(&*study_conn(&state)?, &query, limit)
}

#[tauri::command]
pub fn original_word_search(
    state: State<StudyState>,
    db: State<DbState>,
    strongs: String,
    filters: BTreeMap<String, String>,
    limit: usize,
) -> Result<OriginalSearchResult, String> {
    let mut result = search(&*study_conn(&state)?, &strongs, &filters, limit)?;
    // each hit's verse in the BSB, for reading the word in context
    let d = db.0.lock().map_err(err)?;
    let mut stmt = d
        .prepare(
            "SELECT v.text FROM verses v JOIN books b ON b.id = v.book_id JOIN versions x ON x.id = v.version_id
             WHERE x.code = 'BSB' AND b.name = ?1 AND v.chapter = ?2 AND v.verse = ?3",
        )
        .map_err(err)?;
    for h in &mut result.hits {
        h.text = stmt.query_row(params![h.book, h.chapter, h.verse], |r| r.get(0)).optional().map_err(err)?.unwrap_or_default();
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strongs_and_folding() {
        assert_eq!(normalize_strongs("g0025").as_deref(), Some("G25"));
        assert_eq!(normalize_strongs("H1254A").as_deref(), Some("H1254"));
        assert_eq!(normalize_strongs("love"), None);
        assert_eq!(fold("ἀγαπάω"), "αγαπαω");
        assert_eq!(fold("בָּרָא"), "ברא");
    }

    #[test]
    fn formal_parsing() {
        let f = parse_formal("Function=Verb ; Stem=Qal (hence Action=Simple; Voice=Active); Form=Perfect (hence Tense=Past/present; Mood=Indicative); Person=Third; Gender=Masculine; Number=Singular");
        assert_eq!(f, vec![
            ("Function".into(), "Verb".into()),
            ("Stem".into(), "Qal".into()),
            ("Form".into(), "Perfect".into()),
            ("Person".into(), "Third".into()),
            ("Gender".into(), "Masculine".into()),
            ("Number".into(), "Singular".into()),
        ]);
    }

    /// Against the real study.db: ἀγαπάω (G25) and its aorist passives; בָּרָא (H1254).
    #[test]
    fn real_searches() {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("study.db");
        if !path.is_file() {
            return;
        }
        let conn = Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let love = lookup(&conn, "love", 5).unwrap();
        assert!(love.iter().any(|w| w.strongs == "G25"), "{love:?}");
        let greek = lookup(&conn, "αγαπαω", 3).unwrap();
        assert_eq!(greek[0].strongs, "G25");
        let all = search(&conn, "G25", &BTreeMap::new(), 10).unwrap();
        assert!(all.total > 130 && all.total == all.matched);
        assert!(all.facets.iter().any(|f| f.key == "Tense"), "{:?}", all.facets);
        let mut f = BTreeMap::new();
        f.insert("Tense".to_string(), "Aorist".to_string());
        f.insert("Voice".to_string(), "Active".to_string());
        let aorist = search(&conn, "G25", &f, 100).unwrap();
        assert!(aorist.matched > 0 && aorist.matched < all.total);
        assert!(aorist.hits.iter().any(|h| h.book == "John" && h.chapter == 3 && h.verse == 16), "John 3:16 ἠγάπησεν is aorist active");
        let bara = search(&conn, "H1254", &BTreeMap::new(), 5).unwrap();
        assert!(bara.facets.iter().any(|f| f.key == "Stem" && f.values.iter().any(|(v, _)| v == "Qal")), "{:?}", bara.facets);
        println!("G25 {} total, aorist active {}; H1254 {} total; facets {:?}", all.total, aorist.matched, bara.total, bara.facets);
    }
}
