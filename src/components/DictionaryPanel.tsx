import { useEffect, useMemo, useRef, useState } from "react";
import { api, DictionaryEntry, DictionaryHit, DictionaryInfo } from "../api";
import { addToBasket } from "../basket";
import { copyText } from "../clipboard";
import { BasketButton } from "./BasketButton";
import { ListenButton } from "./ListenButton";
import { CloseIcon, CopyIcon } from "./icons";
import { plainText, RichText } from "./RichText";

interface VerseRef {
  book: string;
  chapter: number;
  verse: number;
}

interface Props {
  /** Open straight to the entries that cite this verse ("Topics for John 3:16"). */
  verse?: VerseRef;
  initialQuery?: string;
  onJump: (book: string, chapter: number, verse: number) => void;
  onClose: () => void;
}

const DEBOUNCE_MS = 250;

export function DictionaryPanel({ verse, initialQuery, onJump, onClose }: Props) {
  const [dicts, setDicts] = useState<DictionaryInfo[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [hits, setHits] = useState<DictionaryHit[]>([]);
  const [entry, setEntry] = useState<DictionaryEntry | null>(null);
  const [verseMode, setVerseMode] = useState<VerseRef | null>(verse ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    api.listDictionaries().then(setDicts).catch((e) => setError(String(e)));
  }, []);

  // A newly requested verse (the panel is reused when the reader picks "Topics" on
  // another verse) switches back into verse mode.
  useEffect(() => {
    if (verse) {
      setVerseMode(verse);
      setEntry(null);
    }
  }, [verse?.book, verse?.chapter, verse?.verse]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const id = ++requestId.current;
    const q = query.trim();
    if (verseMode && !q) {
      setLoading(true);
      api
        .topicsForVerse(verseMode.book, verseMode.chapter, verseMode.verse)
        .then((r) => id === requestId.current && setHits(r))
        .catch((e) => id === requestId.current && setError(String(e)))
        .finally(() => id === requestId.current && setLoading(false));
      return;
    }
    if (!q) {
      setHits([]);
      return;
    }
    const handle = setTimeout(() => {
      setLoading(true);
      api
        .searchDictionaries(q, filter, 60)
        .then((r) => id === requestId.current && setHits(r))
        .catch((e) => id === requestId.current && setError(String(e)))
        .finally(() => id === requestId.current && setLoading(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, filter, verseMode]);

  const shownHits = useMemo(() => (filter && verseMode && !query.trim() ? hits.filter((h) => h.dict_code === filter) : hits), [hits, filter, verseMode, query]);
  const grouped = useMemo(() => {
    const g = new Map<string, DictionaryHit[]>();
    for (const h of shownHits) {
      const list = g.get(h.dict_name) ?? [];
      list.push(h);
      g.set(h.dict_name, list);
    }
    return [...g.entries()];
  }, [shownHits]);

  function open(id: number) {
    api
      .dictionaryEntry(id)
      .then((e) => setEntry(e))
      .catch((e) => setError(String(e)));
  }

  async function copyEntry() {
    if (!entry) return;
    const ok = await copyText(`${entry.headword} — ${entry.dict_name}\n\n${plainText(entry.body)}`);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <aside className="side-panel wide dictionary-panel">
      <div className="side-panel-header">
        <h3>{verseMode && !query.trim() && !entry ? `Topics & dictionary: ${verseMode.book} ${verseMode.chapter}:${verseMode.verse}` : "Bible Dictionary & Topics"}</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      {entry ? (
        <div className="dict-entry">
          <div className="dict-entry-bar">
            <button className="text-btn" onClick={() => setEntry(null)}>
              ← Back to results
            </button>
            <span className="item-tools">
              <ListenButton title="Read this entry aloud" text={() => `${entry.headword}.\n${plainText(entry.body)}`} />
              <BasketButton add={() => addToBasket("dictionary", `${entry.headword} — ${entry.dict_name}`, plainText(entry.body))} />
              <button className="text-btn" onClick={copyEntry} title="Copy this entry">
                <CopyIcon size={14} /> {copied ? "Copied" : "Copy"}
              </button>
            </span>
          </div>
          <h4 className="dict-headword">{entry.headword}</h4>
          <p className="dict-source">
            {entry.dict_name} — {entry.kind === "topical" ? "a topical index of verses" : "a 19th-century reference work, not scripture"}
          </p>
          <RichText text={entry.body} onJump={onJump} />
        </div>
      ) : (
        <>
          <div className="search-controls">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Look up a person, place or subject (e.g. Aaron, grace, prayer)"
              aria-label="Search the Bible dictionaries"
            />
          </div>
          <div className="mode-toggle dict-filters" role="tablist" aria-label="Which reference work">
            <button role="tab" aria-selected={filter === null} className={filter === null ? "active" : ""} onClick={() => setFilter(null)}>
              All
            </button>
            {dicts.map((d) => (
              <button key={d.code} role="tab" aria-selected={filter === d.code} className={filter === d.code ? "active" : ""} onClick={() => setFilter(d.code)} title={d.name}>
                {d.name.split(" ")[0].replace(/'s$/, "’s")}
              </button>
            ))}
          </div>
          {verseMode && query.trim() && (
            <button className="text-btn" onClick={() => setQuery("")}>
              ← Topics for {verseMode.book} {verseMode.chapter}:{verseMode.verse}
            </button>
          )}
          {error && <p className="status-error">{error}</p>}
          {loading && <p className="muted">Searching…</p>}
          {!loading && (query.trim() || verseMode) && shownHits.length === 0 && (
            <p className="muted">{verseMode && !query.trim() ? "No dictionary or topical entries cite this verse." : `Nothing found for "${query.trim()}".`}</p>
          )}
          {grouped.map(([name, list]) => (
            <section key={name} className="dict-group">
              <h4>
                {name} <span className="tab-count">{list.length}</span>
              </h4>
              <ul className="xref-list">
                {list.map((h) => (
                  <li key={h.id}>
                    <button className="link-btn" onClick={() => open(h.id)}>
                      {h.headword}
                    </button>
                    <div className="snippet">{h.snippet}</div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!query.trim() && !verseMode && (
            <div className="search-hint">
              <p>Four public-domain reference works, searchable offline:</p>
              <ul>
                {dicts.map((d) => (
                  <li key={d.code}>
                    <strong>{d.name}</strong> — {d.entry_count.toLocaleString()} {d.kind === "topical" ? "topics" : "entries"}
                  </li>
                ))}
              </ul>
              <p>
                Nave's and Torrey's are topical indexes: they gather every verse on a subject. Easton's and Smith's are Bible
                dictionaries: short articles on people, places and terms. All four reflect their 19th-century authors'
                scholarship and views.
              </p>
            </div>
          )}
        </>
      )}
    </aside>
  );
}
