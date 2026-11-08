import { useMemo } from "react";
import { parseRef } from "../browse/browseLogic";
import { findBrowse, topic } from "../browse/data";
import type { BrowseKind } from "../browse/types";

const KIND_LABEL: Record<BrowseKind, string> = { stories: "Bible story: ", topics: "", children: "For children: " };

/** how many of a subject's passages are listed in the results themselves (the rest are one click away) */
const SHOWN = 3;

/**
 * Under a search: the Browse pages (stories, "Verses for…", children's pages) that are about what was typed, and, for the best matching subject, its
 * first passages with what each one says, so the verses are in the results themselves. Nothing is shown when no page matches.
 */
export function BrowseMatches({ query, onOpen, onJump }: { query: string; onOpen: (kind: BrowseKind, id: string) => void; onJump?: (book: string, chapter: number, verse: number) => void }) {
  const found = useMemo(() => findBrowse(query, 4), [query]);
  if (found.length === 0) return null;
  // the first subject found, if any: its verses are listed (a subject on which Christians differ lists none, only its page, which carries the neutral box)
  const subject = found.find((e) => e.kind === "topics");
  const page = subject ? topic(subject.id) : undefined;
  const listed = page && page.doctrine !== "needs_review" ? page.items.slice(0, SHOWN) : [];
  return (
    <div className="browse-matches" role="group" aria-label="Stories and topics">
      <span className="browse-matches-label">Stories and topics</span>
      {found.map((e) => (
        <button key={e.kind + e.id} className="pill-btn small quiet" onClick={() => onOpen(e.kind, e.id)}>
          {KIND_LABEL[e.kind]}{e.title}
        </button>
      ))}
      {page && listed.length > 0 && onJump && (
        <div className="browse-topic-card">
          <strong>{page.title}</strong>
          <ul>
            {listed.map((i) => {
              const r = parseRef(i.ref);
              return (
                <li key={i.ref}>
                  <button className="link-btn" disabled={!r} onClick={() => r && onJump(r.book, r.chapter, r.verse)}>
                    {i.ref}
                  </button>{" "}
                  <span className="snippet">{i.note}</span>
                </li>
              );
            })}
          </ul>
          <button className="pill-btn small quiet" onClick={() => onOpen("topics", page.id)}>
            All {page.items.length} passages
          </button>
        </div>
      )}
    </div>
  );
}
