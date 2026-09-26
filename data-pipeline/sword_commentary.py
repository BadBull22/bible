"""Minimal reader for CrossWire SWORD compressed commentary modules (zCom, BlockType=BOOK),
KJV versification -- enough to import John Wesley's Notes and the Scofield Reference Notes.

Format (SWORD zverse.cpp):
  <testament>.bzs  12-byte records: u32 offset, u32 compressed size, u32 uncompressed size
                   into <testament>.bzz, one per (zlib-compressed) block
  <testament>.bzv  10-byte records, one per verse-index slot: u32 block, u32 offset, u16 size
                   (offset/size within the decompressed block)
Verse-index slots per testament, in KJV order: 0 = module heading, 1 = testament heading,
then for each book a book-heading slot, and for each chapter a chapter-heading slot
followed by one slot per verse. Verified against the files: OT has 24,115 slots
(23,145 verses + 929 chapters + 39 books + 2) and NT 8,246 (7,957 + 260 + 27 + 2).

Several consecutive verses covered by one note point at the same (block, offset, size);
those repeats are reported only once, at the first verse.
"""

import struct
import zlib
from pathlib import Path


def read_zcom(module_dir: Path, chapter_verses: dict[str, list[int]], ot_books: list[str], nt_books: list[str]):
    """Yield (book, chapter, verse, raw_text) -- verse 0 = chapter introduction, and
    (book, 0, 0, text) for a book introduction. ``chapter_verses[book]`` lists the verse
    count of each chapter in KJV versification."""
    conf = next((module_dir / "mods.d").glob("*.conf")).read_text("utf-8", "replace")
    fields = {}
    for line in conf.splitlines():
        if "=" in line and not line.startswith("["):
            k, v = line.split("=", 1)
            fields.setdefault(k.strip(), v.strip())
    base = (module_dir / fields["DataPath"].lstrip("./")).resolve()
    enc = "utf-8" if fields.get("Encoding", "").upper() == "UTF-8" else "cp1252"

    for testament, books in (("ot", ot_books), ("nt", nt_books)):
        bzs = (base / f"{testament}.bzs").read_bytes()
        bzv = (base / f"{testament}.bzv").read_bytes()
        bzz = (base / f"{testament}.bzz").read_bytes()
        cache: dict[int, bytes] = {}

        def block(n: int) -> bytes:
            if n not in cache:
                off, size, _ = struct.unpack_from("<III", bzs, n * 12)
                cache[n] = zlib.decompress(bzz[off : off + size])
            return cache[n]

        def slot(i: int):
            if (i + 1) * 10 > len(bzv):
                return None
            return struct.unpack_from("<IIH", bzv, i * 10)

        expected = 2 + sum(1 + sum(1 + n for n in chapter_verses[b]) for b in books)
        if expected != len(bzv) // 10:
            raise ValueError(f"{testament}: versification mismatch, expected {expected} slots, file has {len(bzv) // 10}")

        idx = 2
        last_key = None
        for book in books:
            entries = [(book, 0, 0, idx)]
            idx += 1
            for ch, n in enumerate(chapter_verses[book], start=1):
                entries.append((book, ch, 0, idx))
                idx += 1
                for v in range(1, n + 1):
                    entries.append((book, ch, v, idx))
                    idx += 1
            for b, ch, v, i in entries:
                s = slot(i)
                if not s or s[2] == 0:
                    continue
                key = s
                if key == last_key:
                    continue  # same note as the previous verse (a linked range)
                last_key = key
                data = block(s[0])[s[1] : s[1] + s[2]]
                text = data.decode(enc, "replace").strip("\x00").strip()
                if text:
                    yield b, ch, v, text


if __name__ == "__main__":
    import sqlite3
    import sys

    from books import CANONICAL_BOOKS

    root = Path(__file__).resolve().parent.parent
    con = sqlite3.connect(root / "src-tauri" / "resources" / "bible.db")
    cv: dict[str, list[int]] = {}
    for name, ch, n in con.execute(
        "SELECT b.name, v.chapter, MAX(v.verse) FROM verses v JOIN books b ON b.id=v.book_id "
        "JOIN versions ver ON ver.id=v.version_id WHERE ver.code='KJV' GROUP BY b.name, v.chapter ORDER BY b.order_index, v.chapter"
    ):
        cv.setdefault(name, []).append(n)
    ot = [n for (_, n, t, _) in CANONICAL_BOOKS if t == "OT"]
    nt = [n for (_, n, t, _) in CANONICAL_BOOKS if t == "NT"]
    want = sys.argv[2:] or ["John 3"]
    for b, ch, v, text in read_zcom(Path(sys.argv[1]), cv, ot, nt):
        if f"{b} {ch}" in want:
            print(f"--- {b} {ch}:{v}")
            print(text[:900])
