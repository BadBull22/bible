use crate::commentaries::{CommentaryHit, TimelineEvent};
use crate::qa::QaConfidence;
use serde::{Deserialize, Serialize};

/// The opening screen's "Inside this Bible" stat tiles -- every field is a live count
/// against the bundled data (never a hardcoded figure), so these can't drift out of sync
/// with whatever the data pipeline actually ships. The `entities`-derived fields
/// (people/places/events/commentaries) default to 0 rather than failing the whole
/// struct if commentaries.db happens to be missing from a build, since it's optional.
#[derive(Serialize, Clone)]
pub struct HomeStats {
    pub books: i64,
    pub ot_books: i64,
    pub nt_books: i64,
    pub chapters: i64,
    pub ot_chapters: i64,
    pub nt_chapters: i64,
    /// Verse count per the KJV, the traditionally-cited 31,102 figure.
    pub verses: i64,
    pub cross_references: i64,
    /// Bundled Bible translations, excluding 1 Enoch (not a translation of the Bible).
    pub translations: i64,
    pub strongs_hebrew: i64,
    pub strongs_greek: i64,
    pub people: i64,
    pub places: i64,
    pub events: i64,
    pub commentaries: i64,
}

/// One person's lifespan bar on the Timeline -- Adams' chart draws every patriarch as a
/// horizontal ribbon whose length is the years they lived, and this carries exactly what
/// is needed to place and caption one.
#[derive(Serialize, Clone)]
pub struct TimelineRibbon {
    pub id: String,
    pub name: String,
    /// Verse this person is cited from, so a ribbon can jump to scripture.
    pub citation: String,
    pub birth_year: Option<i64>,
    pub death_year: Option<i64>,
    pub lifespan: Option<i64>,
    pub lifespan_citation: Option<String>,
    pub age_at_heir_birth: Option<i64>,
    pub age_citation: Option<String>,
    /// How the years were arrived at: "scripture" (length from a cited lifespan),
    /// "corrected" (a curated override of a bad dataset record), "dataset", or
    /// "uncertain" -- which the UI marks with Adams' own `?` rather than a guess.
    pub date_source: String,
    pub note: Option<String>,
    /// Why a date was corrected, or why the chain arithmetic shifts here.
    pub date_note: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct TimelineData {
    pub ribbons: Vec<TimelineRibbon>,
    pub events: Vec<TimelineEvent>,
}

#[derive(Serialize, Clone)]
pub struct Version {
    pub code: String,
    pub name: String,
    pub language: String,
    pub is_original_language: bool,
}

#[derive(Serialize, Clone)]
pub struct BookInfo {
    pub name: String,
    pub testament: String,
    pub order_index: i64,
}

#[derive(Serialize, Clone)]
pub struct Verse {
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub text: String,
}

#[derive(Serialize, Clone)]
pub struct StrongsWord {
    pub word_order: i64,
    pub surface_text: String,
    pub strongs_numbers: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct VerseWithWords {
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub text: String,
    pub words: Vec<StrongsWord>,
}

#[derive(Serialize, Clone)]
pub struct StrongsEntry {
    pub strongs_number: String,
    pub language: String,
    pub lemma: Option<String>,
    pub xlit: Option<String>,
    pub pronunciation: Option<String>,
    pub derivation: Option<String>,
    pub strongs_def: Option<String>,
    pub kjv_def: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct SearchHit {
    pub version_code: String,
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub text: String,
}

#[derive(Serialize, Clone)]
pub struct CrossReference {
    pub to_book: String,
    pub to_chapter: i64,
    pub to_verse_start: i64,
    pub to_verse_end: i64,
    pub votes: i64,
}

#[derive(Serialize, Clone)]
pub struct WordFrequencyResult {
    pub total_occurrences: i64,
    pub verses: Vec<SearchHit>,
    /// Human-readable description of an applied scope ("in the New Testament", "in
    /// Romans"), `None` for an unscoped whole-Bible count -- lets the UI phrase its
    /// summary sentence correctly without re-deriving it from `FrequencyScope` itself.
    pub scope_label: Option<String>,
}

/// An optional restriction on a `word_frequency` query -- `None` (the default, omitted
/// entirely) searches the whole Bible, matching today's existing behavior exactly.
#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FrequencyScope {
    Testament { testament: String },
    Book { book: String },
}

/// One citation backing an [`AskCuratedEntry`] answer, with a short note on the role it
/// plays (e.g. "stated" vs. "supporting" vs. "foretold"/"fulfilled" for a prophecy pair).
#[derive(Serialize, Clone)]
pub struct AskCitation {
    pub reference: String,
    pub role: String,
}

/// A curated answer as shown to the user -- built from either a `qa.json` entry or a
/// matched Firsts/Prophecies entry, so both sources render through one shape.
#[derive(Serialize, Clone)]
pub struct AskCuratedEntry {
    pub question: String,
    pub confidence: QaConfidence,
    pub answer: String,
    pub citations: Vec<AskCitation>,
    pub note: Option<String>,
}

/// The tagged result of `ask_question`, in the fixed order its three layers are tried:
/// an exact computed count, a curated hand-verified answer, or (when neither hits) the
/// best-effort semantic/lexical fallback, clearly distinguished so the UI never lets a
/// guess look as certain as a verified answer.
#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AskAnswer {
    Computed {
        word: String,
        result: WordFrequencyResult,
    },
    Curated {
        entry: AskCuratedEntry,
        /// "exact" (matched `qa.json` question/alt_phrasing text verbatim) or "semantic"
        /// (matched by embedding similarity) -- the UI shows a "matched by meaning" note
        /// only for the latter.
        matched_by: String,
        /// Cosine similarity of the match, present only when `matched_by` is "semantic".
        similarity: Option<f32>,
    },
    Fallback {
        hits: Vec<SearchHit>,
        commentary_hits: Vec<CommentaryHit>,
    },
}

#[derive(Serialize, Clone)]
pub struct OnlineVersionInfo {
    pub code: String,
    pub name: String,
    /// Human-readable provider name ("api.bible", "api.esv.org") for the UI's "online" tag.
    pub provider: String,
    pub configured: bool,
}

#[derive(Serialize, Clone)]
pub struct OnlineVerseResult {
    pub version_code: String,
    pub book: String,
    pub chapter: i64,
    pub verse: i64,
    pub text: String,
    pub copyright: String,
}
