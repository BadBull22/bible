import { BookInfo } from "../api";

interface Props {
  books: BookInfo[];
  selectedBook: string;
  selectedChapter: number;
  chapterCounts: Record<string, number>;
  onSelect: (book: string, chapter: number) => void;
}

export function Sidebar({ books, selectedBook, selectedChapter, chapterCounts, onSelect }: Props) {
  const ot = books.filter((b) => b.testament === "OT");
  const nt = books.filter((b) => b.testament === "NT");
  const apocrypha = books.filter((b) => b.testament === "Apocrypha");

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <h3>Old Testament</h3>
        <div className="book-list">
          {ot.map((b) => (
            <BookRow key={b.name} book={b} selectedBook={selectedBook} selectedChapter={selectedChapter} chapterCounts={chapterCounts} onSelect={onSelect} />
          ))}
        </div>
      </div>
      <div className="sidebar-section">
        <h3>New Testament</h3>
        <div className="book-list">
          {nt.map((b) => (
            <BookRow key={b.name} book={b} selectedBook={selectedBook} selectedChapter={selectedChapter} chapterCounts={chapterCounts} onSelect={onSelect} />
          ))}
        </div>
      </div>
      {apocrypha.length > 0 && (
        <div className="sidebar-section">
          <h3>Apocrypha</h3>
          <p className="sidebar-note">Not part of the Bible's canon (Genesis–Revelation above) in most traditions.</p>
          <div className="book-list">
            {apocrypha.map((b) => (
              <BookRow key={b.name} book={b} selectedBook={selectedBook} selectedChapter={selectedChapter} chapterCounts={chapterCounts} onSelect={onSelect} />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function BookRow({ book, selectedBook, selectedChapter, chapterCounts, onSelect }: {
  book: BookInfo;
  selectedBook: string;
  selectedChapter: number;
  chapterCounts: Record<string, number>;
  onSelect: (book: string, chapter: number) => void;
}) {
  const isOpen = book.name === selectedBook;
  const count = chapterCounts[book.name] ?? 0;
  return (
    <div className="book-row">
      <button className={"book-btn" + (isOpen ? " active" : "")} onClick={() => onSelect(book.name, 1)}>
        {book.name}
      </button>
      {isOpen && count > 0 && (
        <div className="chapter-grid">
          {Array.from({ length: count }, (_, i) => i + 1).map((c) => (
            <button
              key={c}
              className={"chapter-btn" + (c === selectedChapter ? " active" : "")}
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
