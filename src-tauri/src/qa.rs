//! Curated "Ask a question" knowledge base -- hand-verified answers for questions that
//! aren't simple word-occurrence counts (those are handled live by `qa_parser` +
//! `word_frequency` instead). See `resources/qa.json` for the actual entries and
//! `src-tauri/src/bin/index_qa.rs` for how the semantic-match index in
//! `resources/qa_index.json` is built.
//!
//! Every entry carries an honest `confidence` level rather than presenting everything with
//! the same false certainty -- this is what lets a question like "how old was Joseph when
//! he died" be answered truthfully ("not stated in the canonical text bundled here")
//! instead of either inventing a number or silently returning nothing.

use serde::{Deserialize, Serialize};
use std::path::Path;

/// One reference backing a `QaEntry`, with a short note on what role it plays -- e.g. a
/// verse that states the fact directly, versus one that's only supporting context.
#[derive(Deserialize, Serialize, Clone)]
pub struct QaCitation {
    pub reference: String,
    pub role: String,
}

/// How certain an answer is. Never inferred -- set deliberately per entry by whoever
/// curates it, based on what the cited text actually supports:
///   "stated"             -- scripture states this directly, in a specific cited verse.
///   "computed"           -- deterministically counted/derived from the bundled data
///                           itself (either a live `{{n}}` splice via `computed_from`,
///                           or a list the curator counted directly against the
///                           bundled text).
///   "traditional"        -- a harmonization across multiple accounts, or a matter of
///                           scholarship/tradition (e.g. a Talmudic count, a
///                           conventional grouping of books) -- a real answer exists
///                           but isn't one verse's plain statement, and the answer/note
///                           must say so.
///   "commentary_opinion" -- scripture doesn't settle this directly; the answer draws
///                           on a *named* bundled commentary's interpretation instead.
///                           The answer text must name the commentary and the cited
///                           verse it's commenting on, so it reads as that
///                           commentator's view, not as scripture or as this app's own
///                           claim -- never blend an unattributed paraphrase of a
///                           commentary into "stated"/"traditional" prose.
///   "doctrinal_view"     -- the house lens: the answer states what scripture says first,
///                           then leads with the Pentecostal / blood-bought / born-again /
///                           rapture-believing reading as *that reading* (labeled, never
///                           passed off as a bare scripture statement), then notes other
///                           views briefly. Used where the lead claim is interpretive.
///   "unattested"         -- not stated in the canonical text bundled here at all. The
///                           honest non-answer path, e.g. Joseph's age at death.
#[derive(Deserialize, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QaConfidence {
    Stated,
    Computed,
    Traditional,
    CommentaryOpinion,
    DoctrinalView,
    Unattested,
}

/// One viewpoint on a subject that has more than one: shown after the answer under its own label (for example "The
/// Pentecostal reading" and "Other views"). The owner decides per view whether it is published: `publish: false` hides it.
#[derive(Deserialize, Serialize, Clone)]
pub struct QaView {
    pub label: String,
    pub text: String,
    #[serde(default = "yes")]
    pub publish: bool,
}

fn yes() -> bool {
    true
}

#[derive(Deserialize, Serialize, Clone)]
pub struct QaEntry {
    pub id: String,
    pub question: String,
    /// Extra phrasings embedded alongside `question` in the semantic index purely to widen
    /// recall for paraphrases -- never shown in the UI.
    #[serde(default)]
    pub alt_phrasings: Vec<String>,
    pub confidence: QaConfidence,
    pub answer: String,
    #[serde(default)]
    pub citations: Vec<QaCitation>,
    #[serde(default)]
    pub note: Option<String>,
    /// A recognized tag naming a live count to splice into `answer`'s literal "{{n}}"
    /// token (e.g. "books", "verses", "chapters", "cross_references", "prophecy_count").
    /// `None` for static-text entries. Resolved in `commands.rs::resolve_computed`.
    #[serde(default)]
    pub computed_from: Option<String>,
    /// More than one viewpoint on the subject, each under its own label; the answer itself says what Scripture says.
    #[serde(default)]
    pub views: Vec<QaView>,
}

#[derive(Deserialize)]
struct RawFile {
    entries: Vec<QaEntry>,
}

pub struct QaData {
    entries: Vec<QaEntry>,
}

impl QaData {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        Self::from_json(&std::fs::read_to_string(path)?)
    }

    /// From qa.json's text (the phone carries it inside the app).
    pub fn from_json(text: &str) -> anyhow::Result<Self> {
        let raw: RawFile = serde_json::from_str(text)?;
        Ok(Self { entries: raw.entries })
    }

    pub fn get(&self, id: &str) -> Option<&QaEntry> {
        self.entries.iter().find(|e| e.id == id)
    }

    pub fn all(&self) -> &[QaEntry] {
        &self.entries
    }

    /// Case/whitespace-insensitive exact match against `question` or any `alt_phrasings`
    /// entry -- the free fast path tried before spending an embed() call.
    /// The entry whose question (or other wording) is the one typed: the same words, whatever the capital letters, spaces, curly
    /// apostrophes or closing "?" ("who betrayed jesus" is the stored "Who betrayed Jesus?").
    pub fn find_exact(&self, query: &str) -> Option<&QaEntry> {
        let q = question_form(query);
        if q.is_empty() {
            return None;
        }
        self.entries.iter().find(|e| question_form(&e.question) == q || e.alt_phrasings.iter().any(|p| question_form(p) == q))
    }
}

/// A question as it is compared: lower case, single spaces, straight apostrophes, no closing "?", "." or "!".
fn question_form(s: &str) -> String {
    let s = s.replace(['’', '‘'], "'").to_lowercase();
    let s = s.trim().trim_end_matches(['?', '.', '!']).trim_end();
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_question_is_found_whatever_its_capitals_spaces_apostrophes_or_question_mark() {
        let qa = QaData::from_json(
            r#"{"entries":[{"id":"a","question":"Who betrayed Jesus?","alt_phrasings":["Who was Jesus' betrayer?"],"confidence":"stated","answer":"Judas.","citations":[],"note":null},
            {"id":"b","question":"What is the Rapture?","alt_phrasings":[],"confidence":"stated","answer":"x","citations":[],"note":null}]}"#,
        )
        .unwrap();
        for q in ["Who betrayed Jesus?", "who betrayed jesus", "  WHO   betrayed Jesus ?? ", "Who betrayed Jesus.", "who was Jesus’ betrayer"] {
            assert_eq!(qa.find_exact(q).map(|e| e.id.as_str()), Some("a"), "{q}");
        }
        assert_eq!(qa.find_exact("what is the rapture").map(|e| e.id.as_str()), Some("b"));
        for not in ["Who betrayed Jesus Christ?", "betrayed", "", "?", "who betrayed"] {
            assert!(qa.find_exact(not).is_none(), "{not}");
        }
    }
}

/// One embedded phrasing in the semantic-match index -- either a `qa.json` question/
/// alt-phrasing, or one of the app's existing 84 Firsts/Prophecies questions, so both are
/// searchable together without duplicating any of that already-curated content.
#[derive(Deserialize, Serialize, Clone)]
pub struct QaIndexRow {
    pub source: String, // "qa" | "firsts"
    pub id: String,
    pub phrasing: String,
    pub vector: Vec<f32>,
}

#[derive(Deserialize)]
struct RawIndexFile {
    entries: Vec<QaIndexRow>,
}

pub struct QaRuntime {
    pub data: QaData,
    index: Vec<QaIndexRow>,
}

impl QaRuntime {
    pub fn load(qa_path: &Path, index_path: &Path) -> anyhow::Result<Self> {
        let data = QaData::load(qa_path)?;
        let contents = std::fs::read_to_string(index_path)?;
        let raw: RawIndexFile = serde_json::from_str(&contents)?;
        Ok(Self { data, index: raw.entries })
    }

    /// Best-scoring (source, id, similarity) across every indexed phrasing. Vectors are
    /// already L2-normalized by `Embedder::embed`, so cosine similarity is a plain dot
    /// product -- no norm division needed at match time. Returns `None` only if the index
    /// is empty (never happens once resources/qa_index.json is bundled correctly).
    /// The best match of each different stored answer, best first (an answer can have several phrasings: only its closest one
    /// counts), at most `k`. The pipeline tries them in turn until one passes the gate.
    pub fn best_matches(&self, query_vec: &[f32], k: usize) -> Vec<(String, String, f32)> {
        let mut best: std::collections::HashMap<(String, String), f32> = std::collections::HashMap::new();
        for row in &self.index {
            let dot: f32 = row.vector.iter().zip(query_vec).map(|(a, b)| a * b).sum();
            let e = best.entry((row.source.clone(), row.id.clone())).or_insert(f32::MIN);
            if dot > *e {
                *e = dot;
            }
        }
        let mut v: Vec<(String, String, f32)> = best.into_iter().map(|((s, i), d)| (s, i, d)).collect();
        v.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
        v.truncate(k);
        v
    }

    pub fn best_match(&self, query_vec: &[f32]) -> Option<(String, String, f32)> {
        self.index
            .iter()
            .map(|row| {
                let dot: f32 = row.vector.iter().zip(query_vec).map(|(a, b)| a * b).sum();
                (row.source.clone(), row.id.clone(), dot)
            })
            .max_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal))
    }
}
