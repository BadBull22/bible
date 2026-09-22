import { useEffect, useRef, useState } from "react";
import { api, BookInfo, HomeStats, resolveReference, SearchHit } from "../api";
import { addSearchHistory, getSearchHistory } from "../searchHistory";
import { SearchIcon } from "./icons";

interface Props {
  books: BookInfo[];
  chapterCounts: Record<string, number>;
  onGo: (book: string, chapter: number, verse: number | null) => void;
  /** Jumps to a verse and opens its cross-reference graph -- used by the "Cross-references" tile. */
  onOpenCrossRefs: (book: string, chapter: number, verse: number) => void;
  /** Jumps to a verse and opens the parallel-translations compare view -- used by "Translations". */
  onOpenParallel: (book: string, chapter: number, verse: number) => void;
}

const EXAMPLES = ["John 3:16", "the creation of light", "the prodigal son", "Psalm 23", "the parting of the Red Sea"];
const RESULT_LIMIT = 12;

// Genesis 1:1 carries 68 outgoing cross-references in the bundled TSK-derived dataset --
// the most cross-referenced opening verse of any book, and thematically apt ("in the
// beginning") for the tile that explains what a cross-reference even is.
const CROSS_REF_DEMO = { book: "Genesis", chapter: 1, verse: 1 };
// The natural choice for "compare translations": the most widely known verse in English,
// and one every bundled translation actually contains (unlike some Enoch/Apocrypha-only
// edge cases), so all 7 rows in the compare view are guaranteed to show real text.
const PARALLEL_DEMO = { book: "John", chapter: 3, verse: 16 };

/** One tile in the "Inside this Bible" strip. `action`, when present, makes the tile a
 * button that jumps into the reader and demonstrates the stat live; a tile with no
 * natural destination (no feature to expand into) is left as a plain, non-interactive
 * figure instead of a fake button that goes nowhere. */
interface StatTile {
  key: string;
  value: string;
  label: string;
  sub: string;
  action?: () => void;
}

function buildStatTiles(stats: HomeStats, onGo: Props["onGo"], onOpenCrossRefs: Props["onOpenCrossRefs"], onOpenParallel: Props["onOpenParallel"]): StatTile[] {
  const n = (x: number) => x.toLocaleString();
  return [
    {
      key: "books",
      value: n(stats.books),
      label: "Books",
      sub: `${stats.ot_books} Old Testament, ${stats.nt_books} New`,
      action: () => onGo("Genesis", 1, null), // "Books" -> start reading from the first one
    },
    {
      key: "chapters",
      value: n(stats.chapters),
      label: "Chapters",
      sub: `${stats.ot_chapters} Old Testament, ${stats.nt_chapters} New`,
      // No independent destination -- would just repeat the Books tile's jump.
    },
    {
      key: "verses",
      value: n(stats.verses),
      label: "Verses",
      sub: "counted in the King James Version",
      // No single "browse all verses" feature exists to expand into.
    },
    {
      key: "authors",
      value: "~40",
      label: "Authors",
      sub: "traditional estimate, across ~1,500 years",
      // Not in the bundled data at all (no authorship field) -- see NOTICE.md.
    },
    {
      key: "xrefs",
      value: n(stats.cross_references),
      label: "Cross-references",
      sub: "verses linked to each other across Scripture",
      action: () => onOpenCrossRefs(CROSS_REF_DEMO.book, CROSS_REF_DEMO.chapter, CROSS_REF_DEMO.verse),
    },
    {
      key: "translations",
      value: n(stats.translations),
      label: "Translations",
      sub: "bundled offline, plus the original Hebrew & Greek",
      action: () => onOpenParallel(PARALLEL_DEMO.book, PARALLEL_DEMO.chapter, PARALLEL_DEMO.verse),
    },
  ];
}

export function HomeScreen({ books, chapterCounts, onGo, onOpenCrossRefs, onOpenParallel }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<HomeStats | null>(null);
  // Lazy init: reads localStorage once, synchronously, on first render -- so "Recent"
  // is already there on the very first paint rather than popping in after an effect.
  const [history, setHistory] = useState<string[]>(() => getSearchHistory());
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    api.homeStats().then(setStats).catch(console.error);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const reference = query.trim() ? resolveReference(query, books, chapterCounts) : null;

  useEffect(() => {
    const q = query.trim();
    // A recognized reference is unambiguous -- no need to also run a topic search under it.
    if (!q || reference) {
      setResults([]);
      setError(null);
      return;
    }
    const id = ++requestId.current;
    const handle = setTimeout(() => {
      setLoading(true);
      api
        .semanticSearch(q, RESULT_LIMIT)
        .then((r) => {
          if (id !== requestId.current) return;
          setResults(r);
          setError(null);
        })
        .catch((e) => {
          if (id !== requestId.current) return;
          setError(String(e));
          setResults([]);
        })
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Records the term that was actually typed at the moment a search leads somewhere real
  // (a resolved reference, or a clicked result) -- not every debounced keystroke, which
  // would fill history with half-typed fragments instead of things worth returning to.
  function goAndRemember(book: string, chapter: number, verse: number | null) {
    setHistory(addSearchHistory(query));
    onGo(book, chapter, verse);
  }

  function submit() {
    if (reference) goAndRemember(reference.book, reference.chapter, reference.verse);
    else if (results.length > 0) goAndRemember(results[0].book, results[0].chapter, results[0].verse);
  }

  return (
    <div className="home-screen">
      <div className="home-box">
        <h1 className="gospel-wordmark" aria-label="Gospel">
          {["G", "o", "s", "p", "e", "l"].map((letter, i) => (
            <span key={i} aria-hidden="true">
              {letter}
            </span>
          ))}
        </h1>
        <form
          className="home-search-box"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <SearchIcon size={18} className="icon" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a reference, a story, or a theme…"
            aria-label="Find a passage to begin reading"
          />
        </form>
        {!query.trim() && history.length > 0 && (
          <div className="home-examples">
            <span className="muted">Recent:</span>
            {history.map((term) => (
              <button key={term} className="outline-btn" onClick={() => setQuery(term)}>
                {term}
              </button>
            ))}
          </div>
        )}
        {!query.trim() && (
          <div className="home-examples">
            <span className="muted">Try:</span>
            {EXAMPLES.map((ex) => (
              <button key={ex} className="outline-btn" onClick={() => setQuery(ex)}>
                {ex}
              </button>
            ))}
          </div>
        )}
        {reference && (
          <button className="pill-btn home-result-reference" onClick={() => goAndRemember(reference.book, reference.chapter, reference.verse)}>
            Go to {reference.book} {reference.chapter}
            {reference.verse ? `:${reference.verse}` : ""}
          </button>
        )}
        {loading && <p className="muted">Searching…</p>}
        {error && <p className="status-error">{error}</p>}
        {!loading && !error && query.trim() && !reference && results.length === 0 && <p className="muted">No matches for "{query.trim()}".</p>}
        {!reference && results.length > 0 && (
          <ul className="xref-list">
            {results.map((h) => (
              <li key={`${h.book}-${h.chapter}-${h.verse}`}>
                <button className="link-btn" onClick={() => goAndRemember(h.book, h.chapter, h.verse)}>
                  {h.book} {h.chapter}:{h.verse}
                </button>
                <div className="snippet">{h.text}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {/* Hidden while actively searching, same reasoning as the example chips above:
          keep the screen focused on results rather than competing for attention. */}
      {!query.trim() && stats && (
        <div className="home-stats">
          <p className="home-stats-heading">Inside this Bible</p>
          <div className="home-stats-grid">
            {buildStatTiles(stats, onGo, onOpenCrossRefs, onOpenParallel).map((tile) => {
              const content = (
                <>
                  <div className="home-stat-number">{tile.value}</div>
                  <div className="home-stat-label">{tile.label}</div>
                  <div className="home-stat-sub">{tile.sub}</div>
                </>
              );
              return tile.action ? (
                <button key={tile.key} className="home-stat-tile is-active" onClick={tile.action}>
                  {content}
                </button>
              ) : (
                <div key={tile.key} className="home-stat-tile">
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
