//! SWORD module markup (OSIS, ThML, GBF, TEI, or plain text) -> the plain text this app
//! stores everywhere else: paragraphs separated by "\n", scripture references as clickable
//! ⟦..⟧ markers (refs.rs). A Rust generalisation of the converters in
//! data-pipeline/build_study.py (`convert_body`) and add_sword_commentaries.py (`to_text`).

use std::sync::OnceLock;

use regex::{Captures, Regex};

use crate::refs::{self, Ref};

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

// ---------------------------------------------------------------- Strong's numbers in a Bible verse

/// A Strong's number in the app's form ("H7225", "G3588") from "H07225", "strong:G3588",
/// "G1254a" and the like; None for anything else.
pub fn strongs_number(tok: &str) -> Option<String> {
    let t = tok.trim();
    let t = match t.get(..7) {
        Some(p) if p.eq_ignore_ascii_case("strong:") => &t[7..],
        _ => t,
    };
    let mut chars = t.chars();
    let lang = chars.next()?.to_ascii_uppercase();
    if lang != 'H' && lang != 'G' {
        return None;
    }
    let rest = chars.as_str();
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    let tail = &rest[digits.len()..];
    if tail.len() > 1 || !tail.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    let n: u32 = digits.parse().ok()?;
    if n == 0 {
        return None;
    }
    Some(format!("{lang}{n}"))
}

/// The words a tag stands for, as the reader wants them: no punctuation or quotation marks at
/// either end, and at most the last four words when untagged words come before it.
fn tidy_surface(s: &str) -> String {
    let edge = |c: char| !c.is_alphanumeric();
    let words: Vec<&str> = s.trim_matches(edge).split_whitespace().collect();
    let from = words.len().saturating_sub(4);
    words[from..].join(" ").trim_matches(edge).to_string()
}

/// Words followed by their Strong's tags (GBF `<WH430>`, ThML `<sync type="Strongs" .../>`,
/// MyBible `<S>430</S>`): the words are the text since the previous tag, and a tag that comes
/// straight after another one adds its number to the same word. `number` reads a tag's
/// Strong's number; `clean` turns the markup between two tags into plain text.
pub fn words_from_tags(
    s: &str,
    tag: &Regex,
    number: impl Fn(&Captures) -> Option<String>,
    clean: impl Fn(&str) -> String,
) -> Vec<(String, Vec<String>)> {
    let mut out: Vec<(String, Vec<String>)> = Vec::new();
    let mut last = 0;
    for c in tag.captures_iter(s) {
        let m = c.get(0).expect("whole match");
        let start = m.start().max(last);
        let surface = tidy_surface(&clean(&s[last..start]));
        last = m.end();
        let Some(num) = number(&c) else { continue };
        if surface.is_empty() {
            if let Some(w) = out.last_mut() {
                if !w.1.contains(&num) {
                    w.1.push(num);
                }
            }
            continue;
        }
        out.push((surface, vec![num]));
    }
    out
}

/// The words of one Bible verse that carry Strong's numbers, in order, from a SWORD, e-Sword or
/// MySword verse's markup: OSIS `<w lemma="strong:H1234">word</w>`, GBF `word<WH1234>` or ThML
/// `word<sync type="Strongs" value="H1234"/>`. Numbers are in the app's form ("H1234").
/// Empty when the verse has none, so an untagged Bible stores nothing. The words are spelled as
/// `to_text` spells the verse, so the reader can find each one in the text.
pub fn strongs_words(raw: &str, source: &str) -> Vec<(String, Vec<String>)> {
    if !raw.contains("<w ") && !raw.contains("<W") && !raw.contains("<sync") {
        return Vec::new();
    }
    let mut s = raw.replace('\r', "");
    if !source.eq_ignore_ascii_case("Plaintext") {
        s = s.replace('\n', " ");
    }
    s = rx!(r"(?s)<note\b[^>]*/>").replace_all(&s, "").into_owned();
    s = rx!(r"(?s)<note\b[^>]*>.*?</note>").replace_all(&s, "").into_owned();
    s = rx!(r"(?s)<RF>.*?<Rf>").replace_all(&s, "").into_owned();
    // headings are not part of a Bible verse's text (Psalm titles are tagged in some modules)
    s = rx!(r"(?s)<title\b[^>]*/>").replace_all(&s, "").into_owned();
    s = rx!(r"(?s)<title\b[^>]*>.*?</title>").replace_all(&s, "").into_owned();
    s = rx!(r"(?s)<h[1-6]\b[^>]*>.*?</h[1-6]>").replace_all(&s, "").into_owned();
    s = rx!(r"(?s)<TS>.*?<Ts>").replace_all(&s, "").into_owned();
    // the divine name is written in capitals in the text ("DIEU", "LORD"), tagged words inside it too
    s = rx!(r"(?s)<divineName\b[^>]*>(.*?)</divineName>")
        .replace_all(&s, |c: &Captures| {
            let mut in_tag = false;
            c[1].chars()
                .map(|ch| match ch {
                    '<' => {
                        in_tag = true;
                        ch.to_string()
                    }
                    '>' => {
                        in_tag = false;
                        ch.to_string()
                    }
                    _ if in_tag => ch.to_string(),
                    _ => ch.to_uppercase().collect(),
                })
                .collect::<String>()
        })
        .into_owned();

    // OSIS: the tag wraps the word
    let mut out: Vec<(String, Vec<String>)> = Vec::new();
    for c in rx!(r"(?s)<w\b([^>]*)>(.*?)</w>").captures_iter(&s) {
        let mut nums: Vec<String> = Vec::new();
        for n in attr(&c[1], "lemma").unwrap_or("").split_whitespace().filter_map(strongs_number) {
            if !nums.contains(&n) {
                nums.push(n);
            }
        }
        let surface = tidy_surface(&to_text(&c[2], source, Kind::Bible));
        if !nums.is_empty() && !surface.is_empty() {
            out.push((surface, nums));
        }
    }
    if !out.is_empty() {
        return out;
    }

    // GBF, e-Sword, MySword and ThML: the tag follows the word
    words_from_tags(
        &s,
        rx!(r#"(?i)<W([HG])(\d+)([a-z]?)>|<sync\b[^>]*\btype\s*=\s*["']Strongs["'][^>]*\bvalue\s*=\s*["']([HG]\d+[a-z]?)["'][^>]*/?>"#),
        |c| match c.get(1) {
            Some(lang) => strongs_number(&format!("{}{}", lang.as_str(), &c[2])),
            None => c.get(4).and_then(|v| strongs_number(v.as_str())),
        },
        |span| to_text(span, source, Kind::Bible),
    )
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

    fn w(s: &str, n: &[&str]) -> (String, Vec<String>) {
        (s.to_string(), n.iter().map(|x| x.to_string()).collect())
    }

    #[test]
    fn strongs_numbers_in_the_apps_form() {
        for (raw, want) in [("H07225", Some("H7225")), ("strong:G3588", Some("G3588")), ("Strong:g0025", Some("G25")), ("G1254a", Some("G1254")), ("H0", None), ("lemma:abc", None), ("G12ab", None), ("430", None), ("", None), ("é", None)] {
            assert_eq!(strongs_number(raw).as_deref(), want, "{raw}");
        }
    }

    #[test]
    fn strongs_words_from_osis() {
        let raw = r#"<w lemma="strong:H07225" morph="x">In the beginning</w> <w lemma="strong:H0430">God</w> <w lemma="strong:H0853 strong:H01254 lemma:x">created</w> the <w lemma="strong:H03068"><seg><divineName>Lord</divineName></seg></w>, <w lemma="lemma.TR:x">untagged</w><note type="x-strongsMarkup">x</note>"#;
        let got = strongs_words(raw, "OSIS");
        assert_eq!(got, vec![w("In the beginning", &["H7225"]), w("God", &["H430"]), w("created", &["H853", "H1254"]), w("LORD", &["H3068"])]);
        // the words are spelled as the verse text is, so the reader can find them there
        let text = to_text(raw, "OSIS", Kind::Bible);
        for (surface, _) in &got {
            assert!(text.contains(surface.as_str()), "{surface} not in {text}");
        }
    }

    #[test]
    fn strongs_words_from_gbf_and_mysword() {
        let raw = "In the beginning<WH07225> God<WH0430> created<WH0853><WH01254> the heaven<WH08064> and the earth<WH0776>.<CM>";
        assert_eq!(
            strongs_words(raw, "GBF"),
            vec![w("In the beginning", &["H7225"]), w("God", &["H430"]), w("created", &["H853", "H1254"]), w("the heaven", &["H8064"]), w("and the earth", &["H776"])]
        );
        // morphology tags and Greek numbers
        assert_eq!(strongs_words("For<WG1063> God<WG2316><WTG5651> so<WG3779>", "GBF"), vec![w("For", &["G1063"]), w("God", &["G2316"]), w("so", &["G3779"])]);
        // more than four words before a tag: only the last four, and no punctuation at the ends
        assert_eq!(strongs_words("one two three four five, six<WG1>", "GBF"), vec![w("three four five, six", &["G1"])]);
    }

    #[test]
    fn strongs_words_from_thml_and_untagged() {
        let raw = r#"In the beginning<sync type="Strongs" value="H7225" /> God<sync type="Strongs" value="H0430"/> made<sync type="lemma" value="x"/>"#;
        assert_eq!(strongs_words(raw, "ThML"), vec![w("In the beginning", &["H7225"]), w("God", &["H430"])]);
        assert!(strongs_words("In the beginning God created", "GBF").is_empty());
        assert!(strongs_words("<w>no lemma</w>", "OSIS").is_empty());
        assert!(strongs_words("", "OSIS").is_empty());
    }

    #[test]
    fn strongs_words_follow_the_text_of_the_verse() {
        // the divine name in capitals, whether the tag is inside or outside it; a tagged heading is not part of the text
        let raw = r#"<title><w lemma="strong:H04210">A Psalm</w></title>Au commencement <divineName><w lemma="strong:H0430">Dieu</w></divineName> <w lemma="strong:H01254">créa</w>, <w lemma="strong:H0136">the <divineName>Lord</divineName></w>"#;
        let got = strongs_words(raw, "OSIS");
        assert_eq!(got, vec![w("DIEU", &["H430"]), w("créa", &["H1254"]), w("the LORD", &["H136"])]);
        let text = to_text(raw, "OSIS", Kind::Bible);
        for (surface, _) in &got {
            assert!(text.contains(surface.as_str()), "{surface} not in {text}");
        }
    }
}
