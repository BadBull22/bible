//! One-time offline tool: embeds every qa.json question/alt-phrasing AND every existing
//! firsts.json question with the local MiniLM model, writing resources/qa_index.json for
//! runtime semantic matching in `ask_question`. No SQLite involved, so this project's SMB
//! random-write corruption gotcha doesn't apply -- a plain JSON write is safe even on the
//! network share this project lives on. Re-run whenever qa.json or firsts.json changes:
//!   cargo run --release --bin index_qa -- <qa.json> <firsts.json> <model_dir> <out qa_index.json>

use bible_concordance_lib::embeddings::Embedder;
use bible_concordance_lib::firsts::FirstsData;
use bible_concordance_lib::qa::{QaData, QaIndexRow};
use serde::Serialize;
use std::path::PathBuf;
use std::time::Instant;

#[derive(Serialize)]
struct OutFile {
    entries: Vec<QaIndexRow>,
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let usage = "usage: index_qa <qa.json> <firsts.json> <model_dir> <out qa_index.json>";
    let qa_path = PathBuf::from(args.get(1).expect(usage));
    let firsts_path = PathBuf::from(args.get(2).expect(usage));
    let model_dir = PathBuf::from(args.get(3).expect(usage));
    let out_path = PathBuf::from(args.get(4).expect(usage));

    println!("Loading embedding model from {}...", model_dir.display());
    let embedder = Embedder::load(&model_dir)?;

    let qa = QaData::load(&qa_path)?;
    let firsts = FirstsData::load(&firsts_path)?;

    let mut phrasings: Vec<(String, String, String)> = Vec::new();
    for entry in qa.all() {
        phrasings.push(("qa".to_string(), entry.id.clone(), entry.question.clone()));
        for alt in &entry.alt_phrasings {
            phrasings.push(("qa".to_string(), entry.id.clone(), alt.clone()));
        }
    }
    for entry in firsts.all() {
        phrasings.push(("firsts".to_string(), entry.id.clone(), entry.question.clone()));
    }

    println!("Embedding {} phrasings...", phrasings.len());
    let start = Instant::now();
    let mut rows = Vec::with_capacity(phrasings.len());
    for (i, (source, id, phrasing)) in phrasings.iter().enumerate() {
        let vector = embedder.embed(phrasing)?;
        rows.push(QaIndexRow { source: source.clone(), id: id.clone(), phrasing: phrasing.clone(), vector });
        if i % 20 == 0 {
            println!("  {i}/{} ({:.1}s elapsed)", phrasings.len(), start.elapsed().as_secs_f32());
        }
    }
    println!("Done in {:.1}s. Writing {}...", start.elapsed().as_secs_f32(), out_path.display());

    let out = OutFile { entries: rows };
    std::fs::write(&out_path, serde_json::to_string_pretty(&out)?)?;
    println!("Wrote {} rows.", out.entries.len());

    Ok(())
}
