// The Concordance: how many times a word is used in each book of the Bible. Type a word, see a count for every book (Old and New Testament, with their totals),
// tap a book to read the verses, each marked and linking into the reader, and come back with "All books". Opens beside the reading pane, like the other searches.

import { useEffect, useRef, useState } from "react";
import { api, type ConcordanceResult, type SearchHit, type Version } from "../api";
import { bookLine, byTestament, heat, mark, summary, thousands } from "../concordance";
import { CloseIcon } from "./icons";

interface Props {
  versions: Version[];
  versionCode: string;
  /** a word to count as soon as the panel opens */
  initialWord?: string;
  onJump: (book: string, chapter: number, verse: number) => void;
  onClose: () => void;
}

interface Ran {
  word: string;
  version: string;
  forms: boolean;
  result: ConcordanceResult;
}

interface Verses {
  title: string;
  hits: SearchHit[];
}

const PAGE = 150;

export function ConcordancePanel({ versions, versionCode, initialWord, onJump, onClose }: Props) {
  const [word, setWord] = useState(initialWord ?? "");
  const [forms, setForms] = useState(false);
  const [version, setVersion] = useState(versionCode === "ENOCH1" ? "BSB" : versionCode);
  const [ran, setRan] = useState<Ran | null>(null);
  const [verses, setVerses] = useState<Verses | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const req = useRef(0);

  const run = async (w = word, f = forms, v = version) => {
    const text = w.trim();
    if (!text) return;
    const id = ++req.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.wordConcordance(v, text, f);
      if (id !== req.current) return;
      setRan({ word: text, version: v, forms: f, result });
      setVerses(null);
    } catch (e) {
      if (id !== req.current) return;
      setError(String(e));
      setRan(null);
    } finally {
      if (id === req.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (initialWord) void run(initialWord);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // changing the Bible or "and its forms" counts again, if a word is in the box
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (word.trim()) void run(word, forms, version);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forms, version]);

  const open = async (scope: { kind: "book"; book: string } | { kind: "testament"; testament: "OT" | "NT" }, title: string) => {
    if (!ran) return;
    const id = ++req.current;
    setLoading(true);
    setError(null);
    try {
      const r = await api.wordFrequency(ran.version, ran.word, scope, ran.forms);
      if (id !== req.current) return;
      setVerses({ title, hits: r.verses });
      setShown(PAGE);
    } catch (e) {
      if (id !== req.current) return;
      setError(String(e));
    } finally {
      if (id === req.current) setLoading(false);
    }
  };

  const r = ran?.result;
  const split = r ? byTestament(r.books) : null;
  const max = r ? Math.max(0, ...r.books.map((b) => b.occurrences)) : 0;
  const pattern = r?.pattern ?? "";

  const testament = (key: "OT" | "NT", label: string, t: { books: ReturnType<typeof byTestament>["ot"]["books"]; occurrences: number; verses: number }) => (
    <section className="cc-testament" aria-label={label}>
      <button type="button" className="cc-head" disabled={t.occurrences === 0} onClick={() => void open({ kind: "testament", testament: key }, `${label}: ${thousands(t.occurrences)} time${t.occurrences === 1 ? "" : "s"} in ${thousands(t.verses)} verse${t.verses === 1 ? "" : "s"}`)} title={`Read every verse in the ${label}`}>
        <strong>{label}</strong>
        <span>
          {thousands(t.occurrences)} in {thousands(t.verses)} verse{t.verses === 1 ? "" : "s"}
        </span>
      </button>
      <div className="cc-grid">
        {t.books.map((b) => (
          <button
            key={b.book}
            type="button"
            className={"cc-book" + (b.occurrences === 0 ? " none" : "")}
            style={b.occurrences ? { ["--cc-heat" as string]: `${Math.round(heat(b.occurrences, max) * 100)}%` } : undefined}
            disabled={b.occurrences === 0}
            onClick={() => void open({ kind: "book", book: b.book }, bookLine(b.book, b.occurrences, b.verses))}
            title={b.occurrences ? bookLine(b.book, b.occurrences, b.verses) : `${b.book}: not used`}
          >
            <span className="cc-name">{b.book}</span>
            <span className="cc-count">{b.occurrences ? thousands(b.occurrences) : "–"}</span>
          </button>
        ))}
      </div>
    </section>
  );

  return (
    <aside className="side-panel wide concordance-panel">
      <div className="side-panel-header">
        <h3>Concordance</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="search-controls">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <input autoFocus value={word} onChange={(e) => setWord(e.target.value)} placeholder="A word, like grace, or a short phrase" aria-label="The word to count" />
          <button type="submit" disabled={loading || !word.trim()}>
            {loading && !verses ? "Counting…" : "Count"}
          </button>
        </form>
        <div className="cc-options">
          <select value={version} onChange={(e) => setVersion(e.target.value)} aria-label="Bible to count in">
            {versions.map((v) => (
              <option key={v.code} value={v.code}>
                {v.code}: {v.name}
              </option>
            ))}
          </select>
          <div className="cc-forms" role="group" aria-label="Which words to count">
            <button type="button" className={!forms ? "on" : ""} aria-pressed={!forms} onClick={() => setForms(false)} title="Only this word, written this way">
              This word
            </button>
            <button type="button" className={forms ? "on" : ""} aria-pressed={forms} onClick={() => setForms(true)} title="Also its other forms: believe, believes, believed, believing, believer">
              And its forms
            </button>
          </div>
        </div>
      </div>
      {error && <p className="status-error">{error}</p>}

      {!verses && ran && r && split && (
        <>
          <p className="frequency-summary" role="status">
            {summary(ran.word, r.total_occurrences, r.total_verses, ran.version, r.forms)}
          </p>
          {r.found.length > 1 && (
            <p className="muted cc-formlist">
              Counted: {r.found.map((f) => `${f.word} (${thousands(f.count)})`).join(", ")}.
            </p>
          )}
          {r.total_occurrences > 0 && (
            <>
              {testament("OT", "Old Testament", split.ot)}
              {testament("NT", "New Testament", split.nt)}
              <p className="muted cc-note">Tap a book, or a Testament, to read the verses.</p>
            </>
          )}
        </>
      )}

      {verses && (
        <>
          <div className="cc-back">
            <button type="button" className="link-btn" onClick={() => setVerses(null)}>
              ‹ All books
            </button>
            <strong>{verses.title}</strong>
          </div>
          <ul className="xref-list cc-verses">
            {verses.hits.slice(0, shown).map((h) => (
              <li key={`${h.book}-${h.chapter}-${h.verse}`}>
                <div className="xref-item-head">
                  <button className="link-btn" onClick={() => onJump(h.book, h.chapter, h.verse)}>
                    {h.book} {h.chapter}:{h.verse}
                  </button>
                </div>
                <div className="snippet">
                  {mark(h.text, pattern).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
                </div>
              </li>
            ))}
          </ul>
          {verses.hits.length > shown && (
            <p>
              <button type="button" className="outline-btn" onClick={() => setShown((n) => n + PAGE)}>
                Show {Math.min(PAGE, verses.hits.length - shown)} more ({thousands(verses.hits.length - shown)} left)
              </button>
            </p>
          )}
        </>
      )}

      {!ran && !error && !loading && (
        <p className="search-hint">
          Type a word and press Count: you see how many times it is used in every book of the Bible, and can read the verses of any book. “And its forms” also counts believe, believes, believed and believing together.
        </p>
      )}
    </aside>
  );
}
