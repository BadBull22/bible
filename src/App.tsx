import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { api, BookInfo, parseReference, Version, VerseWithWords } from "./api";
import { Sidebar } from "./components/Sidebar";
import { ChapterView } from "./components/ChapterView";
import { WordStudyPanel } from "./components/WordStudyPanel";
import { ParallelPanel } from "./components/ParallelPanel";
import { SearchPanel } from "./components/SearchPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { FirstsPanel } from "./components/FirstsPanel";
import { SplashScreen } from "./components/SplashScreen";
import { BackIcon, MenuIcon, PrintIcon, SearchIcon, SettingsIcon, StarIcon, TreeIcon } from "./components/icons";
import "./App.css";

// The two graph panels pull in cytoscape (+ the cola layout), by far the largest
// dependency; loading them on first use keeps the initial bundle small.
const CrossRefGraph = lazy(() => import("./components/CrossRefGraph").then((m) => ({ default: m.CrossRefGraph })));
const GenealogyPanel = lazy(() => import("./components/GenealogyPanel").then((m) => ({ default: m.GenealogyPanel })));

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
  | null;

interface Location {
  book: string;
  chapter: number;
}

const ENOCH_BOOK = "Enoch";
const ENOCH_VERSION = "ENOCH1";
const HISTORY_LIMIT = 50;

function App() {
  const [showSplash, setShowSplash] = useState(true);
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
  const [quickQuery, setQuickQuery] = useState("");
  const [history, setHistory] = useState<Location[]>([]);
  const [targetVerse, setTargetVerse] = useState<number | null>(null);
  const [preEnochVersion, setPreEnochVersion] = useState("BSB");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const quickSearchRef = useRef<HTMLInputElement>(null);
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
  }, [versionCode, book, chapter]);

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

  function changeVersion(code: string) {
    setTargetVerse(null);
    setVersionCode(code);
  }

  function runQuickSearch() {
    const q = quickQuery.trim();
    if (!q) return;
    // A typed reference ("John 3:16", "gen 1", "Jude 3") navigates directly instead
    // of being sent to search -- the most common thing people type into a Bible app.
    const ref = parseReference(q, books);
    if (ref) {
      const count = chapterCounts[ref.book] ?? 0;
      if (count === 1 && ref.verse === null && ref.chapter > 1) {
        // Single-chapter books: "Jude 3" almost certainly means Jude 1:3.
        jumpTo(ref.book, 1, ref.chapter);
        setQuickQuery("");
        return;
      }
      if (ref.chapter >= 1 && ref.chapter <= count) {
        if (ref.verse !== null) jumpTo(ref.book, ref.chapter, ref.verse);
        else {
          setTargetVerse(null);
          navigate(ref.book, ref.chapter, true);
        }
        setQuickQuery("");
        return;
      }
    }
    setPanel({ kind: "search", initialQuery: q });
  }

  // Keyboard shortcuts. Handlers are read through a ref so the listener is attached
  // once but always sees the latest state without re-subscribing on every render.
  const shortcuts = useRef({ adjacent, flipChapter, closePanel: () => setPanel(null) });
  shortcuts.current = { adjacent, flipChapter, closePanel: () => setPanel(null) };
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
        else shortcuts.current.closePanel();
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
      <div className="app-shell">
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
            onClick={goBack}
            disabled={history.length === 0}
            title="Back to where you were reading"
            aria-label="Back"
          >
            <BackIcon size={15} /> <span className="label">Back</span>
          </button>
          <div className="spacer" />
          <button className="text-btn" onClick={() => setPanel({ kind: "genealogy" })} title="Genealogies" aria-label="Genealogies">
            <TreeIcon size={15} /> <span className="label">Genealogies</span>
          </button>
          <button className="text-btn" onClick={() => setPanel({ kind: "firsts" })} title="Firsts & Milestones" aria-label="Firsts and Milestones">
            <StarIcon size={15} /> <span className="label">Firsts</span>
          </button>
          <button className="text-btn" onClick={() => window.print()} title="Print this view" aria-label="Print">
            <PrintIcon size={15} /> <span className="label">Print</span>
          </button>
          <button className="pill-btn" onClick={() => setPanel({ kind: "settings" })} title="Settings" aria-label="Settings">
            <SettingsIcon size={15} /> <span className="label">Settings</span>
          </button>
        </header>
        <div className="app-body">
          {sidebarOpen && (
            <Sidebar
              books={books}
              selectedBook={book}
              selectedChapter={chapter}
              chapterCounts={chapterCounts}
              onSelect={goTo}
            />
          )}
          <main className="main-pane">
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
            />
          </main>
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
              onClose={() => setPanel(null)}
            />
          )}
          {panel?.kind === "settings" && <SettingsPanel onClose={() => setPanel(null)} />}
          {panel?.kind === "genealogy" && (
            <Suspense fallback={<PanelFallback />}>
              <GenealogyPanel onClose={() => setPanel(null)} onJump={jumpTo} />
            </Suspense>
          )}
          {panel?.kind === "firsts" && <FirstsPanel onClose={() => setPanel(null)} onJump={jumpTo} />}
        </div>
      </div>
    </>
  );
}

export default App;
