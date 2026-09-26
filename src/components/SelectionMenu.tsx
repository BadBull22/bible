import { useEffect, useRef, useState } from "react";
import { addToBasket } from "../basket";
import { copyText } from "../clipboard";
import { BasketIcon, CopyIcon, SearchIcon, SpeakerIcon } from "./icons";

/** A selection inside the chapter being read, split at verse boundaries (so read-aloud can
 * highlight each verse as it goes). */
export interface SelectedVerse {
  verse: number;
  text: string;
}

export interface SelectionPayload {
  text: string;
  /** set when the selection is Bible text in the chapter view */
  verses: SelectedVerse[] | null;
}

interface Props {
  /** "John 3" -- used to label basket items taken from the chapter */
  chapterLabel: string | null;
  onListen: (sel: SelectionPayload) => void;
  onSearch: (query: string) => void;
}

/** The verse rows a selection touches, each with just its selected part (verse numbers,
 * note/bookmark markers and the action buttons left out). */
function selectedVerses(range: Range): SelectedVerse[] | null {
  const anchor = range.commonAncestorContainer;
  const el = anchor instanceof Element ? anchor : anchor.parentElement;
  const root = el?.closest(".chapter-view");
  if (!root) return null;
  const out: SelectedVerse[] = [];
  root.querySelectorAll<HTMLElement>(".verse-row[data-verse]").forEach((p) => {
    if (!range.intersectsNode(p)) return;
    const part = document.createRange();
    part.selectNodeContents(p);
    if (p.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset);
    if (p.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset);
    const frag = part.cloneContents();
    frag.querySelectorAll(".verse-num, .verse-actions, .verse-mark").forEach((n) => n.remove());
    const text = (frag.textContent ?? "").replace(/\s+/g, " ").trim();
    if (/[\p{L}\p{N}]/u.test(text)) out.push({ verse: Number(p.dataset.verse), text });
  });
  return out.length ? out : null;
}

/** Replaces the browser's right-click menu when text is selected, anywhere in the app:
 * Listen to it, copy it, add it to the study basket, or search for it. In a text box the
 * normal menu appears; with no selection there is none (except in dev builds). */
export function SelectionMenu({ chapterLabel, onListen, onSearch }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; sel: SelectionPayload } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const open = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return; // keep Cut/Copy/Paste
      const s = window.getSelection();
      const text = s?.toString().trim() ?? "";
      if (!s || s.rangeCount === 0 || !text) {
        // Nothing selected: the browser's own menu (Back, Refresh, Print, Inspect…) makes no
        // sense in an app, so it's suppressed in the installed build; kept in dev for Inspect.
        if (!import.meta.env.DEV) e.preventDefault();
        return;
      }
      e.preventDefault();
      setFlash(null);
      setMenu({ x: e.clientX, y: e.clientY, sel: { text, verses: selectedVerses(s.getRangeAt(0)) } });
    };
    window.addEventListener("contextmenu", open);
    return () => window.removeEventListener("contextmenu", open);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", esc);
    };
  }, [menu]);

  // keep the menu inside the window
  useEffect(() => {
    const el = ref.current;
    if (!el || !menu) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - r.width - 8);
    const y = Math.min(menu.y, window.innerHeight - r.height - 8);
    if (x !== menu.x || y !== menu.y) setMenu({ ...menu, x: Math.max(8, x), y: Math.max(8, y) });
  }, [menu]);

  if (!menu) return null;
  const { sel } = menu;
  const done = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setMenu(null), 900);
  };
  const verseRef =
    sel.verses && chapterLabel
      ? `${chapterLabel}:${sel.verses[0].verse}${sel.verses.length > 1 ? `–${sel.verses[sel.verses.length - 1].verse}` : ""}`
      : null;
  const short = sel.text.length <= 60 && !sel.text.includes("\n");

  return (
    <div className="selection-menu" ref={ref} role="menu" style={{ left: menu.x, top: menu.y }}>
      {flash ? (
        <div className="selection-menu-flash">{flash}</div>
      ) : (
        <>
          <button
            role="menuitem"
            onClick={() => {
              onListen(sel);
              setMenu(null);
            }}
          >
            <SpeakerIcon size={14} /> Listen to selection
          </button>
          <button role="menuitem" onClick={async () => done((await copyText(sel.text)) ? "Copied" : "Couldn't copy")}>
            <CopyIcon size={14} /> Copy
          </button>
          <button
            role="menuitem"
            onClick={async () => done((await addToBasket("text", verseRef ?? "", sel.text)) ? "Added to the study basket" : "Couldn't add")}
          >
            <BasketIcon size={14} /> Add to study basket
          </button>
          {short && (
            <button
              role="menuitem"
              onClick={() => {
                onSearch(sel.text);
                setMenu(null);
              }}
            >
              <SearchIcon size={14} /> Search for “{sel.text}”
            </button>
          )}
        </>
      )}
    </div>
  );
}
