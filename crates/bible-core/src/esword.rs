//! Modules from e-Sword (.bblx, .cmtx, .dctx, .topx, .lexx, .devx, .refx, and the older
//! .bbli/.cmti/.dcti/.topi), MySword (.bbl.mybible, .cmt.mybible, .dct.mybible,
//! .bok.mybible) and the MyBible app (a Bible, its notes, a dictionary or an atlas of maps in a
//! .SQLite3 file) that the reader already has, read into the Library like a SWORD module.
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
    /// "bible" | "commentary" | "dictionary" | "devotional" | "book" | "atlas"
    pub kind: &'static str,
    /// "e-Sword", "MySword" or "MyBible"
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
    /// the words of Jesus in the verses that have some: (book, chapter, verse, inclusive [first, last]
    /// ranges of words, a word being a run of letters and digits, as the red-letter data of the built-in Bibles)
    pub red: Vec<(&'static str, i64, i64, Vec<(usize, usize)>)>,
    /// commentary notes: (book, chapter, first verse, text); chapter 0 = on the book, verse 0 = on the chapter
    pub notes: Vec<(&'static str, i64, i64, String)>,
    /// dictionary / devotional entries: (key, headword, body)
    pub entries: Vec<(String, String, String)>,
    /// book sections: (title, text)
    pub sections: Vec<(String, String)>,
    /// an atlas: its maps (the picture of each, and the text that goes with it)
    pub maps: Vec<AtlasMap>,
    /// an atlas: the place index, (place, map number, column, row) with column and row counted from 0
    pub places: Vec<(String, i64, i64, i64)>,
    /// things the reader should know
    pub warnings: Vec<String>,
}

/// One map of an atlas.
#[derive(Debug, Default, Clone)]
pub struct AtlasMap {
    /// the map's number in the atlas (0 is the key to the maps)
    pub ord: i64,
    pub title: String,
    pub mime: String,
    pub image: Vec<u8>,
    /// the text under the map: what the numbered places are, with their verses
    pub body: String,
    /// the grid of the map (letters across, numbers down), as many as the place index uses
    pub cols: i64,
    pub rows: i64,
}

/// The first bytes of every SQLite database file.
pub fn is_sqlite(bytes: &[u8]) -> bool {
    bytes.starts_with(b"SQLite format 3\0")
}

/// File names this importer takes (also inside a .zip or .gz).
pub fn is_module_name(name: &str) -> bool {
    let n = name.to_lowercase();
    [".bblx", ".cmtx", ".dctx", ".topx", ".lexx", ".devx", ".refx", ".bbli", ".cmti", ".dcti", ".topi", ".lexi", ".devi", ".mybible", ".sqlite3"]
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

// ---------------------------------------------------------------- MyBible

/// MyBible numbers its books 10, 20, 30 ... with gaps where the Apocrypha would sit; these are
/// the 66 books of the Bible in order (Genesis 10, Psalms 230, Matthew 470, Revelation 730).
const MYBIBLE_BOOKS: [i64; 66] = [
    10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 190, 220, 230, 240, 250, 260, 290, 300, 310, 330, 340, 350, 360, 370, 380, 390, 400, 410, 420, 430, 440,
    450, 460, 470, 480, 490, 500, 510, 520, 530, 540, 550, 560, 570, 580, 590, 600, 610, 620, 630, 640, 650, 660, 670, 680, 690, 700, 710, 720, 730,
];

fn mybible_book(n: i64) -> Option<&'static str> {
    MYBIBLE_BOOKS.iter().position(|b| *b == n).map(|i| OSIS[i].1)
}

/// A MyBible verse as plain text: footnote marks, section headings, verse numbers inside
/// Psalms and Strong's numbers are dropped, the line and paragraph breaks become spaces, and
/// the rest of the tags (italics, poetry lines) are taken off. Returns the text, whether a
/// footnote or heading was left out, and where the words of Jesus (`<J>...</J>`) are, as
/// inclusive ranges of words (a word is a run of letters and digits, as in the app's red-letter data).
fn mybible_text(raw: &str) -> (String, bool, Vec<(usize, usize)>) {
    let dropped = rx!(r"(?s)<f>.*?</f>|<h>.*?</h>").is_match(raw);
    let s = rx!(r"(?s)<f>.*?</f>|<h>.*?</h>|<n>.*?</n>|<S>.*?</S>|<m>.*?</m>").replace_all(raw, "").into_owned();
    let s = rx!(r"<pb\s*/?>|</?(?:t|e)>").replace_all(&s, " ").into_owned();
    let (mut out, mut red, mut in_word, mut words) = (String::new(), false, false, 0usize);
    let mut red_words: Vec<usize> = Vec::new();
    let mut feed = |seg: &str, red: bool| {
        let mut seg = seg.to_string();
        for (a, b) in [("&nbsp;", " "), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", "\""), ("&#39;", "'"), ("&amp;", "&")] {
            seg = seg.replace(a, b);
        }
        for c in seg.chars() {
            out.push(c);
            if c.is_alphabetic() || c.is_numeric() {
                if !in_word {
                    in_word = true;
                    words += 1;
                }
                if red && red_words.last() != Some(&(words - 1)) {
                    red_words.push(words - 1);
                }
            } else {
                in_word = false;
            }
        }
    };
    let mut at = 0;
    for tag in rx!(r"<[^>]*>").find_iter(&s) {
        feed(&s[at..tag.start()], red);
        match tag.as_str().to_ascii_lowercase().as_str() {
            "<j>" => red = true,
            "</j>" => red = false,
            _ => {}
        }
        at = tag.end();
    }
    feed(&s[at..], red);
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for w in red_words {
        match ranges.last_mut() {
            Some((_, last)) if *last + 1 == w => *last = w,
            _ => ranges.push((w, w)),
        }
    }
    (out.split_whitespace().collect::<Vec<_>>().join(" "), dropped, ranges)
}

/// A footnote or study note of a MyBible Bible as the app's text: its links to verses
/// (`<a href="B:400 6:7">Mic. 6:7</a>`) become the app's markers, paragraphs stay apart, the
/// rest of the tags are taken off.
fn mybible_note(raw: &str) -> String {
    let s = rx!(r#"(?is)<a\b[^>]*href=['"]B:(\d+) (\d+):(\d+)(?:-(\d+))?['"][^>]*>(.*?)</a>"#).replace_all(raw, |c: &Captures| {
        let label = markup::unescape(&rx!(r"<[^>]*>").replace_all(&c[5], ""));
        match mybible_book(c[1].parse().unwrap_or(0)) {
            Some(book) => refs::Ref { book, chapter: c[2].parse().unwrap_or(1), verse: c[3].parse().ok().filter(|v| *v > 0), verse_end: c.get(4).and_then(|m| m.as_str().parse().ok()) }
                .marker(Some(&label)),
            None => label,
        }
    });
    let s = rx!(r"(?is)<a\b[^>]*>(.*?)</a>").replace_all(&s, "$1").into_owned();
    let s = rx!(r"(?i)</p>|</pp>|<br\s*/?>|<hr\s*/?>").replace_all(&s, "\n").into_owned();
    let s = markup::unescape(&rx!(r"<[^>]*>").replace_all(&s, ""));
    s.lines().map(|l| l.split_whitespace().collect::<Vec<_>>().join(" ")).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("\n\n")
}

/// The footnotes and study notes of a MyBible Bible (its `...commentaries.SQLite3` file) as a
/// commentary. A note is labelled with its marker (ⓐ, ⓟ), which the Bible text no longer shows.
fn read_mybible_notes(c: &Connection, file_name: Option<&str>) -> Result<Module, String> {
    let info = |key: &str| -> String { c.query_row("SELECT value FROM info WHERE name = ?1", [key], |r| Ok(text_of(r.get_ref(0)?).unwrap_or_default())).unwrap_or_default() };
    let mut m = Module { program: "MyBible", kind: "commentary", ..Default::default() };
    let desc = info("description").trim().to_string();
    m.title = if desc.is_empty() { "Footnotes and study notes".to_string() } else { format!("{desc} — notes") };
    m.lang = info("language").to_lowercase();
    m.copyright = mybible_text(&rx!(r"(?i)<br\s*/?>").replace_all(&info("detailed_info"), " ")).0.chars().take(200).collect();
    let name = file_name.unwrap_or("");
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name).split('.').next().unwrap_or("");
    m.abbreviation = format!("{base}-notes");
    let cols = ["book_number", "chapter_number_from", "verse_number_from", "marker", "text"];
    let mut extra = 0;
    for r in rows(c, "commentaries", &cols, &[true, true, true, false, false], "\"book_number\", \"chapter_number_from\", \"verse_number_from\", rowid")? {
        let Some(book) = mybible_book(r[0].1) else {
            extra += 1;
            continue;
        };
        let text = mybible_note(&r[4].0);
        if text.is_empty() {
            continue;
        }
        let marker = r[3].0.trim();
        let text = if !marker.is_empty() && marker.chars().count() <= 8 { format!("{marker} {text}") } else { text };
        m.notes.push((book, r[1].1.max(0), r[2].1.max(0), text));
    }
    if extra > 0 {
        m.warnings.push(format!("{extra} notes on books outside the 66 (the Apocrypha) are left out."));
    }
    Ok(m)
}

/// The rights notice in a module's description: from the sentence that has the © sign (or "Copyright") in it, when it
/// comes late in a long description; else its start.
fn mybible_rights(detail: &str) -> String {
    let at = detail.find('©').or_else(|| detail.find("Copyright"));
    let from = match at {
        Some(i) if i > 120 => detail[..i].rfind(". ").map(|d| d + 2).unwrap_or(i),
        _ => 0,
    };
    detail[from..].chars().take(200).collect()
}

fn mybible_info(c: &Connection, key: &str) -> String {
    c.query_row("SELECT value FROM info WHERE name = ?1", [key], |r| Ok(text_of(r.get_ref(0)?).unwrap_or_default())).unwrap_or_default()
}

/// The name a MyBible file goes by: its file name without the extensions ("SECE.dictionary.SQLite3" is "SECE").
fn mybible_stem(file_name: Option<&str>) -> String {
    let name = file_name.unwrap_or("");
    name.rsplit(['/', '\\']).next().unwrap_or(name).split('.').next().unwrap_or("").to_string()
}

/// A MyBible dictionary (`dictionary(topic, definition)`, with the optional columns lexeme,
/// transliteration, pronunciation and short_definition of a lexicon) beside its `info`; one
/// whose `info` says `type = atlas` is an atlas of maps. `is_strong` marks a lexicon keyed by
/// Strong's numbers ("G26", "H1"), which is what Word Study looks up.
fn read_mybible_dictionary(c: &Connection, tabs: &[(String, Vec<String>)], file_name: Option<&str>) -> Result<Option<Module>, String> {
    let Some((_, cols)) = tabs.iter().find(|(n, _)| n.eq_ignore_ascii_case("dictionary")) else { return Ok(None) };
    if col(cols, &["topic"]).is_none() || col(cols, &["definition"]).is_none() {
        return Ok(None);
    }
    if mybible_info(c, "type").eq_ignore_ascii_case("atlas") {
        return read_mybible_atlas(c, file_name).map(Some);
    }
    let mut m = Module { program: "MyBible", kind: "dictionary", ..Default::default() };
    let stem = mybible_stem(file_name);
    m.title = mybible_info(c, "description").trim().to_string();
    if m.title.is_empty() {
        m.title = stem.clone();
    }
    m.lang = mybible_info(c, "language").to_lowercase();
    let detail = mybible_text(&rx!(r"(?i)<br\s*/?>|</?(?:p|h\d)[^>]*>").replace_all(&mybible_info(c, "detailed_info"), " ")).0;
    m.copyright = mybible_rights(&detail);
    m.about = detail.chars().take(4000).collect();
    m.abbreviation = stem;
    m.strongs = mybible_info(c, "is_strong").eq_ignore_ascii_case("true");
    let extras: Vec<&str> = ["lexeme", "transliteration", "pronunciation", "short_definition"].into_iter().filter(|n| col(cols, &[n]).is_some()).collect();
    let mut names = vec!["topic", "definition"];
    names.extend(extras.iter().copied());
    let ints = vec![false; names.len()];
    let at = |r: &Vec<(String, i64)>, name: &str| -> String { extras.iter().position(|e| *e == name).map(|i| r[2 + i].0.trim().to_string()).unwrap_or_default() };
    for r in rows(c, "dictionary", &names, &ints, "rowid")? {
        let key = r[0].0.trim_start_matches('\u{feff}').trim().to_string();
        if key.is_empty() {
            continue;
        }
        let text = mybible_note(&r[1].0);
        // a lexicon's word, how it is said and what it means, in front of the entry (unless the entry already starts with the word)
        let lexeme = at(&r, "lexeme");
        let say: Vec<String> = [at(&r, "transliteration"), at(&r, "pronunciation")].into_iter().filter(|s| !s.is_empty()).collect();
        let short = at(&r, "short_definition");
        let mut head = lexeme.clone();
        if !head.is_empty() {
            if !say.is_empty() {
                head.push_str(&format!(" ({})", say.join(" · ")));
            }
            if !short.is_empty() {
                head.push_str(&format!(" — {short}"));
            }
        }
        let body = if head.is_empty() || text.starts_with(&lexeme) { text } else { format!("{head}\n\n{text}") };
        if !body.trim().is_empty() {
            m.entries.push((key.clone(), key, body));
        }
    }
    Ok(Some(m))
}

/// An atlas in MyBible's form: each map is a page whose topic starts with its number ("#02. Israel's Exodus..."),
/// holding the picture (a reference to `content_fragments`, where it is a data address) and a list of the places on it with their
/// verses; the other entries are the place index ("Dura, Plain of: 9:F3": map 9, column F, row 3).
fn read_mybible_atlas(c: &Connection, file_name: Option<&str>) -> Result<Module, String> {
    use base64::Engine;
    let mut m = Module { program: "MyBible", kind: "atlas", ..Default::default() };
    let stem = mybible_stem(file_name);
    m.title = mybible_info(c, "description").trim().to_string();
    if m.title.is_empty() {
        m.title = stem.clone();
    }
    m.lang = mybible_info(c, "language").to_lowercase();
    let detail = mybible_text(&rx!(r"(?i)<br\s*/?>|</?(?:p|h\d)[^>]*>").replace_all(&mybible_info(c, "detailed_info"), " ")).0;
    m.copyright = mybible_rights(&detail);
    m.about = format!("{detail} {}", mybible_text(&mybible_info(c, "origin")).0).trim().chars().take(4000).collect();
    m.abbreviation = stem;

    // the pictures, by their file names
    let mut images: std::collections::HashMap<String, (String, Vec<u8>)> = std::collections::HashMap::new();
    for r in rows(c, "content_fragments", &["id", "fragment"], &[false, false], "rowid")? {
        let Some(cap) = rx!(r#"(?s)src=["']data:image/([a-z0-9+.-]+);base64,([^"']+)["']"#).captures(&r[1].0) else { continue };
        let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(cap[2].split_whitespace().collect::<String>()) else { continue };
        let mime = match &cap[1] {
            "jpg" | "jpeg" => "image/jpeg".to_string(),
            other => format!("image/{other}"),
        };
        images.insert(r[0].0.clone(), (mime, bytes));
    }

    let mut grid: std::collections::HashMap<i64, (i64, i64)> = std::collections::HashMap::new();
    for r in rows(c, "dictionary", &["topic", "definition"], &[false, false], "rowid")? {
        let topic = r[0].0.trim_start_matches('\u{feff}').trim().to_string();
        if let Some(page) = topic.strip_prefix('#') {
            // a map page: "#07. The Persian Empire"
            let Some((num, title)) = page.split_once(". ") else { continue };
            let Ok(ord) = num.trim().parse::<i64>() else { continue };
            let Some(file) = rx!(r"INCLUDE\(([^)]+)\)").captures_iter(&r[1].0).filter_map(|c| images.contains_key(&c[1]).then(|| c[1].to_string())).last() else { continue };
            let (mime, image) = images[&file].clone();
            let body = rx!(r"(?s)<figure.*?</figure>|<center.*?</center>|<!--.*?-->|<h1.*?</h1>").replace_all(&r[1].0, "").into_owned();
            let body = rx!(r#"(?is)<li[^>]*data-marker="([^"]*)"[^>]*>"#).replace_all(&body, "\n$1 ").into_owned();
            m.maps.push(AtlasMap { ord, title: if ord == 0 { "Key to the maps".to_string() } else { title.trim().to_string() }, mime, image, body: mybible_note(&body), cols: 0, rows: 0 });
        } else {
            // a place: its map number and grid squares
            for cap in rx!(r#"<a[^>]*>\s*(\d+):([A-Z])(\d+)\s*</a>"#).captures_iter(&r[1].0) {
                let (Ok(map), Some(letter), Ok(row)) = (cap[1].parse::<i64>(), cap[2].chars().next(), cap[3].parse::<i64>()) else { continue };
                let col = letter as i64 - 'A' as i64;
                if col < 0 || row < 1 {
                    continue;
                }
                let g = grid.entry(map).or_insert((0, 0));
                g.0 = g.0.max(col + 1);
                g.1 = g.1.max(row);
                m.places.push((topic.clone(), map, col, row - 1));
            }
        }
    }
    for mp in &mut m.maps {
        if let Some((cols, rows)) = grid.get(&mp.ord) {
            mp.cols = *cols;
            mp.rows = *rows;
        }
    }
    m.maps.sort_by_key(|mp| mp.ord);
    if m.maps.is_empty() {
        m.warnings.push("No maps with pictures were found in this atlas.".into());
    }
    Ok(m)
}

/// A Bible from the MyBible app: `verses(book_number, chapter, verse, text)` beside an `info`
/// table. Its footnotes and study notes sit in a second file (`...commentaries.SQLite3`).
fn read_mybible(c: &Connection, tabs: &[(String, Vec<String>)], file_name: Option<&str>) -> Result<Option<Module>, String> {
    let has = |name: &str| tabs.iter().find(|(n, _)| n.eq_ignore_ascii_case(name));
    let need = ["book_number", "chapter", "verse", "text"];
    if !has("verses").is_some_and(|(_, cols)| need.iter().all(|n| col(cols, &[n]).is_some())) {
        let notes = has("commentaries").is_some_and(|(_, cols)| ["book_number", "chapter_number_from", "verse_number_from", "text"].iter().all(|n| col(cols, &[n]).is_some()));
        return if notes { read_mybible_notes(c, file_name).map(Some) } else { read_mybible_dictionary(c, tabs, file_name) };
    }
    let info = |key: &str| -> String { c.query_row("SELECT value FROM info WHERE name = ?1", [key], |r| Ok(text_of(r.get_ref(0)?).unwrap_or_default())).unwrap_or_default() };
    let mut m = Module { program: "MyBible", kind: "bible", ..Default::default() };
    m.title = info("description").trim().to_string();
    m.lang = info("language").to_lowercase();
    let detail = mybible_text(&rx!(r"(?i)<br\s*/?>").replace_all(&info("detailed_info"), " ")).0;
    m.copyright = detail.chars().take(200).collect();
    m.about = detail.chars().take(4000).collect();
    let name = file_name.unwrap_or("");
    m.abbreviation = name.rsplit(['/', '\\']).next().unwrap_or(name).split('.').next().unwrap_or("").to_string();
    let (mut extra, mut dropped) = (0, false);
    for r in rows(c, "verses", &need, &[true, true, true, false], "\"book_number\", \"chapter\", \"verse\"")? {
        let Some(book) = mybible_book(r[0].1) else {
            extra += 1;
            continue;
        };
        if r[1].1 <= 0 || r[2].1 <= 0 {
            continue;
        }
        let (text, d, ranges) = mybible_text(&r[3].0);
        dropped |= d;
        if !text.is_empty() {
            if !ranges.is_empty() {
                m.red.push((book, r[1].1, r[2].1, ranges));
            }
            m.verses.push((book, r[1].1, r[2].1, text));
        }
    }
    if extra > 0 {
        m.warnings.push(format!("{extra} verses outside the 66 books (the Apocrypha) are left out."));
    }
    if dropped {
        m.warnings.push("The section headings in this file are left out, and its footnotes are added as a commentary when the file comes with them; the Bible text is kept.".into());
    }
    Ok(Some(m))
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
    if let Some(m) = read_mybible(&c, &tabs, file_name)? {
        return Ok(m);
    }
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
    fn reads_a_mybible_bible() {
        let p = db("CREATE TABLE info(name TEXT, value TEXT);
             CREATE TABLE verses(book_number NUMERIC, chapter NUMERIC, verse NUMERIC, text TEXT);
             INSERT INTO info VALUES ('description', 'Test Version 1999'), ('language', 'en'), ('detailed_info', 'Copyright 1999 <br/>Some Publisher');
             INSERT INTO verses VALUES (10,1,1,'<pb/>In the<f>[1]</f> beginning <i>God</i> created.'),
               (230,23,1,'<pb/><e>A Psalm of David.</e> <pb/><t> <n>[1]</n> The LORD is my shepherd; </t><t>I shall not want.</t>'),
               (500,3,16,'<h>The new birth</h> For God so loved &amp; gave <J>His Son</J>.'),
               (730,22,21,'Grace.'), (170,1,1,'Tobit');");
        let m = read(&p, Some("TV'99.SQLite3")).unwrap();
        assert_eq!((m.kind, m.program, m.title.as_str(), m.lang.as_str(), m.abbreviation.as_str()), ("bible", "MyBible", "Test Version 1999", "en", "TV'99"));
        assert_eq!(m.copyright, "Copyright 1999 Some Publisher");
        let v = |b: &str, c, n| m.verses.iter().find(|x| x.0 == b && x.1 == c && x.2 == n).map(|x| x.3.as_str());
        assert_eq!(v("Genesis", 1, 1), Some("In the beginning God created."));
        assert_eq!(v("Psalms", 23, 1), Some("A Psalm of David. The LORD is my shepherd; I shall not want."));
        assert_eq!(v("John", 3, 16), Some("For God so loved & gave His Son."));
        // the words of Jesus as word ranges: "His Son" are the 6th and 7th words
        assert_eq!(m.red, vec![("John", 3, 16, vec![(5, 6)])]);
        assert_eq!(v("Revelation", 22, 21), Some("Grace."));
        assert_eq!(m.verses.len(), 4);
        assert_eq!(m.warnings.len(), 2, "the Apocrypha and the dropped footnotes are reported: {:?}", m.warnings);

        // the footnotes file of such a Bible is a commentary of its own
        let n = db("CREATE TABLE info(name TEXT, value TEXT); INSERT INTO info VALUES ('description', 'Test Version 1999');
             CREATE TABLE commentaries(book_number NUMERIC, chapter_number_from NUMERIC, verse_number_from NUMERIC, chapter_number_to NUMERIC, verse_number_to NUMERIC, marker TEXT, text TEXT);
             INSERT INTO commentaries VALUES (10, 1, 1, 1, 1, 'ⓐ', 'Or <i>in the beginning</i>; see <a href=\"B:500 1:1\">John 1:1</a>'),
               (10, 1, 1, 1, 1, '', '<p>First.</p><p>Second.</p>'), (500, 3, 0, 3, 0, '', 'On the chapter'), (170, 1, 1, 1, 1, '', 'Tobit');");
        let m = read(&n, Some("TV.commentaries.SQLite3")).unwrap();
        assert_eq!((m.kind, m.abbreviation.as_str(), m.title.as_str()), ("commentary", "TV-notes", "Test Version 1999 — notes"));
        assert_eq!(m.notes.len(), 3, "{:?}", m.notes);
        assert_eq!(m.notes[0], ("Genesis", 1, 1, "ⓐ Or in the beginning; see ⟦John|1|1||John 1:1⟧".to_string()));
        assert_eq!(m.notes[1].3, "First.\n\nSecond.");
        assert_eq!((m.notes[2].0, m.notes[2].1, m.notes[2].2), ("John", 3, 0));
    }

    /// The reader's own MyBible downloads (zips as they came): `MYBIBLE_SAMPLES=<folder> cargo test real_mybible -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_mybible_files() {
        let Ok(dir) = std::env::var("MYBIBLE_SAMPLES") else { return };
        let mut seen = 0;
        for f in std::fs::read_dir(dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "zip")) {
            let bytes = std::fs::read(&f).unwrap();
            let (module, name) = crate::library::esword_bytes(&bytes, f.file_name().and_then(|n| n.to_str())).unwrap().expect("a module inside the zip");
            let p = std::env::temp_dir().join(format!("mybible-real-{}.sqlite", seen));
            std::fs::write(&p, module).unwrap();
            let m = read(&p, Some(&name)).unwrap();
            let get = |b: &str, c, v| m.verses.iter().find(|x| x.0 == b && x.1 == c && x.2 == v).map(|x| x.3.chars().count());
            println!("{name}: {} / {} / {} verses, abbreviation {:?}, genesis 1:1 {:?} chars, john 3:16 {:?}, rev 22:21 {:?}; warnings {:?}", m.title, m.program, m.verses.len(), m.abbreviation, get("Genesis", 1, 1), get("John", 3, 16), get("Revelation", 22, 21), m.warnings);
            let stray = m.verses.iter().filter(|x| x.3.contains('<') || x.3.contains('>') || x.3.contains("&amp;")).count();
            println!("   verses still showing markup: {stray}; copyright: {}", m.copyright.chars().take(90).collect::<String>());
            assert!(m.verses.len() > 31000 && m.kind == "bible" && stray == 0);
            println!("   red-letter verses: {}, e.g. John 3:16 {:?}, Matthew 5:3 {:?}", m.red.len(), m.red.iter().find(|r| r.0 == "John" && r.1 == 3 && r.2 == 16).map(|r| &r.3), m.red.iter().find(|r| r.0 == "Matthew" && r.1 == 5 && r.2 == 3).map(|r| &r.3));
            assert!(m.red.len() > 1000, "the words of Jesus are kept");
            if let Some((notes, notes_name)) = crate::library::esword_companion(&bytes) {
                let p2 = std::env::temp_dir().join(format!("mybible-real-notes-{}.sqlite", seen));
                std::fs::write(&p2, notes).unwrap();
                let n = read(&p2, Some(&notes_name)).unwrap();
                let strays = n.notes.iter().filter(|x| x.3.contains('<') || x.3.contains("&amp;")).count();
                let links = n.notes.iter().filter(|x| x.3.contains('⟦')).count();
                println!("   notes file {notes_name}: {} / {} / {} notes, name {:?}, {links} with verse links, {strays} still showing markup; warnings {:?}", n.title, n.kind, n.notes.len(), n.abbreviation, n.warnings);
                assert!(n.kind == "commentary" && n.notes.len() > 1000 && strays == 0);
            }
            seen += 1;
        }
        assert!(seen > 0);
    }

    /// What the importer makes of each zip in a folder (a development aid):
    /// `MYBIBLE_SAMPLES=<folder> cargo test --lib what_the_importer -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn what_the_importer_makes_of_the_zips_in_a_folder() {
        let Ok(dir) = std::env::var("MYBIBLE_SAMPLES") else { return };
        for f in std::fs::read_dir(dir).unwrap().flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "zip")) {
            let bytes = std::fs::read(&f).unwrap();
            let fname = f.file_name().and_then(|n| n.to_str()).unwrap_or("");
            match crate::library::esword_bytes(&bytes, Some(fname)) {
                Ok(Some((module, name))) => {
                    let p = std::env::temp_dir().join("what-the-importer.sqlite");
                    std::fs::write(&p, module).unwrap();
                    match read(&p, Some(&name)) {
                        Ok(m) => println!("{fname}: {} / {} / {:?} (name {:?}) -> verses {}, notes {}, entries {}, sections {}, maps {} ({} pictures bytes), places {}, strongs {}; copyright {:?}; warnings {:?}", m.kind, m.program, m.title, m.abbreviation, m.verses.len(), m.notes.len(), m.entries.len(), m.sections.len(), m.maps.len(), m.maps.iter().map(|x| x.image.len()).sum::<usize>(), m.places.len(), m.strongs, m.copyright.chars().take(60).collect::<String>(), m.warnings),
                        Err(e) => println!("{fname}: refused: {e}"),
                    }
                }
                Ok(None) => println!("{fname}: not an e-Sword/MySword/MyBible file"),
                Err(e) => println!("{fname}: error {e}"),
            }
        }
    }

    #[test]
    fn reads_a_mybible_dictionary_and_an_atlas() {
        // a lexicon keyed by Strong's numbers (a byte-order mark on the first key, as the real file has it)
        let p = db("CREATE TABLE info(name TEXT, value TEXT);
             CREATE TABLE dictionary(topic TEXT, definition TEXT, lexeme TEXT, transliteration TEXT, pronunciation TEXT, short_definition TEXT);
             INSERT INTO info VALUES ('description', 'Test Strong''s'), ('language', 'en'), ('is_strong', 'true'), ('detailed_info', '<h2>Test Strong''s</h2> from public domain work<br/>Source: somewhere');
             INSERT INTO dictionary VALUES (char(65279) || 'G26', '<b>x</b><hr>love, <a href=''S:G25''>see</a> <a href=\"B:500 3:16\">John 3:16</a>', 'ἀγάπη', 'agápē', 'ag-ah''-pay', 'charity'),
               ('H1', '<p>father</p><p>second</p>', 'אָב', 'ʼâb', 'awb', 'father');");
        let m = read(&p, Some("SECE.dictionary.SQLite3")).unwrap();
        assert_eq!((m.kind, m.program, m.title.as_str(), m.abbreviation.as_str(), m.strongs, m.lang.as_str()), ("dictionary", "MyBible", "Test Strong's", "SECE", true, "en"));
        assert_eq!(m.copyright, "Test Strong's from public domain work Source: somewhere");
        assert_eq!(m.entries.len(), 2);
        assert_eq!(m.entries[0].0, "G26", "no byte-order mark in the key");
        assert!(m.entries[0].2.starts_with("ἀγάπη (agápē · ag-ah'-pay) — charity\n\n"), "{}", m.entries[0].2);
        assert!(m.entries[0].2.contains("see") && m.entries[0].2.contains("⟦John|3|16||John 3:16⟧"), "{}", m.entries[0].2);
        assert!(m.entries[1].2.ends_with("father\n\nsecond"), "{}", m.entries[1].2);

        // an atlas: two maps, a place index, the pictures as data addresses
        let p = db("CREATE TABLE info(name TEXT, value TEXT);
             CREATE TABLE dictionary(topic TEXT, definition TEXT);
             CREATE TABLE content_fragments(id TEXT, fragment TEXT);
             INSERT INTO info VALUES ('description', 'Test Maps'), ('type', 'atlas'), ('detailed_info', 'Rights reserved'), ('origin', 'Somebody');
             INSERT INTO content_fragments VALUES ('1x1.png', '<img id=\"1x1.png\" src=\"data:image/png;base64,iVBORw0KGgo=\">'), ('SCRIPT', '<script>x</script>');
             INSERT INTO dictionary VALUES ('#00. Test Maps', '<figure><!-- INCLUDE(1x1.png) --></figure>'),
               ('#02. The Exodus', '<div><figure id=\"f\"><!-- INCLUDE(1x1.png) --></figure><ol><li data-marker=\"1.\"><p><strong>Sinai</strong> The mountain (<a href=\"B:20 19:20\">Ex. 19:20</a>).</p></li></ol></div><center id=\"nav\"><a href=\"S:#01\">x</a></center><!-- INCLUDE(SCRIPT) -->'),
               ('#15. Index', '<p>how to use</p>'),
               ('Sinai, Mount', 'Sinai, Mount: <a href=\"S:#02. The Exodus\">2:C4</a>; <a href=\"S:#00. Test Maps\">0:A1</a>.'), ('Goshen', 'Goshen: <a href=\"S:#02. The Exodus\">2:B2</a>.');");
        let m = read(&p, Some("BMaps.dictionary.SQLite3")).unwrap();
        assert_eq!((m.kind, m.title.as_str(), m.abbreviation.as_str(), m.maps.len()), ("atlas", "Test Maps", "BMaps", 2));
        assert_eq!((m.maps[0].ord, m.maps[0].title.as_str(), m.maps[0].mime.as_str(), m.maps[0].image.len()), (0, "Key to the maps", "image/png", 8));
        assert_eq!((m.maps[1].ord, m.maps[1].title.as_str(), m.maps[1].cols, m.maps[1].rows), (2, "The Exodus", 3, 4));
        assert_eq!(m.maps[1].body, "1. Sinai The mountain (⟦Exodus|19|20||Ex. 19:20⟧).");
        assert!(m.places.contains(&("Sinai, Mount".to_string(), 2, 2, 3)) && m.places.contains(&("Goshen".to_string(), 2, 1, 1)), "{:?}", m.places);
        assert!(m.about.contains("Rights reserved") && m.about.contains("Somebody"));
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
