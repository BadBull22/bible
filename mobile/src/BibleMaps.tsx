// The nine Bible maps (since 3.0.0), the same pictures, passages and credits as on the computer (Map > Bible maps): a page of maps to choose from, then
// one map to zoom (pinch, double-tap, + and -) and drag, what it shows, the passages it goes with, and the credit its licence asks for.
// The pictures and maps.json are the desktop's own files (public/bible-maps), copied in when the app is built. Nothing is drawn on them.

import { useEffect, useRef, useState } from "react";
import { useBack } from "./back";

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

const FOLDER = "bible-maps/";
const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

/** One map picture to zoom (two fingers, double-tap, + and - buttons) and drag. */
function MapViewer({ map }: { map: BibleMap }) {
  const box = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; view: View } | null>(null);
  const lastTap = useRef(0);
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

  const zoomAt = (px: number, py: number, factor: number) =>
    setView((v) => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      const k = scale / v.scale;
      return { scale, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  const zoomBy = (factor: number) => {
    const b = box.current;
    if (b) zoomAt(b.clientWidth / 2, b.clientHeight / 2, factor);
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div
      className="atlas-viewer"
      ref={box}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest(".atlas-zoom")) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        pointers.current.set(e.pointerId, local(e));
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, view };
        } else {
          // a quick second tap zooms in where it lands
          const now = Date.now();
          if (now - lastTap.current < 320) zoomAt(local(e).x, local(e).y, 2);
          lastTap.current = now;
        }
      }}
      onPointerMove={(e) => {
        const prev = pointers.current.get(e.pointerId);
        if (!prev) return;
        const now = local(e);
        pointers.current.set(e.pointerId, now);
        if (pointers.current.size >= 2 && pinch.current) {
          const [a, b] = [...pointers.current.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          const start = pinch.current;
          const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, start.view.scale * (dist / start.dist)));
          const k = scale / start.view.scale;
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          setView({ scale, x: mx - (mx - start.view.x) * k, y: my - (my - start.view.y) * k });
        } else {
          setView((v) => ({ ...v, x: v.x + now.x - prev.x, y: v.y + now.y - prev.y }));
        }
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        pinch.current = null;
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        pinch.current = null;
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
        <button onClick={() => setView(fit())} aria-label="Show the whole map">
          ⤢
        </button>
      </div>
    </div>
  );
}

/** The card in More that opens the maps. */
export function MapsEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="browse-entry">
      <div className="browse-entry-grid">
        <button className="browse-card" onClick={onOpen}>
          <span className="browse-card-title">
            Bible maps <small>9</small>
          </span>
          <span className="browse-card-blurb">Where the tribes settled, the kingdoms, Jerusalem, the ministry of Jesus and Paul's journeys: zoom, drag, and see the passages each goes with.</span>
        </button>
      </div>
    </section>
  );
}

/** The maps screen (More > Bible maps). Back goes from a map to the list, then out. */
export function BibleMaps({ onJump, onClose }: { onJump: (book: string, chapter: number, verse: number) => void; onClose: () => void }) {
  const [data, setData] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  useBack(true, onClose);
  useBack(openId != null, () => setOpenId(null));

  useEffect(() => {
    fetch(FOLDER + "maps.json")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<Manifest>;
      })
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="hint status">Couldn't open the Bible maps: {error}</p>;
  if (!data) return <p className="hint">Loading the maps…</p>;

  const map = data.maps.find((m) => m.id === openId) ?? null;
  const groups = [...new Set(data.maps.map((m) => m.group))];

  if (!map) {
    return (
      <div className="bible-maps browse">
        <button className="link back" onClick={onClose}>
          ‹ More
        </button>
        <h2>Bible maps</h2>
        <p className="hint">Maps that come with the app. Choose one to zoom in, drag it around and see which passages it goes with.</p>
        {groups.map((g) => (
          <section key={g}>
            <h4 className="browse-section">{g}</h4>
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
    <div className="bible-maps browse">
      <div className="atlas-controls">
        <button className="link back" onClick={() => setOpenId(null)}>
          ‹ All maps
        </button>
        <span className="atlas-step">
          <button className="browse-pill quiet" onClick={() => step(-1)} aria-label="Previous map">
            ‹
          </button>
          <button className="browse-pill quiet" onClick={() => step(1)} aria-label="Next map">
            ›
          </button>
        </span>
      </div>
      <MapViewer key={map.id} map={map} />
      <h3 className="bible-map-heading">{map.title}</h3>
      <p className="bible-map-about">{map.description}</p>
      {map.passages.length > 0 && (
        <div className="bible-map-passages">
          <h4 className="browse-section">Passages</h4>
          <ul className="bible-map-list">
            {map.passages.map((p) => (
              <li key={p.label}>
                <button className="link" onClick={() => onJump(p.book, p.chapter, p.verse)}>
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {credit && <p className="hint">{credit.text}</p>}
    </div>
  );
}
