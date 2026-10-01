import { ReactNode, useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "./icons";

export interface TopMenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  /** e.g. the study basket's item count; shown on both the item and the trigger button. */
  badge?: number;
}

interface Props {
  label: string;
  icon: ReactNode;
  items: TopMenuItem[];
}

/** A grouped top-bar menu: one button that opens a dropdown of related panels, so the top
 * bar doesn't need a separate always-visible button per panel. Mirrors the verse "⋯" menu's
 * click-outside/Escape-to-close behaviour (see ChapterView.tsx) for a consistent feel. */
export function TopMenu({ label, icon, items }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const totalBadge = items.reduce((n, i) => n + (i.badge ?? 0), 0);

  return (
    <div className="top-menu" ref={rootRef}>
      <button className="text-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={label}>
        {icon} <span className="label">{label}</span>
        {totalBadge > 0 && <span className="count-badge">{totalBadge}</span>}
        <ChevronDownIcon size={12} />
      </button>
      {open && (
        <div className="top-menu-dropdown" role="menu">
          {items.map((i) => (
            <button
              key={i.key}
              role="menuitem"
              onClick={() => {
                i.onClick();
                setOpen(false);
              }}
            >
              {i.icon} {i.label}
              {i.badge ? <span className="count-badge">{i.badge}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
