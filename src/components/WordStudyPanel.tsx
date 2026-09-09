import { useEffect, useState } from "react";
import { api, StrongsEntry, SearchHit } from "../api";
import { CloseIcon } from "./icons";

interface Props {
  // A single surface word can carry more than one Strong's number (e.g. a Hebrew
  // word with an inseparable prefix); all of them are offered, first one shown.
  strongsNumbers: string[];
  surfaceText: string;
  versionCode: string;
  onClose: () => void;
  onJump: (book: string, chapter: number, verse: number) => void;
}

export function WordStudyPanel({ strongsNumbers, surfaceText, versionCode, onClose, onJump }: Props) {
  const [active, setActive] = useState(0);
  const [entry, setEntry] = useState<StrongsEntry | null>(null);
  const [occurrences, setOccurrences] = useState<SearchHit[]>([]);
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
    Promise.all([api.strongsLookup(strongsNumber), api.strongsOccurrences(strongsNumber, versionCode)])
      .then(([e, occ]) => {
        if (cancelled) return;
        setEntry(e);
        setOccurrences(occ);
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
          <div className="strongs-number">{entry.strongs_number}</div>
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
