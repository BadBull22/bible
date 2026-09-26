import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { api, BookInfo, ChapterMarks, resolveReference, Version, VerseWithWords } from "./api";
import { addSearchHistory } from "./searchHistory";
import { Sidebar } from "./components/Sidebar";
import { ChapterView } from "./components/ChapterView";
import { HomeScreen } from "./components/HomeScreen";
import { WordStudyPanel } from "./components/WordStudyPanel";
import { ParallelPanel } from "./components/ParallelPanel";
import { SearchPanel } from "./components/SearchPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { FirstsPanel } from "./components/FirstsPanel";
import { CommentaryPanel } from "./components/CommentaryPanel";
import { EntitiesPanel } from "./components/EntitiesPanel";
import { ResizeHandle } from "./components/ResizeHandle";
import { SplashScreen } from "./components/SplashScreen";
import { ClosingSplash } from "./components/ClosingSplash";
import { InterlinearPanel } from "./components/InterlinearPanel";
import { DictionaryPanel } from "./components/DictionaryPanel";
import { StudyPanel } from "./components/StudyPanel";
import { HelpPanel } from "./components/HelpPanel";
import { StudySheetPanel } from "./components/StudySheetPanel";
import { BasketPanel } from "./components/BasketPanel";
import { useBasket } from "./basket";
import { ReadAloudBar } from "./components/ReadAloudBar";
import { chapterAnnouncement, chunkText, LISTEN_EVENT, loadReadPrefs, ReadAloud, ReaderState, ReadItem, speechText } from "./readAloud";
import { SelectionMenu, SelectionPayload } from "./components/SelectionMenu";
import { applyPrefs, loadPrefs, ReadingPrefs, savePrefs } from "./readingPrefs";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { BackIcon, BasketIcon, DictionaryIcon, FocusIcon, HomeIcon, MapIcon, MenuIcon, NotebookIcon, PrintIcon, SearchIcon, SettingsIcon, StarIcon, TimelineIcon, TreeIcon, UsersIcon } from "./components/icons";
import "./App.css";

// The two graph panels pull in cytoscape (+ the cola layout), and the map panel pulls
// in Leaflet -- by far the largest dependencies; loading them on first use keeps the
// initial bundle small.
const CrossRefGraph = lazy(() => import("./components/CrossRefGraph").then((m) => ({ default: m.CrossRefGraph })));
const GenealogyPanel = lazy(() => import("./components/GenealogyPanel").then((m) => ({ default: m.GenealogyPanel })));
const MapPanel = lazy(() => import("./components/MapPanel").then((m) => ({ default: m.MapPanel })));
// The timeline draws its own SVG, but its facsimile view of Adams' chart is a Leaflet
// tile layer -- same reason as the map panel for keeping it out of the initial bundle.
const TimelinePanel = lazy(() => import("./components/TimelinePanel").then((m) => ({ default: m.TimelinePanel })));

function PanelFallback() {
  return (
    <aside className="side-panel">
      <p className="muted">Loading…</p>
    </aside>
  );
}

type SidePanel =
  | { kind: "word"; strongsNumbers: string[]; surfaceText: string }
  | { kind: "xref"; book: string; chapter: number; verse: number }
  | { kind: "parallel"; book: string; chapter: number; verse: number }
  | { kind: "search"; initialQuery?: string }
  | { kind: "settings" }
  | { kind: "genealogy" }
  | { kind: "firsts" }
  | { kind: "map" }
  | { kind: "timeline"; focusPersonId?: string }
  // commentary / entities follow the reader's current book+chapter (so paging keeps them in sync)
  | { kind: "commentary"; verse: number | null; commentaryId?: string }
  | { kind: "entities" }
  | { kind: "interlinear"; book: string; chapter: number; verse: number }
  | { kind: "dictionary"; verse?: { book: string; chapter: number; verse: number }; initialQuery?: string }
  | { kind: "study"; tab?: "notes" | "highlights" | "bookmarks" | "plans" }
  | { kind: "help" }
  | { kind: "sheet"; book: string; chapter: number; verseStart: number; verseEnd: number }
  | { kind: "basket" }
  | null;

const NO_MARKS: ChapterMarks = { bookmarks: [], highlights: [], notes: [] };

interface Location {
  book: string;
  chapter: number;
}

const ENOCH_BOOK = "Enoch";

// Resizable layout: sidebar and side-panel widths are per-viewer conveniences kept in
// localStorage (with try/catch: storage can be unavailable) and clamped to sane bounds.
const SIDEBAR = { key: "layout:sidebar", default: 240, min: 160, max: 480 };
const PANEL = { key: "layout:panel", default: 0, min: 300, max: 900 }; // 0 = use the CSS default

function readStoredWidth(spec: { key: string; default: number; min: number; max: number }): number {
  try {
    const v = Number(localStorage.getItem(spec.key));
    if (v && v >= spec.min && v <= spec.max) return v;
  } catch {
    /* fall through */
  }
  return spec.default;
}

function storeWidth(key: string, value: number) {
  try {
    if (value) localStorage.setItem(key, String(value));
    else localStorage.removeItem(key);
  } catch {
    /* per-viewer convenience only */
  }
}
const ENOCH_VERSION = "ENOCH1";
const HISTORY_LIMIT = 50;

function App() {
  const [showSplash, setShowSplash] = useState(true);
  // The close button is intercepted in Rust, which emits `app-close-requested` instead of
  // closing; the farewell verse then shows for three seconds and calls exit_app.
  const [closing, setClosing] = useState(false);
  const [farewellVerse, setFarewellVerse] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [books, setBooks] = useState<BookInfo[]>([]);
  const [chapterCounts, setChapterCounts] = useState<Record<string, number>>({});
  const [versionCode, setVersionCode] = useState("BSB");
  const [book, setBook] = useState("Genesis");
  const [chapter, setChapter] = useState(1);
  const [verses, setVerses] = useState<VerseWithWords[]>([]);
  const [loadingChapter, setLoadingChapter] = useState(true);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [panel, setPanel] = useState<SidePanel>(null);
  // The app opens on a search prompt instead of straight into Genesis 1 -- this flips to
  // false the moment the reader picks somewhere to go, and never flips back this session.
  const [homeActive, setHomeActive] = useState(true);
  // The place last opened in People & Places or the Map, so switching between the two
  // panels lands on the same place instead of losing your spot.
  const [focusedPlaceId, setFocusedPlaceId] = useState<string | null>(null);
  const [quickQuery, setQuickQuery] = useState("");
  const [history, setHistory] = useState<Location[]>([]);
  const [targetVerse, setTargetVerse] = useState<number | null>(null);
  const [preEnochVersion, setPreEnochVersion] = useState("BSB");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredWidth(SIDEBAR));
  const [panelWidth, setPanelWidth] = useState(() => readStoredWidth(PANEL));
  useEffect(() => storeWidth(SIDEBAR.key, sidebarWidth), [sidebarWidth]);
  useEffect(() => storeWidth(PANEL.key, panelWidth), [panelWidth]);
  // Drag limits shrink with the window so the reading pane always keeps ~320px.
  const READER_MIN = 340;
  const currentPanelWidth = panel ? panelWidth || panelDefaultWidth(panel.kind) : 0;
  const sidebarMax = Math.max(SIDEBAR.min, Math.min(SIDEBAR.max, window.innerWidth - currentPanelWidth - READER_MIN));
  const panelMax = Math.max(PANEL.min, Math.min(PANEL.max, window.innerWidth - (sidebarOpen ? sidebarWidth : 0) - READER_MIN));
  const quickSearchRef = useRef<HTMLInputElement>(null);
  // The reader's own marks (highlights/bookmarks/notes) for the chapter on screen, and a
  // counter bumped whenever they change so the My Study lists and Home screen refresh.
  const [marks, setMarks] = useState<ChapterMarks>(NO_MARKS);
  const [studyVersion, setStudyVersion] = useState(0);
  const [basketItems] = useBasket();
  const [prefs, setPrefs] = useState<ReadingPrefs>(() => loadPrefs());
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => {
    applyPrefs(prefs);
    savePrefs(prefs);
  }, [prefs]);
  useEffect(() => {
    if (homeActive) return;
    let cancelled = false;
    api
      .chapterMarks(book, chapter)
      .then((m) => !cancelled && setMarks(m))
      .catch(() => !cancelled && setMarks(NO_MARKS));
    return () => {
      cancelled = true;
    };
  }, [book, chapter, homeActive, studyVersion]);

  // Focus mode: full screen, no book list or side panels, just the text. Esc leaves it.
  function setFocus(on: boolean) {
    setFocusMode(on);
    if (on) setPanel(null);
    getCurrentWindow()
      .setFullscreen(on)
      .catch(() => undefined);
  }
  // Monotonic token so a slow chapter response can never overwrite a newer one
  // (e.g. rapid Next/Next/Next, or a jump landing while a previous load is in flight).
  const chapterRequest = useRef(0);

  useEffect(() => {
    api.listVersions().then(setVersions).catch(console.error);
    api.listBooks().then(setBooks).catch(console.error);
    api
      .chapterCounts()
      .then((rows) => {
        const map: Record<string, number> = {};
        for (const [name, count] of rows) map[name] = count;
        setChapterCounts(map);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    // Read the farewell verse up front so pressing the close button shows it instantly
    // rather than waiting on a query. It comes from the bundled text like everything else,
    // so there's no second copy of the verse in the source to drift out of step.
    api
      .getVerseWithStrongs("BSB", "John", 3, 16)
      .then((v) => setFarewellVerse(v.text))
      .catch(console.error);

    // The window's own close hook. A long stretch of this session's testing made this
    // look unreliable (measured 2 successes in 17 runs, across several different
    // registration designs including a Rust-driven eval() approach) -- turned out to be
    // the TEST HARNESS closing the window before the page had finished loading, in a dev
    // session under extreme load from dozens of back-to-back rebuilds. Once close was
    // sent only after the app had actually finished mounting, this simple design worked
    // every time. See HANDOVER.md's Phase 8 notes before "fixing" this again.
    getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        setClosing(true);
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(console.error);

    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (homeActive) return; // nothing chosen yet -- don't fetch Genesis 1 just to hide it
    const id = ++chapterRequest.current;
    setLoadingChapter(true);
    setChapterError(null);
    api
      .getChapterWithStrongs(versionCode, book, chapter)
      .then(
        (rows) => {
          if (id !== chapterRequest.current) return;
          // verses and loading flip together in one callback so they commit in the
          // same render -- ChapterView's scroll logic keys off `loading` going false.
          setVerses(rows);
          setLoadingChapter(false);
        },
        (e) => {
          if (id !== chapterRequest.current) return;
          setVerses([]);
          setChapterError(String(e));
          setLoadingChapter(false);
        },
      );
  }, [versionCode, book, chapter, homeActive]);

  // Neighbouring chapters for Previous/Next, crossing book boundaries (Genesis 50 ->
  // Exodus 1, Malachi 4 -> Matthew 1) but never crossing between the biblical canon
  // and the Apocrypha section, so paging past Revelation doesn't silently land in Enoch.
  const adjacent = useMemo(() => {
    const idx = books.findIndex((b) => b.name === book);
    if (idx < 0) return { prev: null as Location | null, next: null as Location | null };
    const count = chapterCounts[book] ?? 0;
    const sameCanon = (a: BookInfo, b: BookInfo) => (a.testament === "Apocrypha") === (b.testament === "Apocrypha");
    let prev: Location | null = null;
    let next: Location | null = null;
    if (chapter > 1) {
      prev = { book, chapter: chapter - 1 };
    } else {
      const pb = books[idx - 1];
      if (pb && sameCanon(pb, books[idx])) prev = { book: pb.name, chapter: chapterCounts[pb.name] ?? 1 };
    }
    if (chapter < count) {
      next = { book, chapter: chapter + 1 };
    } else {
      const nb = books[idx + 1];
      if (nb && sameCanon(nb, books[idx])) next = { book: nb.name, chapter: 1 };
    }
    return { prev, next };
  }, [books, book, chapter, chapterCounts]);

  // Enoch has exactly one translation, so entering/leaving it auto-switches the
  // version rather than leaving the reader on a mismatched version showing no text
  // (the same confusion TR/WLC can cause on the wrong testament). Every route that
  // changes the book (sidebar, jumps, Back, Previous/Next) must go through here.
  function applyLocation(b: string, c: number) {
    if (b === ENOCH_BOOK && versionCode !== ENOCH_VERSION) {
      setPreEnochVersion(versionCode);
      setVersionCode(ENOCH_VERSION);
    } else if (b !== ENOCH_BOOK && versionCode === ENOCH_VERSION) {
      setVersionCode(preEnochVersion);
    }
    setBook(b);
    setChapter(c);
    // Every path that lands somewhere real (sidebar, top search, cross-refs, the opening
    // prompt itself) should retire the opening screen, not just its own search box.
    setHomeActive(false);
  }

  function navigate(b: string, c: number, keepPanel: boolean) {
    if (b !== book || c !== chapter) {
      setHistory((h) => [...h.slice(-(HISTORY_LIMIT - 1)), { book, chapter }]);
    }
    applyLocation(b, c);
    if (!keepPanel) setPanel(null);
  }

  function goTo(b: string, c: number) {
    setTargetVerse(null);
    navigate(b, c, false);
  }

  // Used for jumps that originate from a side panel (cross-references, search,
  // genealogies, firsts): the panel stays open so the user can keep exploring from
  // it, and the landed-on verse scrolls to the top of the reading pane and briefly
  // highlights instead of leaving the reader to hunt for it from verse 1.
  function jumpTo(b: string, c: number, v: number) {
    setTargetVerse(v);
    navigate(b, c, true);
  }

  // From the opening search prompt: no history entry (there's nothing to go "back" to
  // before it) and no panel to preserve, just land on the chosen passage.
  function startFromHome(b: string, c: number, v: number | null) {
    setTargetVerse(v);
    applyLocation(b, c);
  }

  // Same as startFromHome, but also opens a side panel -- used by the opening screen's
  // stat tiles that demonstrate a feature live (e.g. "Cross-references" jumps to a
  // richly-linked verse with the cross-reference graph already open) rather than just
  // stating a number with nowhere to go.
  function startFromHomeWithPanel(b: string, c: number, v: number, panel: SidePanel) {
    setTargetVerse(v);
    applyLocation(b, c);
    setPanel(panel);
  }

  // ---- read aloud ------------------------------------------------------------------
  // One reader for the whole app. It reads the chapter on screen verse by verse; at the
  // end it can turn to the next chapter and carry on. Navigating elsewhere yourself (or
  // changing translation) stops it.
  const [readState, setReadState] = useState<ReaderState>({ status: "idle", verse: null, message: null, engine: "natural" });
  const [readPrefs, setReadPrefs] = useState(loadReadPrefs);
  const readFinished = useRef<() => void>(() => undefined);
  const readerRef = useRef<ReadAloud | null>(null);
  readerRef.current ??= new ReadAloud(setReadState, () => readFinished.current());
  const reader = readerRef.current;
  const listening = useRef<{ book: string; chapter: number; version: string } | null>(null);
  const continueTo = useRef<string | null>(null);
  const canListen = !homeActive && versions.find((v) => v.code === versionCode)?.language === "English" && verses.length > 0;

  // "chapter": reading the chapter (may carry on to the next); "selection": reading what
  // the reader selected and chose "Listen to selection" for -- stops at its end.
  const readMode = useRef<"chapter" | "selection">("chapter");

  function listen(fromVerse: number) {
    const items: ReadItem[] = [];
    if (fromVerse <= (verses[0]?.verse ?? 1)) items.push({ verse: 0, text: chapterAnnouncement(book, chapter) });
    for (const v of verses) if (v.verse >= fromVerse) items.push({ verse: v.verse, text: speechText(v.text) });
    readMode.current = "chapter";
    listening.current = { book, chapter, version: versionCode };
    reader.start(items, 0);
  }

  function listenSelection(sel: SelectionPayload) {
    readMode.current = "selection";
    if (sel.verses && !homeActive) {
      // Bible text in the chapter: read it verse by verse, highlighting as it goes
      listening.current = { book, chapter, version: versionCode };
      reader.start(sel.verses.map((v) => ({ verse: v.verse, text: speechText(v.text) })));
    } else {
      // a commentary note, word study, dictionary entry...: not tied to the chapter
      listening.current = null;
      reader.start(chunkText(sel.text).map((t) => ({ verse: -1, text: speechText(t) })));
    }
  }

  // the 🔊 Listen buttons in side panels (commentary, Word Study, dictionary, answers)
  const listenSelectionRef = useRef(listenSelection);
  listenSelectionRef.current = listenSelection;
  useEffect(() => {
    const onRequest = (e: Event) => listenSelectionRef.current({ text: (e as CustomEvent<string>).detail, verses: null });
    window.addEventListener(LISTEN_EVENT, onRequest);
    return () => window.removeEventListener(LISTEN_EVENT, onRequest);
  }, []);

  readFinished.current = () => {
    if (readMode.current === "chapter" && reader.prefsNow.continueChapters && adjacent.next) {
      continueTo.current = `${adjacent.next.book}/${adjacent.next.chapter}`;
      flipChapter(adjacent.next);
    } else {
      listening.current = null;
    }
  };

  useEffect(() => {
    // the loaded verses must belong to the chapter now showing before anything is read
    const loaded = !loadingChapter && verses[0]?.book === book && verses[0]?.chapter === chapter;
    if (continueTo.current === `${book}/${chapter}`) {
      if (loaded) {
        continueTo.current = null;
        listen(verses[0].verse);
      }
      return;
    }
    const l = listening.current;
    if (l && (l.book !== book || l.chapter !== chapter || l.version !== versionCode)) {
      reader.stop();
      listening.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingChapter, verses, book, chapter, versionCode]);

  useEffect(() => () => reader.stop(), [reader]);

  const readingHere =
    readState.status !== "idle" && listening.current?.book === book && listening.current?.chapter === chapter ? readState.verse : null;

  // Previous/Next keep whatever panel is open: paging through chapters while a
  // comparison or word study is up is a normal reading pattern.
  function flipChapter(to: Location | null) {
    if (!to) return;
    setTargetVerse(null);
    navigate(to.book, to.chapter, true);
  }

  function goBack() {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setTargetVerse(null);
    applyLocation(prev.book, prev.chapter);
    setPanel(null);
  }

  // Back to the opening "Gospel" screen. Deliberately doesn't touch `history` -- home
  // isn't a reading location, so it shouldn't consume a Back step or be reachable by
  // pressing Back afterward; the current chapter/verses stay loaded underneath and pick
  // up exactly where they were if the reader navigates away from home again.
  function goHome() {
    setPanel(null);
    setHomeActive(true);
  }

  function changeVersion(code: string) {
    setTargetVerse(null);
    setVersionCode(code);
  }

  function runQuickSearch() {
    const q = quickQuery.trim();
    if (!q) return;
    // Shared with the opening Gospel screen's search box (see searchHistory.ts) -- a
    // term typed here is just as worth remembering as one typed there.
    addSearchHistory(q);
    // A typed reference ("John 3:16", "gen 1", "Jude 3") navigates directly instead
    // of being sent to search -- the most common thing people type into a Bible app.
    const resolved = resolveReference(q, books, chapterCounts);
    if (resolved) {
      if (resolved.verse !== null) jumpTo(resolved.book, resolved.chapter, resolved.verse);
      else {
        setTargetVerse(null);
        navigate(resolved.book, resolved.chapter, true);
      }
      setQuickQuery("");
      return;
    }
    setPanel({ kind: "search", initialQuery: q });
  }

  // Keyboard shortcuts. Handlers are read through a ref so the listener is attached
  // once but always sees the latest state without re-subscribing on every render.
  const shortcuts = useRef({ adjacent, flipChapter, closePanel: () => setPanel(null), focusMode, setFocus });
  shortcuts.current = { adjacent, flipChapter, closePanel: () => setPanel(null), focusMode, setFocus };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        quickSearchRef.current?.focus();
        quickSearchRef.current?.select();
        return;
      }
      if (e.key === "Escape") {
        if (typing) (t as HTMLElement).blur();
        else if (shortcuts.current.focusMode) shortcuts.current.setFocus(false);
        else shortcuts.current.closePanel();
        return;
      }
      if (e.key === "F11") {
        e.preventDefault();
        shortcuts.current.setFocus(!shortcuts.current.focusMode);
        return;
      }
      if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowLeft") shortcuts.current.flipChapter(shortcuts.current.adjacent.prev);
      else if (e.key === "ArrowRight") shortcuts.current.flipChapter(shortcuts.current.adjacent.next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
      {closing && (
        <ClosingSplash
          verse={farewellVerse}
          onDone={() => {
            // destroy() closes the window we just prevented from closing; exit_app is the
            // fallback if the window permission is ever missing again.
            getCurrentWindow()
              .destroy()
              .catch(() => api.exitApp().catch(() => undefined));
          }}
        />
      )}
      <div className={"app-shell" + (focusMode ? " focus-mode" : "")}>
        <header className="top-bar">
          <button
            className="icon-btn"
            onClick={() => setSidebarOpen((o) => !o)}
            title={sidebarOpen ? "Hide book list" : "Show book list"}
            aria-label={sidebarOpen ? "Hide book list" : "Show book list"}
            aria-pressed={sidebarOpen}
          >
            <MenuIcon size={18} />
          </button>
          <div className="brand">
            <span className="mark">✦</span>
            <h1>Bible Concordance</h1>
          </div>
          {book === ENOCH_BOOK ? (
            <span className="version-label" title="Enoch has only one translation bundled here">
              Charles &amp; Oesterley (1917)
            </span>
          ) : (
            <select value={versionCode} onChange={(e) => changeVersion(e.target.value)} aria-label="Translation">
              {versions
                .filter((v) => v.code !== ENOCH_VERSION)
                .map((v) => (
                  <option key={v.code} value={v.code}>
                    {v.code} — {v.name}
                  </option>
                ))}
            </select>
          )}
          <form
            className="top-search"
            onSubmit={(e) => {
              e.preventDefault();
              runQuickSearch();
            }}
          >
            <SearchIcon size={16} className="icon" />
            <input
              ref={quickSearchRef}
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              placeholder="Search a topic, or type a reference like John 3:16"
              aria-label="Search or go to reference"
            />
            <kbd className="shortcut-hint" title="Press Ctrl+K to focus search">
              Ctrl K
            </kbd>
          </form>
          <button
            className="text-btn"
            onClick={goHome}
            disabled={homeActive}
            title="Back to the opening screen"
            aria-label="Home"
          >
            <HomeIcon size={15} /> <span className="label">Home</span>
          </button>
          <button
            className="text-btn"
            onClick={goBack}
            disabled={history.length === 0}
            title="Back to where you were reading"
            aria-label="Back"
          >
            <BackIcon size={15} /> <span className="label">Back</span>
          </button>
          <div className="spacer" />
          {focusMode ? (
            <button className="pill-btn" onClick={() => setFocus(false)} title="Leave focus mode (Esc)">
              <FocusIcon size={15} /> <span className="label">Exit focus</span>
            </button>
          ) : (
            <>
          <button className="text-btn" onClick={() => setPanel({ kind: "study" })} title="My notes, highlights, bookmarks and reading plans" aria-label="My Study">
            <NotebookIcon size={15} /> <span className="label">My Study</span>
          </button>
          <button className="text-btn" onClick={() => setPanel({ kind: "basket" })} title="Study basket: material gathered for a study sheet" aria-label={`Study basket, ${basketItems.length} items`}>
            <BasketIcon size={15} /> <span className="label">Basket</span>
            {basketItems.length > 0 && <span className="count-badge">{basketItems.length}</span>}
          </button>
          <button className="text-btn" onClick={() => setPanel({ kind: "dictionary" })} title="Bible dictionaries and topical indexes" aria-label="Dictionary">
            <DictionaryIcon size={15} /> <span className="label">Dictionary</span>
          </button>
          <button className="text-btn" onClick={() => setPanel({ kind: "genealogy" })} title="Genealogies" aria-label="Genealogies">
            <TreeIcon size={15} /> <span className="label">Genealogies</span>
          </button>
          <button className="text-btn" onClick={() => setPanel({ kind: "firsts" })} title="Firsts & Milestones" aria-label="Firsts and Milestones">
            <StarIcon size={15} /> <span className="label">Firsts</span>
          </button>
          <button className="text-btn" onClick={() => setPanel({ kind: "entities" })} title="People, places and events in this chapter" aria-label="People and places">
            <UsersIcon size={15} /> <span className="label">People &amp; Places</span>
          </button>
          <button className="text-btn" onClick={() => setPanel({ kind: "map" })} title="Map of biblical places" aria-label="Map">
            <MapIcon size={15} /> <span className="label">Map</span>
          </button>
          <button
            className="text-btn"
            onClick={() => setPanel({ kind: "timeline" })}
            title="Timeline of lifespans and events"
            aria-label="Timeline"
          >
            <TimelineIcon size={15} /> <span className="label">Timeline</span>
          </button>
          <button className="text-btn" onClick={() => { document.body.classList.remove("printing-sheet"); window.print(); }} title="Print this view" aria-label="Print">
            <PrintIcon size={15} /> <span className="label">Print</span>
          </button>
          <button className="text-btn" onClick={() => setFocus(true)} disabled={homeActive} title="Focus mode: full screen, just the text (F11)" aria-label="Focus mode">
            <FocusIcon size={15} /> <span className="label">Focus</span>
          </button>
          <button className="pill-btn" onClick={() => setPanel({ kind: "settings" })} title="Settings" aria-label="Settings">
            <SettingsIcon size={15} /> <span className="label">Settings</span>
          </button>
            </>
          )}
        </header>
        <div className="app-body" style={panelWidth ? ({ "--panel-width": `${panelWidth}px` } as React.CSSProperties) : undefined}>
          {sidebarOpen && !focusMode && (
            <>
              <Sidebar
                books={books}
                selectedBook={book}
                selectedChapter={chapter}
                chapterCounts={chapterCounts}
                onSelect={goTo}
                width={sidebarWidth}
              />
              <ResizeHandle
                side="left"
                width={sidebarWidth}
                min={SIDEBAR.min}
                max={sidebarMax}
                onResize={setSidebarWidth}
                onReset={() => setSidebarWidth(SIDEBAR.default)}
                label="Resize book list"
              />
            </>
          )}
          <main className="main-pane">
            {homeActive ? (
              <HomeScreen
                books={books}
                chapterCounts={chapterCounts}
                onGo={startFromHome}
                onOpenCrossRefs={(b, c, v) => startFromHomeWithPanel(b, c, v, { kind: "xref", book: b, chapter: c, verse: v })}
                onOpenParallel={(b, c, v) => startFromHomeWithPanel(b, c, v, { kind: "parallel", book: b, chapter: c, verse: v })}
                studyVersion={studyVersion}
                onOpenPlans={() => setPanel({ kind: "study", tab: "plans" })}
                onOpenDictionary={(q) => setPanel({ kind: "dictionary", initialQuery: q })}
              />
            ) : (
              <ChapterView
                book={book}
                chapter={chapter}
                versionCode={versionCode}
                verses={verses}
                loading={loadingChapter}
                error={chapterError}
                targetVerse={targetVerse}
                prev={adjacent.prev}
                next={adjacent.next}
                onNavigate={flipChapter}
                onWordClick={(strongsNumbers, surfaceText) => setPanel({ kind: "word", strongsNumbers, surfaceText })}
                onShowCrossRefs={(verse) => setPanel({ kind: "xref", book, chapter, verse })}
                onShowParallel={(verse) => setPanel({ kind: "parallel", book, chapter, verse })}
                onShowCommentary={(verse) => setPanel({ kind: "commentary", verse })}
                onShowInterlinear={(verse) => setPanel({ kind: "interlinear", book, chapter, verse })}
                onShowTopics={(verse) => setPanel({ kind: "dictionary", verse: { book, chapter, verse } })}
                onPrepareSheet={(verseStart, verseEnd) => setPanel({ kind: "sheet", book, chapter, verseStart, verseEnd })}
                onListen={canListen ? listen : null}
                readingVerse={readingHere}
                marks={marks}
                onMarksChanged={() => setStudyVersion((n) => n + 1)}
              />
            )}
            {readState.status !== "idle" && (
              <ReadAloudBar
                state={readState}
                prefs={readPrefs}
                label={listening.current ? `${listening.current.book} ${listening.current.chapter}` : "the selection"}
                showContinue={readMode.current === "chapter"}
                onPrefs={(p) => {
                  setReadPrefs(p);
                  reader.setPrefs(p);
                }}
                onPause={() => reader.pause()}
                onResume={() => reader.resume()}
                onStop={() => {
                  reader.stop();
                  listening.current = null;
                }}
                onPrev={() => reader.prev()}
                onNext={() => reader.next()}
              />
            )}
            <SelectionMenu
              chapterLabel={homeActive ? null : `${book} ${chapter}`}
              onListen={listenSelection}
              onSearch={(q) => setPanel({ kind: "search", initialQuery: q })}
            />
          </main>
          {panel && !focusMode && (
            <ResizeHandle
              side="right"
              width={panelWidth || panelDefaultWidth(panel.kind)}
              min={PANEL.min}
              max={panelMax}
              onResize={setPanelWidth}
              onReset={() => setPanelWidth(0)}
              label="Resize side panel"
            />
          )}
          {panel?.kind === "word" && (
            <WordStudyPanel
              strongsNumbers={panel.strongsNumbers}
              surfaceText={panel.surfaceText}
              versionCode={versionCode}
              onClose={() => setPanel(null)}
              onJump={jumpTo}
            />
          )}
          {panel?.kind === "xref" && (
            <Suspense fallback={<PanelFallback />}>
              <CrossRefGraph
                book={panel.book}
                chapter={panel.chapter}
                verse={panel.verse}
                books={books}
                onClose={() => setPanel(null)}
                onJump={jumpTo}
              />
            </Suspense>
          )}
          {panel?.kind === "parallel" && (
            <ParallelPanel
              book={panel.book}
              chapter={panel.chapter}
              verse={panel.verse}
              versions={versions}
              onClose={() => setPanel(null)}
            />
          )}
          {panel?.kind === "search" && (
            <SearchPanel
              versions={versions}
              versionCode={versionCode}
              initialQuery={panel.initialQuery}
              onJump={jumpTo}
              onOpenCommentary={(commentaryId, b, c, v) => {
                jumpTo(b, c, v);
                setPanel({ kind: "commentary", verse: v, commentaryId });
              }}
              onOpenDictionary={(q) => setPanel({ kind: "dictionary", initialQuery: q })}
              onClose={() => setPanel(null)}
            />
          )}
          {panel?.kind === "commentary" && (
            <CommentaryPanel
              book={book}
              chapter={chapter}
              focusVerse={panel.verse}
              verseCount={verses.length}
              initialCommentaryId={panel.commentaryId}
              onJump={jumpTo}
              onClose={() => setPanel(null)}
            />
          )}
          {panel?.kind === "entities" && (
            <EntitiesPanel
              book={book}
              chapter={chapter}
              onJump={jumpTo}
              onClose={() => setPanel(null)}
              onFocusPlace={setFocusedPlaceId}
            />
          )}
          {panel?.kind === "settings" && (
            <SettingsPanel
              prefs={prefs}
              onPrefsChange={setPrefs}
              readPrefs={readPrefs}
              onReadPrefsChange={(p) => {
                setReadPrefs(p);
                reader.setPrefs(p);
              }} onOpenHelp={() => setPanel({ kind: "help" })} onClose={() => setPanel(null)} />
          )}
          {panel?.kind === "help" && <HelpPanel onBack={() => setPanel({ kind: "settings" })} onClose={() => setPanel(null)} />}
          {panel?.kind === "interlinear" && (
            <InterlinearPanel
              book={panel.book}
              chapter={panel.chapter}
              verse={panel.verse}
              verseCount={panel.book === book && panel.chapter === chapter ? verses.length : 0}
              onChangeVerse={(v) => {
                setPanel({ kind: "interlinear", book: panel.book, chapter: panel.chapter, verse: v });
                if (panel.book === book && panel.chapter === chapter) setTargetVerse(v);
              }}
              onWordStudy={(strongsNumbers, surfaceText) => setPanel({ kind: "word", strongsNumbers, surfaceText })}
              onClose={() => setPanel(null)}
            />
          )}
          {panel?.kind === "dictionary" && (
            <DictionaryPanel key={`${panel.initialQuery ?? ""}|${panel.verse ? `${panel.verse.book} ${panel.verse.chapter}:${panel.verse.verse}` : ""}`} verse={panel.verse} initialQuery={panel.initialQuery} onJump={jumpTo} onClose={() => setPanel(null)} />
          )}
          {panel?.kind === "study" && (
            <StudyPanel
              books={books}
              chapterCounts={chapterCounts}
              initialTab={panel.tab}
              refreshKey={studyVersion}
              onJump={jumpTo}
              onPlansChanged={() => setStudyVersion((n) => n + 1)}
              onClose={() => setPanel(null)}
            />
          )}
          {panel?.kind === "sheet" && (
            <StudySheetPanel
              key={`${panel.book} ${panel.chapter}:${panel.verseStart}-${panel.verseEnd}`}
              book={panel.book}
              chapter={panel.chapter}
              verseStart={panel.verseStart}
              verseEnd={panel.verseEnd}
              verseCount={panel.book === book && panel.chapter === chapter ? verses.length : 0}
              versions={versions}
              versionCode={versionCode}
              onClose={() => setPanel(null)}
            />
          )}
          {panel?.kind === "basket" && <BasketPanel onJump={jumpTo} onClose={() => setPanel(null)} />}
          {panel?.kind === "genealogy" && (
            <Suspense fallback={<PanelFallback />}>
              <GenealogyPanel
                onClose={() => setPanel(null)}
                onJump={jumpTo}
                onShowTimeline={(personId) => setPanel({ kind: "timeline", focusPersonId: personId })}
              />
            </Suspense>
          )}
          {panel?.kind === "firsts" && <FirstsPanel onClose={() => setPanel(null)} onJump={jumpTo} />}
          {panel?.kind === "map" && (
            <Suspense fallback={<PanelFallback />}>
              <MapPanel
                onClose={() => setPanel(null)}
                onJump={jumpTo}
                initialFocusId={focusedPlaceId}
                onFocusPlace={setFocusedPlaceId}
              />
            </Suspense>
          )}
          {panel?.kind === "timeline" && (
            <Suspense fallback={<PanelFallback />}>
              <TimelinePanel focusPersonId={panel.focusPersonId} onClose={() => setPanel(null)} onJump={jumpTo} />
            </Suspense>
          )}
        </div>
      </div>
    </>
  );
}

/** Mirrors the CSS defaults (.side-panel / .side-panel.wide) so the handle's first drag
 * starts from the width actually on screen. */
function panelDefaultWidth(kind: NonNullable<SidePanel>["kind"]): number {
  const wide = ["xref", "genealogy", "commentary", "map", "timeline", "interlinear", "dictionary", "study", "help", "sheet", "basket"].includes(kind);
  const vw = window.innerWidth;
  return wide ? Math.min(640, vw * 0.42) : Math.min(400, vw * 0.36);
}

export default App;
