import { useEffect, useState } from "react";
import { api, ApocryphaRef, BookInfo } from "../api";

interface Props {
  book: string;
  chapter: number;
  verse: number;
  /** the translation being read (its Apocrypha text is preferred, if it has them) */
  versionCode: string;
  /** the books that can be opened right now (the Apocrypha only with a Bible that has them) */
  books: BookInfo[];
  onJump: (book: string, chapter: number, verse: number) => void;
  /** open a passage in another installed Bible (one that has the Apocrypha) */
  onOpenIn: (version: string, book: string, chapter: number, verse: number) => void;
}

function label(r: ApocryphaRef) {
  if (r.verse == null) return `${r.book} ${r.chapter}`;
  return `${r.book} ${r.chapter}:${r.verse}${r.verse_end ? `–${r.verse_end}` : ""}`;
}

/** What these links are, and what they are not. Shown wherever they appear. */
function Caution() {
  return (
    <div className="apoc-caution">
      <strong>The Apocrypha are outside the canon of Scripture.</strong>
      <p>
        Tobit, Judith, Wisdom, Sirach, Baruch, Maccabees and the other books here are not among the 66 books of the Bible and are
        not treated as Scripture in this app. They are shown for history and background only.
      </p>
      <p>
        These links are the reference notes that the editors of older printed Bibles placed beside these books. A link marks
        where an editor saw a parallel, an echo of the Old Testament, or background to a New Testament passage. It does not mean
        the Bible quotes the Apocrypha as Scripture, or that the two passages teach the same thing.
      </p>
    </div>
  );
}

function RefList({ refs, books, onJump, onOpenIn }: { refs: ApocryphaRef[]; books: BookInfo[]; onJump: Props["onJump"]; onOpenIn: Props["onOpenIn"] }) {
  return (
    <ul className="xref-list apoc-list">
      {refs.map((r) => {
        const canOpen = books.some((b) => b.name === r.book);
        return (
          <li key={label(r)} className={r.apocrypha ? "apoc-item" : undefined}>
            <div className="xref-item-head">
              {canOpen ? (
                <button className="link-btn" onClick={() => onJump(r.book, r.chapter, r.verse ?? 1)}>
                  {label(r)}
                </button>
              ) : r.version ? (
                <button
                  className="link-btn"
                  onClick={() => onOpenIn(r.version, r.book, r.chapter, r.verse ?? 1)}
                  title={`The Bible you're reading doesn't have this book. This opens it in ${r.version}.`}
                >
                  {label(r)} <span className="muted">(opens in {r.version})</span>
                </button>
              ) : (
                <span className="apoc-closed" title="Install a Bible that includes the Apocrypha (such as the KJVA from the Library) to read this passage">
                  {label(r)}
                </span>
              )}
              <span className={"apoc-badge" + (r.apocrypha ? " outside" : "")}>{r.apocrypha ? "Apocrypha · not Scripture" : "Scripture"}</span>
            </div>
            {r.text && (
              <span className="snippet">
                {r.text} <span className="muted">({r.version})</span>
              </span>
            )}
            <span className="apoc-source muted">
              {r.direction === "in" ? "A note at that passage points here" : "Noted here"} in: {r.sources.join("; ")}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function useRefs({ book, chapter, verse, versionCode }: Pick<Props, "book" | "chapter" | "verse" | "versionCode">) {
  const [refs, setRefs] = useState<ApocryphaRef[] | null>(null);
  useEffect(() => {
    let stale = false;
    setRefs(null);
    api
      .apocryphaXrefs(book, chapter, verse, versionCode)
      .then((r) => !stale && setRefs(r))
      .catch(() => !stale && setRefs([]));
    return () => {
      stale = true;
    };
  }, [book, chapter, verse, versionCode]);
  return refs;
}

const NUMBERING_NOTE =
  "Verse numbers follow the Bibles these notes come from, which number a few Apocrypha chapters (Sirach especially) a little differently from the King James Apocrypha, so a link can land a verse or two away.";

/** For a verse in the 66 books: the passages in the Apocrypha that older Bibles' notes
 * connect with it, in their own clearly marked box. Nothing is shown when there are none. */
export function ApocryphaRefsSection(props: Props) {
  const refs = useRefs(props);
  const outside = refs?.filter((r) => r.apocrypha) ?? [];
  if (outside.length === 0) return null;
  return (
    <details className="apoc-section" open>
      <summary>
        Related passages in the Apocrypha <span className="apoc-badge outside">not Scripture</span>{" "}
        <span className="tab-count">{outside.length}</span>
      </summary>
      <Caution />
      <RefList refs={outside} books={props.books} onJump={props.onJump} onOpenIn={props.onOpenIn} />
      <p className="search-hint">{NUMBERING_NOTE}</p>
    </details>
  );
}

/** For a verse in the Apocrypha: its cross-references listed under the graph, the 66
 * books first. */
export function ApocryphaRefsBody(props: Props) {
  const refs = useRefs(props);
  const scripture = refs?.filter((r) => !r.apocrypha) ?? [];
  const outside = refs?.filter((r) => r.apocrypha) ?? [];
  return (
    <>
      <Caution />
      {refs === null && <p className="muted">Loading…</p>}
      {refs !== null && refs.length === 0 && (
        <p className="muted">
          None of the Bibles these notes come from has a reference note on this verse. Other verses in the chapter may have them.
        </p>
      )}
      {scripture.length > 0 && (
        <>
          <h4 className="section-label">In the Bible (the 66 books)</h4>
          <RefList refs={scripture} books={props.books} onJump={props.onJump} onOpenIn={props.onOpenIn} />
        </>
      )}
      {outside.length > 0 && (
        <>
          <h4 className="section-label">Elsewhere in the Apocrypha</h4>
          <RefList refs={outside} books={props.books} onJump={props.onJump} onOpenIn={props.onOpenIn} />
        </>
      )}
      <p className="search-hint">
        From the reference notes of the Swedish Bible of 1917, the World English Bible (whose Apocrypha notes follow the Revised
        Version of 1895) and the Menge-Bibel (1939), all in the public domain. {NUMBERING_NOTE}
      </p>
    </>
  );
}
