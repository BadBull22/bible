import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api, EntityDetail, EntitySummary, MapPlace } from "../api";
import { CloseIcon } from "./icons";

interface Props {
  onClose: () => void;
  onJump: (book: string, chapter: number, verse: number) => void;
  /** A place opened elsewhere (People & Places) that the map should already be
   * showing/selected on when it mounts, so switching panels doesn't lose your spot. */
  initialFocusId: string | null;
  onFocusPlace: (id: string) => void;
}

type Mode = "ancient" | "modern";

interface ModernMatch {
  name: string;
  lat: number;
  lon: number;
  confidence: number;
}

interface EraInfo {
  key: string;
  label: string;
  years: string;
}

// The map opens with no kingdom overlay at all -- a neutral view of just places and
// geography -- until the timeline is actually dragged to a specific era. This is a
// UI-only entry (not part of territories.geojson): no features carry this era, so
// populateTerritoryLayer's filter naturally renders nothing for it.
const NO_ERA = "none";

// Same semantic palette CrossRefGraph uses for testaments, extended with a few
// terrain-ish hues -- keeps the app's colour language consistent across panels.
const COLORS: Record<string, string> = {
  city: "#c8963e",
  region: "#9c5b3c",
  water: "#5c7cba",
  terrain: "#6b8f47",
  landmark: "#9b6bd4",
  island: "#3f9c96",
  other: "#7c786f",
};

const LEGEND: [string, string][] = [
  ["City", COLORS.city],
  ["Region / country", COLORS.region],
  ["Water", COLORS.water],
  ["Mountain / valley", COLORS.terrain],
  ["Landmark", COLORS.landmark],
  ["Island", COLORS.island],
  ["Other / unspecified", COLORS.other],
];

const ANCIENT_LAND_STYLE = { color: "#a8875f", weight: 1, fillColor: "#ede0c8", fillOpacity: 0.9 };
const MODERN_LAND_STYLE = { color: "#5a6b6b", weight: 1.3, fillColor: "#e3e8e6", fillOpacity: 0.9 };

// A handful of well-known places Theographic leaves uncoordinated because their location
// is disputed, not unknown-and-irrelevant (see data-pipeline/build_commentaries.py). The
// map still plots them, at the most commonly cited traditional spot, clearly marked.
const ESTIMATED_PLACE_IDS = new Set(["eden_354"]);

// Nations covered by the hand-drawn territories.geojson fill layer -- their point-based
// region label (below) is suppressed so the name doesn't appear twice.
const TERRITORY_NAMES = new Set(["Israel", "Judah", "Philistia", "Phoenicia", "Aram", "Syria", "Ammon", "Moab", "Edom"]);

function bucketOf(featureType: string | null): string {
  if (!featureType) return "other";
  if (featureType.startsWith("City")) return "city";
  if (featureType.startsWith("Region")) return "region";
  if (featureType.startsWith("Water")) return "water";
  if (featureType.startsWith("Mountain") || featureType.startsWith("Valley")) return "terrain";
  if (featureType.startsWith("Landmark")) return "landmark";
  if (featureType.startsWith("Island")) return "island";
  return "other";
}

// A bounding-box center (what L.geoJSON(feature).getBounds().getCenter() gives you) can
// land off the actual landmass entirely for an irregular or multi-part shape -- e.g.
// Portugal's thin coastal strip, or Russia once clipped to this map's bounds leaves
// disconnected fragments whose box spans the gap between them. Label placement instead
// uses the area-weighted centroid of the *largest* ring, so the label always sits inside
// real land.
function ringArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function ringCentroid(ring: number[][]): [number, number] {
  let cx = 0,
    cy = 0,
    area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-9) {
    // degenerate ring (near-zero area): fall back to a plain point average
    const n = ring.length || 1;
    const sum = ring.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
    return [sum[0] / n, sum[1] / n];
  }
  return [cx / (6 * area), cy / (6 * area)];
}

/** Centroid (as Leaflet [lat, lon]) of a Polygon/MultiPolygon's largest ring by area. */
function labelPosition(geometry: GeoJSON.Geometry): [number, number] | null {
  const outerRings: number[][][] = geometry.type === "Polygon" ? [geometry.coordinates[0]] : geometry.type === "MultiPolygon" ? geometry.coordinates.map((p) => p[0]) : [];
  let best: { area: number; centroid: [number, number] } | null = null;
  for (const ring of outerRings) {
    const area = Math.abs(ringArea(ring));
    if (!best || area > best.area) best = { area, centroid: ringCentroid(ring) };
  }
  return best ? [best.centroid[1], best.centroid[0]] : null; // GeoJSON is [lon,lat]; Leaflet wants [lat,lon]
}

/** Midpoint (as Leaflet [lat, lon]) of a LineString/MultiLineString's longest part. */
function lineLabelPosition(geometry: GeoJSON.Geometry): [number, number] | null {
  const lines: number[][][] = geometry.type === "LineString" ? [geometry.coordinates] : geometry.type === "MultiLineString" ? geometry.coordinates : [];
  let longest: number[][] | null = null;
  for (const line of lines) {
    if (!longest || line.length > longest.length) longest = line;
  }
  if (!longest || longest.length === 0) return null;
  const mid = longest[Math.floor(longest.length / 2)];
  return [mid[1], mid[0]];
}

function radiusFor(referenceCount: number): number {
  // sqrt scale so a handful of Jerusalem-scale outliers don't dwarf everything else
  return Math.max(3.5, Math.min(9, 3 + Math.sqrt(referenceCount)));
}

// A curated subset of rivers/lakes worth always labeling (unlike region/country labels,
// water names aren't era-specific, so these show in both modes) -- the bundled rivers and
// lakes layers otherwise carry ~130 features across the whole map extent, most of them
// nowhere near the biblical narrative and not worth the visual noise.
const NAMED_RIVERS = new Set(["Nile", "Euphrates", "Al Furat", "Firat", "Tigris", "Dicle", "Jordan"]);
const NAMED_LAKES = new Set(["Dead Sea", "Sea of Galilee"]);

function labelFor(id: string, name: string): string {
  return ESTIMATED_PLACE_IDS.has(id) ? `${name} (estimated)` : name;
}

// Many places in the source data fall back to the same representative point (74 different
// Jerusalem sites -- gates, pools, Golgotha -- share one exact coordinate). No zoom level
// separates identical points, so places sharing a coordinate are fanned out in a sunflower
// spiral around it: even spacing for any cluster size, and the highest-referenced place
// anchors the original spot so it doesn't visibly move.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const JITTER_SPACING_DEG = 0.0012;

function jitterPositions(items: { id: string; lat: number; lon: number; weight: number }[]): Map<string, [number, number]> {
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const key = `${it.lat.toFixed(5)},${it.lon.toFixed(5)}`;
    const arr = groups.get(key);
    if (arr) arr.push(it);
    else groups.set(key, [it]);
  }
  const out = new Map<string, [number, number]>();
  for (const group of groups.values()) {
    if (group.length === 1) {
      out.set(group[0].id, [group[0].lat, group[0].lon]);
      continue;
    }
    const sorted = [...group].sort((a, b) => b.weight - a.weight);
    const lonScale = Math.max(0.2, Math.cos((sorted[0].lat * Math.PI) / 180));
    sorted.forEach((it, i) => {
      if (i === 0) {
        out.set(it.id, [it.lat, it.lon]);
        return;
      }
      const radius = JITTER_SPACING_DEG * Math.sqrt(i);
      const angle = i * GOLDEN_ANGLE;
      out.set(it.id, [it.lat + radius * Math.sin(angle), it.lon + (radius * Math.cos(angle)) / lonScale]);
    });
  }
  return out;
}

export function MapPanel({ onClose, onJump, initialFocusId, onFocusPlace }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [places, setPlaces] = useState<MapPlace[]>([]);
  const [mode, setMode] = useState<Mode>("ancient");
  const [era, setEra] = useState(NO_ERA);
  const [eras, setEras] = useState<EraInfo[]>([]);
  const [modernData, setModernData] = useState<Record<string, ModernMatch> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntitySummary[] | null>(null);

  const markersById = useRef<Map<string, L.CircleMarker>>(new Map());
  const namesById = useRef<Map<string, string>>(new Map());
  const ancientPos = useRef<Map<string, [number, number]>>(new Map());
  const modernPos = useRef<Map<string, [number, number]>>(new Map());
  const modernNameById = useRef<Map<string, string>>(new Map());
  const landLayerRef = useRef<L.GeoJSON | null>(null);
  const countryLabelsRef = useRef<L.LayerGroup | null>(null);
  const regionLabelsRef = useRef<L.LayerGroup | null>(null);
  const territoryLayerRef = useRef<L.LayerGroup | null>(null);
  const territoryFeatures = useRef<GeoJSON.Feature[]>([]);
  const prevSelectedRef = useRef<string | null>(null);
  const initialFocusRef = useRef(initialFocusId); // consumed once, at mount
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  const eraRef = useRef(era);
  eraRef.current = era;

  /** Clears and rebuilds the territory-fill layer from just the given era's features --
   * called on every timeline drag, so the shapes and names change live. */
  function populateTerritoryLayer(eraKey: string) {
    const layer = territoryLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const feature of territoryFeatures.current) {
      const props = feature.properties as { era?: string; name?: string; color?: string } | null;
      if (props?.era !== eraKey) continue;
      L.geoJSON(feature, {
        pane: "territoryPane",
        interactive: false,
        style: { color: "#4a3a28", weight: 1.2, opacity: 0.6, fillColor: props.color ?? COLORS.other, fillOpacity: 0.35 },
      }).addTo(layer);
      const pos = props.name ? labelPosition(feature.geometry) : null;
      if (props.name && pos) {
        L.marker(pos, { icon: L.divIcon({ className: "country-label territory-label", html: props.name }), interactive: false }).addTo(layer);
      }
    }
  }

  function applyEra(next: string) {
    setEra(next);
    populateTerritoryLayer(next);
  }

  /** Repositions/relabels every marker and restyles the basemap for the given era. Plain
   * imperative Leaflet work (not React state derivation), reused both by the toggle
   * buttons and, once, to reconcile a toggle click that happened while data was loading. */
  function applyMode(next: Mode) {
    for (const [id, marker] of markersById.current) {
      const pos = (next === "modern" ? modernPos.current.get(id) : undefined) ?? ancientPos.current.get(id);
      if (pos) marker.setLatLng(pos);
      const modernName = modernNameById.current.get(id);
      marker.setTooltipContent(next === "modern" && modernName ? modernName : namesById.current.get(id) ?? "");
      marker.setStyle({ fillOpacity: next === "modern" && !modernName ? 0.32 : 0.88 });
    }
    landLayerRef.current?.setStyle(next === "modern" ? MODERN_LAND_STYLE : ANCIENT_LAND_STYLE);
    if (mapRef.current) {
      if (next === "modern") {
        regionLabelsRef.current?.remove();
        territoryLayerRef.current?.remove();
        countryLabelsRef.current?.addTo(mapRef.current);
      } else {
        countryLabelsRef.current?.remove();
        regionLabelsRef.current?.addTo(mapRef.current);
        territoryLayerRef.current?.addTo(mapRef.current);
      }
    }
    setMode(next);
  }

  async function select(id: string, flyTo = true) {
    setSelectedId(id);
    setResults(null);
    setQuery("");
    onFocusPlace(id);
    const marker = markersById.current.get(id);
    if (flyTo && marker && mapRef.current) {
      mapRef.current.flyTo(marker.getLatLng(), Math.max(mapRef.current.getZoom(), 11), { duration: 0.6 });
      marker.openTooltip();
    }
    setDetailLoading(true);
    setDetailError(null);
    try {
      const d = await api.getEntity("place", id);
      setDetail(d);
    } catch (e) {
      setDetailError(String(e));
    } finally {
      setDetailLoading(false);
    }
  }

  // Highlight the selected marker (thicker, darker ring) and restore the previous
  // one's default style, so it's visible which place the detail card below belongs to.
  useEffect(() => {
    const prev = prevSelectedRef.current;
    if (prev && prev !== selectedId) markersById.current.get(prev)?.setStyle({ weight: 1, color: "#fffaf0" });
    if (selectedId) {
      const m = markersById.current.get(selectedId);
      m?.setStyle({ weight: 3, color: "#1c1408" });
      m?.bringToFront();
    }
    prevSelectedRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    const handle = setTimeout(() => {
      api
        .searchEntities(q, 30)
        .then((r) => setResults(r.filter((e) => e.kind === "place")))
        .catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  // Map + basemap + markers: built once. The container is a plain div Leaflet owns
  // imperatively (same pattern CrossRefGraph uses for cytoscape) rather than a React
  // wrapper library, so it behaves the same way under StrictMode's mount/unmount/remount.
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const map = L.map(containerRef.current, {
      preferCanvas: true,
      minZoom: 3,
      maxZoom: 15,
      worldCopyJump: false,
      attributionControl: false,
    });
    // Leaflet expects a view established via setView before anything else (fitBounds,
    // invalidateSize) touches the map -- skipping this throws deep inside its internal
    // bounds math ("Cannot read properties of undefined (reading 'min')") the first time
    // fitBounds runs. Roughly centered on the Levant; refined to the data's bounds below.
    map.setView([31, 35], 6);
    mapRef.current = map;
    markersById.current.clear();

    // Its own pane, stacked below the default overlayPane that place markers use (400),
    // so the territory fill always renders underneath them -- regardless of the order
    // things get added/rebuilt in. Without this, every timeline drag re-inserts fresh
    // polygons *after* the markers already on the map, which puts them on top and blocks
    // marker clicks (draw/hit-test order follows insertion time, not layer grouping).
    map.createPane("territoryPane");
    map.getPane("territoryPane")!.style.zIndex = "350";

    L.control.scale({ metric: true, imperial: true, position: "bottomleft" }).addTo(map);

    Promise.all([
      fetch("/map/land.geojson").then((r) => r.json()),
      fetch("/map/rivers.geojson").then((r) => r.json()),
      fetch("/map/lakes.geojson").then((r) => r.json()),
      fetch("/map/seas.geojson").then((r) => r.json()),
      fetch("/map/territories.geojson").then((r) => r.json()),
      fetch("/map/modern-places.json").then((r) => r.json()) as Promise<Record<string, ModernMatch>>,
      api.mapPlaces(),
    ])
      .then(([land, rivers, lakes, seas, territories, modern, mapPlaces]) => {
        if (cancelled) return;

        const landLayer = L.geoJSON(land, { style: ANCIENT_LAND_STYLE }).addTo(map);
        L.geoJSON(rivers, { style: { color: COLORS.water, weight: 1.4, opacity: 0.8 } }).addTo(map);
        L.geoJSON(lakes, { style: { color: "#4a6b9e", weight: 1, fillColor: COLORS.water, fillOpacity: 0.55 } }).addTo(map);
        landLayerRef.current = landLayer;

        // Hand-drawn, schematic kingdom boundaries -- see data-pipeline notes /
        // public/map/territories.geojson. Added before the place markers below so
        // markers render (and stay clickable) on top. All eras are fetched once; the
        // timeline control below just re-filters which ones are drawn, live.
        territoryFeatures.current = territories.features as GeoJSON.Feature[];
        setEras([{ key: NO_ERA, label: "No overlay", years: "drag to choose an era" }, ...((territories as { eras?: EraInfo[] }).eras ?? [])]);
        const territoryLayer = L.layerGroup().addTo(map);
        territoryLayerRef.current = territoryLayer;
        populateTerritoryLayer(eraRef.current);

        // Water names aren't era-specific (the Mediterranean was the Mediterranean then
        // too), so these show in both Ancient and Modern mode -- unlike the region/country
        // label layers below, which swap with the toggle.
        const waterLabels = L.layerGroup().addTo(map);
        for (const feature of seas.features as GeoJSON.Feature[]) {
          const name = (feature.properties as { name?: string } | null)?.name;
          const pos = name ? labelPosition(feature.geometry) : null;
          if (name && pos) L.marker(pos, { icon: L.divIcon({ className: "water-label", html: name }), interactive: false }).addTo(waterLabels);
        }
        for (const feature of rivers.features as GeoJSON.Feature[]) {
          const name = (feature.properties as { name?: string } | null)?.name;
          const pos = name && NAMED_RIVERS.has(name) ? lineLabelPosition(feature.geometry) : null;
          if (name && pos) L.marker(pos, { icon: L.divIcon({ className: "water-label", html: name }), interactive: false }).addTo(waterLabels);
        }
        for (const feature of lakes.features as GeoJSON.Feature[]) {
          const name = (feature.properties as { name?: string } | null)?.name;
          const pos = name && NAMED_LAKES.has(name) ? labelPosition(feature.geometry) : null;
          if (name && pos) L.marker(pos, { icon: L.divIcon({ className: "water-label", html: name }), interactive: false }).addTo(waterLabels);
        }

        const countryLabels = L.layerGroup();
        for (const feature of land.features as GeoJSON.Feature[]) {
          const name = (feature.properties as { NAME?: string } | null)?.NAME;
          const pos = name ? labelPosition(feature.geometry) : null;
          if (!name || !pos) continue;
          L.marker(pos, { icon: L.divIcon({ className: "country-label", html: name }), interactive: false }).addTo(countryLabels);
        }
        countryLabelsRef.current = countryLabels;

        setPlaces(mapPlaces);
        setModernData(modern);
        modernNameById.current = new Map(Object.entries(modern).map(([id, m]) => [id, m.name]));
        ancientPos.current = jitterPositions(mapPlaces.map((p) => ({ id: p.id, lat: p.latitude, lon: p.longitude, weight: p.reference_count })));
        const modernItems = mapPlaces
          .filter((p) => modern[p.id])
          .map((p) => ({ id: p.id, lat: modern[p.id].lat, lon: modern[p.id].lon, weight: p.reference_count }));
        modernPos.current = new Map([...ancientPos.current, ...jitterPositions(modernItems)]);

        // Ancient mode's counterpart to the modern country-border labels: this app's own
        // bundled Region/Region-Country places (Egypt, Moab, Assyria, Canaan, Persia...)
        // rather than sourcing separate ancient political boundaries, which are genuinely
        // contested -- these are at least places the dataset already attests.
        const regionLabels = L.layerGroup();

        for (const p of mapPlaces) {
          namesById.current.set(p.id, labelFor(p.id, p.name));
          const pos = ancientPos.current.get(p.id) ?? [p.latitude, p.longitude];
          const marker = L.circleMarker(pos as [number, number], {
            radius: radiusFor(p.reference_count),
            color: "#fffaf0",
            weight: 1,
            fillColor: COLORS[bucketOf(p.feature_type)],
            fillOpacity: 0.88,
          })
            .bindTooltip(namesById.current.get(p.id) ?? p.name, { direction: "top", offset: [0, -2] })
            .on("click", () => select(p.id, false));
          marker.addTo(map);
          markersById.current.set(p.id, marker);

          if (bucketOf(p.feature_type) === "region" && !TERRITORY_NAMES.has(p.name)) {
            L.marker(pos as [number, number], {
              icon: L.divIcon({ className: "country-label region-label", html: namesById.current.get(p.id) ?? p.name }),
              interactive: false,
            }).addTo(regionLabels);
          }
        }
        regionLabelsRef.current = regionLabels;
        regionLabels.addTo(map); // default mode is "ancient"

        // Reconcile a toggle click that happened while this was still loading.
        if (modeRef.current === "modern") applyMode("modern");

        const focusId = initialFocusRef.current;
        if (focusId && markersById.current.has(focusId)) {
          select(focusId, true);
        } else {
          const bounds = landLayer.getBounds();
          if (bounds.isValid()) map.fitBounds(bounds, { padding: [12, 12] });
        }
        setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      });

    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(containerRef.current);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <aside className="side-panel wide">
      <div className="side-panel-header">
        <h3>Map: places of the biblical world</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="mode-toggle" role="tablist" aria-label="Name era">
        <button role="tab" aria-selected={mode === "ancient"} className={mode === "ancient" ? "active" : ""} onClick={() => applyMode("ancient")}>
          Ancient names
        </button>
        <button role="tab" aria-selected={mode === "modern"} className={mode === "modern" ? "active" : ""} onClick={() => applyMode("modern")}>
          Modern names
        </button>
      </div>
      {mode === "ancient" && eras.length > 0 && (
        <div className="timeline-control">
          <input
            type="range"
            min={0}
            max={eras.length - 1}
            step={1}
            value={Math.max(0, eras.findIndex((e) => e.key === era))}
            onChange={(e) => applyEra(eras[Number(e.target.value)].key)}
            aria-label="Historical era"
          />
          <div className="timeline-label">
            <strong>{eras.find((e) => e.key === era)?.label}</strong>
            <span className="muted"> · {eras.find((e) => e.key === era)?.years}</span>
          </div>
        </div>
      )}
      <div className="search-controls">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a place and fly to it…"
          aria-label="Find a place on the map"
        />
      </div>
      {results && (
        <ul className="xref-list" style={{ marginBottom: "0.6rem" }}>
          {results.length === 0 && <li className="muted">No places match.</li>}
          {results.map((r) => (
            <li key={r.id}>
              <button className="link-btn" onClick={() => select(r.id)}>
                {labelFor(r.id, r.name)}
              </button>
              {r.feature_type && <span className="votes"> {r.feature_type}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="graph-legend" aria-label="Marker legend">
        {LEGEND.map(([label, color]) => (
          <span key={label}>
            <i className="swatch" style={{ background: color }} /> {label}
          </span>
        ))}
      </div>
      <div ref={containerRef} className="map-view" role="img" aria-label="Map of biblical places" />
      {loading && <p className="muted">Loading map…</p>}
      {error && <p className="status-error">Couldn't load the map: {error}</p>}
      {!loading && !error && places.length === 0 && <p className="muted">No geocoded places are bundled.</p>}
      {mode === "modern" && (
        <p className="muted" style={{ marginTop: 0 }}>
          Faded markers have no confidently identified modern site.
        </p>
      )}
      {mode === "ancient" && era !== NO_ERA && (
        <p className="muted" style={{ marginTop: 0 }}>
          Kingdom outlines are schematic — approximate, not a scholarly reconstruction; exact borders shifted over
          time and are disputed.
        </p>
      )}
      <p className="search-hint">
        Coastlines, rivers and lakes: Natural Earth (public domain). Places: Theographic Bible Metadata (CC BY-SA
        4.0). Modern identifications: OpenBible.info Bible-Geocoding-Data (CC BY 4.0). All bundled offline. Click a
        marker, or search above, for a place's history and every reference.
      </p>
      {(detail || detailLoading || detailError) && (
        <div className="entity-detail">
          {detailLoading && !detail && <p className="muted">Loading…</p>}
          {detailError && <p className="status-error">Couldn't load that place: {detailError}</p>}
          {detail && (
            <>
              <h4 className="section-label" style={{ marginTop: "0.75rem" }}>
                {labelFor(detail.id, detail.name)}
              </h4>
              <div className="entity-meta">
                {detail.feature_type && <span className="xref-tag">{detail.feature_type}</span>}
                {detail.latitude != null && detail.longitude != null && (
                  <span className="muted" title="Coordinates">
                    {detail.latitude.toFixed(3)}, {detail.longitude.toFixed(3)}
                  </span>
                )}
              </div>
              {modernData?.[detail.id] && (
                <p className="muted">
                  Known today as <strong>{modernData[detail.id].name}</strong>.
                </p>
              )}
              {detail.description && (
                <div className="commentary-text">
                  {detail.description.split(/\n+/).map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              )}
              <h4 className="section-label">
                {detail.references.length} {detail.references.length === 1 ? "reference" : "references"}
              </h4>
              <div className="citation-row">
                {detail.references.map((r, i) => (
                  <button key={i} className="link-btn" onClick={() => onJump(r.book, r.chapter, r.verse)}>
                    {r.book} {r.chapter}:{r.verse}
                    {r.end_verse && r.end_verse > r.verse ? `–${r.end_verse}` : ""}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
