import { useEffect, useRef, useState } from "react";
import { api, CommentaryChapter, CommentaryInfo } from "../api";
import { addToBasket } from "../basket";
import { BasketButton } from "./BasketButton";
import { CopyButton } from "./CopyButton";
import { Line, plainText } from "./RichText";
import { ListenButton } from "./ListenButton";
import { CloseIcon } from "./icons";

interface Props {
  book: string;
  chapter: number;
  /** verse to scroll to / highlight (null = top of chapter) */
  focusVerse: number | null;
  /** number of verses in the chapter, for labelling the last section's range */
  verseCount: number;
  /** commentary to select initially (e.g. from a search hit); otherwise the last used */
  initialCommentaryId?: string;
  onJump: (book: string, chapter: number, verse: number) => void;
  onClose: () => void;
}

const LAST_KEY = "commentary:last";

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

function rangeLabel(start: number, next: number | undefined, verseCount: number): string {
  const end = next !== undefined ? next - 1 : verseCount;
  if (end <= start) return `Verse ${start}`;
  return `Verses ${start}–${end}`;
}

/** Commentary text arrives as plain text with newlines; render each line as a paragraph.
 * Library commentaries also carry ⟦..⟧ scripture-reference markers, shown as links. */
function Paragraphs({ text, onJump }: { text: string; onJump: (book: string, chapter: number, verse: number) => void }) {
  return (
    <>
      {text
        .split(/\n+/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p, i) => (
          <p key={i}>
            <Line text={p} onJump={onJump} />
          </p>
        ))}
    </>
  );
}

export function CommentaryPanel({ book, chapter, focusVerse, verseCount, initialCommentaryId, onJump, onClose }: Props) {
  const [commentaries, setCommentaries] = useState<CommentaryInfo[]>([]);
  const [commentaryId, setCommentaryId] = useState<string>(initialCommentaryId ?? readLast() ?? "");
  const [data, setData] = useState<CommentaryChapter | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sectionRefs = useRef<Record<number, HTMLElement | null>>({});
  const requestId = useRef(0);

  useEffect(() => {
    api
      .listCommentaries()
      .then((list) => {
        setCommentaries(list);
        setCommentaryId((cur) => (cur && list.some((c) => c.id === cur) ? cur : (list[0]?.id ?? "")));
      })
      .catch((e) => {
        setError(String(e));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (initialCommentaryId) setCommentaryId(initialCommentaryId);
  }, [initialCommentaryId]);

  useEffect(() => {
    if (!commentaryId) return;
    try {
      localStorage.setItem(LAST_KEY, commentaryId);
    } catch {
      /* per-viewer convenience only */
    }
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    api
      .getCommentaryChapter(commentaryId, book, chapter)
      .then((d) => id === requestId.current && setData(d))
      .catch((e) => id === requestId.current && setError(String(e)))
      .finally(() => id === requestId.current && setLoading(false));
  }, [commentaryId, book, chapter]);

  // The section covering focusVerse is the last one whose verse_start <= focusVerse.
  const activeStart = (() => {
    if (!data || focusVerse == null) return null;
    let best: number | null = null;
    for (const s of data.sections) if (s.verse_start <= focusVerse) best = s.verse_start;
    return best;
  })();

  useEffect(() => {
    if (loading || activeStart == null) return;
    sectionRefs.current[activeStart]?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [loading, activeStart, data]);

  const current = commentaries.find((c) => c.id === commentaryId);

  return (
    <aside className="side-panel wide commentary-panel">
      <div className="side-panel-header">
        <h3>
          Commentary: {book} {chapter}
        </h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="search-controls">
        <select value={commentaryId} onChange={(e) => setCommentaryId(e.target.value)} aria-label="Commentary">
          {commentaries.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {current && (
        <p className="search-hint" style={{ marginTop: 0 }}>
          {current.id.startsWith("lib:")
            ? `${current.license_name || "See the module's notes"} · installed from the Library (CrossWire Bible Society).`
            : `${current.license_name ?? "Open licence"} · bundled offline via the Free Use Bible API (AO Lab).`}
          {current.website && !current.id.startsWith("lib:") && (
            <>
              {" "}
              <span className="muted">{current.website.replace(/^https?:\/\//, "")}</span>
            </>
          )}
        </p>
      )}
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="status-error">{error}</p>}
      {!loading && !error && data && (
        <div className="commentary-body">
          {data.book_introduction && (
            <details className="apparatus-key">
              <summary>Introduction to {book}</summary>
              <div className="commentary-text">
                <Paragraphs text={data.book_introduction} onJump={onJump} />
              </div>
            </details>
          )}
          {data.chapter_introduction && (
            <details className="apparatus-key" open>
              <summary>Chapter {chapter} overview</summary>
              <div className="commentary-text">
                <Paragraphs text={data.chapter_introduction} onJump={onJump} />
              </div>
            </details>
          )}
          {data.sections.length === 0 && <p className="muted">This commentary has no notes on {book} {chapter}.</p>}
          {data.sections.map((s, i) => (
            <section
              key={s.id}
              className={"commentary-section" + (s.verse_start === activeStart ? " active" : "")}
              ref={(el) => {
                sectionRefs.current[s.verse_start] = el;
              }}
            >
              <h4 className="commentary-heading">
                <button className="link-btn" onClick={() => onJump(book, chapter, s.verse_start)} title="Read this passage">
                  {rangeLabel(s.verse_start, data.sections[i + 1]?.verse_start, verseCount)}
                </button>
                <span className="item-tools">
                  <ListenButton title="Read this commentary note aloud" text={s.text} />
                  <BasketButton
                    add={() => {
                      const range = rangeLabel(s.verse_start, data.sections[i + 1]?.verse_start, verseCount).replace(/^Verses? /, "");
                      const body = plainText(s.text).split(/\n+/).map((p) => p.trim()).filter(Boolean).join("\n\n");
                      return addToBasket("commentary", `${current?.name ?? "Commentary"} on ${book} ${chapter}:${range}`, body);
                    }}
                  />
                  <CopyButton
                    title="Copy this commentary note"
                    text={() => {
                      const range = rangeLabel(s.verse_start, data.sections[i + 1]?.verse_start, verseCount).replace(/^Verses? /, "");
                      const body = plainText(s.text).split(/\n+/).map((p) => p.trim()).filter(Boolean).join("\n\n");
                      return `${book} ${chapter}:${range} — ${current?.name ?? "Commentary"}\n\n${body}`;
                    }}
                  />
                </span>
              </h4>
              <div className="commentary-text">
                <Paragraphs text={s.text} onJump={onJump} />
              </div>
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}
