"""Audit (and optionally fix) scripture quotations in src-tauri/resources/qa.json against the
bundled Berean Standard Bible text.

The curated answers were written partly from memory, and some quotations came out in
NIV/ESV-style wording -- which (a) isn't the translation this app bundles and (b) is
copyrighted. This finds every "quoted passage" followed by its (Book C:V) citation,
compares it with the BSB text of that verse (or range), and with --fix replaces each
quoted segment with the closest contiguous run of BSB words.

    python audit_qa_quotes.py          # report only
    python audit_qa_quotes.py --fix    # rewrite qa.json in place (review the diff!)
"""

import difflib
import json
import re
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from refs import parse_ref_list  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
QA = ROOT / "src-tauri" / "resources" / "qa.json"
DB = ROOT / "src-tauri" / "resources" / "bible.db"

# "quoted text" followed (within a few characters) by a parenthesised citation.
QUOTE_CITE = re.compile(r'"([^"]{8,}?)"\s*\(([^()]*?\d+:\d+[^()]*)\)')
WORD = re.compile(r"[A-Za-z0-9']+")


def norm_words(s: str) -> list[str]:
    return [w.lower().strip("'") for w in WORD.findall(s.replace("’", "'"))]


def bsb_text(con, refs) -> str:
    parts = []
    for book, ch, v, v_end in refs:
        if v is None:
            continue
        rows = con.execute(
            "SELECT v.text FROM verses v JOIN books b ON b.id=v.book_id JOIN versions ver ON ver.id=v.version_id "
            "WHERE ver.code='BSB' AND b.name=? AND v.chapter=? AND v.verse BETWEEN ? AND ? ORDER BY v.verse",
            (book, ch, v, v_end or v),
        ).fetchall()
        parts.extend(r[0] for r in rows)
    return " ".join(parts)


def best_window(segment: str, source: str):
    """The run of source words the quoted segment corresponds to: (score, text).

    Aligns the segment's words to the source's words (difflib on word lists), then maps
    the segment's unmatched leading/trailing words onto the source so a differently-worded
    ending ("sins" vs "our trespasses") is still included -- and finally stretches the end
    to the next punctuation mark so the quote doesn't stop mid-phrase. The score is the
    share of the segment's words found in order in the chosen run."""
    seg = norm_words(segment)
    if not seg:
        return 1.0, segment
    toks = re.findall(r"\S+", source)
    tnorm = [(norm_words(t) or [""])[0] for t in toks]
    best = (0.0, segment)
    # Try alignment against every window roughly the segment's length, keep the best anchor.
    n = len(seg)
    for i in range(0, max(1, len(toks) - max(1, n // 2) + 1)):
        window = tnorm[i : i + n + 6]
        sm = difflib.SequenceMatcher(None, seg, window, autojunk=False)
        blocks = [b for b in sm.get_matching_blocks() if b.size]
        if not blocks:
            continue
        matched = sum(b.size for b in blocks)
        score = matched / n
        if score <= best[0]:
            continue
        first, last = blocks[0], blocks[-1]
        start = i + max(0, first.b - first.a)
        end = i + last.b + last.size + (n - (last.a + last.size))
        end = min(end, len(toks))
        # finish the phrase: extend up to 3 tokens to reach punctuation, if not already there
        k = end
        while k < len(toks) and k < end + 3 and not re.search(r"[.,;:!?]$", toks[k - 1]):
            k += 1
        if k > end and re.search(r"[.,;:!?]$", toks[k - 1]):
            end = k
        best = (score, " ".join(toks[start:end]))
    return best


# Hand-checked replacements for quotations the aligner gets wrong (wrong clause, cut
# short, or a paraphrase with no close match). Key: (entry id, start of the original
# quotation) -> exact BSB wording. Verified against bible.db's BSB text 2026-09-26.
OVERRIDES = {
    ("purpose_of_salvation", "so that you may proclaim"): "to proclaim the virtues of Him who called you out of darkness into His marvelous light",
    ("how_to_be_saved", "by grace... through faith"): "by grace you have been saved through faith... not by works, so that no one can boast",
    ("faq_baptism_required_for_salvation", "by grace... through faith"): "by grace you have been saved through faith... not by works",
    ("faq_trinity", "Oh, the depth"): "O, the depth of the riches of the wisdom and knowledge of God! How unsearchable are His judgments, and untraceable His ways!",
    ("faq_god_responsible_for_sin", "God cannot be tempted"): "God cannot be tempted by evil, nor does He tempt anyone. But each one is tempted when by his own evil desires he is lured away and enticed",
    ("faq_why_create_knowing_sin", "chosen in Him"): "He chose us in Him before the foundation of the world",
    ("faq_why_old_new_testament", "not to abolish"): "I have not come to abolish them, but to fulfill them",
    ("faq_why_old_new_testament", "a better covenant"): "the covenant He mediates is better and is founded on better promises",
    ("faq_can_lose_salvation", "without holiness"): "holiness, without which no one will see the Lord",
    ("faq_can_lose_salvation", "I wish you were either hot or cold"): "you are neither cold nor hot. How I wish you were one or the other! So because you are lukewarm — neither hot nor cold — I am about to vomit you out of My mouth!",
    ("faq_why_christians_still_sin", "I do not do the good"): "I do not do the good I want to do. Instead, I keep on doing the evil I do not want to do",
    ("faq_christian_death_immediate", "we would prefer"): "would prefer to be away from the body and at home with the Lord",
    ("faq_great_white_throne", "the resurrection of condemnation"): "the resurrection of judgment",
    ("faq_christians_in_tribulation", "who rescues us"): "our deliverer from the coming wrath",
    ("faq_pornography", "the lust of the eyes"): "the desires of the eyes",
    ("faq_earth_age", "a thousand years"): "in Your sight a thousand years are but a day that passes",
    ("faq_bible_opposes_science", "It is the glory of God"): "It is the glory of God to conceal a matter and the glory of kings to search it out",
    ("faq_christian_demon_possession", "the One who is in you"): "greater is He who is in you than he who is in the world",
    ("faq_jw_mormons_christian", "no one who denies"): "Whoever denies the Son does not have the Father",
    ("faq_same_god_as_islam", "No one who denies"): "Whoever denies the Son does not have the Father",
    ("faq_discerning_gods_will", "test and approve"): "test and approve what is the good, pleasing, and perfect will of God",
    ("faq_balance_family_and_poor", "Anyone who does not provide"): "If anyone does not provide for his own, and especially his own household, he has denied the faith and is worse than an unbeliever",
    ("faq_balance_family_and_poor", "Religion that God"): "Pure and undefiled religion before our God and Father is this: to care for orphans and widows in their distress",
    ("faq_god_omniscience", "His understanding"): "His understanding has no limit",
    ("faq_prayer_change_gods_mind", "the prayer of a righteous"): "The prayer of a righteous man has great power to prevail",
    ("faq_bible_inerrant", "no prophecy of Scripture"): "no prophecy of Scripture comes from one’s own interpretation",
    ("faq_why_christians_still_sin", "Shall we go on sinning"): "Shall we continue in sin so that grace may increase? Certainly not!",
    ("faq_suicide_and_heaven", "knows how we are formed"): "He knows our frame; He is mindful that we are dust",
    ("faq_tribulation", "a time of trouble for Jacob"): "the time of Jacob’s distress",
    ("faq_premarital_sex", "that each of you should learn"): "each of you must know how to control his own body in holiness and honor",
    ("faq_definition_of_church", "baptized by one Spirit"): "in one Spirit we were all baptized into one body",
}


def override_for(entry_id: str, quote: str):
    for (eid, start), text in OVERRIDES.items():
        if eid == entry_id and quote.startswith(start):
            return text
    return None


def tidy(text: str) -> str:
    # bible.db's BSB text has a stray space after opening curly quotes ("“ Jesus")
    text = re.sub(r"([“‘])\s+", r"\1", text)
    text = re.sub(r"\.{4,}", "...", text)
    return text.rstrip(".").rstrip()


def clean_edges(text: str) -> str:
    text = text.strip().strip("“”\"").strip()
    # a quotation shouldn't start mid-punctuation or end on a dangling opening mark
    return re.sub(r"^[,;:—-]+\s*", "", text).rstrip(",;:—- “‘")


def main(fix: bool):
    data = json.loads(QA.read_text("utf-8"))
    con = sqlite3.connect(DB)
    total = mismatched = fixed = 0
    unsure = []
    for e in data["entries"]:
        ans = e["answer"]
        new_ans = ans
        for m in QUOTE_CITE.finditer(ans):
            quote, cite = m.group(1), m.group(2)
            refs = parse_ref_list(cite)
            source = bsb_text(con, refs)
            if not source:
                continue
            total += 1
            ov = override_for(e["id"], quote)
            if ov is not None:
                if ov != quote:
                    mismatched += 1
                    print(f"[{e['id']}] ({cite}) OVERRIDE\n   was: {quote}\n   BSB: {ov}\n")
                    new_ans = new_ans.replace(f'"{quote}"', f'"{ov}"', 1)
                continue
            segments = [s for s in re.split(r"\.\.\.|…", quote)]
            new_segments = []
            changed = False
            for s in segments:
                if not norm_words(s):
                    new_segments.append(s)
                    continue
                if " ".join(norm_words(s)) in " ".join(norm_words(source)):
                    new_segments.append(s)  # already BSB wording
                    continue
                ratio, bsb = best_window(s, source)
                if ratio >= 0.55:
                    lead = " " if s[:1] == " " else ""
                    trail = " " if s[-1:] == " " else ""
                    new_segments.append(lead + clean_edges(bsb) + trail)
                    changed = True
                else:
                    new_segments.append(s)
                    unsure.append((e["id"], cite, s.strip(), round(ratio, 2)))
            if changed:
                mismatched += 1
                replacement = tidy("...".join(new_segments))
                print(f"[{e['id']}] ({cite})\n   was: {quote}\n   BSB: {replacement}\n")
                new_ans = new_ans.replace(f'"{quote}"', f'"{replacement}"', 1)
        if fix and new_ans != ans:
            e["answer"] = new_ans
            fixed += 1
    print(f"quotations checked: {total} | not BSB wording: {mismatched} | entries changed: {fixed if fix else 0}")
    if unsure:
        print("\nNeeds a human look (no close BSB match -- paraphrase, wrong citation, or a quote from a different verse):")
        for u in unsure:
            print("  ", u)
    if fix:
        QA.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", "utf-8")
        print(f"rewrote {QA}")


if __name__ == "__main__":
    main("--fix" in sys.argv)
