import { useEffect, useMemo, useState } from "react";
import { api, BookHit, BookSection, InstalledModule, TocEntry } from "../api";
import { addToBasket } from "../basket";
import { BasketButton } from "./BasketButton";
import { CopyButton } from "./CopyButton";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "./icons";
import { ListenButton } from "./ListenButton";
import { plainText, RichText } from "./RichText";

interface Props {
  name: string;
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

const LAST_KEY = "book:last";

function lastSection(name: string): number | null {
  try {
    return (JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}") as Record<string, number>)[name] ?? null;
  } catch {
    return null;
  }
}

function rememberSection(name: string, id: number) {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}") as Record<string, number>;
    all[name] = id;
    localStorage.setItem(LAST_KEY, JSON.stringify(all));
  } catch {
    /* per-viewer convenience only */
  }
}

/** Reads an installed Library book or devotional: contents, one section at a time,
 * Previous/Next, search inside the book, and Listen / Copy / Basket for the section. */
export function BookPanel({ name, onJump, onOpenLibrary, onClose }: Props) {
  const [info, setInfo] = useState<InstalledModule | null>(null);
  const [toc, setToc] = useState<TocEntry[]>([]);
  const [section, setSection] = useState<BookSection | null>(null);
  const [showToc, setShowToc] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<BookHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const devotional = info?.kind === "devotional";

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
        const start =
          (isDevotional ? t.find((e) => e.title.trim() === todayKey())?.id : null) ??
          lastSection(name) ??
          t.find((e) => e.has_text)?.id ??
          null;
        if (start != null) open(start);
        else setShowToc(true);
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  function open(id: number) {
    setError(null);
    api
      .librarySection(id)
      .then((s) => {
        if (!s) return;
        setSection(s);
        rememberSection(name, id);
        document.querySelector(".book-panel .book-text")?.scrollTo({ top: 0 });
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
    <aside className="side-panel wide book-panel">
      <div className="side-panel-header">
        <h3>{info?.title ?? name}</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
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
          Library
        </button>
      </div>
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
                <span className="snippet">{h.snippet}</span>
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
                <ListenButton title="Read this section aloud" text={() => plainText(section.text)} />
                <BasketButton add={() => addToBasket("text", `${title} — ${section.module_title}`, plainText(section.text))} />
                <CopyButton text={copyText} />
              </span>
            )}
          </div>
          {section.text.trim() ? (
            <RichText text={section.text} onJump={onJump} />
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
          {info?.licence && <p className="search-hint">{info.title} · {info.licence} · from the CrossWire Bible Society library.</p>}
        </div>
      )}
    </aside>
  );
}
