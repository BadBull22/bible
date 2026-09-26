//! Recognizes a narrow, strict set of "how many times is X mentioned" sentence shapes and
//! extracts the target word/phrase plus an optional testament/book scope. Deliberately
//! conservative: a missed match just falls through to the curated Q&A layer (cheap), while
//! a wrong match would confidently show the wrong number for a question the user didn't
//! actually ask (expensive) -- see the false-positive test cases below, which exist
//! specifically to keep "how many times did Jesus appear after his resurrection" (a
//! narrative-event question) from being misread as a word-occurrence question just because
//! it contains the words "how many times".
//!
//! Two-phase design, deliberately not one big regex per template: (1) `strip_scope_suffix`
//! first tries to peel a recognized scope clause ("in the New Testament", "in the book of
//! John", "in Romans") off the *end* of the whole question; (2) the remaining "core"
//! question (with no scope clause left to worry about) is matched against a short list of
//! verb/phrase templates, anchored to the end of string. Splitting it this way avoids a
//! regex trap the single-pass version fell into: a non-greedy phrase capture immediately
//! followed by an open `(.*)$` tail collapses to matching almost nothing (verified by a
//! failing unit test before this design existed), because nothing forces it to consume the
//! whole target word. With the scope clause already removed, every phrase capture below can
//! safely run greedy to end-of-string instead.

use regex::Regex;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq)]
pub enum ParsedScope {
    WholeBible,
    Testament(String), // "OT" | "NT"
    Book(String),       // raw text, not yet validated against the books table
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedFrequencyQuestion {
    pub word: String,
    pub scope: ParsedScope,
}

struct ScopeSuffixRule {
    regex: Regex,
    scope: fn(&regex::Captures) -> ParsedScope,
}

/// Tried in order, first match wins -- the "book of X" / bare "in X" rules are
/// deliberately last and capped at 3 words (the longest real book names, e.g. "Song of
/// Solomon", are 3 words), so a trailing qualifying clause like "before the flood" (4
/// words after "in") is correctly rejected rather than misread as a book name.
fn scope_suffix_rules() -> &'static Vec<ScopeSuffixRule> {
    static RULES: OnceLock<Vec<ScopeSuffixRule>> = OnceLock::new();
    RULES.get_or_init(|| {
        let mk = |pat: &str, scope: fn(&regex::Captures) -> ParsedScope| ScopeSuffixRule {
            regex: Regex::new(pat).unwrap(),
            scope,
        };
        vec![
            mk(r"(?i)\s+in\s+(?:the\s+whole\s+bible|the\s+whole\s+of\s+scripture|the\s+bible|scripture)$", |_| {
                ParsedScope::WholeBible
            }),
            mk(r"(?i)\s+in\s+(?:the\s+old\s+testament|the\s+ot)$", |_| ParsedScope::Testament("OT".to_string())),
            mk(r"(?i)\s+in\s+(?:the\s+new\s+testament|the\s+nt)$", |_| ParsedScope::Testament("NT".to_string())),
            mk(r"(?i)\s+in\s+the\s+book\s+of\s+([a-z0-9]+(?:\s[a-z0-9]+){0,2})$", |c| {
                ParsedScope::Book(c[1].to_lowercase())
            }),
            mk(r"(?i)\s+in\s+([a-z0-9]+(?:\s[a-z0-9]+){0,2})$", |c| ParsedScope::Book(c[1].to_lowercase())),
        ]
    })
}

/// Strips a trailing scope clause if one is recognized, returning the remaining "core"
/// text (unchanged if nothing matched) and the scope (`WholeBible` if nothing matched --
/// an unscoped question is a whole-Bible question, not a parse failure).
fn strip_scope_suffix(text: &str) -> (String, ParsedScope) {
    for rule in scope_suffix_rules() {
        if let Some(caps) = rule.regex.captures(text) {
            let m = caps.get(0).unwrap();
            let remaining = &text[..m.start()];
            return (remaining.to_string(), (rule.scope)(&caps));
        }
    }
    (text.to_string(), ParsedScope::WholeBible)
}

struct CoreTemplate {
    regex: Regex,
}

/// Matched against the *already scope-stripped* core text, so every phrase capture here
/// can safely run to end-of-string (`$`) with no ambiguity about where it stops.
fn core_templates() -> &'static Vec<CoreTemplate> {
    static TEMPLATES: OnceLock<Vec<CoreTemplate>> = OnceLock::new();
    TEMPLATES.get_or_init(|| {
        let mk = |pat: &str| CoreTemplate { regex: Regex::new(pat).unwrap() };
        vec![
            // T1 (passive, matches the user's own example phrasing -- including "how many
            // TIME" singular, which is how they actually typed it): "how many time(s) is/
            // does/did/has/do/was/were [the word/name] 'PHRASE' [is/was] mentioned/used/
            // appear(s)/occur(s)/found". The optional "is|was" right before the trailing
            // verb covers a natural copula ("...gold IS used") that would otherwise get
            // swallowed into the phrase capture itself -- without it, the non-greedy
            // capture stops as soon as it finds ANY position where the trailing verb
            // follows, and "gold is used" has one at "gold" + "is" + "used" as much as at
            // "gold" + "used", so "is the word gold is used" wrongly captured "gold is".
            mk(r"(?i)^how many times? (?:is|does|did|has|do|was|were) (?:the word |the name )?['\x22]?(?P<phrase>.+?)['\x22]? (?:is |was )?(?:mentioned|used|appears?|occurs?|found)$"),
            // T2 (active): "how many time(s) does/did/has/do [the bible/scripture/it]
            // mention(s)/use(s)/say [the word/name] PHRASE" -- phrase is the last thing in
            // the pattern now, so it can run greedy to the end safely.
            mk(r"(?i)^how many times? (?:does|did|has|do) (?:the bible |scripture |it )?(?:mentions?|used?|says?) (?:the word |the name )?['\x22]?(?P<phrase>.+?)['\x22]?$"),
            // T3 (clipped): "word count for/of PHRASE", "occurrence count for/of PHRASE"
            mk(r"(?i)^(?:word|occurrence) count (?:for|of) ['\x22]?(?P<phrase>.+?)['\x22]?$"),
        ]
    })
}

pub fn parse_frequency_question(question: &str) -> Option<ParsedFrequencyQuestion> {
    let normalized = question.trim().trim_end_matches('?').trim();
    if normalized.is_empty() {
        return None;
    }
    let (core, scope) = strip_scope_suffix(normalized);
    let core = core.trim();
    for template in core_templates() {
        if let Some(caps) = template.regex.captures(core) {
            let phrase = caps.name("phrase")?.as_str().trim();
            if phrase.is_empty() {
                continue;
            }
            return Some(ParsedFrequencyQuestion { word: phrase.to_string(), scope });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    // The user's own 5 example questions: only the first is a word-occurrence question.
    // The other 4 MUST fall through (return None) so they reach the curated Q&A layer
    // instead of silently (and wrongly) being answered as a word count.
    #[test]
    fn matches_the_plain_word_count_example() {
        // Exactly as the user typed it, singular "time" -- not the grammatically-correct
        // "times". Real user phrasing, not a cleaned-up version of it.
        let r = parse_frequency_question("how many time is something mentioned in the bible").unwrap();
        assert_eq!(r.word, "something");
        assert_eq!(r.scope, ParsedScope::WholeBible);
    }

    #[test]
    fn misspelled_second_example_correctly_falls_through() {
        // The user's second example ("...mentione in the new testamanet") has genuine
        // misspellings this deterministic layer is not meant to correct -- "mentione" isn't
        // "mentioned", "testamanet" isn't "testament". This MUST return None so the
        // question falls through to the semantic-match layer instead of matching nothing
        // useful or, worse, matching the wrong thing.
        assert!(parse_frequency_question("how many time is it mentione in the new testamanet").is_none());
    }

    #[test]
    fn does_not_match_resurrection_appearance_count() {
        // Contains "how many times" but is a narrative-event question, not a word count --
        // this is the exact near-miss the scope-stripping design exists to catch: "after
        // his resurrection" is not a recognized scope suffix, and the core text left over
        // ("how many time did jesus appear") doesn't match any template's trailing verb.
        assert!(parse_frequency_question("how many time did jesus appear after his resserection").is_none());
    }

    #[test]
    fn does_not_match_days_on_earth_question() {
        assert!(parse_frequency_question("how many days was he still on earth after his resserection").is_none());
    }

    #[test]
    fn does_not_match_prophecies_fulfilled_question() {
        assert!(parse_frequency_question("how many propecies were fullfilled witht he birth life and resserection of christ").is_none());
    }

    #[test]
    fn does_not_match_josephs_age_question() {
        assert!(parse_frequency_question("how old was joseph the father of jesus when he died").is_none());
    }

    #[test]
    fn extracts_word_and_testament_scope() {
        let r = parse_frequency_question("how many times is love mentioned in the New Testament?").unwrap();
        assert_eq!(r.word, "love");
        assert_eq!(r.scope, ParsedScope::Testament("NT".to_string()));
    }

    #[test]
    fn extracts_word_and_old_testament_scope() {
        let r = parse_frequency_question("how many times does gold occur in the Old Testament").unwrap();
        assert_eq!(r.word, "gold");
        assert_eq!(r.scope, ParsedScope::Testament("OT".to_string()));
    }

    #[test]
    fn extracts_word_and_book_scope() {
        let r = parse_frequency_question("how many times is love mentioned in the book of John?").unwrap();
        assert_eq!(r.word, "love");
        assert_eq!(r.scope, ParsedScope::Book("john".to_string()));
    }

    #[test]
    fn extracts_word_and_bare_book_scope() {
        let r = parse_frequency_question("how many times is love mentioned in Romans?").unwrap();
        assert_eq!(r.word, "love");
        assert_eq!(r.scope, ParsedScope::Book("romans".to_string()));
    }

    #[test]
    fn extracts_word_and_multiword_book_scope() {
        let r = parse_frequency_question("how many times is love mentioned in Song of Solomon?").unwrap();
        assert_eq!(r.word, "love");
        assert_eq!(r.scope, ParsedScope::Book("song of solomon".to_string()));
    }

    #[test]
    fn whole_bible_with_no_scope_clause() {
        let r = parse_frequency_question("How many times is grace mentioned?").unwrap();
        assert_eq!(r.word, "grace");
        assert_eq!(r.scope, ParsedScope::WholeBible);
    }

    #[test]
    fn active_phrasing_variant() {
        let r = parse_frequency_question("How many times does the Bible mention faith?").unwrap();
        assert_eq!(r.word, "faith");
        assert_eq!(r.scope, ParsedScope::WholeBible);
    }

    #[test]
    fn word_count_for_phrasing() {
        let r = parse_frequency_question("word count for righteousness").unwrap();
        assert_eq!(r.word, "righteousness");
        assert_eq!(r.scope, ParsedScope::WholeBible);
    }

    #[test]
    fn unrelated_question_does_not_match() {
        assert!(parse_frequency_question("who was the oldest person in the Bible?").is_none());
    }

    #[test]
    fn scope_with_unrelated_trailing_text_is_a_hard_non_match() {
        // "how many times X mentioned in Genesis before the flood" -- "before the flood" is
        // 4 words after "in", over the 3-word book-name cap, so no scope suffix is
        // stripped; the leftover core text then doesn't end right after "mentioned" (it's
        // followed by "in genesis before the flood"), so no template matches either. Must
        // NOT be treated as scoped to Genesis with the rest silently ignored.
        assert!(parse_frequency_question("how many times is wickedness mentioned in Genesis before the flood").is_none());
    }

    #[test]
    fn copula_before_trailing_verb_does_not_swallow_into_the_phrase() {
        // Real query a user actually typed: "how many time is the word gold IS used" --
        // regression guard for the bug described on T1's definition above.
        let r = parse_frequency_question("how many time is the word gold is used").unwrap();
        assert_eq!(r.word, "gold");
        assert_eq!(r.scope, ParsedScope::WholeBible);
    }

    #[test]
    fn book_of_x_is_not_swallowed_by_the_bare_in_x_rule() {
        // Regression guard for rule ordering: "the book of john" is 3 words after "in", so
        // if the bare "in X" rule ran before the "book of X" rule, it could capture "book
        // of john" as a literal (wrong) book name instead of "john".
        let r = parse_frequency_question("how many times is love mentioned in the book of John").unwrap();
        assert_eq!(r.scope, ParsedScope::Book("john".to_string()));
    }
}
