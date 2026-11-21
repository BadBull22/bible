//! The meanings of the Hebrew and Greek words on the phone (since 3.2.0): what each word means in the UBS dictionaries, the groups of
//! meanings, the plain-English cards (SIL Semantic Domains) and example verses with the word marked. Both files are compiled into the
//! app (gzip, about 1.9 MB together; see build.rs) and opened the first time a word page needs them. The reading of the files is
//! `bible_core::semantic`, the same code as the desktop app; this file only asks the phone's own databases.

use std::io::Read;
use std::sync::OnceLock;

use bible_core::semantic::{norm_strongs, pick_sample_keys, has_hebrew_points, mark_parts, Data, MeaningWord, RawSil, Sample, SenseReport, SilCard, WordDictionary};
use rusqlite::{params, Connection, OptionalExtension};

static DOMAINS_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/semantic_domains.json.gz"));
static SIL_GZ: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/semantic_sil.json.gz"));

static DATA: OnceLock<Result<Data, String>> = OnceLock::new();
static SIL: OnceLock<Option<RawSil>> = OnceLock::new();

fn unzip(bytes: &[u8]) -> Result<String, String> {
    let mut text = String::new();
    flate2::read::GzDecoder::new(bytes).read_to_string(&mut text).map_err(|e| e.to_string())?;
    Ok(text)
}

/// The dictionaries' meanings, opened the first time (a second or so on a phone).
pub fn data() -> Result<&'static Data, String> {
    DATA.get_or_init(|| unzip(DOMAINS_GZ).and_then(|t| Data::from_json(&t))).as_ref().map_err(|e| e.clone())
}

/// The everyday-English cards; the word page works without them.
pub fn sil() -> Option<&'static RawSil> {
    SIL.get_or_init(|| unzip(SIL_GZ).ok().and_then(|t| RawSil::from_json(&t).ok())).as_ref()
}

/// The number a verse has in the dictionaries' lists (book * 1,000,000 + chapter * 1,000 + verse).
pub fn verse_key(db: &Connection, book: Option<String>, chapter: Option<i64>, verse: Option<i64>) -> Option<u32> {
    let (Some(b), Some(c), Some(v)) = (book, chapter, verse) else { return None };
    let order: Option<i64> = db.query_row("SELECT order_index FROM books WHERE name = ?1", params![b], |r| r.get(0)).ok();
    order.map(|o| (o * 1_000_000 + c * 1_000 + v) as u32)
}

fn dictionary_of(db: &Connection, s: &str) -> Option<WordDictionary> {
    db.query_row("SELECT lemma, xlit, strongs_def, kjv_def FROM strongs_dict WHERE strongs_number = ?1", params![s], |r| {
        Ok(WordDictionary {
            lemma: r.get::<_, Option<String>>(0)?.unwrap_or_default(),
            translit: r.get::<_, Option<String>>(1)?.filter(|t| !t.trim().is_empty()),
            definition: r.get::<_, Option<String>>(2)?.unwrap_or_default().trim().to_string(),
            kjv: r.get::<_, Option<String>>(3)?.map(|t| t.trim().to_string()).filter(|t| !t.is_empty()),
        })
    })
    .ok()
}

/// Every meaning of a Hebrew or Greek word: how many verses use each, where in the Bible, and what it is called in everyday English.
/// The verse being read marks the meaning used there.
pub fn senses(db: &Connection, strongs: &str, book: Option<String>, chapter: Option<i64>, verse: Option<i64>) -> Result<SenseReport, String> {
    let s = norm_strongs(strongs).ok_or("That is not a Strong's number.")?;
    let hebrew = s.starts_with('H');
    let data = data()?;
    let key = verse_key(db, book, chapter, verse);
    let (lemma, senses) = bible_core::semantic::senses_of(data.lang_of_strongs(&s), sil(), hebrew, &s, key);
    let dictionary = dictionary_of(db, &s);
    let lemma = if lemma.is_empty() { dictionary.as_ref().map(|d| d.lemma.clone()).unwrap_or_default() } else { lemma };
    Ok(SenseReport { strongs: s, language: if hebrew { "hebrew" } else { "greek" }.to_string(), lemma, senses, dictionary })
}

/// The other words in a group of meanings, the most used first, each with how it is written in English letters.
pub fn group_words(db: &Connection, language: &str, code: &str) -> Result<Vec<MeaningWord>, String> {
    let data = data()?;
    let lang = match language {
        "greek" => &data.greek,
        "hebrew" => &data.hebrew,
        _ => return Err("Choose Greek or Hebrew.".into()),
    };
    let mut out = lang.words_in(code);
    out.truncate(200);
    for w in out.iter_mut() {
        let Some(s) = w.strongs.first().cloned() else { continue };
        if let Some(d) = dictionary_of(db, &s) {
            w.translit = d.translit;
            if language == "hebrew" && !has_hebrew_points(&w.lemma) && has_hebrew_points(&d.lemma) {
                w.speak = d.lemma;
            }
        }
    }
    Ok(out)
}

/// The card for a whole group.
pub fn group_card(language: &str, code: &str) -> Option<SilCard> {
    sil().and_then(|s| s.group_card(language == "hebrew", code))
}

/// Example verses for one meaning of a word, with the word marked where the Bible carries Strong's numbers. `bundled` is a bundled
/// translation (BSB, KJV); a Bible the reader added with Strong's numbers is read from `bibles`. Any other Bible shows the BSB.
pub fn samples(db: &Connection, bibles: &Connection, strongs: &str, entry: usize, meaning: usize, version: &str, here: Option<u32>) -> Result<Vec<Sample>, String> {
    let s = norm_strongs(strongs).ok_or("That is not a Strong's number.")?;
    let data = data()?;
    let verses = data.lang_of_strongs(&s).meaning_verses(entry, meaning).ok_or("That meaning is not in the dictionary.")?;
    let keys = pick_sample_keys(verses, here, 3);
    let imported = crate::study_extra::imported_is_tagged(bibles, version);
    let used = if imported || crate::study_extra::TAGGED.contains(&version) { version } else { "BSB" };
    let mut out = Vec::new();
    for k in keys {
        let (b, c, v) = ((k / 1_000_000) as i64, ((k % 1_000_000) / 1_000) as i64, (k % 1_000) as i64);
        let Some(name) = db.query_row("SELECT name FROM books WHERE order_index = ?1", params![b], |r| r.get::<_, String>(0)).optional().map_err(|e| e.to_string())? else { continue };
        let row: Option<(String, Option<String>)> = if imported {
            bibles
                .query_row("SELECT text, words FROM verses WHERE code = ?1 AND book = ?2 AND chapter = ?3 AND verse = ?4", params![used, name, c, v], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()
                .map_err(|e| e.to_string())?
        } else {
            db.query_row(
                "SELECT v.text, w.words FROM verses v JOIN versions ver ON ver.id = v.version_id JOIN books bk ON bk.id = v.book_id
                 LEFT JOIN strongs_words w ON w.version_id = v.version_id AND w.book_id = v.book_id AND w.chapter = v.chapter AND w.verse = v.verse
                 WHERE ver.code = ?1 AND bk.order_index = ?2 AND v.chapter = ?3 AND v.verse = ?4",
                params![used, b, c, v],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?
        };
        let Some((text, json)) = row else { continue };
        let pairs: Vec<(String, String)> = json.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default();
        let words: Vec<String> = pairs.into_iter().filter(|(_, n)| n.split_whitespace().any(|x| x.eq_ignore_ascii_case(&s))).map(|(w, _)| w).collect();
        out.push(Sample { book: name, chapter: c, verse: v, parts: mark_parts(&text, &words) });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_compiled_in_files_open() {
        let d = data().expect("the dictionaries");
        assert!(d.greek.entries.len() > 1000 && d.hebrew.entries.len() > 1000);
        assert!(sil().is_some());
        // agape (love): G26 has meanings, and a group card
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE books (id INTEGER, name TEXT, order_index INTEGER); CREATE TABLE strongs_dict (strongs_number TEXT, language TEXT, lemma TEXT, xlit TEXT, pronunciation TEXT, derivation TEXT, strongs_def TEXT, kjv_def TEXT);
            INSERT INTO books VALUES (43, 'John', 43); INSERT INTO strongs_dict VALUES ('G26', 'Greek', 'ἀγάπη', 'agapē', '', '', 'love', 'love, charity');").unwrap();
        let r = senses(&db, "g0026", Some("John".into()), Some(3), Some(16)).unwrap();
        assert_eq!(r.strongs, "G26");
        assert!(!r.senses.is_empty());
        assert!(r.senses.iter().any(|s| s.sil.is_some()));
        assert_eq!(r.dictionary.unwrap().kjv.as_deref(), Some("love, charity"));
        let words = group_words(&db, "greek", &r.senses[0].domains[0]).unwrap();
        assert!(!words.is_empty());
        assert!(group_card("greek", &r.senses[0].domains[0]).is_some());
    }

    #[test]
    fn examples_mark_the_words_of_a_bundled_or_an_added_bible() {
        let d = data().unwrap();
        let (entry, meaning) = d.greek.entries.iter().enumerate().find(|(_, e)| e.strongs.iter().any(|s| s == "G26")).map(|(i, e)| (i, e.meanings.len() - 1)).unwrap();
        let first = d.greek.meaning_verses(entry, meaning).unwrap()[0];
        let (b, c, v) = ((first / 1_000_000) as i64, ((first % 1_000_000) / 1_000) as i64, (first % 1_000) as i64);
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(&format!(
            "CREATE TABLE books (id INTEGER, name TEXT, order_index INTEGER); CREATE TABLE versions (id INTEGER, code TEXT);
             CREATE TABLE verses (version_id INTEGER, book_id INTEGER, chapter INTEGER, verse INTEGER, text TEXT);
             CREATE TABLE strongs_words (version_id INTEGER, book_id INTEGER, chapter INTEGER, verse INTEGER, words TEXT);
             INSERT INTO books VALUES (1, 'Book', {b}); INSERT INTO versions VALUES (1, 'BSB');
             INSERT INTO verses VALUES (1, 1, {c}, {v}, 'God is love today');
             INSERT INTO strongs_words VALUES (1, 1, {c}, {v}, '[[\"God\",\"G2316\"],[\"love\",\"G26\"]]');"
        ))
        .unwrap();
        let bibles = Connection::open_in_memory().unwrap();
        bibles.execute_batch("CREATE TABLE verses (code TEXT, book TEXT, chapter INTEGER, verse INTEGER, text TEXT, words TEXT);").unwrap();
        let out = samples(&db, &bibles, "G26", entry, meaning, "BSB", None).unwrap();
        assert_eq!(out.len(), 1);
        assert!(out[0].parts.iter().any(|p| p.mark && p.text == "love"));
        // a Bible the reader added, with its own tagged words
        bibles.execute_batch(&format!("INSERT INTO verses VALUES ('MY', 'Book', {c}, {v}, 'Love wins', '[[\"Love\",\"G26\"],[\"wins\",\"G1\"]]');")).unwrap();
        let out = samples(&db, &bibles, "G26", entry, meaning, "MY", None).unwrap();
        assert!(out[0].parts.iter().any(|p| p.mark && p.text == "Love"));
    }
}
