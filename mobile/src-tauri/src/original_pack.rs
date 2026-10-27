//! The "Original words" download (since 2.9.5): every word of the Hebrew Old Testament and the Greek New
//! Testament, one by one -- the word as written, how to say it, what it means in English, its Strong's number,
//! its dictionary form and its grammar in plain words -- as the desktop app's interlinear shows them.
//!
//! The data is STEPBible's (TAHOT and TAGNT, CC BY 4.0, Tyndale House Cambridge). It is too big to carry inside
//! the app (about 12 MB to download, 38 MB unpacked), so, like the Advanced search upgrade, it is a one-time
//! download from the app's GitHub releases: a zip with one SQLite file, made by
//! `mobile/data/build_original_pack.py`, checked by SHA-256 and unpacked into the app's data folder
//! (`packs::install`). Everything else about a word (its Strong's entry, its uses) is already in the app.

use std::collections::HashMap;
use std::path::Path;

use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::Serialize;

/// Where the download comes from. A build made for testing can point somewhere else
/// (`BC_ORIGINAL_PACK_URL=http://... ` when it is compiled); a release build never does.
pub const URL: &str = match option_env!("BC_ORIGINAL_PACK_URL") {
    Some(url) => url,
    None => "https://github.com/BadBull22/bible/releases/download/original-pack-v1/original-words-v1.zip",
};
/// The SHA-256 the file must have (printed by the build script).
pub const SHA256: &str = "8c0281d5f82ec30f6ff1a98ef87c77ff2b0d18a46a2342c50f8833a078bdd275";
/// About how big the download is, for the button.
pub const SIZE_MB: u32 = 12;
const FOLDER: &str = "original-words";
const FILE: &str = "original.db";

/// The Greek editions a word may be in, as the bits of `editions` (the order the desktop app keeps them in).
pub const EDITIONS: [&str; 8] = ["NA28", "NA27", "Tyn", "SBL", "WH", "Treg", "TR", "Byz"];

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

pub fn installed(data: &Path) -> bool {
    data.join(FOLDER).join(FILE).exists()
}

/// Downloads the words; `progress` is told the percentage downloaded.
pub fn install(data: &Path, progress: &dyn Fn(u8)) -> Result<(), String> {
    crate::packs::install(data, URL, SHA256, FOLDER, 40, progress)?;
    let conn = open(data)?;
    let n: i64 = conn.query_row("SELECT count(*) FROM words", [], |r| r.get(0)).map_err(err)?;
    if n < 400_000 {
        return Err("The words were downloaded but are not all there. Please try again.".into());
    }
    Ok(())
}

pub fn remove(data: &Path) -> Result<(), String> {
    crate::packs::remove(data, FOLDER)
}

/// The words, opened for reading (a quick thing to do, so it is done for each request).
pub fn open(data: &Path) -> Result<Connection, String> {
    if !installed(data) {
        return Err("The original words are not downloaded yet.".into());
    }
    Connection::open_with_flags(data.join(FOLDER).join(FILE), OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)
}

/// What a grammar code says: "V-AAI-3S" as "Verb Aorist Active Indicative 3rd Singular".
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct MorphPart {
    pub code: String,
    /// the short reading in words
    pub summary: String,
    /// the formal breakdown, "Function=Verb; Tense=Aorist; ..."
    pub detail: String,
}

#[derive(Serialize, Debug)]
pub struct OriginalWord {
    pub pos: i64,
    /// STEPBible's word type: "L" the Leningrad Codex (Hebrew), "K"/"Q" written and read forms, "NKO" and the like for Greek
    pub kind: String,
    /// "Hebrew" or "Greek"
    pub language: String,
    pub original: String,
    pub translit: String,
    /// the English meaning in this place
    pub gloss: String,
    /// "G25", "H430"; empty for a particle with no number of its own
    pub strongs: String,
    /// the dictionary form, and what it means
    pub lemma: String,
    pub lemma_gloss: String,
    pub morph: String,
    pub morph_parts: Vec<MorphPart>,
    /// the Greek editions with this word (none for Hebrew)
    pub editions: Vec<String>,
}

type Cache = HashMap<(String, &'static str), Option<(String, String)>>;

/// A grammar code in words, as the desktop app reads it: Greek codes one by one (a crasis carries two),
/// Hebrew ones as prefix, word and suffix joined with "/".
fn expand_morph(conn: &Connection, cache: &mut Cache, morph: &str, greek: bool) -> Vec<MorphPart> {
    let mut lookup = |code: &str, lang: &'static str| -> Option<(String, String)> {
        cache
            .entry((code.to_string(), lang))
            .or_insert_with(|| {
                conn.query_row("SELECT short, formal FROM morph_codes WHERE code = ?1 AND lang = ?2", params![code, lang], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                    .optional()
                    .ok()
                    .flatten()
            })
            .clone()
    };
    let mut out = Vec::new();
    if greek {
        // a crasis word carries two analyses: "P-1NS + G2532=CONJ" (κἀγώ = "and I")
        for (i, part) in morph.split(" + ").enumerate() {
            let code = if i == 0 { part.trim() } else { part.rsplit('=').next().unwrap_or(part).trim() };
            if code.is_empty() {
                continue;
            }
            let (summary, detail) = lookup(code, "gr").unwrap_or_default();
            out.push(MorphPart { code: code.to_string(), summary, detail });
        }
    } else {
        // the language letter (H or A) is only written on the first segment
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

/// The words of a verse in the order they are read.
pub fn verse_words(conn: &Connection, book: &str, chapter: i64, verse: i64) -> Result<Vec<OriginalWord>, String> {
    let mut st = conn
        .prepare(
            "SELECT w.pos, w.type, w.original, w.translit, w.gloss, w.strongs, w.morph, w.editions, COALESCE(l.lemma, ''), COALESCE(l.gloss, '')
             FROM words w LEFT JOIN lemmas l ON l.key = w.lemma_key
             WHERE w.book = ?1 AND w.chapter = ?2 AND w.verse = ?3 ORDER BY w.seq",
        )
        .map_err(err)?;
    let rows: Vec<(i64, String, String, String, String, String, String, i64, String, String)> = st
        .query_map(params![book, chapter, verse], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?, r.get(9)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    let mut cache = Cache::new();
    Ok(rows
        .into_iter()
        .map(|(pos, kind, original, translit, gloss, strongs, morph, mask, lemma, lemma_gloss)| {
            let greek = strongs.starts_with('G') || mask != 0;
            let morph_parts = expand_morph(conn, &mut cache, &morph, greek);
            let editions = EDITIONS.iter().enumerate().filter(|(i, _)| mask & (1 << i) != 0).map(|(_, e)| e.to_string()).collect();
            OriginalWord { pos, kind, language: if greek { "Greek".into() } else { "Hebrew".into() }, original, translit, gloss, strongs, lemma, lemma_gloss, morph, morph_parts, editions }
        })
        .collect())
}

/// The credit that must be shown with the words.
pub fn credit(conn: &Connection) -> String {
    conn.query_row("SELECT value FROM meta WHERE key = 'credit'", [], |r| r.get(0)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A small database of the shape `build_original_pack.py` makes.
    fn fixture() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE words (book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, seq INTEGER NOT NULL, pos INTEGER NOT NULL,
                 type TEXT NOT NULL, original TEXT NOT NULL, translit TEXT NOT NULL, gloss TEXT NOT NULL, strongs TEXT NOT NULL, lemma_key TEXT NOT NULL,
                 morph TEXT NOT NULL, editions INTEGER NOT NULL, PRIMARY KEY (book, chapter, verse, seq)) WITHOUT ROWID;
             CREATE TABLE lemmas (key TEXT PRIMARY KEY, lemma TEXT NOT NULL, gloss TEXT NOT NULL);
             CREATE TABLE morph_codes (code TEXT NOT NULL, lang TEXT NOT NULL, formal TEXT NOT NULL, short TEXT NOT NULL, PRIMARY KEY (code, lang));
             CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             INSERT INTO meta VALUES ('credit', 'STEPBible, CC BY 4.0');
             INSERT INTO lemmas VALUES ('G25', 'ἀγαπάω', 'to love'), ('H7225G', 'רֵאשִׁית', 'beginning');
             INSERT INTO morph_codes VALUES ('V-AAI-3S', 'gr', 'Function=Verb; Tense=Aorist', 'Verb Aorist Active Indicative 3rd Singular'),
                 ('CONJ', 'gr', 'Function=Conjunction', 'Conjunction'),
                 ('HR', 'he', 'Function=Preposition', 'Preposition'),
                 ('Ncfsa', 'he', 'Function=Noun; Gender=Feminine', 'Noun feminine singular absolute');
             -- John 3:16, the third word (edition bits: Tyn = bit 2 = 4, TR = bit 6 = 64), and Genesis 1:1's first word (a prefix and a noun)
             INSERT INTO words VALUES ('John', 3, 16, 1, 1, 'NKO', 'οὕτως', 'houtōs', 'Thus', 'G3779', 'G3779', 'ADV', 68),
                 ('John', 3, 16, 3, 3, 'NKO', 'ἠγάπησεν', 'ēgapēsen', 'loved', 'G25', 'G25', 'V-AAI-3S', 68),
                 ('John', 3, 16, 2, 2, 'NKO', 'γὰρ', 'gar', 'for', 'G1063', 'G1063', 'CONJ', 4),
                 ('Genesis', 1, 1, 1, 1, 'L', 'בְּ/רֵאשִׁית', 'be./re.Shit', 'in/ beginning', 'H7225', 'H7225G', 'HR/Ncfsa', 0);",
        )
        .unwrap();
        c
    }

    #[test]
    fn the_words_of_a_verse_come_in_reading_order_with_their_grammar_in_words() {
        let c = fixture();
        let w = verse_words(&c, "John", 3, 16).unwrap();
        assert_eq!(w.iter().map(|x| x.translit.as_str()).collect::<Vec<_>>(), vec!["houtōs", "gar", "ēgapēsen"], "by their order in the verse, not as stored");
        let loved = &w[2];
        assert_eq!(loved.language, "Greek");
        assert_eq!(loved.gloss, "loved");
        assert_eq!(loved.strongs, "G25");
        assert_eq!((loved.lemma.as_str(), loved.lemma_gloss.as_str()), ("ἀγαπάω", "to love"));
        assert_eq!(loved.morph_parts, vec![MorphPart { code: "V-AAI-3S".into(), summary: "Verb Aorist Active Indicative 3rd Singular".into(), detail: "Function=Verb; Tense=Aorist".into() }]);
        assert_eq!(loved.editions, vec!["Tyn", "TR"], "the editions the word is in, from the bits");
        assert_eq!(w[1].editions, vec!["Tyn"]);
        // a code the table does not know is kept as it is, with nothing said about it
        assert_eq!(w[0].morph_parts, vec![MorphPart { code: "ADV".into(), summary: String::new(), detail: String::new() }]);
    }

    #[test]
    fn a_hebrew_word_is_split_into_its_prefix_and_its_noun() {
        let c = fixture();
        let w = verse_words(&c, "Genesis", 1, 1).unwrap();
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].language, "Hebrew");
        assert!(w[0].editions.is_empty());
        let codes: Vec<_> = w[0].morph_parts.iter().map(|p| (p.code.as_str(), p.summary.as_str())).collect();
        assert_eq!(codes, vec![("HR", "Preposition"), ("Ncfsa", "Noun feminine singular absolute")], "{codes:?}");
        assert_eq!((w[0].lemma.as_str(), w[0].lemma_gloss.as_str()), ("רֵאשִׁית", "beginning"));
    }

    #[test]
    fn a_verse_without_words_is_empty_and_the_credit_is_kept() {
        let c = fixture();
        assert!(verse_words(&c, "John", 99, 1).unwrap().is_empty());
        assert_eq!(credit(&c), "STEPBible, CC BY 4.0");
    }

    #[test]
    fn nothing_is_opened_until_the_words_are_downloaded() {
        let dir = std::env::temp_dir().join(format!("bc-original-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!installed(&dir));
        assert!(open(&dir).is_err());
        let _ = remove(&dir); // nothing to remove: not an error
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The real pack, if it has been built (`python mobile/data/build_original_pack.py`): unpacked, and checked against verses
    /// whose words are known. Run with `cargo test --lib original_pack -- --ignored`.
    #[test]
    #[ignore]
    fn the_real_pack_has_the_words_of_genesis_1_1_and_john_3_16() {
        use std::io::Read;
        let zip_path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../installer/packs/original-words-v1.zip");
        let bytes = std::fs::read(&zip_path).expect("build the pack first");
        use sha2::Digest;
        let sum: String = sha2::Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(sum, SHA256, "the zip is not the one the app expects: put the printed SHA-256 into original_pack.rs");
        let dir = std::env::temp_dir().join(format!("bc-original-real-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(FOLDER)).unwrap();
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut f = z.by_name(FILE).unwrap();
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).unwrap();
        std::fs::write(dir.join(FOLDER).join(FILE), buf).unwrap();
        let c = open(&dir).unwrap();
        let gen = verse_words(&c, "Genesis", 1, 1).unwrap();
        assert_eq!(gen.iter().map(|w| w.strongs.as_str()).collect::<Vec<_>>(), vec!["H7225", "H1254", "H430", "H853", "H8064", "H853", "H776"], "{:?}", gen.iter().map(|w| &w.translit).collect::<Vec<_>>());
        assert!(gen.iter().all(|w| w.language == "Hebrew" && !w.lemma.is_empty() && !w.morph_parts.is_empty()));
        let john = verse_words(&c, "John", 3, 16).unwrap();
        let tyn: Vec<_> = john.iter().filter(|w| w.editions.contains(&"Tyn".to_string())).collect();
        assert_eq!(tyn.first().map(|w| w.gloss.as_str()), Some("Thus"));
        assert!(tyn.iter().any(|w| w.strongs == "G25" && w.morph_parts[0].summary.contains("Aorist")), "ἠγάπησεν is an aorist");
        assert!(credit(&c).contains("STEPBible"));
        let n: i64 = c.query_row("SELECT count(*) FROM words", [], |r| r.get(0)).unwrap();
        assert!(n >= 447_000, "{n}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
