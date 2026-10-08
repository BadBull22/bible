//! Finding the Scripture for the sermon builder.
//!
//! The reader types a subject ("healing"), a phrase ("your faith has healed you") or a
//! sentence, and expects the passages a preacher would reach for -- all of them, not a
//! sample. One search can't do that, so several are combined, and each hit records why it
//! was found:
//!
//!   * "core"    a checked list of the central passages for major subjects (`CORE`), so
//!               that e.g. the gifts of the Spirit come back as the whole list;
//!   * "phrase"  the exact words typed, in any bundled translation (so the King James
//!               wording finds the verse too);
//!   * "words"   every word of the subject, in any of its forms (heal / healed / healing);
//!   * "topical" every verse Nave's and Torrey's topical Bibles list under the subject;
//!   * "some"    most of the words, for longer sentences.
//!
//! Search by meaning (the embedding search) is added by the page on top of these.

use std::collections::{HashMap, HashSet};

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::study::StudyState;

#[derive(Serialize, Clone, Debug)]
pub struct VerseHit {
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub verse_end: i64,
    pub score: f64,
    /// "core" | "phrase" | "words" | "topical" | "some"
    pub why: Vec<&'static str>,
    /// BSB text of the passage
    pub text: String,
}

type Passage = (&'static str, i64, i64, i64);

/// The central passages for subjects preachers ask for most. Each list was written out by
/// hand and is checked against the bundled text by the tests below (every passage must
/// exist). They are a starting point the preacher ticks from, not a statement of doctrine.
const CORE: &[(&[&str], &[Passage])] = &[
    (&["healing", "heal", "healed", "divine healing", "sickness"], &[
        ("Exodus", 15, 26, 26), ("Psalms", 103, 2, 3), ("Psalms", 107, 19, 20), ("Isaiah", 53, 4, 5), ("Jeremiah", 17, 14, 14),
        ("Matthew", 8, 16, 17), ("Matthew", 9, 35, 35), ("Mark", 5, 25, 34), ("Mark", 10, 46, 52), ("Luke", 17, 11, 19),
        ("Mark", 16, 17, 18), ("Acts", 3, 1, 16), ("James", 5, 14, 16), ("1 Peter", 2, 24, 24),
    ]),
    (&["gifts of the spirit", "spiritual gifts", "gifts of the holy spirit", "gifts"], &[
        ("1 Corinthians", 12, 1, 11), ("1 Corinthians", 12, 27, 31), ("Romans", 12, 6, 8), ("Ephesians", 4, 11, 13),
        ("1 Peter", 4, 10, 11), ("1 Corinthians", 13, 1, 3), ("1 Corinthians", 13, 8, 10), ("1 Corinthians", 14, 1, 5),
        ("1 Corinthians", 14, 26, 33), ("Acts", 2, 1, 4), ("Mark", 16, 17, 18), ("Hebrews", 2, 4, 4), ("Joel", 2, 28, 29),
    ]),
    (&["baptism in the holy spirit", "baptism of the holy spirit", "baptism with the holy spirit", "spirit baptism", "filled with the spirit"], &[
        ("Joel", 2, 28, 29), ("Matthew", 3, 11, 11), ("Luke", 11, 13, 13), ("John", 7, 37, 39), ("Acts", 1, 4, 8), ("Acts", 2, 1, 4),
        ("Acts", 2, 38, 39), ("Acts", 8, 14, 17), ("Acts", 10, 44, 48), ("Acts", 19, 1, 7), ("Ephesians", 5, 18, 18),
    ]),
    (&["holy spirit", "the spirit", "holy ghost"], &[
        ("John", 14, 16, 17), ("John", 14, 26, 26), ("John", 16, 7, 15), ("Acts", 1, 8, 8), ("Romans", 8, 9, 16),
        ("Galatians", 5, 16, 25), ("1 Corinthians", 6, 19, 19), ("Ephesians", 5, 18, 18),
    ]),
    (&["faith", "believe", "believing"], &[
        ("Habakkuk", 2, 4, 4), ("Matthew", 17, 20, 20), ("Mark", 11, 22, 24), ("Romans", 1, 17, 17), ("Romans", 5, 1, 1),
        ("Romans", 10, 17, 17), ("2 Corinthians", 5, 7, 7), ("Galatians", 2, 20, 20), ("Ephesians", 2, 8, 9),
        ("Hebrews", 11, 1, 6), ("James", 2, 14, 26),
    ]),
    (&["salvation", "saved", "being saved", "how to be saved"], &[
        ("John", 3, 16, 18), ("John", 14, 6, 6), ("Acts", 4, 12, 12), ("Acts", 16, 30, 31), ("Romans", 3, 23, 24),
        ("Romans", 6, 23, 23), ("Romans", 10, 9, 13), ("2 Corinthians", 5, 17, 17), ("Ephesians", 2, 8, 9), ("Titus", 3, 4, 7),
    ]),
    (&["born again", "new birth", "regeneration"], &[
        ("Ezekiel", 36, 26, 27), ("John", 1, 12, 13), ("John", 3, 1, 8), ("2 Corinthians", 5, 17, 17), ("Titus", 3, 5, 5), ("1 Peter", 1, 23, 23),
    ]),
    (&["forgiveness", "forgive", "forgiving", "forgiven"], &[
        ("Psalms", 32, 1, 5), ("Psalms", 103, 10, 12), ("Isaiah", 1, 18, 18), ("Micah", 7, 18, 19), ("Matthew", 6, 12, 15),
        ("Matthew", 18, 21, 35), ("Luke", 23, 34, 34), ("Ephesians", 4, 31, 32), ("Colossians", 3, 13, 13), ("1 John", 1, 9, 9),
    ]),
    (&["sin"], &[
        ("Genesis", 3, 1, 7), ("Psalms", 51, 1, 5), ("Isaiah", 59, 1, 2), ("Romans", 3, 23, 23), ("Romans", 5, 12, 12),
        ("Romans", 6, 23, 23), ("James", 1, 14, 15), ("1 John", 1, 8, 10),
    ]),
    (&["repentance", "repent"], &[
        ("2 Chronicles", 7, 14, 14), ("Luke", 13, 3, 3), ("Luke", 15, 7, 7), ("Acts", 2, 38, 38), ("Acts", 3, 19, 19),
        ("2 Corinthians", 7, 10, 10), ("2 Peter", 3, 9, 9), ("1 John", 1, 9, 9),
    ]),
    (&["grace"], &[
        ("John", 1, 14, 17), ("Romans", 3, 24, 24), ("Romans", 5, 20, 21), ("2 Corinthians", 12, 9, 9), ("Ephesians", 2, 8, 9),
        ("Titus", 2, 11, 12), ("Hebrews", 4, 16, 16),
    ]),
    (&["love", "love of god", "god's love"], &[
        ("Matthew", 22, 37, 40), ("John", 3, 16, 16), ("John", 13, 34, 35), ("John", 15, 12, 13), ("Romans", 5, 8, 8),
        ("Romans", 8, 35, 39), ("1 Corinthians", 13, 1, 13), ("1 John", 4, 7, 12),
    ]),
    (&["prayer", "pray", "praying"], &[
        ("Jeremiah", 33, 3, 3), ("Matthew", 6, 5, 13), ("Matthew", 7, 7, 11), ("Mark", 11, 24, 24), ("Luke", 18, 1, 8),
        ("Philippians", 4, 6, 7), ("1 Thessalonians", 5, 17, 17), ("James", 5, 16, 16), ("1 John", 5, 14, 15),
    ]),
    (&["resurrection", "risen", "easter", "empty tomb"], &[
        ("Matthew", 28, 1, 10), ("Luke", 24, 1, 12), ("John", 11, 25, 26), ("Romans", 6, 4, 5), ("Romans", 8, 11, 11),
        ("1 Corinthians", 15, 1, 8), ("1 Corinthians", 15, 20, 23), ("1 Corinthians", 15, 50, 58), ("1 Peter", 1, 3, 3),
    ]),
    (&["crucifixion", "the cross", "cross", "good friday", "death of jesus", "death of christ"], &[
        ("Isaiah", 53, 3, 7), ("Matthew", 27, 27, 54), ("Luke", 23, 33, 46), ("John", 19, 16, 30), ("1 Corinthians", 1, 18, 18),
        ("Galatians", 2, 20, 20), ("Philippians", 2, 5, 8), ("Colossians", 2, 13, 15), ("1 Peter", 2, 24, 24),
    ]),
    (&["blood of jesus", "blood of christ", "the blood"], &[
        ("Exodus", 12, 13, 13), ("Leviticus", 17, 11, 11), ("Ephesians", 1, 7, 7), ("Hebrews", 9, 11, 14), ("Hebrews", 9, 22, 22),
        ("1 Peter", 1, 18, 19), ("1 John", 1, 7, 7), ("Revelation", 12, 11, 11),
    ]),
    (&["second coming", "rapture", "return of christ", "catching away", "coming of the lord"], &[
        ("Matthew", 24, 36, 44), ("John", 14, 1, 3), ("Acts", 1, 9, 11), ("1 Corinthians", 15, 51, 53), ("1 Thessalonians", 4, 13, 18),
        ("Titus", 2, 13, 13), ("Revelation", 1, 7, 7), ("Revelation", 22, 12, 12),
    ]),
    (&["water baptism", "baptism", "baptized"], &[
        ("Matthew", 3, 13, 17), ("Matthew", 28, 19, 19), ("Mark", 16, 16, 16), ("Acts", 2, 38, 38), ("Acts", 8, 36, 38),
        ("Romans", 6, 3, 4), ("Colossians", 2, 12, 12),
    ]),
    (&["spiritual warfare", "armour of god", "armor of god", "the devil", "resisting the devil"], &[
        ("Luke", 10, 19, 19), ("2 Corinthians", 10, 3, 5), ("Ephesians", 6, 10, 18), ("James", 4, 7, 7), ("1 Peter", 5, 8, 9),
        ("1 John", 4, 4, 4), ("Revelation", 12, 11, 11),
    ]),
    (&["worship", "praise"], &[
        ("Psalms", 95, 1, 7), ("Psalms", 100, 1, 5), ("Psalms", 150, 1, 6), ("John", 4, 23, 24), ("Romans", 12, 1, 1), ("Hebrews", 13, 15, 15),
    ]),
    (&["giving", "tithing", "tithe", "tithes", "generosity"], &[
        ("Proverbs", 3, 9, 10), ("Malachi", 3, 8, 10), ("Luke", 6, 38, 38), ("Acts", 20, 35, 35), ("2 Corinthians", 9, 6, 8),
    ]),
    (&["fear", "anxiety", "worry", "worrying"], &[
        ("Psalms", 23, 4, 4), ("Isaiah", 41, 10, 10), ("Matthew", 6, 25, 34), ("John", 14, 27, 27), ("Philippians", 4, 6, 7),
        ("2 Timothy", 1, 7, 7), ("1 Peter", 5, 7, 7),
    ]),
    (&["holiness", "sanctification", "holy living"], &[
        ("Romans", 12, 1, 2), ("2 Corinthians", 7, 1, 1), ("1 Thessalonians", 4, 3, 7), ("Hebrews", 12, 14, 14), ("1 Peter", 1, 15, 16),
    ]),
    (&["marriage", "husband and wife"], &[
        ("Genesis", 2, 18, 24), ("Proverbs", 18, 22, 22), ("Matthew", 19, 4, 6), ("1 Corinthians", 7, 1, 5), ("Ephesians", 5, 22, 33), ("Hebrews", 13, 4, 4),
    ]),
    (&["hope"], &[
        ("Psalms", 42, 11, 11), ("Jeremiah", 29, 11, 11), ("Lamentations", 3, 21, 24), ("Romans", 5, 1, 5), ("Romans", 15, 13, 13), ("Hebrews", 6, 19, 19), ("1 Peter", 1, 3, 3),
    ]),
    (&["peace"], &[
        ("Isaiah", 26, 3, 3), ("John", 14, 27, 27), ("John", 16, 33, 33), ("Romans", 5, 1, 1), ("Philippians", 4, 6, 7), ("Colossians", 3, 15, 15),
    ]),
    (&["joy"], &[
        ("Nehemiah", 8, 10, 10), ("Psalms", 16, 11, 11), ("Psalms", 30, 5, 5), ("John", 15, 11, 11), ("Romans", 15, 13, 13), ("Philippians", 4, 4, 4), ("James", 1, 2, 4),
    ]),
];

/// Words that say nothing about the subject.
const STOP: &[&str] = &[
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does", "for", "from", "had", "has", "have", "he", "her", "his", "how",
    "i", "if", "in", "into", "is", "it", "its", "me", "my", "no", "not", "of", "on", "or", "our", "shall", "she", "should", "so", "that", "the",
    "their", "them", "then", "there", "these", "they", "this", "to", "us", "was", "we", "were", "what", "when", "where", "which", "who", "why",
    "will", "with", "would", "you", "your", "about", "after", "all", "also", "any", "been", "being", "did", "get", "got", "him", "just", "more",
    "most", "must", "only", "over", "some", "than", "too", "very", "someone", "something",
];

/// Other words the Bible uses for a subject (as word beginnings): the search looks for any
/// of them wherever the typed word is wanted.
const ALSO: &[(&str, &[&str])] = &[
    ("heal", &["heal", "cure", "made whole", "made well"]),
    ("crucifixion", &["crucif"]),
    ("resurrection", &["resurrect", "risen", "raised from the dead"]),
    ("salvation", &["salvation", "saved", "savior"]),
    ("forgiv", &["forgiv", "pardon"]),
    ("gift", &["gift"]),
    ("worry", &["anxious", "worr"]),
    ("anxiety", &["anxious", "anxiet"]),
    ("rapture", &["caught up"]),
    ("tith", &["tithe", "tenth"]),
];

/// Where the 19th-century topical Bibles keep a subject asked for in today's words.
const TOPICAL_HEADINGS: &[(&str, &[&str])] = &[
    ("heal", &["disease", "diseases", "miracles of christ, the"]),
    ("sick", &["disease", "diseases", "afflictions"]),
    ("worry", &["care"]),
    ("anxiety", &["care"]),
    ("suffer", &["afflictions"]),
    ("cross", &["crucifixion", "atonement, the"]),
    ("crucifixion", &["atonement, the"]),
    ("rapture", &["second coming of christ, the"]),
    ("giv", &["liberality"]),
    ("tith", &["tithes"]),
    ("reviv", &["revivals"]),
];

/// A word reduced to the beginning its other forms share: healing, healed -> "heal".
pub fn stem(word: &str) -> String {
    let mut w = word.to_lowercase();
    let cut = |w: &mut String, suffix: &str, min: usize| {
        if w.ends_with(suffix) && w.len() - suffix.len() >= min {
            w.truncate(w.len() - suffix.len());
            true
        } else {
            false
        }
    };
    if w.len() <= 3 {
        return w;
    }
    cut(&mut w, "ness", 4);
    if cut(&mut w, "ies", 3) {
        w.push('y');
    } else if !cut(&mut w, "ing", 3) && !cut(&mut w, "ed", 3) && !w.ends_with("ss") {
        if !cut(&mut w, "es", 4) {
            cut(&mut w, "s", 3);
        }
    }
    // sinned -> sinn -> sin; forgive -> forgiv (so "forgiving", "forgave" aside, forms meet)
    let b = w.as_bytes();
    if b.len() > 3 && b[b.len() - 1] == b[b.len() - 2] && !matches!(b[b.len() - 1], b'l' | b's' | b'e' | b'o') {
        w.pop();
    }
    if w.len() > 4 && w.ends_with('e') {
        w.pop();
    }
    w
}

fn words_of(topic: &str) -> Vec<String> {
    topic.to_lowercase().split(|c: char| !(c.is_alphanumeric() || c == '\'')).filter(|w| !w.is_empty()).map(String::from).collect()
}

/// The stems that carry the subject's meaning, in the order typed.
pub fn key_stems(topic: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in words_of(topic) {
        if w.len() < 3 || STOP.contains(&w.as_str()) {
            continue;
        }
        let s = stem(&w);
        if !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

fn fts_term(prefix: &str) -> String {
    let clean: String = prefix.chars().filter(|c| c.is_alphanumeric() || *c == ' ' || *c == '\'').collect();
    if clean.contains(' ') {
        format!("\"{clean}\"")
    } else {
        format!("\"{clean}\"*")
    }
}

/// One stem as an FTS group: itself in any form, or any of the Bible's other words for it.
fn group(stem: &str) -> String {
    let also = ALSO.iter().find(|(k, _)| *k == stem).map(|(_, v)| *v).unwrap_or(&[]);
    let mut terms: Vec<String> = vec![fts_term(stem)];
    for a in also {
        let t = fts_term(a);
        if !terms.contains(&t) {
            terms.push(t);
        }
    }
    if terms.len() == 1 {
        terms.remove(0)
    } else {
        format!("({})", terms.join(" OR "))
    }
}

fn verse_matches(conn: &Connection, expr: &str, bsb_only: bool, limit: i64) -> Vec<(String, i64, i64)> {
    let sql = format!(
        "SELECT b.name, v.chapter, v.verse FROM verses_fts f JOIN verses v ON v.id = f.rowid JOIN books b ON b.id = v.book_id
         JOIN versions ver ON ver.id = v.version_id
         WHERE verses_fts MATCH ?1 AND b.testament IN ('OT','NT') AND {} ORDER BY f.rank LIMIT ?2",
        if bsb_only { "ver.code = 'BSB'" } else { "ver.is_original_language = 0" }
    );
    let Ok(mut stmt) = conn.prepare(&sql) else { return Vec::new() };
    let rows = stmt.query_map(params![expr, limit], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)));
    rows.map(|r| r.filter_map(Result::ok).collect()).unwrap_or_default()
}

fn passage_text(conn: &Connection, book: &str, chapter: i64, start: i64, end: i64) -> String {
    let Ok(mut stmt) = conn.prepare(
        "SELECT v.text FROM verses v JOIN books b ON b.id = v.book_id JOIN versions ver ON ver.id = v.version_id
         WHERE ver.code = 'BSB' AND b.name = ?1 AND v.chapter = ?2 AND v.verse BETWEEN ?3 AND ?4 ORDER BY v.verse",
    ) else {
        return String::new();
    };
    let rows = stmt.query_map(params![book, chapter, start, end], |r| r.get::<_, String>(0));
    rows.map(|r| r.filter_map(Result::ok).collect::<Vec<_>>().join(" ")).unwrap_or_default()
}

/// The core passages for a subject, when the typed words name one.
fn core_for(topic: &str) -> Vec<Passage> {
    let lower = words_of(topic).join(" ");
    let stems: HashSet<String> = key_stems(topic).into_iter().collect();
    let mut out: Vec<Passage> = Vec::new();
    // every list whose name fits, with the words of the name that fitted
    let mut lists: Vec<(HashSet<String>, &[Passage])> = Vec::new();
    for (names, passages) in CORE {
        let best = names
            .iter()
            .filter_map(|n| {
                let ns: HashSet<String> = key_stems(n).into_iter().collect();
                (!ns.is_empty() && (lower.contains(*n) || ns.iter().all(|s| stems.contains(s)))).then_some(ns)
            })
            .max_by_key(|ns| ns.len());
        if let Some(ns) = best {
            lists.push((ns, passages));
        }
    }
    // a narrower subject replaces the broader ones inside it: "gifts of the Spirit" is not
    // also a request for everything on "the Holy Spirit"
    let narrower: Vec<HashSet<String>> = lists.iter().map(|(ns, _)| ns.clone()).collect();
    lists.retain(|(ns, _)| !narrower.iter().any(|other| other.len() > ns.len() && ns.is_subset(other)));
    lists.sort_by(|a, b| b.0.len().cmp(&a.0.len()));
    for (_, passages) in lists {
        for p in passages {
            if !out.contains(p) {
                out.push(*p);
            }
        }
    }
    out
}

/// Every verse the topical Bibles list under headings that fit the subject.
fn topical_refs(study: &Connection, topic: &str) -> Vec<(String, i64, i64, i64)> {
    let stems = key_stems(topic);
    if stems.is_empty() {
        return Vec::new();
    }
    let mut headings: Vec<String> = Vec::new();
    for s in &stems {
        if let Some((_, extra)) = TOPICAL_HEADINGS.iter().find(|(k, _)| k == s) {
            headings.extend(extra.iter().map(|h| h.to_string()));
        }
    }
    let Ok(mut all) = study.prepare("SELECT id, headword_fold FROM dict_entries WHERE dict_code IN ('nave','torrey')") else { return Vec::new() };
    let entries: Vec<(i64, String)> = all.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).map(|r| r.filter_map(Result::ok).collect()).unwrap_or_default();
    let mut ids: Vec<i64> = Vec::new();
    for (id, head) in &entries {
        let head_stems = key_stems(head);
        // a heading fits when it is about all the subject's words and little else
        let fits = stems.iter().all(|s| head_stems.contains(s)) && head_stems.len() <= stems.len() + 2;
        if fits || headings.iter().any(|h| h == head) {
            ids.push(*id);
        }
    }
    let mut out = Vec::new();
    let Ok(mut refs) = study.prepare("SELECT book, chapter, verse, verse_end FROM dict_refs WHERE entry_id = ?1 AND verse IS NOT NULL") else { return out };
    for id in ids.iter().take(12) {
        let rows = refs.query_map(params![id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, Option<i64>>(3)?)));
        if let Ok(rows) = rows {
            for (book, chapter, verse, end) in rows.filter_map(Result::ok) {
                out.push((book, chapter, verse, end.filter(|e| *e > verse && *e - verse <= 12).unwrap_or(verse)));
            }
        }
    }
    out
}

/// The Scripture for one subject, best first.
pub fn find(db: &Connection, study: Option<&Connection>, topic: &str, limit: usize) -> Vec<VerseHit> {
    let mut hits: HashMap<(String, i64, i64), VerseHit> = HashMap::new();
    let mut add = |book: &str, chapter: i64, verse: i64, verse_end: i64, score: f64, why: &'static str| {
        let h = hits.entry((book.to_string(), chapter, verse)).or_insert_with(|| VerseHit { book: book.to_string(), chapter, verse, verse_end, score: 0.0, why: Vec::new(), text: String::new() });
        h.verse_end = h.verse_end.max(verse_end);
        if !h.why.contains(&why) {
            h.why.push(why);
            h.score += score;
        }
    };

    for (i, (book, chapter, verse, end)) in core_for(topic).into_iter().enumerate() {
        add(book, chapter, verse, end, 3.0 - i as f64 * 0.01, "core");
    }

    let words = words_of(topic);
    let stems = key_stems(topic);
    if words.len() >= 2 {
        let phrase = format!("\"{}\"", words.join(" "));
        for (i, (book, chapter, verse)) in verse_matches(db, &phrase, false, 60).into_iter().enumerate() {
            add(&book, chapter, verse, verse, 4.0 - i as f64 * 0.01, "phrase");
        }
    }
    let mut with_all = 0;
    if !stems.is_empty() {
        let all = stems.iter().map(|s| group(s)).collect::<Vec<_>>().join(" AND ");
        for (i, (book, chapter, verse)) in verse_matches(db, &all, true, 80).into_iter().enumerate() {
            add(&book, chapter, verse, verse, 2.2 * (1.0 - i as f64 / 160.0), "words");
            with_all += 1;
        }
    }
    // hardly any verse has all the words: take each main word on its own as well
    if stems.len() == 2 && with_all < 5 {
        for s in &stems {
            for (i, (book, chapter, verse)) in verse_matches(db, &group(s), true, 30).into_iter().enumerate() {
                add(&book, chapter, verse, verse, 1.0 * (1.0 - i as f64 / 60.0), "some");
            }
        }
    }
    // a longer sentence rarely has every word in one verse: accept all but one
    if stems.len() >= 3 {
        for skip in 0..stems.len() {
            let most = stems.iter().enumerate().filter(|(i, _)| *i != skip).map(|(_, s)| group(s)).collect::<Vec<_>>().join(" AND ");
            for (i, (book, chapter, verse)) in verse_matches(db, &most, true, 25).into_iter().enumerate() {
                add(&book, chapter, verse, verse, 1.0 * (1.0 - i as f64 / 50.0), "some");
            }
        }
    }
    if let Some(study) = study {
        for (i, (book, chapter, verse, end)) in topical_refs(study, topic).into_iter().enumerate() {
            add(&book, chapter, verse, end, (1.0 - i as f64 / 600.0).max(0.4), "topical");
        }
    }

    let out: Vec<VerseHit> = hits.into_values().collect();
    // a single verse inside a longer passage already found is folded into that passage,
    // which takes over its reasons (so Mark 5:25-34 leads when 5:34 has the exact words)
    let (singles, mut ranges): (Vec<VerseHit>, Vec<VerseHit>) = out.into_iter().partition(|h| h.verse_end == h.verse);
    let mut out: Vec<VerseHit> = Vec::new();
    for s in singles {
        match ranges.iter_mut().find(|r| r.book == s.book && r.chapter == s.chapter && s.verse >= r.verse && s.verse <= r.verse_end) {
            Some(r) => {
                for w in &s.why {
                    if !r.why.contains(w) {
                        r.why.push(w);
                        r.score += match *w {
                            "phrase" => 4.0,
                            "words" => 2.0,
                            _ => 0.8,
                        };
                    }
                }
            }
            None => out.push(s),
        }
    }
    out.extend(ranges);
    out.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal).then(a.book.cmp(&b.book)).then(a.chapter.cmp(&b.chapter)).then(a.verse.cmp(&b.verse)));
    out.truncate(limit);
    for h in &mut out {
        h.text = passage_text(db, &h.book, h.chapter, h.verse, h.verse_end);
    }
    out.retain(|h| !h.text.is_empty());
    out
}

/// The Scripture for one subject of a sermon (the sermon builder's search).
#[tauri::command]
pub fn sermon_verses(db: State<DbState>, study: State<StudyState>, topic: String, limit: Option<usize>) -> Result<Vec<VerseHit>, String> {
    let d = db.0.lock().map_err(|e| e.to_string())?;
    let s = match &study.0 {
        Some(m) => Some(m.lock().map_err(|e| e.to_string())?),
        None => None,
    };
    Ok(find(&d, s.as_deref(), topic.trim(), limit.unwrap_or(120).min(400)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    fn dbs() -> (Connection, Connection) {
        let res = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources");
        (Connection::open(res.join("bible.db")).unwrap(), Connection::open(res.join("study.db")).unwrap())
    }

    #[test]
    fn stems() {
        for (w, s) in [("healing", "heal"), ("healed", "heal"), ("heals", "heal"), ("gifts", "gift"), ("forgiveness", "forgiv"), ("forgive", "forgiv"), ("sinned", "sin"), ("mercies", "mercy"), ("faith", "faith"), ("bless", "bless"), ("spirit", "spirit")] {
            assert_eq!(stem(w), s, "{w}");
        }
        assert_eq!(key_stems("How do I forgive someone who hurt me?"), ["forgiv", "hurt"]);
    }

    #[test]
    fn every_core_passage_exists() {
        let (db, _) = dbs();
        for (names, passages) in CORE {
            for (book, chapter, verse, end) in *passages {
                assert!(end >= verse, "{names:?}: {book} {chapter}:{verse}-{end}");
                let first = passage_text(&db, book, *chapter, *verse, *verse);
                let last = passage_text(&db, book, *chapter, *end, *end);
                assert!(!first.is_empty() && !last.is_empty(), "{names:?}: {book} {chapter}:{verse}-{end} isn't in the text");
            }
        }
    }

    /// The two searches the user found thin, and a few more.
    #[test]
    fn finds_what_a_preacher_expects() {
        let (db, study) = dbs();
        let refs = |topic: &str| find(&db, Some(&study), topic, 120).into_iter().map(|h| (format!("{} {}:{}", h.book, h.chapter, h.verse), h.why)).collect::<Vec<_>>();
        let has = |found: &[(String, Vec<&'static str>)], r: &str| found.iter().any(|(x, _)| x == r);

        let f = refs("your faith has healed you");
        // (Mark 5:34 and 10:52 arrive inside their whole stories, Mark 5:25-34 and 10:46-52)
        for r in ["Mark 5:25", "Mark 10:46", "Luke 8:48", "Luke 18:42", "Matthew 9:20"] {
            assert!(f.iter().take(8).any(|(x, w)| x == r && w.contains(&"phrase")), "{r} should lead for the exact words: {:?}", &f[..8.min(f.len())]);
        }
        // the King James wording finds the same verses
        assert!(has(&refs("thy faith hath made thee whole"), "Luke 17:19"));

        let g = refs("gifts of the spirit");
        for r in ["1 Corinthians 12:1", "1 Corinthians 12:27", "Romans 12:6", "Ephesians 4:11", "1 Peter 4:10", "1 Corinthians 14:1"] {
            assert!(has(&g, r), "{r} missing for the gifts of the Spirit");
        }
        assert!(g.len() >= 30, "only {} passages", g.len());

        let h = refs("healing");
        for r in ["Isaiah 53:4", "James 5:14", "1 Peter 2:24", "Exodus 15:26"] {
            assert!(has(&h, r), "{r} missing for healing");
        }
        assert!(h.len() >= 60, "only {} passages for healing", h.len());
        assert!(has(&refs("sin; forgiveness"), "1 John 1:9") || has(&refs("forgiveness"), "1 John 1:9"));
        assert!(refs("how do I forgive someone who hurt me").len() >= 30);
        // a narrower subject doesn't drag in the broader lists
        assert!(!has(&g, "Romans 8:9"), "the general Holy Spirit list leaked into the gifts");
        let b = refs("baptism in the holy spirit");
        assert!(has(&b, "Acts 19:1") && !has(&b, "Romans 6:3"), "water baptism leaked into Spirit baptism");
    }

    /// What comes back, to read:  cargo test sermon_probe -- --ignored --nocapture
    #[test]
    #[ignore]
    fn sermon_probe() {
        let (db, study) = dbs();
        for topic in ["your faith has healed you", "gifts of the spirit", "healing", "faith", "how do I forgive someone who hurt me", "baptism in the holy spirit", "worry"] {
            let found = find(&db, Some(&study), topic, 400);
            let count = |w: &str| found.iter().filter(|h| h.why.contains(&w)).count();
            println!("\n== {topic}: {} passages (core {}, phrase {}, words {}, some {}, topical {})", found.len(), count("core"), count("phrase"), count("words"), count("some"), count("topical"));
            for h in found.iter().take(22) {
                let end = if h.verse_end > h.verse { format!("-{}", h.verse_end) } else { String::new() };
                println!("  {:>5.2} {:<26} {:<22} {}", h.score, format!("{} {}:{}{}", h.book, h.chapter, h.verse, end), h.why.join("+"), h.text.chars().take(70).collect::<String>());
            }
        }
    }
}
