"""Minimal USFM 3.0 parser for eBible.org WEB text: pulls out (chapter, verse, plain_text,
[(surface, [strong_ids]), ...]) per verse. Good enough for WEB's marker set; not a general
USFM parser.
"""
import re

FOOTNOTE_RE = re.compile(r"\\f\s*\+?.*?\\f\*", re.DOTALL)
XREF_RE = re.compile(r"\\x\s*\+?.*?\\x\*", re.DOTALL)
WORD_STRONG_RE = re.compile(r"\\w\s+(.*?)\|strong=\"([^\"]+)\"\s*\\w\*", re.DOTALL)
WORD_PLAIN_RE = re.compile(r"\\w\s+(.*?)\\w\*", re.DOTALL)
STRONG_ID_RE = re.compile(r"(H|G)0*(\d+)")
# Any other backslash marker (with optional trailing *), e.g. \p \q1 \nd \nd* \add \add*
# (excludes \c and \v themselves, which TOKEN_RE still needs to find below)
OTHER_MARKER_RE = re.compile(r"\\(?!c\s|v\s)[+a-zA-Z][a-zA-Z0-9]*\*?")
TOKEN_RE = re.compile(r"\\c\s+(\d+)|\\v\s+(\d+)(?:-\d+)?")
WHITESPACE_RE = re.compile(r"[ \t\r\n]+")

_WORD_PLACEHOLDER_STORE: list[tuple[str, list[str]]] = []


def _stash_word_strong(m: re.Match) -> str:
    surface = re.sub(r"\\[a-zA-Z+]+\*?", "", m.group(1)).strip()
    strong_ids = [f"{l}{n.lstrip('0') or '0'}" for (l, n) in STRONG_ID_RE.findall(m.group(2))]
    idx = len(_WORD_PLACEHOLDER_STORE)
    _WORD_PLACEHOLDER_STORE.append((surface, strong_ids))
    return f"\uE000{idx}\uE000"


def _stash_word_plain(m: re.Match) -> str:
    surface = m.group(1).strip()
    idx = len(_WORD_PLACEHOLDER_STORE)
    _WORD_PLACEHOLDER_STORE.append((surface, []))
    return f"\uE000{idx}\uE000"


def parse_usfm_book(content: str):
    """Yields (chapter:int, verse:int, plain_text:str, words:[(surface,[strong_ids])])."""
    content = FOOTNOTE_RE.sub("", content)
    content = XREF_RE.sub("", content)

    _WORD_PLACEHOLDER_STORE.clear()
    content = WORD_STRONG_RE.sub(_stash_word_strong, content)
    content = WORD_PLAIN_RE.sub(_stash_word_plain, content)
    content = OTHER_MARKER_RE.sub(" ", content)

    chapter = 0
    verse = 0
    buf_text: list[str] = []
    buf_words: list[tuple[str, list[str]]] = []

    def flush():
        if verse > 0:
            text = "".join(buf_text)
            text = WHITESPACE_RE.sub(" ", text).strip()
            text = re.sub(r"\s+([.,;:!?\u2019\u201d])", r"\1", text)
            if text or buf_words:
                yield_item = (chapter, verse, text, list(buf_words))
                return yield_item
        return None

    pos = 0
    results = []
    last_end = 0
    for m in TOKEN_RE.finditer(content):
        # text before this token belongs to current verse
        segment = content[last_end:m.start()]
        if segment:
            for part in re.split(r"(\uE000\d+\uE000)", segment):
                if part.startswith("\uE000"):
                    idx = int(part[1:-1])
                    surface, strong_ids = _WORD_PLACEHOLDER_STORE[idx]
                    buf_text.append(surface + " ")
                    if strong_ids or surface:
                        buf_words.append((surface, strong_ids))
                elif part.strip():
                    buf_text.append(part)
        last_end = m.end()

        if m.group(1) is not None:  # \c N
            item = flush()
            if item:
                results.append(item)
            buf_text.clear()
            buf_words.clear()
            chapter = int(m.group(1))
            verse = 0
        elif m.group(2) is not None:  # \v N
            item = flush()
            if item:
                results.append(item)
            buf_text.clear()
            buf_words.clear()
            verse = int(m.group(2))

    # trailing segment after last token
    segment = content[last_end:]
    if segment:
        for part in re.split(r"(\uE000\d+\uE000)", segment):
            if part.startswith("\uE000"):
                idx = int(part[1:-1])
                surface, strong_ids = _WORD_PLACEHOLDER_STORE[idx]
                buf_text.append(surface + " ")
                if strong_ids or surface:
                    buf_words.append((surface, strong_ids))
            elif part.strip():
                buf_text.append(part)
    item = flush()
    if item:
        results.append(item)

    return results
