//! Modules from e-Sword (.bblx, .cmtx, .dctx, .topx, .lexx, .devx, .refx, and the older
//! .bbli/.cmti/.dcti/.topi) and MySword (.bbl.mybible, .cmt.mybible, .dct.mybible,
//! .bok.mybible) that the reader already has, read into the Library like a SWORD module.
//!
//! Both programs keep a module in an SQLite database. The tables are found by their columns
//! rather than assumed, because module makers' tools differ:
//!   - a Bible: `Bible(Book, Chapter, Verse, Scripture)`, books numbered 1-66;
//!   - a commentary: MySword `commentary(book, chapter, fromverse, toverse, data)`; e-Sword
//!     `VerseCommentary`/`ChapterCommentary`/`BookCommentary` (Book, Chapter[Begin], Verse[Begin], Comments);
//!   - a dictionary or lexicon: `dictionary(word, data)` / `Dictionary(Topic, Definition)` / `Lexicon(...)`;
//!   - topics: `Topics(Title, Notes)` (treated as a dictionary of subjects);
//!   - a devotional: a table with Month and Day columns;
//!   - a book: MySword `journal(title, content, relativeorder, hidden)`, or any table of titles and texts.
//! e-Sword text is RTF; MySword's is HTML (Bibles: GBF-style tags). Both become the app's
//! text with ⟦..⟧ Scripture markers.
//!
//! **Locked modules are not opened.** e-Sword's own and bought modules are encrypted (their
//! text is ciphertext in BLOBs, with an `sqliteplus_license` table). They are recognised and
//! refused with a plain explanation; nothing tries to read them.

use std::path::Path;

use regex::{Captures, Regex};
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};

use crate::markup::{self, Kind};
use crate::refs::{self, OSIS};

/// What a module file holds, read and converted, ready to be added to the Library.
#[derive(Debug, Default)]
pub struct Module {
    /// "bible" | "commentary" | "dictionary" | "devotional" | "book"
    pub kind: &'static str,
    /// "e-Sword" or "MySword"
    pub program: &'static str,
    pub abbreviation: String,
    pub title: String,
    pub lang: String,
    pub about: String,
    pub copyright: String,
    /// a lexicon keyed by Strong's numbers
    pub strongs: bool,
    /// Bible verses: (book, chapter, verse, text)
    pub verses: Vec<(&'static str, i64, i64, String)>,
    /// commentary notes: (book, chapter, first verse, text); chapter 0 = on the book, verse 0 = on the chapter
    pub notes: Vec<(&'static str, i64, i64, String)>,
    /// dictionary / devotional entries: (key, headword, body)
    pub entries: Vec<(String, String, String)>,
    /// book sections: (title, text)
    pub sections: Vec<(String, String)>,
    /// things the reader should know
    pub warnings: Vec<String>,
}

/// The first bytes of every SQLite database file.
pub fn is_sqlite(bytes: &[u8]) -> bool {
    bytes.starts_with(b"SQLite format 3\0")
}

/// File names this importer takes (also inside a .zip or .gz).
pub fn is_module_name(name: &str) -> bool {
    let n = name.to_lowercase();
    [".bblx", ".cmtx", ".dctx", ".topx", ".lexx", ".devx", ".refx", ".bbli", ".cmti", ".dcti", ".topi", ".lexi", ".devi", ".mybible"]
        .iter()
        .any(|e| n.ends_with(e))
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

const LOCKED: &str = "This module is locked by its publisher (encrypted), so it can only be opened in the program it was made for. Modules bought from e-Sword's store, and e-Sword's own Bibles, are locked this way. Free modules made by e-Sword and MySword users usually open.";

// ---------------------------------------------------------------- reading the database

fn tables(c: &Connection) -> Result<Vec<(String, Vec<String>)>, String> {
    let names: Vec<String> = c
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
        .map_err(err)?
        .query_map([], |r| r.get(0))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    let mut out = Vec::new();
    for n in names {
        let cols: Vec<String> = c
            .prepare(&format!("PRAGMA table_info(\"{}\")", n.replace('"', "")))
            .map_err(err)?
            .query_map([], |r| r.get(1))
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)?;
        out.push((n, cols));
    }
    Ok(out)
}

/// A column of `cols` named like one of `names` (any case).
fn col<'a>(cols: &'a [String], names: &[&str]) -> Option<&'a str> {
    names.iter().find_map(|n| cols.iter().find(|c| c.eq_ignore_ascii_case(n)).map(String::as_str))
}

/// Topics that are a book rather than a dictionary: up to 60 of them, and either long
/// (2,000 characters on average) or numbered like chapters.
fn reads_as_book(entries: &[(String, String, String)]) -> bool {
    if entries.is_empty() || entries.len() > 60 {
        return false;
    }
    let average = entries.iter().map(|e| e.2.chars().count()).sum::<usize>() / entries.len();
    let numbered = entries.iter().filter(|e| e.1.trim_start().starts_with(|c: char| c.is_ascii_digit())).count();
    average >= 2000 || numbered * 2 > entries.len()
}

/// A cell's text. A BLOB that isn't text is the sign of an encrypted module.
fn text_of(v: ValueRef) -> Result<String, String> {
    match v {
        ValueRef::Null => Ok(String::new()),
        ValueRef::Text(t) => Ok(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Integer(i) => Ok(i.to_string()),
        ValueRef::Real(f) => Ok(f.to_string()),
        ValueRef::Blob(b) => match std::str::from_utf8(b) {
            Ok(s) if !s.contains('\0') => Ok(s.to_string()),
            _ => Err(LOCKED.into()),
        },
    }
}

fn int_of(v: ValueRef) -> i64 {
    match v {
        ValueRef::Integer(i) => i,
        ValueRef::Real(f) => f as i64,
        ValueRef::Text(t) => String::from_utf8_lossy(t).trim().parse().unwrap_or(0),
        _ => 0,
    }
}

/// Rows of chosen columns, as text (`ints` marks the ones read as numbers).
fn rows(c: &Connection, table: &str, cols: &[&str], ints: &[bool], order: &str) -> Result<Vec<Vec<(String, i64)>>, String> {
    let sql = format!(
        "SELECT {} FROM \"{}\"{}",
        cols.iter().map(|c| format!("\"{}\"", c.replace('"', ""))).collect::<Vec<_>>().join(", "),
        table.replace('"', ""),
        if order.is_empty() { String::new() } else { format!(" ORDER BY {order}") }
    );
    let mut stmt = c.prepare(&sql).map_err(err)?;
    let mut q = stmt.query([]).map_err(err)?;
    let mut out = Vec::new();
    while let Some(r) = q.next().map_err(err)? {
        let mut row = Vec::with_capacity(cols.len());
        for (i, is_int) in ints.iter().enumerate() {
            let v = r.get_ref(i).map_err(err)?;
            row.push(if *is_int { (String::new(), int_of(v)) } else { (text_of(v)?, 0) });
        }
        out.push(row);
    }
    Ok(out)
}

fn book_name(n: i64) -> Option<&'static str> {
    usize::try_from(n).ok().filter(|n| (1..=66).contains(n)).map(|n| OSIS[n - 1].1)
}

// ---------------------------------------------------------------- the text

/// Windows-1252 for the bytes RTF writes as \'hh.
fn cp1252(b: u8) -> char {
    const HIGH: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž', '\u{8f}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š',
        '›', 'œ', '\u{9d}', 'ž', 'Ÿ',
    ];
    if (0x80..0xA0).contains(&b) {
        HIGH[(b - 0x80) as usize]
    } else {
        b as char
    }
}

/// RTF (whole documents or the fragments e-Sword stores) -> plain text with "\n" between
/// paragraphs. Fonts, colours, styles and other destinations are skipped.
/// Marks the end of a table cell while converting (replaced before the text is returned).
const CELL: char = '\u{1f}';

pub fn rtf_to_text(rtf: &str) -> String {
    const SKIP: [&str; 20] = [
        "fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr", "footerl", "footerr", "themedata", "datastore", "latentstyles",
        "rsidtbl", "generator", "listtable", "listoverridetable", "xmlnstbl", "filetbl",
    ];
    let chars: Vec<char> = rtf.chars().collect();
    let mut out = String::new();
    // per group: skipping it, and how many characters stand in for a \u character
    let mut stack: Vec<(bool, usize)> = vec![(false, 1)];
    let mut pending_skip = 0usize;
    let mut i = 0;
    let push = |out: &mut String, stack: &[(bool, usize)], ch: char| {
        if !stack.last().map(|s| s.0).unwrap_or(false) {
            out.push(ch);
        }
    };
    while i < chars.len() {
        let c = chars[i];
        match c {
            '{' => {
                let (skip, uc) = *stack.last().unwrap_or(&(false, 1));
                stack.push((skip, uc));
                i += 1;
                // "{\*\destination ...}": an optional destination nobody needs
                if chars.get(i) == Some(&'\\') && chars.get(i + 1) == Some(&'*') {
                    if let Some(top) = stack.last_mut() {
                        top.0 = true;
                    }
                }
            }
            '}' => {
                if stack.len() > 1 {
                    stack.pop();
                }
                i += 1;
            }
            '\\' => {
                i += 1;
                let Some(&n) = chars.get(i) else { break };
                if n == '\\' || n == '{' || n == '}' {
                    if pending_skip > 0 {
                        pending_skip -= 1;
                    } else {
                        push(&mut out, &stack, n);
                    }
                    i += 1;
                } else if n == '\'' {
                    let hex: String = chars.iter().skip(i + 1).take(2).collect();
                    i += 3;
                    if pending_skip > 0 {
                        pending_skip -= 1;
                    } else if let Ok(b) = u8::from_str_radix(&hex, 16) {
                        push(&mut out, &stack, cp1252(b));
                    }
                } else if n.is_ascii_alphabetic() {
                    let start = i;
                    while i < chars.len() && chars[i].is_ascii_alphabetic() {
                        i += 1;
                    }
                    let word: String = chars[start..i].iter().collect();
                    let ps = i;
                    if i < chars.len() && (chars[i] == '-' || chars[i].is_ascii_digit()) {
                        i += 1;
                        while i < chars.len() && chars[i].is_ascii_digit() {
                            i += 1;
                        }
                    }
                    let param: Option<i64> = if i > ps { chars[ps..i].iter().collect::<String>().parse().ok() } else { None };
                    if chars.get(i) == Some(&' ') {
                        i += 1;
                    }
                    if SKIP.contains(&word.as_str()) {
                        if let Some(top) = stack.last_mut() {
                            top.0 = true;
                        }
                        continue;
                    }
                    match word.as_str() {
                        "par" | "line" | "sect" | "page" | "row" => push(&mut out, &stack, '\n'),
                        // a table: each row a line, its cells kept apart (tidied below)
                        "cell" | "nestcell" => push(&mut out, &stack, CELL),
                        "tab" => push(&mut out, &stack, ' '),
                        "emdash" => push(&mut out, &stack, '—'),
                        "endash" => push(&mut out, &stack, '–'),
                        "bullet" => push(&mut out, &stack, '•'),
                        "lquote" => push(&mut out, &stack, '‘'),
                        "rquote" => push(&mut out, &stack, '’'),
                        "ldblquote" => push(&mut out, &stack, '“'),
                        "rdblquote" => push(&mut out, &stack, '”'),
                        "uc" => {
                            if let Some(top) = stack.last_mut() {
                                top.1 = param.unwrap_or(1).max(0) as usize;
                            }
                        }
                        "u" => {
                            if let Some(p) = param {
                                let code = if p < 0 { p + 65536 } else { p };
                                if let Some(ch) = char::from_u32(code as u32) {
                                    push(&mut out, &stack, ch);
                                }
                                pending_skip = stack.last().map(|s| s.1).unwrap_or(1);
                            }
                        }
                        _ => {}
                    }
                } else {
                    // a control symbol: "\~" non-breaking space, "\-" optional hyphen, ...
                    if n == '~' {
                        push(&mut out, &stack, ' ');
                    }
                    i += 1;
                }
            }
            '\r' | '\n' => i += 1,
            _ => {
                if pending_skip > 0 {
                    pending_skip -= 1;
                } else {
                    push(&mut out, &stack, c);
                }
                i += 1;
            }
        }
    }
    if !out.contains(CELL) {
        return out;
    }
    // a table row: "Gen 3:15 — Seed of a woman — Gal 4:4"
    out.split('\n')
        .map(|line| if line.contains(CELL) { line.split(CELL).map(str::trim).filter(|c| !c.is_empty()).collect::<Vec<_>>().join(" — ") } else { line.to_string() })
        .collect::<Vec<_>>()
        .join("\n")
}

fn rx(cell: &'static std::sync::OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid regex"))
}

macro_rules! rx {
    ($p:expr) => {{
        static CELL: std::sync::OnceLock<Regex> = std::sync::OnceLock::new();
        rx(&CELL, $p)
    }};
}

/// Scripture references written out in plain text ("John 3:16", "1 Cor. 13:4-7") become
/// links, except where a link already is.
/// e-Sword's own book codes, as its reference links are written ("Psa_148:1-5", "1Co_13:4").
const ESWORD_CODES: [(&str, &str); 66] = [
    ("Gen", "Genesis"), ("Exo", "Exodus"), ("Lev", "Leviticus"), ("Num", "Numbers"), ("Deu", "Deuteronomy"), ("Jos", "Joshua"),
    ("Jdg", "Judges"), ("Rut", "Ruth"), ("1Sa", "1 Samuel"), ("2Sa", "2 Samuel"), ("1Ki", "1 Kings"), ("2Ki", "2 Kings"),
    ("1Ch", "1 Chronicles"), ("2Ch", "2 Chronicles"), ("Ezr", "Ezra"), ("Neh", "Nehemiah"), ("Est", "Esther"), ("Job", "Job"),
    ("Psa", "Psalms"), ("Pro", "Proverbs"), ("Ecc", "Ecclesiastes"), ("Son", "Song of Solomon"), ("Isa", "Isaiah"), ("Jer", "Jeremiah"),
    ("Lam", "Lamentations"), ("Eze", "Ezekiel"), ("Dan", "Daniel"), ("Hos", "Hosea"), ("Joe", "Joel"), ("Amo", "Amos"),
    ("Oba", "Obadiah"), ("Jon", "Jonah"), ("Mic", "Micah"), ("Nah", "Nahum"), ("Hab", "Habakkuk"), ("Zep", "Zephaniah"),
    ("Hag", "Haggai"), ("Zec", "Zechariah"), ("Mal", "Malachi"), ("Mat", "Matthew"), ("Mar", "Mark"), ("Luk", "Luke"),
    ("Joh", "John"), ("Act", "Acts"), ("Rom", "Romans"), ("1Co", "1 Corinthians"), ("2Co", "2 Corinthians"), ("Gal", "Galatians"),
    ("Eph", "Ephesians"), ("Php", "Philippians"), ("Col", "Colossians"), ("1Th", "1 Thessalonians"), ("2Th", "2 Thessalonians"), ("1Ti", "1 Timothy"),
    ("2Ti", "2 Timothy"), ("Tit", "Titus"), ("Phm", "Philemon"), ("Heb", "Hebrews"), ("Jas", "James"), ("1Pe", "1 Peter"),
    ("2Pe", "2 Peter"), ("1Jn", "1 John"), ("2Jn", "2 John"), ("3Jn", "3 John"), ("Jud", "Jude"), ("Rev", "Revelation"),
];

/// e-Sword's own reference form ("Psa_148:1-5", "1Co_13:4") as the app's markers, labelled
/// the way a reader writes it ("Psalms 148:1-5").
fn link_esword_refs(text: &str) -> String {
    rx!(r"\b([1-3]?[A-Z][a-z]{1,2})_(\d{1,3}):(\d{1,3})(?:-(\d{1,3}))?")
        .replace_all(text, |c: &Captures| {
            let Some((_, book)) = ESWORD_CODES.iter().find(|(code, _)| *code == &c[1]) else { return c[0].to_string() };
            let Some(book) = refs::resolve_book(book) else { return c[0].to_string() };
            let (chapter, verse): (u32, u32) = (c[2].parse().unwrap_or(0), c[3].parse().unwrap_or(0));
            let end = c.get(4).and_then(|m| m.as_str().parse().ok()).filter(|e: &u32| *e > verse);
            if chapter == 0 || verse == 0 {
                return c[0].to_string();
            }
            let label = format!("{book} {chapter}:{verse}{}", end.map(|e| format!("-{e}")).unwrap_or_default());
            refs::Ref { book, chapter, verse: Some(verse), verse_end: end }.marker(Some(&label))
        })
        .into_owned()
}

pub fn link_plain_refs(text: &str) -> String {
    let text = &link_esword_refs(text);
    let re = rx!(r"\b((?:[1-3]|I{1,3})\s?)?([A-Z][a-z]{1,13})\.?\s+(\d{1,3}):(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?");
    let mut out = String::with_capacity(text.len());
    // the parts outside existing ⟦..⟧ markers
    for (n, part) in text.split('⟦').enumerate() {
        let (inside, outside) = if n == 0 { ("", part) } else { part.split_once('⟧').map(|(a, b)| (a, b)).unwrap_or((part, "")) };
        if n > 0 {
            out.push('⟦');
            out.push_str(inside);
            if part.contains('⟧') {
                out.push('⟧');
            }
        }
        out.push_str(&re.replace_all(outside, |c: &Captures| {
            let name = format!("{}{}", c.get(1).map(|m| m.as_str().trim()).unwrap_or(""), &c[2]);
            let Some(book) = refs::resolve_book(&name) else { return c[0].to_string() };
            let chapter: u32 = c[3].parse().unwrap_or(0);
            let verse: u32 = c[4].parse().unwrap_or(0);
            let end = c.get(5).and_then(|m| m.as_str().parse().ok()).filter(|e| *e > verse);
            if chapter == 0 || verse == 0 {
                return c[0].to_string();
            }
            refs::Ref { book, chapter, verse: Some(verse), verse_end: end }.marker(Some(&c[0]))
        }));
    }
    out
}

/// MySword's links to a verse ("<a class='bible' href='#b43.3.16'>John 3:16</a>") become the
/// app's markers; its other links (to dictionary entries, chapters of a book) keep their words.
fn mysword_links(html: &str) -> String {
    let s = rx!(r#"(?is)<a\b[^>]*href=['"]#b(\d+)\.(\d+)\.(\d+)(?:-(\d+))?['"][^>]*>(.*?)</a>"#).replace_all(html, |c: &Captures| {
        let label = markup::unescape(&rx!(r"<[^>]*>").replace_all(&c[5], ""));
        match book_name(c[1].parse().unwrap_or(0)) {
            Some(book) => refs::Ref { book, chapter: c[2].parse().unwrap_or(1), verse: c[3].parse().ok().filter(|v| *v > 0), verse_end: c.get(4).and_then(|m| m.as_str().parse().ok()) }
                .marker(Some(&label)),
            None => label,
        }
    });
    rx!(r"(?is)<a\b[^>]*>(.*?)</a>").replace_all(&s, "$1").into_owned()
}

/// A cell's text in the app's form. `program` and `kind` decide how it is read.
pub fn convert(raw: &str, program: &str, kind: Kind) -> String {
    let t = raw.trim();
    if t.is_empty() {
        return String::new();
    }
    let rtf = t.starts_with("{\\rtf") || rx!(r"\\(?:par|pard|cf\d|f\d|fs\d+|b0?|i0?|plain)\b").is_match(t);
    let text = if rtf {
        // RTF: plain text, then its written-out references linked (unless a verse)
        let plain = rtf_to_text(t);
        let plain = rx!(r"[ \t]+").replace_all(&plain, " ");
        let plain = rx!(r" *\n *").replace_all(&plain, "\n");
        let plain = rx!(r"\n{3,}").replace_all(&plain, "\n\n").trim().to_string();
        if kind == Kind::Bible {
            return plain.replace('\n', " ").split_whitespace().collect::<Vec<_>>().join(" ");
        }
        return link_plain_refs(&plain);
    } else if program == "MySword" && kind == Kind::Bible {
        markup::to_text(t, "GBF", kind)
    } else if t.contains('<') {
        markup::to_text(&mysword_links(t), "ThML", kind)
    } else {
        markup::to_text(t, "Plaintext", kind)
    };
    if kind == Kind::Bible {
        text
    } else {
        link_plain_refs(&text)
    }
}

// ---------------------------------------------------------------- the module

fn details(c: &Connection, tabs: &[(String, Vec<String>)], m: &mut Module) -> Result<(), String> {
    let Some((table, cols)) = tabs.iter().find(|(n, _)| n.eq_ignore_ascii_case("details")) else { return Ok(()) };
    let get = |names: &[&str]| -> String {
        let Some(cn) = col(cols, names) else { return String::new() };
        c.query_row(&format!("SELECT \"{cn}\" FROM \"{table}\" LIMIT 1"), [], |r| Ok(text_of(r.get_ref(0)?).unwrap_or_default())).unwrap_or_default()
    };
    m.title = get(&["Title", "Description", "name"]);
    m.abbreviation = get(&["Abbreviation"]);
    m.lang = get(&["Language", "lang"]).to_lowercase();
    let about = get(&["Comments", "Information", "description"]);
    m.about = convert(&about, m.program, Kind::Book).chars().take(4000).collect();
    m.copyright = [get(&["Copyright"]), get(&["Publisher"])].into_iter().filter(|s| !s.trim().is_empty()).collect::<Vec<_>>().join(" · ");
    let strong = get(&["Strong", "Strongs"]);
    m.strongs = strong == "1" || strong.eq_ignore_ascii_case("true");
    Ok(())
}

/// Reads a module file. `file_name` helps tell the program and the kind (".lexx" is a lexicon).
pub fn read(path: &Path, file_name: Option<&str>) -> Result<Module, String> {
    let c = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_| "This file isn't a module the app can open.".to_string())?;
    let tabs = tables(&c).map_err(|_| "This file isn't a module the app can open.".to_string())?;
    let lower = file_name.unwrap_or("").to_lowercase();
    let has = |name: &str| tabs.iter().find(|(n, _)| n.eq_ignore_ascii_case(name));
    let mysword = lower.ends_with(".mybible") || has("journal").is_some() || tabs.iter().any(|(n, _)| n == "details" || n == "commentary" || n == "dictionary");
    let mut m = Module { program: if mysword { "MySword" } else { "e-Sword" }, ..Default::default() };
    details(&c, &tabs, &mut m)?;
    let locked_marker = has("sqliteplus_license").is_some();

    // --- a Bible
    if let Some((t, cols)) = has("Bible").filter(|(_, c)| col(c, &["Book"]).is_some() && col(c, &["Scripture"]).is_some()) {
        let (b, ch, v, s) = (col(cols, &["Book"]).unwrap(), col(cols, &["Chapter"]).unwrap_or("Chapter"), col(cols, &["Verse"]).unwrap_or("Verse"), col(cols, &["Scripture"]).unwrap());
        m.kind = "bible";
        let mut extra = 0;
        for r in rows(&c, t, &[b, ch, v, s], &[true, true, true, false], &format!("\"{b}\", \"{ch}\", \"{v}\""))? {
            let Some(book) = book_name(r[0].1) else {
                extra += 1;
                continue;
            };
            if r[1].1 <= 0 || r[2].1 <= 0 {
                continue;
            }
            let text = convert(&r[3].0, m.program, Kind::Bible);
            if !text.is_empty() {
                m.verses.push((book, r[1].1, r[2].1, text));
            }
        }
        if extra > 0 {
            m.warnings.push(format!("{extra} verses outside the 66 books (the Apocrypha) are left out."));
        }
        return Ok(m);
    }

    // --- a commentary
    let mut notes = Vec::new();
    for (t, cols) in &tabs {
        let (Some(b), Some(text)) = (col(cols, &["book"]), col(cols, &["data", "Comments"])) else { continue };
        let ch = col(cols, &["chapter", "ChapterBegin", "Chapter"]);
        let v = col(cols, &["fromverse", "VerseBegin", "Verse"]);
        let mut pick = vec![b];
        let mut ints = vec![true];
        if let Some(ch) = ch {
            pick.push(ch);
            ints.push(true);
        }
        if let Some(v) = v {
            pick.push(v);
            ints.push(true);
        }
        pick.push(text);
        ints.push(false);
        for r in rows(&c, t, &pick, &ints, "")? {
            let Some(book) = book_name(r[0].1) else { continue };
            let chapter = if ch.is_some() { r[1].1 } else { 0 };
            let verse = if v.is_some() { r[pick.len() - 2].1 } else { 0 };
            let body = convert(&r[pick.len() - 1].0, m.program, Kind::Commentary);
            if !body.is_empty() {
                notes.push((book, chapter.max(0), verse.max(0), body));
            }
        }
    }
    if !notes.is_empty() {
        m.kind = "commentary";
        notes.sort_by_key(|(b, ch, v, _)| (OSIS.iter().position(|(_, n)| n == b), *ch, *v));
        m.notes = notes;
        return Ok(m);
    }

    // --- a devotional: one reading a day
    if let Some((t, cols)) = tabs.iter().find(|(_, c)| col(c, &["Month"]).is_some() && col(c, &["Day"]).is_some()) {
        let text = cols.iter().find(|c| !["month", "day", "id"].contains(&c.to_lowercase().as_str())).cloned().unwrap_or_default();
        let (mo, d) = (col(cols, &["Month"]).unwrap(), col(cols, &["Day"]).unwrap());
        m.kind = "devotional";
        for r in rows(&c, t, &[mo, d, &text], &[true, true, false], &format!("\"{mo}\", \"{d}\""))? {
            if !(1..=12).contains(&r[0].1) || !(1..=31).contains(&r[1].1) {
                continue;
            }
            let body = convert(&r[2].0, m.program, Kind::Book);
            if !body.is_empty() {
                let key = format!("{:02}.{:02}", r[0].1, r[1].1);
                m.entries.push((key.clone(), key, body));
            }
        }
        return Ok(m);
    }

    // --- a dictionary, a lexicon, or topics
    if let Some((t, cols)) = tabs.iter().find(|(n, c)| {
        ["dictionary", "lexicon", "topics"].contains(&n.to_lowercase().as_str()) && col(c, &["word", "Topic", "Title"]).is_some() && col(c, &["data", "Definition", "Notes"]).is_some()
    }) {
        let (k, d) = (col(cols, &["word", "Topic", "Title"]).unwrap(), col(cols, &["data", "Definition", "Notes"]).unwrap());
        m.kind = "dictionary";
        m.strongs = m.strongs || lower.ends_with(".lexx") || lower.ends_with(".lexi") || t.eq_ignore_ascii_case("lexicon");
        let order = col(cols, &["relativeorder"]).map(|o| format!("\"{o}\"")).unwrap_or_default();
        for r in rows(&c, t, &[k, d], &[false, false], &order)? {
            let key = markup::unescape(r[0].0.trim());
            let body = convert(&r[1].0, m.program, Kind::Dictionary);
            if !key.is_empty() && !body.is_empty() {
                m.entries.push((key.clone(), key, body));
            }
        }
        // e-Sword's topics files are also how studies and articles are shared: a few long
        // entries, or numbered chapters ("01 Terms Used of Angels"), are a book to read in order
        if t.eq_ignore_ascii_case("topics") && reads_as_book(&m.entries) {
            m.kind = "book";
            m.sections = std::mem::take(&mut m.entries).into_iter().map(|(_, title, body)| (title, body)).collect();
        }
        return Ok(m);
    }

    // --- a book: MySword's journal, or any table of titles and texts (e-Sword .refx)
    let book_table = has("journal").or_else(|| {
        tabs.iter().find(|(n, c)| !n.eq_ignore_ascii_case("details") && col(c, &["title", "Topic", "id"]).is_some() && col(c, &["content", "Notes", "Comments", "text"]).is_some())
    });
    if let Some((t, cols)) = book_table {
        let (ti, tx) = (col(cols, &["title", "Topic", "id"]).unwrap(), col(cols, &["content", "Notes", "Comments", "text"]).unwrap());
        let order = col(cols, &["relativeorder"]).map(|o| format!("\"{o}\", rowid")).unwrap_or_else(|| "rowid".into());
        let hidden = col(cols, &["hidden"]);
        let mut pick = vec![ti, tx];
        let mut ints = vec![false, false];
        if let Some(h) = hidden {
            pick.push(h);
            ints.push(true);
        }
        m.kind = "book";
        for r in rows(&c, t, &pick, &ints, &order)? {
            if hidden.is_some() && r[2].1 != 0 {
                continue;
            }
            let title = markup::unescape(r[0].0.trim());
            let body = convert(&r[1].0, m.program, Kind::Book);
            if !body.is_empty() {
                m.sections.push((if title.is_empty() { "Untitled".into() } else { title }, body));
            }
        }
        return Ok(m);
    }

    Err(if locked_marker { LOCKED.into() } else { "This doesn't look like an e-Sword or MySword module the app can read.".into() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rtf_becomes_text() {
        let rtf = r"{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\fnil\fcharset0 Tahoma;}}{\colortbl ;\red0\green0\blue255;}{\*\generator Riched20;}\viewkind4\uc1\pard\cf1\b\f0\fs24 THE TITLE\b0\par
\par Grace \'96 and peace\'85 \u8220?quoted\u8221? text\tab here.\par}";
        assert_eq!(rtf_to_text(rtf), "THE TITLE\n\nGrace – and peace… “quoted” text here.\n");
        // a fragment, as e-Sword keeps verses
        assert_eq!(rtf_to_text(r"\cf6 In the beginning\cf0  God"), "In the beginning God");
    }

    #[test]
    fn written_out_references_become_links() {
        let t = link_plain_refs("See John 3:16 and 1 Cor. 13:4-7, not Hezekiah 3:2 or chapter 3:16.");
        assert!(t.contains("⟦John|3|16||John 3:16⟧"), "{t}");
        assert!(t.contains("⟦1 Corinthians|13|4|7|1 Cor. 13:4-7⟧"), "{t}");
        assert!(!t.contains("Hezekiah|"), "{t}");
        // existing links are left alone
        assert_eq!(link_plain_refs("⟦John|3|16||John 3:16⟧ x"), "⟦John|3|16||John 3:16⟧ x");
    }

    #[test]
    fn mysword_html_and_gbf() {
        let html = "<p>the eldest son (<a class='bible' href='#b2.6.20'>Ex. 6:20</a>), see <a class='dict' href='#dMoses'>Moses</a>.</p>";
        let t = convert(html, "MySword", Kind::Dictionary);
        assert!(t.contains("⟦Exodus|6|20||Ex. 6:20⟧") && t.contains("see Moses."), "{t}");
        let v = convert("<TS>The Creation<Ts> In the beginning God<RF>a note<Rf> created <FR>light<Fr>.<CM>", "MySword", Kind::Bible);
        assert_eq!(v, "In the beginning God created light.");
    }

    fn db(sql: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("esword-test-{}-{}.db", std::process::id(), sql.len() + sql.bytes().map(|b| b as usize).sum::<usize>()));
        let _ = std::fs::remove_file(&p);
        Connection::open(&p).unwrap().execute_batch(sql).unwrap();
        p
    }

    #[test]
    fn reads_each_kind() {
        // a MySword Bible
        let p = db("CREATE TABLE Bible(Book INT, Chapter INT, Verse INT, Scripture TEXT);
             CREATE TABLE Details(Description TEXT, Abbreviation TEXT, Comments TEXT, Language TEXT);
             INSERT INTO Details VALUES ('Test Bible', 'TB', 'Free to share.', 'af');
             INSERT INTO Bible VALUES (43,3,16,'For God so loved<RF>note<Rf> the world.<CM>'), (1,1,1,'In the beginning'), (67,1,1,'Tobit');");
        let m = read(&p, Some("tb.bbl.mybible")).unwrap();
        assert_eq!((m.kind, m.program, m.title.as_str(), m.lang.as_str()), ("bible", "MySword", "Test Bible", "af"));
        assert_eq!(m.verses.len(), 2);
        assert_eq!(m.verses[0].0, "Genesis");
        assert_eq!(m.warnings.len(), 1, "the 67th book is left out");

        // an e-Sword commentary in three tables, RTF
        let p = db(r"CREATE TABLE BookCommentary(Book INT, Comments TEXT);
             CREATE TABLE ChapterCommentary(Book INT, Chapter INT, Comments TEXT);
             CREATE TABLE VerseCommentary(Book INT, ChapterBegin INT, VerseBegin INT, ChapterEnd INT, VerseEnd INT, Comments TEXT);
             INSERT INTO BookCommentary VALUES (43, '{\rtf1 About John\par}');
             INSERT INTO ChapterCommentary VALUES (43, 3, 'On chapter 3, see Rom 5:8.');
             INSERT INTO VerseCommentary VALUES (43, 3, 16, 3, 16, '{\rtf1 \b God\b0  so loved\par}');");
        let m = read(&p, Some("x.cmtx")).unwrap();
        assert_eq!(m.kind, "commentary");
        assert_eq!(m.notes.iter().map(|(b, c, v, _)| (*b, *c, *v)).collect::<Vec<_>>(), [("John", 0, 0), ("John", 3, 0), ("John", 3, 16)]);
        assert!(m.notes[1].3.contains("⟦Romans|5|8||Rom 5:8⟧"), "{:?}", m.notes[1]);

        // a MySword dictionary, a lexicon, topics
        let p = db("CREATE TABLE dictionary(word TEXT, data TEXT); CREATE TABLE details(title TEXT, strong INT);
             INSERT INTO details VALUES ('Strongs', 1); INSERT INTO dictionary VALUES ('G25', '<p>to love</p>');");
        let m = read(&p, Some("s.dct.mybible")).unwrap();
        assert_eq!((m.kind, m.strongs, m.entries[0].2.as_str()), ("dictionary", true, "to love"));
        let p = db("CREATE TABLE Topics(Title TEXT, Notes TEXT); INSERT INTO Topics VALUES ('Joy', '{\\rtf1 Joy is \\par fruit}');");
        let m = read(&p, Some("t.topx")).unwrap();
        assert_eq!((m.kind, m.entries[0].0.as_str()), ("dictionary", "Joy"));

        // a devotional, and a book
        let p = db("CREATE TABLE Devotions(Month INT, Day INT, Devotion TEXT); INSERT INTO Devotions VALUES (1, 2, 'Morning'), (13, 1, 'x');");
        let m = read(&p, Some("d.devx")).unwrap();
        assert_eq!((m.kind, m.entries.len(), m.entries[0].0.as_str()), ("devotional", 1, "01.02"));
        let p = db("CREATE TABLE journal(rowid INTEGER PRIMARY KEY, id TEXT, title TEXT, content TEXT, relativeorder INT, hidden INT);
             INSERT INTO journal(title, content, relativeorder, hidden) VALUES ('Two', '<p>b</p>', 2, 0), ('One', '<p>a</p>', 1, 0), ('Gone', '<p>c</p>', 3, 1);");
        let m = read(&p, Some("b.bok.mybible")).unwrap();
        assert_eq!(m.sections.iter().map(|(t, _)| t.as_str()).collect::<Vec<_>>(), ["One", "Two"], "in order, hidden left out");
    }

    #[test]
    fn a_locked_module_is_refused() {
        let p = db("CREATE TABLE Bible(Book INT, Chapter INT, Verse INT, Scripture BLOB_TEXT); CREATE TABLE sqliteplus_license(Name TEXT);
             INSERT INTO sqliteplus_license VALUES ('e-Sword'); INSERT INTO Bible VALUES (1, 1, 1, x'031ea46c3190e29458bbf2a490838207ad2b28955c650814');");
        let e = read(&p, Some("afv.bblx")).unwrap_err();
        assert!(e.contains("locked"), "{e}");
        assert!(read(&db("CREATE TABLE something(a TEXT);"), Some("x.bblx")).is_err());
    }

    /// The real sample files, when present: `ESWORD_SAMPLES=<folder> cargo test -- --ignored esword`.
    #[test]
    fn esword_references_become_links() {
        let s = link_plain_refs("For He commanded (Psa_148:1-5); God is Spirit (Joh_4:24); love (1Co_13:4); Jude (Jud_1:9).");
        assert!(s.contains("⟦Psalms|148|1|5|Psalms 148:1-5⟧"), "{s}");
        assert!(s.contains("⟦John|4|24||John 4:24⟧"), "{s}");
        assert!(s.contains("⟦1 Corinthians|13|4||1 Corinthians 13:4⟧"), "{s}");
        assert!(s.contains("⟦Jude|1|9||Jude 1:9⟧"), "{s}");
    }

    #[test]
    #[ignore]
    fn sample_files() {
        let Ok(dir) = std::env::var("ESWORD_SAMPLES") else { return };
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !is_module_name(&name) {
                continue;
            }
            match read(&e.path(), Some(&name)) {
                Ok(m) => println!(
                    "{name}: {} {} \"{}\" verses {} notes {} entries {} sections {} | {}",
                    m.program,
                    m.kind,
                    m.title,
                    m.verses.len(),
                    m.notes.len(),
                    m.entries.len(),
                    m.sections.len(),
                    m.verses.first().map(|v| v.3.as_str()).or(m.notes.get(2).map(|n| n.3.as_str())).or(m.entries.first().map(|e| e.2.as_str())).or(m.sections.get(2).or(m.sections.first()).map(|s| s.1.as_str())).unwrap_or("").chars().take(std::env::var("SAMPLE_CHARS").ok().and_then(|n| n.parse().ok()).unwrap_or(160)).collect::<String>()
                ),
                Err(e) => println!("{name}: refused: {e}"),
            }
        }
    }
}
