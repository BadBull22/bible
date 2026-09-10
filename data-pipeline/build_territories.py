"""Builds public/map/territories.geojson: hand-drawn, schematic territory outlines across
five eras for the Map panel's timeline (Conquest & Judges / Divided Monarchy / Assyrian
Empire / Babylonian & Persian Empire / Roman-NT). Original content, not derived from any
downloaded source -- there's no free ready-made GIS dataset for ancient Near Eastern
political boundaries -- built from this app's own bundled place coordinates (plus a few
well-known, uncontroversial empire-capital identifications) as anchor points, then
deliberately kept coarse. Real borders shifted constantly and are scholarly-contested;
this illustrates rough relative position between neighbors, not a reconstruction. Edit the
TERRITORIES list directly if it needs to change; nothing here is auto-generated from an
external source, so there's nothing to "rerun" other than this script itself.
"""
import json
from pathlib import Path

OUT_PATH = Path(__file__).parent.parent / "public" / "map" / "territories.geojson"

ERAS = [
    {"key": "conquest", "label": "Conquest & Judges", "years": "c. 1400–1050 BC"},
    {"key": "monarchy", "label": "Divided Monarchy", "years": "c. 930–722 BC"},
    {"key": "assyrian", "label": "Assyrian Empire", "years": "c. 700 BC"},
    {"key": "persian", "label": "Babylonian & Persian Empire", "years": "c. 550–450 BC"},
    {"key": "roman", "label": "Roman / New Testament", "years": "1st century AD"},
]

TERRITORIES = [
    # ---- Conquest & Judges (~1400-1050 BC) ----
    {"era": "conquest", "name": "Canaan", "color": "#6b8f47", "ring": [
        (34.75, 32.05), (35.15, 33.05), (35.55, 33.25), (35.65, 33.00), (35.60, 31.95),
        (35.45, 31.90), (35.45, 31.18), (35.20, 31.00), (34.84, 31.245), (34.70, 31.55),
        (34.46, 31.50), (34.75, 32.05),
    ]},
    {"era": "conquest", "name": "Amorites (Og & Sihon)", "color": "#7c7f8a", "ring": [
        (35.65, 33.00), (35.85, 33.35), (36.05, 32.95), (36.30, 32.20), (36.20, 31.20),
        (35.75, 31.25), (35.60, 31.95), (35.65, 33.00),
    ]},
    {"era": "conquest", "name": "Ammon", "color": "#c8963e", "ring": [
        (36.30, 32.20), (36.60, 32.10), (36.50, 31.70), (36.20, 31.80), (36.30, 32.20),
    ]},
    {"era": "conquest", "name": "Moab", "color": "#b08a5a", "ring": [
        (35.75, 31.25), (36.20, 31.20), (36.20, 30.95), (35.75, 30.95), (35.70, 31.18),
        (35.75, 31.25),
    ]},
    {"era": "conquest", "name": "Edom", "color": "#9c4a4a", "ring": [
        (35.75, 30.95), (36.20, 30.95), (36.40, 30.30), (35.60, 29.40), (34.90, 30.85),
        (35.20, 31.00), (35.75, 30.95),
    ]},
    {"era": "conquest", "name": "Phoenicia", "color": "#8a5ba0", "ring": [
        (35.05, 34.05), (35.37, 33.56), (35.21, 33.27), (35.15, 33.05), (35.35, 33.05),
        (35.55, 33.55), (35.35, 34.05), (35.05, 34.05),
    ]},
    {"era": "conquest", "name": "Amalekites", "color": "#a15c4a", "ring": [
        (34.90, 30.85), (34.60, 30.60), (34.30, 30.80), (34.46, 31.20), (34.84, 31.245),
        (34.90, 30.85),
    ]},

    # ---- Divided Monarchy (~930-722 BC) ----
    {"era": "monarchy", "name": "Israel", "color": "#c8963e", "ring": [
        (35.15, 33.05), (35.55, 33.25), (35.85, 33.35), (36.05, 32.95), (36.05, 32.57),
        (35.75, 32.30), (35.60, 31.95), (35.45, 31.90), (35.22, 31.93), (34.75, 32.05),
        (35.15, 33.05),
    ]},
    {"era": "monarchy", "name": "Judah", "color": "#6b8f47", "ring": [
        (35.22, 31.93), (35.45, 31.90), (35.45, 31.18), (35.20, 31.00), (34.84, 31.245),
        (34.70, 31.55), (34.85, 31.75), (35.05, 31.85), (35.22, 31.93),
    ]},
    {"era": "monarchy", "name": "Philistia", "color": "#a15c4a", "ring": [
        (34.46, 31.50), (34.55, 31.66), (34.66, 31.76), (34.85, 31.78), (34.84, 31.69),
        (34.70, 31.55), (34.55, 31.40), (34.46, 31.50),
    ]},
    {"era": "monarchy", "name": "Phoenicia", "color": "#8a5ba0", "ring": [
        (35.05, 34.05), (35.37, 33.56), (35.21, 33.27), (35.15, 33.05), (35.35, 33.05),
        (35.55, 33.55), (35.35, 34.05), (35.05, 34.05),
    ]},
    {"era": "monarchy", "name": "Aram", "color": "#7c7f8a", "ring": [
        (35.85, 33.35), (35.90, 32.90), (36.30, 32.90), (37.20, 33.30), (37.00, 34.30),
        (36.75, 35.14), (35.90, 34.60), (35.85, 33.35),
    ]},
    {"era": "monarchy", "name": "Ammon", "color": "#c8963e", "ring": [
        (35.60, 31.95), (35.75, 32.30), (36.30, 32.20), (36.30, 31.80), (35.81, 31.75),
        (35.60, 31.90), (35.60, 31.95),
    ]},
    {"era": "monarchy", "name": "Moab", "color": "#b08a5a", "ring": [
        (35.81, 31.75), (36.30, 31.80), (36.20, 31.20), (35.75, 30.95), (35.70, 31.18),
        (35.75, 31.25), (35.78, 31.50), (35.81, 31.75),
    ]},
    {"era": "monarchy", "name": "Edom", "color": "#9c4a4a", "ring": [
        (35.75, 30.95), (36.20, 31.20), (36.40, 30.30), (35.60, 29.40), (34.90, 30.85),
        (35.20, 31.00), (35.75, 30.95),
    ]},

    # ---- Assyrian Empire (~700 BC) ----
    {"era": "assyrian", "name": "Assyrian Empire", "color": "#a15c4a", "ring": [
        (35.15, 33.05), (36.75, 35.14), (38.5, 37.0), (44.0, 38.0), (48.5, 34.8),
        (49.0, 32.0), (48.0, 29.0), (44.5, 30.0), (42.0, 29.0), (37.0, 31.0),
        (34.90, 31.0), (34.46, 31.5), (35.15, 33.05),
    ]},
    {"era": "assyrian", "name": "Egypt", "color": "#6b8f47", "ring": [
        (30.0, 31.5), (32.2, 31.3), (33.0, 30.5), (32.9, 29.0), (32.64, 25.70),
        (31.5, 25.0), (30.0, 27.0), (29.0, 30.0), (30.0, 31.5),
    ]},

    # ---- Babylonian & Persian Empire (~550-450 BC) ----
    {"era": "persian", "name": "Persian Empire", "color": "#c8963e", "ring": [
        (23.0, 40.0), (28.1, 38.5), (36.0, 37.0), (44.0, 39.0), (50.0, 40.0),
        (62.0, 37.0), (70.0, 30.0), (67.0, 25.0), (57.0, 26.0), (48.0, 29.0),
        (44.5, 30.0), (37.0, 31.0), (32.9, 29.0), (32.64, 25.70), (31.5, 20.0),
        (28.0, 25.0), (25.0, 32.0), (23.0, 35.0), (23.0, 40.0),
    ]},

    # ---- Roman / New Testament (1st century AD) ----
    {"era": "roman", "name": "Galilee", "color": "#c8963e", "ring": [
        (34.75, 33.00), (35.15, 33.05), (35.55, 33.25), (35.65, 33.00), (35.60, 32.75),
        (35.20, 32.60), (34.95, 32.75), (34.75, 33.00),
    ]},
    {"era": "roman", "name": "Samaria", "color": "#b08a5a", "ring": [
        (34.85, 32.60), (35.20, 32.65), (35.60, 32.55), (35.55, 32.15), (35.30, 31.95),
        (34.95, 32.05), (34.80, 32.30), (34.85, 32.60),
    ]},
    {"era": "roman", "name": "Judea", "color": "#6b8f47", "ring": [
        (35.30, 31.95), (35.55, 32.15), (35.45, 31.90), (35.45, 31.18), (35.20, 31.00),
        (34.84, 31.245), (34.70, 31.55), (34.85, 31.75), (34.95, 32.05), (35.30, 31.95),
    ]},
    {"era": "roman", "name": "Perea", "color": "#7c7f8a", "ring": [
        (35.55, 32.10), (35.90, 32.05), (35.95, 31.60), (35.70, 31.15), (35.55, 31.20),
        (35.50, 31.80), (35.55, 32.10),
    ]},
    {"era": "roman", "name": "Decapolis", "color": "#8a5ba0", "ring": [
        (35.55, 32.75), (36.00, 32.70), (36.10, 32.20), (35.90, 32.05), (35.55, 32.10),
        (35.50, 32.50), (35.55, 32.75),
    ]},
    {"era": "roman", "name": "Idumea", "color": "#a15c4a", "ring": [
        (35.20, 31.00), (34.84, 31.10), (34.60, 30.80), (34.90, 30.50), (35.30, 30.60),
        (35.20, 31.00),
    ]},
    {"era": "roman", "name": "Nabatea", "color": "#9c4a4a", "ring": [
        (35.75, 30.95), (36.40, 30.30), (36.00, 29.50), (35.30, 29.60), (35.00, 30.40),
        (35.60, 30.90), (35.75, 30.95),
    ]},
    {"era": "roman", "name": "Phoenicia", "color": "#8a5ba0", "ring": [
        (35.05, 34.05), (35.37, 33.56), (35.21, 33.27), (35.15, 33.05), (35.35, 33.05),
        (35.55, 33.55), (35.35, 34.05), (35.05, 34.05),
    ]},
]


def main():
    features = []
    for t in TERRITORIES:
        features.append({
            "type": "Feature",
            "properties": {"era": t["era"], "name": t["name"], "color": t["color"]},
            "geometry": {"type": "Polygon", "coordinates": [[list(pt) for pt in t["ring"]]]},
        })
    out = {"type": "FeatureCollection", "features": features, "eras": ERAS}
    path = OUT_PATH
    path.write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"{path}: {len(features)} territories across {len(ERAS)} eras, {path.stat().st_size} bytes")
    for e in ERAS:
        n = sum(1 for t in TERRITORIES if t["era"] == e["key"])
        print(f"  {e['key']}: {n} territories")


if __name__ == "__main__":
    main()
