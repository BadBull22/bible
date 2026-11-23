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
            red TEXT, PRIMARY KEY (code, book, chapter, verse)) WITHOUT ROWID;
         CREATE TABLE IF NOT EXISTS catalog (id INTEGER PRIMARY KEY CHECK (id = 1), fetched_on TEXT NOT NULL, csv TEXT NOT NULL);",
    )
    .map_err(err)?;
    // the words of Jesus of a Bible added from a file (inclusive word ranges as JSON), added to older databases
    let has_red = conn.prepare("SELECT 1 FROM pragma_table_info('verses') WHERE name = 'red'").map_err(err)?.exists([]).map_err(err)?;
    if !has_red {
        conn.execute_batch("ALTER TABLE verses ADD COLUMN red TEXT").map_err(err)?;
    }
    // the words that carry Strong's numbers, of a Bible added from a file that has them (JSON [[word, "H430 H853"], ...], as in the built-in Bibles)
    let has_words = conn.prepare("SELECT 1 FROM pragma_table_info('verses') WHERE name = 'words'").map_err(err)?.exists([]).map_err(err)?;
    if !has_words {
        conn.execute_batch("ALTER TABLE verses ADD COLUMN words TEXT").map_err(err)?;
    }
    Ok(())
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
    /// eBible.org's translation id ("engwebp"), or for a SWORD source "source/Module" ("crosswire/Afr1953")
    pub id: String,
    /// the translation's code once it is on the phone (eBible.org: the id; SWORD: the module name in capitals, "AFR1953")
    pub code: String,
    /// "ebible", or a SWORD source of the phone's (`library::PHONE_SOURCES`)
    pub source: String,
    /// "eBible.org", "CrossWire", ...
    pub source_name: String,
    pub language: String,
    /// the language's name in itself, when it differs
    pub language_own: String,
    pub title: String,
    pub description: String,
    pub copyright: String,
    pub ot_books: i64,
    pub nt_books: i64,
    /// whether the book counts are known (a SWORD catalogue does not say which books a Bible has)
    pub books_known: bool,
    /// download size, when the source says (KB)
    pub size_kb: i64,
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
            let id = field(r, "translationId");
            Offer {
                code: id.clone(),
                id,
                source: "ebible".into(),
                source_name: "eBible.org".into(),
                language_own: if own != english { own } else { String::new() },
                language: english,
                title: if short.trim().is_empty() { field(r, "title") } else { short },
                description: field(r, "description"),
                copyright: field(r, "Copyright"),
                ot_books: num(r, "OTbooks"),
                nt_books: num(r, "NTbooks"),
                books_known: true,
                size_kb: 0,
                rtl: field(r, "textDirection") == "rtl",
                installed: false,
            }
        })
        .filter(|o| !o.id.is_empty())
        .collect();
    out.sort_by(|a, b| a.language.cmp(&b.language).then((b.ot_books + b.nt_books).cmp(&(a.ot_books + a.nt_books))).then(a.title.cmp(&b.title)));
    out
}

/// eBible.org's catalogue file, fetched at most once a week (or when `refresh`); the last copy when the phone is offline.
pub fn catalog_csv(conn: &Connection, today: &str, refresh: bool) -> Result<String, String> {
    let cached: Option<(String, String)> = conn.query_row("SELECT fetched_on, csv FROM catalog WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?))).optional().map_err(err)?;
    let stale = cached.as_ref().map_or(true, |(on, _)| refresh || days_between(on, today).map_or(true, |d| d >= 7));
    Ok(if stale {
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
    })
}

/// eBible.org's translations, with what is installed marked.
pub fn catalog(conn: &Connection, today: &str, refresh: bool) -> Result<Vec<Offer>, String> {
    let csv = catalog_csv(conn, today, refresh)?;
    let installed: Vec<String> = installed(conn)?.into_iter().map(|b| b.code).collect();
    Ok(parse_catalog(&csv).into_iter().map(|mut o| {
        o.installed = installed.contains(&o.id);
        o
    }).collect())
}

// ---------------------------------------------------------------- Bibles from the SWORD sources (since 3.2.1)

/// eBible.org's language codes (ISO 639-3, "deu") with their English names ("German, Standard"), from its catalogue file.
pub fn language_names(csv: &str) -> HashMap<String, String> {
    let rows = csv_rows(csv);
    let Some(head) = rows.first() else { return HashMap::new() };
    let (Some(code), Some(name)) = (head.iter().position(|h| h == "languageCode"), head.iter().position(|h| h == "languageNameInEnglish")) else { return HashMap::new() };
    rows.iter()
        .skip(1)
        .filter_map(|r| Some((r.get(code)?.trim().to_ascii_lowercase(), r.get(name)?.trim().to_string())))
        .filter(|(c, n)| !c.is_empty() && !n.is_empty())
        .collect()
}

/// The two-letter language codes (ISO 639-1) SWORD modules mostly give ("af"), with their English names.
const ISO1: &[(&str, &str)] = &[
    ("aa", "Afar"), ("ab", "Abkhazian"), ("af", "Afrikaans"), ("ak", "Akan"), ("am", "Amharic"), ("an", "Aragonese"), ("ar", "Arabic"), ("as", "Assamese"),
    ("av", "Avaric"), ("ay", "Aymara"), ("az", "Azerbaijani"), ("ba", "Bashkir"), ("be", "Belarusian"), ("bg", "Bulgarian"), ("bi", "Bislama"), ("bm", "Bambara"),
    ("bn", "Bengali"), ("bo", "Tibetan"), ("br", "Breton"), ("bs", "Bosnian"), ("ca", "Catalan"), ("ce", "Chechen"), ("ch", "Chamorro"), ("co", "Corsican"),
    ("cr", "Cree"), ("cs", "Czech"), ("cu", "Church Slavonic"), ("cv", "Chuvash"), ("cy", "Welsh"), ("da", "Danish"), ("de", "German"), ("dv", "Divehi"),
    ("dz", "Dzongkha"), ("ee", "Ewe"), ("el", "Greek"), ("en", "English"), ("eo", "Esperanto"), ("es", "Spanish"), ("et", "Estonian"), ("eu", "Basque"),
    ("fa", "Persian"), ("ff", "Fulah"), ("fi", "Finnish"), ("fj", "Fijian"), ("fo", "Faroese"), ("fr", "French"), ("fy", "Frisian"), ("ga", "Irish"),
    ("gd", "Scottish Gaelic"), ("gl", "Galician"), ("gn", "Guarani"), ("gu", "Gujarati"), ("gv", "Manx"), ("ha", "Hausa"), ("he", "Hebrew"), ("hi", "Hindi"),
    ("ho", "Hiri Motu"), ("hr", "Croatian"), ("ht", "Haitian Creole"), ("hu", "Hungarian"), ("hy", "Armenian"), ("hz", "Herero"), ("ia", "Interlingua"),
    ("id", "Indonesian"), ("ie", "Interlingue"), ("ig", "Igbo"), ("ii", "Sichuan Yi"), ("ik", "Inupiaq"), ("io", "Ido"), ("is", "Icelandic"), ("it", "Italian"),
    ("iu", "Inuktitut"), ("ja", "Japanese"), ("jv", "Javanese"), ("ka", "Georgian"), ("kg", "Kongo"), ("ki", "Kikuyu"), ("kj", "Kuanyama"), ("kk", "Kazakh"),
    ("kl", "Greenlandic"), ("km", "Khmer"), ("kn", "Kannada"), ("ko", "Korean"), ("kr", "Kanuri"), ("ks", "Kashmiri"), ("ku", "Kurdish"), ("kv", "Komi"),
    ("kw", "Cornish"), ("ky", "Kyrgyz"), ("la", "Latin"), ("lb", "Luxembourgish"), ("lg", "Ganda"), ("li", "Limburgish"), ("ln", "Lingala"), ("lo", "Lao"),
    ("lt", "Lithuanian"), ("lu", "Luba-Katanga"), ("lv", "Latvian"), ("mg", "Malagasy"), ("mh", "Marshallese"), ("mi", "Maori"), ("mk", "Macedonian"),
    ("ml", "Malayalam"), ("mn", "Mongolian"), ("mr", "Marathi"), ("ms", "Malay"), ("mt", "Maltese"), ("my", "Burmese"), ("na", "Nauru"), ("nb", "Norwegian Bokmål"),
    ("nd", "North Ndebele"), ("ne", "Nepali"), ("ng", "Ndonga"), ("nl", "Dutch"), ("nn", "Norwegian Nynorsk"), ("no", "Norwegian"), ("nr", "South Ndebele"),
    ("nv", "Navajo"), ("ny", "Chichewa"), ("oc", "Occitan"), ("oj", "Ojibwe"), ("om", "Oromo"), ("or", "Odia"), ("os", "Ossetian"), ("pa", "Punjabi"), ("pi", "Pali"),
    ("pl", "Polish"), ("ps", "Pashto"), ("pt", "Portuguese"), ("qu", "Quechua"), ("rm", "Romansh"), ("rn", "Kirundi"), ("ro", "Romanian"), ("ru", "Russian"),
    ("rw", "Kinyarwanda"), ("sa", "Sanskrit"), ("sc", "Sardinian"), ("sd", "Sindhi"), ("se", "Northern Sami"), ("sg", "Sango"), ("si", "Sinhala"), ("sk", "Slovak"),
    ("sl", "Slovenian"), ("sm", "Samoan"), ("sn", "Shona"), ("so", "Somali"), ("sq", "Albanian"), ("sr", "Serbian"), ("ss", "Swati"), ("st", "Sesotho"),
    ("su", "Sundanese"), ("sv", "Swedish"), ("sw", "Swahili"), ("ta", "Tamil"), ("te", "Telugu"), ("tg", "Tajik"), ("th", "Thai"), ("ti", "Tigrinya"),
    ("tk", "Turkmen"), ("tl", "Tagalog"), ("tn", "Setswana"), ("to", "Tongan"), ("tr", "Turkish"), ("ts", "Tsonga"), ("tt", "Tatar"), ("tw", "Twi"),
    ("ty", "Tahitian"), ("ug", "Uyghur"), ("uk", "Ukrainian"), ("ur", "Urdu"), ("uz", "Uzbek"), ("ve", "Venda"), ("vi", "Vietnamese"), ("vo", "Volapük"),
    ("wa", "Walloon"), ("wo", "Wolof"), ("xh", "Xhosa"), ("yi", "Yiddish"), ("yo", "Yoruba"), ("za", "Zhuang"), ("zh", "Chinese"), ("zu", "Zulu"),
];

/// Old and scholarly languages SWORD Bibles come in that eBible.org's list may not name.
const ANCIENT: &[(&str, &str)] = &[
    ("grc", "Greek (ancient)"), ("hbo", "Hebrew (ancient)"), ("arc", "Aramaic"), ("syr", "Syriac"), ("cop", "Coptic"), ("got", "Gothic"),
    ("enm", "English (Middle)"), ("ang", "English (Old)"), ("gez", "Ge'ez"), ("chu", "Church Slavonic"), ("lzh", "Chinese (Classical)"), ("tlh", "Klingon"),
];

/// A language's English name from the code a module gives ("af", "grc", "pt-BR"); the code itself when it is not known.
pub fn language_of(code: &str, names: &HashMap<String, String>) -> String {
    let base = code.trim().split(['-', '_']).next().unwrap_or("").to_ascii_lowercase();
    if base.is_empty() {
        return "Other".into();
    }
    if let Some((_, n)) = ISO1.iter().chain(ANCIENT.iter()).find(|(c, _)| *c == base) {
        return (*n).to_string();
    }
    names.get(&base).cloned().unwrap_or_else(|| code.trim().to_string())
}

/// A Bible a SWORD source offers, as an offer on the Bibles screen.
pub fn sword_offer(item: &bible_core::library::CatalogItem, rtl: bool, names: &HashMap<String, String>, installed: &[String]) -> Offer {
    let code = crate::modules::code_of(&item.name, &item.name);
    let source_name = bible_core::library::source(&item.source).map(|s| s.name).unwrap_or("CrossWire").to_string();
    Offer {
        id: format!("{}/{}", item.source, item.name),
        installed: installed.iter().any(|c| c.eq_ignore_ascii_case(&code)),
        code,
        source: item.source.clone(),
        source_name,
        language: language_of(&item.lang, names),
        language_own: String::new(),
        title: item.title.trim().to_string(),
        description: item.about.chars().take(1200).collect(),
        copyright: item.licence.clone(),
        ot_books: 0,
        nt_books: 0,
        books_known: false,
        size_kb: item.size_kb,
        rtl,
    }
}

/// eBible.org's offers and the SWORD sources' Bibles in one list: a SWORD Bible with the same name and language as one of eBible.org's is left out
/// (eBible.org's verse files are the cleaner of the two), and the list is in the order of the languages, then whole Bibles first.
pub fn merge(ebible: Vec<Offer>, sword: Vec<Offer>) -> Vec<Offer> {
    let key = |o: &Offer| (o.language.to_lowercase(), o.title.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect::<String>());
    let have: std::collections::HashSet<(String, String)> = ebible.iter().map(key).collect();
    let mut out = ebible;
    out.extend(sword.into_iter().filter(|o| !have.contains(&key(o))));
    let size = |o: &Offer| if o.books_known { o.ot_books + o.nt_books } else { 1 };
    out.sort_by(|a, b| a.language.cmp(&b.language).then(size(b).cmp(&size(a))).then(a.title.cmp(&b.title)));
    out
}

// ---------------------------------------------------------------- searching a downloaded Bible (since 3.2.1)

/// A letter without its accent, lower case ("Ê" -> "e"), so that "seen" finds "seën" and "Here" finds "Here".
fn fold_char(c: char) -> char {
    const FROM: &str = "àáâãäåāăąçćčďèéêëēĕėęěìíîïĩīĭįłñńňòóôõöøōŏőŕřśšşťùúûüũūŭůűųýÿźżž";
    const TO: &str = "aaaaaaaaacccdeeeeeeeeeiiiiiiiilnnnooooooooorrssstuuuuuuuuuuyyzzz";
    let lower = c.to_lowercase().next().unwrap_or(c);
    match FROM.chars().position(|f| f == lower) {
        Some(i) => TO.chars().nth(i).unwrap_or(lower),
        None => lower,
    }
}

/// The words of a text, folded (no accents, lower case), in order.
fn words_of(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut word = String::new();
    for c in text.chars() {
        if c.is_alphanumeric() {
            word.push(fold_char(c));
        } else if !word.is_empty() {
            out.push(std::mem::take(&mut word));
        }
    }
    if !word.is_empty() {
        out.push(word);
    }
    out
}

/// Where the book stands among the 66 (0 = Genesis), for putting results in Bible order.
fn book_index(name: &str) -> usize {
    CODES.iter().position(|(_, _, n)| *n == name).unwrap_or(99)
}

/// Verses of a downloaded Bible with every word typed (a word of four letters or more also finds longer words that begin with it: "lief" finds
/// "liefde"). Verses with the words together, in the order typed, come first; then the order of the Bible. Returns the verses (at most `limit`)
/// and how many verses have the words word for word.
pub fn search(conn: &Connection, code: &str, query: &str, testament: Option<&str>, book: Option<&str>, limit: usize) -> Result<(Vec<crate::search::Hit>, i64), String> {
    let asked = words_of(query);
    if asked.is_empty() {
        return Ok((Vec::new(), 0));
    }
    let mut s = conn.prepare("SELECT book, chapter, verse, text FROM verses WHERE code = ?1 AND (?2 IS NULL OR book = ?2)").map_err(err)?;
    let rows = s.query_map(params![code, book], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?))).map_err(err)?;
    let mut found: Vec<(bool, usize, i64, i64, String, String)> = Vec::new();
    let mut exact = 0i64;
    for row in rows {
        let (b, chapter, verse, text) = row.map_err(err)?;
        let at = book_index(&b);
        match testament {
            Some("OT") if at >= 39 => continue,
            Some("NT") if !(39..66).contains(&at) => continue,
            _ => {}
        }
        let words = words_of(&text);
        let has = |w: &String| words.iter().any(|x| x == w || (w.chars().count() >= 4 && x.starts_with(w.as_str())));
        if !asked.iter().all(has) {
            continue;
        }
        let together = words.windows(asked.len()).any(|win| win == asked.as_slice());
        if together {
            exact += 1;
        }
        found.push((together, at, chapter, verse, b, text));
    }
    found.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)).then(a.3.cmp(&b.3)));
    let hits = found
        .into_iter()
        .take(limit)
        .map(|(together, _, chapter, verse, book, text)| crate::search::Hit { book, chapter, verse, verse_end: verse, why: vec![if together { "phrase" } else { "words" }.into()], text })
        .collect();
    Ok((hits, exact))
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
    let mut s = conn.prepare("SELECT verse, text, red FROM verses WHERE code = ?1 AND book = ?2 AND chapter = ?3 ORDER BY verse").map_err(err)?;
    let rows = s
        .query_map(params![code, book, chapter], |r| {
            let red: Option<String> = r.get(2)?;
            Ok(Verse { verse: r.get(0)?, text: r.get(1)?, red: red.and_then(|j| serde_json::from_str(&j).ok()).unwrap_or_default() })
        })
        .map_err(err)?;
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

// ---------------------------------------------------------------- a Bible inside a backup file

/// One Bible's text inside a backup file: only a Bible the reader added (never one that comes with the app), so that it is not lost with the phone. The
/// computer's app ignores this part of the file.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, PartialEq)]
pub struct BibleBackup {
    pub code: String,
    pub name: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub copyright: String,
    #[serde(default)]
    pub rtl: bool,
    /// `[book, chapter, verse, text]`, and for a Bible that has them a fifth entry (the words of Jesus, as JSON) and a sixth (the words that carry Strong's
    /// numbers, as JSON)
    pub verses: Vec<Vec<serde_json::Value>>,
}

/// The most verses, and the longest verse, a backup may bring (a whole Bible is about 31,000 verses).
const MAX_BACKUP_VERSES: usize = 40_000;
const MAX_VERSE_CHARS: usize = 6_000;

/// The whole text of one added Bible for a backup file (nothing when it is not here).
pub fn export(conn: &Connection, code: &str) -> Result<Option<BibleBackup>, String> {
    let head: Option<(String, String, String, i64)> = conn
        .query_row("SELECT name, language, copyright, rtl FROM bibles WHERE code = ?1", params![code], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .optional()
        .map_err(err)?;
    let Some((name, language, copyright, rtl)) = head else { return Ok(None) };
    let mut s = conn.prepare("SELECT book, chapter, verse, text, red, words FROM verses WHERE code = ?1").map_err(err)?;
    let rows = s
        .query_map(params![code], |r| {
            let (red, words): (Option<String>, Option<String>) = (r.get(4)?, r.get(5)?);
            let mut row: Vec<serde_json::Value> = vec![r.get::<_, String>(0)?.into(), r.get::<_, i64>(1)?.into(), r.get::<_, i64>(2)?.into(), r.get::<_, String>(3)?.into()];
            if red.is_some() || words.is_some() {
                row.push(red.map(serde_json::Value::from).unwrap_or(serde_json::Value::Null));
                if let Some(w) = words {
                    row.push(w.into());
                }
            }
            Ok(row)
        })
        .map_err(err)?;
    let mut verses: Vec<Vec<serde_json::Value>> = rows.collect::<Result<_, _>>().map_err(err)?;
    // in the order of the Bible, so the file reads like one
    let order = |b: &serde_json::Value| CODES.iter().position(|(_, _, n)| Some(*n) == b.as_str()).unwrap_or(99);
    verses.sort_by_key(|v| (order(&v[0]), v[1].as_i64().unwrap_or(0), v[2].as_i64().unwrap_or(0)));
    Ok(Some(BibleBackup { code: code.to_string(), name, language, copyright, rtl: rtl != 0, verses }))
}

/// Puts a Bible from a backup file among the added Bibles, when its code is not already here and is not one that comes with the app (`bundled`).
/// Every value is checked: a file from anywhere cannot put anything but Bible text in. Returns how many verses were added (0 when it was skipped).
pub fn import_backup(conn: &mut Connection, b: &BibleBackup, bundled: &[String]) -> Result<usize, String> {
    let code_ok = !b.code.is_empty() && b.code.len() <= 40 && b.code.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !code_ok || b.name.trim().is_empty() || b.name.len() > 200 || b.language.len() > 100 || b.copyright.len() > 2_000 || b.verses.is_empty() || b.verses.len() > MAX_BACKUP_VERSES {
        return Err("The Bible in that backup isn't one this version can read.".into());
    }
    if bundled.iter().any(|c| c == &b.code) || is_installed(conn, &b.code) {
        return Ok(0);
    }
    let tx = conn.transaction().map_err(err)?;
    tx.execute("INSERT INTO bibles (code, name, language, copyright, rtl) VALUES (?1,?2,?3,?4,?5)", params![b.code, b.name.trim(), b.language, b.copyright, i64::from(b.rtl)]).map_err(err)?;
    let mut n = 0;
    {
        let mut ins = tx.prepare("INSERT OR IGNORE INTO verses (code, book, chapter, verse, text, red, words) VALUES (?1,?2,?3,?4,?5,?6,?7)").map_err(err)?;
        for row in &b.verses {
            let (Some(book), Some(chapter), Some(verse), Some(text)) = (row.first().and_then(|v| v.as_str()), row.get(1).and_then(|v| v.as_i64()), row.get(2).and_then(|v| v.as_i64()), row.get(3).and_then(|v| v.as_str())) else {
                continue;
            };
            if CODES.iter().all(|(_, _, name)| *name != book) || !(1..=200).contains(&chapter) || !(1..=300).contains(&verse) || text.trim().is_empty() || text.chars().count() > MAX_VERSE_CHARS {
                continue;
            }
            let extra = |i: usize| row.get(i).and_then(|v| v.as_str()).filter(|t| t.len() <= 40_000).map(str::to_string);
            n += ins.execute(params![b.code, book, chapter, verse, text, extra(4), extra(5)]).map_err(err)?;
        }
    }
    if n == 0 {
        return Err("The Bible in that backup has no verses this version can read.".into());
    }
    tx.commit().map_err(err)?;
    Ok(n)
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

    fn item(source: &str, name: &str, lang: &str, title: &str) -> bible_core::library::CatalogItem {
        bible_core::library::CatalogItem {
            name: name.into(),
            kind: "bible".into(),
            title: title.into(),
            lang: lang.into(),
            language: String::new(),
            licence: "Copyrighted; Permission to distribute granted to CrossWire".into(),
            about: "About it".into(),
            size_kb: 1500,
            version: "1.0".into(),
            category: String::new(),
            questionable: false,
            supported: true,
            note: None,
            built_in: false,
            installed: false,
            installed_version: None,
            source: source.into(),
        }
    }

    #[test]
    fn names_the_languages_sword_modules_give() {
        let names: HashMap<String, String> = [("deu".to_string(), "German, Standard".to_string()), ("kek".to_string(), "Q'eqchi'".to_string())].into_iter().collect();
        assert_eq!(language_of("af", &names), "Afrikaans");
        assert_eq!(language_of("pt-BR", &names), "Portuguese");
        assert_eq!(language_of("grc", &names), "Greek (ancient)");
        assert_eq!(language_of("kek", &names), "Q'eqchi'", "a three-letter code from eBible.org's list");
        assert_eq!(language_of("xyz", &names), "xyz");
        assert_eq!(language_of("", &names), "Other");
    }

    #[test]
    fn a_sword_bible_becomes_an_offer_and_afrikaans_is_found_by_its_name() {
        let names = HashMap::new();
        let o = sword_offer(&item("crosswire", "Afr1953", "af", "1933/1953 Afrikaans Bybel"), false, &names, &["AFR1953".to_string()]);
        assert_eq!(o.id, "crosswire/Afr1953");
        assert_eq!(o.code, "AFR1953");
        assert_eq!(o.source_name, "CrossWire");
        assert_eq!(o.language, "Afrikaans");
        assert!(o.installed, "the code it gets on the phone is what marks it installed");
        assert!(!o.books_known);
        assert!(o.copyright.contains("CrossWire"), "its own licence is shown");
        let o = sword_offer(&item("wycliffe", "kek", "kek", "Q'eqchi' NT"), true, &names, &[]);
        assert_eq!(o.source_name, "Wycliffe");
        assert!(o.rtl && !o.installed);
    }

    #[test]
    fn merging_keeps_one_of_the_same_bible_and_puts_languages_in_order() {
        let csv = "\"languageCode\",\"translationId\",\"languageName\",\"languageNameInEnglish\",\"title\",\"description\",\"Redistributable\",\"Copyright\",\"OTbooks\",\"NTbooks\",\"textDirection\",\"downloadable\",\"shortTitle\"\n\
            \"deu\",\"deu1912\",\"Deutsch\",\"German\",\"Luther 1912\",\"\",\"True\",\"public domain\",\"39\",\"27\",\"ltr\",\"True\",\"Luther 1912\"\n";
        let ebible = parse_catalog(csv);
        let names = language_names(csv);
        let sword = vec![
            sword_offer(&item("crosswire", "GerLut1912", "de", "Luther 1912"), false, &names, &[]),
            sword_offer(&item("crosswire", "Afr1953", "af", "1933/1953 Afrikaans Bybel"), false, &names, &[]),
        ];
        let all = merge(ebible, sword);
        assert_eq!(all.iter().map(|o| o.id.as_str()).collect::<Vec<_>>(), vec!["crosswire/Afr1953", "deu1912"], "the same Luther once, from eBible.org");
    }

    #[test]
    fn the_letter_table_lines_up() {
        assert_eq!(fold_char('Ê'), 'e');
        assert_eq!(fold_char('ë'), 'e');
        assert_eq!(fold_char('ô'), 'o');
        assert_eq!(fold_char('ž'), 'z');
        assert_eq!(fold_char('ø'), 'o');
        assert_eq!(fold_char('Q'), 'q');
        assert_eq!(words_of("Want so lief het God die wêreld gehad, dat Hy sy eniggebore Seun gegee het"), vec!["want", "so", "lief", "het", "god", "die", "wereld", "gehad", "dat", "hy", "sy", "eniggebore", "seun", "gegee", "het"]);
    }

    #[test]
    fn a_downloaded_bible_is_searched_itself() {
        let conn = Connection::open_in_memory().unwrap();
        init(&conn).unwrap();
        conn.execute("INSERT INTO bibles (code, name, language, copyright) VALUES ('AFR1953', 'Afrikaans', 'Afrikaans', 'x')", []).unwrap();
        for (b, c, v, t) in [
            ("Genesis", 1, 1, "In die begin het God die hemel en die aarde geskape."),
            ("John", 3, 16, "Want so lief het God die wêreld gehad, dat Hy sy eniggebore Seun gegee het."),
            ("1 John", 4, 8, "Wie nie liefhet nie, ken God nie, want God is liefde."),
        ] {
            conn.execute("INSERT INTO verses (code, book, chapter, verse, text) VALUES ('AFR1953', ?1, ?2, ?3, ?4)", params![b, c, v, t]).unwrap();
        }
        let (hits, exact) = search(&conn, "AFR1953", "lief het God", None, None, 50).unwrap();
        assert_eq!(exact, 1, "the words together, in the order typed");
        assert_eq!((hits[0].book.as_str(), hits[0].chapter, hits[0].verse), ("John", 3, 16));
        let (hits, _) = search(&conn, "AFR1953", "WERELD", None, None, 50).unwrap();
        assert_eq!(hits.len(), 1, "no accent and any case still finds wêreld");
        let (hits, _) = search(&conn, "AFR1953", "lief", None, None, 50).unwrap();
        assert_eq!(hits.len(), 2, "lief, and liefhet / liefde (a word of four letters finds longer words that begin with it)");
        let (hits, _) = search(&conn, "AFR1953", "God", Some("OT"), None, 50).unwrap();
        assert_eq!(hits.iter().map(|h| h.book.as_str()).collect::<Vec<_>>(), vec!["Genesis"]);
        let (hits, _) = search(&conn, "AFR1953", "God", None, Some("1 John"), 50).unwrap();
        assert_eq!(hits.len(), 1);
        let (hits, exact) = search(&conn, "AFR1953", "!!", None, None, 50).unwrap();
        assert!(hits.is_empty() && exact == 0);
        let (hits, _) = search(&conn, "OTHER", "God", None, None, 50).unwrap();
        assert!(hits.is_empty(), "only the Bible asked for");
    }

    #[test]
    fn counts_days() {
        assert_eq!(days_between("2026-02-27", "2026-03-01"), Some(2));
        assert_eq!(days_between("2025-12-31", "2026-01-01"), Some(1));
        assert_eq!(days_between("bad", "2026-01-01"), None);
    }
}
