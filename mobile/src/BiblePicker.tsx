// The Bible being read, chosen from a small list of the app's own (owner, 2026-11-23: Android's own list was far too big once the full
// names were in it). A button shows the Bible on its own line under the search box; it opens a compact panel, one line per Bible
// (the short code, then its name), that scrolls when there are many. A tap outside or Back closes it.

import { useEffect, useRef, useState } from "react";
import { Version } from "./api";
import { createPortal } from "react-dom";
import { useBack } from "./back";

export function BiblePicker({ versions, value, onChange, tone }: { versions: Version[]; value: string; onChange: (code: string) => void; tone: "bar" | "home" }) {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  useBack(open, () => setOpen(false), 3);
  const chosen = versions.find((v) => v.code === value);
  const groups: [string, Version[]][] = [
    ["Built in", versions.filter((v) => !v.downloaded)],
    ["Downloaded", versions.filter((v) => v.downloaded)],
  ];
  // the chosen Bible in view when the list opens
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>("[aria-selected='true']")?.scrollIntoView({ block: "nearest" });
  }, [open]);
  return (
    <>
      <button type="button" className={`bible-pick bible-pick-${tone}`} onClick={() => setOpen(true)} aria-haspopup="listbox" aria-expanded={open} aria-label={`Bible: ${chosen?.name ?? value}. Choose another`}>
        <strong>{value}</strong>
        {chosen && chosen.name !== value && <span className="bible-pick-name">{chosen.name}</span>}
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      {open &&
        createPortal(
        <div className="bible-pick-backdrop" onClick={() => setOpen(false)}>
          <div className="bible-pick-panel" role="dialog" aria-label="Choose a Bible" onClick={(e) => e.stopPropagation()}>
            <div className="bible-pick-list" ref={list} role="listbox" aria-label="Bibles">
              {groups
                .filter(([, vs]) => vs.length > 0)
                .map(([label, vs]) => (
                  <div key={label} role="group" aria-label={label}>
                    <div className="bible-pick-group">{label}</div>
                    {vs.map((v) => (
                      <button
                        key={v.code}
                        type="button"
                        role="option"
                        aria-selected={v.code === value}
                        className={"bible-pick-row" + (v.code === value ? " on" : "")}
                        onClick={() => {
                          onChange(v.code);
                          setOpen(false);
                        }}
                      >
                        <strong>{v.code}</strong>
                        <span>{v.name}</span>
                      </button>
                    ))}
                  </div>
                ))}
            </div>
          </div>
        </div>,
        document.body, // drawn outside the row it sits in, so that row's button styles do not reach the list
        )}
    </>
  );
}
