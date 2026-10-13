//! Looking closer at a verse (since 0.3.0): its words with their Strong's numbers and the
//! Strong's dictionary, and the commentary (the Tyndale Open Study Notes) with each book's
//! introduction. All of it is in the bundled database; see `data/build_phone_db.py`.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

/// The translations whose words carry Strong's numbers on the phone.
pub const TAGGED: [&str; 2] = ["BSB", "KJV"];

/// A word of a verse as the tagging has it, with its Strong's number(s) ("H7225", or
/// "H3068 H430" for one English word standing for two Hebrew ones).
#[derive(Serialize, Debug)]
pub struct Word {
    pub text: String,
    pub numbers: Vec<String>,
}

/// The tagged words of a verse in `version`, or in the BSB when `version` isn't tagged
/// (the second value says which was used). Empty if the verse has no tagging.
pub fn verse_words(db: &Connection, version: &str, book: &str, chapter: i64, verse: i64) -> Result<(String, Vec<Word>), String> {
    let used = if TAGGED.contains(&version) { version } else { "BSB" };
    let json: Option<String> = db
        .query_row(
            "SELECT w.words FROM strongs_words w JOIN versions ver ON ver.id = w.version_id JOIN books b ON b.id = w.book_id
             WHERE ver.code = ?1 AND b.name = ?2 AND w.chapter = ?3 AND w.verse = ?4",
            params![used, book, chapter, verse],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    let pairs: Vec<(String, String)> = json.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default();
    let words = pairs
        .into_iter()
        .map(|(text, numbers)| Word { text, numbers: numbers.split_whitespace().map(String::from).collect() })
        .collect();
    Ok((used.to_string(), words))
}

/// A Strong's dictionary entry, with how often the word is used in the tagged translations.
#[derive(Serialize, Debug)]
pub struct Entry {
    pub number: String,
    pub language: String,
    pub lemma: String,
    pub xlit: String,
    pub pronunciation: String,
    pub derivation: String,
    pub definition: String,
    pub kjv_usage: String,
    /// (translation, verses, occurrences)
    pub counts: Vec<(String, i64, i64)>,
}

pub fn strongs_entry(db: &Connection, number: &str) -> Result<Option<Entry>, String> {
    let number = number.trim().to_uppercase();
    let found = db
        .query_row(
            "SELECT strongs_number, language, coalesce(lemma,''), coalesce(xlit,''), coalesce(pronunciation,''), coalesce(derivation,''),
                    coalesce(strongs_def,''), coalesce(kjv_def,'') FROM strongs_dict WHERE strongs_number = ?1",
            params![number],
            |r| {
                Ok(Entry {
                    number: r.get(0)?,
                    language: r.get(1)?,
                    lemma: r.get(2)?,
                    xlit: r.get(3)?,
                    pronunciation: r.get(4)?,
                    derivation: r.get::<_, String>(5)?.trim().to_string(),
                    definition: r.get::<_, String>(6)?.trim().to_string(),
                    kjv_usage: r.get::<_, String>(7)?.trim().to_string(),
                    counts: Vec::new(),
                })
            },
        )
        .optional()
        .map_err(err)?;
    let Some(mut entry) = found else { return Ok(None) };
    let mut s = db
        .prepare("SELECT ver.code, c.verses, c.occurrences FROM strongs_counts c JOIN versions ver ON ver.id = c.version_id WHERE c.strongs_number = ?1 ORDER BY ver.id")
        .map_err(err)?;
    entry.counts = s.query_map(params![entry.number], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).map_err(err)?.collect::<Result<_, _>>().map_err(err)?;
    Ok(Some(entry))
}

/// The verses using a Strong's number in a tagged translation, in Bible order, with the
/// English words standing for it in each.
#[derive(Serialize, Debug)]
pub struct Use {
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub words: Vec<String>,
    pub text: String,
}

pub fn strongs_uses(db: &Connection, version: &str, number: &str, limit: usize) -> Result<Vec<Use>, String> {
    let used = if TAGGED.contains(&version) { version } else { "BSB" };
    let number = number.trim().to_uppercase();
    // the JSON holds the number as a whole word ("H430" or "H3068 H430"); LIKE narrows, the check below decides
    let mut s = db
        .prepare(
            "SELECT b.name, w.chapter, w.verse, w.words, v.text FROM strongs_words w JOIN versions ver ON ver.id = w.version_id
             JOIN books b ON b.id = w.book_id
             JOIN verses v ON v.version_id = w.version_id AND v.book_id = w.book_id AND v.chapter = w.chapter AND v.verse = w.verse
             WHERE ver.code = ?1 AND w.words LIKE ?2 ORDER BY b.order_index, w.chapter, w.verse",
        )
        .map_err(err)?;
    let rows = s
        .query_map(params![used, format!("%{number}%")], |r| Ok((r.get::<_, String>(0)?, r.get(1)?, r.get(2)?, r.get::<_, String>(3)?, r.get(4)?)))
        .map_err(err)?;
    let mut out = Vec::new();
    for row in rows {
        let (book, chapter, verse, json, text) = row.map_err(err)?;
        let pairs: Vec<(String, String)> = serde_json::from_str(&json).unwrap_or_default();
        let words: Vec<String> = pairs.into_iter().filter(|(_, n)| n.split_whitespace().any(|x| x == number)).map(|(t, _)| t).collect();
        if words.is_empty() {
            continue;
        }
        out.push(Use { book, chapter, verse, words, text });
        if out.len() >= limit {
            break;
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------- the commentary

/// A note of the commentary: it covers `verse_start` up to the next note's start.
#[derive(Serialize, Debug, Clone)]
pub struct Note {
    pub verse_start: i64,
    pub text: String,
}

/// All the commentary's notes on a chapter, in order.
pub fn chapter_notes(db: &Connection, book: &str, chapter: i64) -> Result<Vec<Note>, String> {
    let mut s = db
        .prepare("SELECT n.verse_start, n.text FROM notes n JOIN books b ON b.id = n.book_id WHERE b.name = ?1 AND n.chapter = ?2 ORDER BY n.verse_start, n.seq")
        .map_err(err)?;
    let rows = s.query_map(params![book, chapter], |r| Ok(Note { verse_start: r.get(0)?, text: r.get(1)? })).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

/// The notes covering one verse: those starting at the nearest note start at or before it.
pub fn verse_notes(db: &Connection, book: &str, chapter: i64, verse: i64) -> Result<Vec<Note>, String> {
    let all = chapter_notes(db, book, chapter)?;
    let Some(start) = all.iter().map(|n| n.verse_start).filter(|&s| s <= verse).max() else { return Ok(Vec::new()) };
    Ok(all.into_iter().filter(|n| n.verse_start == start).collect())
}

pub fn book_intro(db: &Connection, book: &str) -> Result<String, String> {
    let text: Option<String> = db
        .query_row("SELECT i.text FROM book_intros i JOIN books b ON b.id = i.book_id WHERE b.name = ?1", params![book], |r| r.get(0))
        .optional()
        .map_err(err)?;
    Ok(text.unwrap_or_default())
}

/// The commentary's name and licence, for the attribution under its notes.
#[derive(Serialize, Debug, Default)]
pub struct About {
    pub name: String,
    pub licence: String,
    pub licence_url: String,
    pub website: String,
}

pub fn commentary_about(db: &Connection) -> Result<About, String> {
    let get = |key: &str| -> Result<String, String> {
        Ok(db.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| r.get(0)).optional().map_err(err)?.unwrap_or_default())
    };
    Ok(About { name: get("commentary_name")?, licence: get("commentary_licence")?, licence_url: get("commentary_licence_url")?, website: get("commentary_website")? })
}
