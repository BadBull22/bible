//! Bibles the reader adds from a file (since 0.4.0): an e-Sword Bible (.bblx), a MySword
//! Bible (.bbl.mybible, also packed in .gz or .zip) or a SWORD Bible (.zip, as CrossWire and
//! eBible.org give them). Read with the desktop app's own readers (`bible_core`) and kept in
//! `my-bibles.db` beside the eBible.org downloads, so they are read and compared the same way.
//! Bibles locked by their publisher (e-Sword's own and bought ones) can't be opened, and the
//! reader is told so.

use std::io::Read;
use std::path::Path;

use bible_core::markup::{self, Kind};
use bible_core::{esword, refs, sword};
use rusqlite::{params, Connection};
use serde::Serialize;

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

/// What was added.
#[derive(Serialize, Debug)]
pub struct Added {
    pub code: String,
    pub name: String,
    pub language: String,
    pub verses: i64,
    pub books: i64,
    /// "e-Sword", "MySword" or "SWORD"
    pub program: String,
    pub warnings: Vec<String>,
}

/// A few language names for the codes modules give ("af" -> "Afrikaans"); others as given.
fn language_name(code: &str) -> String {
    let c = code.split(['-', '_']).next().unwrap_or("").to_ascii_lowercase();
    match c.as_str() {
        "en" | "eng" => "English",
        "af" | "afr" => "Afrikaans",
        "nl" | "nld" => "Dutch",
        "de" | "deu" | "ger" => "German",
        "fr" | "fra" | "fre" => "French",
        "es" | "spa" => "Spanish",
        "pt" | "por" => "Portuguese",
        "it" | "ita" => "Italian",
        "el" | "ell" | "grc" => "Greek",
        "he" | "heb" | "hbo" => "Hebrew",
        "la" | "lat" => "Latin",
        "zu" | "zul" => "Zulu",
        "xh" | "xho" => "Xhosa",
        "st" | "sot" => "Sesotho",
        "tn" | "tsn" => "Setswana",
        "sw" | "swa" | "swh" => "Swahili",
        "ru" | "rus" => "Russian",
        "zh" | "zho" | "chi" => "Chinese",
        "ko" | "kor" => "Korean",
        "ar" | "ara" => "Arabic",
        "" => "",
        other => return other.to_string(),
    }
    .to_string()
}

/// The text without the desktop's verse-link markers (⟦Book|ch|v|v_end|label⟧ -> label).
fn plain(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('⟦') {
        out.push_str(&rest[..start]);
        let after = &rest[start + '⟦'.len_utf8()..];
        match after.find('⟧') {
            Some(end) => {
                let inner = &after[..end];
                out.push_str(inner.rsplit('|').next().unwrap_or(""));
                rest = &after[end + '⟧'.len_utf8()..];
            }
            None => {
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// A version code the app can use: the module's own abbreviation, cleaned.
fn code_of(abbr: &str, fallback: &str) -> String {
    let clean = |s: &str| s.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(16).collect::<String>().to_uppercase();
    let c = clean(abbr);
    if c.is_empty() {
        clean(fallback)
    } else {
        c
    }
}

const MAX_BYTES: u64 = 400 * 1024 * 1024;

/// Adds the Bible in the file at `path` (named `name` where the reader chose it). `work` is
/// a scratch folder; `bundled` the codes of the Bibles inside the app (not added again).
pub fn add_file(conn: &mut Connection, path: &Path, name: &str, work: &Path, bundled: &[String]) -> Result<Added, String> {
    let _ = std::fs::remove_dir_all(work);
    std::fs::create_dir_all(work).map_err(err)?;
    let result = read_any(path, name, work);
    let added = result.and_then(|(code, title, language, copyright, program, verses, mut warnings, red)| {
        if bundled.iter().any(|b| b.eq_ignore_ascii_case(&code)) {
            return Err(format!("The {code} is in the app already."));
        }
        if verses.len() < 20 {
            return Err(format!("Only {} verses could be read, which is too few to be a Bible.", verses.len()));
        }
        let garbled = verses.iter().filter(|v| v.3.contains('\u{fffd}')).count();
        if garbled * 100 > verses.len() {
            return Err("The text doesn't read correctly, so it wasn't added.".into());
        }
        let tx = conn.transaction().map_err(err)?;
        let replaces = tx.query_row("SELECT 1 FROM bibles WHERE code = ?1", params![code], |_| Ok(())).is_ok();
        tx.execute("DELETE FROM verses WHERE code = ?1", params![code]).map_err(err)?;
        {
            let mut put = tx.prepare("INSERT OR REPLACE INTO verses (code, book, chapter, verse, text, red) VALUES (?1,?2,?3,?4,?5,?6)").map_err(err)?;
            for (b, ch, v, t) in &verses {
                let ranges = red.get(&(*b, *ch, *v)).and_then(|r| serde_json::to_string(r).ok());
                put.execute(params![code, b, ch, v, t, ranges]).map_err(err)?;
            }
        }
        let note = if copyright.trim().is_empty() { "Your own copy".to_string() } else { format!("Your own copy · {}", copyright.trim()).chars().take(300).collect() };
        tx.execute("INSERT OR REPLACE INTO bibles (code, name, language, copyright, rtl) VALUES (?1,?2,?3,?4,0)", params![code, title, language, note]).map_err(err)?;
        let books: i64 = tx.query_row("SELECT count(DISTINCT book) FROM verses WHERE code = ?1", params![code], |r| r.get(0)).map_err(err)?;
        tx.commit().map_err(err)?;
        if books < 66 {
            warnings.push(format!("It has {books} of the 66 books of the Bible."));
        }
        if replaces {
            warnings.push(format!("It replaced the {code} that was here."));
        }
        Ok(Added { code, name: title, language, verses: verses.len() as i64, books, program, warnings })
    });
    let _ = std::fs::remove_dir_all(work);
    added
}

type Found = (String, String, String, String, String, Vec<(&'static str, i64, i64, String)>, Vec<String>, std::collections::HashMap<(&'static str, i64, i64), Vec<(usize, usize)>>);

/// The Bible in the file, whatever it is packed in: (code, title, language, copyright,
/// program, verses, warnings).
fn read_any(path: &Path, name: &str, work: &Path) -> Result<Found, String> {
    let mut head = [0u8; 16];
    let n = std::fs::File::open(path).and_then(|mut f| f.read(&mut head)).map_err(err)?;
    let head = &head[..n];
    if esword::is_sqlite(head) {
        return from_esword(path, name);
    }
    if head.starts_with(&[0x1f, 0x8b]) {
        let inner = work.join("module.sqlite");
        let mut out = std::fs::File::create(&inner).map_err(err)?;
        let copied = std::io::copy(&mut flate2::read::GzDecoder::new(std::fs::File::open(path).map_err(err)?).take(MAX_BYTES), &mut out).map_err(|_| "This .gz file couldn't be unpacked.".to_string())?;
        drop(out);
        if copied >= MAX_BYTES {
            return Err("That file is too large to add.".into());
        }
        return from_esword(&inner, name.trim_end_matches(".gz"));
    }
    if head.starts_with(b"PK") {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(path).map_err(err)?).map_err(|_| "This isn't a zip file the app can open.".to_string())?;
        let names: Vec<String> = (0..zip.len()).filter_map(|i| zip.by_index(i).ok().map(|f| f.name().to_string())).collect();
        // an e-Sword or MySword Bible packed on its own
        let mut modules: Vec<&String> = names.iter().filter(|n| esword::is_module_name(n)).collect();
        // a MyBible Bible comes with a second file for its footnotes: the Bible is the one to add
        if modules.len() > 1 {
            modules.retain(|n| !n.to_lowercase().contains(".commentaries."));
        }
        if modules.len() == 1 && names.len() <= 3 {
            let inner_name = modules[0].rsplit(['/', '\\']).next().unwrap_or(modules[0]).to_string();
            let inner = work.join("module.sqlite");
            let mut f = zip.by_name(modules[0]).map_err(err)?;
            let mut out = std::fs::File::create(&inner).map_err(err)?;
            std::io::copy(&mut (&mut f).take(MAX_BYTES), &mut out).map_err(err)?;
            drop(out);
            return from_esword(&inner, &inner_name);
        }
        if names.iter().any(|n| n.to_ascii_lowercase().starts_with("mods.d/")) {
            return from_sword(&mut zip, work);
        }
        return Err("This zip holds no Bible module the app knows.".into());
    }
    Err("This isn't a Bible module the app can read. It can add e-Sword (.bblx), MySword (.bbl.mybible), MyBible (.SQLite3) and SWORD (.zip) Bibles.".into())
}

fn from_esword(path: &Path, name: &str) -> Result<Found, String> {
    let m = esword::read(path, Some(name))?;
    if m.kind != "bible" {
        let what = match m.kind {
            "commentary" => "a commentary",
            "dictionary" => "a dictionary",
            "devotional" => "a devotional",
            "atlas" => "an atlas of maps",
            _ => "a book",
        };
        return Err(format!("This is {what}, not a Bible. On the phone, only Bibles can be added from a file for now; add it on the computer."));
    }
    let base = name.split('.').next().unwrap_or("BIBLE");
    let code = code_of(&m.abbreviation, base);
    let title = if m.title.trim().is_empty() { code.clone() } else { m.title.trim().to_string() };
    let verses = m.verses.into_iter().map(|(b, c, v, t)| (b, c, v, plain(&t))).filter(|v| !v.3.is_empty()).collect();
    let red = m.red.into_iter().map(|(b, c, v, r)| ((b, c, v), r)).collect();
    Ok((code, title, language_name(&m.lang), m.copyright, m.program.to_string(), verses, m.warnings, red))
}

fn from_sword(zip: &mut zip::ZipArchive<std::fs::File>, work: &Path) -> Result<Found, String> {
    let root = work.join("sword");
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(err)?;
        total += f.size();
        if total > MAX_BYTES {
            return Err("The module is too large to add.".into());
        }
        let Some(rel) = f.enclosed_name() else { return Err("The zip has a file path the app won't unpack.".into()) };
        let dest = root.join(rel);
        if f.is_dir() {
            std::fs::create_dir_all(&dest).map_err(err)?;
            continue;
        }
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(err)?;
        }
        let mut out = std::fs::File::create(&dest).map_err(err)?;
        std::io::copy(&mut f, &mut out).map_err(err)?;
    }
    let mut confs = Vec::new();
    for e in std::fs::read_dir(root.join("mods.d")).map_err(|_| "There is no module description (mods.d) in the zip.".to_string())?.flatten() {
        let text = std::fs::read(e.path()).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
        if let Some(c) = sword::Conf::parse(&text) {
            confs.push(c);
        }
    }
    let conf = match confs.len() {
        1 => confs.remove(0),
        0 => return Err("There is no module description (mods.d/*.conf) in the zip.".into()),
        n => return Err(format!("The zip holds {n} modules. Add them one at a time.")),
    };
    let driver = conf.driver().to_ascii_lowercase();
    if !["rawtext", "rawtext4", "ztext", "ztext4"].contains(&driver.as_str()) {
        return Err("This SWORD module isn't a Bible. On the phone, only Bibles can be added from a file for now; add it on the computer.".into());
    }
    // a CipherKey (even an empty one) means the text is enciphered
    if conf.get("CipherKey").is_some() {
        return Err("This module is locked by its publisher, so it can only be opened in the program it was bought for.".into());
    }
    let source = conf.get("SourceType").unwrap_or("").to_string();
    let mut verses = Vec::new();
    let mut other = 0;
    for e in sword::read_verse_module(&root, &conf)? {
        let Some(book) = refs::osis_book(&e.osis_book) else {
            other += 1;
            continue;
        };
        if e.chapter == 0 || e.verse == 0 {
            continue;
        }
        let text = plain(&markup::to_text(&e.text, &source, Kind::Bible));
        if !text.is_empty() {
            verses.push((book, e.chapter as i64, e.verse as i64, text));
        }
    }
    let mut warnings = Vec::new();
    if other > 0 {
        warnings.push("Books beyond the 66 (the Apocrypha) were left out.".into());
    }
    let title = conf.get("Description").unwrap_or(&conf.name).trim().to_string();
    let copyright = conf.get("DistributionLicense").or(conf.get("Copyright")).unwrap_or("").to_string();
    Ok((code_of(&conf.name, &conf.name), title, language_name(conf.get("Lang").unwrap_or("")), copyright, "SWORD".into(), verses, warnings, Default::default()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verse_links_become_their_words() {
        assert_eq!(plain("See ⟦John|3|16||John 3:16⟧ and  more."), "See John 3:16 and more.");
        assert_eq!(code_of("pwl", "x"), "PWL");
        assert_eq!(code_of("", "berean-bsb"), "BEREAN-BSB");
        assert_eq!(language_name("af"), "Afrikaans");
    }

    #[test]
    fn a_mysword_bible_from_a_file() {
        let dir = std::env::temp_dir().join(format!("bc-phone-mod-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("tb.bbl.mybible");
        {
            let c = Connection::open(&file).unwrap();
            c.execute_batch("CREATE TABLE Bible(Book INT, Chapter INT, Verse INT, Scripture TEXT); CREATE TABLE Details(Description TEXT, Abbreviation TEXT, Comments TEXT, Language TEXT); INSERT INTO Details VALUES ('Toets Bybel', 'TB', 'Free to share.', 'af');").unwrap();
            for v in 1..=25 {
                c.execute("INSERT INTO Bible VALUES (43, 3, ?1, ?2)", params![v, format!("Johannes vers {v}<RF>note<Rf>.")]).unwrap();
            }
        }
        let mut conn = Connection::open_in_memory().unwrap();
        crate::bibles::init(&conn).unwrap();
        let a = add_file(&mut conn, &file, "tb.bbl.mybible", &dir.join("work"), &["BSB".into()]).unwrap();
        assert_eq!((a.code.as_str(), a.language.as_str(), a.verses, a.books), ("TB", "Afrikaans", 25, 1));
        let t: String = conn.query_row("SELECT text FROM verses WHERE code='TB' AND book='John' AND chapter=3 AND verse=16", [], |r| r.get(0)).unwrap();
        assert_eq!(t, "Johannes vers 16.");
        // the same again replaces it; a bundled one is refused
        assert!(add_file(&mut conn, &file, "tb.bbl.mybible", &dir.join("work"), &["TB".into()]).unwrap_err().contains("in the app already"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_mybible_bible_zipped_with_its_footnotes() {
        let dir = std::env::temp_dir().join(format!("bc-phone-mb-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let bible = dir.join("MB'4.SQLite3");
        let notes = dir.join("MB'4.commentaries.SQLite3");
        {
            let c = Connection::open(&bible).unwrap();
            c.execute_batch("CREATE TABLE info(name TEXT, value TEXT); CREATE TABLE verses(book_number NUMERIC, chapter NUMERIC, verse NUMERIC, text TEXT); INSERT INTO info VALUES ('description', 'Test MyBible'), ('language', 'en');").unwrap();
            for v in 1..=25 {
                c.execute("INSERT INTO verses VALUES (500, 3, ?1, ?2)", params![v, if v == 16 { "<pb/><J>John verse</J> 16.".to_string() } else { format!("<pb/>John<f>[1]</f> verse {v}.") }]).unwrap();
            }
            Connection::open(&notes).unwrap().execute_batch("CREATE TABLE commentaries(book_number NUMERIC, chapter_number_from NUMERIC, verse_number_from NUMERIC, marker TEXT, text TEXT);").unwrap();
        }
        let zip_path = dir.join("MB4.zip");
        {
            let mut z = zip::ZipWriter::new(std::fs::File::create(&zip_path).unwrap());
            for f in [&bible, &notes] {
                z.start_file(f.file_name().unwrap().to_str().unwrap(), zip::write::SimpleFileOptions::default()).unwrap();
                std::io::Write::write_all(&mut z, &std::fs::read(f).unwrap()).unwrap();
            }
            z.finish().unwrap();
        }
        let mut conn = Connection::open_in_memory().unwrap();
        crate::bibles::init(&conn).unwrap();
        let a = add_file(&mut conn, &zip_path, "MB4.zip", &dir.join("work"), &["BSB".into()]).unwrap();
        assert_eq!((a.code.as_str(), a.language.as_str(), a.verses, a.books), ("MB4", "English", 25, 1), "{a:?}");
        let t: String = conn.query_row("SELECT text FROM verses WHERE code='MB4' AND book='John' AND chapter=3 AND verse=16", [], |r| r.get(0)).unwrap();
        assert_eq!(t, "John verse 16.");
        // the words of Jesus are kept, and come back with the chapter
        let ch = crate::bibles::chapter(&conn, "MB4", "John", 3).unwrap();
        assert_eq!(ch.iter().find(|v| v.verse == 16).map(|v| v.red.clone()), Some(vec![(0, 1)]));
        assert!(ch.iter().find(|v| v.verse == 17).unwrap().red.is_empty());
        // the same file on its own, named with an apostrophe as the NIV'78 download is
        let a = add_file(&mut conn, &bible, "MB'4.SQLite3", &dir.join("work"), &["BSB".into()]).unwrap();
        assert_eq!(a.code, "MB4");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
