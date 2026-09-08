import { useEffect, useMemo, useState } from "react";
import { api, FirstsCategory, FirstsEntry, parseCitation } from "../api";

interface Props {
  onClose: () => void;
  onJump: (book: string, chapter: number, verse: number) => void;
}

const CATEGORIES: { key: FirstsCategory; label: string; hint: string }[] = [
  {
    key: "firsts",
    label: "Firsts",
    hint: "Hand-curated, source-cited answers to \"what was the first…\" questions — each one is grounded in a specific verse, not inferred.",
  },
  {
    key: "facts",
    label: "Facts",
    hint: "Structural and numeric facts, computed directly from the bundled text (verse/chapter counts, longest/shortest passages) rather than repeated from trivia lists.",
  },
  {
    key: "promises",
    label: "Promises",
    hint: "Explicit, first-person promises spoken by God, quoted directly rather than paraphrased.",
  },
  {
    key: "warfare",
    label: "Spiritual Warfare",
    hint: "Passages explicitly about spiritual warfare, not thematically inferred ones.",
  },
];

export function FirstsPanel({ onClose, onJump }: Props) {
  const [entries, setEntries] = useState<FirstsEntry[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FirstsCategory>("firsts");

  useEffect(() => {
    api.listFirsts().then(setEntries);
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (query.trim()) {
        api.searchFirsts(query.trim()).then(setEntries);
      } else {
        api.listFirsts().then(setEntries);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const shown = useMemo(() => entries.filter((e) => e.category === category), [entries, category]);
  const activeHint = CATEGORIES.find((c) => c.key === category)?.hint;

  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <h3>Firsts &amp; Milestones</h3>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="mode-toggle">
        {CATEGORIES.map((c) => (
          <button key={c.key} className={category === c.key ? "active" : ""} onClick={() => setCategory(c.key)}>
            {c.label}
          </button>
        ))}
      </div>
      <p className="search-hint">{activeHint}</p>
      <div className="search-controls">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter (e.g. crime, promise, armor)" />
      </div>
      <ul className="xref-list">
        {shown.map((e) => (
          <li key={e.id}>
            <strong>{e.question}</strong>
            <div className="snippet">{e.answer}</div>
            {e.note && (
              <div className="snippet" style={{ fontStyle: "italic" }}>
                {e.note}
              </div>
            )}
            {e.citations.length > 0 && (
              <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.3rem", flexWrap: "wrap" }}>
                {e.citations.map((c, i) => {
                  const ref = parseCitation(c);
                  return (
                    <button key={i} className="link-btn" onClick={() => ref && onJump(ref.book, ref.chapter, ref.verse)}>
                      {c}
                    </button>
                  );
                })}
              </div>
            )}
          </li>
        ))}
        {shown.length === 0 && <p>No matches.</p>}
      </ul>
    </aside>
  );
}
