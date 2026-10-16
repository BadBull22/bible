import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, LibraryMention, LibraryMentions as Found, SpurgeonSermon } from "../api";
import { longDate, mentionTitle, spurgeonText } from "../sermon";

interface Props {
  book: string;
  chapter: number;
  verse: number;
  /** opens the place in the book, dictionary or commentary it comes from */
  onOpen: (m: LibraryMention) => void;
}

const KIND: Record<string, string> = { book: "Book", devotional: "Devotional", dictionary: "Dictionary", commentary: "Commentary" };

/** For a verse: the places in the books, dictionaries, devotionals and commentaries the
 * reader has downloaded that refer to it. Nothing is shown when there are none. */
export function LibraryMentionsSection({ book, chapter, verse, onOpen }: Props) {
  const [found, setFound] = useState<Found | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let live = true;
    setFound(null);
    setAll(false);
    api
      .libraryMentions(book, chapter, verse, verse, 6, 80)
      .then((f) => live && setFound(f))
      .catch(() => live && setFound({ hits: [], total: 0 }));
    return () => {
      live = false;
    };
  }, [book, chapter, verse]);

  if (!found || found.hits.length === 0) return null;
  const shown = all ? found.hits : found.hits.slice(0, 6);
  return (
    <details className="apoc-section lib-mentions" open>
      <summary>
        In your Library <span className="tab-count">{found.total}</span>
      </summary>
      <p className="search-hint">Where the books, dictionaries, devotionals and commentaries you've downloaded refer to this verse.</p>
      <ul className="xref-list">
        {shown.map((m) => (
          <li key={`${m.module}:${m.kind}:${m.id}`}>
            <div className="xref-item-head">
              <button className="link-btn" onClick={() => onOpen(m)} title="Open it there">
                {mentionTitle(m)}
              </button>
              <span className="muted">
                {KIND[m.kind] ?? m.kind} · {m.module_title}
              </span>
            </div>
            <span className="snippet">{m.snippet}</span>
          </li>
        ))}
      </ul>
      {found.hits.length > shown.length && (
        <button className="text-btn" onClick={() => setAll(true)}>
          Show all {found.hits.length}
        </button>
      )}
      {found.total > found.hits.length && all && <p className="search-hint">The first {found.hits.length} of {found.total}, a few from each book.</p>}
    </details>
  );
}

/** For a verse: C. H. Spurgeon's sermons on it, each with how it began and a link to read it
 * in full at CCEL. Nothing is shown when he never took it as a text. */
export function SpurgeonSection({ book, chapter, verse }: { book: string; chapter: number; verse: number }) {
  const [sermons, setSermons] = useState<SpurgeonSermon[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setSermons([]);
    api
      .spurgeonSermonsOn(book, chapter, verse, verse)
      .then((s) => live && setSermons(s))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [book, chapter, verse]);

  if (sermons.length === 0) return null;
  return (
    <details className="apoc-section lib-mentions" open>
      <summary>
        Spurgeon preached on this <span className="tab-count">{sermons.length}</span>
      </summary>
      <ul className="xref-list">
        {sermons.map((s) => (
          <li key={s.n}>
            <div className="xref-item-head">
              <button className="link-btn" onClick={() => setOpen(open === s.n ? null : s.n)} aria-expanded={open === s.n}>
                No. {s.n}: {s.title}
              </button>
              <span className="muted">
                {spurgeonText(s)}
                {s.date ? ` · ${longDate(s.date)}` : ""}
              </span>
            </div>
            {open === s.n && (
              <>
                <span className="snippet">{s.opening}</span>
                <button className="text-btn" onClick={() => openUrl(s.url).catch(() => undefined)} title={s.url}>
                  Read the sermon at CCEL (online)
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
