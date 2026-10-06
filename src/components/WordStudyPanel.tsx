import { useEffect, useState } from "react";
import { api, DictionaryEntry, StrongsEntry, SearchHit } from "../api";
import { RichText } from "./RichText";
import { CloseIcon } from "./icons";
import { ListenButton } from "./ListenButton";

interface Props {
  // A single surface word can carry more than one Strong's number (e.g. a Hebrew
  // word with an inseparable prefix); all of them are offered, first one shown.
  strongsNumbers: string[];
  surfaceText: string;
  versionCode: string;
  onClose: () => void;
  onJump: (book: string, chapter: number, verse: number) => void;
  /** open the Hebrew & Greek search on this word */
  onSearchGrammar: (strongs: string) => void;
  onOpenLibrary: () => void;
}

export function WordStudyPanel({ strongsNumbers, surfaceText, versionCode, onClose, onJump, onSearchGrammar, onOpenLibrary }: Props) {
  const [active, setActive] = useState(0);
  const [entry, setEntry] = useState<StrongsEntry | null>(null);
  const [occurrences, setOccurrences] = useState<SearchHit[]>([]);
  const [lexicons, setLexicons] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // reset to the first number whenever a different word is opened
  useEffect(() => setActive(0), [strongsNumbers]);

  const strongsNumber = strongsNumbers[Math.min(active, strongsNumbers.length - 1)] ?? "";

  useEffect(() => {
    if (!strongsNumber) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.strongsLookup(strongsNumber),
      api.strongsOccurrences(strongsNumber, versionCode),
      api.libraryLexiconEntries(strongsNumber).catch(() => [] as DictionaryEntry[]),
    ])
      .then(([e, occ, lex]) => {
        if (cancelled) return;
        setEntry(e);
        setOccurrences(occ);
        setLexicons(lex);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [strongsNumber, versionCode]);

  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <h3>Word Study: "{surfaceText}"</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      {strongsNumbers.length > 1 && (
        <div className="mode-toggle" role="tablist" aria-label="Strong's numbers for this word">
          {strongsNumbers.map((n, i) => (
            <button key={n} role="tab" aria-selected={i === active} className={i === active ? "active" : ""} onClick={() => setActive(i)}>
              {n}
            </button>
          ))}
        </div>
      )}
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="status-error">Couldn't load this entry: {error}</p>}
      {!loading && !error && entry && (
        <div className="strongs-entry">
          <div className="strongs-entry-bar">
            <div className="strongs-number">{entry.strongs_number}</div>
            <ListenButton
              title="Read this entry aloud"
              text={() =>
                [
                  entry.xlit && `${entry.xlit}.`,
                  entry.derivation,
                  entry.strongs_def && `Definition: ${entry.strongs_def}`,
                  entry.kjv_def && `King James usage: ${entry.kjv_def}`,
                ]
                  .filter(Boolean)
                  .join("\n")
              }
            />
          </div>
          {entry.lemma && <div className="lemma" lang={entry.language === "Hebrew" ? "he" : "grc"}>{entry.lemma}</div>}
          {entry.xlit && <div className="xlit">({entry.xlit})</div>}
          {entry.pronunciation && <div className="pron">pronounced: {entry.pronunciation}</div>}
          {entry.derivation && <p className="derivation">{entry.derivation}</p>}
          {entry.strongs_def && (
            <p>
              <strong>Definition:</strong> {entry.strongs_def}
            </p>
          )}
          {entry.kjv_def && (
            <p>
              <strong>KJV usage:</strong> {entry.kjv_def}
            </p>
          )}
        </div>
      )}
      {!loading && !error && !entry && <p>No dictionary entry found for {strongsNumber}.</p>}
      {!loading && !error && (
        <div className="word-study-more">
          <button className="outline-btn" onClick={() => onSearchGrammar(strongsNumber)} title="Every occurrence of this Hebrew/Greek word, filtered by tense, stem, case…">
            Search by grammar
          </button>
        </div>
      )}
      {!loading && !error && (
        <div className="word-study-lexicons">
          <h4 className="section-label">From your Library</h4>
          {lexicons.length === 0 ? (
            <p className="search-hint" style={{ marginTop: 0 }}>
              Fuller {strongsNumber.startsWith("H") ? "Hebrew" : "Greek"} lexicons keyed to Strong's numbers —{" "}
              {strongsNumber.startsWith("H") ? "BDB glosses" : "Abbott-Smith, Dodson, an intermediate Greek–English lexicon"} — can be
              installed free from the{" "}
              <button className="link-btn" onClick={onOpenLibrary}>
                Library
              </button>{" "}
              and will show here.
            </p>
          ) : (
            lexicons.map((l, i) => (
              <details key={l.id} className="apparatus-key" open={i === 0}>
                <summary>
                  {l.dict_name} — {l.headword}
                </summary>
                <RichText text={l.body} onJump={onJump} />
              </details>
            ))
          )}
        </div>
      )}
      {!loading && !error && (
        <div className="occurrences">
          <h4>
            {occurrences.length} {occurrences.length === 1 ? "verse" : "verses"} in {versionCode} tagged {strongsNumber}
          </h4>
          {occurrences.length === 0 && (
            <p className="search-hint" style={{ marginTop: "0.4rem" }}>
              No tagged occurrences in this translation. Some bundled texts (e.g. YLT) don't carry Strong's tagging —
              switch to BSB or KJV for a full concordance listing.
            </p>
          )}
          <ul>
            {occurrences.map((o) => (
              <li key={`${o.book}-${o.chapter}-${o.verse}`}>
                <button className="link-btn" onClick={() => onJump(o.book, o.chapter, o.verse)}>
                  {o.book} {o.chapter}:{o.verse}
                </button>{" "}
                <span className="snippet">{o.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
