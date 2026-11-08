import { useEffect, useRef, useState } from "react";

interface Passage {
  label: string;
  book: string;
  chapter: number;
  verse: number;
}

interface BibleMap {
  id: string;
  file: string;
  title: string;
  description: string;
  group: string;
  passages: Passage[];
  credit: string;
  licence: string;
  width: number;
  height: number;
}

interface Manifest {
  credits: Record<string, { name: string; text: string }>;
  maps: BibleMap[];
}

interface View {
  scale: number;
  x: number;
  y: number;
}

interface Props {
  onJump: (book: string, chapter: number, verse: number) => void;
}

const FOLDER = "/bible-maps/";
const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

/** One map picture to zoom (wheel, + and - buttons, double-click) and drag. */
function MapViewer({ map }: { map: BibleMap }) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0 });

  const fit = (): View => {
    const b = box.current;
    if (!b || !b.clientWidth || !b.clientHeight) return { scale: 1, x: 0, y: 0 };
    const scale = Math.min(b.clientWidth / map.width, b.clientHeight / map.height);
    return { scale, x: (b.clientWidth - map.width * scale) / 2, y: (b.clientHeight - map.height * scale) / 2 };
  };

  // the whole map fits when it opens (its size is in the manifest, so there is no wait for the picture)
  useEffect(() => {
    setView(fit());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map.id]);

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
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        const k = scale / v.scale;
        return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
      });
    };
    b.addEventListener("wheel", wheel, { passive: false });
    return () => b.removeEventListener("wheel", wheel);
  }, []);

  const zoomBy = (factor: number) => {
    const b = box.current;
    if (!b) return;
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const k = scale / v.scale;
      const px = b.clientWidth / 2;
      const py = b.clientHeight / 2;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  };

  return (
    <div
      className="atlas-viewer bible-map-viewer"
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
          const scale = Math.min(MAX_SCALE, v.scale * 2);
          const k = scale / v.scale;
          return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
        });
      }}
    >
      <div className="atlas-layer" style={{ width: map.width, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        <img src={FOLDER + map.file} alt={map.title} width={map.width} height={map.height} draggable={false} />
      </div>
      <div className="atlas-zoom">
        <button onClick={() => zoomBy(1.4)} aria-label="Zoom in">
          +
        </button>
        <button onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">
          −
        </button>
        <button onClick={() => setView(fit())} aria-label="Show the whole map" title="Show the whole map">
          ⤢
        </button>
      </div>
    </div>
  );
}

/** The Bible maps that come with the app (Map panel, "Bible maps" tab): a page of maps to choose from, then one map to
 * zoom and drag, what it shows, the passages it goes with, and the credit its licence asks for. */
export function BibleMapsView({ onJump }: Props) {
  const [data, setData] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch(FOLDER + "maps.json")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<Manifest>;
      })
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="status-error">Couldn't open the Bible maps: {error}</p>;
  if (!data) return <p className="muted">Loading the maps…</p>;

  const map = data.maps.find((m) => m.id === openId) ?? null;

  if (!map) {
    const groups = [...new Set(data.maps.map((m) => m.group))];
    return (
      <div className="bible-maps">
        <p className="search-hint">Maps that come with the app. Choose one to zoom in, drag it around and see which passages it goes with.</p>
        {groups.map((g) => (
          <section key={g}>
            <h4 className="bible-maps-group">{g}</h4>
            <div className="bible-maps-grid">
              {data.maps
                .filter((m) => m.group === g)
                .map((m) => (
                  <button key={m.id} className="bible-map-card" onClick={() => setOpenId(m.id)}>
                    <img src={FOLDER + m.file} alt="" loading="lazy" decoding="async" />
                    <span className="bible-map-title">{m.title}</span>
                    <span className="bible-map-desc">{m.description}</span>
                  </button>
                ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  const at = data.maps.findIndex((m) => m.id === map.id);
  const step = (by: number) => setOpenId(data.maps[(at + by + data.maps.length) % data.maps.length].id);
  const credit = data.credits[map.credit];

  return (
    <div className="atlas-view bible-maps">
      <div className="atlas-controls">
        <button className="pill-btn small" onClick={() => setOpenId(null)}>
          ‹ All maps
        </button>
        <select value={map.id} onChange={(e) => setOpenId(e.target.value)} aria-label="Map">
          {[...new Set(data.maps.map((m) => m.group))].map((g) => (
            <optgroup key={g} label={g}>
              {data.maps
                .filter((m) => m.group === g)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <button className="pill-btn small" onClick={() => step(-1)} aria-label="Previous map">
          ‹
        </button>
        <button className="pill-btn small" onClick={() => step(1)} aria-label="Next map">
          ›
        </button>
      </div>
      <MapViewer key={map.id} map={map} />
      <h4 className="bible-map-heading">{map.title}</h4>
      <p className="bible-map-about">{map.description}</p>
      {map.passages.length > 0 && (
        <div className="bible-map-passages">
          <strong>Passages</strong>
          <ul className="xref-list">
            {map.passages.map((p) => (
              <li key={p.label}>
                <button className="link-btn" onClick={() => onJump(p.book, p.chapter, p.verse)}>
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {credit && <p className="search-hint">{credit.text}</p>}
    </div>
  );
}
