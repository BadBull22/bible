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
        let contents = std::fs::read_to_string(path)?;
        let raw: RawFile = serde_json::from_str(&contents)?;
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
    pub fn find_exact(&self, query: &str) -> Option<&QaEntry> {
        let q = query.trim().to_lowercase();
        self.entries.iter().find(|e| {
            e.question.trim().to_lowercase() == q || e.alt_phrasings.iter().any(|p| p.trim().to_lowercase() == q)
        })
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
