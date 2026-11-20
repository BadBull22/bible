"""How to say a Hebrew or Greek word: its sounds (IPA) for the Kokoro voice.

Kokoro only knows English text, but it takes sounds directly (is_phonemes=True) and its sound set is the international phonetic alphabet, so a
Greek or Hebrew word only has to be turned into sounds first.

* Greek: espeak-ng's own Ancient Greek ("grc") rules (the classical, "Erasmian" way the word is taught: Ἰησοῦς = ee-ay-SOOS). The sidecar
  already carries espeak-ng for the English voice.
* Hebrew: espeak-ng's Hebrew spells out any word with a dagesh or a shin dot letter by letter, so the word is turned into sounds here, by rule,
  from its vowel points, the way modern Hebrew is spoken (ב = b or v, ח = kh, last syllable stressed).

A pointed Hebrew word is needed: without its vowel marks the sounds are guesswork, so `hebrew_phonemes` says so instead of guessing.
Pure Python, no espeak: the Greek side is in `greek_phonemes`, which is given the espeak backend.
"""
import unicodedata

# Hebrew points
SHEVA = "ְ"
HATAF_SEGOL = "ֱ"
HATAF_PATAH = "ֲ"
HATAF_QAMETS = "ֳ"
HIRIQ = "ִ"
TSERE = "ֵ"
SEGOL = "ֶ"
PATAH = "ַ"
QAMETS = "ָ"
HOLEM = "ֹ"
HOLEM_VAV = "ֺ"
QUBUTS = "ֻ"
DAGESH = "ּ"
SHIN_DOT = "ׁ"
SIN_DOT = "ׂ"
QAMETS_QATAN = "ׇ"

VOWELS = {
    HATAF_SEGOL: "e", HATAF_PATAH: "a", HATAF_QAMETS: "o", HIRIQ: "i", TSERE: "e", SEGOL: "e",
    PATAH: "a", QAMETS: "a", HOLEM: "o", HOLEM_VAV: "o", QUBUTS: "u", QAMETS_QATAN: "o",
}
LONG = {QAMETS, TSERE, HOLEM, HOLEM_VAV, HATAF_QAMETS}  # after one of these a sheva is spoken
# modern Israeli sounds; the letters that have no sound of their own (alef, ayin) are left out
CONSONANT = {
    "א": "", "ב": "v", "ג": "ɡ", "ד": "d", "ה": "h", "ו": "v", "ז": "z", "ח": "x", "ט": "t",
    "י": "j", "ך": "x", "כ": "x", "ל": "l", "ם": "m", "מ": "m", "ן": "n", "נ": "n", "ס": "s",
    "ע": "", "ף": "f", "פ": "f", "ץ": "ʦ", "צ": "ʦ", "ק": "k", "ר": "ʁ", "ש": "ʃ", "ת": "t",
}
HARD = {"ב": "b", "כ": "k", "ך": "k", "פ": "p", "ף": "p"}  # with a dagesh
FINAL = "ךםןףץ"


def has_points(text: str) -> bool:
    return any("ְ" <= c <= "ׇ" and c != "־" for c in text)


def _clusters(text: str):
    out = []
    for ch in unicodedata.normalize("NFD", text):
        if "א" <= ch <= "ת":
            out.append([ch, set()])
        elif "ְ" <= ch <= "ׇ" and ch != "־" and out:
            out[-1][1].add(ch)
        # cantillation marks (0591-05AF), the maqaf and anything else are ignored
    return out


def hebrew_phonemes(text: str) -> str | None:
    """Sounds of a pointed Hebrew word, or None when it has no vowel points (or no Hebrew letters)."""
    text = text.replace("־", " ")
    words = []
    for part in text.split():
        if not has_points(part):
            return None
        cl = _clusters(part)
        out: list[str] = []  # sounds; vowels are marked so the stress can find the last one
        prev_long = True  # a sheva at the start of a word is spoken
        prev_vowel = False
        last_vowel_at = -1
        i = 0
        while i < len(cl):
            c, marks = cl[i]
            nxt = cl[i + 1] if i + 1 < len(cl) else None
            vowel = next((VOWELS[m] for m in marks if m in VOWELS), None)
            is_last = i == len(cl) - 1
            # vav as a vowel letter: holem-male (the holem sits on the vav) and shureq (vav with a dagesh and no vowel)
            if c == "ו" and i > 0:
                if (HOLEM in marks or HOLEM_VAV in marks) and not any(m in VOWELS and m not in (HOLEM, HOLEM_VAV) for m in marks):
                    if not cl[i - 1][1] & set(VOWELS):  # the letter before has no vowel of its own: this vav is its vowel
                        out.append("o"); last_vowel_at = len(out) - 1; prev_long = True; prev_vowel = True
                        i += 1
                        continue
                if DAGESH in marks and vowel is None:
                    if not cl[i - 1][1] & set(VOWELS):
                        out.append("u"); last_vowel_at = len(out) - 1; prev_long = True; prev_vowel = True
                        i += 1
                        continue
            # yod after hiriq, tsere or segol with no vowel of its own is only a vowel letter
            if c == "י" and vowel is None and SHEVA not in marks and i > 0 and cl[i - 1][1] & {HIRIQ, TSERE, SEGOL}:
                i += 1
                continue
            # the consonant
            sound = CONSONANT[c]
            if c in HARD and DAGESH in marks:
                sound = HARD[c]
            if c == "ש":
                sound = "s" if SIN_DOT in marks else "ʃ"
            if c == "ה" and is_last and vowel is None and DAGESH not in marks:
                sound = ""  # a final he with no vowel and no mappiq is silent
            if c in "אע":
                sound = ""
            # furtive patah: a final ח, ע or ה with a patah is said after its vowel (רוּחַ = ru-akh), and the stress stays on the vowel before it
            if is_last and PATAH in marks and c in "חעה" and prev_vowel:
                out.append("a")
                if sound:
                    out.append(sound)
                i += 1
                continue
            if sound:
                out.append(sound)
            if vowel is not None:
                out.append(vowel); last_vowel_at = len(out) - 1
                prev_long = bool(marks & LONG); prev_vowel = True
            elif SHEVA in marks:
                if prev_long and not is_last and (nxt is not None):
                    out.append("e"); last_vowel_at = len(out) - 1
                    prev_long = False; prev_vowel = True
                else:
                    prev_long = False; prev_vowel = False
            else:
                prev_vowel = False
            i += 1
        if last_vowel_at < 0:
            return None
        # stress the last syllable: the mark goes before the consonant in front of the last vowel
        at = last_vowel_at
        if at > 0 and out[at - 1] not in ("a", "e", "i", "o", "u", ""):
            at -= 1
        out.insert(at, "ˈ")
        words.append("".join(out))
    return " ".join(words) if words else None


def greek_phonemes(backend, text: str) -> str | None:
    """Sounds of a Greek word through espeak-ng's Ancient Greek rules (`backend` = phonemizer EspeakBackend("grc"))."""
    text = unicodedata.normalize("NFC", text).strip()
    if not text:
        return None
    ph = backend.phonemize([text])[0].strip()
    return ph or None


def keep_known(phonemes: str, vocab) -> str:
    """Only what the voice has a sound for."""
    return "".join(c for c in phonemes if c in vocab or c == " ")
