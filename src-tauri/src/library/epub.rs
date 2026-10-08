//! Reads an EPUB e-book the reader supplies ("Add from file") into the plain sections the
//! book reader shows: one section per chapter, text only.
//!
//! EPUB is a zip of XHTML pages plus a package file (`.opf`) that lists them in reading
//! order and a table of contents (`nav` document in EPUB 3, `toc.ncx` in EPUB 2). Nothing
//! in the book is ever executed or displayed as HTML: scripts, styles, images and fonts
//! are dropped and the pages are reduced to text by `markup::to_text`, the same converter
//! the downloaded Library books go through.
//!
//! Copy-protected books (Adobe DRM, Kindle, library loans) are refused: their pages are
//! encrypted, and this app does not remove that.

use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::sync::OnceLock;

use regex::Regex;

use super::markup::{self, Kind};
use super::refs;

const MAX_FILES: usize = 6000;
const MAX_UNPACKED: u64 = 800 * 1024 * 1024;
const MAX_PAGE_BYTES: u64 = 30 * 1024 * 1024;
/// Less text than this and it isn't a book (or it's a scan: pictures of pages).
const MIN_CHARS: usize = 2000;
/// A section longer than this (a book with no chapters, or none marked) is divided into
/// parts of about `PART_CHARS`, at paragraph breaks, so it reads and listens comfortably.
const MAX_SECTION_CHARS: usize = 60_000;
const PART_CHARS: usize = 25_000;

pub struct Epub {
    pub title: String,
    pub author: String,
    /// language code as the book states it ("en", "en-US", "af")
    pub lang: String,
    pub rights: String,
    /// (title, text) in reading order
    pub sections: Vec<(String, String)>,
    pub warnings: Vec<String>,
    /// PDFs: how many pages the printed book has. Their starts are marked in the text as
    /// `page_mark(n)`, so the reader can show page numbers and go to a page. 0 = no pages.
    pub pages: u32,
}

/// The marker for "page `n` of the printed book starts here" (rendered by RichText.tsx as
/// a small page number in the margin; never read aloud or copied).
pub fn page_mark(n: u32) -> String {
    format!("⟪{n}⟫")
}

type Zip<'a> = zip::ZipArchive<Cursor<&'a [u8]>>;

fn rx(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid regex"))
}

macro_rules! rx {
    ($pat:expr) => {{
        static CELL: OnceLock<Regex> = OnceLock::new();
        rx(&CELL, $pat)
    }};
}

/// True if the zip looks like an EPUB (rather than, say, a SWORD module).
pub fn is_epub(bytes: &[u8]) -> bool {
    let Ok(mut zip) = zip::ZipArchive::new(Cursor::new(bytes)) else { return false };
    if zip.by_name("META-INF/container.xml").is_ok() {
        return true;
    }
    read_text(&mut zip, "mimetype", 200).is_some_and(|m| m.trim() == "application/epub+zip")
}

fn read_bytes(zip: &mut Zip, name: &str, max: u64) -> Option<Vec<u8>> {
    let f = zip.by_name(name).ok()?;
    if f.size() > max {
        return None;
    }
    let mut out = Vec::new();
    f.take(max).read_to_end(&mut out).ok()?;
    Some(out)
}

fn read_text(zip: &mut Zip, name: &str, max: u64) -> Option<String> {
    let bytes = read_bytes(zip, name, max)?;
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    Some(String::from_utf8_lossy(bytes).into_owned())
}

/// "%20" and friends in a manifest href.
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            if let Some(v) = s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// A path inside the zip from a base folder and a relative href (no fragment), with
/// "." and ".." resolved; None if it would leave the archive.
fn resolve(base_dir: &str, href: &str) -> Option<String> {
    let href = percent_decode(href.split('#').next().unwrap_or(""));
    if href.is_empty() || href.contains("://") {
        return None;
    }
    let mut parts: Vec<&str> = if href.starts_with('/') { Vec::new() } else { base_dir.split('/').filter(|p| !p.is_empty()).collect() };
    for p in href.split('/') {
        match p {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            p => parts.push(p),
        }
    }
    Some(parts.join("/"))
}

fn dir_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

fn child_text(node: roxmltree::Node, name: &str) -> String {
    node.descendants().find(|n| n.tag_name().name() == name).map(|n| n.text().unwrap_or("").trim().to_string()).unwrap_or_default()
}

fn xml_error(what: &str) -> String {
    format!("This e-book can't be read: its {what} is damaged.")
}

fn plain(s: &str) -> String {
    let s = rx!(r"<[^>]*>").replace_all(s, " ");
    markup::unescape(&s).split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Bible references written out in the prose ("Ephesians 6:12", "1 Cor. 13:4-7") become
/// the same clickable markers the Library's own books carry. Only chapter:verse forms are
/// linked, and only when the word before them is a book of the Bible.
pub fn link_references(text: &str) -> String {
    let re = rx!(r"\b((?:[1-3]|I{1,3})\s?)?([A-Z][a-z]+\.?(?:\s(?:of\s)?[A-Z][a-z]+)?)\s(\d{1,3}):(\d{1,3})(?:\s?[-–]\s?(\d{1,3}))?\b");
    re.replace_all(text, |c: &regex::Captures| {
        let name = format!("{}{}", c.get(1).map_or("", |m| m.as_str()), &c[2]);
        // "Song of Solomon" needs both words; "See John" must not swallow "See"
        let last_word = c[2].rsplit(' ').next().unwrap_or("").to_string();
        let lead = c.get(1).map_or("", |m| m.as_str());
        let candidates = [(name.clone(), 0usize), (format!("{lead}{last_word}"), c[2].len() - last_word.len())];
        for (cand, skip) in candidates {
            if cand.trim_end_matches('.').chars().filter(|ch| ch.is_alphabetic()).count() < 2 {
                continue;
            }
            let Some(book) = refs::resolve_book(&cand) else { continue };
            let (Ok(chapter), Ok(verse)) = (c[3].parse::<u32>(), c[4].parse::<u32>()) else { continue };
            let verse_end = c.get(5).and_then(|m| m.as_str().parse::<u32>().ok()).filter(|e| *e > verse);
            let whole = &c[0];
            // when only the last word is the book ("See John 3:16"), keep the words before it
            let split = if skip > 0 { lead.len() + skip } else { 0 };
            let r = refs::Ref { book, chapter, verse: Some(verse), verse_end };
            return format!("{}{}", &whole[..split], r.marker(Some(&whole[split..])));
        }
        c[0].to_string()
    })
    .into_owned()
}

/// One XHTML page as app text (paragraphs separated by newlines, references linked) and
/// its first heading, if it has one.
fn page_text(html: &str) -> (String, Option<String>, usize) {
    let mut s = html.to_string();
    for re in [
        rx!(r"(?is)<head\b.*?</head>"),
        rx!(r"(?is)<script\b.*?</script>"),
        rx!(r"(?is)<style\b.*?</style>"),
        rx!(r"(?is)<svg\b.*?</svg>"),
        rx!(r"(?is)<!--.*?-->"),
    ] {
        s = re.replace_all(&s, " ").into_owned();
    }
    let images = rx!(r"(?i)<img\b").find_iter(&s).count();
    let heading = rx!(r"(?is)<h[1-3]\b[^>]*>(.*?)</h[1-3]>").captures(&s).map(|c| plain(&c[1])).filter(|h| !h.is_empty() && h.chars().count() <= 120);
    // block elements markup::to_text doesn't know from the Library's formats
    s = rx!(r"(?i)</?(?:blockquote|tr|table|section|article|aside|header|footer|figure|figcaption|dd|dt|hr|pre)\b[^>]*>").replace_all(&s, "<br/>").into_owned();
    let text = markup::to_text(&s, "ThML", Kind::Book);
    (link_references(&text), heading, images)
}

/// Divides over-long sections into parts at paragraph breaks.
pub fn split_long(sections: Vec<(String, String)>) -> (Vec<(String, String)>, bool) {
    let mut out = Vec::new();
    let mut split = false;
    for (title, text) in sections {
        if text.len() <= MAX_SECTION_CHARS {
            out.push((title, text));
            continue;
        }
        split = true;
        let mut parts: Vec<String> = vec![String::new()];
        for para in text.split('\n') {
            let last = parts.last_mut().unwrap();
            if last.len() + para.len() > PART_CHARS && !last.trim().is_empty() && !para.trim().is_empty() {
                parts.push(String::new());
            }
            let last = parts.last_mut().unwrap();
            last.push_str(para);
            last.push('\n');
        }
        for (i, part) in parts.into_iter().enumerate() {
            out.push((format!("{title} — part {}", i + 1), part.trim().to_string()));
        }
    }
    (out, split)
}

/// Letters and digits only, lower case: what two readings of the same heading share when
/// the scan has misread a character or two.
fn squash(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// How alike two short strings are, 0..1 (edit distance against the longer one).
fn alike(a: &str, b: &str) -> f64 {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for i in 1..=a.len() {
        let mut prev = row[0];
        row[0] = i;
        for j in 1..=b.len() {
            let cur = row[j];
            row[j] = if a[i - 1] == b[j - 1] { prev } else { 1 + prev.min(row[j]).min(row[j - 1]) };
            prev = cur;
        }
    }
    1.0 - row[b.len()] as f64 / a.len().max(b.len()) as f64
}

fn page_number(token: &str) -> Option<u32> {
    let t = token.trim_matches(|c: char| !c.is_ascii_digit());
    (t.len() <= 4 && !t.is_empty() && token.chars().filter(|c| c.is_ascii_digit()).count() == t.len() && token.len() <= t.len() + 2).then(|| t.parse().ok()).flatten()
}

/// Two readings of a running header are the same header when they match apart from a
/// misread letter or two -- but never when their numbers differ ("Lecture I. Chap. 1:1-3"
/// and "Lecture II. Chap. 1:4-8" are different chapters).
fn same_header(a: &str, b: &str) -> bool {
    let digits = |s: &str| s.chars().filter(char::is_ascii_digit).collect::<String>();
    a == b || (digits(a) == digits(b) && alike(a, b) >= 0.7)
}

/// The pages of a scanned book -> chapters.
///
/// Every printed page starts with its running header, which the scan leaves in the text:
/// a left-hand page with its number and a title ("36 Lectures on the Revelation"), a
/// right-hand page with a title and its number ("The Seven Churches (chap. 2) 39"). The
/// headers are removed, and a new chapter begins wherever the title changes to something
/// other than the book's own name.
fn scan_sections(pages: Vec<String>) -> Vec<(String, String)> {
    const NOTICE: &str = "This book was produced in EPUB format by the Internet Archive";
    let estimate = rx!(r"The text on this page is estimated to be only [\d.]+% accurate\s*");
    let pages: Vec<String> = pages.into_iter().filter(|p| !p.trim_start().starts_with(NOTICE)).map(|p| estimate.replace_all(&p, "").into_owned()).collect();
    let heads: Vec<Vec<&str>> = pages.iter().map(|p| p.split_whitespace().take(16).collect()).collect();

    // --- the titles that follow the number on left-hand pages: phrases many pages start with
    let mut counts: HashMap<(usize, String), usize> = HashMap::new();
    for h in heads.iter().filter(|h| h.len() > 4 && page_number(h[0]).is_some()) {
        for len in 1..=8.min(h.len() - 1) {
            *counts.entry((len, squash(&h[1..=len].join(" ")))).or_default() += 1;
        }
    }
    // how many words of `after` (the words following a page number) are a running title
    let title_len = |after: &[&str]| -> usize {
        let count = |len: usize| after.get(..len).map_or(0, |w| counts.get(&(len, squash(&w.join(" ")))).copied().unwrap_or(0));
        let mut len = 0;
        while len < 8 && count(len + 1) >= 4 && (len == 0 || count(len + 1) * 100 >= count(len) * 15) {
            len += 1;
        }
        // a title is words, not the start of a sentence that happens to recur
        if after.get(..len).is_some_and(|w| w.join("").chars().filter(|c| c.is_alphabetic()).count() >= 4) {
            len
        } else {
            0
        }
    };
    // the book's own name: the left-hand title most pages carry, if one dominates
    let mut by_title: HashMap<String, usize> = HashMap::new();
    let mut titled = 0;
    for h in &heads {
        if h.len() > 4 && page_number(h[0]).is_some() {
            let len = title_len(&h[1..]);
            if len > 0 {
                *by_title.entry(squash(&h[1..=len].join(" "))).or_default() += 1;
                titled += 1;
            }
        }
    }
    let book_key = by_title.iter().max_by_key(|(_, n)| **n).filter(|(_, n)| **n * 2 > titled).map(|(k, _)| k.clone()).unwrap_or_default();

    // --- pass 1: each page's header (removed from its text) and the title it carries
    struct Page<'a> {
        body: &'a str,
        title: Option<String>,
        header: bool,
    }
    let mut read: Vec<Page> = Vec::with_capacity(pages.len());
    let mut expected: Option<u32> = None;
    for (page, head) in pages.iter().zip(&heads) {
        let skip = |words: usize| -> &str {
            let mut rest = page.trim_start();
            for _ in 0..words {
                rest = rest.trim_start();
                rest = rest.find(char::is_whitespace).map_or("", |i| &rest[i..]);
            }
            rest.trim_start()
        };
        let near = |n: u32| expected.is_some_and(|e| n + 3 >= e && n <= e + 6);
        let mut out = Page { body: page.as_str(), title: None, header: false };

        // a left-hand page: its number (which the scan may have misread: "5g"), then a title
        let first = head.first().copied().unwrap_or("");
        let numberish = page_number(first).is_some() || (first.len() <= 3 && first.chars().any(|c| c.is_ascii_digit()));
        let left_len = if numberish && head.len() > 1 { title_len(&head[1..]) } else { 0 };
        if numberish && (left_len > 0 || page_number(first).is_some_and(near)) {
            if left_len > 0 {
                out.title = Some(head[1..=left_len].join(" "));
            }
            out.body = skip(1 + left_len);
            out.header = true;
            expected = page_number(first).or(expected.map(|e| e + 1)).map(|n| n + 1);
        } else if let Some((i, n)) = head.iter().enumerate().skip(1).take(12).find_map(|(i, t)| {
            // a right-hand page: a title, then its number
            let n = page_number(t)?;
            let words = head[..i].join(" ");
            let known = !book_key.is_empty() && same_header(&squash(&words), &book_key);
            ((near(n) || known) && words.chars().filter(|c| c.is_alphabetic()).count() >= 4).then_some((i, n))
        }) {
            out.title = Some(head[..i].join(" "));
            out.body = skip(i + 1);
            out.header = true;
            expected = Some(n + 1);
        } else if let Some(e) = expected {
            expected = Some(e + 1);
        }
        // the book's own name tells nothing about the chapter
        // (nor does a cut-short reading of it: "Lectures on" for "Lectures on the Revelation")
        out.title = out.title.map(|t| t.trim_end_matches(['.', ',', ':', ' ']).to_string()).filter(|t| {
            let key = squash(t);
            book_key.is_empty() || !(same_header(&key, &book_key) || book_key.starts_with(&key))
        });
        read.push(out);
    }

    // --- chapter titles are the ones several pages agree on; a title seen once or twice is
    //     a misreading of its neighbours' and is ignored
    let mut groups: Vec<(String, HashMap<String, usize>, usize)> = Vec::new(); // (key, readings, pages)
    for p in &read {
        if let Some(t) = &p.title {
            let key = squash(t);
            let at = match groups.iter().position(|(k, _, _)| same_header(k, &key)) {
                Some(at) => at,
                None => {
                    groups.push((key, HashMap::new(), 0));
                    groups.len() - 1
                }
            };
            *groups[at].1.entry(t.clone()).or_default() += 1;
            groups[at].2 += 1;
        }
    }
    // (key, the reading most pages agree on, pages)
    let titles: Vec<(String, String, usize)> = groups
        .into_iter()
        .filter(|(_, _, n)| *n >= 3)
        .map(|(key, readings, n)| {
            let best = readings.into_iter().max_by(|a, b| a.1.cmp(&b.1).then(b.0.len().cmp(&a.0.len()))).map(|r| r.0).unwrap_or_default();
            (key, best, n)
        })
        .collect();
    let chapter_of = |t: &str| {
        let key = squash(t);
        titles.iter().position(|(k, _, _)| same_header(k, &key))
    };

    // --- pass 2: the chapters. A chapter's opening page usually has no header, and a page
    //     after it may name only the book: both go with the chapter the next header names.
    let mut sections: Vec<(String, String)> = Vec::new();
    let mut current: Option<usize> = None;
    // where, in the chapter being built, a page with no chapter title began
    let mut opening_at: Option<usize> = None;
    for p in &read {
        let chapter = p.title.as_deref().and_then(chapter_of);
        if let Some(c) = chapter {
            if current != Some(c) {
                let carried = opening_at.take().and_then(|at| sections.last_mut().map(|s| s.1.split_off(at))).unwrap_or_default();
                sections.push((titles[c].1.clone(), carried.trim().to_string()));
                current = Some(c);
            } else {
                opening_at = None; // still in the same chapter
            }
        }
        if sections.is_empty() {
            sections.push(("Beginning".to_string(), String::new()));
        }
        let last = sections.last_mut().unwrap();
        if !p.header && opening_at.is_none() {
            opening_at = Some(last.1.len());
        }
        if p.body.trim().is_empty() {
            continue;
        }
        if !last.1.is_empty() {
            last.1.push_str("\n\n");
        }
        last.1.push_str(p.body.trim());
    }
    sections.retain(|s| !s.1.trim().is_empty());
    sections
}

/// A title from the file's own name ("with-christ_in the school.epub" -> "with christ in the school").
pub fn title_from_file(name: &str) -> String {
    let stem = name.rsplit(['/', '\\']).next().unwrap_or(name);
    let stem = stem.rsplit_once('.').map_or(stem, |(s, _)| s);
    stem.replace(['_', '-', '.'], " ").split_whitespace().collect::<Vec<_>>().join(" ").chars().take(120).collect()
}

/// Reads and checks an EPUB. Every refusal says why in plain words. `file_name` is used for
/// the title when the book doesn't state one.
pub fn read(bytes: &[u8], file_name: Option<&str>) -> Result<Epub, String> {
    let mut zip: Zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "This isn't an e-book file the app can open.".to_string())?;
    if zip.len() > MAX_FILES {
        return Err("The e-book has too many files inside it.".into());
    }
    let mut total = 0u64;
    for i in 0..zip.len() {
        total += zip.by_index(i).map(|f| f.size()).unwrap_or(0);
    }
    if total > MAX_UNPACKED {
        return Err("The e-book unpacks to more than 800 MB, which is too large.".into());
    }

    // --- copy protection: encrypted pages can't be read, and the app doesn't unlock them
    const FONT_ONLY: [&str; 2] = ["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"];
    let protected = "This e-book is copy-protected (DRM), so it can't be added. Books bought for Kindle, Kobo or Apple Books, and library loans, are usually locked this way.";
    if zip.by_name("META-INF/rights.xml").is_ok() {
        return Err(protected.into());
    }
    if let Some(enc) = read_text(&mut zip, "META-INF/encryption.xml", 5_000_000) {
        // obfuscated fonts are allowed in an unprotected book; anything else is DRM
        let algorithms: Vec<String> = rx!(r#"Algorithm\s*=\s*["']([^"']+)["']"#).captures_iter(&enc).map(|c| c[1].to_string()).collect();
        if algorithms.is_empty() || algorithms.iter().any(|a| !FONT_ONLY.contains(&a.as_str())) {
            return Err(protected.into());
        }
    }

    // --- the package file: title, pages, reading order
    let container = read_text(&mut zip, "META-INF/container.xml", 1_000_000).ok_or("This isn't an EPUB e-book: its list of contents (META-INF/container.xml) is missing.")?;
    let opf_path = {
        let doc = roxmltree::Document::parse(&container).map_err(|_| xml_error("list of contents"))?;
        let found = doc.descendants().find(|n| n.tag_name().name() == "rootfile").and_then(|n| n.attribute("full-path")).map(|p| p.trim_start_matches('/').to_string());
        found.ok_or_else(|| xml_error("list of contents"))?
    };
    let opf = read_text(&mut zip, &opf_path, 20_000_000).ok_or_else(|| xml_error("package file"))?;
    let doc = roxmltree::Document::parse(&opf).map_err(|_| xml_error("package file"))?;
    let base = dir_of(&opf_path).to_string();
    let meta = doc.descendants().find(|n| n.tag_name().name() == "metadata").ok_or_else(|| xml_error("package file"))?;
    let mut title = child_text(meta, "title");
    let author = child_text(meta, "creator");
    let lang = child_text(meta, "language");
    let rights = child_text(meta, "rights");
    let mut warnings = Vec::new();
    if title.is_empty() {
        title = file_name.map(title_from_file).unwrap_or_default();
        if title.is_empty() {
            return Err("This e-book doesn't state its title, so it can't be added.".into());
        }
        warnings.push("The e-book doesn't state its title, so the file's name is used.".to_string());
    }

    struct Item {
        path: String,
        media: String,
        nav: bool,
    }
    let mut manifest: HashMap<String, Item> = HashMap::new();
    for n in doc.descendants().filter(|n| n.tag_name().name() == "item") {
        let (Some(id), Some(href)) = (n.attribute("id"), n.attribute("href")) else { continue };
        let Some(path) = resolve(&base, href) else { continue };
        let media = n.attribute("media-type").unwrap_or("").to_ascii_lowercase();
        let nav = n.attribute("properties").is_some_and(|p| p.split_whitespace().any(|w| w == "nav"));
        manifest.insert(id.to_string(), Item { path, media, nav });
    }
    let spine_node = doc.descendants().find(|n| n.tag_name().name() == "spine").ok_or_else(|| xml_error("reading order"))?;
    let spine: Vec<&Item> = spine_node
        .children()
        .filter(|n| n.tag_name().name() == "itemref")
        .filter_map(|n| n.attribute("idref").and_then(|id| manifest.get(id)))
        .filter(|i| i.media.contains("html") || i.path.to_lowercase().ends_with("html") || i.path.to_lowercase().ends_with(".htm"))
        .collect();
    if spine.is_empty() {
        return Err("This e-book has no readable pages (it may be a fixed-layout or picture book).".into());
    }

    // --- chapter titles from the table of contents: page path -> title (first entry wins)
    let mut titles: HashMap<String, String> = HashMap::new();
    if let Some(nav) = manifest.values().find(|i| i.nav) {
        if let Some(html) = read_text(&mut zip, &nav.path, MAX_PAGE_BYTES) {
            let nav_dir = dir_of(&nav.path).to_string();
            for c in rx!(r#"(?is)<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>"#).captures_iter(&html) {
                let label = plain(&c[2]);
                if let (Some(path), false) = (resolve(&nav_dir, &c[1]), label.is_empty()) {
                    titles.entry(path).or_insert(label);
                }
            }
        }
    }
    let ncx_path = spine_node.attribute("toc").and_then(|id| manifest.get(id)).map(|i| i.path.clone()).or_else(|| manifest.values().find(|i| i.media.contains("ncx")).map(|i| i.path.clone()));
    if let Some(ncx_path) = ncx_path {
        if let Some(ncx) = read_text(&mut zip, &ncx_path, MAX_PAGE_BYTES) {
            if let Ok(ncx_doc) = roxmltree::Document::parse(&ncx) {
                let ncx_dir = dir_of(&ncx_path).to_string();
                for p in ncx_doc.descendants().filter(|n| n.tag_name().name() == "navPoint") {
                    let label = p.children().find(|n| n.tag_name().name() == "navLabel").map(|n| child_text(n, "text")).unwrap_or_default();
                    let src = p.children().find(|n| n.tag_name().name() == "content").and_then(|n| n.attribute("src"));
                    if let (Some(path), false) = (src.and_then(|s| resolve(&ncx_dir, s)), label.is_empty()) {
                        titles.entry(path).or_insert(label);
                    }
                }
            }
        }
    }

    // --- the pages, in reading order. A page with no title of its own continues the
    //     chapter before it (many e-books split one chapter over several files).
    let mut docs: Vec<(Option<String>, String)> = Vec::new();
    let (mut images, mut missing) = (0usize, 0usize);
    for item in spine {
        let Some(html) = read_text(&mut zip, &item.path, MAX_PAGE_BYTES) else {
            missing += 1;
            continue;
        };
        let (text, heading, imgs) = page_text(&html);
        images += imgs;
        if text.is_empty() {
            continue;
        }
        docs.push((titles.get(&item.path).cloned().or(heading), text));
    }
    // A scanned book (the Internet Archive's automatic e-books) is one file per printed page
    // with no chapters marked: rebuild them from the running page headers instead.
    let scanned = docs.len() >= 30 && docs.iter().filter(|d| d.0.is_some()).count() * 10 <= docs.len();
    let mut sections: Vec<(String, String)> = Vec::new();
    if scanned {
        sections = scan_sections(docs.into_iter().map(|d| d.1).collect());
        warnings.push("This is a scanned book: its text was read by machine, so expect some misspelt words. Chapters are taken from the page headings.".to_string());
    } else {
        for (title, text) in docs {
            match (title, sections.last_mut()) {
                (None, Some(last)) => {
                    last.1.push_str("\n\n");
                    last.1.push_str(&text);
                }
                (title, _) => sections.push((title.unwrap_or_else(|| "Beginning".to_string()), text)),
            }
        }
    }
    let chars: usize = sections.iter().map(|(_, t)| t.chars().count()).sum();
    if chars < MIN_CHARS {
        return Err(if images > 0 {
            "This e-book has almost no text: its pages are pictures (a scanned book), which the app can't read.".into()
        } else {
            "This e-book has almost no text in it, so it wasn't added.".to_string()
        });
    }
    let (sections, split) = split_long(sections);
    if split {
        warnings.push("Long stretches without chapter headings are divided into parts.".to_string());
    }
    if missing > 0 {
        warnings.push(format!("{missing} page(s) listed in the book are missing from the file and were skipped."));
    }
    if images > 0 {
        warnings.push(format!("{images} picture(s) in the book are left out; only the text is added."));
    }
    Ok(Epub { title: plain(&title), author: plain(&author), lang, rights: plain(&rights), sections, warnings, pages: 0 })
}

/// A library name for the reader's own book, from its title: "own-he-came-to-set-the-captives-free".
pub fn module_name(title: &str) -> String {
    let mut slug = String::new();
    for ch in title.chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
        if slug.len() >= 48 {
            break;
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        // a title with no Latin letters: a stable number from its characters
        let n = title.chars().fold(0u32, |a, c| a.wrapping_mul(31).wrapping_add(c as u32));
        format!("own-book-{n}")
    } else {
        format!("own-{slug}")
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::io::Write;

    pub fn make(files: &[(&str, &str)]) -> Vec<u8> {
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, data) in files {
            z.start_file(*name, zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(data.as_bytes()).unwrap();
        }
        z.finish().unwrap().into_inner()
    }

    pub const NOTICE_TEXT: &str = "This book was produced in EPUB format by the Internet Archive";
    pub const CONTAINER: &str = r#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#;
    pub const OPF: &str = r#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Grace &amp; Truth</dc:title><dc:creator>A. Writer</dc:creator><dc:language>en-GB</dc:language></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="text/ch%201.xhtml" media-type="application/xhtml+xml"/><item id="c1b" href="text/ch1b.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/><item id="css" href="s.css" media-type="text/css"/></manifest>
<spine><itemref idref="c1"/><itemref idref="c1b"/><itemref idref="c2"/></spine></package>"#;
    pub const NAV: &str = r#"<html><body><nav epub:type="toc"><ol><li><a href="text/ch%201.xhtml">One: <i>The Beginning</i></a></li><li><a href="text/ch2.xhtml#top">Two</a></li></ol></nav></body></html>"#;

    pub fn sample() -> Vec<u8> {
        let filler = "<p>Grace and truth came by Jesus Christ. </p>".repeat(60);
        let ch1 = format!(r#"<html><head><title>x</title><style>p{{color:red}}</style></head><body><script>alert(1)</script><h1>Chapter 1</h1><p>See John 3:16 and 1 Cor. 13:4-7; also Song of Solomon 2:1.</p><img src="a.png"/>{filler}</body></html>"#);
        let ch1b = "<html><body><p>The chapter carries on here with no heading.</p></body></html>".to_string();
        let ch2 = format!("<html><body><h2>Second</h2><blockquote>Quoted.</blockquote><p>Page 3:16 is not a verse, and May 3 is a date.</p>{filler}</body></html>");
        make(&[("mimetype", "application/epub+zip"), ("META-INF/container.xml", CONTAINER), ("OEBPS/content.opf", OPF), ("OEBPS/nav.xhtml", NAV), ("OEBPS/text/ch 1.xhtml", &ch1), ("OEBPS/text/ch1b.xhtml", &ch1b), ("OEBPS/text/ch2.xhtml", &ch2), ("OEBPS/s.css", "p{}")])
    }

    #[test]
    fn reads_a_book() {
        let bytes = sample();
        assert!(is_epub(&bytes));
        let b = read(&bytes, None).unwrap();
        assert_eq!((b.title.as_str(), b.author.as_str(), b.lang.as_str()), ("Grace & Truth", "A. Writer", "en-GB"));
        assert_eq!(b.sections.iter().map(|s| s.0.as_str()).collect::<Vec<_>>(), ["One: The Beginning", "Two"]);
        let one = &b.sections[0].1;
        assert!(one.contains("⟦John|3|16||John 3:16⟧") && one.contains("⟦1 Corinthians|13|4|7|1 Cor. 13:4-7⟧") && one.contains("⟦Song of Solomon|2|1||Song of Solomon 2:1⟧"), "{one}");
        assert!(one.contains("See ⟦John"), "the word before the book is kept: {one}");
        assert!(one.ends_with("The chapter carries on here with no heading."), "an untitled page joins the chapter before it");
        assert!(!one.contains("alert") && !one.contains("color:red") && !one.contains('<'));
        let two = &b.sections[1].1;
        assert!(two.contains("Page 3:16 is not a verse") && !two.contains("⟦"), "{two}");
        assert_eq!(b.warnings.len(), 1, "the picture is mentioned: {:?}", b.warnings);
        assert_eq!(module_name("He Came to Set the Captives Free!"), "own-he-came-to-set-the-captives-free");
        assert_eq!(title_from_file("C:\\books\\with-christ_in.the school.epub"), "with christ in the school");
        let long = (0..400).map(|i| format!("Paragraph {i} {}", "word ".repeat(60))).collect::<Vec<_>>().join("\n");
        let (parts, split) = split_long(vec![("Beginning".into(), long.clone()), ("Short".into(), "x".into())]);
        assert!(split && parts.len() > 3 && parts[0].0 == "Beginning — part 1" && parts.last().unwrap().0 == "Short");
        assert_eq!(parts.iter().filter(|p| p.0 != "Short").map(|p| p.1.as_str()).collect::<Vec<_>>().join(" ").split_whitespace().count(), long.split_whitespace().count(), "nothing lost in the split");
    }

    /// Real e-books (Project Gutenberg, Standard Ebooks, Internet Archive) from
    /// %LOCALAPPDATA%\bible-concordance-build\library-probe\epub:
    ///   cargo test real_epubs -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_epubs() {
        let dir = std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap()).join(std::env::var("BC_EPUB_DIR").unwrap_or_else(|_| "bible-concordance-build/library-probe/epub".into()));
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let bytes = std::fs::read(e.path()).unwrap();
            match read(&bytes, e.file_name().to_str()) {
                Ok(b) => {
                    let chars: usize = b.sections.iter().map(|s| s.1.len()).sum();
                    let links: usize = b.sections.iter().map(|s| s.1.matches('⟦').count()).sum();
                    println!("{:?}: '{}' by '{}' [{}] {} sections, {} chars, {} verse links, {:?}", e.file_name(), b.title, b.author, b.lang, b.sections.len(), chars, links, b.warnings);
                    for (t, x) in b.sections.iter().take(6) {
                        println!("    {:<45} {:>7}  {}", t.chars().take(45).collect::<String>(), x.len(), x.chars().take(70).collect::<String>().replace('\n', " / "));
                    }
                }
                Err(err) => println!("{:?}: REFUSED {err}", e.file_name()),
            }
        }
    }

    #[test]
    fn a_scanned_book_gets_its_chapters_from_the_page_headers() {
        let para = "Grace and truth came by Jesus Christ, and of his fulness have we all received. ".repeat(8);
        let mut pages: Vec<String> = vec![format!("{} and so on.", NOTICE_TEXT)];
        let mut n = 9;
        for (chapter, count) in [("The First Vision (chap. 1: 9-20)", 10), ("The Seven Churches (chap. 2)", 12), ("The Throne in Heaven (chap. 4)", 10)] {
            pages.push(format!("LECTURE. Opening words of this chapter. {para}")); // a chapter opening: no header
            n += 1;
            for i in 0..count {
                n += 1;
                // the scan misreads a letter now and then
                let head = if i == 3 { chapter.replace('e', "c") } else { chapter.to_string() };
                pages.push(if n % 2 == 0 { format!("{n} Lectures on the Revelation {para}") } else { format!("{head} {n} {para}") });
            }
        }
        let sections = scan_sections(pages);
        let titles: Vec<&str> = sections.iter().map(|s| s.0.as_str()).collect();
        assert_eq!(titles, ["The First Vision (chap. 1: 9-20)", "The Seven Churches (chap. 2)", "The Throne in Heaven (chap. 4)"], "{titles:?}");
        assert!(same_header("lectureichap118", "lecturcichap118") && !same_header("lectureichap113", "lectureiichap148"));
        let all = sections.iter().map(|s| s.1.as_str()).collect::<Vec<_>>().join(" ");
        assert!(!all.contains("Lectures on the Revelation") && !all.contains("(chap. 2) 2") && !all.contains("Internet Archive"), "headers and the notice are gone");
        assert!(sections[1].1.starts_with("LECTURE. Opening words"), "a chapter's opening page goes with its chapter: {}", &sections[1].1[..60]);
        assert_eq!(all.matches("Opening words").count(), 3);
    }

    #[test]
    fn refuses_protected_and_empty_books() {
        let enc = r#"<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#"><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>"#;
        let font = enc.replace("http://www.w3.org/2001/04/xmlenc#aes128-cbc", "http://www.idpf.org/2008/embedding");
        let page = format!("<html><body><h1>One</h1>{}</body></html>", "<p>Plenty of words here. </p>".repeat(120));
        let base = |extra: &[(&str, &str)]| {
            let mut files = vec![("META-INF/container.xml", CONTAINER), ("OEBPS/content.opf", OPF), ("OEBPS/text/ch 1.xhtml", page.as_str())];
            files.extend_from_slice(extra);
            make(&files)
        };
        assert!(read(&base(&[]), None).is_ok());
        assert!(read(&base(&[("META-INF/encryption.xml", enc)]), None).err().unwrap().contains("copy-protected"));
        assert!(read(&base(&[("META-INF/rights.xml", "<rights/>")]), None).err().unwrap().contains("copy-protected"));
        assert!(read(&base(&[("META-INF/encryption.xml", &font)]), None).is_ok(), "obfuscated fonts alone are not DRM");
        // pictures of pages, no text
        let scan = make(&[("META-INF/container.xml", CONTAINER), ("OEBPS/content.opf", OPF), ("OEBPS/text/ch 1.xhtml", r#"<html><body><img src="p1.jpg"/></body></html>"#)]);
        assert!(read(&scan, None).err().unwrap().contains("pictures"));
        assert!(read(b"%PDF-1.7", None).is_err());
        assert!(read(&make(&[("META-INF/container.xml", "<broken")]), None).is_err());
        assert!(!is_epub(&make(&[("mods.d/x.conf", "[X]")])));
    }
}
