import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api, TimelineData, TimelineRibbon } from "../api";
import { CloseIcon } from "./icons";

interface Props {
  /** Opens with this genealogy person already selected (used when arriving from Genealogy). */
  focusPersonId?: string;
  onClose: () => void;
  onJump: (book: string, chapter: number, verse: number) => void;
}

/** The `eras` block of public/map/territories.geojson -- shared with the Map panel so the
 * two can't drift apart. `end` is null for an era whose label names a single point in
 * time ("c. 700 BC") rather than a span. */
interface Era {
  key: string;
  label: string;
  years: string;
  start?: number;
  end?: number | null;
}

interface ChartManifest {
  width: number;
  height: number;
  tileSize: number;
  maxZoom: number;
  tileUrl: string;
  attribution: { title: string; author: string; edition: string; licence: string; chronology_note: string };
}

type View = "chart" | "facsimile";

// Adams draws every life as a horizontal ribbon against one shared axis; these are just
// the pixel dimensions of that idea at panel scale.
const ROW_H = 15;
const AXIS_H = 44;
const EVENT_BAND_H = 24;
const ZOOMS = [0.06, 0.12, 0.25, 0.5, 1];
const DEFAULT_ZOOM = 1; // index into ZOOMS
/** Drawn length for someone whose birth is known but whose death is not -- the bar stops
 * and a dashed tail carries Adams' "?" rather than implying a date scripture never gives. */
const OPEN_END_YEARS = 45;

function yearLabel(y: number): string {
  return y < 0 ? `${-y} BC` : `AD ${y}`;
}

/** Years two lives overlapped. This is the synchronism Adams' chart exists to show --
 * "ADAM talked with SETH 800 years" is printed directly on the original. */
function overlapYears(a: TimelineRibbon, b: TimelineRibbon): number {
  if (a.birth_year === null || b.birth_year === null) return 0;
  const aEnd = a.death_year ?? a.birth_year;
  const bEnd = b.death_year ?? b.birth_year;
  const lo = Math.max(a.birth_year, b.birth_year);
  const hi = Math.min(aEnd, bEnd);
  return hi > lo ? hi - lo : 0;
}

const SOURCE_LABEL: Record<string, string> = {
  scripture: "dated from scripture",
  corrected: "corrected",
  dataset: "dataset dates",
  uncertain: "date unknown",
};

export function TimelinePanel({ focusPersonId, onClose, onJump }: Props) {
  const [data, setData] = useState<TimelineData | null>(null);
  const [eras, setEras] = useState<Era[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("chart");
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [selectedId, setSelectedId] = useState<string | null>(focusPersonId ?? null);
  const [manifest, setManifest] = useState<ChartManifest | null>(null);
  const [facsimileError, setFacsimileError] = useState<string | null>(null);
  /** Windowed full screen: the panel covers the app window. A 23-foot wallchart is only
   * really readable zoomed in, and at panel width there isn't room to see much at once. */
  const [fullscreen, setFullscreen] = useState(false);
  const facsimileRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.timelineData(),
      // Same file the Map panel reads, so the nation bands and the map's era overlay are
      // always the same five eras.
      fetch("/map/territories.geojson")
        .then((r) => r.json())
        .then((g: { eras?: Era[] }) => g.eras ?? [])
        .catch(() => [] as Era[]),
    ])
      .then(([timeline, eraList]) => {
        if (cancelled) return;
        setData(timeline);
        setEras(eraList.filter((e) => typeof e.start === "number"));
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const placed = useMemo(() => {
    const rows = (data?.ribbons ?? []).filter((r) => r.birth_year !== null);
    return rows.sort((a, b) => (a.birth_year ?? 0) - (b.birth_year ?? 0));
  }, [data]);
  const undated = useMemo(() => (data?.ribbons ?? []).filter((r) => r.birth_year === null), [data]);

  const px = ZOOMS[zoom];
  const domain = useMemo(() => {
    const ys: number[] = [];
    for (const r of placed) {
      ys.push(r.birth_year!);
      ys.push(r.death_year ?? r.birth_year! + OPEN_END_YEARS);
    }
    for (const e of data?.events ?? []) ys.push(e.year);
    if (ys.length === 0) return { min: -4004, max: 100 };
    return { min: Math.min(...ys) - 50, max: Math.max(...ys) + 50 };
  }, [placed, data]);

  const x = (year: number) => (year - domain.min) * px;
  const chartWidth = Math.max(320, (domain.max - domain.min) * px + 8);
  const chartHeight = AXIS_H + EVENT_BAND_H + placed.length * ROW_H + 10;

  // Resolved against every ribbon, not just the placed ones. Arriving from Genealogy on an
  // undated name -- 25 of the 60 have no year scripture can fix -- must still show that
  // person's detail and say why they aren't on the axis, rather than selecting nothing.
  const selected = useMemo(() => (data?.ribbons ?? []).find((r) => r.id === selectedId) ?? null, [data, selectedId]);
  const contemporaries = useMemo(() => {
    if (!selected) return [];
    return placed
      .filter((r) => r.id !== selected.id)
      .map((r) => ({ person: r, years: overlapYears(selected, r) }))
      .filter((c) => c.years > 0)
      .sort((a, b) => b.years - a.years);
  }, [selected, placed]);
  const lifetimeEvents = useMemo(() => {
    if (!selected || selected.birth_year === null) return [];
    const end = selected.death_year ?? selected.birth_year;
    return (data?.events ?? []).filter((e) => e.year >= selected.birth_year! && e.year <= end);
  }, [selected, data]);

  // Centre whatever is selected. A name picked in Genealogy is usually thousands of years
  // along a scrolling axis, so without this it would be selected off-screen.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !selected || selected.birth_year === null) return;
    const target = (selected.birth_year - domain.min) * px;
    el.scrollTo({ left: Math.max(0, target - el.clientWidth / 2), behavior: "smooth" });
  }, [selected, domain.min, px]);

  // Century pillars every 100 years, thinning their labels as the axis compresses so they
  // never collide; decade lines only once there is room, exactly as the original reads.
  const centuries = useMemo(() => {
    const out: number[] = [];
    for (let y = Math.ceil(domain.min / 100) * 100; y <= domain.max; y += 100) out.push(y);
    return out;
  }, [domain]);
  const labelEvery = px >= 0.5 ? 100 : px >= 0.25 ? 200 : px >= 0.12 ? 500 : 1000;
  const showDecades = px >= 0.5;

  // ---- facsimile: Adams' scan as a Leaflet tile pyramid over CRS.Simple ----
  useEffect(() => {
    if (view !== "facsimile" || !facsimileRef.current) return;
    let map: L.Map | null = null;
    let cancelled = false;
    setFacsimileError(null);
    fetch("/chart/chart.json")
      .then((r) => {
        if (!r.ok) throw new Error(`chart.json ${r.status}`);
        return r.json() as Promise<ChartManifest>;
      })
      .then((m) => {
        const el = facsimileRef.current;
        if (cancelled || !el) return;
        map = L.map(el, {
          crs: L.CRS.Simple,
          minZoom: 0,
          maxZoom: m.maxZoom,
          attributionControl: false,
        });
        // Leaflet wants a view established before anything touches bounds (same trap the
        // Map panel documents), so set one before unprojecting the image corners.
        map.setView([0, 0], 0);
        const sw = map.unproject([0, m.height], m.maxZoom);
        const ne = map.unproject([m.width, 0], m.maxZoom);
        const bounds = L.latLngBounds(sw, ne);
        L.tileLayer(m.tileUrl, { tileSize: m.tileSize, minZoom: 0, maxZoom: m.maxZoom, noWrap: true, bounds }).addTo(map);
        map.fitBounds(bounds);
        map.setMaxBounds(bounds.pad(0.3));
        mapRef.current = map;
        setManifest(m);
      })
      .catch((e) => !cancelled && setFacsimileError(String(e)));
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, [view]);

  // Leaflet caches its container's size, so growing or shrinking the panel leaves it
  // painting at the old dimensions (tiles stop short of the new edges) until it's told.
  useEffect(() => {
    if (view !== "facsimile") return;
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 60);
    return () => clearTimeout(t);
  }, [fullscreen, view]);

  // Esc leaves full screen. Captured before App's window-level Esc handler, which would
  // otherwise close the whole panel rather than just collapsing it back into the sidebar.
  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setFullscreen(false);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [fullscreen]);

  return (
    <aside
      className={`side-panel wide timeline-panel${view === "facsimile" ? " is-facsimile" : ""}${fullscreen ? " is-fullscreen" : ""}`}
    >
      <div className="side-panel-header">
        <h3>Timeline</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>

      <div className="search-controls">
        <div className="mode-toggle" role="tablist" aria-label="Timeline view">
          <button role="tab" aria-selected={view === "chart"} className={view === "chart" ? "active" : ""} onClick={() => setView("chart")}>
            Synchronology
          </button>
          <button role="tab" aria-selected={view === "facsimile"} className={view === "facsimile" ? "active" : ""} onClick={() => setView("facsimile")}>
            Adams' chart
          </button>
        </div>
        <button
          className="outline-btn timeline-fullscreen-btn"
          onClick={() => setFullscreen((f) => !f)}
          aria-pressed={fullscreen}
          title={fullscreen ? "Return to the side panel" : "Fill the window"}
        >
          {fullscreen ? "Exit full screen (Esc)" : "Full screen"}
        </button>
        {view === "chart" && (
          <div className="timeline-zoom">
            <label htmlFor="timeline-zoom">Zoom</label>
            <input
              id="timeline-zoom"
              type="range"
              min={0}
              max={ZOOMS.length - 1}
              step={1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
            <span className="muted">{Math.round((domain.max - domain.min))} years</span>
          </div>
        )}
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="status-error">Couldn't load the timeline: {error}</p>}

      {view === "chart" && !loading && !error && data && (
        <>
          <div className="timeline-scroll" ref={scrollRef}>
            <svg width={chartWidth} height={chartHeight} className="timeline-svg" role="img" aria-label="Lifespans and events against a single time axis">
              {/* nation streams, behind everything */}
              {eras.map((era) => {
                const start = x(era.start!);
                const end = era.end != null ? x(era.end) : null;
                return end === null ? (
                  <g key={era.key}>
                    <line x1={start} y1={AXIS_H} x2={start} y2={chartHeight} className="timeline-era-mark" />
                    <text x={start + 3} y={AXIS_H + 10} className="timeline-era-label">{era.label}</text>
                  </g>
                ) : (
                  <g key={era.key}>
                    <rect x={start} y={AXIS_H} width={Math.max(1, end - start)} height={chartHeight - AXIS_H} className="timeline-era-band" />
                    <text x={start + 3} y={AXIS_H + 10} className="timeline-era-label">{era.label}</text>
                  </g>
                );
              })}

              {/* the ruler: century pillars and, when there is room, decade lines */}
              {showDecades &&
                Array.from({ length: Math.ceil((domain.max - domain.min) / 10) }, (_, i) => Math.ceil(domain.min / 10) * 10 + i * 10)
                  .filter((y) => y % 100 !== 0 && y <= domain.max)
                  .map((y) => <line key={`d${y}`} x1={x(y)} y1={AXIS_H - 8} x2={x(y)} y2={AXIS_H} className="timeline-decade" />)}
              {centuries.map((y) => (
                <g key={`c${y}`}>
                  <line x1={x(y)} y1={AXIS_H - 16} x2={x(y)} y2={chartHeight} className="timeline-century" />
                  {y % labelEvery === 0 && (
                    <text x={x(y) + 3} y={AXIS_H - 20} className="timeline-year">
                      {yearLabel(y)}
                    </text>
                  )}
                </g>
              ))}
              <line x1={0} y1={AXIS_H} x2={chartWidth} y2={AXIS_H} className="timeline-axis" />

              {/* every dated event, as a pin that jumps to the verse recording it */}
              {data.events.map((e) => (
                <rect
                  key={e.id}
                  x={x(e.year) - 0.75}
                  y={AXIS_H + 4}
                  width={1.5}
                  height={EVENT_BAND_H - 10}
                  className="timeline-event"
                  onClick={() => onJump(e.book, e.chapter, e.verse)}
                >
                  <title>{`${e.name} — ${yearLabel(e.year)} (${e.book} ${e.chapter}:${e.verse})`}</title>
                </rect>
              ))}

              {/* one ribbon per life */}
              {placed.map((r, i) => {
                const y = AXIS_H + EVENT_BAND_H + i * ROW_H;
                const open = r.death_year === null;
                const end = r.death_year ?? r.birth_year! + OPEN_END_YEARS;
                const w = Math.max(1.5, x(end) - x(r.birth_year!));
                const isSel = r.id === selectedId;
                return (
                  <g key={r.id} onClick={() => setSelectedId(r.id)} className="timeline-row">
                    <rect
                      x={x(r.birth_year!)}
                      y={y + 2}
                      width={w}
                      height={ROW_H - 5}
                      rx={2}
                      className={`timeline-ribbon src-${r.date_source}${isSel ? " is-selected" : ""}${open ? " is-open" : ""}`}
                    >
                      <title>
                        {`${r.name}: ${yearLabel(r.birth_year!)}${r.death_year !== null ? ` – ${yearLabel(r.death_year)}` : " – ?"}` +
                          (r.lifespan ? ` (${r.lifespan} years, ${r.lifespan_citation})` : "")}
                      </title>
                    </rect>
                    <text x={x(r.birth_year!) + w + 4} y={y + ROW_H - 4} className={`timeline-name${isSel ? " is-selected" : ""}`}>
                      {r.name}
                      {open ? " ?" : ""}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <p className="timeline-legend">
            <span className="swatch src-scripture" /> dated from scripture
            <span className="swatch src-corrected" /> corrected
            <span className="swatch src-dataset" /> dataset
            <span className="swatch is-event" /> event
          </p>

          {selected && (
            <div className="timeline-detail">
              <div className="xref-item-head">
                <button className="link-btn" onClick={() => jumpToCitation(selected.citation, onJump)}>
                  {selected.name}
                </button>
                <span className="votes">{selected.citation}</span>
              </div>
              <p className="timeline-span">
                {selected.birth_year !== null && (
                  <>
                    {yearLabel(selected.birth_year)}
                    {selected.death_year !== null ? ` – ${yearLabel(selected.death_year)}` : " – date unknown"}
                  </>
                )}
                {selected.lifespan !== null && (
                  <>
                    {" · "}
                    <strong>{selected.lifespan} years</strong> ({selected.lifespan_citation})
                  </>
                )}
                <span className={`timeline-badge src-${selected.date_source}`}>{SOURCE_LABEL[selected.date_source]}</span>
              </p>
              {selected.age_at_heir_birth !== null && (
                <p className="snippet">
                  {selected.age_at_heir_birth} years old at the birth of the next in the line ({selected.age_citation}).
                </p>
              )}
              {selected.note && <p className="snippet">{selected.note}</p>}
              {selected.date_note && <p className="snippet timeline-note">{selected.date_note}</p>}

              {contemporaries.length > 0 && (
                <>
                  <h4>Alive at the same time</h4>
                  <ul className="xref-list timeline-contemporaries">
                    {contemporaries.slice(0, 8).map((c) => (
                      <li key={c.person.id}>
                        <button className="link-btn" onClick={() => setSelectedId(c.person.id)}>
                          {c.person.name}
                        </button>
                        <span className="votes">{c.years} years together</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {lifetimeEvents.length > 0 && (
                <>
                  <h4>In his lifetime</h4>
                  <ul className="xref-list">
                    {lifetimeEvents.slice(0, 8).map((e) => (
                      <li key={e.id}>
                        <button className="link-btn" onClick={() => onJump(e.book, e.chapter, e.verse)}>
                          {e.name}
                        </button>
                        <span className="votes">
                          {yearLabel(e.year)} · {e.book} {e.chapter}:{e.verse}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {undated.length > 0 && (
            <div className="timeline-undated">
              <h4>Not datable ?</h4>
              <p className="search-hint" style={{ marginTop: 0 }}>
                Scripture gives no age for these, so they are left off the axis rather than placed at a guess — the
                same `?` Adams prints for a date he could not fix.
              </p>
              <ul className="xref-list">
                {undated.map((r) => (
                  <li key={r.id}>
                    <button className="link-btn" onClick={() => jumpToCitation(r.citation, onJump)}>
                      {r.name}
                    </button>
                    <span className="votes">{r.citation}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="search-hint">
            Lifespans are drawn on Archbishop Ussher's chronology (Creation at 4004 BC), the system Adams used, so the
            two views line up. Where scripture states a lifespan it is preferred over the dataset's arithmetic.
          </p>
        </>
      )}

      {view === "facsimile" && (
        <>
          {facsimileError ? (
            <div className="timeline-facsimile-missing">
              <p className="status-error">Adams' chart isn't built yet.</p>
              <p className="search-hint" style={{ marginTop: 0 }}>
                The facsimile is a tile pyramid generated from the source scan, and neither is committed (the scan is
                218MB). Build it with:
              </p>
              <pre className="timeline-cmd">python data-pipeline/build_chart_tiles.py</pre>
              <p className="search-hint" style={{ marginTop: 0 }}>({facsimileError})</p>
            </div>
          ) : (
            <div ref={facsimileRef} className="timeline-facsimile" role="img" aria-label="Adams' Synchronological Chart, pan and zoom" />
          )}
          {manifest && !facsimileError && (
            <p className="search-hint">
              <strong>{manifest.attribution.title}</strong> — {manifest.attribution.author}, {manifest.attribution.edition}.{" "}
              {manifest.attribution.licence}. {manifest.attribution.chronology_note}
            </p>
          )}
        </>
      )}
    </aside>
  );
}

/** Citations here are plain "Book c:v" / "Book c:v-v" strings, same as the genealogy
 * panel's, so the first verse of the range is the jump target. */
function jumpToCitation(citation: string, onJump: (b: string, c: number, v: number) => void) {
  const m = citation.match(/^(.+?)\s+(\d+):(\d+)/);
  if (m) onJump(m[1], parseInt(m[2], 10), parseInt(m[3], 10));
}
