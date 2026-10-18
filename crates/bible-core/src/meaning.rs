//! Searching by meaning: the "Advanced search upgrade" the phone downloads once.
//!
//! The desktop app finds verses by what a search *means*, not only by its words, with a small
//! sentence model (all-MiniLM-L6-v2) and the meaning of every BSB verse worked out in advance.
//! This is the same, packed small for a phone:
//!
//! * the model's weights as 8-bit numbers with a scale per row (`model.q8.safetensors`, about
//!   23 MB instead of 91), turned back into ordinary numbers when the pack is opened;
//! * every BSB verse's meaning (384 numbers) as 8-bit numbers with a scale per verse
//!   (`vectors.bin` + `scales.bin`, about 12 MB), and which verse each one is (`keys.bin`:
//!   book, chapter, verse, one byte each; the books named in `index.json`);
//! * the model's own word list (`vocab.txt`) and settings (`config.json`).
//!
//! The words are split into the model's word pieces here (the standard BERT way: lower case,
//! accents and punctuation apart, longest pieces first), so no tokenizer library is needed.
//! `make_search_pack` in the desktop app builds the pack and checks it against the full model.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config};
use serde::{Deserialize, Serialize};

pub use crate::find::VerseKey;
use unicode_normalization::UnicodeNormalization;

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

/// The longest input the model reads, in word pieces ([CLS] and [SEP] included).
const MAX_PIECES: usize = 128;

/// The model's word pieces, and how a text becomes their numbers.
pub struct WordPieces {
    ids: HashMap<String, u32>,
    unk: u32,
    cls: u32,
    sep: u32,
}

impl WordPieces {
    pub fn from_vocab(text: &str) -> Result<Self, String> {
        let ids: HashMap<String, u32> = text.lines().enumerate().map(|(i, w)| (w.to_string(), i as u32)).collect();
        let get = |w: &str| ids.get(w).copied().ok_or_else(|| format!("the word list has no {w}"));
        Ok(Self { unk: get("[UNK]")?, cls: get("[CLS]")?, sep: get("[SEP]")?, ids })
    }

    /// [CLS], the text's pieces, [SEP] -- as BERT's own tokenizer makes them.
    pub fn encode(&self, text: &str) -> Vec<u32> {
        let mut out = vec![self.cls];
        'words: for word in split_words(text) {
            let chars: Vec<char> = word.chars().collect();
            let mut pieces = Vec::new();
            if chars.len() > 100 {
                pieces.push(self.unk);
            } else {
                let mut start = 0;
                while start < chars.len() {
                    let mut end = chars.len();
                    let mut found = None;
                    while start < end {
                        let mut piece: String = chars[start..end].iter().collect();
                        if start > 0 {
                            piece.insert_str(0, "##");
                        }
                        if let Some(&id) = self.ids.get(&piece) {
                            found = Some(id);
                            break;
                        }
                        end -= 1;
                    }
                    match found {
                        Some(id) => {
                            pieces.push(id);
                            start = end;
                        }
                        None => {
                            pieces = vec![self.unk];
                            break;
                        }
                    }
                }
            }
            for p in pieces {
                if out.len() == MAX_PIECES - 1 {
                    break 'words;
                }
                out.push(p);
            }
        }
        out.push(self.sep);
        out
    }
}

fn is_punctuation(c: char) -> bool {
    // BERT: ASCII non-letters/digits, and every Unicode punctuation mark ("“", "—", "’" ...)
    (c.is_ascii() && !c.is_ascii_alphanumeric() && !c.is_ascii_whitespace() && !c.is_ascii_control())
        || (!c.is_ascii() && !c.is_alphanumeric() && !c.is_whitespace() && !is_mark(c) && !c.is_control() && unicode_punct(c))
}

/// The Unicode general category P* (punctuation), for the characters a Bible text has.
fn unicode_punct(c: char) -> bool {
    matches!(c,
        '\u{00A1}' | '\u{00A7}' | '\u{00AB}' | '\u{00B6}' | '\u{00B7}' | '\u{00BB}' | '\u{00BF}'
        | '\u{037E}' | '\u{0387}'
        | '\u{2010}'..='\u{2027}' | '\u{2030}'..='\u{2043}' | '\u{2045}'..='\u{2051}' | '\u{2053}'..='\u{205E}'
        | '\u{2E00}'..='\u{2E4F}' | '\u{3001}'..='\u{3003}' | '\u{3008}'..='\u{3011}' | '\u{FE10}'..='\u{FE19}'
        | '\u{FE30}'..='\u{FE4F}' | '\u{FF01}'..='\u{FF0F}' | '\u{FF1A}'..='\u{FF20}')
}

fn is_mark(c: char) -> bool {
    // combining marks (removed with the accents)
    matches!(c, '\u{0300}'..='\u{036F}' | '\u{1AB0}'..='\u{1AFF}' | '\u{1DC0}'..='\u{1DFF}' | '\u{20D0}'..='\u{20FF}' | '\u{FE20}'..='\u{FE2F}')
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0x20000..=0x2A6DF | 0x2A700..=0x2B73F | 0x2B740..=0x2B81F | 0x2B820..=0x2CEAF | 0xF900..=0xFAFF | 0x2F800..=0x2FA1F)
}

/// BERT's normalizer and pre-tokenizer: control characters out, lower case, accents off,
/// Chinese characters and punctuation each a word of their own.
fn split_words(text: &str) -> Vec<String> {
    let mut clean = String::with_capacity(text.len());
    for c in text.chars() {
        let format_char = matches!(c, '\u{00AD}' | '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{206F}' | '\u{FEFF}');
        if c == '\0' || c == '\u{FFFD}' || format_char || (c.is_control() && !matches!(c, '\t' | '\n' | '\r')) {
            continue;
        }
        if c.is_whitespace() {
            clean.push(' ');
        } else if is_cjk(c) {
            clean.push(' ');
            clean.push(c);
            clean.push(' ');
        } else {
            clean.push(c);
        }
    }
    let lowered: String = clean.to_lowercase().nfd().filter(|c| !is_mark(*c)).collect();
    let mut words = Vec::new();
    for chunk in lowered.split_whitespace() {
        let mut cur = String::new();
        for c in chunk.chars() {
            if is_punctuation(c) {
                if !cur.is_empty() {
                    words.push(std::mem::take(&mut cur));
                }
                words.push(c.to_string());
            } else {
                cur.push(c);
            }
        }
        if !cur.is_empty() {
            words.push(cur);
        }
    }
    words
}

/// The sentence model: a text in, its meaning (384 numbers, length 1) out.
pub struct Embedder {
    model: BertModel,
    pieces: WordPieces,
    device: Device,
}

impl Embedder {
    /// Opens the model of a search pack (`model.q8.safetensors`) or the full one
    /// (`model.safetensors`, the desktop's), whichever the folder has.
    pub fn load(dir: &Path) -> Result<Self, String> {
        let device = Device::Cpu;
        let config: Config = serde_json::from_str(&fs::read_to_string(dir.join("config.json")).map_err(err)?).map_err(err)?;
        let pieces = WordPieces::from_vocab(&fs::read_to_string(dir.join("vocab.txt")).map_err(err)?)?;
        let packed = dir.join("model.q8.safetensors");
        let tensors = if packed.exists() {
            unpack_weights(candle_core::safetensors::load(&packed, &device).map_err(err)?)?
        } else {
            candle_core::safetensors::load(dir.join("model.safetensors"), &device).map_err(err)?
        };
        let vb = VarBuilder::from_tensors(tensors, DType::F32, &device);
        let model = BertModel::load(vb, &config).map_err(err)?;
        Ok(Self { model, pieces, device })
    }

    /// The meaning of `text`: the mean of the model's output over its word pieces, length 1.
    pub fn embed(&self, text: &str) -> Result<Vec<f32>, String> {
        let ids = self.pieces.encode(text);
        let token_ids = Tensor::new(ids.as_slice(), &self.device).and_then(|t| t.unsqueeze(0)).map_err(err)?;
        let token_type_ids = token_ids.zeros_like().map_err(err)?;
        let out = self.model.forward(&token_ids, &token_type_ids, None).map_err(err)?;
        let pooled = out.mean(1).map_err(err)?;
        let v = pooled.squeeze(0).and_then(|t| t.to_vec1::<f32>()).map_err(err)?;
        let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-12);
        Ok(v.into_iter().map(|x| x / norm).collect())
    }
}

/// Packs a weight table to 8 bits: each row's numbers as 1..255 around 128, and the row's scale.
pub fn pack_weights(tensors: HashMap<String, Tensor>) -> Result<HashMap<String, Tensor>, String> {
    let mut out = HashMap::new();
    for (name, t) in tensors {
        let t = t.to_dtype(DType::F32).map_err(err)?;
        if t.rank() != 2 || t.dims()[0] < 3 {
            out.insert(name, t);
            continue;
        }
        let (rows, cols) = (t.dims()[0], t.dims()[1]);
        let data = t.to_vec2::<f32>().map_err(err)?;
        let mut q = Vec::with_capacity(rows * cols);
        let mut scales = Vec::with_capacity(rows);
        for row in &data {
            let max = row.iter().fold(0f32, |m, x| m.max(x.abs()));
            let s = if max > 0.0 { max / 127.0 } else { 1.0 };
            scales.push(s);
            q.extend(row.iter().map(|x| ((x / s).round().clamp(-127.0, 127.0) as i32 + 128) as u8));
        }
        let device = t.device().clone();
        out.insert(format!("{name}.q8"), Tensor::from_vec(q, (rows, cols), &device).map_err(err)?);
        out.insert(format!("{name}.scale"), Tensor::from_vec(scales, rows, &device).map_err(err)?);
    }
    Ok(out)
}

/// Turns 8-bit weight tables back into ordinary numbers.
fn unpack_weights(mut tensors: HashMap<String, Tensor>) -> Result<HashMap<String, Tensor>, String> {
    let names: Vec<String> = tensors.keys().filter_map(|k| k.strip_suffix(".q8").map(str::to_string)).collect();
    for name in names {
        let q = tensors.remove(&format!("{name}.q8")).ok_or("broken pack")?;
        let s = tensors.remove(&format!("{name}.scale")).ok_or("broken pack")?;
        let w = q
            .to_dtype(DType::F32)
            .and_then(|q| q.affine(1.0, -128.0))
            .and_then(|q| q.broadcast_mul(&s.unsqueeze(1)?))
            .map_err(err)?;
        tensors.insert(name, w);
    }
    Ok(tensors)
}

/// What `index.json` says about the verses of a pack.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct IndexInfo {
    /// the pack's format (1)
    pub format: u32,
    /// the translation the verses' meanings were worked out from ("BSB")
    pub version: String,
    pub dim: usize,
    pub count: usize,
    /// the books, in the order `keys.bin` numbers them (0 = the first)
    pub books: Vec<String>,
}

/// Every verse's meaning, 8 bits a number.
pub struct VerseIndex {
    pub info: IndexInfo,
    keys: Vec<(u8, u8, u8)>,
    vectors: Vec<i8>,
    scales: Vec<f32>,
}

impl VerseIndex {
    pub fn load(dir: &Path) -> Result<Self, String> {
        let info: IndexInfo = serde_json::from_str(&fs::read_to_string(dir.join("index.json")).map_err(err)?).map_err(err)?;
        let keys: Vec<(u8, u8, u8)> = fs::read(dir.join("keys.bin")).map_err(err)?.chunks_exact(3).map(|k| (k[0], k[1], k[2])).collect();
        let vectors: Vec<i8> = fs::read(dir.join("vectors.bin")).map_err(err)?.into_iter().map(|b| b as i8).collect();
        let scales: Vec<f32> = fs::read(dir.join("scales.bin")).map_err(err)?.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
        if keys.len() != info.count || scales.len() != info.count || vectors.len() != info.count * info.dim {
            return Err("The search upgrade's files don't fit together. Please download it again.".into());
        }
        Ok(Self { info, keys, vectors, scales })
    }

    /// Writes a pack's verse files: `entries` are each verse and its meaning (length 1).
    pub fn write(dir: &Path, version: &str, books: &[String], entries: &[(VerseKey, Vec<f32>)]) -> Result<(), String> {
        let dim = entries.first().map(|e| e.1.len()).unwrap_or(384);
        let mut keys = Vec::with_capacity(entries.len() * 3);
        let mut vectors = Vec::with_capacity(entries.len() * dim);
        let mut scales = Vec::with_capacity(entries.len() * 4);
        for (k, v) in entries {
            let b = books.iter().position(|x| *x == k.book).ok_or_else(|| format!("unknown book {}", k.book))?;
            if b > 255 || k.chapter > 255 || k.verse > 255 {
                return Err(format!("{} {}:{} doesn't fit in a byte", k.book, k.chapter, k.verse));
            }
            keys.extend([b as u8, k.chapter as u8, k.verse as u8]);
            let max = v.iter().fold(0f32, |m, x| m.max(x.abs()));
            let s = if max > 0.0 { max / 127.0 } else { 1.0 };
            vectors.extend(v.iter().map(|x| (x / s).round().clamp(-127.0, 127.0) as i8 as u8));
            scales.extend(s.to_le_bytes());
        }
        let info = IndexInfo { format: 1, version: version.into(), dim, count: entries.len(), books: books.to_vec() };
        fs::write(dir.join("index.json"), serde_json::to_string(&info).map_err(err)?).map_err(err)?;
        fs::write(dir.join("keys.bin"), keys).map_err(err)?;
        fs::write(dir.join("vectors.bin"), vectors).map_err(err)?;
        fs::write(dir.join("scales.bin"), scales).map_err(err)?;
        Ok(())
    }

    /// The `k` verses nearest in meaning to `query` (length 1), nearest first, with how near.
    pub fn nearest(&self, query: &[f32], k: usize) -> Vec<(VerseKey, f32)> {
        let dim = self.info.dim;
        let mut scored: Vec<(usize, f32)> = self
            .vectors
            .chunks_exact(dim)
            .enumerate()
            .map(|(i, v)| {
                let dot: f32 = v.iter().zip(query).map(|(&a, &b)| a as f32 * b).sum();
                (i, dot * self.scales[i])
            })
            .collect();
        let k = k.min(scored.len());
        if k == 0 {
            return Vec::new();
        }
        scored.select_nth_unstable_by(k - 1, |a, b| b.1.total_cmp(&a.1));
        scored.truncate(k);
        scored.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        scored
            .into_iter()
            .map(|(i, s)| {
                let (b, c, v) = self.keys[i];
                (VerseKey { book: self.info.books[b as usize].clone(), chapter: c as i64, verse: v as i64 }, s)
            })
            .collect()
    }
}

/// The search upgrade, opened: the model and the verses' meanings.
pub struct Meaning {
    pub embedder: Embedder,
    pub index: VerseIndex,
}

impl Meaning {
    pub fn load(dir: &Path) -> Result<Self, String> {
        Ok(Self { embedder: Embedder::load(dir)?, index: VerseIndex::load(dir)? })
    }

    /// The verses nearest in meaning to `query`.
    pub fn search(&self, query: &str, k: usize) -> Result<Vec<(VerseKey, f32)>, String> {
        Ok(self.index.nearest(&self.embedder.embed(query)?, k))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_like_bert() {
        assert_eq!(split_words("“Do not be afraid, Daniel,” he said."), ["“", "do", "not", "be", "afraid", ",", "daniel", ",", "”", "he", "said", "."]);
        assert_eq!(split_words("Café — naïve"), ["cafe", "—", "naive"]);
        assert_eq!(split_words("twenty-one days"), ["twenty", "-", "one", "days"]);
    }

    #[test]
    fn word_pieces_longest_first() {
        let vocab = "[PAD]\n[UNK]\n[CLS]\n[SEP]\nun\n##want\n##ed\nwant\nrun\n##ning\n,";
        let wp = WordPieces::from_vocab(vocab).unwrap();
        assert_eq!(wp.encode("unwanted, running"), [2, 4, 5, 6, 10, 8, 9, 3]);
        assert_eq!(wp.encode("xyz"), [2, 1, 3]);
    }
}
