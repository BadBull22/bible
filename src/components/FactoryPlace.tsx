// Content Factory: the handles over the picture on show. The words, the header's and footer's logos and their text can be grabbed and dragged to another
// place (they snap to the middle lines), and made bigger or smaller by dragging a corner (the logos and the header's and footer's text change size; the
// words change the size of the letters, keeping their middle). The arrow keys nudge the one that is chosen (the studio does that). The picture itself is drawn by
// the engine; this only sits over it, in the same size, and tells the studio the new places.

import { useEffect, useRef, useState } from "react";
import type { DrawReport } from "../factory/draw";
import type { Place, SizeInfo } from "../factory/types";

export type PlaceTarget = "text" | "header" | "footer" | "headerText" | "footerText";

interface Props {
  report: DrawReport | null;
  size: SizeInfo;
  /** the picture as it is shown, in screen pixels */
  width: number;
  height: number;
  /** the words' shift now (a share of the picture's width and height) and the size of their letters (1 = the size that fits) */
  textShift: { x: number; y: number } | undefined;
  fontScale: number;
  selected: PlaceTarget | null;
  onSelect: (t: PlaceTarget | null) => void;
  /** which tool is open: its handles are drawn faintly all the time */
  hint: PlaceTarget[];
  onText: (shift: { x: number; y: number } | undefined) => void;
  onTextScale: (scale: number) => void;
  onLogo: (which: "header" | "footer", place: Place) => void;
  onTextAt: (which: "header" | "footer", place: Place) => void;
}

interface Drag {
  mode: "move" | "size";
  target: PlaceTarget;
  startX: number;
  startY: number;
  /** the thing's box when the drag began, in picture pixels */
  box: { x: number; y: number; w: number; h: number };
  shift0: { x: number; y: number };
  scale0: number;
}

const SNAP = 0.012;

export function PlaceOverlay(p: Props) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef(p);
  live.current = p;
  const drag = useRef<Drag | null>(null);
  /** a drag that has just ended: for a moment longer the words are put back on their middle as the picture catches up */
  const settle = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  const [dragging, setDragging] = useState(false);

  const boxOf = (t: PlaceTarget) => (t === "text" ? p.report?.text : t === "header" ? p.report?.headerLogo : t === "footer" ? p.report?.footerLogo : t === "headerText" ? p.report?.headerText : p.report?.footerText) ?? null;

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      const el = box.current;
      if (!d || !el) return;
      const q = live.current;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const W = q.size.w;
      const H = q.size.h;
      const dx = (e.clientX - d.startX) / rect.width;
      const dy = (e.clientY - d.startY) / rect.height;
      let gv = false;
      let gh = false;
      const cx0 = (d.box.x + d.box.w / 2) / W;
      const cy0 = (d.box.y + d.box.h / 2) / H;
      // how far the corner has been pulled from the middle, against how far it started (the corner pulled out makes it bigger, in smaller)
      const ratio = () => {
        const mx = rect.left + cx0 * rect.width;
        const my = rect.top + cy0 * rect.height;
        return Math.hypot(e.clientX - mx, e.clientY - my) / Math.max(8, Math.hypot(d.startX - mx, d.startY - my));
      };
      if (d.target === "text") {
        if (d.mode === "size") {
          q.onTextScale(Math.min(3, Math.max(0.4, d.scale0 * ratio())));
        } else {
          // the words keep inside the picture, and their middle snaps to the middle lines
          const bx = d.box.x - d.shift0.x * W;
          const by = d.box.y - d.shift0.y * H;
          let sx = Math.min((W - (bx + d.box.w)) / W, Math.max(-bx / W, d.shift0.x + dx));
          let sy = Math.min((H - (by + d.box.h)) / H, Math.max(-by / H, d.shift0.y + dy));
          const cx = (bx + d.box.w / 2) / W + sx;
          const cy = (by + d.box.h / 2) / H + sy;
          if (Math.abs(cx - 0.5) < SNAP) {
            sx += 0.5 - cx;
            gv = true;
          }
          if (Math.abs(cy - 0.5) < SNAP) {
            sy += 0.5 - cy;
            gh = true;
          }
          q.onText(Math.abs(sx) < 0.001 && Math.abs(sy) < 0.001 ? undefined : { x: sx, y: sy });
        }
      } else {
        const aspect = d.box.h / Math.max(1, d.box.w);
        let pw = d.box.w / W;
        let cx = cx0;
        let cy = cy0;
        if (d.mode === "size") {
          pw = Math.min(0.9, Math.max(0.04, pw * ratio()));
        } else {
          cx += dx;
          cy += dy;
          if (Math.abs(cx - 0.5) < SNAP) {
            cx = 0.5;
            gv = true;
          }
          if (Math.abs(cy - 0.5) < SNAP) {
            cy = 0.5;
            gh = true;
          }
        }
        const ph = (pw * W * aspect) / H;
        cx = Math.min(1 - pw / 2, Math.max(pw / 2, cx));
        cy = Math.min(1 - ph / 2, Math.max(ph / 2, cy));
        const place = { x: cx, y: cy, w: pw };
        if (d.target === "header" || d.target === "footer") q.onLogo(d.target, place);
        else q.onTextAt(d.target === "headerText" ? "header" : "footer", place);
      }
      setGuides((g) => (g.v === gv && g.h === gh ? g : { v: gv, h: gh }));
    };
    const up = () => {
      if (!drag.current) return;
      if (drag.current.target === "text" && drag.current.mode === "size") {
        settle.current = drag.current;
        setTimeout(() => (settle.current = null), 900);
      }
      drag.current = null;
      setDragging(false);
      setGuides({ v: false, h: false });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  // making the words bigger or smaller changes where the layout puts them: the shift is adjusted so that their middle stays where it was
  useEffect(() => {
    const d = drag.current ?? settle.current;
    const b = p.report?.text;
    if (!d || d.target !== "text" || d.mode !== "size" || !b || !p.report) return;
    const rs = p.report.textShift;
    const nx = rs.x + ((d.box.x + d.box.w / 2) - (b.x + b.w / 2)) / p.size.w;
    const ny = rs.y + ((d.box.y + d.box.h / 2) - (b.y + b.h / 2)) / p.size.h;
    const cur = p.textShift ?? { x: 0, y: 0 };
    if (Math.abs(nx - cur.x) > 0.002 || Math.abs(ny - cur.y) > 0.002) p.onText({ x: nx, y: ny });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.report]);

  const start = (e: React.PointerEvent, target: PlaceTarget, mode: "move" | "size") => {
    const b = boxOf(target);
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    // a box in a field being typed in would keep the arrow keys: let go of it, so the arrows nudge what was chosen
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) active.blur();
    p.onSelect(target);
    drag.current = { mode, target, startX: e.clientX, startY: e.clientY, box: { x: b.x, y: b.y, w: b.w, h: b.h }, shift0: p.textShift ?? { x: 0, y: 0 }, scale0: p.fontScale };
    setDragging(true);
  };

  const tall = p.size.h / p.size.w >= 1.6;
  const targets: { t: PlaceTarget; label: string; kind: string }[] = [
    { t: "text", label: "the words", kind: "text" },
    { t: "header", label: "the header's logo", kind: "logo" },
    { t: "footer", label: "the footer's logo", kind: "logo" },
    { t: "headerText", label: "the header's text", kind: "label" },
    { t: "footerText", label: "the footer's text", kind: "label" },
  ];
  return (
    <div className="fx-overlay" ref={box} style={{ width: p.width, height: p.height }}>
      {dragging && tall && (
        <>
          <span className="fx-zone top" style={{ height: "12%" }} title="The apps cover this part of the screen" />
          <span className="fx-zone bottom" style={{ height: "17%" }} title="The apps' buttons are here" />
        </>
      )}
      {guides.v && <span className="fx-guide v" />}
      {guides.h && <span className="fx-guide h" />}
      {targets.map(({ t, label, kind }) => {
        const b = boxOf(t);
        if (!b) return null;
        const on = p.selected === t;
        return (
          <div
            key={t}
            className={"fx-box " + kind + (on ? " on" : "") + (p.hint.includes(t) ? " hint" : "")}
            style={{ left: `${(b.x / p.size.w) * 100}%`, top: `${(b.y / p.size.h) * 100}%`, width: `${(b.w / p.size.w) * 100}%`, height: `${(b.h / p.size.h) * 100}%` }}
            onPointerDown={(e) => start(e, t, "move")}
            title={`Drag to move ${label}; a corner makes it bigger or smaller; the arrow keys nudge it`}
            role="button"
            aria-label={`Move ${label}`}
          >
            {on && (["nw", "ne", "sw", "se"] as const).map((c) => <i key={c} className={"fx-handle " + c} onPointerDown={(e) => start(e, t, "size")} aria-hidden="true" />)}
          </div>
        );
      })}
    </div>
  );
}
