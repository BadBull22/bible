import { useEffect, useState } from "react";
import { api, SearchHit, Version } from "../api";

interface Props {
  versions: Version[];
  versionCode: string;
  initialQuery?: string;
  onJump: (book: string, chapter: number, verse: number) => void;
  onClose: () => void;
}

type Mode = "phrase" | "frequency" | "topic";

export function SearchPanel({ versions, versionCode, initialQuery, onJump, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("topic");
  const [query, setQuery] = useState(initialQuery ?? "");
  const [searchVersion, setSearchVersion] = useState(versionCode);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [ran, setRan] = useState(false);

  async function runSearch(q?: string) {
    const effective = (q ?? query).trim();
    if (!effective) return;
    setLoading(true);
    setRan(true);
    try {
      if (mode === "phrase") {
        const results = await api.searchKeyword(searchVersion, effective, 100);
        setHits(results);
        setTotalCount(null);
      } else if (mode === "frequency") {
        const result = await api.wordFrequency(searchVersion, effective);
        setHits(result.verses);
        setTotalCount(result.total_occurrences);
      } else {
        const results = await api.semanticSearch(effective, 30);
        setHits(results);
        setTotalCount(null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialQuery) runSearch(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const placeholders: Record<Mode, string> = {
    phrase: "e.g. sacrifice of bulls",
    frequency: "e.g. gold",
    topic: "e.g. the sacrifice of bulls, forgiveness, the first crime",
  };

  return (
    <aside className="side-panel search-panel">
      <div className="side-panel-header">
        <h3>Search</h3>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="search-controls">
        <div className="mode-toggle">
          <button className={mode === "topic" ? "active" : ""} onClick={() => setMode("topic")}>
            Topics &amp; themes
          </button>
          <button className={mode === "phrase" ? "active" : ""} onClick={() => setMode("phrase")}>
            Exact phrase
          </button>
          <button className={mode === "frequency" ? "active" : ""} onClick={() => setMode("frequency")}>
            Word count
          </button>
        </div>
        {mode !== "topic" && (
          <select value={searchVersion} onChange={(e) => setSearchVersion(e.target.value)}>
            {versions.map((v) => (
              <option key={v.code} value={v.code}>
                {v.code}
              </option>
            ))}
          </select>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
        >
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholders[mode]} />
          <button type="submit">Search</button>
        </form>
      </div>
      {loading && <p>Searching…</p>}
      {!loading && ran && mode === "frequency" && totalCount !== null && (
        <p className="frequency-summary">
          "{query}" appears <strong>{totalCount}</strong> time{totalCount === 1 ? "" : "s"} in {searchVersion}, across {hits.length} verse
          {hits.length === 1 ? "" : "s"}.
        </p>
      )}
      {!loading && ran && hits.length === 0 && <p>No matches found.</p>}
      {!loading && hits.length > 0 && (
        <ul className="xref-list">
          {hits.map((h, i) => (
            <li key={i}>
              <button className="link-btn" onClick={() => onJump(h.book, h.chapter, h.verse)}>
                {h.book} {h.chapter}:{h.verse}
              </button>
              <div className="snippet">{h.text}</div>
            </li>
          ))}
        </ul>
      )}
      {mode === "topic" && (
        <p className="search-hint">
          Topics &amp; themes finds verses by meaning, not just matching words (BSB text only) — a paraphrase like
          "sacrifice of bulls" can surface "burnt offering of bulls" even without shared wording. Use Exact phrase or
          Word count when you need literal matches in a specific translation.
        </p>
      )}
    </aside>
  );
}
