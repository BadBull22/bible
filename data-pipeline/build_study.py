"""Build src-tauri/resources/study.db: interlinear word data with grammar, morphology-code
expansions, and four public-domain Bible dictionaries with a verse -> entry index.

Inputs (downloaded into %LOCALAPPDATA%/bible-concordance-build/study-src by
download_study_sources(); nothing is committed to git):
  * STEPBible TAGNT (Greek NT) and TAHOT (Hebrew OT), CC BY 4.0, Tyndale House Cambridge
  * STEPBible TEGMC / TEHMC morphology-code expansions, CC BY 4.0
  * CrossWire SWORD modules Easton, Smith, Nave, Torrey -- all public domain

Like build_db.py, the database is built on LOCAL disk and only then copied onto the project
share: SQLite's random-write pattern silently corrupts files over SMB (HANDOVER gotcha #1).

    python build_study.py            # download (if missing) + build + copy into resources/
"""

import html
import os
import re
import shutil
import sqlite3
import sys
import unicodedata
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from refs import ORDER, STEP, marker, parse_osis_ref, parse_ref_list  # noqa: E402
from sword_lexdict import read_module  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src-tauri" / "resources" / "study.db"
WORK = Path(os.environ.get("LOCALAPPDATA", ROOT)) / "bible-concordance-build"
SRC = WORK / "study-src"

STEP_API = "https://api.github.com/repos/STEPBible/STEPBible-Data/contents/"
SWORD = "https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/"

DICTIONARIES = [
    # code, SWORD module, display name, kind
    ("easton", "Easton", "Easton's Bible Dictionary (1897)", "dictionary"),
    ("smith", "Smith", "Smith's Bible Dictionary (1884)", "dictionary"),
    ("nave", "Nave", "Nave's Topical Bible (1896)", "topical"),
    ("torrey", "Torrey", "Torrey's New Topical Textbook (1897)", "topical"),
]


# ---------------------------------------------------------------- downloads

def download_study_sources():
    import json

    SRC.mkdir(parents=True, exist_ok=True)
    for folder in ("Translators Amalgamated OT+NT", "Morphology codes"):
        with urllib.request.urlopen(STEP_API + urllib.request.quote(folder)) as r:
            items = json.load(r)
        for it in items:
            if it["type"] != "file":
                continue
            dest = SRC / it["name"]
            if not dest.exists():
                print("download", it["name"])
                urllib.request.urlretrieve(it["download_url"], dest)
    for _, mod, _, _ in DICTIONARIES:
        z = SRC / f"{mod}.zip"
        if not z.exists():
            print("download", z.name)
            urllib.request.urlretrieve(SWORD + z.name, z)
        d = SRC / f"sword-{mod}"
        if not d.exists():
            zipfile.ZipFile(z).extractall(d)


# ---------------------------------------------------------------- helpers

def norm_strongs(tag: str) -> str:
    """STEP extended tag -> this app's Strong's format: 'G2424G' -> 'G2424', 'H0430G' -> 'H430'.
    STEP-only particle/prefix codes (H9001+) are kept as-is; they aren't in Strong's."""
    m = re.match(r"([GH])0*(\d+)", tag or "")
    return f"{m.group(1)}{m.group(2)}" if m else ""


# Greek editions TAGNT marks per word, in bit order. Tyn = Tyndale House GNT (THGNT).
EDITIONS = ["NA28", "NA27", "Tyn", "SBL", "WH", "Treg", "TR", "Byz"]


def edition_mask(eds: str) -> int:
    toks = {e.strip() for e in re.split(r"[+\s]", eds or "") if e.strip()}
    return sum(1 << i for i, e in enumerate(EDITIONS) if e in toks)


def main_tag(ext: str) -> str:
    """The word's own extended Strong's tag: the braced one in Hebrew ('H9003/{H7225G}'),
    else the first tag ('G2424G')."""
    m = re.search(r"\{([HG]\d+[A-Za-z]?)\}", ext or "")
    if m:
        return m.group(1)
    m = re.search(r"[HG]\d+[A-Za-z]?", ext or "")
    return m.group(0) if m else ""


REF_RE = re.compile(r"^([1-3]?[A-Z][a-z]{1,2})\.(\d+)\.(\d+)(?:\(\d+\.\d+\))?#(\d+)=(\S+)")


# ---------------------------------------------------------------- interlinear

def parse_tagnt(path: Path):
    """Yield word dicts from a TAGNT file."""
    for line in path.read_text("utf-8").splitlines():
        m = REF_RE.match(line)
        if not m:
            continue
        cols = line.split("\t")
        if len(cols) < 6:
            continue
        book = STEP.get(m.group(1))
        greek = cols[1]
        translit = ""
        tm = re.match(r"^(.*?)\s*\(([^)]*)\)\s*$", greek)
        if tm:
            greek, translit = tm.group(1), tm.group(2)
        ds = cols[3].split("«")[-1]
        strongs_tag, _, grammar = ds.partition("=")
        lemma, _, lemma_gloss = cols[4].partition("=")
        # NFC: STEPBible writes some accents in the Greek Extended block (e.g. U+1F71 alpha
        # with oxia) where standard text uses the canonically equivalent tonos (U+03AC).
        # They render identically but compare unequal, which breaks search and matching.
        nfc = lambda s: unicodedata.normalize("NFC", s.strip())
        yield {
            "book": book, "ch": int(m.group(2)), "v": int(m.group(3)), "pos": int(m.group(4)),
            "type": m.group(5), "original": nfc(greek), "translit": translit.strip(),
            "gloss": cols[2].strip(), "strongs": norm_strongs(strongs_tag), "strongs_ext": strongs_tag.strip(),
            "morph": grammar.strip(), "lemma": nfc(lemma), "lemma_gloss": lemma_gloss.strip(),
            "editions": cols[5].strip(), "spelling": nfc(cols[7]) if len(cols) > 7 else "",
        }


def parse_tahot(path: Path):
    """Yield word dicts from a TAHOT file."""
    for line in path.read_text("utf-8").splitlines():
        m = REF_RE.match(line)
        if not m:
            continue
        cols = line.split("\t")
        if len(cols) < 6:
            continue
        book = STEP.get(m.group(1))
        # dStrongs like 'H9003/{H7225G}' -- the braced one is the main word
        main = re.search(r"\{([HG]\d+[A-Za-z]?)\}", cols[4])
        strongs_tag = main.group(1) if main else (re.findall(r"[HG]\d+[A-Za-z]?", cols[4]) or [""])[0]
        lemma, lemma_gloss = "", ""
        if len(cols) > 11:
            em = re.search(r"\{[HG]\d+[A-Za-z]?=([^=}]*)=([^}]*)\}", cols[11])
            if em:
                lemma = em.group(1).strip()
                lemma_gloss = re.sub(r"^[:\s]+", "", em.group(2).split("»")[0]).strip()
        yield {
            "book": book, "ch": int(m.group(2)), "v": int(m.group(3)), "pos": int(m.group(4)),
            "type": m.group(5), "original": cols[1].strip(), "translit": cols[2].strip(),
            "gloss": cols[3].strip(), "strongs": norm_strongs(strongs_tag), "strongs_ext": cols[4].strip(),
            "morph": cols[5].strip(), "lemma": lemma, "lemma_gloss": lemma_gloss,
            "editions": "", "spelling": "",
        }


def tyndale_spelling(word: dict) -> str:
    """The THGNT ('Tyn') spelling of a word where TAGNT lists it as a variant, else the
    main spelling. Variant cell looks like 'Tyn+WH: Δαυεὶδ ; +TR: Δαβὶδ ; '."""
    for part in word["spelling"].split(";"):
        eds, sep, form = part.partition(":")
        if sep and "Tyn" in [e.strip() for e in eds.split("+")] and form.strip():
            return form.strip()
    return word["original"]


# ---------------------------------------------------------------- morphology

def parse_morph(path: Path, lang: str):
    """Code -> (formal expansion, short English) from TEGMC/TEHMC. Each code's first line is
    'CODE<tab>formal...' and the following indented lines hold the plain-English forms."""
    out = {}
    lines = path.read_text("utf-8").splitlines()
    for i, line in enumerate(lines):
        if not line or line.startswith(("\t", " ", "#", "Code\t")) or "\t" not in line:
            continue
        code, rest = line.split("\t", 1)
        code = code.strip()
        if not re.match(r"^[A-Za-z0-9-]+$", code) or code in out:
            continue
        # 'CODE<tab>formal' or 'CODE<tab>example<tab>meaning' -- the meaning is the last cell
        cells = [c.strip() for c in rest.split("\t") if c.strip()]
        formal = cells[-1] if cells else ""
        short = ""
        if i + 1 < len(lines) and lines[i + 1].startswith("\t"):
            short = lines[i + 1].strip().strip('"').strip()
        out[code] = (formal, short)
    return out


# ---------------------------------------------------------------- dictionaries

_TAG_BREAK = re.compile(r"<\s*(?:/p|p|lb|br|/li|/div|div|/item|item|/ol|/ul)\b[^>]*>", re.I)


def convert_body(raw: str, jud_means: str):
    """Dictionary markup (TEI or ThML) -> plain text with ⟦ref⟧ markers, plus the list of
    references it cites."""
    cited = []

    def osis(m):
        refs = parse_osis_ref(m.group(1))
        inner = re.sub(r"<[^>]+>", "", m.group(2))
        cited.extend(refs)
        if not refs:
            return inner
        if len(refs) == 1:
            return marker(refs[0], html.unescape(inner) or None)
        return "; ".join(marker(r) for r in refs)

    def thml(m):
        attrs, inner = m.group(1), re.sub(r"<[^>]+>", "", m.group(2))
        inner_txt = html.unescape(inner).replace(" ", " ")
        pm = re.search(r'passage\s*=\s*"([^"]*)"', attrs)
        src = pm.group(1) if pm else inner_txt
        refs = parse_ref_list(src, jud_means)
        cited.extend(refs)
        if not refs:
            return inner_txt
        if len(refs) == 1 and pm:
            return marker(refs[0], inner_txt or None)
        return "; ".join(marker(r) for r in refs)

    s = raw.replace("\r", "")
    s = re.sub(r"<title>.*?</title>", "", s, flags=re.S | re.I)
    s = re.sub(r'<ref\b[^>]*osisRef\s*=\s*"([^"]*)"[^>]*>(.*?)</ref>', osis, s, flags=re.S | re.I)
    s = re.sub(r"<scripRef\b([^>]*)>(.*?)</scripRef>", thml, s, flags=re.S | re.I)
    s = re.sub(r"<li\b[^>]*>", "\n• ", s, flags=re.I)
    s = _TAG_BREAK.sub("\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace(" ", " ")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip(), cited


_SMALL = {"of", "the", "and", "or", "in", "to", "a", "an", "as", "by", "for", "on", "at", "with", "from"}


def headword(key: str, raw: str) -> str:
    t = re.search(r"<title>(.*?)</title>", raw, flags=re.S | re.I)
    if t:
        return html.unescape(re.sub(r"<[^>]+>", "", t.group(1))).strip()
    words = key.strip().lower().split()
    out = [w if (i and w in _SMALL) else w[:1].upper() + w[1:] for i, w in enumerate(words)]
    return " ".join(out)


def fold(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if not unicodedata.combining(c))


# ---------------------------------------------------------------- build

SCHEMA = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE interlinear (
    id INTEGER PRIMARY KEY,
    book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL,
    word_pos INTEGER NOT NULL, word_type TEXT NOT NULL,
    original TEXT NOT NULL, translit TEXT NOT NULL, gloss TEXT NOT NULL,
    strongs TEXT NOT NULL, lemma_key TEXT NOT NULL, morph TEXT NOT NULL,
    editions INTEGER NOT NULL
);
CREATE TABLE lemmas (key TEXT PRIMARY KEY, lemma TEXT NOT NULL, gloss TEXT NOT NULL);
CREATE INDEX idx_inter_verse ON interlinear(book, chapter, verse);
CREATE INDEX idx_inter_strongs ON interlinear(strongs);
CREATE TABLE morph_codes (code TEXT NOT NULL, lang TEXT NOT NULL, formal TEXT NOT NULL,
    short TEXT NOT NULL, PRIMARY KEY (code, lang));
CREATE TABLE dictionaries (code TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
    license TEXT NOT NULL, entry_count INTEGER NOT NULL);
CREATE TABLE dict_entries (id INTEGER PRIMARY KEY, dict_code TEXT NOT NULL,
    headword TEXT NOT NULL, headword_fold TEXT NOT NULL, body TEXT NOT NULL);
CREATE INDEX idx_dict_head ON dict_entries(headword_fold);
CREATE TABLE dict_refs (entry_id INTEGER NOT NULL, book TEXT NOT NULL, chapter INTEGER NOT NULL,
    verse INTEGER, verse_end INTEGER);
CREATE INDEX idx_dict_refs_verse ON dict_refs(book, chapter, verse);
CREATE VIRTUAL TABLE dict_fts USING fts5(headword, body, content='dict_entries', content_rowid='id');
"""


def build():
    download_study_sources()
    tmp = WORK / "study.db"
    if tmp.exists():
        tmp.unlink()
    con = sqlite3.connect(tmp)
    con.executescript(SCHEMA)

    # interlinear
    n = 0
    lemmas: dict[str, tuple[str, str]] = {}
    for f in sorted(SRC.glob("TAHOT*.txt")) + sorted(SRC.glob("TAGNT*.txt")):
        parser = parse_tahot if f.name.startswith("TAHOT") else parse_tagnt
        rows = []
        for w in parser(f):
            if not w["book"]:
                continue
            key = main_tag(w["strongs_ext"])
            if key and key not in lemmas and w["lemma"]:
                lemmas[key] = (w["lemma"], w["lemma_gloss"])
            rows.append((w["book"], w["ch"], w["v"], w["pos"], w["type"], w["original"], w["translit"],
                         w["gloss"], w["strongs"], key, w["morph"], edition_mask(w["editions"])))
        con.executemany(
            "INSERT INTO interlinear (book,chapter,verse,word_pos,word_type,original,translit,gloss,"
            "strongs,lemma_key,morph,editions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        n += len(rows)
        print(f"{f.name[:40]:40} {len(rows):>8,} words")
    con.executemany("INSERT INTO lemmas VALUES (?,?,?)", [(k, a, b) for k, (a, b) in lemmas.items()])
    print("interlinear words:", n, "| distinct lemmas:", len(lemmas))

    # morphology
    for pat, lang in (("TEGMC*.txt", "gr"), ("TEHMC*.txt", "he")):
        f = next(SRC.glob(pat))
        codes = parse_morph(f, lang)
        con.executemany("INSERT INTO morph_codes VALUES (?,?,?,?)",
                        [(c, lang, a, b) for c, (a, b) in codes.items()])
        print(f"morph codes {lang}: {len(codes):,}")

    # dictionaries
    for code, mod, name, kind in DICTIONARIES:
        entries = list(read_module(SRC / f"sword-{mod}"))
        conf = entries[0][2] if entries else {}
        count = 0
        for key, text, _ in entries:
            body, cited = convert_body(text, "Judges")
            if not body.strip():
                continue
            hw = headword(key, text)
            cur = con.execute("INSERT INTO dict_entries (dict_code, headword, headword_fold, body) VALUES (?,?,?,?)",
                              (code, hw, fold(hw), body))
            eid = cur.lastrowid
            seen = set()
            for (b, ch, v, ve) in cited:
                if (b, ch, v, ve) in seen or b not in ORDER:
                    continue
                seen.add((b, ch, v, ve))
                con.execute("INSERT INTO dict_refs VALUES (?,?,?,?,?)", (eid, b, ch, v, ve))
            count += 1
        con.execute("INSERT INTO dictionaries VALUES (?,?,?,?,?)",
                    (code, name, kind, conf.get("DistributionLicense", "Public Domain"), count))
        print(f"{name:45} {count:>6,} entries")
    con.execute("INSERT INTO dict_fts(dict_fts) VALUES ('rebuild')")
    refs_total = con.execute("SELECT COUNT(*) FROM dict_refs").fetchone()[0]
    print("dictionary verse links:", f"{refs_total:,}")

    con.executemany("INSERT INTO meta VALUES (?,?)", [
        ("interlinear_source", "STEPBible TAHOT/TAGNT (Tyndale House, Cambridge), CC BY 4.0"),
        ("morph_source", "STEPBible TEHMC/TEGMC, CC BY 4.0"),
        ("dictionary_source", "CrossWire SWORD modules Easton, Smith, Nave, Torrey (public domain)"),
    ])
    con.commit()
    ok = con.execute("PRAGMA integrity_check").fetchone()[0]
    con.execute("VACUUM")
    con.close()
    print("integrity_check:", ok)
    if ok != "ok":
        raise SystemExit("integrity check failed; not copying")
    shutil.copyfile(tmp, OUT)
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    build()
