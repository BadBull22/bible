"""Canonical 66-book list (Protestant canon) and name-normalization map.

order_index: 1-39 = Old Testament, 40-66 = New Testament (standard English order).
"""

CANONICAL_BOOKS = [
    # (order_index, canonical_name, testament, usfm_code)
    (1, "Genesis", "OT", "GEN"), (2, "Exodus", "OT", "EXO"), (3, "Leviticus", "OT", "LEV"),
    (4, "Numbers", "OT", "NUM"), (5, "Deuteronomy", "OT", "DEU"), (6, "Joshua", "OT", "JOS"),
    (7, "Judges", "OT", "JDG"), (8, "Ruth", "OT", "RUT"), (9, "1 Samuel", "OT", "1SA"),
    (10, "2 Samuel", "OT", "2SA"), (11, "1 Kings", "OT", "1KI"), (12, "2 Kings", "OT", "2KI"),
    (13, "1 Chronicles", "OT", "1CH"), (14, "2 Chronicles", "OT", "2CH"), (15, "Ezra", "OT", "EZR"),
    (16, "Nehemiah", "OT", "NEH"), (17, "Esther", "OT", "EST"), (18, "Job", "OT", "JOB"),
    (19, "Psalms", "OT", "PSA"), (20, "Proverbs", "OT", "PRO"), (21, "Ecclesiastes", "OT", "ECC"),
    (22, "Song of Solomon", "OT", "SNG"), (23, "Isaiah", "OT", "ISA"), (24, "Jeremiah", "OT", "JER"),
    (25, "Lamentations", "OT", "LAM"), (26, "Ezekiel", "OT", "EZK"), (27, "Daniel", "OT", "DAN"),
    (28, "Hosea", "OT", "HOS"), (29, "Joel", "OT", "JOL"), (30, "Amos", "OT", "AMO"),
    (31, "Obadiah", "OT", "OBA"), (32, "Jonah", "OT", "JON"), (33, "Micah", "OT", "MIC"),
    (34, "Nahum", "OT", "NAM"), (35, "Habakkuk", "OT", "HAB"), (36, "Zephaniah", "OT", "ZEP"),
    (37, "Haggai", "OT", "HAG"), (38, "Zechariah", "OT", "ZEC"), (39, "Malachi", "OT", "MAL"),
    (40, "Matthew", "NT", "MAT"), (41, "Mark", "NT", "MRK"), (42, "Luke", "NT", "LUK"),
    (43, "John", "NT", "JHN"), (44, "Acts", "NT", "ACT"), (45, "Romans", "NT", "ROM"),
    (46, "1 Corinthians", "NT", "1CO"), (47, "2 Corinthians", "NT", "2CO"), (48, "Galatians", "NT", "GAL"),
    (49, "Ephesians", "NT", "EPH"), (50, "Philippians", "NT", "PHP"), (51, "Colossians", "NT", "COL"),
    (52, "1 Thessalonians", "NT", "1TH"), (53, "2 Thessalonians", "NT", "2TH"), (54, "1 Timothy", "NT", "1TI"),
    (55, "2 Timothy", "NT", "2TI"), (56, "Titus", "NT", "TIT"), (57, "Philemon", "NT", "PHM"),
    (58, "Hebrews", "NT", "HEB"), (59, "James", "NT", "JAS"), (60, "1 Peter", "NT", "1PE"),
    (61, "2 Peter", "NT", "2PE"), (62, "1 John", "NT", "1JN"), (63, "2 John", "NT", "2JN"),
    (64, "3 John", "NT", "3JN"), (65, "Jude", "NT", "JUD"), (66, "Revelation", "NT", "REV"),
]

BY_ORDER = {o: name for (o, name, _, _) in CANONICAL_BOOKS}
BY_USFM = {code: name for (_, name, _, code) in CANONICAL_BOOKS}
CANONICAL_NAMES = {name for (_, name, _, _) in CANONICAL_BOOKS}

# Maps the many spellings/abbreviations seen across scrollmapper JSON, OSIS "name",
# and USFM \toc2 headings, to our canonical name.
ALIASES = {
    "Song of Songs": "Song of Solomon",
    "Canticles": "Song of Solomon",
    "Revelation of John": "Revelation",
    "The Revelation": "Revelation",
    "I Samuel": "1 Samuel", "II Samuel": "2 Samuel",
    "I Kings": "1 Kings", "II Kings": "2 Kings",
    "I Chronicles": "1 Chronicles", "II Chronicles": "2 Chronicles",
    "I Corinthians": "1 Corinthians", "II Corinthians": "2 Corinthians",
    "I Thessalonians": "1 Thessalonians", "II Thessalonians": "2 Thessalonians",
    "I Timothy": "1 Timothy", "II Timothy": "2 Timothy",
    "I Peter": "1 Peter", "II Peter": "2 Peter",
    "I John": "1 John", "II John": "2 John", "III John": "3 John",
}


def normalize_book_name(raw: str) -> str | None:
    raw = raw.strip()
    if raw in CANONICAL_NAMES:
        return raw
    if raw in ALIASES:
        return ALIASES[raw]
    if raw.upper() in BY_USFM:
        return BY_USFM[raw.upper()]
    return None
