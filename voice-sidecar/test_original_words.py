"""Checks how Hebrew words are turned into sounds (original_words.py). Run: python -X utf8 voice-sidecar\test_original_words.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from original_words import hebrew_phonemes, has_points, keep_known

CASES = {
    "אָהַב": "aˈhav",
    "שָׁלוֹם": "ʃaˈlom",
    "אֱלֹהִים": "eloˈhim",
    "בְּרֵאשִׁית": "beʁeˈʃit",
    "חֶסֶד": "xeˈsed",
    "רוּחַ": "ˈʁuax",
    "יְהוּדָה": "jehuˈda",
    "מֶלֶךְ": "meˈlex",
    "בֵּית": "ˈbet",
    "צַדִּיק": "ʦaˈdik",
}
bad = 0
for w, want in CASES.items():
    got = hebrew_phonemes(w)
    ok = got == want
    bad += not ok
    print("PASS" if ok else "FAIL", w, got, "" if ok else f"(wanted {want})")
for w in ("אהב", "", "abc"):
    got = hebrew_phonemes(w)
    ok = got is None
    bad += not ok
    print("PASS" if ok else "FAIL", repr(w), "has no vowel points: nothing to say", got)
assert has_points("אָהַב") and not has_points("אהב")
assert keep_known("aˈz!", {"a", "z", "ˈ"}) == "aˈz"
print("FAILED:", bad)
sys.exit(1 if bad else 0)
