import { useEffect, useMemo, useRef, useState } from "react";
import { api, FirstsCategory, FirstsEntry, parseCitation } from "../api";
import { CloseIcon } from "./icons";

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
    label: "Warfare",
    hint: "Passages explicitly about spiritual warfare, not thematically inferred ones.",
  },
  {
    key: "prophecy",
    label: "Prophecies",
    hint: "Old Testament prophecies of the Messiah paired with the New Testament passage recording the fulfilment — foretold on the left, fulfilled on the right. Both sides are clickable. Every reference was checked against the bundled text.",
  },
];

const DEBOUNCE_MS = 200;

/** A row of citation buttons; a reference that can't be parsed is shown but disabled
 * rather than hidden, so a bad citation is visible instead of silently dropped. */
function RefRow({ refs, onJump }: { refs: string[]; onJump: Props["onJump"] }) {
  if (refs.length === 0) return null;
  return (
    <div className="citation-row">
      {refs.map((c) => {
        const ref = parseCitation(c);
        return (
          <button key={c} className="link-btn" disabled={!ref} onClick={() => ref && onJump(ref.book, ref.chapter, ref.verse)}>
            {c}
          </button>
        );
      })}
    </div>
  );
}

export function FirstsPanel({ onClose, onJump }: Props) {
  const [entries, setEntries] = useState<FirstsEntry[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FirstsCategory>("firsts");
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  // One debounced effect covers both the initial load (empty query) and filtering,
  // with a request token so a slow earlier response can't clobber a newer one.
  useEffect(() => {
    const id = ++requestId.current;
    const handle = setTimeout(() => {
      const q = query.trim();
      (q ? api.searchFirsts(q) : api.listFirsts())
        .then((rows) => id === requestId.current && setEntries(rows))
        .catch((e) => id === requestId.current && setError(String(e)));
    }, query ? DEBOUNCE_MS : 0);
    return () => clearTimeout(handle);
  }, [query]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entries) c[e.category] = (c[e.category] ?? 0) + 1;
    return c;
  }, [entries]);
  const shown = useMemo(() => entries.filter((e) => e.category === category), [entries, category]);
  const activeHint = CATEGORIES.find((c) => c.key === category)?.hint;
  const filtering = query.trim().length > 0;

  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <h3>Firsts &amp; Milestones</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="mode-toggle" role="tablist" aria-label="Category">
        {CATEGORIES.map((c) => (
          <button key={c.key} role="tab" aria-selected={category === c.key} className={category === c.key ? "active" : ""} onClick={() => setCategory(c.key)}>
            {c.label}
            {filtering && <span className="tab-count">{counts[c.key] ?? 0}</span>}
          </button>
        ))}
      </div>
      <p className="search-hint">{activeHint}</p>
      <div className="search-controls">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter (e.g. crime, promise, armor)" aria-label="Filter entries" />
      </div>
      {error && <p className="status-error">Couldn't load: {error}</p>}
      {shown.length === 0 && !error && (
        <p className="muted">
          {filtering ? `No ${CATEGORIES.find((c) => c.key === category)?.label.toLowerCase()} match "${query.trim()}".` : "Nothing here yet."}
        </p>
      )}
      <ul className="xref-list">
        {shown.map((e) => (
          <li key={e.id}>
            <strong>{e.question}</strong>
            {e.category === "prophecy" ? (
              <>
                {e.section && <span className="prophecy-section">{e.section}</span>}
                {/* Foretold -> fulfilled, kept as two labelled sides so the link between the
                    testaments is the thing you actually see, not a flat list of references. */}
                <div className="prophecy-pair">
                  <div className="prophecy-side">
                    <span className="prophecy-label">Foretold</span>
                    <RefRow refs={e.citations} onJump={onJump} />
                  </div>
                  <span className="prophecy-arrow" aria-hidden="true">
                    →
                  </span>
                  <div className="prophecy-side">
                    <span className="prophecy-label">Fulfilled</span>
                    <RefRow refs={e.fulfillment} onJump={onJump} />
                  </div>
                </div>
                {e.answer && <div className="snippet">{e.answer}</div>}
                {e.note && <div className="snippet note">{e.note}</div>}
              </>
            ) : (
              <>
                <div className="snippet">{e.answer}</div>
                {e.note && <div className="snippet note">{e.note}</div>}
                <RefRow refs={e.citations} onJump={onJump} />
              </>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
