"""Scripture-reference parsing shared by the study-data importers.

Resolves the many book spellings found in OSIS (``1Sam``), STEPBible (``1Sa``, ``Mrk``,
``Ezk``) and ThML free text (``1ch``, ``Da``, ``Ho``, ``1Jo``) to this project's canonical
book names (books.py), and parses reference lists like ``Job 39:6; Isa 32:14`` or
``Heb 6:11,19; 1Jo 3:14,19; 4:18`` with the book and chapter carried forward.
"""

import re

from books import CANONICAL_BOOKS

# Explicit abbreviations, lower-cased with spaces/dots removed. Anything not listed falls
# back to an unambiguous-prefix match against the canonical names (see resolve_book).
_ABBR = {
    "gen": "Genesis", "ge": "Genesis", "gn": "Genesis",
    "exo": "Exodus", "exod": "Exodus", "ex": "Exodus",
    "lev": "Leviticus", "le": "Leviticus", "lv": "Leviticus",
    "num": "Numbers", "nu": "Numbers", "nm": "Numbers",
    "deu": "Deuteronomy", "deut": "Deuteronomy", "de": "Deuteronomy", "dt": "Deuteronomy",
    "jos": "Joshua", "josh": "Joshua",
    "jdg": "Judges", "judg": "Judges", "jud": None,  # "Jud" is Jude in STEP, Judges in Nave -- disambiguated by caller
    "jg": "Judges", "jdgs": "Judges",
    "rut": "Ruth", "ru": "Ruth",
    "1sa": "1 Samuel", "1sam": "1 Samuel", "1sm": "1 Samuel",
    "2sa": "2 Samuel", "2sam": "2 Samuel", "2sm": "2 Samuel",
    "1ki": "1 Kings", "1kgs": "1 Kings", "1kin": "1 Kings",
    "2ki": "2 Kings", "2kgs": "2 Kings", "2kin": "2 Kings",
    "1ch": "1 Chronicles", "1chr": "1 Chronicles", "1chron": "1 Chronicles",
    "2ch": "2 Chronicles", "2chr": "2 Chronicles", "2chron": "2 Chronicles",
    "ezr": "Ezra", "neh": "Nehemiah", "ne": "Nehemiah",
    "est": "Esther", "esth": "Esther", "es": "Esther",
    "job": "Job", "jb": "Job",
    "psa": "Psalms", "ps": "Psalms", "psalm": "Psalms", "pss": "Psalms",
    "pro": "Proverbs", "prov": "Proverbs", "pr": "Proverbs", "prv": "Proverbs",
    "ecc": "Ecclesiastes", "eccl": "Ecclesiastes", "ec": "Ecclesiastes", "eccles": "Ecclesiastes",
    "sng": "Song of Solomon", "song": "Song of Solomon", "so": "Song of Solomon", "ss": "Song of Solomon",
    "sos": "Song of Solomon", "cant": "Song of Solomon", "songofsongs": "Song of Solomon",
    "isa": "Isaiah", "is": "Isaiah",
    "jer": "Jeremiah", "je": "Jeremiah",
    "lam": "Lamentations", "la": "Lamentations",
    "ezk": "Ezekiel", "ezek": "Ezekiel", "eze": "Ezekiel",
    "dan": "Daniel", "da": "Daniel", "dn": "Daniel",
    "hos": "Hosea", "ho": "Hosea",
    "jol": "Joel", "joel": "Joel", "joe": "Joel",
    "amo": "Amos", "am": "Amos",
    "oba": "Obadiah", "obad": "Obadiah", "ob": "Obadiah",
    "jon": "Jonah", "jnh": "Jonah", "jonah": "Jonah",
    "mic": "Micah", "mi": "Micah",
    "nam": "Nahum", "nah": "Nahum", "na": "Nahum",
    "hab": "Habakkuk",
    "zep": "Zephaniah", "zeph": "Zephaniah",
    "hag": "Haggai", "hg": "Haggai",
    "zec": "Zechariah", "zech": "Zechariah", "zc": "Zechariah",
    "mal": "Malachi",
    "mat": "Matthew", "matt": "Matthew", "mt": "Matthew",
    "mrk": "Mark", "mar": "Mark", "mk": "Mark", "mr": "Mark",
    "luk": "Luke", "lu": "Luke", "lk": "Luke",
    "jhn": "John", "joh": "John", "jn": "John",
    "act": "Acts", "ac": "Acts",
    "rom": "Romans", "ro": "Romans", "rm": "Romans",
    "1co": "1 Corinthians", "1cor": "1 Corinthians",
    "2co": "2 Corinthians", "2cor": "2 Corinthians",
    "gal": "Galatians", "ga": "Galatians",
    "eph": "Ephesians",
    "php": "Philippians", "phil": "Philippians", "phi": "Philippians", "pp": "Philippians",
    "col": "Colossians",
    "1th": "1 Thessalonians", "1thess": "1 Thessalonians", "1thes": "1 Thessalonians",
    "2th": "2 Thessalonians", "2thess": "2 Thessalonians", "2thes": "2 Thessalonians",
    "1ti": "1 Timothy", "1tim": "1 Timothy", "1tm": "1 Timothy",
    "2ti": "2 Timothy", "2tim": "2 Timothy", "2tm": "2 Timothy",
    "tit": "Titus", "ti": "Titus",
    "phm": "Philemon", "phlm": "Philemon", "philem": "Philemon", "phile": "Philemon",
    "heb": "Hebrews",
    "jas": "James", "jam": "James", "jm": "James",
    "1pe": "1 Peter", "1pet": "1 Peter", "1pt": "1 Peter",
    "2pe": "2 Peter", "2pet": "2 Peter", "2pt": "2 Peter",
    "1jn": "1 John", "1jo": "1 John", "1joh": "1 John", "1john": "1 John",
    "2jn": "2 John", "2jo": "2 John", "2joh": "2 John", "2john": "2 John",
    "3jn": "3 John", "3jo": "3 John", "3joh": "3 John", "3john": "3 John",
    "jude": "Jude", "jd": "Jude",
    "rev": "Revelation", "re": "Revelation", "rv": "Revelation", "apoc": "Revelation",
}

_CANON = [name for (_, name, _, _) in CANONICAL_BOOKS]
_CANON_KEY = {re.sub(r"[\s.]", "", n).lower(): n for n in _CANON}
ORDER = {name: o for (o, name, _, _) in CANONICAL_BOOKS}


def _roman(s: str) -> str:
    return re.sub(r"^(iii|ii|i)(?=[a-z])", lambda m: str(len(m.group(1))), s)


def resolve_book(raw: str, jud_means: str = "Judges") -> str | None:
    """Canonical book name for an abbreviation, or None. ``jud_means`` settles the one
    genuinely ambiguous token: STEPBible uses ``Jud`` for Jude, Nave's for Judges."""
    plain = re.sub(r"[\s.]", "", raw).lower()
    if not plain:
        return None
    if plain == "jud":
        return jud_means
    # Plain spelling first, so "Isa"/"Is" stay Isaiah; only then try reading a leading
    # "I"/"II"/"III" as a Roman numeral ("II Kings", "IJohn").
    for k in (plain, _roman(plain)):
        if k in _ABBR and _ABBR[k]:
            return _ABBR[k]
        if k in _CANON_KEY:
            return _CANON_KEY[k]
    for k in (plain, _roman(plain)):
        hits = [n for key, n in _CANON_KEY.items() if key.startswith(k)]
        if len(hits) == 1:
            return hits[0]
    return None


# OSIS book ids (the "osisRef" attribute) -> canonical name.
OSIS = {
    "Gen": "Genesis", "Exod": "Exodus", "Lev": "Leviticus", "Num": "Numbers", "Deut": "Deuteronomy",
    "Josh": "Joshua", "Judg": "Judges", "Ruth": "Ruth", "1Sam": "1 Samuel", "2Sam": "2 Samuel",
    "1Kgs": "1 Kings", "2Kgs": "2 Kings", "1Chr": "1 Chronicles", "2Chr": "2 Chronicles",
    "Ezra": "Ezra", "Neh": "Nehemiah", "Esth": "Esther", "Job": "Job", "Ps": "Psalms",
    "Prov": "Proverbs", "Eccl": "Ecclesiastes", "Song": "Song of Solomon", "Isa": "Isaiah",
    "Jer": "Jeremiah", "Lam": "Lamentations", "Ezek": "Ezekiel", "Dan": "Daniel", "Hos": "Hosea",
    "Joel": "Joel", "Amos": "Amos", "Obad": "Obadiah", "Jonah": "Jonah", "Mic": "Micah",
    "Nah": "Nahum", "Hab": "Habakkuk", "Zeph": "Zephaniah", "Hag": "Haggai", "Zech": "Zechariah",
    "Mal": "Malachi", "Matt": "Matthew", "Mark": "Mark", "Luke": "Luke", "John": "John",
    "Acts": "Acts", "Rom": "Romans", "1Cor": "1 Corinthians", "2Cor": "2 Corinthians",
    "Gal": "Galatians", "Eph": "Ephesians", "Phil": "Philippians", "Col": "Colossians",
    "1Thess": "1 Thessalonians", "2Thess": "2 Thessalonians", "1Tim": "1 Timothy",
    "2Tim": "2 Timothy", "Titus": "Titus", "Phlm": "Philemon", "Heb": "Hebrews", "Jas": "James",
    "1Pet": "1 Peter", "2Pet": "2 Peter", "1John": "1 John", "2John": "2 John", "3John": "3 John",
    "Jude": "Jude", "Rev": "Revelation",
}

# STEPBible's three-letter book codes.
STEP = {
    "Gen": "Genesis", "Exo": "Exodus", "Lev": "Leviticus", "Num": "Numbers", "Deu": "Deuteronomy",
    "Jos": "Joshua", "Jdg": "Judges", "Rut": "Ruth", "1Sa": "1 Samuel", "2Sa": "2 Samuel",
    "1Ki": "1 Kings", "2Ki": "2 Kings", "1Ch": "1 Chronicles", "2Ch": "2 Chronicles", "Ezr": "Ezra",
    "Neh": "Nehemiah", "Est": "Esther", "Job": "Job", "Psa": "Psalms", "Pro": "Proverbs",
    "Ecc": "Ecclesiastes", "Sng": "Song of Solomon", "Isa": "Isaiah", "Jer": "Jeremiah",
    "Lam": "Lamentations", "Ezk": "Ezekiel", "Dan": "Daniel", "Hos": "Hosea", "Jol": "Joel",
    "Amo": "Amos", "Oba": "Obadiah", "Jon": "Jonah", "Mic": "Micah", "Nam": "Nahum",
    "Hab": "Habakkuk", "Zep": "Zephaniah", "Hag": "Haggai", "Zec": "Zechariah", "Mal": "Malachi",
    "Mat": "Matthew", "Mrk": "Mark", "Luk": "Luke", "Jhn": "John", "Act": "Acts", "Rom": "Romans",
    "1Co": "1 Corinthians", "2Co": "2 Corinthians", "Gal": "Galatians", "Eph": "Ephesians",
    "Php": "Philippians", "Col": "Colossians", "1Th": "1 Thessalonians", "2Th": "2 Thessalonians",
    "1Ti": "1 Timothy", "2Ti": "2 Timothy", "Tit": "Titus", "Phm": "Philemon", "Heb": "Hebrews",
    "Jas": "James", "1Pe": "1 Peter", "2Pe": "2 Peter", "1Jn": "1 John", "2Jn": "2 John",
    "3Jn": "3 John", "Jud": "Jude", "Rev": "Revelation",
}


def parse_osis_ref(osis: str):
    """``1Sam.7.1`` / ``Num.16`` / ``Bible:Gen.1.1-Gen.1.3`` -> list of (book, ch, v, v_end)."""
    out = []
    for part in osis.replace("Bible:", "").split():
        start = part.split("-")[0]
        end = part.split("-")[1] if "-" in part else None
        bits = start.split(".")
        book = OSIS.get(bits[0])
        if not book or len(bits) < 2 or not bits[1].isdigit():
            continue
        ch = int(bits[1])
        v = int(bits[2]) if len(bits) > 2 and bits[2].isdigit() else None
        v_end = None
        if end and v is not None:
            eb = end.split(".")
            if len(eb) >= 3 and eb[0] == bits[0] and eb[1] == bits[1] and eb[2].isdigit():
                v_end = int(eb[2])
        out.append((book, ch, v, v_end))
    return out


_BOOK_RE = re.compile(r"^\s*((?:[1-3]|i{1,3})\s*[A-Za-z][A-Za-z.]*|[A-Za-z][A-Za-z.]*(?:\s+of\s+[A-Za-z]+)?)\s*(?=\d)")


def parse_ref_list(text: str, jud_means: str = "Judges", start_book: str | None = None):
    """Parse free-text references (``Job 39:6; Isa 32:14; Da 5:21``, ``1Jo 3:14,19; 4:18``,
    ``Nu 16``) into (book, ch, v, v_end) tuples, carrying book/chapter forward."""
    out = []
    book = start_book
    ch = None
    text = text.replace(" ", " ").replace("–", "-").replace("—", "-")
    for part in re.split(r"[;]", text):
        part = part.strip().rstrip(".")
        if not part:
            continue
        m = _BOOK_RE.match(part)
        if m:
            b = resolve_book(m.group(1), jud_means)
            if b is None:
                continue
            book, ch = b, None
            part = part[m.end():]
        if not book:
            continue
        for item in part.split(","):
            item = item.strip().rstrip(".")
            mm = re.match(r"^(\d+)(?::(\d+))?(?:\s*-\s*(\d+)(?::(\d+))?)?", item)
            if not mm:
                continue
            a, b2, c, d = mm.groups()
            if b2 is not None:
                ch = int(a)
                v = int(b2)
                v_end = int(d) if d else (int(c) if c and not d else None)
                if d:  # a cross-chapter range like 3:14-4:2 -- keep the start only
                    v_end = None
                out.append((book, ch, v, v_end))
            elif ch is not None and ":" not in item and re.search(r":", text):
                # a bare number after a chapter:verse earlier in this list = another verse
                v = int(a)
                out.append((book, ch, v, int(c) if c else None))
            else:
                ch = int(a)
                out.append((book, ch, None, None))
    return out


def label(ref) -> str:
    book, ch, v, v_end = ref
    if v is None:
        return f"{book} {ch}"
    return f"{book} {ch}:{v}" + (f"-{v_end}" if v_end else "")


def marker(ref, text: str | None = None) -> str:
    """In-body link marker the frontend renders as a clickable reference."""
    book, ch, v, v_end = ref
    return f"⟦{book}|{ch}|{v or ''}|{v_end or ''}|{(text or label(ref)).strip()}⟧"
