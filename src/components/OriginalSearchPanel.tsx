import { useEffect, useRef, useState } from "react";
import { api, OriginalSearchResult, WordCandidate } from "../api";
import { CopyButton } from "./CopyButton";
import { CloseIcon } from "./icons";

interface Props {
  /** open straight on this word (e.g. from Word Study) */
  initialStrongs?: string;
  onJump: (book: string, chapter: number, verse: number) => void;
  onWordStudy: (strongsNumbers: string[], surfaceText: string) => void;
  onClose: () => void;
}

/** Plain names for the grammar categories in STEPBible's morphology. */
const FACET_LABEL: Record<string, string> = {
  Function: "Part of speech",
  Tense: "Tense",
  Voice: "Voice",
  Mood: "Mood",
  Stem: "Stem",
  Form: "Form",
  Person: "Person",
  Gender: "Gender",
  Number: "Number",
  Case: "Case",
  State: "State",
  Extra: "Other",
};

const PAGE = 200;

/** Every occurrence of a Hebrew or Greek word, narrowed by its grammar ("every aorist
 * passive of ἀγαπάω"), from the bundled interlinear data. */
export function OriginalSearchPanel({ initialStrongs, onJump, onWordStudy, onClose }: Props) {
  const [query, setQuery] = useState(initialStrongs ?? "");
  const [candidates, setCandidates] = useState<WordCandidate[] | null>(null);
  const [strongs, setStrongs] = useState<string | null>(initialStrongs ?? null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [limit, setLimit] = useState(PAGE);
  const [result, setResult] = useState<OriginalSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  function find(q: string) {
    setError(null);
    setStrongs(null);
    setResult(null);
    api
      .originalWordLookup(q, 30)
      .then((c) => {
        setCandidates(c);
        if (c.length === 1) choose(c[0].strongs);
      })
      .catch((e) => setError(String(e)));
  }

  function choose(s: string) {
    setCandidates(null);
    setFilters({});
    setLimit(PAGE);
    setStrongs(s);
  }

  useEffect(() => {
    if (!strongs) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    api
      .originalWordSearch(strongs, filters, limit)
      .then((r) => id === requestId.current && setResult(r))
      .catch((e) => id === requestId.current && setError(String(e)))
      .finally(() => id === requestId.current && setLoading(false));
  }, [strongs, filters, limit]);

  const word = result?.word;
  const hebrew = word?.language === "Hebrew";
  const setFilter = (key: string, value: string) => {
    setLimit(PAGE);
    setFilters((f) => {
      const n = { ...f };
      if (value) n[key] = value;
      else delete n[key];
      return n;
    });
  };
  const filterLabel = Object.entries(filters)
    .map(([, v]) => v)
    .join(" ");

  return (
    <aside className="side-panel wide original-panel">
      <div className="side-panel-header">
        <h3>Hebrew &amp; Greek search</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <form
        className="search-controls"
        onSubmit={(e) => {
          e.preventDefault();
          if (query.trim()) find(query);
        }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="An English meaning (love), the word (ἀγαπάω, ברא) or a Strong's number (G25)"
          aria-label="Word to search for"
          autoFocus={!initialStrongs}
        />
        <button className="pill-btn" type="submit">
          Find
        </button>
      </form>
      {error && <p className="status-error">{error}</p>}

      {candidates && (
        <>
          {candidates.length === 0 ? (
            <p className="muted">No Hebrew or Greek word matches “{query}”.</p>
          ) : (
            <p className="search-hint">Choose the word you mean:</p>
          )}
          <ul className="original-candidates">
            {candidates.map((c) => (
              <li key={c.strongs}>
                <button className="original-candidate" onClick={() => choose(c.strongs)}>
                  <span className="original-lemma" lang={c.language === "Hebrew" ? "he" : "grc"} dir={c.language === "Hebrew" ? "rtl" : "ltr"}>
                    {c.lemma || c.strongs}
                  </span>
                  <span className="original-meta">
                    <strong>{c.strongs}</strong> · {c.gloss} · {c.language} · {c.count.toLocaleString()}×
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {strongs && word && (
        <div className="original-word">
          <div className="original-word-head">
            <span className="original-lemma big" lang={hebrew ? "he" : "grc"} dir={hebrew ? "rtl" : "ltr"}>
              {word.lemma}
            </span>
            <span>
              <strong>{word.strongs}</strong> · {word.gloss} · {word.language}
            </span>
            <button className="text-btn" onClick={() => onWordStudy([word.strongs], word.lemma)}>
              Word Study
            </button>
          </div>

          {result && result.facets.length > 0 && (
            <div className="original-facets">
              {result.facets.map((f) => (
                <label key={f.key}>
                  <span className="muted">{FACET_LABEL[f.key] ?? f.key}</span>
                  <select value={filters[f.key] ?? ""} onChange={(e) => setFilter(f.key, e.target.value)}>
                    <option value="">Any</option>
                    {f.values.map(([v, n]) => (
                      <option key={v} value={v}>
                        {v} ({n})
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {Object.keys(filters).length > 0 && (
                <button className="text-btn" onClick={() => setFilters({})}>
                  Clear filters
                </button>
              )}
            </div>
          )}

          {result && (
            <div className="original-summary">
              <p>
                <strong>{result.matched.toLocaleString()}</strong>
                {Object.keys(filters).length ? ` ${filterLabel}` : ""} occurrence{result.matched === 1 ? "" : "s"}
                {Object.keys(filters).length ? ` of ${result.total.toLocaleString()}` : ""}
                {loading && <span className="muted"> · updating…</span>}
              </p>
              {result.hits.length > 0 && (
                <CopyButton
                  title="Copy the list of references"
                  text={() =>
                    `${word.lemma} (${word.strongs}, ${word.gloss})${filterLabel ? ` — ${filterLabel}` : ""}: ${result.matched} occurrences\n\n` +
                    result.hits.map((h) => `${h.book} ${h.chapter}:${h.verse} — ${h.original} (${h.parsing})`).join("\n")
                  }
                />
              )}
            </div>
          )}
          {result && result.by_book.length > 1 && (
            <div className="original-books">
              {result.by_book.map(([b, n]) => (
                <span key={b} className="original-book">
                  {b} {n}
                </span>
              ))}
            </div>
          )}
          {result && (
            <ul className="xref-list original-hits">
              {result.hits.map((h, i) => (
                <li key={`${h.book}-${h.chapter}-${h.verse}-${i}`}>
                  <div className="xref-item-head">
                    <button className="link-btn" onClick={() => onJump(h.book, h.chapter, h.verse)}>
                      {h.book} {h.chapter}:{h.verse}
                    </button>
                    <span className="original-form" lang={hebrew ? "he" : "grc"}>
                      {h.original}
                    </span>
                    <span className="votes">{h.parsing}</span>
                  </div>
                  <span className="snippet">
                    <em>{h.gloss}</em> — {h.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {result && result.hits.length < result.matched && (
            <button className="outline-btn" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({(result.matched - result.hits.length).toLocaleString()} left)
            </button>
          )}
        </div>
      )}
      <p className="search-hint">
        Word-by-word data and grammar: STEPBible TAHOT &amp; TAGNT (Tyndale House, Cambridge), CC BY 4.0. Greek counts
        include words found in any of the Greek editions.
      </p>
    </aside>
  );
}
