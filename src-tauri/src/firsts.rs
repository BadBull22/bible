use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Deserialize, Serialize, Clone)]
pub struct FirstsEntry {
    pub id: String,
    /// One of "firsts", "facts", "promises", "warfare" -- lets the UI group entries
    /// into tabs. Defaults to "firsts" for backward compatibility with older data.
    #[serde(default = "default_category")]
    pub category: String,
    pub question: String,
    pub answer: String,
    #[serde(default)]
    pub citations: Vec<String>,
    #[serde(default)]
    pub note: Option<String>,
}

fn default_category() -> String {
    "firsts".to_string()
}

#[derive(Deserialize)]
struct RawFile {
    entries: Vec<FirstsEntry>,
}

/// Hand-curated, source-cited Bible trivia (see resources/firsts.json), grouped into four
/// categories: "firsts" (interpretive "what was the first X" questions get a specific
/// answer here rather than an inferred guess -- and where genuinely ambiguous, e.g. "first
/// sin" vs "first murder", both readings are included as separate entries), "facts"
/// (structural/computed facts, verified directly against the bundled text rather than
/// repeated from popular trivia lists), "promises" (explicit first-person promises from
/// God, quoted rather than paraphrased), and "warfare" (passages explicitly about
/// spiritual warfare, not thematically inferred ones).
pub struct FirstsData {
    entries: Vec<FirstsEntry>,
}

impl FirstsData {
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let contents = std::fs::read_to_string(path)?;
        let raw: RawFile = serde_json::from_str(&contents)?;
        Ok(Self { entries: raw.entries })
    }

    pub fn all(&self) -> Vec<FirstsEntry> {
        self.entries.clone()
    }

    pub fn search(&self, query: &str) -> Vec<FirstsEntry> {
        let q = query.to_lowercase();
        self.entries
            .iter()
            .filter(|e| e.question.to_lowercase().contains(&q) || e.answer.to_lowercase().contains(&q))
            .cloned()
            .collect()
    }
}
