"""Builds src/redLetter.json: which words of each verse are the words of
Jesus ("red letter" text), per translation.

Only two of our sources mark them:
  * KJV (scrollmapper OSIS JSON): <q who="Jesus">...</q>, always opened and closed inside
    one verse (2,035 spans); each KJV word also carries src="n", the position of the Greek
    word it translates in the Textus Receptus.
  * WEB (eBible.org USFM): \\wj ... \\wj*.
Every other translation gets the marking transferred word-by-word from the closest
marked text (difflib alignment of normalized words):
  KJV, ASV, YLT <- KJV      WEB, BSB <- WEB (then fitted to the BSB's own quotation marks,
  see snap_to_quotes)
  TR (Greek)    <- KJV's src positions     THGNT <- TR, by aligning the Greek words.

Positions are stored as *word indices*, not character offsets, because the reader tidies
punctuation spacing before display (verseSegments.ts tidyPunctuation) -- a word is a
maximal run of letters/digits, the same rule the frontend uses (redLetter.ts).
Output: {"BSB": {"Matthew": {"3": {"15": [[3, 20]]}}}} with inclusive [first, last] word
ranges.

Reads bible.db read-only (no SQLite writes, so the SMB gotcha does not apply); writes
plain JSON. Re-run after rebuilding bible.db.
"""
import json
import re
import sqlite3
import sys
import unicodedata
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from books import BY_USFM, normalize_book_name  # noqa: E402
from osis_extract import extract_plain_text  # noqa: E402
from usfm_extract import parse_usfm_book  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
SOURCES = Path(__file__).parent / "sources"
DB = ROOT / "src-tauri" / "resources" / "bible.db"
OUT = ROOT / "src" / "redLetter.json"  # loaded lazily by the frontend (redLetter.ts)

OPEN, CLOSE = "\uE010", "\uE011"
TOKEN_RE = re.compile(r"[^\W_]+|[" + OPEN + CLOSE + "]")
QUOTE_CHARS = "“”"


def words(text: str) -> list[str]:
    return [t for t in TOKEN_RE.findall(text) if t not in (OPEN, CLOSE)]


def word_spans(text: str) -> list[tuple[int, int]]:
    return [(m.start(), m.end()) for m in re.finditer(r"[^\W_]+", text)]


def norm(w: str) -> str:
    w = unicodedata.normalize("NFD", w.lower())
    w = "".join(c for c in w if unicodedata.category(c) != "Mn")
    return w.replace("ς", "σ")


def flagged_words(text: str) -> list[tuple[str, bool]]:
    """Words of a sentinel-marked text with whether each is inside OPEN..CLOSE."""
    out, red = [], False
    for t in TOKEN_RE.findall(text):
        if t == OPEN:
            red = True
        elif t == CLOSE:
            red = False
        else:
            out.append((t, red))
    return out


def ranges(flags: list[bool]) -> list[list[int]]:
    out, start = [], None
    for i, f in enumerate(flags + [False]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            out.append([start, i - 1])
            start = None
    return out


def transfer(ref: list[tuple[str, bool]], target: list[str]) -> list[bool]:
    """Red flags for `target` words, aligned against the flagged reference words."""
    if all(r for _, r in ref):
        return [True] * len(target)  # the whole verse is His words, however it's worded
    a = [norm(w) for w, _ in ref]
    b = [norm(w) for w in target]
    out: list[bool | None] = [None] * len(b)
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            for k in range(j2 - j1):
                out[j1 + k] = ref[i1 + k][1]
        elif tag == "replace" and max(i2 - i1, j2 - j1) <= 2 * min(i2 - i1, j2 - j1):
            # a reworded stretch of similar length; very uneven ones (a textual variant
            # present in only one text) are left unmapped
            for k in range(j1, j2):
                out[k] = ref[i1 + (k - j1) * (i2 - i1) // (j2 - j1)][1]
    # words with no counterpart are red only between two red neighbours; at a red/black
    # boundary or the verse's edge they stay black (usually "He replied"-type narration)
    known = [i for i, f in enumerate(out) if f is not None]
    for i, f in enumerate(out):
        if f is not None:
            continue
        prev = next((out[j] for j in reversed(known) if j < i), None)
        nxt = next((out[j] for j in known if j > i), None)
        out[i] = bool(prev and nxt)
    return [bool(f) for f in out]


def quote_segments(text: str) -> list[tuple[int, bool]] | None:
    """Per word: (segment number, inside double quotes?), or None if the verse has no
    double quotation marks. A verse whose first mark is a closing ” began mid-quote."""
    cuts = [(i, c) for i, c in enumerate(text) if c in QUOTE_CHARS]
    if not cuts:
        return None
    out = []
    for s, _ in word_spans(text):
        before = [c for i, c in cuts if i < s]
        inside = (before[-1] == "“") if before else (cuts[0][1] == "”")
        out.append((len(before), inside))
    return out


def seg_votes(segs: list[tuple[int, bool]], flags: list[bool]) -> dict[int, bool]:
    """Quoted segment -> red if at least 70% of its words are (a quote that is only
    partly red is someone else repeating His words, so it doesn't count as His)."""
    votes: dict[int, list[bool]] = defaultdict(list)
    for (seg, inside), f in zip(segs, flags):
        if inside:
            votes[seg].append(f)
    return {s: sum(v) >= 0.7 * len(v) for s, v in votes.items()}


def single_quoted(text: str) -> list[bool]:
    """Per word: inside ‘…’ (a quotation within a quotation)? A ’ between two letters is
    an apostrophe, not a closing mark."""
    marks = [(i, c) for i, c in enumerate(text) if c == "‘" or (c == "’" and not (text[i - 1 : i].isalpha() and text[i + 1 : i + 2].isalpha()))]
    out = []
    for s, _ in word_spans(text):
        before = [c for i, c in marks if i < s]
        out.append(bool(before) and before[-1] == "‘")
    return out


def snap_to_quotes(text: str, flags: list[bool], ref_text: str, ref_flags: list[bool]) -> list[bool]:
    """For a partly-red verse: narration outside quotation marks is never red. Inside
    them, if the reference quotes nobody but Jesus in this verse, every quote is His.
    Otherwise each quote goes red or black as a whole when its aligned words clearly
    agree; a quote that is only partly His is someone else repeating His words -- then
    just the ‘inner quotation’ is red."""
    if not any(ref_flags) or all(ref_flags):
        return flags
    segs = quote_segments(text)
    if segs is None:
        share = sum(flags) / max(1, len(flags))
        return [True] * len(flags) if share >= 0.7 else [False] * len(flags) if share <= 0.3 else flags
    ref_segs = quote_segments(ref_text)
    only_jesus = ref_segs is not None and len(ref_segs) == len(ref_flags) and all(seg_votes(ref_segs, ref_flags).values())
    inner = single_quoted(text)
    by_seg: dict[int, list[int]] = defaultdict(list)
    for i, (seg, inside) in enumerate(segs):
        if inside:
            by_seg[seg].append(i)
    out = [False] * len(flags)
    for seg, idx in by_seg.items():
        share = sum(flags[i] for i in idx) / len(idx)
        quoted = [i for i in idx if inner[i]]
        outer = [i for i in idx if not inner[i]]
        if not only_jesus and quoted and outer and sum(flags[i] for i in outer) <= 0.3 * len(outer):
            red = {i: True for i in quoted}  # others repeating His words: just the inner quote
        elif only_jesus or share >= 0.7:
            red = {i: True for i in idx}
        elif share <= 0.3:
            red = {}
        else:
            quoted = [i for i in idx if inner[i]]
            red = {i: True for i in quoted} if quoted else {i: flags[i] for i in idx}
        for i, r in red.items():
            out[i] = r
    return out


# ---------------------------------------------------------------- the two marked sources

def kjv_reference():
    """{(book, ch, v): (flagged words, {TR word index: red})}"""
    data = json.load(open(SOURCES / "KJV-osis.json", encoding="utf-8"))
    out = {}
    for b in data["books"]:
        book = normalize_book_name(b["name"])
        for c in b["chapters"]:
            for v in c["verses"]:
                frag = v["text"]
                if "who=\"Jesus\"" not in frag:
                    continue
                marked = re.sub(r"<q\b[^>]*who=\"Jesus\"[^>]*>", f" {OPEN} ", frag).replace("</q>", f" {CLOSE} ")
                flagged = flagged_words(extract_plain_text(marked))
                # TR positions: src on <w> tags, red if the tag is inside the quote
                src_red: dict[int, bool] = {}
                red = False
                for m in re.finditer(r"<q\b[^>]*who=\"Jesus\"[^>]*>|</q>|<w\b[^>]*\bsrc=\"([\d ]+)\"", frag):
                    tok = m.group(0)
                    if tok.startswith("<q"):
                        red = True
                    elif tok == "</q>":
                        red = False
                    else:
                        for n in m.group(1).split():
                            src_red[int(n) - 1] = src_red.get(int(n) - 1, False) or red
                out[(book, c["chapter"], v["verse"])] = (flagged, src_red)
    return out


def web_reference():
    out = {}
    for f in sorted((SOURCES / "web" / "extracted").glob("*.usfm")):
        content = f.read_text(encoding="utf-8")
        m = re.search(r"\\id\s+([A-Z0-9]{3})", content)
        book = BY_USFM.get(m.group(1)) if m else None
        if not book or "\\wj" not in content:
            continue
        content = content.replace("\\wj*", f" {CLOSE} ").replace("\\+wj*", f" {CLOSE} ")
        content = re.sub(r"\\\+?wj\s", f" {OPEN} ", content)
        state = False  # a \wj span can run on across verses (it closes at \wj*)
        for ch, v, text, _ in parse_usfm_book(content):
            if OPEN not in text and CLOSE not in text and not state:
                continue
            flagged, red = [], state
            for t in TOKEN_RE.findall(text):
                if t == OPEN:
                    red = True
                elif t == CLOSE:
                    red = False
                else:
                    flagged.append((t, red))
            state = red
            if any(r for _, r in flagged):
                out[(book, ch, v)] = flagged
    return out


def main():
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)

    def db_verses(code):
        rows = con.execute(
            "SELECT b.name, v.chapter, v.verse, v.text FROM verses v JOIN books b ON b.id = v.book_id "
            "JOIN versions ver ON ver.id = v.version_id WHERE ver.code = ?",
            (code,),
        )
        return {(b, c, v): t for b, c, v, t in rows}

    kjv = kjv_reference()
    web = web_reference()
    web_texts = db_verses("WEB")
    print(f"references: KJV {len(kjv)} verses, WEB {len(web)} verses with words of Jesus")
    result: dict = {}
    report = {}

    def put(code, key, flags):
        rs = ranges(flags)
        if rs:
            b, c, v = key
            result.setdefault(code, {}).setdefault(b, {}).setdefault(str(c), {})[str(v)] = rs

    # English texts
    plan = [("KJV", "kjv"), ("ASV", "kjv"), ("YLT", "kjv"), ("WEB", "web"), ("BSB", "web")]
    for code, source in plan:
        texts = db_verses(code)
        ref = {k: fw for k, (fw, _) in kjv.items()} if source == "kjv" else web
        exact = n = 0
        for key, fw in ref.items():
            text = texts.get(key)
            if not text:
                continue
            tw = words(text)
            if [w for w, _ in fw] == tw:
                flags = [r for _, r in fw]
                exact += 1
            else:
                flags = transfer(fw, tw)
                if code == "BSB":
                    flags = snap_to_quotes(text, flags, web_texts.get(key, ""), [r for _, r in fw])
            put(code, key, flags)
            n += 1
        report[code] = f"{n} verses ({exact} with identical wording to the reference)"

    # Greek: TR from the KJV's src positions, THGNT aligned to TR
    tr_texts, thgnt_texts = db_verses("TR"), db_verses("THGNT")
    tr_flags = {}
    for key, (_, src_red) in kjv.items():
        text = tr_texts.get(key)
        if not text or not any(src_red.values()):
            continue
        n = len(words(text))
        known = {i: r for i, r in src_red.items() if i < n}
        flags = [known.get(i) for i in range(n)]
        # Greek words the KJV left untranslated (particles, articles) follow their neighbours
        for i in range(n):
            if flags[i] is None:
                prev = next((flags[j] for j in range(i - 1, -1, -1) if flags[j] is not None), None)
                nxt = next((known[j] for j in range(i + 1, n) if j in known), None)
                flags[i] = bool(prev) if nxt is None else bool(nxt) if prev is None else (prev and nxt)
        tr_flags[key] = list(zip(words(text), flags))
        put("TR", key, flags)
    report["TR"] = f"{len(tr_flags)} verses"
    m = 0
    for key, fw in tr_flags.items():
        text = thgnt_texts.get(key)
        if text:
            put("THGNT", key, transfer(fw, words(text)))
            m += 1
    report["THGNT"] = f"{m} verses"

    OUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for k, v in report.items():
        print(f"  {k}: {v}")
    print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")

    # the BSB verses whose red share differs most from the WEB's, for a human to eyeball
    bsb = db_verses("BSB")
    diffs = []
    for key, fw in web.items():
        if key not in bsb:
            continue  # verses the BSB omits (e.g. Matthew 17:21)
        rs =result.get("BSB", {}).get(key[0], {}).get(str(key[1]), {}).get(str(key[2]), [])
        n = len(words(bsb.get(key, ""))) or 1
        share = sum(b - a + 1 for a, b in rs) / n
        diffs.append((abs(share - sum(r for _, r in fw) / len(fw)), key))
    diffs.sort(reverse=True)
    print("largest BSB/WEB disagreements:", [(f"{k[0]} {k[1]}:{k[2]}", round(d, 2)) for d, k in diffs[:12]])

    # spot checks
    for code in ["KJV", "BSB", "WEB", "ASV", "TR"]:
        texts = db_verses(code)
        for key in [("Matthew", 26, 25), ("John", 3, 16), ("Matthew", 4, 4), ("Luke", 23, 34), ("Acts", 9, 5)]:
            text = texts.get(key)
            rs = result.get(code, {}).get(key[0], {}).get(str(key[1]), {}).get(str(key[2]), [])
            if not text:
                continue
            spans = word_spans(text)
            shown = "".join(
                (("[" if any(i == a for a, _ in rs) else "") + text[s:e] + ("]" if any(i == b for _, b in rs) else "") + text[e : spans[i + 1][0] if i + 1 < len(spans) else len(text)])
                for i, (s, e) in enumerate(spans)
            )
            print(f"{code} {key[0]} {key[1]}:{key[2]}: {shown}")


if __name__ == "__main__":
    main()
