//! Builds the phone's "Advanced search upgrade" (`bible_core::meaning`): the desktop's sentence
//! model packed to 8 bits, and the meaning of every BSB verse (already worked out by
//! `index_embeddings`, read from bible.db) packed the same way. Then it checks the pack
//! against the full model: the word pieces, how close the packed model's meanings are, and
//! whether searches find the same verses.
//!   cargo run --release --bin make_search_pack -- <bible.db> <model dir> <out dir>
//! Zip the out dir's files (no folder) and publish them as a release asset; the phone's
//! `meaning_pack.rs` names the URL and SHA-256.

use bible_core::meaning::{pack_weights, Embedder, VerseIndex, VerseKey, WordPieces};
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    bible_concordance_lib::register_sqlite_vec();
    let args: Vec<String> = std::env::args().collect();
    let usage = "usage: make_search_pack <bible.db> <model dir> <out dir>";
    let db = PathBuf::from(args.get(1).expect(usage));
    let model = PathBuf::from(args.get(2).expect(usage));
    let out = PathBuf::from(args.get(3).expect(usage));
    std::fs::create_dir_all(&out)?;

    // --- the model, 8 bits a number
    let tensors = candle_core::safetensors::load(model.join("model.safetensors"), &candle_core::Device::Cpu)?;
    let packed = pack_weights(tensors).map_err(anyhow::Error::msg)?;
    candle_core::safetensors::save(&packed, out.join("model.q8.safetensors"))?;
    std::fs::copy(model.join("config.json"), out.join("config.json"))?;
    std::fs::copy(model.join("vocab.txt"), out.join("vocab.txt"))?;

    // --- every BSB verse's meaning, from bible.db
    let conn = Connection::open(&db)?;
    let books: Vec<String> = conn
        .prepare("SELECT name FROM books ORDER BY order_index")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let mut stmt = conn.prepare(
        "SELECT b.name, v.chapter, v.verse, e.embedding FROM verse_embeddings e
         JOIN verses v ON v.id = e.rowid JOIN books b ON b.id = v.book_id
         ORDER BY b.order_index, v.chapter, v.verse",
    )?;
    let entries: Vec<(VerseKey, Vec<f32>)> = stmt
        .query_map([], |r| {
            let blob: Vec<u8> = r.get(3)?;
            let v = blob.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
            Ok((VerseKey { book: r.get(0)?, chapter: r.get(1)?, verse: r.get(2)? }, v))
        })?
        .collect::<Result<_, _>>()?;
    println!("{} verses", entries.len());
    VerseIndex::write(&out, "BSB", &books, &entries).map_err(anyhow::Error::msg)?;

    // --- the checks
    let full = bible_concordance_lib::embeddings::Embedder::load(&model)?;
    let tok = tokenizers::Tokenizer::from_file(model.join("tokenizer.json")).map_err(anyhow::Error::msg)?;
    let pieces = WordPieces::from_vocab(&std::fs::read_to_string(model.join("vocab.txt"))?).map_err(anyhow::Error::msg)?;
    let texts: Vec<String> = conn
        .prepare("SELECT v.text FROM verses v JOIN versions ver ON ver.id = v.version_id WHERE ver.code IN ('BSB','KJV','WEB')")?
        .query_map([], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let mut differ = 0;
    for t in &texts {
        let theirs = tok.encode(t.as_str(), true).map_err(anyhow::Error::msg)?;
        let theirs_ids: Vec<u32> = theirs.get_ids().iter().copied().take_while(|&id| id != 0).collect();
        if theirs_ids != pieces.encode(t) {
            if differ < 5 {
                println!("word pieces differ: {t}\n  theirs {:?}\n  mine   {:?}", theirs.get_ids(), pieces.encode(t));
            }
            differ += 1;
        }
    }
    println!("word pieces: {} of {} texts differ", differ, texts.len());

    let small = Embedder::load(&out).map_err(anyhow::Error::msg)?;
    let index = VerseIndex::load(&out).map_err(anyhow::Error::msg)?;
    let by_key: HashMap<VerseKey, &Vec<f32>> = entries.iter().map(|(k, v)| (k.clone(), v)).collect();
    let queries = [
        "Daniels prayer delayed",
        "where was Daniels prayer delayed by 21 days",
        "the prodigal son",
        "sacrifice of bulls",
        "do not worry about tomorrow",
        "love your enemies",
        "the parting of the Red Sea",
        "God is my shepherd",
        "faith without works is dead",
        "the armour of God",
        "be strong and courageous",
        "the fruit of the Spirit",
    ];
    let (mut worst, mut overlap) = (1f32, 0usize);
    for q in queries {
        let a = full.embed(q)?;
        let b = small.embed(q).map_err(anyhow::Error::msg)?;
        let cos: f32 = a.iter().zip(&b).map(|(x, y)| x * y).sum();
        worst = worst.min(cos);
        // the full search: exact numbers both sides
        let mut exact: Vec<(&VerseKey, f32)> = by_key.iter().map(|(k, v)| (k, v.iter().zip(&a).map(|(x, y)| x * y).sum())).collect();
        exact.sort_by(|x, y| y.1.total_cmp(&x.1));
        let top: Vec<String> = exact.iter().take(10).map(|(k, _)| format!("{} {}:{}", k.book, k.chapter, k.verse)).collect();
        let mine: Vec<String> = index.nearest(&b, 10).into_iter().map(|(k, _)| format!("{} {}:{}", k.book, k.chapter, k.verse)).collect();
        let same = mine.iter().filter(|m| top.contains(m)).count();
        overlap += same;
        println!("{q}: cos {cos:.4}, {same}/10 the same\n  full  {}\n  pack  {}", top.join(", "), mine.join(", "));
    }
    println!("worst cos {worst:.4}; top-10 overlap {}/{}", overlap, queries.len() * 10);
    Ok(())
}
