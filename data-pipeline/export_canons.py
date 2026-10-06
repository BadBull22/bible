"""Exports the SWORD versification tables (book order + verses per chapter for each of the
18 systems: KJV, NRSV, Vulg, MT, LXX, ...) from the pysword package to
src-tauri/src/library/canons.json, which the app's SWORD module reader embeds. A verse's
position in a SWORD Bible/commentary index file depends entirely on these tables.

pysword (MIT) took them from the SWORD engine's own canon_*.h headers.
Usage: export_canons.py   (needs `pip install pysword`)
"""
import json
from pathlib import Path

from pysword.canons import canons

OUT = Path(__file__).resolve().parent.parent / "src-tauri" / "src" / "library" / "canons.json"
out = {
    name: {t: [[osis, lengths] for (_full, osis, _abbr, lengths) in c[t]] for t in ("ot", "nt") if t in c}
    for name, c in canons.items()
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
print(f"{len(out)} versifications -> {OUT} ({OUT.stat().st_size // 1024} KB)")
for name, c in out.items():
    print(f"  {name}: {len(c.get('ot', []))} OT books, {len(c.get('nt', []))} NT books")
