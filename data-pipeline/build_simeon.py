"""Charles Simeon's sermon outlines (Horae Homileticae, 1832-33; public domain) for the sermon
builder's "How others outlined it".

    python data-pipeline/build_simeon.py <folder with vol01.txt .. vol21.txt>

The input is the 21 volumes' OCR text from the Internet Archive (`<id>_djvu.txt`; the
identifiers used are listed in HANDOVER). Each of the 2,536 discourses opens with its number
in Roman numerals, a title in capitals, and its text ("Luke xviii. 6-8. And the Lord
said ..."). The body states the theme ("We shall consider,"), then main heads ("I. What
the unjust judge said --") and points ("1. ..."), each followed by Simeon's working-out of
it in [square brackets]. The outline is the heads and points without the brackets: the
structure of the sermon, which is what a preacher can learn from -- never text to paste.

Writes src-tauri/resources/simeon_outlines.json: one entry per discourse with its number,
title, passage and outline, and prints how many were read and how well.
"""
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from refs import resolve_book  # noqa: E402

# not resolve(): that turns the mapped drive into its network path, which SQLite cannot open by URI
ROOT = Path(os.path.abspath(__file__)).parents[1]
OUT = ROOT / "src-tauri" / "resources" / "simeon_outlines.json"

ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}


def roman(s: str) -> int:
    s = s.upper().replace("J", "I")
    total, prev = 0, 0
    for ch in reversed(s):
        v = ROMAN.get(ch, 0)
        if v == 0:
            return 0
        total = total - v if v < prev else total + v
        prev = max(prev, v)
    return total


def clean(text: str) -> str:
    """OCR text: hyphenated line ends joined, runs of spaces made one, stray marks dropped."""
    # a word broken over two lines -- not a dash at a line's end before a new sentence ("end-\nSin")
    text = re.sub(r"(\w)-\s*\n\s*([a-z])", r"\1\2", text)
    text = text.replace("&amp;", "&").replace("&gt;", ">").replace("&lt;", "<")
    text = re.sub(r"[ \t]+", " ", text)
    return text


# "Luke xviii. 6-8." / "Lukexviii. 31 -- 34." / "Psalm cxix. 1, 2." / "1 Cor. xiii. 13."
REF = re.compile(
    r"^\s*((?:[1-3I]\s*)?[A-Z][a-zA-Z]+\.?(?:\s+of\s+Solomon)?)\s*([ivxlcdmIVXLCDMj]{1,9})\s*[.,]\s*(\d{1,3})(?:\s*[,.]?\s*(?:[—–\-]+|to)\s*(\d{1,3}))?"
)
HEAD = re.compile(r"^(I|II|III|IV|V|VI|VII|VIII|IX|X)\.\s+(\S.*)$")
POINT = re.compile(r"^([1-9])\.\s+(\S.*)$")
# running heads: "1557.] THE IMPORTUNATE WIDOW. 27" and "26 LUKE, XVIII. 6-8. [1557."
RUNNING = re.compile(r"^\s*(\d{2,4}\s*[.\]1lI|]*\s+[A-Z][A-Z ,;.'’\-]{3,}\s*\d{1,4}|\d{1,4}\s+[A-Z][A-Z ,;.]{2,}[\dIVXLC .,—\-]*\[\s*\d{2,4}.*)\s*$")


def book_of(raw: str) -> str | None:
    raw = raw.replace("I ", "1 ").strip(" .")
    fixes = {"Isai": "Isaiah", "Lam": "Lamentations", "Phil": "Philippians", "Philem": "Philemon", "Cant": "Song of Solomon", "Rev": "Revelation"}
    return resolve_book(fixes.get(raw, raw))


VOCAB: set[str] = set()


def build_vocab(texts: list[str]) -> None:
    """Words Simeon uses, from the scans themselves (those seen five times or more), for
    rejoining words the scan split ("u n regenerate", "re medy")."""
    from collections import Counter

    counts: Counter = Counter()
    for t in texts:
        counts.update(w.lower() for w in re.findall(r"[A-Za-z]{2,}", t))
    VOCAB.update(w for w, c in counts.items() if c >= 5)


def mend(text: str) -> str:
    """Rejoins words the scan split. Only pieces that are not words themselves are joined, and
    of the joins that make a real word, the one that mends the most broken pieces wins
    ("a re medy" -> "a remedy", not "are medy"; "of it" stays as it is)."""
    toks = text.split(" ")
    word = lambda t: re.fullmatch(r"[A-Za-z]+", t) is not None
    broken = lambda t: word(t) and t.lower() not in VOCAB
    while True:
        best = None
        for i in range(len(toks)):
            for k in (2, 3):
                parts = toks[i : i + k]
                if len(parts) < k or not all(word(p) for p in parts):
                    continue
                n_broken = sum(broken(p) for p in parts)
                if n_broken == 0 or "".join(parts).lower() not in VOCAB:
                    continue
                score = (n_broken, k)
                if best is None or score > best[0]:
                    best = (score, i, k)
        if best is None:
            return " ".join(toks)
        _, i, k = best
        toks[i : i + k] = ["".join(toks[i : i + k])]


def outline_of(body: str) -> tuple[list[dict], str]:
    """The heads and points of a discourse (outside Simeon's [working-out]), and the sentence
    that announces them."""
    lines = [l.rstrip() for l in body.split("\n")]
    out: list[dict] = []
    announce = ""
    depth = 0
    i = 0
    prev_blank = True
    while i < len(lines):
        line = lines[i].strip()
        if not line or RUNNING.match(line):
            prev_blank = not line or prev_blank
            i += 1
            continue
        head = HEAD.match(line)
        point = POINT.match(line)
        if head and (depth == 0 or prev_blank):
            depth = 0
            kind, text = 1, head.group(2)
        elif point and depth == 0:
            kind, text = 2, point.group(2)
        else:
            if depth == 0 and not out and re.search(r"\b(we shall|let us|we will|we propose|consider|observe|notice)\b", line, re.I) and line.endswith((",", ":", "—")) and len(line) < 90:
                announce = line.rstrip(",:— ")
            depth += line.count("[") - line.count("]")
            depth = max(0, depth)
            prev_blank = False
            i += 1
            continue
        # a head or point can run onto the next lines, up to its dash
        j = i + 1
        # (only onto a line that carries the same sentence on: one starting in lower case)
        while not re.search(r"[—\-]\s*$|[.?!:]\s*$", text) and j < len(lines) and re.match(r"^[a-z(]", lines[j].strip()) and j - i < 4:
            text += " " + lines[j].strip()
            j += 1
        text = re.sub(r"\s*[—\-]+\s*$", "", text).strip()
        text = re.sub(r"\s+", " ", text)
        # footnote marks the scan leaves on the last word ("prayer1", "themb")
        text = re.sub(r"(?<=[a-z])[0-9]\b", "", text)
        text = mend(text)
        if 3 <= len(text) <= 260:
            out.append({"level": kind, "text": text})
        depth = 0
        prev_blank = False
        i = j
    return out, announce


def parse_volume(text: str) -> list[dict]:
    text = clean(text)
    starts = [(m.start(), roman(m.group(1)), m.end()) for m in re.finditer(r"\n\s*([MDCLXVI]{1,12})\.\s*\n", text)]
    found = []
    last_n = 0
    for k, (pos, n, end) in enumerate(starts):
        # numbers rise through a volume; a jump means the scan misread one (the first can be anything)
        if n <= last_n or n > 2600 or (last_n and n - last_n > 60):
            continue
        stop = next((p for (p, m, _) in starts[k + 1 :] if m == n + 1 or (m > n and m - n < 4)), len(text))
        block = text[end:stop]
        lines = [l.strip() for l in block.split("\n")]
        # title: the capitals before the reference
        title_parts, ref, ref_line = [], None, -1
        for li, l in enumerate(lines[:14]):
            if not l:
                continue
            m = REF.match(l)
            if m and book_of(m.group(1)):
                ref, ref_line = m, li
                break
            if l.upper() == l and len(l) > 2:
                title_parts.append(l)
        if not ref:
            continue
        book = book_of(ref.group(1))
        chapter = roman(ref.group(2))
        verse = int(ref.group(3))
        verse_end = int(ref.group(4)) if ref.group(4) else verse
        if verse_end < verse or verse_end - verse > 60:
            verse_end = verse
        if not book or chapter == 0:
            continue
        body = "\n".join(lines[ref_line + 1 :])
        outline, announce = outline_of(body)
        title = re.sub(r"\s+", " ", " ".join(title_parts)).strip(" .")
        found.append(
            {
                "n": n,
                "title": re.sub(r"(?<=['’])S\b", "s", title.title()) if title else "",
                "book": book,
                "chapter": chapter,
                "verse": verse,
                "verse_end": verse_end,
                "announce": announce,
                "outline": outline,
            }
        )
        last_n = n
    return found


def main() -> None:
    src = Path(sys.argv[1])
    all_d: list[dict] = []
    texts = [(src / f"vol{v:02d}.txt").read_text(encoding="utf-8", errors="replace") for v in range(1, 22)]
    build_vocab(texts)
    for v in range(1, 22):
        got = parse_volume(texts[v - 1])
        all_d.extend(got)
        print(f"vol {v:2}: {len(got):4} discourses, {sum(1 for d in got if len(d['outline']) >= 2):4} with an outline, n {got[0]['n'] if got else '-'}..{got[-1]['n'] if got else '-'}")
    all_d.sort(key=lambda d: d["n"])
    dedup = {d["n"]: d for d in all_d}
    out = [d for d in dedup.values() if len(d["outline"]) >= 2]
    # drop passages the Bible doesn't have (a chapter number the scan misread)
    import sqlite3
    db = ROOT / "src-tauri" / "resources" / "bible.db"
    c = sqlite3.connect(f"file:{db.as_posix()}?mode=ro&immutable=1", uri=True)
    last = {(b, ch): m for b, ch, m in c.execute(
        "SELECT b.name, v.chapter, max(v.verse) FROM verses v JOIN books b ON b.id = v.book_id JOIN versions x ON x.id = v.version_id WHERE x.code = 'KJV' GROUP BY b.name, v.chapter")}
    bad = [d for d in out if d["verse"] > last.get((d["book"], d["chapter"]), 0)]
    out = [d for d in out if d not in bad]
    for d in out:
        d["verse_end"] = min(d["verse_end"], last[(d["book"], d["chapter"])])
    print(f"{len(bad)} dropped: their passage doesn't exist (a misread chapter or verse)")
    print(f"{len(dedup)} discourses read, {len(out)} with a usable outline (of 2,536)")
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{OUT} {OUT.stat().st_size / 1048576:.2f} MB")


if __name__ == "__main__":
    main()
