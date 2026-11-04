import { useMemo, useState } from "react";
import { BASIS_LABEL, BIBLE_AUTHORS, BibleAuthor } from "../bibleAuthors";
import { CloseIcon } from "./icons";

interface Props {
  onClose: () => void;
  onJump: (book: string, chapter: number, verse: number) => void;
}

const SECTIONS: BibleAuthor["testament"][] = ["Old Testament", "New Testament"];

/** The people who wrote the Bible: who each was, and the books they wrote (opened by the "Authors" tile). */
export function AuthorsPanel({ onClose, onJump }: Props) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? BIBLE_AUTHORS.filter((a) => [a.name, a.note, a.detail ?? "", ...a.books].join(" ").toLowerCase().includes(q)) : BIBLE_AUTHORS),
    [q],
  );

  return (
    <aside className="side-panel">
      <div className="side-panel-header">
        <h3>The {BIBLE_AUTHORS.length} authors of the Bible</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <p className="search-hint">
        About forty people wrote the 66 books, over roughly 1,500 years, in Hebrew, Aramaic and Greek. The usual figure is &ldquo;about 40&rdquo;; the exact count depends on how the books with no named writer are credited. This list follows long-standing tradition,
        and says where the text itself names the writer. Click a book to open it.
      </p>
      <div className="search-controls">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter (e.g. Isaiah, Psalms, Galatians)" aria-label="Filter authors" />
      </div>
      {shown.length === 0 && <p className="muted">No author or book matches &ldquo;{query.trim()}&rdquo;.</p>}
      {SECTIONS.map((section) => {
        const list = shown.filter((a) => a.testament === section);
        if (list.length === 0) return null;
        return (
          <section key={section}>
            <h4 className="section-label">
              {section} &middot; {list.length}
            </h4>
            <ul className="xref-list">
              {list.map((a) => (
                <li key={a.name}>
                  <strong>{a.name}</strong> <span className="prophecy-section">{BASIS_LABEL[a.basis]}</span>
                  <div className="snippet">{a.note}</div>
                  <div className="citation-row">
                    {a.books.map((b) => (
                      <button key={b} className="link-btn" onClick={() => onJump(b, 1, 1)}>
                        {b}
                      </button>
                    ))}
                  </div>
                  {a.detail && <div className="snippet note">{a.detail}</div>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </aside>
  );
}
