import { useRef, useState } from "react";
import { ShortcutTarget } from "../shortcuts";

interface Props {
  /** the shortcuts, in order */
  items: ShortcutTarget[];
  /** a place is free for one more */
  canAdd: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  /** a shortcut takes the place at this index */
  onMove: (id: string, index: number) => void;
}

const DRAG_START = 6; // pixels the pointer must move before a press becomes a drag (so a plain click still opens the shortcut)

/** The reader's shortcuts: tiles to click, drag to a new place (pointer events: the browser's own drag-and-drop is not reliable
 * inside the desktop window), or move with Alt + the arrow keys. The remove cross and the + tile are part of the grid. */
export function ShortcutGrid({ items, canAdd, onAdd, onRemove, onMove }: Props) {
  const grid = useRef<HTMLDivElement>(null);
  const press = useRef<{ id: string; x: number; y: number; dragging: boolean; over: number | null; pointer: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; over: number | null } | null>(null);
  const [said, setSaid] = useState("");

  const down = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".home-shortcut-remove")) return;
    press.current = { id, x: e.clientX, y: e.clientY, dragging: false, over: null, pointer: e.pointerId };
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.dragging) {
      if (Math.hypot(dx, dy) < DRAG_START) return;
      p.dragging = true;
      // from here the pointer belongs to this tile (a plain click, with no movement, never gets here)
      try {
        e.currentTarget.setPointerCapture(p.pointer);
      } catch {
        /* a pointer that is already gone: the drag still follows the moves it gets */
      }
    }
    let over: number | null = null;
    [...(grid.current?.querySelectorAll<HTMLElement>(".home-shortcut") ?? [])].forEach((t, i) => {
      if (t.dataset.id === p.id) return;
      const r = t.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) over = i;
    });
    p.over = over;
    setDrag({ id: p.id, dx, dy, over });
  };
  const up = () => {
    const p = press.current;
    press.current = null;
    if (p?.dragging && p.over !== null) onMove(p.id, p.over);
    setDrag(null);
  };
  const cancel = () => {
    press.current = null;
    setDrag(null);
  };

  const key = (e: React.KeyboardEvent, i: number, id: string) => {
    if (!e.altKey) return;
    const cols = grid.current ? getComputedStyle(grid.current).gridTemplateColumns.split(" ").length : 3;
    const by = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" ? -cols : e.key === "ArrowDown" ? cols : 0;
    if (!by) return;
    e.preventDefault();
    const to = Math.max(0, Math.min(items.length - 1, i + by));
    if (to !== i) {
      onMove(id, to);
      setSaid(`${items[i].label} moved to place ${to + 1} of ${items.length}`);
    }
  };

  return (
    <div className="home-stats-grid" ref={grid} onKeyDown={(e) => e.key === "Escape" && cancel()}>
      {items.map((t, i) => {
        const dragging = drag?.id === t.id;
        return (
          <div
            key={t.id}
            data-id={t.id}
            className={"home-shortcut" + (dragging ? " is-dragging" : "") + (drag && drag.over === i ? " is-drop" : "")}
            style={dragging ? { transform: `translate(${drag!.dx}px, ${drag!.dy}px)` } : undefined}
            onPointerDown={(e) => down(e, t.id)}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={cancel}
          >
            <button className="home-stat-tile is-active" onClick={t.onOpen} onKeyDown={(e) => key(e, i, t.id)} title="Open it. Drag it to move it, or use Alt + the arrow keys.">
              {t.value ? <div className="home-stat-number">{t.value}</div> : <div className="home-stat-icon">{t.icon}</div>}
              <div className="home-stat-label">{t.label}</div>
              <div className="home-stat-sub">{t.sub}</div>
            </button>
            <button className="home-shortcut-remove" onClick={() => onRemove(t.id)} aria-label={`Remove the ${t.label} shortcut`} title="Remove this shortcut">
              ×
            </button>
          </div>
        );
      })}
      {canAdd && (
        <button className="home-stat-tile home-shortcut-add" onClick={onAdd}>
          <div className="home-stat-number">+</div>
          <div className="home-stat-label">Add a shortcut</div>
        </button>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {said}
      </span>
    </div>
  );
}
