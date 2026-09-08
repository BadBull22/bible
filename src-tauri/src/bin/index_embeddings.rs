//! One-time offline tool: embeds every BSB verse with the local MiniLM model and writes
//! the vectors into a `verse_embeddings` vec0 table in bible.db, powering semantic
//! search at runtime. Run manually after the data pipeline builds/updates bible.db:
//!   cargo run --release --bin index_embeddings -- <path-to-bible.db> <path-to-model-dir>

use bible_concordance_lib::embeddings::Embedder;
use rusqlite::{params, Connection};
use std::path::PathBuf;
use std::time::Instant;

fn main() -> anyhow::Result<()> {
    bible_concordance_lib::register_sqlite_vec();

    let args: Vec<String> = std::env::args().collect();
    let db_path = PathBuf::from(args.get(1).expect("usage: index_embeddings <bible.db> <model_dir>"));
    let model_dir = PathBuf::from(args.get(2).expect("usage: index_embeddings <bible.db> <model_dir>"));

    println!("Loading embedding model from {}...", model_dir.display());
    let embedder = Embedder::load(&model_dir)?;

    let conn = Connection::open(&db_path)?;
    conn.execute_batch(
        "DROP TABLE IF EXISTS verse_embeddings;
         CREATE VIRTUAL TABLE verse_embeddings USING vec0(embedding float[384]);",
    )?;

    let mut stmt = conn.prepare(
        "SELECT v.id, v.text FROM verses v JOIN versions ver ON v.version_id = ver.id WHERE ver.code = 'BSB'",
    )?;
    let rows: Vec<(i64, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(stmt);

    println!("Embedding {} BSB verses...", rows.len());
    let start = Instant::now();
    let mut insert = conn.prepare("INSERT INTO verse_embeddings(rowid, embedding) VALUES (?1, ?2)")?;
    for (i, (verse_id, text)) in rows.iter().enumerate() {
        let vector = embedder.embed(text)?;
        let literal = format!("[{}]", vector.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(","));
        insert.execute(params![verse_id, literal])?;
        if i % 2000 == 0 {
            println!("  {i}/{} ({:.1}s elapsed)", rows.len(), start.elapsed().as_secs_f32());
        }
    }
    println!("Done in {:.1}s. Verifying...", start.elapsed().as_secs_f32());

    let count: i64 = conn.query_row("SELECT COUNT(*) FROM verse_embeddings", [], |r| r.get(0))?;
    println!("verse_embeddings rows: {count}");
    let integrity: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    println!("integrity_check: {integrity}");

    Ok(())
}
