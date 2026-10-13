//! More translations, downloaded by the reader (since 0.3.0): any Bible eBible.org marks as
//! free to redistribute -- over a thousand, in hundreds of languages. The catalogue is
//! eBible.org's `translations.csv`; a translation is its verse-per-line zip
//! (`<id>_vpl.zip`, lines like `JOH 3:16 For God so loved ...`). Downloaded Bibles are kept
//! in a database of their own (`my-bibles.db`), so a new version of the app keeps them.
//! They can be read, compared and shown side by side; searching uses the bundled English.

use std::collections::HashMap;
use std::io::Read;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::search::Verse;

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

const CATALOG_URL: &str = "https://ebible.org/Scriptures/translations.csv";
const ZIP_URL: &str = "https://ebible.org/Scriptures/";
/// Identifies the app to eBible.org (a contact URL, never personal details).
const USER_AGENT: &str = "BibleConcordance-Android/0.3 (https://bible4me.org)";

pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS bibles (
            code TEXT PRIMARY KEY, name TEXT NOT NULL, language TEXT NOT NULL, copyright TEXT NOT NULL,
            rtl INTEGER NOT NULL DEFAULT 0, installed_at TEXT NOT NULL DEFAULT (datetime('now','localtime')));
         CREATE TABLE IF NOT EXISTS verses (
            code TEXT NOT NULL, book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, text TEXT NOT NULL,
            PRIMARY KEY (code, book, chapter, verse)) WITHOUT ROWID;
         CREATE TABLE IF NOT EXISTS catalog (id INTEGER PRIMARY KEY CHECK (id = 1), fetched_on TEXT NOT NULL, csv TEXT NOT NULL);",
    )
    .map_err(err)
}

/// The book codes of eBible.org's verse-per-line files (and the USFM ones, in case), in
/// canonical order, for the 66 books. Anything else (the deuterocanon) is left out.
const CODES: [(&str, &str, &str); 66] = [
    ("GEN", "GEN", "Genesis"), ("EXO", "EXO", "Exodus"), ("LEV", "LEV", "Leviticus"), ("NUM", "NUM", "Numbers"),
    ("DEU", "DEU", "Deuteronomy"), ("JOS", "JOS", "Joshua"), ("JDG", "JDG", "Judges"), ("RUT", "RUT", "Ruth"),
    ("1SA", "1SA", "1 Samuel"), ("2SA", "2SA", "2 Samuel"), ("1KI", "1KI", "1 Kings"), ("2KI", "2KI", "2 Kings"),
    ("1CH", "1CH", "1 Chronicles"), ("2CH", "2CH", "2 Chronicles"), ("EZR", "EZR", "Ezra"), ("NEH", "NEH", "Nehemiah"),
    ("EST", "EST", "Esther"), ("JOB", "JOB", "Job"), ("PSA", "PSA", "Psalms"), ("PRO", "PRO", "Proverbs"),
    ("ECC", "ECC", "Ecclesiastes"), ("SOL", "SNG", "Song of Solomon"), ("ISA", "ISA", "Isaiah"), ("JER", "JER", "Jeremiah"),
    ("LAM", "LAM", "Lamentations"), ("EZE", "EZK", "Ezekiel"), ("DAN", "DAN", "Daniel"), ("HOS", "HOS", "Hosea"),
    ("JOE", "JOL", "Joel"), ("AMO", "AMO", "Amos"), ("OBA", "OBA", "Obadiah"), ("JON", "JON", "Jonah"),
    ("MIC", "MIC", "Micah"), ("NAH", "NAM", "Nahum"), ("HAB", "HAB", "Habakkuk"), ("ZEP", "ZEP", "Zephaniah"),
    ("HAG", "HAG", "Haggai"), ("ZEC", "ZEC", "Zechariah"), ("MAL", "MAL", "Malachi"), ("MAT", "MAT", "Matthew"),
    ("MAR", "MRK", "Mark"), ("LUK", "LUK", "Luke"), ("JOH", "JHN", "John"), ("ACT", "ACT", "Acts"),
    ("ROM", "ROM", "Romans"), ("1CO", "1CO", "1 Corinthians"), ("2CO", "2CO", "2 Corinthians"), ("GAL", "GAL", "Galatians"),
    ("EPH", "EPH", "Ephesians"), ("PHI", "PHP", "Philippians"), ("COL", "COL", "Colossians"), ("1TH", "1TH", "1 Thessalonians"),
    ("2TH", "2TH", "2 Thessalonians"), ("1TI", "1TI", "1 Timothy"), ("2TI", "2TI", "2 Timothy"), ("TIT", "TIT", "Titus"),
    ("PHM", "PHM", "Philemon"), ("HEB", "HEB", "Hebrews"), ("JAM", "JAS", "James"), ("1PE", "1PE", "1 Peter"),
    ("2PE", "2PE", "2 Peter"), ("1JO", "1JN", "1 John"), ("2JO", "2JN", "2 John"), ("3JO", "3JN", "3 John"),
    ("JUD", "JUD", "Jude"), ("REV", "REV", "Revelation"),
];

fn book_of(code: &str) -> Option<&'static str> {
    CODES.iter().find(|(v, u, _)| *v == code || *u == code).map(|(_, _, name)| *name)
}

fn get(url: &str) -> Result<ureq::Response, String> {
    ureq::get(url)
        .set("User-Agent", USER_AGENT)
        .timeout(std::time::Duration::from_secs(120))
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(code, _) => format!("eBible.org answered {code}."),
            _ => "Couldn't reach eBible.org. Check the phone's internet connection and try again.".to_string(),
        })
}

// ---------------------------------------------------------------- the catalogue

/// A translation that can be downloaded.
#[derive(Serialize, Debug, Clone)]
pub struct Offer {
    pub id: String,
    pub language: String,
    /// the language's name in itself, when it differs
    pub language_own: String,
    pub title: String,
    pub description: String,
    pub copyright: String,
    pub ot_books: i64,
    pub nt_books: i64,
    pub rtl: bool,
    pub installed: bool,
}

/// Splits one line of a CSV file (quoted fields, "" for a quote inside one).
fn csv_rows(text: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut chars = text.trim_start_matches('\u{feff}').chars().peekable();
    while let Some(c) = chars.next() {
        match (c, quoted) {
            ('"', true) if chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            ('"', _) => quoted = !quoted,
            (',', false) => row.push(std::mem::take(&mut field)),
            ('\n', false) => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            ('\r', false) => {}
            _ => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

fn parse_catalog(csv: &str) -> Vec<Offer> {
    let rows = csv_rows(csv);
    let Some(head) = rows.first() else { return Vec::new() };
    let col: HashMap<&str, usize> = head.iter().enumerate().map(|(i, h)| (h.as_str(), i)).collect();
    let field = |row: &Vec<String>, name: &str| col.get(name).and_then(|&i| row.get(i)).cloned().unwrap_or_default();
    let num = |row: &Vec<String>, name: &str| field(row, name).trim().parse::<i64>().unwrap_or(0);
    let mut out: Vec<Offer> = rows
        .iter()
        .skip(1)
        .filter(|r| field(r, "Redistributable") == "True" && field(r, "downloadable") == "True")
        .filter(|r| num(r, "OTbooks") + num(r, "NTbooks") > 0)
        .map(|r| {
            let english = field(r, "languageNameInEnglish");
            let own = field(r, "languageName");
            let short = field(r, "shortTitle");
            Offer {
                id: field(r, "translationId"),
                language_own: if own != english { own } else { String::new() },
                language: english,
                title: if short.trim().is_empty() { field(r, "title") } else { short },
                description: field(r, "description"),
                copyright: field(r, "Copyright"),
                ot_books: num(r, "OTbooks"),
                nt_books: num(r, "NTbooks"),
                rtl: field(r, "textDirection") == "rtl",
                installed: false,
            }
        })
        .filter(|o| !o.id.is_empty())
        .collect();
    out.sort_by(|a, b| a.language.cmp(&b.language).then((b.ot_books + b.nt_books).cmp(&(a.ot_books + a.nt_books))).then(a.title.cmp(&b.title)));
    out
}

/// The catalogue, fetched at most once a week (or when `refresh`), with what is installed marked.
pub fn catalog(conn: &Connection, today: &str, refresh: bool) -> Result<Vec<Offer>, String> {
    let cached: Option<(String, String)> = conn.query_row("SELECT fetched_on, csv FROM catalog WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(err)?;
    let stale = cached.as_ref().map_or(true, |(on, _)| refresh || days_between(on, today).map_or(true, |d| d >= 7));
    let csv = if stale {
        match get(CATALOG_URL).and_then(|r| r.into_string().map_err(err)) {
            Ok(csv) => {
                conn.execute("INSERT OR REPLACE INTO catalog (id, fetched_on, csv) VALUES (1, ?1, ?2)", params![today, csv]).map_err(err)?;
                csv
            }
            // offline: the last copy will do
            Err(e) => cached.map(|(_, csv)| csv).ok_or(e)?,
        }
    } else {
        cached.map(|(_, csv)| csv).unwrap_or_default()
    };
    let installed: Vec<String> = installed(conn)?.into_iter().map(|b| b.code).collect();
    Ok(parse_catalog(&csv).into_iter().map(|mut o| {
        o.installed = installed.contains(&o.id);
        o
    }).collect())
}

/// Days from one yyyy-mm-dd date to another (None if either isn't one).
pub fn days_between(from: &str, to: &str) -> Option<i64> {
    Some(day_number(to)? - day_number(from)?)
}

/// A yyyy-mm-dd date as a count of days (proleptic Gregorian), for differences.
pub fn day_number(date: &str) -> Option<i64> {
    let mut parts = date.get(..10)?.split('-').map(|p| p.parse::<i64>().ok());
    let (y, m, d) = (parts.next()??, parts.next()??, parts.next()??);
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    // days from civil (Howard Hinnant's algorithm)
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146097 + doe - 719468)
}

// ---------------------------------------------------------------- installed translations

#[derive(Serialize, Debug, Clone)]
pub struct Installed {
    pub code: String,
    pub name: String,
    pub language: String,
    pub copyright: String,
    pub rtl: bool,
    pub verses: i64,
}

pub fn installed(conn: &Connection) -> Result<Vec<Installed>, String> {
    let mut s = conn
        .prepare("SELECT b.code, b.name, b.language, b.copyright, b.rtl, (SELECT count(*) FROM verses v WHERE v.code = b.code) FROM bibles b ORDER BY b.installed_at")
        .map_err(err)?;
    let rows = s
        .query_map([], |r| Ok(Installed { code: r.get(0)?, name: r.get(1)?, language: r.get(2)?, copyright: r.get(3)?, rtl: r.get::<_, i64>(4)? != 0, verses: r.get(5)? }))
        .map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

pub fn is_installed(conn: &Connection, code: &str) -> bool {
    conn.query_row("SELECT 1 FROM bibles WHERE code = ?1", params![code], |_| Ok(())).optional().ok().flatten().is_some()
}

/// Downloads a translation and stores it. `progress` is told the percentage downloaded.
pub fn install(conn: &mut Connection, offer: &Offer, progress: &dyn Fn(u8)) -> Result<i64, String> {
    if !offer.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("That isn't a translation eBible.org offers.".into());
    }
    let response = get(&format!("{ZIP_URL}{}_vpl.zip", offer.id))?;
    let total: Option<usize> = response.header("Content-Length").and_then(|v| v.parse().ok());
    let mut bytes = Vec::with_capacity(total.unwrap_or(4 << 20));
    let mut reader = response.into_reader().take(200 << 20);
    let mut chunk = [0u8; 64 * 1024];
    let mut last = 0u8;
    loop {
        let n = reader.read(&mut chunk).map_err(|_| "The download stopped before it was finished. Please try again.".to_string())?;
        if n == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..n]);
        if let Some(t) = total.filter(|&t| t > 0) {
            let pct = ((bytes.len() * 100) / t).min(100) as u8;
            if pct != last {
                last = pct;
                progress(pct);
            }
        }
    }
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| "The downloaded file isn't a Bible eBible.org usually sends.".to_string())?;
    let name = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().map(|f| f.name().to_string()))
        .find(|n| n.ends_with("_vpl.txt"))
        .ok_or("The download has no Bible text in it.")?;
    let mut text = String::new();
    zip.by_name(&name).map_err(err)?.read_to_string(&mut text).map_err(|_| "The Bible text couldn't be read.".to_string())?;

    let tx = conn.transaction().map_err(err)?;
    tx.execute("DELETE FROM verses WHERE code = ?1", params![offer.id]).map_err(err)?;
    let mut n = 0i64;
    {
        let mut put = tx.prepare("INSERT OR REPLACE INTO verses (code, book, chapter, verse, text) VALUES (?1,?2,?3,?4,?5)").map_err(err)?;
        for line in text.trim_start_matches('\u{feff}').lines() {
            // "JOH 3:16 For God so loved ..."
            let mut parts = line.splitn(3, ' ');
            let (Some(code), Some(place), Some(words)) = (parts.next(), parts.next(), parts.next()) else { continue };
            let Some(book) = book_of(code) else { continue };
            let Some((c, v)) = place.split_once(':') else { continue };
            // a verse number like "4-5" (two verses joined) is kept at its first
            let v = v.split(|ch: char| !ch.is_ascii_digit()).next().unwrap_or("");
            let (Ok(chapter), Ok(verse)) = (c.parse::<i64>(), v.parse::<i64>()) else { continue };
            let words = words.trim();
            if words.is_empty() {
                continue;
            }
            n += put.execute(params![offer.id, book, chapter, verse, words]).map_err(err)? as i64;
        }
    }
    if n == 0 {
        return Err("The download had no verses in it.".into());
    }
    let language = if offer.language_own.is_empty() { offer.language.clone() } else { format!("{} ({})", offer.language, offer.language_own) };
    tx.execute(
        "INSERT OR REPLACE INTO bibles (code, name, language, copyright, rtl) VALUES (?1,?2,?3,?4,?5)",
        params![offer.id, offer.title, language, offer.copyright, offer.rtl as i64],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(n)
}

pub fn remove(conn: &Connection, code: &str) -> Result<(), String> {
    conn.execute("DELETE FROM verses WHERE code = ?1", params![code]).map_err(err)?;
    conn.execute("DELETE FROM bibles WHERE code = ?1", params![code]).map_err(err)?;
    Ok(())
}

pub fn chapter(conn: &Connection, code: &str, book: &str, chapter: i64) -> Result<Vec<Verse>, String> {
    let mut s = conn.prepare("SELECT verse, text FROM verses WHERE code = ?1 AND book = ?2 AND chapter = ?3 ORDER BY verse").map_err(err)?;
    let rows = s.query_map(params![code, book, chapter], |r| Ok(Verse { verse: r.get(0)?, text: r.get(1)?, red: Vec::new() })).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

pub fn passage(conn: &Connection, code: &str, book: &str, chapter: i64, start: i64, end: i64) -> String {
    let Ok(mut s) = conn.prepare("SELECT text FROM verses WHERE code = ?1 AND book = ?2 AND chapter = ?3 AND verse BETWEEN ?4 AND ?5 ORDER BY verse") else {
        return String::new();
    };
    let rows = s.query_map(params![code, book, chapter, start, end.max(start)], |r| r.get::<_, String>(0));
    rows.map(|r| r.filter_map(Result::ok).collect::<Vec<_>>().join(" ")).unwrap_or_default()
}

/// The verse in every downloaded translation: (code, text).
pub fn compare(conn: &Connection, book: &str, chapter: i64, verse: i64) -> Result<Vec<(String, String)>, String> {
    let mut s = conn
        .prepare("SELECT v.code, v.text FROM verses v JOIN bibles b ON b.code = v.code WHERE v.book = ?1 AND v.chapter = ?2 AND v.verse = ?3 ORDER BY b.installed_at")
        .map_err(err)?;
    let rows = s.query_map(params![book, chapter, verse], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

pub fn find_offer(conn: &Connection, today: &str, id: &str) -> Result<Offer, String> {
    catalog(conn, today, false)?.into_iter().find(|o| o.id == id).ok_or_else(|| "That translation isn't in eBible.org's list any more.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_catalogue() {
        let csv = "\u{feff}\"languageCode\",\"translationId\",\"languageName\",\"languageNameInEnglish\",\"title\",\"description\",\"Redistributable\",\"Copyright\",\"OTbooks\",\"NTbooks\",\"textDirection\",\"downloadable\",\"shortTitle\"\n\
            \"deu\",\"deu1912\",\"Deutsch\",\"German, Standard\",\"Lutherbibel 1912\",\"The Holy Bible, \"\"Luther\"\"\",\"True\",\"public domain\",\"39\",\"27\",\"ltr\",\"True\",\"German Luther Bible 1912\"\n\
            \"xyz\",\"xyz\",\"X\",\"X\",\"T\",\"D\",\"False\",\"©\",\"0\",\"27\",\"ltr\",\"True\",\"\"\n";
        let offers = parse_catalog(csv);
        assert_eq!(offers.len(), 1, "only what may be redistributed");
        assert_eq!(offers[0].id, "deu1912");
        assert_eq!(offers[0].title, "German Luther Bible 1912");
        assert_eq!(offers[0].description, "The Holy Bible, \"Luther\"");
        assert_eq!(offers[0].language_own, "Deutsch");
    }

    #[test]
    fn knows_the_book_codes() {
        assert_eq!(book_of("JOH"), Some("John"));
        assert_eq!(book_of("JHN"), Some("John"));
        assert_eq!(book_of("SOL"), Some("Song of Solomon"));
        assert_eq!(book_of("TOB"), None);
    }

    #[test]
    fn counts_days() {
        assert_eq!(days_between("2026-02-27", "2026-03-01"), Some(2));
        assert_eq!(days_between("2025-12-31", "2026-01-01"), Some(1));
        assert_eq!(days_between("bad", "2026-01-01"), None);
    }
}
