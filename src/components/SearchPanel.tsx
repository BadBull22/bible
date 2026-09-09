import { useEffect, useRef, useState } from "react";
import { api, CommentaryHit, SearchHit, Version } from "../api";
import { CloseIcon } from "./icons";

interface Props {
  versions: Version[];
  versionCode: string;
  initialQuery?: string;
  onJump: (book: string, chapter: number, verse: number) => void;
  onOpenCommentary: (commentaryId: string, book: string, chapter: number, verse: number) => void;
  onClose: () => void;
}

type Mode = "phrase" | "frequency" | "topic" | "commentary";

const MODES: { key: Mode; label: string; placeholder: string }[] = [
  { key: "topic", label: "Topics & themes", placeholder: "e.g. the sacrifice of bulls, forgiveness, the first crime" },
  { key: "phrase", label: "Exact phrase", placeholder: "e.g. sacrifice of bulls" },
  { key: "frequency", label: "Word count", placeholder: "e.g. gold" },
  { key: "commentary", label: "Commentaries", placeholder: "e.g. regeneration, the Sabbath" },
];

const PHRASE_LIMIT = 100;
const TOPIC_LIMIT = 30;
const COMMENTARY_LIMIT = 60;

export function SearchPanel({ versions, versionCode, initialQuery, onJump, onOpenCommentary, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("topic");
  const [query, setQuery] = useState(initialQuery ?? "");
  const [searchVersion, setSearchVersion] = useState(versionCode === "ENOCH1" ? "BSB" : versionCode);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [commentaryHits, setCommentaryHits] = useState<CommentaryHit[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ran, setRan] = useState<{ query: string; mode: Mode; version: string } | null>(null);
  const requestId = useRef(0);

  async function runSearch(q?: string) {
    const effective = (q ?? query).trim();
    if (!effective) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      let results: SearchHit[] = [];
      let total: number | null = null;
      if (mode === "commentary") {
        const c = await api.searchCommentaries(effective, null, COMMENTARY_LIMIT);
        if (id !== requestId.current) return;
        setCommentaryHits(c);
        setHits([]);
        setTotalCount(null);
        setRan({ query: effective, mode, version: searchVersion });
        return;
      } else if (mode === "phrase") {
        results = await api.searchKeyword(searchVersion, effective, PHRASE_LIMIT);
      } else if (mode === "frequency") {
        const r = await api.wordFrequency(searchVersion, effective);
        results = r.verses;
        total = r.total_occurrences;
      } else {
        results = await api.semanticSearch(effective, TOPIC_LIMIT);
      }
      if (id !== requestId.current) return; // a newer search superseded this one
      setCommentaryHits([]);
      setHits(results);
      setTotalCount(total);
      setRan({ query: effective, mode, version: searchVersion });
    } catch (e) {
      if (id !== requestId.current) return;
      setError(String(e));
      setHits([]);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (initialQuery) {
      setQuery(initialQuery);
      runSearch(initialQuery);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  const placeholder = MODES.find((m) => m.key === mode)?.placeholder;
  const showVersion = mode === "phrase" || mode === "frequency";

  return (
    <aside className="side-panel search-panel">
      <div className="side-panel-header">
        <h3>Search</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="search-controls">
        <div className="mode-toggle" role="tablist" aria-label="Search mode">
          {MODES.map((m) => (
            <button key={m.key} role="tab" aria-selected={mode === m.key} className={mode === m.key ? "active" : ""} onClick={() => setMode(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
        {showVersion && (
          <select value={searchVersion} onChange={(e) => setSearchVersion(e.target.value)} aria-label="Translation to search">
            {versions.map((v) => (
              <option key={v.code} value={v.code}>
                {v.code} — {v.name}
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
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} aria-label="Search query" />
          <button type="submit" disabled={loading || !query.trim()}>
            {loading ? "Searching…" : "Search"}
          </button>
        </form>
      </div>
      {error && <p className="status-error">Search failed: {error}</p>}
      {!loading && ran && ran.mode === "frequency" && totalCount !== null && (
        <p className="frequency-summary">
          "{ran.query}" appears <strong>{totalCount}</strong> time{totalCount === 1 ? "" : "s"} in {ran.version}, across{" "}
          {hits.length} verse{hits.length === 1 ? "" : "s"}.
        </p>
      )}
      {!loading && ran && ran.mode === "commentary" && commentaryHits.length > 0 && (
        <p className="result-count">
          {commentaryHits.length}
          {commentaryHits.length >= COMMENTARY_LIMIT ? "+" : ""} commentary {commentaryHits.length === 1 ? "note" : "notes"}
        </p>
      )}
      {!loading && commentaryHits.length > 0 && (
        <ul className="xref-list">
          {commentaryHits.map((h, i) => (
            <li key={`${h.commentary_id}-${h.book}-${h.chapter}-${h.verse_start}-${i}`}>
              <div className="xref-item-head">
                <button className="link-btn" onClick={() => onOpenCommentary(h.commentary_id, h.book, h.chapter, h.verse_start)}>
                  {h.book} {h.chapter}:{h.verse_start}
                </button>
                <span className="votes">{h.commentary_name.replace(/ Bible Commentary$/, "")}</span>
              </div>
              <div className="snippet">{h.snippet}</div>
            </li>
          ))}
        </ul>
      )}
      {!loading && ran && ran.mode !== "frequency" && ran.mode !== "commentary" && hits.length > 0 && (
        <p className="result-count">
          {hits.length}
          {ran.mode === "phrase" && hits.length >= PHRASE_LIMIT ? "+" : ""} {hits.length === 1 ? "result" : "results"}
          {ran.mode === "topic" ? " by meaning (BSB)" : ` in ${ran.version}`}
        </p>
      )}
      {!loading && ran && !error && hits.length === 0 && commentaryHits.length === 0 && <p className="muted">No matches for "{ran.query}".</p>}
      {!loading && hits.length > 0 && (
        <ul className="xref-list">
          {hits.map((h) => (
            <li key={`${h.book}-${h.chapter}-${h.verse}`}>
              <button className="link-btn" onClick={() => onJump(h.book, h.chapter, h.verse)}>
                {h.book} {h.chapter}:{h.verse}
              </button>
              <div className="snippet">{h.text}</div>
            </li>
          ))}
        </ul>
      )}
      {mode === "commentary" && (
        <p className="search-hint">
          Searches the full text of all seven bundled commentaries (Matthew Henry, Jamieson-Fausset-Brown, Adam Clarke,
          John Gill, Calvin, Keil &amp; Delitzsch, Tyndale Open Study Notes). Click a hit to read that passage with the
          commentary open beside it.
        </p>
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
