"""Illustrations and quotations for the sermon builder, from public-domain books on Project
Gutenberg:

  * Moody's Anecdotes and Illustrations (D. L. Moody, comp. J. B. McClure, 1877/1896) -- #19830
  * Moody's Stories, a second volume of anecdotes (1899) -- #33024
  * Gleanings among the Sheaves (C. H. Spurgeon, 1869) -- #42657

    python data-pipeline/build_illustrations.py <folder with pg19830.txt pg33024.txt pg42657.txt>

Each book is a run of short pieces, a title line and its text, with two or more blank lines
between them. Moody's Anecdotes groups its stories under subjects in capitals ("FAITH.",
"FORGIVENESS.") and puts short sayings between them under "GOLD."; those sayings become
quotations, the stories illustrations. Spurgeon's pieces are short meditations: quotations.

Writes src-tauri/resources/illustrations.json:
  [{id, kind: "illustration" | "quote", source, title, subject, text}]
"""
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(os.path.abspath(__file__)).parents[1]
OUT = ROOT / "src-tauri" / "resources" / "illustrations.json"

BOOKS = [
    ("pg19830.txt", "Moody's Anecdotes and Illustrations (D. L. Moody, 1877)", "moody"),
    ("pg33024.txt", "Moody's Stories (D. L. Moody, 1899)", "stories"),
    ("pg42657.txt", "Gleanings among the Sheaves (C. H. Spurgeon, 1869)", "gleanings"),
]


def body_of(text: str) -> str:
    s = text.find("*** START")
    e = text.find("*** END")
    t = text[text.find("\n", s) + 1 : e if e > 0 else None]
    t = t.replace("\r", "")
    t = re.sub(r"\[Illustration[^\]]*\]", "", t)
    return t


def tidy(text: str) -> str:
    paras = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", text)]
    text = "\n\n".join(p for p in paras if p)
    return text.replace("--", "—").replace("_", "")


def pieces(text: str) -> list[tuple[str, str]]:
    """(title, text) for each piece: blocks separated by two or more blank lines, whose first
    line is a short title."""
    out = []
    for block in re.split(r"\n\s*\n\s*\n+", text):
        lines = block.strip("\n").split("\n")
        if len(lines) < 2:
            out.append((lines[0].strip(), ""))
            continue
        first = lines[0].strip()
        if len(first) <= 70 and not re.search(r"[,;]$", first) and (len(lines) > 1 and not lines[1].strip()):
            out.append((first.strip("_ .").strip(), "\n".join(lines[1:])))
        else:
            out.append(("", block))
    return out


def main() -> None:
    src = Path(sys.argv[1])
    items: list[dict] = []
    for file, source, code in BOOKS:
        text = body_of((src / file).read_text(encoding="utf-8"))
        subject = ""
        gold = False
        n = 0
        for title, body in pieces(text):
            # a subject heading in capitals ("FAITH.") on its own, or with a first piece under it
            heading = re.fullmatch(r"[A-Z][A-Z ,'’\-]{2,40}\.?", title) is not None and title.upper() == title
            if heading:
                if title.rstrip(".") == "GOLD":
                    gold = True
                else:
                    subject = title.rstrip(".").title()
                    gold = False
                if not body.strip():
                    continue
                title = ""
            body = tidy(body)
            if subject == "Revised Edition":  # the book's front matter, before the first subject
                continue
            if code == "moody" and gold:
                # the sayings: one quotation each paragraph (each starts with a dash in the book)
                for para in body.split("\n\n"):
                    para = re.sub(r"^[—\-]\s*", "", para)
                    if 40 <= len(para) <= 600:
                        n += 1
                        items.append({"id": f"{code}-g{n}", "kind": "quote", "source": source, "title": "", "subject": subject, "text": para})
                continue
            if not (150 <= len(body) <= 4000) or not title:
                continue
            title = re.sub(r"^[\"“]|[\"”]\.?$", "", title).strip()
            n += 1
            items.append(
                {
                    "id": f"{code}-{n}",
                    "kind": "quote" if code == "gleanings" else "illustration",
                    "source": source,
                    "title": title,
                    "subject": subject if code == "moody" else "",
                    "text": body,
                }
            )
    by_book = {}
    for i in items:
        by_book.setdefault((i["source"].split(" (")[0], i["kind"]), 0)
        by_book[(i["source"].split(" (")[0], i["kind"])] += 1
    for k, v in by_book.items():
        print(f"{k[0]}: {v} {k[1]}s")
    OUT.write_text(json.dumps(items, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(items)} in all -> {OUT} {OUT.stat().st_size / 1048576:.2f} MB")


if __name__ == "__main__":
    main()
