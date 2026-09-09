import { PointerEvent as ReactPointerEvent, useRef } from "react";

interface Props {
  /** Which side of the handle the resized element sits on: the element grows when the
   * pointer moves away from it. */
  side: "left" | "right";
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onReset: () => void;
  label: string;
}

/** A thin vertical drag handle between two flex siblings. Uses pointer capture so the
 * drag keeps tracking even when the pointer leaves the 6px strip. Double-click resets. */
export function ResizeHandle({ side, width, min, max, onResize, onReset, label }: Props) {
  const start = useRef<{ x: number; width: number } | null>(null);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    start.current = { x: e.clientX, width };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add("is-resizing");
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const delta = e.clientX - start.current.x;
    const next = side === "left" ? start.current.width + delta : start.current.width - delta;
    onResize(Math.round(Math.min(max, Math.max(min, next))));
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    start.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.classList.remove("is-resizing");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 40 : 10;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const dir = (e.key === "ArrowRight") === (side === "left") ? 1 : -1;
      onResize(Math.min(max, Math.max(min, width + dir * step)));
    } else if (e.key === "Home" || e.key === "Enter") {
      e.preventDefault();
      onReset();
    }
  }

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
