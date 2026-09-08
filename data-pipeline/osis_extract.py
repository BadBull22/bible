"""Extract plain text + Strong's-tagged words from a scrollmapper OSIS-JSON verse fragment.

The verse "text" field is an inline, not-quite-well-formed XML fragment (self-closing
milestones, <w> tags with lemma/morph attributes, <note>/<title> apparatus, <transChange>
supplied words). We don't need a full XML parser -- just:
  1. pull every <w ...>...</w> or <w .../> tag out for Strong's-number linking, and
  2. strip <note>...</note> and <title>...</title> blocks entirely (footnotes/headings,
     not reading text), then strip all remaining tags to get clean plain text.
"""
import re
import html

STRONG_NUM_RE = re.compile(r"strong[.:]?[A-Za-z]*:?(H|G)0*(\d+)")
W_TAG_RE = re.compile(r"<w\b([^>]*?)(?:/>|>(.*?)</w>)", re.DOTALL)
ATTR_RE = re.compile(r'(\w[\w-]*)\s*=\s*"([^"]*)"')
NOTE_OR_TITLE_RE = re.compile(r"<(note|title)\b[^>]*>.*?</\1>", re.DOTALL)
ANY_TAG_RE = re.compile(r"<[^>]+>")
WHITESPACE_RE = re.compile(r"[ \t]+")


def extract_strongs_words(fragment: str) -> list[tuple[str, list[str]]]:
    """Returns [(surface_text, [strong_ids...]), ...] in reading order, surface_text may be ''."""
    out = []
    for m in W_TAG_RE.finditer(fragment):
        attrs_raw, inner = m.group(1), m.group(2)
        attrs = dict(ATTR_RE.findall(attrs_raw))
        lemma = attrs.get("lemma", "")
        strong_ids = [f"{letter}{num.lstrip('0') or '0'}" for (letter, num) in STRONG_NUM_RE.findall(lemma)]
        if not strong_ids:
            continue
        surface = ""
        if inner:
            surface = html.unescape(ANY_TAG_RE.sub(" ", inner))
            surface = WHITESPACE_RE.sub(" ", surface).strip()
        out.append((surface, strong_ids))
    return out


def extract_plain_text(fragment: str) -> str:
    no_apparatus = NOTE_OR_TITLE_RE.sub(" ", fragment)
    no_tags = ANY_TAG_RE.sub(" ", no_apparatus)
    text = html.unescape(no_tags)
    text = WHITESPACE_RE.sub(" ", text).strip()
    # collapse " ." / " ," etc left behind by stripped inline apparatus
    text = re.sub(r"\s+([.,;:!?])", r"\1", text)
    return text
