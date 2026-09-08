import { useEffect, useState } from "react";
import { api, BookInfo, Version, VerseWithWords } from "./api";
import { Sidebar } from "./components/Sidebar";
import { ChapterView } from "./components/ChapterView";
import { WordStudyPanel } from "./components/WordStudyPanel";
import { CrossRefGraph } from "./components/CrossRefGraph";
import { ParallelPanel } from "./components/ParallelPanel";
import { SearchPanel } from "./components/SearchPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { GenealogyPanel } from "./components/GenealogyPanel";
import { FirstsPanel } from "./components/FirstsPanel";
import { SplashScreen } from "./components/SplashScreen";
import "./App.css";

type SidePanel =
  | { kind: "word"; strongsNumber: string; surfaceText: string }
  | { kind: "xref"; book: string; chapter: number; verse: number }
  | { kind: "parallel"; book: string; chapter: number; verse: number }
  | { kind: "search"; initialQuery?: string }
  | { kind: "settings" }
  | { kind: "genealogy" }
  | { kind: "firsts" }
  | null;

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
  const [panel, setPanel] = useState<SidePanel>(null);
  const [quickQuery, setQuickQuery] = useState("");
  const [history, setHistory] = useState<{ book: string; chapter: number }[]>([]);
  const [targetVerse, setTargetVerse] = useState<number | null>(null);
  const [preEnochVersion, setPreEnochVersion] = useState("BSB");

  useEffect(() => {
    api.listVersions().then(setVersions);
    api.listBooks().then(setBooks);
    api.chapterCounts().then((rows) => {
      const map: Record<string, number> = {};
      for (const [name, count] of rows) map[name] = count;
      setChapterCounts(map);
    });
  }, []);

  useEffect(() => {
    setLoadingChapter(true);
    api
      .getChapterWithStrongs(versionCode, book, chapter)
      .then(setVerses)
      .finally(() => setLoadingChapter(false));
  }, [versionCode, book, chapter]);

  function navigate(b: string, c: number, keepPanel: boolean) {
    if (b !== book || c !== chapter) {
      setHistory((h) => [...h, { book, chapter }]);
    }
    // Enoch has exactly one translation, so entering/leaving it auto-switches the
    // version rather than leaving the reader on a mismatched version showing no text
    // (the same confusion TR/WLC can cause on the wrong testament).
    if (b === "Enoch" && versionCode !== "ENOCH1") {
      setPreEnochVersion(versionCode);
      setVersionCode("ENOCH1");
    } else if (b !== "Enoch" && versionCode === "ENOCH1") {
      setVersionCode(preEnochVersion);
    }
    setBook(b);
    setChapter(c);
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

  function goBack() {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setBook(prev.book);
    setChapter(prev.chapter);
    setPanel(null);
  }

  function runQuickSearch() {
    if (!quickQuery.trim()) return;
    setPanel({ kind: "search", initialQuery: quickQuery.trim() });
  }

  return (
    <>
      {showSplash && <SplashScreen onDone={() => setShowSplash(false)} />}
      <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <span className="mark">✦</span>
          <h1>Bible Concordance</h1>
        </div>
        {book === "Enoch" ? (
          <span className="version-label" title="Enoch has only one translation bundled here">
            Charles &amp; Oesterley (1917)
          </span>
        ) : (
          <select value={versionCode} onChange={(e) => setVersionCode(e.target.value)}>
            {versions
              .filter((v) => v.code !== "ENOCH1")
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
          <span className="icon">⌕</span>
          <input
            value={quickQuery}
            onChange={(e) => setQuickQuery(e.target.value)}
            placeholder="Search words, phrases, themes…"
          />
        </form>
        <button className="text-btn" onClick={goBack} disabled={history.length === 0} title="Back to where you were reading">
          ← Back
        </button>
        <div className="spacer" />
        <button className="text-btn" onClick={() => setPanel({ kind: "genealogy" })}>
          Genealogies
        </button>
        <button className="text-btn" onClick={() => setPanel({ kind: "firsts" })}>
          Firsts
        </button>
        <button className="text-btn" onClick={() => window.print()} title="Print this view">
          🖶 Print
        </button>
        <button className="pill-btn" onClick={() => setPanel({ kind: "settings" })} title="Settings">
          ⚙ Settings
        </button>
      </header>
      <div className="app-body">
        <Sidebar
          books={books}
          selectedBook={book}
          selectedChapter={chapter}
          chapterCounts={chapterCounts}
          onSelect={goTo}
        />
        <main className="main-pane">
          <ChapterView
            book={book}
            chapter={chapter}
            versionCode={versionCode}
            verses={verses}
            loading={loadingChapter}
            targetVerse={targetVerse}
            onWordClick={(strongsNumber, surfaceText) => setPanel({ kind: "word", strongsNumber, surfaceText })}
            onShowCrossRefs={(verse) => setPanel({ kind: "xref", book, chapter, verse })}
            onShowParallel={(verse) => setPanel({ kind: "parallel", book, chapter, verse })}
          />
        </main>
        {panel?.kind === "word" && (
          <WordStudyPanel
            strongsNumber={panel.strongsNumber}
            surfaceText={panel.surfaceText}
            versionCode={versionCode}
            onClose={() => setPanel(null)}
            onJump={jumpTo}
          />
        )}
        {panel?.kind === "xref" && (
          <CrossRefGraph
            book={panel.book}
            chapter={panel.chapter}
            verse={panel.verse}
            books={books}
            onClose={() => setPanel(null)}
            onJump={jumpTo}
          />
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
        {panel?.kind === "settings" && <SettingsPanel onClose={() => setPanel(null)} onSaved={() => {}} />}
        {panel?.kind === "genealogy" && <GenealogyPanel onClose={() => setPanel(null)} onJump={jumpTo} />}
        {panel?.kind === "firsts" && <FirstsPanel onClose={() => setPanel(null)} onJump={jumpTo} />}
      </div>
      </div>
    </>
  );
}

export default App;
