"""Finds the names the BSB and the KJV spell differently (Elizabeth / Elisabeth, Zechariah / Zacharias, Kenan / Cainan...)
from the app's own Strong's tagging: a word carrying the same Strong's number in both Bibles, written differently, and
known as a name (person or place), is the same name in two spellings.

Writes src-tauri/resources/name_aliases.json: {"groups": [["Elizabeth", "Elisabeth"], ...]} (the first spelling is the BSB's).
Run from the repository root:  python data-pipeline/build_name_aliases.py   (reads bible.db and commentaries.db, read only)"""
import json
import sqlite3
from collections import Counter, defaultdict

BIBLE = "src-tauri/resources/bible.db"
STUDY = "src-tauri/resources/commentaries.db"
OUT = "src-tauri/resources/name_aliases.json"

bible = sqlite3.connect(f"file:{BIBLE}?mode=ro", uri=True)
study = sqlite3.connect(f"file:{STUDY}?mode=ro", uri=True)

names = {r[0].lower() for r in study.execute("select name from entities where kind in ('person','place')")}
ids = dict(bible.execute("select code, id from versions where code in ('BSB','KJV')").fetchall())

forms = {"BSB": defaultdict(Counter), "KJV": defaultdict(Counter)}
lower = {"BSB": Counter(), "KJV": Counter()}  # how often a word is also written in lower case (a common word, not a name)
for code, vid in ids.items():
    rows = bible.execute(
        """select sl.strongs_number, sl.surface_text, count(*) from strongs_links sl join verses v on v.id = sl.verse_id
           where v.version_id = ? group by 1, 2""", (vid,))
    for number, surface, n in rows:
        word = surface.strip()
        if word.isalpha() and word.islower():
            lower[code][word] += n
        if word.isalpha() and word[0].isupper() and len(word) >= 3:
            forms[code][number][word] += n

pairs = Counter()
for number in set(forms["BSB"]) & set(forms["KJV"]):
    b, k = forms["BSB"][number].most_common(1)[0], forms["KJV"][number].most_common(1)[0]
    if b[0].lower() == k[0].lower():
        continue
    if b[1] < 2 or k[1] < 2:
        continue
    # "Say", "Thinkest", "Ram" are words that start a sentence or name an animal, not names
    if lower["BSB"][b[0].lower()] >= 5 or lower["KJV"][k[0].lower()] >= 5:
        continue
    # a name the app knows (the people and places data is spelled the way the KJV and Easton's spell)
    if b[0].lower() not in names and k[0].lower() not in names:
        continue
    pairs[(b[0], k[0])] += b[1] + k[1]

# spellings the Strong's tagging does not pair (checked by hand against the KJV text of Luke 3:34-38 and Genesis 5 and 11)
EXTRA = [("Kenan", "Cainan"), ("Noah", "Noe"), ("Shem", "Sem"), ("Methuselah", "Mathusala"), ("Mahalalel", "Maleleel"), ("Eber", "Heber"),
         ("Peleg", "Phalec"), ("Reu", "Ragau"), ("Serug", "Saruch"), ("Nahor", "Nachor"), ("Terah", "Thara"), ("Shelah", "Sala")]
# words that start a sentence, wrongly paired with a name
NOT_NAMES = {"Thinkest", "Say"}
for pair in EXTRA:
    pairs[pair] += 1
for pair in list(pairs):
    if NOT_NAMES & set(pair):
        del pairs[pair]

# merge pairs that share a spelling into groups
groups = []
for (b, k), _ in pairs.most_common():
    for g in groups:
        if b in g or k in g:
            for x in (b, k):
                if x not in g:
                    g.append(x)
            break
    else:
        groups.append([b, k])
groups.sort(key=lambda g: g[0])
json.dump({"groups": groups}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print(len(groups), "groups written to", OUT)
for g in groups:
    print("  ", g)
