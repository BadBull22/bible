//! Reads a PDF book the reader supplies ("Add from file") into the same plain sections an
//! e-book becomes (see epub.rs).
//!
//! A PDF records where each letter sits on a printed page, not paragraphs or chapters, so
//! the book is rebuilt from the page layout: lines are joined back into paragraphs, words
//! hyphenated across lines are rejoined, and page numbers and running headers are dropped.
//! Chapters come from the PDF's bookmarks when it has them; otherwise the text is divided
//! into parts by length. The result is rougher than an EPUB, and the check screen says so.
//!
//! Refused: password-protected or copy-protected PDFs (the app does not unlock them), and
//! scanned books that are only pictures of pages (no text to read).

use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};

use pdf_extract::{output_doc_page, Document, Object, PlainTextOutput};

use super::epub::{self, Epub};

const MAX_PAGES: usize = 6000;
/// Fewer characters than this per page, on average over the pages that have any text, and
/// the "text" is stray marks on a scan rather than a book.
const MIN_CHARS_PER_PAGE: usize = 150;

pub fn is_pdf(bytes: &[u8]) -> bool {
    bytes.len() > 8 && bytes[..1024.min(bytes.len())].windows(5).any(|w| w == b"%PDF-")
}

/// Title / Author from the PDF's information dictionary.
fn info(doc: &Document, key: &[u8]) -> String {
    let dict = doc.trailer.get(b"Info").ok().and_then(|o| match o {
        Object::Reference(id) => doc.get_dictionary(*id).ok(),
        Object::Dictionary(d) => Some(d),
        _ => None,
    });
    dict.and_then(|d| d.get(key).ok())
        .and_then(|o| pdf_extract::decode_text_string(o).ok())
        .map(|s| s.chars().filter(|c| !c.is_control()).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" "))
        .unwrap_or_default()
}

/// A title PDF tools fill in by themselves, which says nothing about the book.
fn junk_title(t: &str) -> bool {
    let l = t.to_lowercase();
    t.chars().filter(|c| c.is_alphabetic()).count() < 3
        || l.starts_with("microsoft word")
        || l.starts_with("untitled")
        || l.ends_with(".doc")
        || l.ends_with(".docx")
        || l.ends_with(".pdf")
        || l.ends_with(".indd")
        || l.ends_with(".qxd")
}

fn is_page_number(line: &str) -> bool {
    let t = line.trim().trim_matches(|c: char| c == '-' || c == '–' || c == '—' || c == '[' || c == ']' || c == '(' || c == ')' || c == '.' || c == ' ');
    let t = t.strip_prefix("Page ").or_else(|| t.strip_prefix("page ")).unwrap_or(t);
    !t.is_empty() && t.len() <= 7 && (t.chars().all(|c| c.is_ascii_digit()) || t.chars().all(|c| "ivxlcIVXLC".contains(c)))
}

/// A line with its digits removed, to spot the running header or footer that repeats on
/// most pages ("12  THE PURSUIT OF GOD", "Chapter 3 · 47").
fn header_key(line: &str) -> String {
    line.chars().filter(|c| c.is_alphabetic()).flat_map(char::to_lowercase).collect()
}

/// One page's lines -> paragraphs. `mark` (the page's number marker) goes after the page's
/// first word, so a word hyphenated across the page break is still rejoined.
fn paragraphs(lines: &[&str], out: &mut Vec<String>, carry: &mut String, mark: &str) {
    let mut mark = Some(mark);
    let lengths: Vec<usize> = lines.iter().map(|l| l.trim().chars().count()).filter(|n| *n > 20).collect();
    let typical = {
        let mut s = lengths.clone();
        s.sort_unstable();
        s.get(s.len() * 3 / 4).copied().unwrap_or(60)
    };
    // scans with a text layer put a gap after every line: there a blank line means nothing
    let text_lines = lines.iter().filter(|l| !l.trim().is_empty()).count();
    let gaps = lines.windows(2).filter(|w| !w[0].trim().is_empty() && w[1].trim().is_empty()).count();
    let gap_every_line = text_lines >= 6 && gaps * 10 >= text_lines * 6;
    for raw in lines {
        let line = raw.split_whitespace().collect::<Vec<_>>().join(" ");
        if line.is_empty() {
            if !carry.is_empty() && !gap_every_line {
                out.push(std::mem::take(carry));
            }
            continue;
        }
        if carry.ends_with('-') && line.chars().next().is_some_and(char::is_lowercase) && carry.chars().rev().nth(1).is_some_and(char::is_alphabetic) {
            carry.pop(); // a word split across two lines
        } else if !carry.is_empty() {
            carry.push(' ');
        }
        match mark.take() {
            Some(m) => {
                let (first, rest) = line.split_once(' ').unwrap_or((&line, ""));
                carry.push_str(first);
                carry.push(' ');
                carry.push_str(m);
                if !rest.is_empty() {
                    carry.push(' ');
                    carry.push_str(rest);
                }
            }
            None => carry.push_str(&line),
        }
        // a short last line ending a sentence closes the paragraph (books that indent
        // paragraphs instead of leaving space between them)
        let short = line.chars().count() * 100 < typical * 75;
        if short && line.ends_with(['.', '!', '?', '"', '”', ':']) {
            out.push(std::mem::take(carry));
        }
    }
}

fn protected() -> String {
    "This PDF is password-protected or copy-protected, so it can't be added.".into()
}

/// Reads and checks a PDF. Every refusal says why in plain words.
pub fn read(bytes: &[u8], file_name: Option<&str>) -> Result<Epub, String> {
    // PDF parsing libraries can panic on a malformed file: treat that as "damaged"
    let damaged = || "This PDF is damaged or in a form the app can't read, so it wasn't added.".to_string();
    let doc = catch_unwind(|| Document::load_mem(bytes)).map_err(|_| damaged())?;
    let doc = match doc {
        Ok(d) => d,
        Err(e) => {
            let e = e.to_string().to_lowercase();
            return Err(if e.contains("encrypt") || e.contains("password") || e.contains("decrypt") { protected() } else { damaged() });
        }
    };
    if doc.is_encrypted() || doc.trailer.get(b"Encrypt").is_ok() {
        return Err(protected());
    }
    let page_count = doc.get_pages().len();
    if page_count == 0 {
        return Err(damaged());
    }
    if page_count > MAX_PAGES {
        return Err(format!("This PDF has {page_count} pages, which is too many to add as one book."));
    }

    // --- the text of every page
    let mut pages: Vec<String> = Vec::with_capacity(page_count);
    let mut failed = 0usize;
    for n in 1..=page_count as u32 {
        let text = catch_unwind(AssertUnwindSafe(|| {
            let mut s = String::new();
            let mut out = PlainTextOutput::new(&mut s);
            output_doc_page(&doc, &mut out, n).map(|_| s)
        }));
        match text {
            Ok(Ok(s)) => pages.push(s),
            _ => {
                failed += 1;
                pages.push(String::new());
            }
        }
    }
    let with_text = pages.iter().filter(|p| p.chars().filter(|c| c.is_alphabetic()).count() >= 40).count();
    let letters: usize = pages.iter().map(|p| p.chars().filter(|c| c.is_alphabetic()).count()).sum();
    if with_text * 2 < page_count || letters < with_text.max(1) * MIN_CHARS_PER_PAGE {
        return Err(if failed * 2 > page_count {
            damaged()
        } else {
            "This PDF has little or no text: it is a scanned book (pictures of pages), which the app can't read.".to_string()
        });
    }
    // text that came out as rubbish (fonts with no character map)
    let all: usize = pages.iter().map(|p| p.chars().filter(|c| !c.is_whitespace()).count()).sum();
    let odd: usize = pages.iter().map(|p| p.chars().filter(|c| *c == '\u{FFFD}' || (c.is_control() && !c.is_whitespace()) || ('\u{E000}'..='\u{F8FF}').contains(c)).count()).sum();
    if odd * 20 > all {
        return Err("The text in this PDF can't be read properly (its letters are stored in a way that doesn't convert to text), so it wasn't added.".into());
    }

    // --- running headers/footers: a first or last line that repeats on many pages
    let mut seen: HashMap<String, usize> = HashMap::new();
    for p in &pages {
        let lines: Vec<&str> = p.lines().filter(|l| !l.trim().is_empty()).collect();
        let mut keys: Vec<String> = Vec::new();
        for l in lines.iter().take(1).chain(lines.iter().rev().take(1)) {
            let k = header_key(l);
            if k.len() >= 4 && l.trim().chars().count() < 90 && !keys.contains(&k) {
                keys.push(k);
            }
        }
        for k in keys {
            *seen.entry(k).or_default() += 1;
        }
    }
    // on a fifth of the pages (the book's title), or a few times with a page number beside
    // it (a chapter's title: "Breakthrough -- The Beauty of Christ 35")
    let numbered = |line: &str| {
        let t = line.trim();
        t.split_whitespace().next().is_some_and(is_page_number) || t.split_whitespace().next_back().is_some_and(is_page_number)
    };
    let repeated = |line: &str| seen.get(&header_key(line)).is_some_and(|n| (*n >= 4 && *n * 5 >= with_text) || (*n >= 3 && numbered(line)));

    // --- chapters from the bookmarks: (first page index, title), top level only
    let mut starts: Vec<(usize, String)> = Vec::new();
    if let Ok(Ok(toc)) = catch_unwind(AssertUnwindSafe(|| doc.get_toc())) {
        let top = toc.toc.iter().map(|t| t.level).min().unwrap_or(1);
        // a single top-level bookmark (the book's own title) with the chapters beneath it
        let level = if toc.toc.iter().filter(|t| t.level == top).count() <= 1 { top + 1 } else { top };
        // and the level beneath (the chapters of "Part I")
        for t in toc.toc.iter().filter(|t| t.level == level || t.level == level + 1) {
            let title = t.title.chars().filter(|c| !c.is_control()).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
            let page = t.page.saturating_sub(1);
            if !title.is_empty() && page < page_count && starts.last().is_none_or(|(p, _)| page > *p) {
                starts.push((page, title.chars().take(120).collect()));
            }
        }
    }
    let bookmarked = starts.len() >= 2;
    if !bookmarked {
        starts.clear();
    }

    // --- rebuild paragraphs, section by section
    let mut sections: Vec<(String, String)> = Vec::new();
    let mut paras: Vec<String> = Vec::new();
    let mut carry = String::new();
    let mut current = "Beginning".to_string();
    let mut next_start = 0usize;
    let close = |title: &str, paras: &mut Vec<String>, carry: &mut String, sections: &mut Vec<(String, String)>| {
        if !carry.is_empty() {
            paras.push(std::mem::take(carry));
        }
        let text = epub::link_references(&paras.join("\n\n"));
        paras.clear();
        if !text.trim().is_empty() {
            sections.push((title.to_string(), text));
        }
    };
    for (i, page) in pages.iter().enumerate() {
        if next_start < starts.len() && starts[next_start].0 == i {
            close(&current, &mut paras, &mut carry, &mut sections);
            current = starts[next_start].1.clone();
            next_start += 1;
        }
        let mut lines: Vec<&str> = page.lines().collect();
        // drop the page number and running header/footer at the top and bottom
        for _ in 0..2 {
            while lines.first().is_some_and(|l| l.trim().is_empty()) {
                lines.remove(0);
            }
            if lines.first().is_some_and(|l| is_page_number(l) || repeated(l)) {
                lines.remove(0);
            }
            while lines.last().is_some_and(|l| l.trim().is_empty()) {
                lines.pop();
            }
            if lines.last().is_some_and(|l| is_page_number(l) || repeated(l)) {
                lines.pop();
            }
        }
        paragraphs(&lines, &mut paras, &mut carry, &epub::page_mark(i as u32 + 1));
    }
    close(&current, &mut paras, &mut carry, &mut sections);
    let (sections, split) = epub::split_long(sections);

    let mut warnings = vec!["A PDF stores printed pages, not chapters and paragraphs, so the text may have stray page headers, footnotes in mid-page or odd line breaks.".to_string()];
    let mut title = info(&doc, b"Title");
    if junk_title(&title) {
        title = file_name.map(epub::title_from_file).unwrap_or_default();
        if title.is_empty() {
            return Err("This PDF doesn't state its title, so it can't be added.".into());
        }
        warnings.push("The PDF doesn't state its title, so the file's name is used.".to_string());
    }
    if bookmarked {
        warnings.push(format!("Chapters are taken from the PDF's {} bookmarks.", starts.len()));
    } else if split {
        warnings.push("The PDF has no chapter bookmarks, so the book is divided into parts by length.".to_string());
    }
    if failed > 0 {
        warnings.push(format!("{failed} of {page_count} pages couldn't be read and are left out."));
    }
    let blank = page_count - with_text - failed.min(page_count - with_text);
    if blank * 10 > page_count {
        warnings.push(format!("{blank} of {page_count} pages have no text (pictures or blank pages) and are left out."));
    }
    Ok(Epub { title, author: info(&doc, b"Author"), lang: String::new(), rights: String::new(), sections, warnings, pages: page_count as u32 })
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use pdf_extract::content::{Content, Operation};
    use pdf_extract::{dictionary, Stream};

    /// A small real PDF: one page per entry, each a list of text lines; optional title.
    pub fn make(pages: &[Vec<String>], title: Option<&str>) -> Vec<u8> {
        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();
        let font = doc.add_object(dictionary! { "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica", "Encoding" => "WinAnsiEncoding" });
        let resources = doc.add_object(dictionary! { "Font" => dictionary! { "F1" => font } });
        let mut kids = Vec::new();
        for lines in pages {
            let mut ops = vec![Operation::new("BT", vec![]), Operation::new("Tf", vec!["F1".into(), 11.into()]), Operation::new("TL", vec![14.into()]), Operation::new("Td", vec![72.into(), 760.into()])];
            for l in lines {
                if l.is_empty() {
                    ops.push(Operation::new("Td", vec![0.into(), (-30).into()])); // a gap: new paragraph
                } else {
                    ops.push(Operation::new("Tj", vec![Object::string_literal(l.as_str())]));
                    ops.push(Operation::new("T*", vec![]));
                }
            }
            ops.push(Operation::new("ET", vec![]));
            let content = doc.add_object(Stream::new(dictionary! {}, Content { operations: ops }.encode().unwrap()));
            kids.push(doc.add_object(dictionary! { "Type" => "Page", "Parent" => pages_id, "Contents" => content, "Resources" => resources, "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()] }));
        }
        let count = kids.len() as i64;
        doc.objects.insert(pages_id, Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids.into_iter().map(Object::Reference).collect::<Vec<_>>(), "Count" => count }));
        let catalog = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog);
        if let Some(t) = title {
            let info = doc.add_object(dictionary! { "Title" => Object::string_literal(t), "Author" => Object::string_literal("A. Writer") });
            doc.trailer.set("Info", info);
        }
        let mut out = Vec::new();
        doc.save_to(&mut out).unwrap();
        out
    }

    pub fn sample(title: Option<&str>) -> Vec<u8> {
        let pages: Vec<Vec<String>> = (1..=8)
            .map(|n| {
                let mut lines = vec!["GRACE AND TRUTH".to_string(), String::new()];
                for _ in 0..12 {
                    lines.push("Grace and truth came by Jesus Christ, and of his fulness have we all re-".to_string());
                    lines.push("ceived, and grace for grace, as it is written in John 1:16 for us.".to_string());
                }
                lines.push("A short closing line.".to_string());
                lines.push(String::new());
                lines.push(format!("{n}"));
                lines
            })
            .collect();
        make(&pages, title)
    }

    #[test]
    fn reads_a_text_pdf() {
        let bytes = sample(Some("Grace and Truth"));
        assert!(is_pdf(&bytes) && !is_pdf(b"PK\x03\x04 not a pdf at all"));
        let b = read(&bytes, Some("whatever.pdf")).unwrap();
        assert_eq!((b.title.as_str(), b.author.as_str()), ("Grace and Truth", "A. Writer"));
        let text = b.sections.iter().map(|s| s.1.as_str()).collect::<Vec<_>>().join("\n");
        assert!(text.contains("have we all received, and grace"), "a word split across lines is rejoined: {}", &text[..300.min(text.len())]);
        assert_eq!(b.pages, 8);
        assert!(text.starts_with("Grace ⟪1⟫ and truth") && text.contains("⟪8⟫") && !text.contains("⟪9⟫"), "page starts are marked");
        assert!(text.contains("⟦John|1|16||John 1:16⟧"));
        assert!(!text.contains("GRACE AND TRUTH"), "the running header is dropped");
        assert!(!text.lines().any(|l| l.trim().len() == 1 && l.trim().chars().all(|c| c.is_ascii_digit())), "page numbers are dropped");
        assert!(text.contains("A short closing line.\n\n"), "a short last line ends its paragraph");
        // no title in the file: the file's name is used, and a tool-made title doesn't count
        assert_eq!(read(&sample(None), Some("my-little_book.pdf")).unwrap().title, "my little book");
        assert_eq!(read(&sample(Some("Microsoft Word - draft3.doc")), Some("Real Title.pdf")).unwrap().title, "Real Title");
        assert!(read(&sample(None), None).is_err());
    }

    #[test]
    fn refuses_scans_protected_and_broken_pdfs() {
        // pages with no text at all: a scan
        let scan = make(&vec![vec![]; 6], Some("Scanned"));
        assert!(read(&scan, None).err().unwrap().contains("scanned book"));
        // an /Encrypt entry: protected
        let mut doc = Document::load_mem(&sample(Some("Locked"))).unwrap();
        let enc = doc.add_object(dictionary! { "Filter" => "Standard", "V" => 1, "R" => 2, "O" => Object::string_literal("x"), "U" => Object::string_literal("y"), "P" => -44 });
        doc.trailer.set("Encrypt", enc);
        let mut locked = Vec::new();
        doc.save_to(&mut locked).unwrap();
        assert!(read(&locked, None).err().unwrap().contains("protected"));
        assert!(read(b"%PDF-1.7\nthis is not really a pdf", None).err().unwrap().contains("damaged"));
    }

    /// Real PDFs from %LOCALAPPDATA%\bible-concordance-build\library-probe\pdf:
    ///   cargo test real_pdfs -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_pdfs() {
        let dir = std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap()).join("bible-concordance-build/library-probe/pdf");
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            let bytes = std::fs::read(e.path()).unwrap();
            let t = std::time::Instant::now();
            match read(&bytes, e.file_name().to_str()) {
                Ok(b) => {
                    let chars: usize = b.sections.iter().map(|s| s.1.len()).sum();
                    println!("{:?} ({:.1?}): '{}' by '{}' {} sections, {} chars", e.file_name(), t.elapsed(), b.title, b.author, b.sections.len(), chars);
                    for w in &b.warnings {
                        println!("    ! {w}");
                    }
                    for (title, x) in b.sections.iter().take(8) {
                        println!("    {:<40} {:>7}  {}", title.chars().take(40).collect::<String>(), x.len(), x.chars().take(110).collect::<String>().replace('\n', " ¶ "));
                    }
                    if let Some((_, x)) = b.sections.get(2) {
                        println!("    --- sample: {}", x.chars().skip(1500).take(700).collect::<String>().replace('\n', " ¶ "));
                    }
                }
                Err(err) => println!("{:?} ({:.1?}): REFUSED {err}", e.file_name(), t.elapsed()),
            }
        }
    }
}
