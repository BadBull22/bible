use std::io::Write;

/// The desktop's meaning index of the "Ask" questions (resources/qa_index.json: 384 numbers
/// per phrasing, from `index_qa`), packed to 8 bits a number for the phone (ask.rs reads it):
/// a count (u32), then per phrasing its source (0 qa, 1 firsts), its id (length u8 + UTF-8),
/// its scale (f32) and its 384 numbers (i8).
fn pack_qa_index() {
    let src = "../../src-tauri/resources/qa_index.json";
    println!("cargo:rerun-if-changed={src}");
    let text = std::fs::read_to_string(src).expect("the desktop's resources/qa_index.json");
    let json: serde_json::Value = serde_json::from_str(&text).expect("qa_index.json");
    let rows = json["entries"].as_array().expect("qa_index.json entries");
    let mut out: Vec<u8> = Vec::new();
    out.extend((rows.len() as u32).to_le_bytes());
    for row in rows {
        let source = match row["source"].as_str() {
            Some("qa") => 0u8,
            _ => 1u8,
        };
        let id = row["id"].as_str().expect("an id").as_bytes();
        let v: Vec<f32> = row["vector"].as_array().expect("a vector").iter().map(|x| x.as_f64().unwrap_or(0.0) as f32).collect();
        assert_eq!(v.len(), 384, "a 384-number vector");
        let max = v.iter().fold(0f32, |m, x| m.max(x.abs()));
        let scale = if max > 0.0 { max / 127.0 } else { 1.0 };
        out.push(source);
        out.push(id.len() as u8);
        out.extend(id);
        out.extend(scale.to_le_bytes());
        out.extend(v.iter().map(|x| (x / scale).round().clamp(-127.0, 127.0) as i8 as u8));
    }
    let dest = std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("qa_index.bin");
    std::fs::File::create(dest).and_then(|mut f| f.write_all(&out)).expect("qa_index.bin");
}

fn main() {
    // the database is compiled into the app (see lib.rs), so a new one means a rebuild
    println!("cargo:rerun-if-changed=resources/phone.db.gz");
    println!("cargo:rerun-if-changed=../../src-tauri/resources/qa.json");
    println!("cargo:rerun-if-changed=../../src-tauri/resources/firsts.json");
    pack_qa_index();
    tauri_build::build()
}
