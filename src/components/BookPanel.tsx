import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, BookHit, BookSection, InstalledModule, TocEntry } from "../api";
import { addToBasket } from "../basket";
import { BasketButton } from "./BasketButton";
import { CopyButton } from "./CopyButton";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, SpeakerIcon } from "./icons";
import { LISTEN_FINISHED_EVENT, requestListen } from "../readAloud";
import { plainText, RichText } from "./RichText";

interface Props {
  name: string;
  /** "main": fills the reading pane in place of the Bible text; "panel" (default): a side panel */
  layout?: "panel" | "main";
  onJump: (book: string, chapter: number, verse: number) => void;
  onOpenLibrary: () => void;
  onClose: () => void;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Devotional entries are keyed "MM.DD": show them as dates. */
function entryTitle(title: string, devotional: boolean): string {
  const m = devotional ? /^(\d{2})\.(\d{2})$/.exec(title.trim()) : null;
  return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1] ?? m[1]}` : title;
}

function todayKey() {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

// Where the reader was in each book: the section, and how far down it (0..1), so a book
// reopens at the same place.
const LAST_KEY = "book:place";

interface Place {
  id: number;
  frac: number;
}

function lastPlace(name: string): Place | null {
  try {
    const p = (JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}") as Record<string, Place>)[name];
    if (p && typeof p.id === "number") return { id: p.id, frac: Number(p.frac) || 0 };
    // before places were remembered, only the section was
    const old = (JSON.parse(localStorage.getItem("book:last") ?? "{}") as Record<string, number>)[name];
    return typeof old === "number" ? { id: old, frac: 0 } : null;
  } catch {
    return null;
  }
}

function rememberPlace(name: string, place: Place) {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}") as Record<string, Place>;
    all[name] = place;
    localStorage.setItem(LAST_KEY, JSON.stringify(all));
  } catch {
    /* per-viewer convenience only */
  }
}

/** Where to land inside a section once it has been drawn. */
type Target = { frac: number } | { page: number } | null;

/** Reads an installed Library book or devotional: contents, one section at a time,
 * Previous/Next, search inside the book, and Listen / Copy / Basket for the section. */
export function BookPanel({ name, layout = "panel", onJump, onOpenLibrary, onClose }: Props) {
  const inMain = layout === "main";
  const [info, setInfo] = useState<InstalledModule | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [section, setSection] = useState<BookSection | null>(null);
  const [showToc, setShowToc] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<BookHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const devotional = info?.kind === "devotional";
  // how far down the open section the reader is (0..1), and the printed page showing (PDF books)
  const [frac, setFrac] = useState(0);
  const [page, setPage] = useState<number | null>(null);
  const [pageInput, setPageInput] = useState("");
  // the slider's own value while it is being dragged (null = follow the reader)
  const [dragging, setDragging] = useState<number | null>(null);
  const target = useRef<Target>(null);
  // the section being read aloud from here (so the next one follows on), and whether the
  // section about to open should start reading by itself
  const reading = useRef<number | null>(null);
  const readOnOpen = useRef(false);
  const textRef = useRef<HTMLDivElement>(null);
  const scroller = () => document.querySelector<HTMLElement>(inMain ? ".main-pane" : ".book-panel");

  useEffect(() => {
    setSection(null);
    setHits(null);
    setQuery("");
    api
      .libraryInstalled()
      .then((all) => setInfo(all.find((m) => m.name === name) ?? null))
      .catch(() => undefined);
    api
      .libraryToc(name)
      .then((t) => {
        setToc(t);
        // devotional entries come from the dictionary store, with ids from 1,000,000,000 up
        const isDevotional = (t[0]?.id ?? 0) >= 1_000_000_000;
        const today = isDevotional ? t.find((e) => e.title.trim() === todayKey())?.id : null;
        const last = lastPlace(name);
        const start = today ?? (last && t.some((e) => e.id === last.id) ? last.id : null) ?? t.find((e) => e.has_text)?.id ?? null;
        if (start != null) open(start, today == null && last?.id === start ? { frac: last.frac } : null);
        else setShowToc(true);
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  function open(id: number, land: Target = null, thenRead = false) {
    setError(null);
    readOnOpen.current = thenRead;
    if (!thenRead) reading.current = null; // the reader moved somewhere themselves
    api
      .librarySection(id)
      .then((s) => {
        if (!s) return;
        target.current = land ?? { frac: 0 };
        setShowToc(false);
        setSection({ ...s }); // a new object even for the section already open, so it lands again
      })
      .catch((e) => setError(String(e)));
  }

  // --- once a section is drawn: go to the place asked for (top, a fraction down, or a page)
  useEffect(() => {
    const land = target.current;
    const box = scroller();
    const text = textRef.current;
    if (!section || !land || !box || !text) return;
    target.current = null;
    const textTop = text.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    let top = 0;
    if ("page" in land) {
      const mark = text.querySelector<HTMLElement>(`[data-page="${land.page}"]`);
      if (mark) top = mark.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 90;
    } else if (land.frac > 0) {
      top = textTop + land.frac * text.offsetHeight - 90;
    }
    box.scrollTo({ top: Math.max(0, top) });
    if (readOnOpen.current) {
      readOnOpen.current = false;
      listenFrom(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  /** Reads the open section aloud from paragraph `from` on. */
  function listenFrom(from: number) {
    if (!section) return;
    const paras = section.text.split(/\n{2,}/).slice(from);
    const text = plainText(paras.join("\n\n"));
    if (!text.trim()) return;
    reading.current = section.id;
    requestListen(from === 0 ? `${entryTitle(section.title, devotional)}.\n\n${text}` : text);
  }

  /** From the paragraph at the top of the window. */
  function listenFromHere() {
    const box = scroller();
    const text = textRef.current;
    if (!box || !text) return listenFrom(0);
    const top = box.getBoundingClientRect().top + 110;
    const paras = [...text.querySelectorAll<HTMLElement>(".rich-text > p")];
    const i = paras.findIndex((p) => p.getBoundingClientRect().bottom > top);
    listenFrom(Math.max(0, i));
  }

  // a section read to its end: carry on into the next one
  useEffect(() => {
    const onFinished = () => {
      if (section && reading.current === section.id && section.next != null && !devotional) open(section.next, null, true);
      else reading.current = null;
    };
    window.addEventListener(LISTEN_FINISHED_EVENT, onFinished);
    return () => window.removeEventListener(LISTEN_FINISHED_EVENT, onFinished);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, devotional]);

  // --- while reading: keep track of the place (for the slider, the page number, and reopening)
  useEffect(() => {
    const box = scroller();
    if (!box || !section) return;
    let timer = 0;
    const measure = () => {
      const text = textRef.current;
      if (!text) return;
      const boxTop = box.getBoundingClientRect().top;
      const rect = text.getBoundingClientRect();
      const f = rect.height > 0 ? Math.min(1, Math.max(0, (boxTop + 100 - rect.top) / rect.height)) : 0;
      setFrac(f);
      let shown: number | null = null;
      for (const m of text.querySelectorAll<HTMLElement>(".page-mark")) {
        if (m.getBoundingClientRect().top > boxTop + 140) break;
        shown = Number(m.dataset.page);
      }
      // before the first mark of a section, the page that began in the section before
      if (shown == null) {
        const first = text.querySelector<HTMLElement>(".page-mark");
        if (first) shown = Math.max(1, Number(first.dataset.page) - 1);
      }
      setPage(shown);
      rememberPlace(name, { id: section.id, frac: f });
    };
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, 120);
    };
    const first = window.setTimeout(measure, 60);
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      box.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
      window.clearTimeout(first);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, name]);

  // --- the whole book as one line: where each section with text starts, by length
  const span = useMemo(() => {
    const parts = toc.filter((e) => e.has_text && e.chars > 0);
    const total = parts.reduce((n, e) => n + e.chars, 0);
    let before = 0;
    const starts = parts.map((e) => {
      const s = before;
      before += e.chars;
      return { id: e.id, title: e.title, start: s, chars: e.chars };
    });
    return { starts, total };
  }, [toc]);
  const here = section ? span.starts.find((s) => s.id === section.id) : undefined;
  const progress = here && span.total > 0 ? (here.start + frac * here.chars) / span.total : 0;
  const placeAt = (value: number) => {
    const at = value * span.total;
    const s = [...span.starts].reverse().find((x) => x.start <= at) ?? span.starts[0];
    return s ? { id: s.id, title: s.title, frac: Math.min(0.999, Math.max(0, (at - s.start) / s.chars)) } : null;
  };
  const sliderValue = dragging ?? progress;
  const sliderPlace = dragging != null ? placeAt(dragging) : null;

  function goToSlider(value: number) {
    setDragging(null);
    const to = placeAt(value);
    if (to) open(to.id, { frac: to.frac });
  }

  function goToPage(n: number) {
    if (!Number.isFinite(n) || n < 1) return;
    const wanted = Math.min(Math.round(n), info?.pages || Math.round(n));
    api
      .libraryBookPage(name, wanted)
      .then((found) => {
        if (!found) return setError(`Page ${wanted} wasn't found in this book.`);
        setPageInput("");
        open(found[0], { page: found[1] });
      })
      .catch((e) => setError(String(e)));
  }

  const depth = useMemo(() => {
    const byId = new Map(toc.map((e) => [e.id, e]));
    const d = new Map<number, number>();
    for (const e of toc) {
      let n = 0;
      let p = e.parent;
      while (p != null && n < 12) {
        n++;
        p = byId.get(p)?.parent ?? null;
      }
      d.set(e.id, n);
    }
    return d;
  }, [toc]);

  // a heading with no text of its own: list what's under it
  const children = section && !section.text.trim() ? toc.filter((e) => e.parent === section.id) : [];
  const title = section ? entryTitle(section.title, devotional) : "";
  const copyText = section ? `${title} — ${section.module_title}\n\n${plainText(section.text)}` : "";

  return (
    <Shell inMain={inMain}>
      {inMain ? (
        <div className="book-main-head">
          <h2>{info?.title ?? name}</h2>
          <button className="text-btn" onClick={onClose} title="Back to the Bible text">
            <ChevronLeftIcon size={14} /> Back to the Bible
          </button>
        </div>
      ) : (
        <div className="side-panel-header">
          <h3>{info?.title ?? name}</h3>
          <button onClick={onClose} aria-label="Close panel">
            <CloseIcon size={14} />
          </button>
        </div>
      )}
      <div className="book-bar">
        <button className="text-btn" onClick={() => setShowToc((s) => !s)} aria-expanded={showToc}>
          {showToc ? "Hide contents" : devotional ? "All dates" : "Contents"}
        </button>
        <form
          className="book-search"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) api.librarySearchBooks(query, name, 30).then(setHits).catch((er) => setError(String(er)));
          }}
        >
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={devotional ? "Search…" : "Search this book…"} aria-label="Search this book" />
        </form>
        <button className="text-btn" onClick={onOpenLibrary} title="Your installed books, and more to download">
          {inMain ? "Get more books" : "Library"}
        </button>
      </div>
      {section && !showToc && !!section.text.trim() && (
        <div className="book-place">
          <button className="pill-btn small" onClick={listenFromHere} title="Read aloud from the paragraph at the top of the window, and carry on through the book">
            <SpeakerIcon size={13} /> Listen from here
          </button>
          {span.starts.length > 1 && (
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(sliderValue * 1000)}
            onChange={(e) => setDragging(Number(e.target.value) / 1000)}
            onPointerUp={(e) => goToSlider(Number(e.currentTarget.value) / 1000)}
            onKeyUp={(e) => dragging != null && goToSlider(Number(e.currentTarget.value) / 1000)}
            onBlur={() => setDragging(null)}
            aria-label="Place in the book"
            title="Drag to move through the whole book"
          />
          )}
          {span.starts.length > 1 && (
          <span className="book-place-label muted">
            {Math.round(sliderValue * 100)}%{sliderPlace ? ` · ${entryTitle(sliderPlace.title, devotional)}` : ""}
          </span>
          )}
          {!!info?.pages && (
            <form
              className="book-page"
              onSubmit={(e) => {
                e.preventDefault();
                goToPage(Number(pageInput));
              }}
            >
              <label>
                Page{" "}
                <input
                  type="number"
                  min={1}
                  max={info.pages}
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  placeholder={page != null ? String(page) : ""}
                  aria-label="Go to page"
                />{" "}
                of {info.pages}
              </label>
              <button className="text-btn" type="submit" disabled={!pageInput}>
                Go
              </button>
            </form>
          )}
        </div>
      )}
      {error && <p className="status-error">{error}</p>}

      {hits && (
        <div className="book-hits">
          <div className="xref-list-head">
            <h4 className="section-label">
              {hits.length} result{hits.length === 1 ? "" : "s"} for “{query}”
            </h4>
            <button className="text-btn" onClick={() => setHits(null)}>
              Close
            </button>
          </div>
          <ul className="xref-list">
            {hits.map((h) => (
              <li key={h.id}>
                <button
                  className="link-btn"
                  onClick={() => {
                    setHits(null);
                    open(h.id);
                  }}
                >
                  {entryTitle(h.title, devotional)}
                </button>
                <span className="snippet">{h.snippet.replace(/⟪\d+⟫/g, "")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {showToc && (
        <ul className="book-toc">
          {toc.map((e) => (
            <li key={e.id} style={{ paddingLeft: `${(depth.get(e.id) ?? 0) * 0.9}rem` }}>
              <button
                className={"link-btn" + (section?.id === e.id ? " active" : "") + (e.has_text ? "" : " toc-heading")}
                onClick={() => {
                  open(e.id);
                  setShowToc(false);
                }}
              >
                {entryTitle(e.title, devotional)}
              </button>
            </li>
          ))}
        </ul>
      )}

      {section && !showToc && (
        <div className="book-text">
          <div className="book-section-head">
            <h4>{title}</h4>
            {section.text.trim() && (
              <span className="item-tools">
                <button className="text-btn answer-copy listen-btn" title="Read this section aloud from its start" onClick={() => listenFrom(0)}>
                  <SpeakerIcon size={13} /> Listen
                </button>
                <BasketButton add={() => addToBasket("text", `${title} — ${section.module_title}`, plainText(section.text))} />
                <CopyButton text={copyText} />
              </span>
            )}
          </div>
          {section.text.trim() ? (
            <div ref={textRef}>
              <RichText text={section.text} onJump={onJump} />
            </div>
          ) : (
            <ul className="book-children">
              {children.map((c) => (
                <li key={c.id}>
                  <button className="link-btn" onClick={() => open(c.id)}>
                    {entryTitle(c.title, devotional)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="book-nav">
            <button className="text-btn" disabled={section.prev == null} onClick={() => section.prev != null && open(section.prev)}>
              <ChevronLeftIcon size={14} /> Previous
            </button>
            {devotional && (
              <button
                className="text-btn"
                onClick={() => {
                  const t = toc.find((e) => e.title.trim() === todayKey());
                  if (t) open(t.id);
                }}
              >
                Today
              </button>
            )}
            <button className="text-btn" disabled={section.next == null} onClick={() => section.next != null && open(section.next)}>
              Next <ChevronRightIcon size={14} />
            </button>
          </div>
          {info?.licence && <p className="search-hint">{info.title} · {info.licence} · from your Library.</p>}
        </div>
      )}
    </Shell>
  );
}

function Shell({ inMain, children }: { inMain: boolean; children: ReactNode }) {
  return inMain ? <article className="book-panel book-main">{children}</article> : <aside className="side-panel wide book-panel">{children}</aside>;
}
