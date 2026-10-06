//! Scripture references inside SWORD module text, turned into the app's clickable
//! ⟦Book|ch|v|v_end|label⟧ markers (rendered by RichText.tsx). A port of
//! data-pipeline/refs.py: OSIS ids ("1Sam.7.1", "Gen.1.1-Gen.1.3") and free text
//! ("Job 39:6; Isa 32:14", "1Jo 3:14,19; 4:18", "II Kings 2"), book and chapter carried
//! forward.

/// OSIS book id -> this app's book name (the 66 books; anything else is not linked).
pub const OSIS: [(&str, &str); 66] = [
    ("Gen", "Genesis"), ("Exod", "Exodus"), ("Lev", "Leviticus"), ("Num", "Numbers"), ("Deut", "Deuteronomy"),
    ("Josh", "Joshua"), ("Judg", "Judges"), ("Ruth", "Ruth"), ("1Sam", "1 Samuel"), ("2Sam", "2 Samuel"),
    ("1Kgs", "1 Kings"), ("2Kgs", "2 Kings"), ("1Chr", "1 Chronicles"), ("2Chr", "2 Chronicles"), ("Ezra", "Ezra"),
    ("Neh", "Nehemiah"), ("Esth", "Esther"), ("Job", "Job"), ("Ps", "Psalms"), ("Prov", "Proverbs"),
    ("Eccl", "Ecclesiastes"), ("Song", "Song of Solomon"), ("Isa", "Isaiah"), ("Jer", "Jeremiah"),
    ("Lam", "Lamentations"), ("Ezek", "Ezekiel"), ("Dan", "Daniel"), ("Hos", "Hosea"), ("Joel", "Joel"),
    ("Amos", "Amos"), ("Obad", "Obadiah"), ("Jonah", "Jonah"), ("Mic", "Micah"), ("Nah", "Nahum"),
    ("Hab", "Habakkuk"), ("Zeph", "Zephaniah"), ("Hag", "Haggai"), ("Zech", "Zechariah"), ("Mal", "Malachi"),
    ("Matt", "Matthew"), ("Mark", "Mark"), ("Luke", "Luke"), ("John", "John"), ("Acts", "Acts"),
    ("Rom", "Romans"), ("1Cor", "1 Corinthians"), ("2Cor", "2 Corinthians"), ("Gal", "Galatians"),
    ("Eph", "Ephesians"), ("Phil", "Philippians"), ("Col", "Colossians"), ("1Thess", "1 Thessalonians"),
    ("2Thess", "2 Thessalonians"), ("1Tim", "1 Timothy"), ("2Tim", "2 Timothy"), ("Titus", "Titus"),
    ("Phlm", "Philemon"), ("Heb", "Hebrews"), ("Jas", "James"), ("1Pet", "1 Peter"), ("2Pet", "2 Peter"),
    ("1John", "1 John"), ("2John", "2 John"), ("3John", "3 John"), ("Jude", "Jude"), ("Rev", "Revelation"),
];

pub fn osis_book(id: &str) -> Option<&'static str> {
    OSIS.iter().find(|(o, _)| o.eq_ignore_ascii_case(id)).map(|(_, n)| *n)
}

/// Abbreviations seen in ThML/TEI free text (lower-case, no spaces or dots).
const ABBR: &[(&str, &str)] = &[
    ("gen", "Genesis"), ("ge", "Genesis"), ("gn", "Genesis"), ("exo", "Exodus"), ("exod", "Exodus"), ("ex", "Exodus"),
    ("lev", "Leviticus"), ("le", "Leviticus"), ("lv", "Leviticus"), ("num", "Numbers"), ("nu", "Numbers"), ("nm", "Numbers"),
    ("deu", "Deuteronomy"), ("deut", "Deuteronomy"), ("de", "Deuteronomy"), ("dt", "Deuteronomy"), ("jos", "Joshua"),
    ("josh", "Joshua"), ("jdg", "Judges"), ("judg", "Judges"), ("jg", "Judges"), ("jdgs", "Judges"), ("jud", "Judges"),
    ("rut", "Ruth"), ("ru", "Ruth"), ("1sa", "1 Samuel"), ("1sam", "1 Samuel"), ("1sm", "1 Samuel"), ("2sa", "2 Samuel"),
    ("2sam", "2 Samuel"), ("2sm", "2 Samuel"), ("1ki", "1 Kings"), ("1kgs", "1 Kings"), ("1kin", "1 Kings"),
    ("2ki", "2 Kings"), ("2kgs", "2 Kings"), ("2kin", "2 Kings"), ("1ch", "1 Chronicles"), ("1chr", "1 Chronicles"),
    ("1chron", "1 Chronicles"), ("2ch", "2 Chronicles"), ("2chr", "2 Chronicles"), ("2chron", "2 Chronicles"),
    ("ezr", "Ezra"), ("neh", "Nehemiah"), ("ne", "Nehemiah"), ("est", "Esther"), ("esth", "Esther"), ("es", "Esther"),
    ("job", "Job"), ("jb", "Job"), ("psa", "Psalms"), ("ps", "Psalms"), ("psalm", "Psalms"), ("pss", "Psalms"),
    ("pro", "Proverbs"), ("prov", "Proverbs"), ("pr", "Proverbs"), ("prv", "Proverbs"), ("ecc", "Ecclesiastes"),
    ("eccl", "Ecclesiastes"), ("ec", "Ecclesiastes"), ("eccles", "Ecclesiastes"), ("sng", "Song of Solomon"),
    ("song", "Song of Solomon"), ("so", "Song of Solomon"), ("ss", "Song of Solomon"), ("sos", "Song of Solomon"),
    ("cant", "Song of Solomon"), ("songofsongs", "Song of Solomon"), ("isa", "Isaiah"), ("is", "Isaiah"),
    ("jer", "Jeremiah"), ("je", "Jeremiah"), ("lam", "Lamentations"), ("la", "Lamentations"), ("ezk", "Ezekiel"),
    ("ezek", "Ezekiel"), ("eze", "Ezekiel"), ("dan", "Daniel"), ("da", "Daniel"), ("dn", "Daniel"), ("hos", "Hosea"),
    ("ho", "Hosea"), ("jol", "Joel"), ("joel", "Joel"), ("joe", "Joel"), ("amo", "Amos"), ("am", "Amos"),
    ("oba", "Obadiah"), ("obad", "Obadiah"), ("ob", "Obadiah"), ("jon", "Jonah"), ("jnh", "Jonah"), ("jonah", "Jonah"),
    ("mic", "Micah"), ("mi", "Micah"), ("nam", "Nahum"), ("nah", "Nahum"), ("na", "Nahum"), ("hab", "Habakkuk"),
    ("zep", "Zephaniah"), ("zeph", "Zephaniah"), ("hag", "Haggai"), ("hg", "Haggai"), ("zec", "Zechariah"),
    ("zech", "Zechariah"), ("zc", "Zechariah"), ("mal", "Malachi"), ("mat", "Matthew"), ("matt", "Matthew"),
    ("mt", "Matthew"), ("mrk", "Mark"), ("mar", "Mark"), ("mk", "Mark"), ("mr", "Mark"), ("luk", "Luke"), ("lu", "Luke"),
    ("lk", "Luke"), ("jhn", "John"), ("joh", "John"), ("jn", "John"), ("act", "Acts"), ("ac", "Acts"), ("rom", "Romans"),
    ("ro", "Romans"), ("rm", "Romans"), ("1co", "1 Corinthians"), ("1cor", "1 Corinthians"), ("2co", "2 Corinthians"),
    ("2cor", "2 Corinthians"), ("gal", "Galatians"), ("ga", "Galatians"), ("eph", "Ephesians"), ("php", "Philippians"),
    ("phil", "Philippians"), ("phi", "Philippians"), ("pp", "Philippians"), ("col", "Colossians"),
    ("1th", "1 Thessalonians"), ("1thess", "1 Thessalonians"), ("1thes", "1 Thessalonians"),
    ("2th", "2 Thessalonians"), ("2thess", "2 Thessalonians"), ("2thes", "2 Thessalonians"), ("1ti", "1 Timothy"),
    ("1tim", "1 Timothy"), ("1tm", "1 Timothy"), ("2ti", "2 Timothy"), ("2tim", "2 Timothy"), ("2tm", "2 Timothy"),
    ("tit", "Titus"), ("ti", "Titus"), ("phm", "Philemon"), ("phlm", "Philemon"), ("philem", "Philemon"),
    ("phile", "Philemon"), ("heb", "Hebrews"), ("jas", "James"), ("jam", "James"), ("jm", "James"), ("1pe", "1 Peter"),
    ("1pet", "1 Peter"), ("1pt", "1 Peter"), ("2pe", "2 Peter"), ("2pet", "2 Peter"), ("2pt", "2 Peter"),
    ("1jn", "1 John"), ("1jo", "1 John"), ("1joh", "1 John"), ("1john", "1 John"), ("2jn", "2 John"), ("2jo", "2 John"),
    ("2joh", "2 John"), ("2john", "2 John"), ("3jn", "3 John"), ("3jo", "3 John"), ("3joh", "3 John"), ("3john", "3 John"),
    ("jude", "Jude"), ("jd", "Jude"), ("rev", "Revelation"), ("re", "Revelation"), ("rv", "Revelation"),
    ("apoc", "Revelation"),
];

fn squash(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace() && *c != '.').collect::<String>().to_lowercase()
}

/// A leading Roman numeral read as a book number: "iiking" -> "2king".
fn roman(s: &str) -> String {
    for (r, n) in [("iii", "3"), ("ii", "2"), ("i", "1")] {
        if let Some(rest) = s.strip_prefix(r) {
            if rest.starts_with(|c: char| c.is_ascii_alphabetic()) {
                return format!("{n}{rest}");
            }
        }
    }
    s.to_string()
}

/// This app's book name for a free-text abbreviation, or None.
pub fn resolve_book(raw: &str) -> Option<&'static str> {
    let plain = squash(raw);
    if plain.is_empty() {
        return None;
    }
    static NAMES: std::sync::OnceLock<Vec<(String, &'static str)>> = std::sync::OnceLock::new();
    let names = NAMES.get_or_init(|| OSIS.iter().map(|(_, n)| (squash(n), *n)).collect());
    for k in [plain.clone(), roman(&plain)] {
        if let Some((_, n)) = ABBR.iter().find(|(a, _)| *a == k) {
            return Some(n);
        }
        if let Some((_, n)) = names.iter().find(|(s, _)| *s == k) {
            return Some(n);
        }
    }
    for k in [plain.clone(), roman(&plain)] {
        let hits: Vec<&&str> = names.iter().filter(|(s, _)| s.starts_with(&k)).map(|(_, n)| n).collect();
        if hits.len() == 1 {
            return Some(hits[0]);
        }
    }
    None
}

#[derive(Debug, Clone, PartialEq)]
pub struct Ref {
    pub book: &'static str,
    pub chapter: u32,
    pub verse: Option<u32>,
    pub verse_end: Option<u32>,
}

impl Ref {
    pub fn label(&self) -> String {
        match (self.verse, self.verse_end) {
            (None, _) => format!("{} {}", self.book, self.chapter),
            (Some(v), None) => format!("{} {}:{}", self.book, self.chapter, v),
            (Some(v), Some(e)) => format!("{} {}:{}-{}", self.book, self.chapter, v, e),
        }
    }

    /// The in-text link marker RichText.tsx renders.
    pub fn marker(&self, text: Option<&str>) -> String {
        let label = text.map(str::trim).filter(|t| !t.is_empty()).map(String::from).unwrap_or_else(|| self.label());
        format!(
            "⟦{}|{}|{}|{}|{}⟧",
            self.book,
            self.chapter,
            self.verse.map(|v| v.to_string()).unwrap_or_default(),
            self.verse_end.map(|v| v.to_string()).unwrap_or_default(),
            label.replace(['⟦', '⟧', '|'], " ")
        )
    }
}

/// "1Sam.7.1", "Num.16", "Bible:Gen.1.1-Gen.1.3", several separated by spaces.
pub fn parse_osis(osis: &str) -> Vec<Ref> {
    let mut out = Vec::new();
    for part in osis.split_whitespace() {
        let part = part.split(':').next_back().unwrap_or(part); // drop a "Bible:" / "KJV:" prefix
        let (start, end) = part.split_once('-').map_or((part, None), |(a, b)| (a, Some(b)));
        let bits: Vec<&str> = start.split('.').collect();
        let Some(book) = bits.first().and_then(|b| osis_book(b)) else { continue };
        let Some(ch) = bits.get(1).and_then(|c| c.parse().ok()) else { continue };
        let verse = bits.get(2).and_then(|v| v.parse().ok());
        let mut verse_end = None;
        if let (Some(e), Some(_)) = (end, verse) {
            let eb: Vec<&str> = e.split('.').collect();
            if eb.len() >= 3 && eb[0] == bits[0] && eb[1] == bits[1] {
                verse_end = eb[2].parse().ok();
            }
        }
        out.push(Ref { book, chapter: ch, verse, verse_end });
    }
    out
}

/// Free-text reference lists, e.g. "Job 39:6; Isa 32:14", "1Jo 3:14,19; 4:18", "Nu 16".
pub fn parse_text(text: &str, start_book: Option<&'static str>) -> Vec<Ref> {
    static ITEM: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re_item = ITEM.get_or_init(|| regex::Regex::new(r"^(\d+)(?::(\d+))?(?:\s*-\s*(\d+)(?::(\d+))?)?").unwrap());
    let mut out = Vec::new();
    let mut book = start_book;
    let mut ch: Option<u32> = None;
    let text = text.replace(['\u{a0}'], " ").replace(['–', '—'], "-");
    let has_colon = text.contains(':');
    for part in text.split(';') {
        let mut part = part.trim().trim_end_matches('.').to_string();
        if part.is_empty() {
            continue;
        }
        if let Some(m) = book_prefix(&part) {
            match resolve_book(&part[..m]) {
                Some(b) => {
                    book = Some(b);
                    ch = None;
                    part = part[m..].to_string();
                }
                None => continue,
            }
        }
        let Some(b) = book else { continue };
        for item in part.split(',') {
            let item = item.trim().trim_end_matches('.');
            let Some(c) = re_item.captures(item) else { continue };
            let n = |i: usize| c.get(i).and_then(|m| m.as_str().parse::<u32>().ok());
            let (a, b2, c3, d) = (n(1), n(2), n(3), n(4));
            let Some(a) = a else { continue };
            if let Some(v) = b2 {
                ch = Some(a);
                let verse_end = if d.is_some() { None } else { c3 };
                out.push(Ref { book: b, chapter: a, verse: Some(v), verse_end });
            } else if let (Some(cur), true) = (ch, has_colon) {
                out.push(Ref { book: b, chapter: cur, verse: Some(a), verse_end: c3 });
            } else {
                ch = Some(a);
                out.push(Ref { book: b, chapter: a, verse: None, verse_end: None });
            }
        }
    }
    out
}

/// Byte length of a leading book name ("1 Cor ", "Song of Solomon ") that is followed by a
/// digit, if any.
fn book_prefix(s: &str) -> Option<usize> {
    let t = s.trim_start();
    let lead = s.len() - t.len();
    let chars: Vec<(usize, char)> = t.char_indices().collect();
    let mut i = 0;
    // optional number / roman numeral
    while i < chars.len() && (chars[i].1.is_ascii_digit() || "iI".contains(chars[i].1)) && i < 3 {
        i += 1;
    }
    while i < chars.len() && chars[i].1 == ' ' {
        i += 1;
    }
    let letters_start = i;
    while i < chars.len() && (chars[i].1.is_ascii_alphabetic() || chars[i].1 == '.' || chars[i].1 == ' ') {
        i += 1;
    }
    if i == letters_start || !chars[letters_start..i].iter().any(|(_, c)| c.is_ascii_alphabetic()) {
        // a bare number at the start is a chapter, not a book
        return None;
    }
    if i < chars.len() && chars[i].1.is_ascii_digit() {
        Some(lead + chars[i].0)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn osis_refs() {
        let r = parse_osis("Bible:Gen.1.1-Gen.1.3 Num.16");
        assert_eq!(r[0], Ref { book: "Genesis", chapter: 1, verse: Some(1), verse_end: Some(3) });
        assert_eq!(r[1].label(), "Numbers 16");
    }

    #[test]
    fn free_text_refs() {
        let r = parse_text("Job 39:6; Isa 32:14", None);
        assert_eq!(r.iter().map(Ref::label).collect::<Vec<_>>(), ["Job 39:6", "Isaiah 32:14"]);
        let r = parse_text("1Jo 3:14,19; 4:18", None);
        assert_eq!(r.iter().map(Ref::label).collect::<Vec<_>>(), ["1 John 3:14", "1 John 3:19", "1 John 4:18"]);
        let r = parse_text("II Kings 2", None);
        assert_eq!(r[0].label(), "2 Kings 2");
        let r = parse_text("Song of Solomon 2:1-3", None);
        assert_eq!(r[0].label(), "Song of Solomon 2:1-3");
        assert!(parse_text("chapter 3", None).is_empty());
    }
}
