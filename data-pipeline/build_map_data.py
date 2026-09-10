"""Builds the static assets the Map panel loads from `public/map/`:

  - land.geojson, rivers.geojson, lakes.geojson: a coastline/river/lake basemap for the
    biblical world, clipped from Natural Earth's public-domain 1:50m vectors so the app
    can render it fully offline (no tile server, no attribution required).
  - modern-places.json: for places we can confidently link, the modern name/coordinates
    matched from OpenBible.info's Bible-Geocoding-Data (CC BY 4.0) by normalized name
    against this app's own bundled Theographic place names.
  - seas.geojson: a curated subset of Natural Earth's marine polygons (Mediterranean,
    Red Sea, Persian Gulf, etc.) -- the ones actually relevant to Bible geography.

NOT built by this script: public/map/territories.geojson (hand-drawn schematic kingdom
outlines across five eras) comes from build_territories.py instead -- original,
hand-authored content, not derived from any downloaded source.

Network access required (downloads source data); the *output* is what's bundled with the
app, so this only needs rerunning when the source datasets or the target region change.
Run from the data-pipeline directory: `python build_map_data.py`.
"""
import json
import re
import sqlite3
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
OUT_DIR = HERE.parent / "public" / "map"
DB_PATH = HERE.parent / "src-tauri" / "resources" / "commentaries.db"

NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
OPENBIBLE_BASE = "https://raw.githubusercontent.com/openbibleinfo/Bible-Geocoding-Data/main/data/"

# lon/lat box covering everywhere a bundled place is actually geocoded to -- not just the
# Levant/Mesopotamia core, but the outliers too (Tarshish/Spain to the west, Ophir/India to
# the east). Widen it if a future place ever plots as a floating marker with no basemap
# under it (check entities.latitude/longitude's true min/max in commentaries.db).
MIN_LON, MAX_LON = -10.0, 80.0
MIN_LAT, MAX_LAT = 9.0, 48.0
COORD_ROUND = 3  # ~110m precision at the equator -- plenty at this zoom range

MIN_MODERN_CONFIDENCE = 500  # OpenBible's vote_average is 0-1000; keep only fairly confident links


def fetch_json(url: str):
    with urllib.request.urlopen(url, timeout=120) as resp:
        return json.load(resp)


def fetch_text(url: str) -> str:
    with urllib.request.urlopen(url, timeout=120) as resp:
        return resp.read().decode("utf-8")


# ---------- basemap (Natural Earth) ----------

def round_coords(obj):
    if isinstance(obj, float):
        return round(obj, COORD_ROUND)
    if isinstance(obj, list):
        return [round_coords(x) for x in obj]
    return obj


def any_point_in_box(geom) -> bool:
    """True if any single point of the geometry falls in the target box. Deliberately not
    a bbox-of-whole-geometry test: countries whose polygon set spans the antimeridian
    (Russia's Far East, the USA via Alaska/Hawaii) produce a naive min/max that wraps the
    whole globe and would falsely "overlap" every region."""

    def walk(c):
        if not c:
            return False
        if isinstance(c[0], (int, float)):
            return MIN_LON <= c[0] <= MAX_LON and MIN_LAT <= c[1] <= MAX_LAT
        return any(walk(sub) for sub in c)

    return walk(geom["coordinates"])


def clip_line_coords(coords, depth):
    """Drop points far outside the box so long lines (e.g. the Nile) don't carry geometry
    for parts of the world we'll never display. Not a true geometric clip (no edge
    interpolation) -- fine at this zoom range."""
    if depth == 0:
        return [c for c in coords if MIN_LON - 5 <= c[0] <= MAX_LON + 5 and MIN_LAT - 5 <= c[1] <= MAX_LAT + 5]
    return [clip_line_coords(c, depth - 1) for c in coords]


def build_layer(features, keep_props, geom_types, clip_lines=False):
    out = []
    for f in features:
        geom = f.get("geometry")
        if not geom or geom["type"] not in geom_types or not any_point_in_box(geom):
            continue
        props = {k: f["properties"].get(k) for k in keep_props if f["properties"].get(k)}
        coords = geom["coordinates"]
        if clip_lines:
            depth = 1 if geom["type"] == "MultiLineString" else 0
            coords = clip_line_coords(coords, depth)
            if depth == 1:
                coords = [line for line in coords if len(line) >= 2]
                if not coords:
                    continue
            elif len(coords) < 2:
                continue
        out.append({"type": "Feature", "properties": props, "geometry": {"type": geom["type"], "coordinates": round_coords(coords)}})
    return {"type": "FeatureCollection", "features": out}


SEA_NAMES = {
    "Mediterranean Sea", "Red Sea", "Persian Gulf", "Black Sea", "Caspian Sea",
    "Aegean Sea", "Adriatic Sea", "Gulf of Aden", "Arabian Sea", "Gulf of Oman",
}


def build_basemap():
    print("== basemap (Natural Earth, public domain) ==")
    specs = [
        ("land.geojson", "ne_50m_admin_0_countries.geojson", ["NAME"], ["Polygon", "MultiPolygon"], False),
        ("rivers.geojson", "ne_50m_rivers_lake_centerlines.geojson", ["name"], ["LineString", "MultiLineString"], True),
        ("lakes.geojson", "ne_50m_lakes.geojson", ["name"], ["Polygon", "MultiPolygon"], False),
    ]
    for out_name, source_name, keep_props, geom_types, clip_lines in specs:
        data = fetch_json(NE_BASE + source_name)
        layer = build_layer(data["features"], keep_props, geom_types, clip_lines)
        out_path = OUT_DIR / out_name
        out_path.write_text(json.dumps(layer, separators=(",", ":")), encoding="utf-8")
        print(f"  {out_name}: {len(layer['features'])} features, {out_path.stat().st_size / 1024:.0f} KB")

    # Seas/gulfs: a curated allowlist of the biblically-relevant ones, not the full marine
    # layer (which also carries the Bay of Bengal, the North Atlantic, etc.)
    marine = fetch_json(NE_BASE + "ne_50m_geography_marine_polys.geojson")
    features = [f for f in marine["features"] if f["properties"].get("name") in SEA_NAMES]
    layer = build_layer(features, ["name"], ["Polygon", "MultiPolygon"])
    out_path = OUT_DIR / "seas.geojson"
    out_path.write_text(json.dumps(layer, separators=(",", ":")), encoding="utf-8")
    print(f"  seas.geojson: {len(layer['features'])} features, {out_path.stat().st_size / 1024:.0f} KB")


# ---------- ancient <-> modern place-name links (OpenBible.info) ----------

def normalize(name: str) -> str:
    name = name.lower()
    name = re.sub(r"\s*\([^)]*\)\s*", " ", name)  # strip "(of Judah)"-style qualifiers
    name = re.sub(r"[’']", "", name)
    name = re.sub(r"[^a-z0-9]+", " ", name)
    return name.strip()


def build_modern_places():
    print("== ancient/modern place links (OpenBible.info Bible-Geocoding-Data, CC BY 4.0) ==")
    modern_index = {}
    for line in fetch_text(OPENBIBLE_BASE + "modern.jsonl").splitlines():
        r = json.loads(line)
        lonlat = r.get("lonlat")
        if not lonlat:
            continue
        lon, lat = (float(x) for x in lonlat.split(","))
        names = r.get("names") or []
        name = names[0]["name"] if names else r.get("friendly_id")
        modern_index[r["id"]] = {"name": name, "lat": lat, "lon": lon}
    print(f"  modern.jsonl: {len(modern_index)} places")

    ancient_index = {}  # normalized ancient name -> (modern_id, confidence)
    for line in fetch_text(OPENBIBLE_BASE + "ancient.jsonl").splitlines():
        r = json.loads(line)
        fid = r.get("friendly_id")
        if not fid:
            continue
        best = None
        for ident in r.get("identifications") or []:
            modern_id = ident.get("id")
            if ident.get("id_source") != "modern" or not modern_id:
                continue
            score = (ident.get("score") or {}).get("vote_average", 0)
            if best is None or score > best[1]:
                best = (modern_id, score)
        if best:
            ancient_index[normalize(fid)] = best
    print(f"  ancient.jsonl: {len(ancient_index)} places with a modern identification")

    con = sqlite3.connect(DB_PATH)
    rows = con.execute("SELECT id, name FROM entities WHERE kind = 'place'").fetchall()
    con.close()
    print(f"  bundled Theographic places: {len(rows)}")

    out = {}
    for place_id, name in rows:
        candidate = ancient_index.get(normalize(name))
        if not candidate:
            continue
        modern_id, confidence = candidate
        if confidence < MIN_MODERN_CONFIDENCE:
            continue
        m = modern_index.get(modern_id)
        if not m:
            continue
        out[place_id] = {"name": m["name"], "lat": round(m["lat"], 5), "lon": round(m["lon"], 5), "confidence": confidence}

    out_path = OUT_DIR / "modern-places.json"
    out_path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"  matched {len(out)} places -> {out_path.name} ({out_path.stat().st_size / 1024:.0f} KB)")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    build_basemap()
    if DB_PATH.exists():
        build_modern_places()
    else:
        print("commentaries.db not built yet -- skipping modern-places.json (run build_commentaries.py first)")


if __name__ == "__main__":
    main()
