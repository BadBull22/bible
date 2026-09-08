import { useEffect, useState } from "react";
import { api, StrongsEntry, SearchHit } from "../api";

interface Props {
  strongsNumber: string;
  surfaceText: string;
  versionCode: string;
  onClose: () => void;
  onJump: (book: string, chapter: number, verse: number) => void;
}

export function WordStudyPanel({ strongsNumber, surfaceText, versionCode, onClose, onJump }: Props) {
  const [entry, setEntry] = useState<StrongsEntry | null>(null);
  const [occurrences, setOccurrences] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([api.strongsLookup(strongsNumber), api.strongsOccurrences(strongsNumber, versionCode)])
      .then(([e, occ]) => {
        setEntry(e);
        setOccurrences(occ);
      })
      .finally(() => setLoading(false));
  }, [strongsNumber, versionCode]);

  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <h3>Word Study: "{surfaceText}"</h3>
        <button onClick={onClose}>✕</button>
      </div>
      {loading && <p>Loading…</p>}
      {!loading && entry && (
        <div className="strongs-entry">
          <div className="strongs-number">{entry.strongs_number}</div>
          {entry.lemma && <div className="lemma">{entry.lemma}</div>}
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
      {!loading && !entry && <p>No dictionary entry found for {strongsNumber}.</p>}
      {!loading && (
        <div className="occurrences">
          <h4>
            All {occurrences.length} occurrences in {versionCode} tagged with {strongsNumber}
          </h4>
          <ul>
            {occurrences.map((o, i) => (
              <li key={i}>
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
