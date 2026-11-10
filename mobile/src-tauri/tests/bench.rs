//! The phone's run of the shared search test bench (src-tauri/bench/search_bench.json): the same questions and the same judging as the
//! desktop's src-tauri/src/search_bench.rs, but through what the PHONE does: its own Ask (the answer card above the results) and its own
//! Search (the passages below it), with the phone's database and the published Advanced search pack (the 8-bit model and verse meanings).
//!
//!   cd mobile/src-tauri
//!   SEARCH_PACK=<folder with the unzipped advanced-search pack> cargo test --test bench -- --ignored --nocapture
//! Optional: BENCH_MAX_WRONG=0 makes the run fail when any confident answer is wrong.
//!
//! Keep the judging below in step with the desktop's `search_bench` (same words, same rules), so the two numbers can be compared.

use std::path::PathBuf;

use bible_core::meaning::Meaning;
use bible_pocket_lib::ask::{self, Answer};
use bible_pocket_lib::{db, search, unpack_db};
use rusqlite::Connection;
use serde_json::Value;

/// What the phone shows for a question, as the bench reads it: the layer, whether the answer card was given with confidence, the words, the passages.
struct Seen {
    layer: &'static str,
    confident: bool,
    text: String,
    refs: Vec<String>,
}

/// A dictionary body writes a passage as a link marker, ⟦Matthew|7|12||Mt 7:12⟧: read it as "Matthew 7:12".
fn links_as_text(s: &str) -> String {
    let re = regex::Regex::new(r"⟦([^|⟧]+)\|(\d+)\|(\d+)\|[^|⟧]*\|[^⟧]*⟧").expect("valid pattern");
    re.replace_all(s, "$1 $2:$3").into_owned()
}

fn link_refs(s: &str) -> Vec<String> {
    let re = regex::Regex::new(r"⟦([^|⟧]+)\|(\d+)\|(\d+)\|[^|⟧]*\|[^⟧]*⟧").expect("valid pattern");
    re.captures_iter(s).take(40).map(|c| format!("{} {}:{}", &c[1], &c[2], &c[3])).collect()
}

fn words(v: &Value, key: &str) -> Vec<String> {
    v[key].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).map(str::to_lowercase).collect()).unwrap_or_default()
}

/// The passages under the answer card (or in place of it): what the reader sees from the Search tab for the same words.
fn passages(d: &Connection, s: &Connection, m: &Meaning, question: &str) -> (String, Vec<String>) {
    let r = search::search(d, s, question, "BSB", search::Scope::default(), 200, Some(m)).expect("a search");
    let text = r.hits.iter().take(10).map(|h| h.text.clone()).collect::<Vec<_>>().join(" ");
    let refs = r.hits.iter().take(10).map(|h| format!("{} {}:{}", h.book, h.chapter, h.verse)).collect();
    (text, refs)
}

fn look(d: &Connection, s: &Connection, m: &Meaning, question: &str) -> Seen {
    let reply = ask::ask_with_correction(d, s, question, Some(m)).expect("an answer");
    match reply.answer {
        Some(Answer::Count { word, total, .. }) => Seen { layer: "computed", confident: true, text: format!("{word} {total} times"), refs: Vec::new() },
        Some(Answer::Curated { question, answer, note, citations, confidence, .. }) => Seen {
            layer: "curated",
            confident: confidence != "unattested",
            text: links_as_text(&format!("{question} {answer} {}", note.unwrap_or_default())),
            refs: citations.into_iter().map(|c| c.reference).collect(),
        },
        Some(Answer::Dictionary { id, headword, .. }) => {
            // the whole article is one tap away; the desktop's bench reads the first 3000 characters of it
            let body: String = d
                .query_row("SELECT body FROM dict_entries WHERE id = ?1", [id], |r| r.get(0))
                .or_else(|_| s.query_row("SELECT body FROM dict_entries WHERE id = ?1", [id], |r| r.get(0)))
                .unwrap_or_default();
            Seen {
                layer: "dictionary",
                confident: true,
                text: format!("{headword} {}", links_as_text(&body.chars().take(3000).collect::<String>())),
                refs: link_refs(&body),
            }
        }
        // a related answer is shown labelled, under no promise: the reader gets it with the passages (as the desktop's bench treats it)
        other => {
            let (text, refs) = passages(d, s, m, question);
            Seen { layer: if matches!(other, Some(Answer::Related { .. })) { "fallback+related" } else { "fallback" }, confident: false, text, refs }
        }
    }
}

#[test]
#[ignore]
fn phone_search_bench() {
    let Ok(pack) = std::env::var("SEARCH_PACK") else { panic!("set SEARCH_PACK to the folder of the unzipped Advanced search pack") };
    let m = Meaning::load(&PathBuf::from(pack)).expect("the Advanced search pack");
    let path = unpack_db(&std::env::temp_dir().join("bible-pocket-bench")).unwrap();
    let (d, s) = (db::open_read_only(&path).unwrap(), db::open_read_only(&path).unwrap());
    let file = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/bench/search_bench.json");
    let bench: Value = serde_json::from_str(&std::fs::read_to_string(file).expect("the bench file")).expect("valid json");
    let questions = bench["questions"].as_array().expect("questions");

    // (ok & confident, ok & honest non-answer, wrong, missed)
    let (mut right, mut honest, mut wrong, mut missed) = (0, 0, 0, 0);
    let mut by_cat: std::collections::BTreeMap<String, (i32, i32)> = std::collections::BTreeMap::new();
    let mut report: Vec<String> = Vec::new();
    let started = std::time::Instant::now();
    for q in questions {
        let question = q["q"].as_str().unwrap();
        let cat = q["cat"].as_str().unwrap_or("other").to_string();
        let seen = look(&d, &s, &m, question);
        let text_blob = seen.text.to_lowercase();
        let blob = format!("{} {}", seen.text, seen.refs.join(" ")).to_lowercase();
        // a number must be in the words of the answer itself (not in a verse number among the citations)
        let has = |w: &String| if w.chars().all(|c| c.is_ascii_digit()) { text_blob.split(|c: char| !c.is_alphanumeric()).any(|t| t == w) } else { blob.contains(w) };
        let abstain = q["abstain"].as_bool().unwrap_or(false);
        let (all, any, refs) = (words(q, "must_all"), words(q, "must_any"), words(q, "refs_any"));
        // "top": the passage must be among the first N results the reader sees
        let top = q["top"].as_u64().unwrap_or(10) as usize;
        let content_ok = all.iter().all(|w| has(w)) && (any.is_empty() || any.iter().any(|w| has(w))) && (refs.is_empty() || refs.iter().any(|r| seen.refs.iter().take(top).any(|x| x.to_lowercase().starts_with(r.as_str()))));
        let entry = by_cat.entry(cat.clone()).or_insert((0, 0));
        entry.1 += 1;
        let outcome = if abstain {
            if seen.confident { "WRONG" } else { "HONEST" }
        } else if content_ok && (seen.confident || !refs.is_empty()) {
            "RIGHT"
        } else if seen.confident {
            "WRONG"
        } else {
            "MISSED"
        };
        match outcome {
            "RIGHT" => {
                right += 1;
                entry.0 += 1;
            }
            "HONEST" => {
                honest += 1;
                entry.0 += 1;
            }
            "WRONG" => wrong += 1,
            _ => missed += 1,
        }
        if outcome == "WRONG" || outcome == "MISSED" {
            report.push(format!(
                "  {outcome:6} [{cat}] {question}\n         -> {} | first results: {} | {}",
                seen.layer,
                seen.refs.iter().take(4).cloned().collect::<Vec<_>>().join(", "),
                seen.text.chars().take(110).collect::<String>().replace('\n', " ")
            ));
        }
    }
    let total = questions.len() as i32;
    let confident_total = right + wrong;
    println!("\nPHONE SEARCH BENCH: {total} questions in {:.0?}", started.elapsed());
    for (cat, (ok, n)) in &by_cat {
        println!("  {cat:9} {ok}/{n}");
    }
    println!("  right with confidence: {right}   honest non-answers: {honest}   wrong with confidence: {wrong}   missed (no confident answer, one exists): {missed}");
    if confident_total > 0 {
        println!("  accuracy of the answers given with confidence: {:.1}%   answered or honestly declined: {:.1}%", 100.0 * right as f64 / confident_total as f64, 100.0 * (right + honest) as f64 / total as f64);
    }
    for line in &report {
        println!("{line}");
    }
    if let Ok(max) = std::env::var("BENCH_MAX_WRONG") {
        assert!(wrong <= max.parse::<i32>().unwrap_or(0), "{wrong} confident answers were wrong");
    }
}

/// Why the phone answered as it did: the four closest stored answers and how close they are, for the questions (one per line) in the file
/// named by PROBE_FILE. Checks nothing.
///   PROBE_FILE=<file> SEARCH_PACK=<pack folder> cargo test --test bench phone_probe -- --ignored --nocapture
#[test]
#[ignore]
fn phone_probe() {
    let (Ok(file), Ok(pack)) = (std::env::var("PROBE_FILE"), std::env::var("SEARCH_PACK")) else { return };
    let m = Meaning::load(&PathBuf::from(pack)).expect("the Advanced search pack");
    let path = unpack_db(&std::env::temp_dir().join("bible-pocket-bench")).unwrap();
    let (d, s) = (db::open_read_only(&path).unwrap(), db::open_read_only(&path).unwrap());
    for line in std::fs::read_to_string(file).expect("the probe file").lines().map(str::trim).filter(|l| !l.is_empty()) {
        println!("PROBE {line}");
        for (q, sim) in ask::closest(&m, line, 4).unwrap() {
            println!("   {sim:.3}  {q}");
        }
        let seen = look(&d, &s, &m, line);
        println!("   -> {} {}", seen.layer, if seen.confident { "CONFIDENT" } else { "not-confident" });
    }
}
