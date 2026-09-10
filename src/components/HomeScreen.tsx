import { useEffect, useRef, useState } from "react";
import { api, BookInfo, resolveReference, SearchHit } from "../api";
import { SearchIcon } from "./icons";

interface Props {
  books: BookInfo[];
  chapterCounts: Record<string, number>;
  onGo: (book: string, chapter: number, verse: number | null) => void;
}

const EXAMPLES = ["John 3:16", "the creation of light", "the prodigal son", "Psalm 23", "the parting of the Red Sea"];
const RESULT_LIMIT = 12;

export function HomeScreen({ books, chapterCounts, onGo }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

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

  function submit() {
    if (reference) onGo(reference.book, reference.chapter, reference.verse);
    else if (results.length > 0) onGo(results[0].book, results[0].chapter, results[0].verse);
  }

  return (
    <div className="home-screen">
      <div className="home-box">
        <h1>What wonder of God do you want to find today?</h1>
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
          <button className="pill-btn home-result-reference" onClick={() => onGo(reference.book, reference.chapter, reference.verse)}>
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
                <button className="link-btn" onClick={() => onGo(h.book, h.chapter, h.verse)}>
                  {h.book} {h.chapter}:{h.verse}
                </button>
                <div className="snippet">{h.text}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
