import { useEffect, useRef } from "react";
import { BookInfo } from "../api";

interface Props {
  books: BookInfo[];
  selectedBook: string;
  selectedChapter: number;
  chapterCounts: Record<string, number>;
  onSelect: (book: string, chapter: number) => void;
}

interface SectionDef {
  key: string;
  title: string;
  note?: string;
}

const SECTIONS: SectionDef[] = [
  { key: "OT", title: "Old Testament" },
  { key: "NT", title: "New Testament" },
  { key: "Apocrypha", title: "Apocrypha", note: "Not part of the Bible's canon (Genesis–Revelation above) in most traditions." },
];

export function Sidebar({ books, selectedBook, selectedChapter, chapterCounts, onSelect }: Props) {
  return (
    <aside className="sidebar" aria-label="Books">
      {SECTIONS.map((section) => {
        const list = books.filter((b) => b.testament === section.key);
        if (list.length === 0) return null;
        return (
          <div className="sidebar-section" key={section.key}>
            <h3>{section.title}</h3>
            {section.note && <p className="sidebar-note">{section.note}</p>}
            <div className="book-list">
              {list.map((b) => (
                <BookRow
                  key={b.name}
                  book={b}
                  isOpen={b.name === selectedBook}
                  selectedChapter={selectedChapter}
                  chapterCount={chapterCounts[b.name] ?? 0}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        );
      })}
    </aside>
  );
}

function BookRow({
  book,
  isOpen,
  selectedChapter,
  chapterCount,
  onSelect,
}: {
  book: BookInfo;
  isOpen: boolean;
  selectedChapter: number;
  chapterCount: number;
  onSelect: (book: string, chapter: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  // When the reader lands on a book via search, a cross-reference or paging past a
  // book boundary, bring it into view so the sidebar always reflects where you are.
  useEffect(() => {
    if (isOpen) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [isOpen]);

  return (
    <div className="book-row" ref={rowRef}>
      <button
        className={"book-btn" + (isOpen ? " active" : "")}
        onClick={() => onSelect(book.name, 1)}
        aria-expanded={isOpen}
        aria-current={isOpen ? "true" : undefined}
      >
        {book.name}
        <span className="book-count" aria-hidden="true">
          {chapterCount || ""}
        </span>
      </button>
      {isOpen && chapterCount > 0 && (
        <div className="chapter-grid" role="list" aria-label={`${book.name} chapters`}>
          {Array.from({ length: chapterCount }, (_, i) => i + 1).map((c) => (
            <button
              key={c}
              role="listitem"
              className={"chapter-btn" + (c === selectedChapter ? " active" : "")}
              aria-current={c === selectedChapter ? "true" : undefined}
              onClick={() => onSelect(book.name, c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
