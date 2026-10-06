//! SWORD module markup (OSIS, ThML, GBF, TEI, or plain text) -> the plain text this app
//! stores everywhere else: paragraphs separated by "\n", scripture references as clickable
//! ⟦..⟧ markers (refs.rs). A Rust generalisation of the converters in
//! data-pipeline/build_study.py (`convert_body`) and add_sword_commentaries.py (`to_text`).

use std::sync::OnceLock;

use regex::{Captures, Regex};

use super::refs::{self, Ref};

/// What the text is for, which decides what survives the conversion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// A Bible verse: one line, no headings, notes or link markers (the reader adds its own
    /// verse formatting, red letters and Strong's links on top of plain text).
    Bible,
    /// Commentary notes: paragraphs, headings kept, references linked.
    Commentary,
    /// Dictionary entries: like a commentary, but a leading title (the headword again) dropped.
    Dictionary,
    /// Book sections: like a commentary.
    Book,
}

fn re(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).expect("valid regex"))
}

macro_rules! rx {
    ($pat:expr) => {{
        static CELL: OnceLock<Regex> = OnceLock::new();
        re(&CELL, $pat)
    }};
}

fn attr<'a>(attrs: &'a str, name: &str) -> Option<&'a str> {
    let i = attrs.find(&format!("{name}="))?;
    let rest = &attrs[i + name.len() + 1..];
    let quote = rest.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let rest = &rest[1..];
    Some(&rest[..rest.find(quote)?])
}

fn strip_tags(s: &str) -> String {
    rx!(r"<[^>]*>").replace_all(s, "").into_owned()
}

fn link(refs: &[Ref], inner: &str, keep_inner_label: bool) -> String {
    match refs.len() {
        0 => inner.to_string(),
        1 => refs[0].marker(keep_inner_label.then_some(inner)),
        _ => refs.iter().map(|r| r.marker(None)).collect::<Vec<_>>().join("; "),
    }
}

/// HTML/XML character references and the named entities these modules use.
pub fn unescape(s: &str) -> String {
    rx!(r"&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);")
        .replace_all(s, |c: &Captures| {
            let e = &c[1];
            let ch = if let Some(hex) = e.strip_prefix("#x") {
                u32::from_str_radix(hex, 16).ok().and_then(char::from_u32)
            } else if let Some(dec) = e.strip_prefix('#') {
                dec.parse().ok().and_then(char::from_u32)
            } else {
                Some(match e {
                    "amp" => '&',
                    "lt" => '<',
                    "gt" => '>',
                    "quot" => '"',
                    "apos" => '\'',
                    "nbsp" => ' ',
                    "mdash" => '—',
                    "ndash" => '–',
                    "lsquo" => '‘',
                    "rsquo" => '’',
                    "ldquo" => '“',
                    "rdquo" => '”',
                    "hellip" => '…',
                    "middot" => '·',
                    "copy" => '©',
                    "sect" => '§',
                    "para" => '¶',
                    "dagger" => '†',
                    "deg" => '°',
                    "frac12" => '½',
                    "frac14" => '¼',
                    "frac34" => '¾',
                    "eacute" => 'é',
                    "egrave" => 'è',
                    "ecirc" => 'ê',
                    "euml" => 'ë',
                    "aacute" => 'á',
                    "agrave" => 'à',
                    "acirc" => 'â',
                    "auml" => 'ä',
                    "iuml" => 'ï',
                    "icirc" => 'î',
                    "ouml" => 'ö',
                    "ocirc" => 'ô',
                    "uuml" => 'ü',
                    "ucirc" => 'û',
                    "ccedil" => 'ç',
                    "ntilde" => 'ñ',
                    "aelig" => 'æ',
                    "oelig" => 'œ',
                    "szlig" => 'ß',
                    _ => return c[0].to_string(),
                })
            };
            ch.map(String::from).unwrap_or_else(|| c[0].to_string())
        })
        .into_owned()
}

/// Converts one entry's markup to app text. `source` is the module's SourceType (OSIS,
/// ThML, GBF, TEI, Plaintext; empty = guess from the markup).
pub fn to_text(raw: &str, source: &str, kind: Kind) -> String {
    let bible = kind == Kind::Bible;
    let mut s = raw.replace('\r', "");
    // In OSIS, ThML, TEI and GBF a line break in the source is just a space (paragraphs
    // come from tags); only plain-text modules mean their line breaks.
    if !source.eq_ignore_ascii_case("Plaintext") {
        s = s.replace('\n', " ");
    }

    // --- notes and apparatus: footnotes, cross-reference notes, Strong's/morph tags
    s = rx!(r"(?s)<note\b[^>]*/>").replace_all(&s, "").into_owned();
    s = rx!(r"(?s)<note\b[^>]*>.*?</note>").replace_all(&s, "").into_owned();
    s = rx!(r"(?s)<RF>.*?<Rf>").replace_all(&s, "").into_owned(); // GBF footnote
    // Greek written in Latin "beta code" (ajgapavw) beside the real Greek: drop it
    s = rx!(r#"(?s)<orth\b[^>]*type="writing"[^>]*>.*?</orth>"#).replace_all(&s, "").into_owned();
    // OSIS may carry quotation marks as attributes of <q> milestones instead of in the text
    s = rx!(r#"<q\b[^>]*\bmarker="([^"]*)"[^>]*>"#).replace_all(&s, "$1").into_owned();

    // --- headings
    let heading = |c: &Captures| if bible || (kind == Kind::Dictionary) { String::new() } else { format!("\n\n{}\n", strip_tags(&c[1]).trim()) };
    s = rx!(r"(?s)<title\b[^>]*/>").replace_all(&s, "").into_owned();
    s = rx!(r"(?s)<title\b[^>]*>(.*?)</title>").replace_all(&s, heading).into_owned();
    s = rx!(r"(?s)<h[1-6]\b[^>]*>(.*?)</h[1-6]>").replace_all(&s, heading).into_owned();
    s = rx!(r"(?s)<TS>(.*?)<Ts>").replace_all(&s, heading).into_owned(); // GBF title

    // --- divine name in small capitals: "LORD"
    s = rx!(r"(?s)<divineName\b[^>]*>(.*?)</divineName>").replace_all(&s, |c: &Captures| strip_tags(&c[1]).to_uppercase()).into_owned();

    // --- scripture references
    s = rx!(r#"(?s)<(?:reference|ref)\b([^>]*)>(.*?)</(?:reference|ref)>"#)
        .replace_all(&s, |c: &Captures| {
            let inner = unescape(&strip_tags(&c[2]));
            if bible {
                return inner;
            }
            let target = attr(&c[1], "osisRef").or_else(|| attr(&c[1], "target")).unwrap_or("");
            let mut found = refs::parse_osis(target);
            if found.is_empty() {
                found = refs::parse_text(&inner, None);
            }
            link(&found, &inner, true)
        })
        .into_owned();
    s = rx!(r"(?s)<scripRef\b([^>]*)>(.*?)</scripRef>")
        .replace_all(&s, |c: &Captures| {
            let inner = unescape(&strip_tags(&c[2])).replace('\u{a0}', " ");
            if bible {
                return inner;
            }
            let passage = attr(&c[1], "passage");
            let found = refs::parse_text(passage.unwrap_or(&inner), None);
            link(&found, &inner, passage.is_some())
        })
        .into_owned();

    // --- line and paragraph structure
    let br = if bible { " " } else { "\n" };
    s = rx!(r"(?i)<li\b[^>]*>").replace_all(&s, if bible { " " } else { "\n• " }).into_owned();
    s = rx!(r"(?i)<item\b[^>]*>").replace_all(&s, if bible { " " } else { "\n• " }).into_owned();
    s = rx!(r#"(?i)<(?:/?p|/?div\d?|br|lb|/l|/lg|/item|/list|/ul|/ol|/sense|/def|/entryFree|CM|CL|milestone\b[^>]*type="x-p")\b[^>]*>"#)
        .replace_all(&s, br)
        .into_owned();
    s = rx!(r#"(?i)<(?:p|div|chapter)\b[^>]*\beID="[^"]*"[^>]*/>"#).replace_all(&s, br).into_owned();
    if bible {
        s = s.replace('\n', " ");
    }

    // --- everything else is formatting: keep the text, drop the tags
    s = strip_tags(&s);
    s = unescape(&s).replace('\u{a0}', " ");
    s = rx!(r"[ \t]+").replace_all(&s, " ").into_owned();
    if bible {
        s = rx!(r"\s+([,.;:!?])").replace_all(&s, "$1").into_owned();
        return s.trim().to_string();
    }
    s = rx!(r" *\n *").replace_all(&s, "\n").into_owned();
    s = rx!(r"\n{3,}").replace_all(&s, "\n\n").into_owned();
    s.trim().to_string()
}

/// A readable headword for a dictionary key ("AARON" -> "Aaron", "SON OF MAN" -> "Son of
/// Man"); keys that already have lower case are kept as they are.
pub fn headword(key: &str) -> String {
    let key = key.trim();
    if key.chars().any(|c| c.is_lowercase()) || !key.chars().any(|c| c.is_alphabetic()) {
        return key.to_string();
    }
    const SMALL: [&str; 15] = ["of", "the", "and", "or", "in", "to", "a", "an", "as", "by", "for", "on", "at", "with", "from"];
    key.to_lowercase()
        .split(' ')
        .enumerate()
        .map(|(i, w)| {
            if i > 0 && SMALL.contains(&w) {
                w.to_string()
            } else {
                let mut c = w.chars();
                c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn osis_verse() {
        let raw = r#"<w lemma="strong:G3779">For</w> God so <q who="Jesus">loved</q> the world<note type="x-strongsMarkup">x</note>, <transChange type="added">that</transChange> he gave"#;
        assert_eq!(to_text(raw, "OSIS", Kind::Bible), "For God so loved the world, that he gave");
        assert_eq!(to_text("the <divineName>Lord</divineName> said", "OSIS", Kind::Bible), "the LORD said");
    }

    #[test]
    fn thml_commentary_links() {
        let raw = r#"<p>See <scripRef passage="Ge 1:1">Genesis 1:1</scripRef> and <scripRef>Joh 3:16; 4:2</scripRef>.</p><p>Next</p>"#;
        let t = to_text(raw, "ThML", Kind::Commentary);
        assert!(t.contains("⟦Genesis|1|1||Genesis 1:1⟧"), "{t}");
        assert!(t.contains("⟦John|3|16||John 3:16⟧; ⟦John|4|2||John 4:2⟧"), "{t}");
        assert!(t.ends_with("\nNext"), "{t}");
    }

    #[test]
    fn tei_dictionary() {
        let raw = r#"<entryFree n="AARON"><title>AARON</title><sense>The brother of Moses (<ref osisRef="Exod.4.14">Ex 4:14</ref>).</sense></entryFree>"#;
        assert_eq!(to_text(raw, "TEI", Kind::Dictionary), "The brother of Moses (⟦Exodus|4|14||Ex 4:14⟧).");
        assert_eq!(headword("SON OF MAN"), "Son of Man");
        assert_eq!(unescape("a&amp;b &#8212; &mdash;"), "a&b — —");
    }

    #[test]
    fn gbf() {
        assert_eq!(to_text("In the <FI>beginning<Fi><RF>note<Rf> God<WH430>.<CM>", "GBF", Kind::Bible), "In the beginning God.");
    }
}
