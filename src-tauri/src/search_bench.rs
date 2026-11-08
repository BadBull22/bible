//! The search test bench: a list of real questions (bench/search_bench.json), each with what a correct answer must contain,
//! run through the real answer pipeline with the bundled data. It reports what share of the answers the app gives with
//! confidence are right, what it gets wrong, and where it honestly says it has no confident answer.
//!   cd src-tauri; cargo test --lib search_bench -- --ignored --nocapture
//! Optional: BENCH_MAX_WRONG=0 makes the run fail when any confident answer is wrong.

use std::path::PathBuf;

use serde_json::Value;

use crate::commands::ask_question_query;
use crate::embeddings::Embedder;
use crate::firsts::FirstsData;
use crate::models::AskAnswer;
use crate::qa::{QaConfidence, QaRuntime};

/// What a pipeline answer looks like to the bench: the layer, whether it was given with confidence, the words, the passages.
struct Seen {
    layer: &'static str,
    confident: bool,
    text: String,
    refs: Vec<String>,
}

fn look(a: &AskAnswer) -> Seen {
    match a {
        AskAnswer::Computed { word, result } => Seen {
            layer: "computed",
            confident: true,
            text: format!("{word} {} times", result.total_occurrences),
            refs: result.verses.iter().take(12).map(|h| format!("{} {}:{}", h.book, h.chapter, h.verse)).collect(),
        },
        AskAnswer::Curated { entry, matched_by, .. } => Seen {
            layer: if matched_by == "people" { "people" } else { "curated" },
            confident: entry.confidence != QaConfidence::Unattested,
            text: links_as_text(&format!("{} {} {}", entry.question, entry.answer, entry.note.clone().unwrap_or_default())),
            refs: entry.citations.iter().map(|c| c.reference.clone()).collect(),
        },
        AskAnswer::Dictionary { entry, term } => Seen {
            layer: "dictionary",
            confident: true,
            text: format!("{term} {} {}", entry.headword, links_as_text(&entry.body.chars().take(3000).collect::<String>())),
            // the passages a dictionary entry points to
            refs: link_refs(&entry.body),
        },
        AskAnswer::Fallback { hits, commentary_hits: _, related } => Seen {
            // a related answer is not confident either: it is shown labelled, under the passages
            layer: if related.is_some() { "fallback+related" } else { "fallback" },
            confident: false,
            text: hits.iter().take(10).map(|h| h.text.clone()).collect::<Vec<_>>().join(" "),
            refs: hits.iter().take(10).map(|h| format!("{} {}:{}", h.book, h.chapter, h.verse)).collect(),
        },
    }
}

/// A dictionary body writes a passage as a link marker, ⟦Matthew|7|12||Mt 7:12⟧: read it as "Matthew 7:12".
fn links_as_text(s: &str) -> String {
    let re = regex::Regex::new(r"⟦([^|⟧]+)\|(\d+)\|(\d+)\|[^|⟧]*\|[^⟧]*⟧").expect("valid pattern");
    re.replace_all(s, "$1 $2:$3").into_owned()
}

/// The passages a dictionary body links to, as "Matthew 7:12".
fn link_refs(s: &str) -> Vec<String> {
    let re = regex::Regex::new(r"⟦([^|⟧]+)\|(\d+)\|(\d+)\|[^|⟧]*\|[^⟧]*⟧").expect("valid pattern");
    re.captures_iter(s).take(40).map(|c| format!("{} {}:{}", &c[1], &c[2], &c[3])).collect()
}

fn words(v: &Value, key: &str) -> Vec<String> {
    v[key].as_array().map(|a| a.iter().filter_map(|x| x.as_str()).map(str::to_lowercase).collect()).unwrap_or_default()
}

#[test]
#[ignore]
fn search_bench() {
    crate::register_sqlite_vec();
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let conn = rusqlite::Connection::open(dir.join("resources/bible.db")).expect("open bible.db");
    let embedder = Embedder::load(&dir.join("resources/model")).expect("load embedder");
    let firsts = FirstsData::load(&dir.join("resources/firsts.json")).expect("load firsts.json");
    let qa = QaRuntime::load(&dir.join("resources/qa.json"), &dir.join("resources/qa_index.json")).expect("load qa runtime");
    let commentary = rusqlite::Connection::open(dir.join("resources/commentaries.db")).ok();
    let study = rusqlite::Connection::open(dir.join("resources/study.db")).ok();

    let bench: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("bench/search_bench.json")).expect("the bench file")).expect("valid json");
    let questions = bench["questions"].as_array().expect("questions");

    // (ok & confident, ok & honest non-answer, wrong, missed)
    let (mut right, mut honest, mut wrong, mut missed) = (0, 0, 0, 0);
    let mut by_cat: std::collections::BTreeMap<String, (i32, i32)> = std::collections::BTreeMap::new();
    let mut report: Vec<String> = Vec::new();
    for q in questions {
        let question = q["q"].as_str().unwrap();
        let cat = q["cat"].as_str().unwrap_or("other").to_string();
        let a = ask_question_query(&conn, &embedder, commentary.as_ref(), study.as_ref(), &firsts, &qa, question, 10).expect("an answer");
        let seen = look(&a);
        let text_blob = seen.text.to_lowercase();
        let blob = format!("{} {}", seen.text, seen.refs.join(" ")).to_lowercase();
        // a number must be in the words of the answer itself (not in a verse number among the citations)
        let has = |w: &String| if w.chars().all(|c| c.is_ascii_digit()) { text_blob.split(|c: char| !c.is_alphanumeric()).any(|t| t == w) } else { blob.contains(w) };
        let abstain = q["abstain"].as_bool().unwrap_or(false);
        let (all, any, refs) = (words(q, "must_all"), words(q, "must_any"), words(q, "refs_any"));
        // "top": the passage must be among the first N results the reader sees (a topic search is only right if the passage is up front)
        let top = q["top"].as_u64().unwrap_or(10) as usize;
        let content_ok = all.iter().all(|w| has(w)) && (any.is_empty() || any.iter().any(|w| has(w))) && (refs.is_empty() || refs.iter().any(|r| seen.refs.iter().take(top).any(|s| s.to_lowercase().starts_with(r.as_str()))));
        let entry = by_cat.entry(cat.clone()).or_insert((0, 0));
        entry.1 += 1;
        let outcome = if abstain {
            if seen.confident { "WRONG" } else { "HONEST" }
        } else if content_ok && (seen.confident || !refs.is_empty()) {
            // a passage search is a fair answer to a topic question; a question of fact needs a confident answer
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
    println!("\nSEARCH BENCH: {total} questions");
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

/// A quick look at what the engine answers to questions that are not in the bench yet (one question per line in the file named by
/// PROBE_FILE). It prints the layer, whether the answer is confident, the first passages and the first words; it checks nothing.
///   PROBE_FILE=path cargo test --lib search_probe -- --ignored --nocapture
#[test]
#[ignore]
fn search_probe() {
    let Ok(path) = std::env::var("PROBE_FILE") else { return };
    crate::register_sqlite_vec();
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let conn = rusqlite::Connection::open(dir.join("resources/bible.db")).expect("open bible.db");
    let embedder = Embedder::load(&dir.join("resources/model")).expect("load embedder");
    let firsts = FirstsData::load(&dir.join("resources/firsts.json")).expect("load firsts.json");
    let qa = QaRuntime::load(&dir.join("resources/qa.json"), &dir.join("resources/qa_index.json")).expect("load qa runtime");
    let commentary = rusqlite::Connection::open(dir.join("resources/commentaries.db")).ok();
    let study = rusqlite::Connection::open(dir.join("resources/study.db")).ok();
    for line in std::fs::read_to_string(path).expect("the probe file").lines().map(str::trim).filter(|l| !l.is_empty()) {
        let a = ask_question_query(&conn, &embedder, commentary.as_ref(), study.as_ref(), &firsts, &qa, line, 10).expect("an answer");
        let s = look(&a);
        println!(
            "PROBE {line}\n   -> {} {} | {} | {}",
            s.layer,
            if s.confident { "CONFIDENT" } else { "not-confident" },
            s.refs.iter().take(4).cloned().collect::<Vec<_>>().join(", "),
            s.text.chars().take(130).collect::<String>().replace('\n', " ")
        );
    }
}
