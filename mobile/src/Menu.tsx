// A choice from a list, in a small panel of the app's own instead of Android's large list (owner, 2026-11-23: "all menus like this
// should be replaced with neater new menus"). A button shows the choice; it opens a compact panel, one line per choice, with group
// headings, that scrolls when the list is long. A long list (languages) gets a box to find a choice by typing. A tap outside or
// Back closes it. Used for every list in the app; the Bible chooser (BiblePicker) is the same idea with the Bible's code and name.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBack } from "./back";

export interface MenuItem {
  value: string;
  label: string;
  /** a second, quieter part of the line (the "(needs internet)" of a voice) */
  note?: string;
  /** a heading above this item and the ones after it */
  group?: string;
}

export function Menu({
  value,
  items,
  onChange,
  className,
  label,
  shown,
  title,
}: {
  value: string;
  items: MenuItem[];
  onChange: (value: string) => void;
  /** the button's look: the class the list used to have (select-field, or none inside a row of buttons) */
  className?: string;
  /** read aloud by a screen reader: what is being chosen */
  label: string;
  /** what the button says, if not the chosen item's label (e.g. "Side by side…" when nothing is chosen) */
  shown?: string;
  /** a heading at the top of the panel */
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const list = useRef<HTMLDivElement>(null);
  useBack(open, () => setOpen(false), 3);
  const chosen = items.find((i) => i.value === value);
  const long = items.length > 12;
  const shownItems = useMemo(() => {
    const f = find.trim().toLowerCase();
    return f ? items.filter((i) => i.label.toLowerCase().includes(f)) : items;
  }, [items, find]);
  useEffect(() => {
    if (!open) return;
    setFind("");
    list.current?.querySelector<HTMLElement>("[aria-selected='true']")?.scrollIntoView({ block: "nearest" });
  }, [open]);
  let lastGroup: string | undefined;
  return (
    <>
      <button type="button" className={"menu-btn " + (className ?? "")} onClick={() => setOpen(true)} aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${shown ?? chosen?.label ?? ""}`}>
        <span className="menu-btn-text">{shown ?? chosen?.label ?? ""}</span>
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      {open &&
        createPortal(
        <div className="menu-backdrop" onClick={() => setOpen(false)}>
          <div className="menu-panel" role="dialog" aria-label={label} onClick={(e) => e.stopPropagation()}>
            {title && <div className="menu-title">{title}</div>}
            {long && (
              <input className="menu-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find…" aria-label={`Find in ${label}`} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
            )}
            <div className="menu-list" ref={list} role="listbox" aria-label={label}>
              {shownItems.map((i) => {
                const heading = i.group && i.group !== lastGroup ? i.group : null;
                lastGroup = i.group ?? lastGroup;
                return (
                  <div key={i.value}>
                    {heading && <div className="menu-group">{heading}</div>}
                    <button
                      type="button"
                      role="option"
                      aria-selected={i.value === value}
                      className={"menu-row" + (i.value === value ? " on" : "")}
                      onClick={() => {
                        onChange(i.value);
                        setOpen(false);
                      }}
                    >
                      <span>{i.label}</span>
                      {i.note && <small>{i.note}</small>}
                      {i.value === value && (
                        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                          <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" />
                        </svg>
                      )}
                    </button>
                  </div>
                );
              })}
              {shownItems.length === 0 && <div className="menu-none">Nothing matches “{find}”.</div>}
            </div>
          </div>
        </div>,
        document.body, // drawn outside the row it sits in, so that row's button styles do not reach the list
        )}
    </>
  );
}
