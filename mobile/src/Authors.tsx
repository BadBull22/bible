// The people who wrote the Bible (since 3.0.0): who each was and the books they wrote, the same list as the computer's Authors page (src/bibleAuthors.ts,
// used from its source). Tap a book to open it.

import { useMemo, useState } from "react";
import { BASIS_LABEL, BIBLE_AUTHORS, type BibleAuthor } from "../../src/bibleAuthors";
import { useBack } from "./back";

const SECTIONS: BibleAuthor["testament"][] = ["Old Testament", "New Testament"];

/** The card in More that opens the Authors page. */
export function AuthorsEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="browse-entry">
      <div className="browse-entry-grid">
        <button className="browse-card" onClick={onOpen}>
          <span className="browse-card-title">
            Authors of the Bible <small>{BIBLE_AUTHORS.length}</small>
          </span>
          <span className="browse-card-blurb">Who wrote each book, and whether the text names them or tradition does.</span>
        </button>
      </div>
    </section>
  );
}

export function Authors({ onJump, onClose }: { onJump: (book: string, chapter: number, verse: number) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  useBack(true, onClose);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (q ? BIBLE_AUTHORS.filter((a) => [a.name, a.note, a.detail ?? "", ...a.books].join(" ").toLowerCase().includes(q)) : BIBLE_AUTHORS), [q]);
  return (
    <div className="browse">
      <button className="link back" onClick={onClose}>
        ‹ More
      </button>
      <h2>The {BIBLE_AUTHORS.length} authors of the Bible</h2>
      <p className="hint">
        About forty people wrote the 66 books, over roughly 1,500 years, in Hebrew, Aramaic and Greek. The usual figure is “about 40”; the exact count depends on how the books with no named writer are credited. This list
        follows long-standing tradition, and says where the text itself names the writer. Tap a book to open it.
      </p>
      <input className="field" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter (Isaiah, Psalms, Galatians)" aria-label="Filter authors" autoCapitalize="none" autoCorrect="off" />
      {shown.length === 0 && <p className="hint">No author or book matches “{query.trim()}”.</p>}
      {SECTIONS.map((section) => {
        const list = shown.filter((a) => a.testament === section);
        if (list.length === 0) return null;
        return (
          <section key={section}>
            <h4 className="browse-section">
              {section} · {list.length}
            </h4>
            <ul className="authors-list">
              {list.map((a) => (
                <li key={a.name} className="browse-card authors-card">
                  <strong>{a.name}</strong> <span className="authors-basis">{BASIS_LABEL[a.basis]}</span>
                  <div className="browse-note">{a.note}</div>
                  <div className="browse-chips">
                    {a.books.map((b) => (
                      <button key={b} className="browse-pill quiet" onClick={() => onJump(b, 1, 1)}>
                        {b}
                      </button>
                    ))}
                  </div>
                  {a.detail && <div className="browse-note">{a.detail}</div>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
