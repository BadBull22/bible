// The Concordance: how many times a word is used in each book of the Bible (by word, by Strong's number, or by meaning: every word in a group such as love or forgiveness, Hebrew and Greek). Type a word, see a count for every book (Old and New Testament, with their totals),
// tap a book to read the verses, each marked and linking into the reader, and come back with "All books". Opens beside the reading pane, like the other searches.

import { useEffect, useRef, useState } from "react";
import { api, type ConcordanceResult, type OriginalWord, type SearchHit, type Version } from "../api";
import { BIBLE_BOOKS } from "../browse/browseLogic";
import { bookLine, byTestament, heat, mark, summary, thousands } from "../concordance";
import { asStrongs, meaningSummary, strongsSummary, wordToLookUp } from "../semantic";
import { BookStrip, type StripBook } from "./BookStrip";
import { MeaningPicker, type MeaningSel } from "./MeaningPicker";
import { MeaningTree } from "./MeaningTree";
import { SensePanel, type VerseAt } from "./SensePanel";
import { CloseIcon } from "./icons";

interface Props {
  versions: Version[];
  versionCode: string;
  /** a word to count as soon as the panel opens */
  initialWord?: string;
  /** a Strong's number to open with its meanings, and the verse it is being read in (the meaning used there is chosen) */
  initialStrongs?: { strongs: string; at?: VerseAt };
  onJump: (book: string, chapter: number, verse: number) => void;
  onClose: () => void;
}

type Mode = "word" | "strongs" | "meaning";

interface Ran {
  /** what was asked: a word, a Strong's number or a meaning */
  source: Mode;
  word: string;
  version: string;
  forms: boolean;
  result: ConcordanceResult;
  /** the meaning chosen (source "meaning") */
  sel?: MeaningSel;
}

interface Verses {
  title: string;
  hits: SearchHit[];
}

const PAGE = 150;

export function ConcordancePanel({ versions, versionCode, initialWord, initialStrongs, onJump, onClose }: Props) {
  const [word, setWord] = useState(initialStrongs?.strongs ?? initialWord ?? "");
  const [forms, setForms] = useState(false);
  const [mode, setMode] = useState<Mode>(initialStrongs ? "strongs" : "word");
  /** the verse a Strong's number is being read in: the meaning used there is the one chosen */
  const [senseAt, setSenseAt] = useState<VerseAt | null>(initialStrongs?.at ?? null);
  const [originals, setOriginals] = useState<OriginalWord[]>([]);
  const [sel, setSel] = useState<MeaningSel | null>(null);
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
      setRan({ source: "word", word: text, version: v, forms: f, result });
      setVerses(null);
    } catch (e) {
      if (id !== req.current) return;
      setError(String(e));
      setRan(null);
    } finally {
      if (id === req.current) setLoading(false);
    }
  };

  /** a Strong's number (G26, H157): how often the original word behind it is used */
  const runStrongs = async (text = word, v = version, keepVerse = false) => {
    if (!keepVerse) setSenseAt(null);
    const s = asStrongs(text);
    if (!s) {
      setError("Type a Strong's number: G for Greek or H for Hebrew, then the number, like G26 or H157.");
      return;
    }
    const id = ++req.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.strongsConcordance(s);
      if (id !== req.current) return;
      setRan({ source: "strongs", word: s, version: v, forms: false, result });
      setVerses(null);
    } catch (e) {
      if (id !== req.current) return;
      setError(String(e));
      setRan(null);
    } finally {
      if (id === req.current) setLoading(false);
    }
  };

  /** a group of meanings (or one word in it) chosen in the Meaning mode: a count of verses for every book */
  const runMeaning = async (s: MeaningSel, v = version) => {
    setSel(s);
    const id = ++req.current;
    setLoading(true);
    setError(null);
    try {
      const result = await api.semanticConcordance(s.language, s.code, s.entry, s.meaning);
      if (id !== req.current) return;
      setRan({ source: "meaning", word: s.name, version: v, forms: false, result, sel: s });
      setVerses(null);
    } catch (e) {
      if (id !== req.current) return;
      setError(String(e));
      setRan(null);
    } finally {
      if (id === req.current) setLoading(false);
    }
  };

  const changeMode = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    // a word is not a Strong's number: the box starts empty in each mode
    setWord("");
    setRan(null);
    setVerses(null);
    setError(null);
  };

  useEffect(() => {
    if (initialStrongs) void runStrongs(initialStrongs.strongs, version, true);
    else if (initialWord) void run(initialWord);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the Hebrew and Greek words behind a counted English word (a Bible tagged with Strong's numbers; the BSB when the chosen one is not)
  useEffect(() => {
    setOriginals([]);
    if (!ran || ran.source !== "word") return;
    const w = wordToLookUp(ran.word);
    if (!w) return;
    let live = true;
    api.originalWordsFor(w, ran.version).then((o) => live && setOriginals(o)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ran?.source, ran?.word, ran?.version]);

  // changing the Bible or "and its forms" counts again, if a word is in the box
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (mode === "word" && word.trim()) void run(word, forms, version);
    else if (mode === "strongs" && ran) void runStrongs(ran.word, version, true);
    else if (mode === "meaning" && sel) void runMeaning(sel, version);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forms, version]);

  const open = async (scope: { kind: "book"; book: string } | { kind: "testament"; testament: "OT" | "NT" }, title: string) => {
    if (!ran) return;
    const id = ++req.current;
    setLoading(true);
    setError(null);
    try {
      const frequencyScope = scope.kind === "book" ? { kind: "book" as const, book: scope.book } : { kind: "testament" as const, testament: scope.testament };
      const hits =
        ran.source === "strongs"
          ? await api.strongsVerses(ran.version, ran.word, frequencyScope)
          : ran.source === "meaning" && ran.sel
            ? await api.semanticHits(ran.version, ran.sel.language, ran.sel.code, ran.sel.entry, ran.sel.meaning, scope.kind === "book" ? scope.book : null)
            : null;
      const r = hits ? { verses: hits } : await api.wordFrequency(ran.version, ran.word, scope, ran.forms);
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

  /** an original word behind the English word counted: open it with its meanings */
  const openOriginal = (s: string) => {
    setMode("strongs");
    setWord(s);
    void runStrongs(s);
  };

  const r = ran?.result;
  const split = r ? byTestament(r.books) : null;
  const byName = new Map((r?.books ?? []).map((b) => [b.book, b]));
  const strip: StripBook[] = BIBLE_BOOKS.map((name, i) => {
    const b = byName.get(name);
    return { name, testament: i < 39 ? "OT" : "NT", count: b ? (ran?.source === "meaning" ? b.verses : b.occurrences) : 0 };
  });
  const max = r ? Math.max(0, ...r.books.map((b) => b.occurrences)) : 0;
  const pattern = r?.pattern ?? "";

  const testament = (key: "OT" | "NT", label: string, t: { books: ReturnType<typeof byTestament>["ot"]["books"]; occurrences: number; verses: number }) => (
    <section className="cc-testament" aria-label={label}>
      <button type="button" className="cc-head" disabled={t.occurrences === 0} onClick={() => void open({ kind: "testament", testament: key }, ran?.source === "meaning" ? `${label}: ${thousands(t.verses)} verse${t.verses === 1 ? "" : "s"}` : `${label}: ${thousands(t.occurrences)} time${t.occurrences === 1 ? "" : "s"} in ${thousands(t.verses)} verse${t.verses === 1 ? "" : "s"}`)} title={`Read every verse in the ${label}`}>
        <strong>{label}</strong>
        <span>
          {ran?.source === "meaning" ? `${thousands(t.verses)} verse${t.verses === 1 ? "" : "s"}` : `${thousands(t.occurrences)} in ${thousands(t.verses)} verse${t.verses === 1 ? "" : "s"}`}
        </span>
      </button>
      <details className="cc-numbers">
        <summary>Numbers for each book</summary>
      <div className="cc-grid">
        {t.books.map((b) => (
          <button
            key={b.book}
            type="button"
            className={"cc-book" + (b.occurrences === 0 ? " none" : "")}
            style={b.occurrences ? { ["--cc-heat" as string]: `${Math.round(heat(b.occurrences, max) * 100)}%` } : undefined}
            disabled={b.occurrences === 0}
            onClick={() => void open({ kind: "book", book: b.book }, ran?.source === "meaning" ? `${b.book}: ${thousands(b.verses)} verse${b.verses === 1 ? "" : "s"}` : bookLine(b.book, b.occurrences, b.verses))}
            title={b.occurrences ? (ran?.source === "meaning" ? `${b.book}: ${thousands(b.verses)} verse${b.verses === 1 ? "" : "s"}` : bookLine(b.book, b.occurrences, b.verses)) : `${b.book}: not used`}
          >
            <span className="cc-name">{b.book}</span>
            <span className="cc-count">{b.occurrences ? thousands(ran?.source === "meaning" ? b.verses : b.occurrences) : "–"}</span>
          </button>
        ))}
      </div>
      </details>
    </section>
  );

  const pickBook = (name: string) => {
    const b = byName.get(name);
    if (!b || !ran) return;
    void open({ kind: "book", book: name }, ran.source === "meaning" ? `${name}: ${thousands(b.verses)} verse${b.verses === 1 ? "" : "s"}` : bookLine(name, b.occurrences, b.verses));
  };

  return (
    <aside className="side-panel wide concordance-panel">
      <div className="side-panel-header">
        <h3>Concordance</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="search-controls">
        <div className="cc-forms cc-modes" role="group" aria-label="What to look up">
          <button type="button" className={mode === "word" ? "on" : ""} aria-pressed={mode === "word"} onClick={() => changeMode("word")} title="How often a word is used in the Bible you read">
            Word
          </button>
          <button type="button" className={mode === "strongs" ? "on" : ""} aria-pressed={mode === "strongs"} onClick={() => changeMode("strongs")} title="How often the Hebrew or Greek word behind a Strong's number is used">
            Strong's number
          </button>
          <button type="button" className={mode === "meaning" ? "on" : ""} aria-pressed={mode === "meaning"} onClick={() => changeMode("meaning")} title="Every Hebrew or Greek word about love, forgiveness, joy...: search by meaning">
            Meaning
          </button>
        </div>
        {mode !== "meaning" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void (mode === "strongs" ? runStrongs() : run());
            }}
          >
            <input
              autoFocus
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder={mode === "strongs" ? "A Strong's number, like G26 or H157" : "A word, like grace, or a short phrase"}
              aria-label={mode === "strongs" ? "The Strong's number to count" : "The word to count"}
            />
            <button type="submit" disabled={loading || !word.trim()}>
              {loading && !verses ? "Counting…" : "Count"}
            </button>
          </form>
        )}
        {mode === "meaning" && <MeaningPicker selected={sel} onPick={(s) => void runMeaning(s)} />}
        <div className="cc-options">
          <select value={version} onChange={(e) => setVersion(e.target.value)} aria-label="Bible to count in">
            {versions.map((v) => (
              <option key={v.code} value={v.code}>
                {v.code}: {v.name}
              </option>
            ))}
          </select>
          {mode === "word" && (
          <div className="cc-forms" role="group" aria-label="Which words to count">
            <button type="button" className={!forms ? "on" : ""} aria-pressed={!forms} onClick={() => setForms(false)} title="Only this word, written this way">
              This word
            </button>
            <button type="button" className={forms ? "on" : ""} aria-pressed={forms} onClick={() => setForms(true)} title="Also its other forms: believe, believes, believed, believing, believer">
              And its forms
            </button>
          </div>
          )}
        </div>
      </div>
      {error && <p className="status-error">{error}</p>}

      {!verses && ran && r && split && (
        <>
          <p className="frequency-summary" role="status">
            {ran.source === "strongs"
              ? strongsSummary(ran.word, r.total_occurrences, r.total_verses)
              : ran.source === "meaning" && ran.sel
                ? meaningSummary(ran.sel.word ? `${ran.sel.name}: ${ran.sel.word}` : ran.sel.name, ran.sel.language, ran.sel.words, r.total_verses)
                : summary(ran.word, r.total_occurrences, r.total_verses, ran.version, r.forms)}
          </p>
          {ran.source === "strongs" && <SensePanel strongs={ran.word} version={ran.version} at={senseAt} onJump={onJump} />}
          {ran.source === "meaning" && ran.sel && <MeaningTree language={ran.sel.language} code={ran.sel.code} name={ran.sel.name} onPick={(s) => void runMeaning(s)} />}
          {ran.source === "word" && originals.length > 0 && (
            <div className="original-words">
              <h4>The Hebrew and Greek words behind “{ran.word}”</h4>
              <div className="chips">
                {originals.map((o) => (
                  <button key={o.strongs} type="button" onClick={() => openOriginal(o.strongs)} title={o.definition || undefined}>
                    <span className="ow-lemma" lang={o.strongs.startsWith("H") ? "he" : "grc"}>
                      {o.lemma}
                    </span>
                    <span className="muted">
                      {o.strongs} · {o.times}×
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {r.found.length > 1 && (
            <p className="muted cc-formlist">
              Counted: {r.found.map((f) => `${f.word} (${thousands(f.count)})`).join(", ")}.
            </p>
          )}
          {r.total_occurrences > 0 && (
            <>
              <BookStrip books={strip} unit={ran.source === "meaning" ? "verse" : "time"} label={`Where it is used, book by book`} onPick={pickBook} />
              {testament("OT", "Old Testament", split.ot)}
              {testament("NT", "New Testament", split.nt)}
              <p className="muted cc-note">
                Tap a book, or a Testament, to read the verses.
                {ran.source === "meaning" ? ` The verses are shown in the ${ran.version}; the words are the Hebrew or Greek ones in each verse.` : ""}
              </p>
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
                {h.why && h.why.length > 0 && <div className="muted cc-whywords">{h.why.join(" · ")}</div>}
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

      {!ran && !error && !loading && mode === "strongs" && (
        <p className="search-hint">
          Type a Strong's number (G for Greek, H for Hebrew, then the number, like G26 for agape or H157 for to love) to see how often that Hebrew or Greek word is used in each book, and read its verses.
        </p>
      )}
      {!ran && !error && !loading && mode === "meaning" && !sel && (
        <p className="search-hint">
          Choose a group of meanings (type love, forgive, joy or fear, or open the groups) to see every Hebrew or Greek word with that meaning, how many verses use them in each book, and the verses. Choose one word in the group to see only that word.
        </p>
      )}
      {!ran && !error && !loading && mode === "word" && (
        <p className="search-hint">
          Type a word and press Count: you see how many times it is used in every book of the Bible, and can read the verses of any book. “And its forms” also counts believe, believes, believed and believing together.
        </p>
      )}
    </aside>
  );
}
