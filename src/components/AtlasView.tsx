import { useEffect, useMemo, useRef, useState } from "react";
import { api, AtlasMap, AtlasPlace } from "../api";
import { Line } from "./RichText";

interface Props {
  onJump: (book: string, chapter: number, verse: number) => void;
}

/** Where the grid of a map sits in its picture (pixels of the picture): the first line and the width of one square. */
interface Grid {
  x0: number;
  dx: number;
  y0: number;
  dy: number;
}

/** Positions that follow each other closely are one mark: the middle of each run. */
function groups(found: number[], gap = 3): number[] {
  const out: number[] = [];
  let start = 0;
  let prev = 0;
  let open = false;
  for (const v of found) {
    if (open && v - prev <= gap) {
      prev = v;
      continue;
    }
    if (open) out.push((start + prev) / 2);
    start = prev = v;
    open = true;
  }
  if (open) out.push((start + prev) / 2);
  return out;
}

/** The evenly spaced run of n + 1 lines that most of the found marks fall on (the rest are noise in the picture). */
function fitLines(found: number[], n: number, size: number): { start: number; step: number } | null {
  const tol = Math.max(4, size * 0.002);
  let best: { score: number; start: number; step: number } | null = null;
  for (let i = 0; i < found.length; i++) {
    for (let j = i + 1; j < found.length; j++) {
      for (let k = 1; k <= n; k++) {
        const step = (found[j] - found[i]) / k;
        if (step < size * 0.03) continue;
        for (let s = 0; s <= n; s++) {
          const start = found[i] - s * step;
          if (start < -tol || start + n * step > size + tol) continue;
          let score = 0;
          for (let m = 0; m <= n; m++) if (found.some((q) => Math.abs(start + m * step - q) <= tol)) score++;
          if (!best || score > best.score) best = { score, start, step };
        }
      }
    }
  }
  return best && best.score >= Math.min(n + 1, 3) ? { start: best.start, step: best.step } : null;
}

/** The grid of a printed atlas page: red tick marks above it (between the letters) and beside it (between the numbers).
 * Found from the picture itself, with the number of letters and numbers the place index uses. */
function detectGrid(img: HTMLImageElement, cols: number, rows: number): Grid | null {
  if (cols < 1 || rows < 1) return null;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  const reddish = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return data[i] - Math.max(data[i + 1], data[i + 2]) > 60;
  };
  // across the top: columns with at least 3 red pixels in the top band
  const topBand = Math.floor(h * 0.14);
  const xs: number[] = [];
  for (let x = 0; x < w; x++) {
    let n = 0;
    for (let y = 0; y < topBand && n < 3; y++) if (reddish(x, y)) n++;
    if (n >= 3) xs.push(x);
  }
  // down the right edge
  const rightEdge = Math.floor(w * 0.935);
  const ys: number[] = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = rightEdge; x < w && n < 3; x++) if (reddish(x, y)) n++;
    if (n >= 3) ys.push(y);
  }
  const fx = fitLines(groups(xs), cols, w);
  const fy = fitLines(groups(ys), rows, h);
  if (!fx || !fy) return null;
  return { x0: fx.start, dx: fx.step, y0: fy.start, dy: fy.step };
}

interface View {
  scale: number;
  x: number;
  y: number;
}

/** The maps of an atlas the reader added to the library (a MyBible atlas, e.g. the Bible Maps): the picture to zoom and
 * drag, a find-a-place box that opens the map and marks the grid square, and the text under the map. */
export function AtlasView({ onJump }: Props) {
  const [maps, setMaps] = useState<AtlasMap[] | null>(null);
  const [mapId, setMapId] = useState<number | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });
  const [target, setTarget] = useState<{ name: string; col: number; row: number } | null>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<AtlasPlace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const pending = useRef<{ name: string; col: number; row: number } | null>(null);

  useEffect(() => {
    api
      .atlasMaps()
      .then((m) => {
        setMaps(m);
        // open on the first real map (the key to the maps is number 0)
        setMapId((m.find((x) => x.ord > 0) ?? m[0])?.id ?? null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const map = maps?.find((m) => m.id === mapId) ?? null;

  // the picture of the chosen map
  useEffect(() => {
    if (!map) return;
    let live = true;
    let made: string | null = null;
    setUrl(null);
    setNatural(null);
    setGrid(null);
    api
      .atlasImage(map.id)
      .then((bytes) => {
        if (!live) return;
        made = URL.createObjectURL(new Blob([bytes], { type: map.mime }));
        setUrl(made);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [map?.id]);

  const fit = (n: { w: number; h: number }): View => {
    const b = box.current;
    if (!b) return { scale: 1, x: 0, y: 0 };
    const scale = Math.min(b.clientWidth / n.w, b.clientHeight / n.h);
    return { scale, x: (b.clientWidth - n.w * scale) / 2, y: (b.clientHeight - n.h * scale) / 2 };
  };

  /** Zooms in on a grid square and centres it. */
  const focusSquare = (g: Grid, col: number, row: number, n: { w: number; h: number }) => {
    const b = box.current;
    if (!b) return;
    const cx = g.x0 + (col + 0.5) * g.dx;
    const cy = g.y0 + (row + 0.5) * g.dy;
    const whole = fit(n).scale;
    const scale = Math.min(4, Math.max(whole, (Math.min(b.clientWidth, b.clientHeight) * 0.45) / Math.max(g.dx, g.dy)));
    setView({ scale, x: b.clientWidth / 2 - cx * scale, y: b.clientHeight / 2 - cy * scale });
  };

  const loaded = () => {
    const img = imgRef.current;
    if (!img || !map) return;
    const n = { w: img.naturalWidth, h: img.naturalHeight };
    setNatural(n);
    let g: Grid | null = null;
    try {
      g = detectGrid(img, map.cols, map.rows);
    } catch {
      g = null;
    }
    setGrid(g);
    const want = pending.current;
    pending.current = null;
    if (want && g) {
      setTarget(want);
      focusSquare(g, want.col, want.row, n);
    } else {
      setTarget(want);
      setView(fit(n));
    }
  };

  // finding a place
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setFound(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api
        .atlasPlaces(q, 40)
        .then((r) => live && setFound(r))
        .catch(() => live && setFound([]));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const openPlace = (p: AtlasPlace) => {
    const want = { name: p.name, col: p.col, row: p.row };
    setFound(null);
    if (p.map_id === mapId && natural) {
      setTarget(want);
      if (grid) focusSquare(grid, p.col, p.row, natural);
    } else {
      pending.current = want;
      setTarget(null);
      setMapId(p.map_id);
    }
  };

  // the wheel zooms where the pointer is (a listener of its own: React's is passive and cannot stop the page scrolling)
  useEffect(() => {
    const b = box.current;
    if (!b) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = b.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const scale = Math.min(8, Math.max(0.05, v.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        const k = scale / v.scale;
        return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
      });
    };
    b.addEventListener("wheel", wheel, { passive: false });
    return () => b.removeEventListener("wheel", wheel);
  }, [maps]);

  const zoomBy = (factor: number) => {
    const b = box.current;
    if (!b) return;
    setView((v) => {
      const scale = Math.min(8, Math.max(0.05, v.scale * factor));
      const k = scale / v.scale;
      const px = b.clientWidth / 2;
      const py = b.clientHeight / 2;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  };

  const stepMap = (by: number) => {
    if (!maps || mapId == null) return;
    const real = maps.filter((m) => m.ord > 0);
    const list = real.length ? real : maps;
    const at = list.findIndex((m) => m.id === mapId);
    const next = list[(at + by + list.length) % list.length];
    if (next) {
      setTarget(null);
      setMapId(next.id);
    }
  };

  const cell = useMemo(() => {
    if (!target || !grid) return null;
    return { left: grid.x0 + target.col * grid.dx, top: grid.y0 + target.row * grid.dy, width: grid.dx, height: grid.dy };
  }, [target, grid]);

  if (error) return <p className="status-error">Couldn't open the atlas: {error}</p>;
  if (!maps) return <p className="muted">Loading the maps…</p>;
  if (maps.length === 0) return <p className="muted">No atlas has been added yet. Add one in the Library (Add from file).</p>;

  const letters = (n: number) => String.fromCharCode(65 + n);
  const atlasNames = [...new Set(maps.map((m) => m.atlas_title))];

  return (
    <div className="atlas-view">
      <div className="atlas-controls">
        <select
          value={mapId ?? ""}
          onChange={(e) => {
            setTarget(null);
            setMapId(Number(e.target.value));
          }}
          aria-label="Map"
        >
          {atlasNames.map((a) => (
            <optgroup key={a} label={a}>
              {maps
                .filter((m) => m.atlas_title === a)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.ord > 0 ? `${m.ord}. ` : ""}
                    {m.title}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <button className="pill-btn small" onClick={() => stepMap(-1)} aria-label="Previous map">
          ‹
        </button>
        <button className="pill-btn small" onClick={() => stepMap(1)} aria-label="Next map">
          ›
        </button>
      </div>
      <div className="search-controls">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a place on these maps…" aria-label="Find a place on the atlas maps" />
      </div>
      {found && (
        <ul className="xref-list" style={{ marginBottom: "0.6rem", maxHeight: "11rem", overflowY: "auto" }}>
          {found.length === 0 && <li className="muted">No place by that name in the atlas.</li>}
          {found.map((p, i) => (
            <li key={`${p.name}-${p.map_id}-${i}`}>
              <button className="link-btn" onClick={() => openPlace(p)}>
                {p.name}
              </button>
              <span className="votes">
                {" "}
                map {p.map_ord}, square {letters(p.col)}
                {p.row + 1}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div
        className="atlas-viewer"
        ref={box}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest(".atlas-zoom")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest(".atlas-zoom")) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          setView((v) => {
            const scale = Math.min(8, v.scale * 2);
            const k = scale / v.scale;
            return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
          });
        }}
      >
        {!url && <p className="muted atlas-loading">Loading the map…</p>}
        {url && (
          <div className="atlas-layer" style={{ width: natural?.w, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
            <img ref={imgRef} src={url} alt={map?.title} draggable={false} onLoad={loaded} />
            {cell && <div className="atlas-cell" style={cell} title={target?.name} />}
          </div>
        )}
        <div className="atlas-zoom">
          <button onClick={() => zoomBy(1.4)} aria-label="Zoom in">
            +
          </button>
          <button onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">
            −
          </button>
          <button onClick={() => natural && setView(fit(natural))} aria-label="Show the whole map" title="Show the whole map">
            ⤢
          </button>
        </div>
      </div>
      {target && (
        <p className="muted" style={{ margin: "0.35rem 0" }}>
          {target.name}: square {letters(target.col)}
          {target.row + 1}
          {grid ? "" : " (the grid couldn't be found on this picture, so the square isn't marked)"}
        </p>
      )}
      {map?.body && (
        <details className="atlas-text" open>
          <summary>On this map</summary>
          <div className="commentary-text">
            {map.body.split(/\n+/).map((line, i) => (
              <p key={i}>
                <Line text={line} onJump={onJump} />
              </p>
            ))}
          </div>
        </details>
      )}
      {map && (
        <p className="search-hint">
          {map.atlas_title} — {map.licence}. Added by you; it stays on this computer.
        </p>
      )}
    </div>
  );
}
