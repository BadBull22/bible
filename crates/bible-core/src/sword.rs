//! Reader for CrossWire SWORD modules -- the free library of Bibles, commentaries,
//! dictionaries and books the Library screen installs. Pure Rust, no SWORD engine: just the
//! on-disk formats this app needs (from the SWORD sources: zverse/rawverse, zstr/rawstr,
//! treekeyidx). Mirrors data-pipeline/sword_commentary.py and sword_lexdict.py, which
//! built the bundled Wesley/Scofield/Easton/Smith/Nave/Torrey data from the same formats.
//!
//! * Verse-keyed (Bibles `zText`/`zText4`/`RawText`/`RawText4`, commentaries `zCom`/
//!   `zCom4`/`RawCom`/`RawCom4`): one index slot per possible verse, in the order of the
//!   module's versification (`canons.json`). Per testament file: slot 0 = module heading,
//!   1 = testament heading, then per book a book-heading slot, and per chapter a chapter-
//!   heading slot followed by one slot per verse.
//!     z*:  <t>.?zs blocks (u32 offset, u32 size, u32 uncompressed size) into <t>.?zz
//!          (zlib); <t>.?zv slots (u32 block, u32 offset, u16 size -- u32 size for the
//!          "4" drivers). "?" is b/c/v for BOOK/CHAPTER/VERSE blocking.
//!     Raw: <t>.vss slots (u32 offset, u16 size -- u32 for "4") into the file <t>.
//! * Dictionaries (`RawLD`/`RawLD4`/`zLD`): see `read_lexicon`.
//! * Books (`RawGenBook`): a tree of named sections, see `read_genbook`.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Deserialize;

// ---------------------------------------------------------------- .conf

/// A module's .conf file. Keys can repeat (Feature, GlobalOptionFilter); `get` returns the
/// first value.
#[derive(Debug, Clone, Default)]
pub struct Conf {
    pub name: String,
    pub fields: HashMap<String, Vec<String>>,
}

impl Conf {
    pub fn parse(text: &str) -> Option<Conf> {
        let mut conf = Conf::default();
        let mut pending: Option<(String, String)> = None;
        for raw in text.lines() {
            let line = raw.trim_end_matches('\r');
            if let Some((k, mut v)) = pending.take() {
                // a value ending in "\" continues on the next line
                v.push_str(line.trim_end_matches('\\'));
                if line.ends_with('\\') {
                    pending = Some((k, v));
                } else {
                    conf.fields.entry(k).or_default().push(v);
                }
                continue;
            }
            let t = line.trim();
            if t.starts_with('[') && t.ends_with(']') && conf.name.is_empty() {
                conf.name = t[1..t.len() - 1].trim().to_string();
            } else if let Some((k, v)) = line.split_once('=') {
                let (k, v) = (k.trim().to_string(), v.trim().to_string());
                if v.ends_with('\\') {
                    pending = Some((k, v.trim_end_matches('\\').to_string()));
                } else {
                    conf.fields.entry(k).or_default().push(v);
                }
            }
        }
        if let Some((k, v)) = pending {
            conf.fields.entry(k).or_default().push(v);
        }
        (!conf.name.is_empty()).then_some(conf)
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.fields.get(key).and_then(|v| v.first()).map(|s| s.as_str())
    }

    pub fn has_value(&self, key: &str, value: &str) -> bool {
        self.fields.get(key).is_some_and(|v| v.iter().any(|x| x.eq_ignore_ascii_case(value)))
    }

    pub fn driver(&self) -> &str {
        self.get("ModDrv").unwrap_or("")
    }

    pub fn utf8(&self) -> bool {
        self.get("Encoding").is_some_and(|e| e.eq_ignore_ascii_case("UTF-8"))
    }

    pub fn versification(&self) -> String {
        self.get("Versification").unwrap_or("KJV").to_ascii_lowercase()
    }

    /// The module's data location inside the unpacked folder: a directory for verse
    /// modules, a file-name prefix for dictionaries and books.
    pub fn data_path(&self, root: &Path) -> PathBuf {
        let rel = self.get("DataPath").unwrap_or("").trim_start_matches("./").trim_end_matches('/');
        root.join(rel)
    }
}

// ---------------------------------------------------------------- text decoding

/// SWORD modules without `Encoding=UTF-8` are Latin-1 / Windows-1252.
pub fn decode(bytes: &[u8], utf8: bool) -> String {
    let bytes = match bytes.iter().rposition(|&b| b != 0) {
        Some(end) => &bytes[..=end],
        None => return String::new(),
    };
    if utf8 {
        return String::from_utf8_lossy(bytes).into_owned();
    }
    const CP1252: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž', '\u{8f}', '\u{90}', '‘', '’', '“', '”', '•', '–',
        '—', '˜', '™', 'š', '›', 'œ', '\u{9d}', 'ž', 'Ÿ',
    ];
    bytes.iter().map(|&b| if (0x80..0xA0).contains(&b) { CP1252[(b - 0x80) as usize] } else { b as char }).collect()
}

fn u16_at(b: &[u8], i: usize) -> Option<u32> {
    b.get(i..i + 2).map(|s| u16::from_le_bytes([s[0], s[1]]) as u32)
}

fn u32_at(b: &[u8], i: usize) -> Option<u32> {
    b.get(i..i + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

fn i32_at(b: &[u8], i: usize) -> Option<i32> {
    b.get(i..i + 4).map(|s| i32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

fn inflate(data: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    flate2::read::ZlibDecoder::new(data).read_to_end(&mut out).map_err(|e| format!("decompress: {e}"))?;
    Ok(out)
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))
}

// ---------------------------------------------------------------- versification

#[derive(Deserialize)]
struct CanonFile(HashMap<String, CanonDef>);

#[derive(Deserialize)]
struct CanonDef {
    #[serde(default)]
    ot: Vec<(String, Vec<u32>)>,
    #[serde(default)]
    nt: Vec<(String, Vec<u32>)>,
}

/// Book list per testament (OSIS id + verses in each chapter) for a versification name.
pub struct Canon {
    pub ot: Vec<(String, Vec<u32>)>,
    pub nt: Vec<(String, Vec<u32>)>,
}

pub fn canon(name: &str) -> Option<Canon> {
    static JSON: &str = include_str!("canons.json");
    let all: CanonFile = serde_json::from_str(JSON).ok()?;
    let def = all.0.into_iter().find(|(k, _)| k.eq_ignore_ascii_case(name))?.1;
    Some(Canon { ot: def.ot, nt: def.nt })
}

// ---------------------------------------------------------------- verse modules

/// One entry of a Bible or commentary module. `chapter` 0 = book introduction, `verse` 0 =
/// chapter introduction. `loc` identifies the stored text, so consecutive verses that share
/// one commentary note (a "linked" range) can be recognised.
#[derive(Debug, Clone)]
pub struct VerseEntry {
    pub osis_book: String,
    pub chapter: u32,
    pub verse: u32,
    pub text: String,
    pub loc: (u32, u32, u32),
}

enum Store {
    Z { blocks: Vec<u8>, data: Vec<u8>, slots: Vec<u8>, rec: usize, wide: bool, cache: HashMap<u32, Vec<u8>> },
    Raw { slots: Vec<u8>, data: Vec<u8>, rec: usize, wide: bool },
}

impl Store {
    fn open(dir: &Path, testament: &str, driver: &str) -> Result<Option<Store>, String> {
        let wide = driver.ends_with('4');
        if driver.starts_with('z') {
            // the block-type letter: find whichever index file exists
            let Some(letter) = ['b', 'c', 'v'].into_iter().find(|l| dir.join(format!("{testament}.{l}zv")).is_file()) else {
                return Ok(None); // e.g. a New Testament-only module has no "ot" files
            };
            Ok(Some(Store::Z {
                blocks: read(&dir.join(format!("{testament}.{letter}zs")))?,
                data: read(&dir.join(format!("{testament}.{letter}zz")))?,
                slots: read(&dir.join(format!("{testament}.{letter}zv")))?,
                rec: if wide { 12 } else { 10 },
                wide,
                cache: HashMap::new(),
            }))
        } else {
            let idx = dir.join(format!("{testament}.vss"));
            if !idx.is_file() {
                return Ok(None);
            }
            Ok(Some(Store::Raw { slots: read(&idx)?, data: read(&dir.join(testament))?, rec: if wide { 8 } else { 6 }, wide }))
        }
    }

    fn slot_count(&self) -> usize {
        match self {
            Store::Z { slots, rec, .. } | Store::Raw { slots, rec, .. } => slots.len() / rec,
        }
    }

    /// (location, bytes) of slot `i`, or None when it's empty.
    fn get(&mut self, i: usize) -> Result<Option<((u32, u32, u32), Vec<u8>)>, String> {
        match self {
            Store::Z { blocks, data, slots, rec, wide, cache } => {
                let o = i * *rec;
                let (Some(block), Some(start)) = (u32_at(slots, o), u32_at(slots, o + 4)) else { return Ok(None) };
                let size = if *wide { u32_at(slots, o + 8) } else { u16_at(slots, o + 8) }.unwrap_or(0);
                if size == 0 {
                    return Ok(None);
                }
                if !cache.contains_key(&block) {
                    let b = block as usize * 12;
                    let (Some(off), Some(csize)) = (u32_at(blocks, b), u32_at(blocks, b + 4)) else { return Ok(None) };
                    let Some(comp) = data.get(off as usize..(off + csize) as usize) else { return Ok(None) };
                    if cache.len() > 64 {
                        cache.clear();
                    }
                    cache.insert(block, inflate(comp)?);
                }
                let buf = &cache[&block];
                Ok(buf.get(start as usize..(start + size) as usize).map(|s| ((block, start, size), s.to_vec())))
            }
            Store::Raw { slots, data, rec, wide } => {
                let o = i * *rec;
                let Some(start) = u32_at(slots, o) else { return Ok(None) };
                let size = if *wide { u32_at(slots, o + 4) } else { u16_at(slots, o + 4) }.unwrap_or(0);
                if size == 0 {
                    return Ok(None);
                }
                Ok(data.get(start as usize..(start + size) as usize).map(|s| ((0, start, size), s.to_vec())))
            }
        }
    }
}

/// Every non-empty entry of a Bible or commentary module, in canonical order.
pub fn read_verse_module(root: &Path, conf: &Conf) -> Result<Vec<VerseEntry>, String> {
    let dir = conf.data_path(root);
    let v11n = conf.versification();
    let canon = canon(&v11n).ok_or_else(|| format!("unknown versification {v11n}"))?;
    let utf8 = conf.utf8();
    let mut out = Vec::new();
    for (testament, books) in [("ot", &canon.ot), ("nt", &canon.nt)] {
        let Some(mut store) = Store::open(&dir, testament, conf.driver())? else { continue };
        let expected = 2 + books.iter().map(|(_, ch)| 1 + ch.iter().map(|n| 1 + *n as usize).sum::<usize>()).sum::<usize>();
        // An index may be shorter than the full canon (the module stops early) or longer
        // (padding left by its build tools); like the SWORD engine, only the slots the
        // versification defines are read.
        let _ = (store.slot_count(), expected);
        let mut idx = 2;
        for (osis, chapters) in books.iter() {
            let mut push = |store: &mut Store, i: usize, ch: u32, v: u32| -> Result<(), String> {
                if let Some((loc, bytes)) = store.get(i)? {
                    let text = decode(&bytes, utf8);
                    if !text.trim().is_empty() {
                        out.push(VerseEntry { osis_book: osis.clone(), chapter: ch, verse: v, text, loc });
                    }
                }
                Ok(())
            };
            push(&mut store, idx, 0, 0)?;
            idx += 1;
            for (c, n) in chapters.iter().enumerate() {
                push(&mut store, idx, c as u32 + 1, 0)?;
                idx += 1;
                for v in 1..=*n {
                    push(&mut store, idx, c as u32 + 1, v)?;
                    idx += 1;
                }
            }
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------- dictionaries

fn split_key(buf: &[u8]) -> (&[u8], &[u8]) {
    match buf.iter().position(|&b| b == b'\n') {
        Some(nl) => {
            let key = &buf[..nl];
            (key.strip_suffix(b"\r").unwrap_or(key), &buf[nl + 1..])
        }
        None => (buf, &[]),
    }
}

/// (key, text) pairs of a dictionary module; "@LINK other key" aliases resolved.
///   RawLD/RawLD4: <base>.idx (u32 offset, u16|u32 size) into <base>.dat; each record is
///                 "KEY\n" + text.
///   zLD:          <base>.idx (u32 offset, u32 size) into <base>.dat; records "KEY\n" +
///                 (u32 block, u32 entry); <base>.zdx (u32 offset, u32 size) into <base>.zdt
///                 zlib blocks, each "u32 count, count x (u32 offset, u32 size)" + data.
pub fn read_lexicon(root: &Path, conf: &Conf) -> Result<Vec<(String, String)>, String> {
    let base = conf.data_path(root);
    let file = |ext: &str| base.with_file_name(format!("{}.{ext}", base.file_name().and_then(|s| s.to_str()).unwrap_or("")));
    let idx = read(&file("idx"))?;
    let dat = read(&file("dat"))?;
    let utf8 = conf.utf8();
    let mut raw: Vec<(String, Vec<u8>)> = Vec::new();
    match conf.driver() {
        "zLD" => {
            let zdx = read(&file("zdx"))?;
            let zdt = read(&file("zdt"))?;
            let mut blocks: HashMap<u32, Vec<u8>> = HashMap::new();
            for i in (0..idx.len().saturating_sub(7)).step_by(8) {
                let (Some(off), Some(size)) = (u32_at(&idx, i), u32_at(&idx, i + 4)) else { break };
                let Some(rec) = dat.get(off as usize..(off + size) as usize) else { continue };
                let (key, rest) = split_key(rec);
                let (Some(bnum), Some(enr)) = (u32_at(rest, 0), u32_at(rest, 4)) else { continue };
                if !blocks.contains_key(&bnum) {
                    let b = bnum as usize * 8;
                    let (Some(bo), Some(bs)) = (u32_at(&zdx, b), u32_at(&zdx, b + 4)) else { continue };
                    let Some(comp) = zdt.get(bo as usize..(bo + bs) as usize) else { continue };
                    blocks.insert(bnum, inflate(comp)?);
                }
                let block = &blocks[&bnum];
                let count = u32_at(block, 0).unwrap_or(0);
                if enr >= count {
                    continue;
                }
                let (Some(eo), Some(es)) = (u32_at(block, 4 + enr as usize * 8), u32_at(block, 8 + enr as usize * 8)) else { continue };
                if let Some(body) = block.get(eo as usize..(eo + es) as usize) {
                    raw.push((decode(key, utf8).trim().to_string(), body.to_vec()));
                }
            }
        }
        drv @ ("RawLD" | "RawLD4") => {
            let rec = if drv == "RawLD4" { 8 } else { 6 };
            for i in (0..idx.len()).step_by(rec) {
                let Some(off) = u32_at(&idx, i) else { break };
                let size = if rec == 8 { u32_at(&idx, i + 4) } else { u16_at(&idx, i + 4) }.unwrap_or(0);
                let Some(r) = dat.get(off as usize..(off + size) as usize) else { continue };
                let (key, body) = split_key(r);
                raw.push((decode(key, utf8).trim().to_string(), body.to_vec()));
            }
        }
        other => return Err(format!("unsupported dictionary driver {other}")),
    }
    let decoded: Vec<(String, String)> = raw.into_iter().map(|(k, b)| (k, decode(&b, utf8))).collect();
    let by_key: HashMap<&str, &str> = decoded.iter().map(|(k, t)| (k.as_str(), t.as_str())).collect();
    // SWORD stores keys in capitals but "@LINK ἀγαπάω" may name its target in lower case
    // with accents (Abbott-Smith's Strong's index does); match those ignoring both.
    let by_fold: HashMap<String, &str> = decoded.iter().map(|(k, t)| (key_fold(k), t.as_str())).collect();
    let mut out = Vec::with_capacity(decoded.len());
    for (key, text) in &decoded {
        let mut t: &str = text;
        let mut hops = 0;
        while let Some(target) = t.trim_start().strip_prefix("@LINK") {
            let target = target.trim();
            t = by_key.get(target).copied().or_else(|| by_fold.get(&key_fold(target)).copied()).unwrap_or("");
            hops += 1;
            if hops > 5 {
                break;
            }
        }
        if !key.is_empty() && !t.trim().is_empty() {
            out.push((key.clone(), t.to_string()));
        }
    }
    Ok(out)
}

/// A dictionary key without accents/diacritics, in capitals ("ἀγαπάω" -> "ΑΓΑΠΑΩ").
fn key_fold(s: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    s.nfd().filter(|c| !unicode_normalization::char::is_combining_mark(*c)).collect::<String>().to_uppercase()
}

// ---------------------------------------------------------------- books

/// A section of a book: `parent` is the index of its parent in the returned list (None for
/// top-level sections), in reading order.
#[derive(Debug, Clone)]
pub struct BookNode {
    pub parent: Option<usize>,
    pub title: String,
    pub text: String,
}

/// The sections of a `RawGenBook` module, depth-first in reading order.
///   <base>.idx  one u32 per node: the node's offset in <base>.dat. A node is identified by
///               its position in this file (index x 4); the root is the first entry.
///   <base>.dat  node: i32 parent, i32 next sibling, i32 first child (each an .idx position,
///               -1 = none), the name (NUL-terminated), u16 data size, then data -- for a
///               RawGenBook 8 bytes: u32 offset, u32 size into <base>.bdt (the text).
///               The .dat can also hold orphaned records left by edits; only nodes reached
///               from the root are read.
pub fn read_genbook(root: &Path, conf: &Conf) -> Result<Vec<BookNode>, String> {
    let base = conf.data_path(root);
    let file = |ext: &str| base.with_file_name(format!("{}.{ext}", base.file_name().and_then(|s| s.to_str()).unwrap_or("")));
    let idx = read(&file("idx"))?;
    let dat = read(&file("dat"))?;
    let bdt = read(&file("bdt"))?;
    let utf8 = conf.utf8();

    struct Node {
        next: i32,
        child: i32,
        name: String,
        text: String,
    }
    let node_at = |idx_pos: i32| -> Option<Node> {
        let o = u32_at(&idx, usize::try_from(idx_pos).ok()?)? as usize;
        let next = i32_at(&dat, o + 4)?;
        let child = i32_at(&dat, o + 8)?;
        let name_start = o + 12;
        let name_len = dat.get(name_start..)?.iter().position(|&b| b == 0)?;
        let name = decode(&dat[name_start..name_start + name_len], utf8);
        let d = name_start + name_len + 1;
        let dsize = u16_at(&dat, d)? as usize;
        let mut text = String::new();
        if dsize >= 8 {
            let (start, size) = (u32_at(&dat, d + 2)?, u32_at(&dat, d + 6)?);
            if let Some(t) = bdt.get(start as usize..(start + size) as usize) {
                text = decode(t, utf8);
            }
        }
        Some(Node { next, child, name, text })
    };

    let mut out = Vec::new();
    // iterative depth-first walk: (node offset, parent index)
    let root_node = node_at(0).ok_or("empty book index")?;
    let mut stack: Vec<(i32, Option<usize>)> = Vec::new();
    if !root_node.text.trim().is_empty() {
        out.push(BookNode { parent: None, title: conf.get("Description").unwrap_or(&conf.name).to_string(), text: root_node.text.clone() });
    }
    let mut seen = std::collections::HashSet::new();
    if root_node.child >= 0 {
        stack.push((root_node.child, None));
    }
    while let Some((off, parent)) = stack.pop() {
        if !seen.insert(off) {
            continue; // a damaged index must not loop
        }
        let Some(n) = node_at(off) else { continue };
        // push the next sibling first so the child subtree is visited before it
        if n.next >= 0 {
            stack.push((n.next, parent));
        }
        let me = out.len();
        out.push(BookNode { parent, title: n.name, text: n.text });
        if n.child >= 0 {
            stack.push((n.child, Some(me)));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conf_parses_continuations_and_repeats() {
        let c = Conf::parse("[Test]\nDataPath=./modules/x/\nFeature=StrongsNumbers\nFeature=DailyDevotion\nAbout=one \\\ntwo\nEncoding=UTF-8\n").unwrap();
        assert_eq!(c.name, "Test");
        assert_eq!(c.get("About"), Some("one two"));
        assert!(c.has_value("Feature", "DailyDevotion"));
        assert!(c.utf8());
        assert_eq!(c.versification(), "kjv");
    }

    #[test]
    fn kjv_canon_matches_known_slot_counts() {
        // data-pipeline/sword_commentary.py verified these against real files
        let k = canon("KJV").unwrap();
        let slots = |books: &Vec<(String, Vec<u32>)>| 2 + books.iter().map(|(_, ch)| 1 + ch.iter().map(|n| 1 + *n as usize).sum::<usize>()).sum::<usize>();
        assert_eq!(slots(&k.ot), 24_115);
        assert_eq!(slots(&k.nt), 8_246);
    }

    #[test]
    fn cp1252_decoding() {
        assert_eq!(decode(b"caf\xe9 \x93x\x94\0\0", false), "café “x”");
    }
}
