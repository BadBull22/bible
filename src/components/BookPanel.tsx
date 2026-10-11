import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { api, BookBookmark, BookHit, BookSection, InstalledModule, TocEntry } from "../api";
import { addToBasket } from "../basket";
import { BasketButton } from "./BasketButton";
import { CopyButton } from "./CopyButton";
import { BookmarkIcon, ChevronLeftIcon, ChevronRightIcon, CloseIcon, PlayIcon, SpeakerIcon } from "./icons";
import { BOOKMARK_HERE_EVENT, chunkText, LISTEN_FINISHED_EVENT, LISTEN_FROM_EVENT, READ_STATE_EVENT, ReaderState, requestListen } from "../readAloud";
import { keepInView, sentencesIn, showReading, textMap, watchForManualScroll } from "../readHighlight";
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

// Where the reading aloud last was in each book, so "Continue listening" can pick it up:
// the section's position in the contents, the paragraph, and the sentence within it.
const HEARD_KEY = "book:listening";

interface Heard {
  section: number;
  para: number;
  sentence: number;
}

function heardPlace(name: string): Heard | null {
  try {
    const h = (JSON.parse(localStorage.getItem(HEARD_KEY) ?? "{}") as Record<string, Heard>)[name];
    return h && typeof h.section === "number" && typeof h.para === "number" ? { section: h.section, para: h.para, sentence: Number(h.sentence) || 0 } : null;
  } catch {
    return null;
  }
}

function rememberHeard(name: string, heard: Heard) {
  try {
    const all = JSON.parse(localStorage.getItem(HEARD_KEY) ?? "{}") as Record<string, Heard>;
    all[name] = heard;
    localStorage.setItem(HEARD_KEY, JSON.stringify(all));
  } catch {
    /* per-viewer convenience only */
  }
}

/** Where to land inside a section once it has been drawn. */
type Target = { frac: number } | { page: number } | { para: number } | null;

/** Where in a paragraph to start reading aloud. */
interface ReadFrom {
  para: number;
  sentence: number;
}

// parts of a paragraph that aren't read aloud
const NOT_READ = ".page-mark";

// A place asked for from outside the book (a bookmark chosen in My Study): kept until the
// book has its contents, and announced in case the book is already open.
const BOOK_GOTO_EVENT = "book-go-to";
let pendingGoto: { name: string; section: number; para: number } | null = null;

/** Opens `name` (once it is the book on show) at a section and paragraph. */
export function goToBookPlace(name: string, section: number, para: number) {
  pendingGoto = { name, section, para };
  window.dispatchEvent(new Event(BOOK_GOTO_EVENT));
}

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
  const readOnOpen = useRef<ReadFrom | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const scroller = () => document.querySelector<HTMLElement>(inMain ? ".main-pane" : ".book-panel");
  const paraElements = () => [...(textRef.current?.querySelectorAll<HTMLElement>(".rich-text > p") ?? [])];
  // what the reader is speaking (its tag), and whether the page is following it
  const [readTag, setReadTag] = useState<string | null>(null);
  const [following, setFollowing] = useState(true);
  // where the reading aloud last was in this book
  const [heard, setHeard] = useState<Heard | null>(null);
  // the reader's own bookmarks in this book; the one being named; a short message
  const [marks, setMarks] = useState<BookBookmark[]>([]);
  const [naming, setNaming] = useState<{ id: number; label: string } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  // the paragraph under the mouse (or last clicked), for its Listen / Bookmark buttons
  const [hover, setHover] = useState<{ para: number; top: number } | null>(null);
  const loadMarks = () =>
    api
      .bookBookmarks(name)
      .then(setMarks)
      .catch(() => undefined);

  useEffect(() => {
    setSection(null);
    setHits(null);
    setQuery("");
    setHeard(heardPlace(name));
    loadMarks();
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
        // a bookmark chosen in My Study comes before the place last read
        const asked = pendingGoto?.name === name ? pendingGoto : null;
        if (asked) pendingGoto = null;
        if (asked && t[asked.section]) open(t[asked.section].id, { para: asked.para });
        else if (start != null) open(start, today == null && last?.id === start ? { frac: last.frac } : null);
        else setShowToc(true);
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  function open(id: number, land: Target = null, thenRead: ReadFrom | null = null) {
    setError(null);
    setHover(null);
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
    // reading on into a heading with no text of its own: carry on with what follows it
    if (section && land && readOnOpen.current && !section.text.trim() && section.next != null) {
      target.current = null;
      open(section.next, null, { para: 0, sentence: 0 });
      return;
    }
    if (!section || !land || !box || !text) return;
    target.current = null;
    const textTop = text.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    let top = 0;
    if ("page" in land) {
      const mark = text.querySelector<HTMLElement>(`[data-page="${land.page}"]`);
      if (mark) top = mark.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 90;
    } else if ("para" in land) {
      const p = paraElements()[land.para];
      if (p) top = p.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 110;
    } else if (land.frac > 0) {
      top = textTop + land.frac * text.offsetHeight - 90;
    }
    box.scrollTo({ top: Math.max(0, top) });
    const from = readOnOpen.current;
    if (from) {
      readOnOpen.current = null;
      listenFrom(from.para, from.sentence);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  /** Reads the open section aloud from a paragraph (and a sentence in it) on. The
   * sentences are taken from the page, each tagged "section|paragraph#sentence", so the
   * one being spoken can be shown. */
  function listenFrom(para = 0, sentence = 0) {
    if (!section || !textRef.current) return;
    const items: { tag: string; text: string }[] = [];
    if (para === 0 && sentence === 0) items.push({ tag: `${section.id}|title#0`, text: `${entryTitle(section.title, devotional)}.` });
    paraElements().forEach((p, pi) => {
      if (pi < para) return;
      sentencesIn(p, NOT_READ).forEach((s, si) => {
        if (pi === para && si < sentence) return;
        // a very long sentence goes to the voice in pieces, shown as one
        for (const piece of s.text.length > 420 ? chunkText(s.text) : [s.text]) items.push({ tag: `${section.id}|${pi}#${si}`, text: piece });
      });
    });
    if (!items.some((i) => !i.tag.includes("|title#"))) return;
    reading.current = section.id;
    setFollowing(true);
    requestListen({ items, label: info?.title ?? name });
  }

  /** The paragraph at the top of the window. */
  function topPara(): number {
    const box = scroller();
    if (!box) return 0;
    const top = box.getBoundingClientRect().top + 110;
    return Math.max(
      0,
      paraElements().findIndex((p) => p.getBoundingClientRect().bottom > top),
    );
  }

  // --- what is being read aloud, as the reader reports it
  useEffect(() => {
    const onState = (e: Event) => {
      const s = (e as CustomEvent<ReaderState>).detail;
      setReadTag(s.status === "idle" ? null : s.tag);
    };
    window.addEventListener(READ_STATE_EVENT, onState);
    return () => {
      window.removeEventListener(READ_STATE_EVENT, onState);
      showReading(null);
    };
  }, []);
  const spoken = /^(\d+)\|(\d+|title)#(\d+)$/.exec(readTag ?? "");
  // the section of this book being read (which may not be the one on show), and where in it
  const readSection = spoken && toc.some((e) => e.id === Number(spoken[1])) ? Number(spoken[1]) : null;
  const readHere = readSection != null && readSection === section?.id;
  const readPara = readHere && spoken && spoken[2] !== "title" ? Number(spoken[2]) : null;
  const readSentence = spoken ? Number(spoken[3]) : 0;
  const sectionPos = section ? toc.findIndex((e) => e.id === section.id) : -1;

  // tint the sentence being spoken (and, lightly, its paragraph); keep it in view while following
  useEffect(() => {
    const text = textRef.current;
    text?.querySelectorAll(".reading-para").forEach((p) => p.classList.remove("reading-para", "reading-para--whole"));
    const p = readPara != null ? paraElements()[readPara] : undefined;
    if (!p) {
      showReading(null);
      return;
    }
    const range = sentencesIn(p, NOT_READ)[readSentence]?.range() ?? null;
    const tinted = !!range && showReading(range);
    if (!tinted) showReading(null);
    p.classList.add("reading-para");
    p.classList.toggle("reading-para--whole", !tinted); // no sentence to show: the paragraph instead
    const box = scroller();
    if (following && box) keepInView(box, range ?? p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readPara, readSentence, following, section]);

  // following stops when the reader scrolls for themselves
  useEffect(() => {
    const box = scroller();
    if (!readHere || !box) return;
    setFollowing(true);
    return watchForManualScroll(box, () => setFollowing(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readHere]);

  // remember where the reading has got to, for "Continue listening"
  useEffect(() => {
    if (readPara == null || sectionPos < 0) return;
    const h = { section: sectionPos, para: readPara, sentence: readSentence };
    rememberHeard(name, h);
    setHeard(h);
  }, [readPara, readSentence, sectionPos, name]);

  /** Shows the place being read again, and follows it from there. */
  function backToReading() {
    if (readSection != null && readSection !== section?.id && spoken) {
      open(readSection, spoken[2] === "title" ? null : { para: Number(spoken[2]) });
      reading.current = readSection; // still the section being read, so the next one follows on
    }
    setFollowing(true);
  }

  function continueListening() {
    const entry = heard ? toc[heard.section] : undefined;
    if (!heard || !entry) return;
    if (section?.id === entry.id && !showToc) listenFrom(heard.para, heard.sentence);
    else open(entry.id, { para: heard.para }, { para: heard.para, sentence: heard.sentence });
  }

  // --- the reader's own bookmarks
  useEffect(() => {
    const here = new Set(marks.filter((m) => m.section === sectionPos).map((m) => m.para));
    paraElements().forEach((p, i) => p.classList.toggle("has-bookmark", here.has(i)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marks, section, sectionPos, showToc]);

  const say = (message: string) => {
    setFlash(message);
    window.setTimeout(() => setFlash((f) => (f === message ? null : f)), 2500);
  };

  /** Bookmarks a paragraph of the open section; with `toggle`, removes the bookmark already there. */
  async function bookmarkPara(para: number, toggle = false) {
    const p = paraElements()[para];
    if (!section || !p || sectionPos < 0) return;
    const existing = marks.find((m) => m.section === sectionPos && m.para === para);
    try {
      if (existing) {
        if (!toggle) return say("This place is already bookmarked.");
        await api.bookBookmarkRemove(existing.id);
        if (naming?.id === existing.id) setNaming(null);
        say("Bookmark removed.");
      } else {
        const snippet = textMap(p, NOT_READ).text.replace(/\s+/g, " ").trim().slice(0, 140);
        const id = await api.bookBookmarkAdd({ id: 0, module: name, section: sectionPos, para, label: "", snippet, created_at: "" });
        setFlash(null);
        setNaming({ id, label: "" });
      }
      await loadMarks();
    } catch (e) {
      setError(String(e));
    }
  }

  async function renameMark(id: number, label: string) {
    await api.bookBookmarkRename(id, label).catch((e) => setError(String(e)));
    setNaming(null);
    await loadMarks();
  }

  async function removeMark(id: number) {
    await api.bookBookmarkRemove(id).catch((e) => setError(String(e)));
    if (naming?.id === id) setNaming(null);
    await loadMarks();
  }

  function openMark(m: { section: number; para: number }) {
    const entry = toc[m.section];
    if (entry) open(entry.id, { para: m.para });
  }

  // "Listen from here" and "Bookmark this place" from the right-click menu, and a
  // bookmark chosen in My Study while this book is open
  const act = useRef({ listenFrom, bookmarkPara, openMark });
  act.current = { listenFrom, bookmarkPara, openMark };
  useEffect(() => {
    const onListen = (e: Event) => {
      const para = (e as CustomEvent<{ book?: { para: number } }>).detail?.book?.para;
      if (typeof para === "number") act.current.listenFrom(para);
    };
    const onBookmark = (e: Event) => {
      const para = (e as CustomEvent<{ para?: number }>).detail?.para;
      if (typeof para === "number") void act.current.bookmarkPara(para);
    };
    const onGoto = () => {
      if (pendingGoto?.name !== name) return;
      const to = pendingGoto;
      pendingGoto = null;
      act.current.openMark(to);
    };
    window.addEventListener(LISTEN_FROM_EVENT, onListen);
    window.addEventListener(BOOKMARK_HERE_EVENT, onBookmark);
    window.addEventListener(BOOK_GOTO_EVENT, onGoto);
    return () => {
      window.removeEventListener(LISTEN_FROM_EVENT, onListen);
      window.removeEventListener(BOOKMARK_HERE_EVENT, onBookmark);
      window.removeEventListener(BOOK_GOTO_EVENT, onGoto);
    };
  }, [name]);

  /** The paragraph under the mouse gets its own Listen and Bookmark buttons. */
  function pointAt(e: React.MouseEvent<HTMLDivElement>) {
    const at = e.target as HTMLElement;
    if (at.closest(".para-tools")) return;
    const p = at.closest<HTMLElement>(".rich-text > p");
    const wrap = textRef.current;
    if (!p || !wrap) return;
    const para = paraElements().indexOf(p);
    if (para < 0 || hover?.para === para) return;
    setHover({ para, top: p.getBoundingClientRect().top - wrap.getBoundingClientRect().top });
  }

  // a section read to its end: carry on into the next one (unless told to stop there)
  useEffect(() => {
    const onFinished = (e: Event) => {
      const stop = (e as CustomEvent<{ stop?: boolean }>).detail?.stop;
      if (!stop && section && reading.current === section.id && section.next != null && !devotional) open(section.next, null, { para: 0, sentence: 0 });
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
          <button className="pill-btn small" onClick={() => listenFrom(topPara())} title="Read aloud from the paragraph at the top of the window, and carry on through the book">
            <SpeakerIcon size={13} /> Listen from here
          </button>
          {heard && toc[heard.section] && readSection == null && (
            <button
              className="pill-btn small quiet"
              onClick={continueListening}
              title={`Carry on reading aloud from where it stopped: ${entryTitle(toc[heard.section].title, devotional)}`}
            >
              <PlayIcon size={12} /> Continue listening
            </button>
          )}
          <button className="pill-btn small quiet" onClick={() => bookmarkPara(topPara())} title="Bookmark the paragraph at the top of the window (your bookmarks are listed in Contents)">
            <BookmarkIcon size={13} /> Bookmark
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
          {naming && (
            <form
              className="book-mark-name"
              onSubmit={(e) => {
                e.preventDefault();
                void renameMark(naming.id, naming.label);
              }}
            >
              <BookmarkIcon size={13} /> Bookmarked.
              <input
                autoFocus
                value={naming.label}
                maxLength={120}
                onChange={(e) => setNaming({ ...naming, label: e.target.value })}
                placeholder="Give it a name (optional)"
                aria-label="Name for this bookmark"
              />
              <button className="text-btn" type="submit">
                {naming.label.trim() ? "Save" : "Done"}
              </button>
            </form>
          )}
          {flash && <span className="book-flash">{flash}</span>}
        </div>
      )}
      {readSection != null && (!readHere || !following || showToc) && (
        <button className="back-to-reading" onClick={() => (showToc && readHere ? (setShowToc(false), setFollowing(true)) : backToReading())}>
          Back to where it's reading
        </button>
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

      {showToc && marks.length > 0 && (
        <div className="book-marks">
          <h4 className="section-label">Your bookmarks</h4>
          <ul>
            {marks.map((m) => (
              <li key={m.id}>
                <BookmarkIcon size={13} />
                {naming?.id === m.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void renameMark(m.id, naming.label);
                    }}
                  >
                    <input autoFocus value={naming.label} maxLength={120} onChange={(e) => setNaming({ id: m.id, label: e.target.value })} aria-label="Name for this bookmark" />
                    <button className="text-btn" type="submit">
                      Save
                    </button>
                  </form>
                ) : (
                  <button className="link-btn" onClick={() => openMark(m)} title="Go to this bookmark">
                    {m.label || `“${m.snippet.slice(0, 70)}${m.snippet.length > 70 ? "…" : ""}”`}
                  </button>
                )}
                <span className="muted book-mark-where">{toc[m.section] ? entryTitle(toc[m.section].title, devotional) : ""}</span>
                {naming?.id !== m.id && (
                  <button className="text-btn" onClick={() => setNaming({ id: m.id, label: m.label })}>
                    Rename
                  </button>
                )}
                <button className="text-btn" onClick={() => removeMark(m.id)} title="Remove this bookmark" aria-label="Remove this bookmark">
                  <CloseIcon size={12} />
                </button>
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
                <button className="text-btn answer-copy listen-btn" title="Read this section aloud from its start" onClick={() => listenFrom()}>
                  <SpeakerIcon size={13} /> Listen
                </button>
                <BasketButton add={() => addToBasket("text", `${title} — ${section.module_title}`, plainText(section.text))} />
                <CopyButton text={copyText} />
              </span>
            )}
          </div>
          {section.text.trim() ? (
            <div ref={textRef} className="book-body" onMouseMove={pointAt} onClick={pointAt} onMouseLeave={() => setHover(null)}>
              <RichText text={section.text} onJump={onJump} />
              {hover && (
                <div className="para-tools" style={{ top: hover.top }}>
                  <button onClick={() => listenFrom(hover.para)} title="Listen from this paragraph" aria-label="Listen from this paragraph">
                    <SpeakerIcon size={13} />
                  </button>
                  <button
                    className={marks.some((m) => m.section === sectionPos && m.para === hover.para) ? "on" : ""}
                    onClick={() => bookmarkPara(hover.para, true)}
                    title={marks.some((m) => m.section === sectionPos && m.para === hover.para) ? "Remove this bookmark" : "Bookmark this paragraph"}
                    aria-label="Bookmark this paragraph"
                  >
                    <BookmarkIcon size={13} />
                  </button>
                </div>
              )}
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
