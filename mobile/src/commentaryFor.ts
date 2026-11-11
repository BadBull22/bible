// What the installed commentaries say on ONE verse (the verse sheet's "Commentaries" button). The library keeps each commentary's notes on a chapter as
// (first verse, text) pairs, in order, and a note speaks on its verse and on the verses after it up to the next note's first verse (verse 0 = the whole
// chapter). So for verse 16 the note is the one that starts at the last first-verse at or before 16, together with any other paragraphs that start at that
// same verse. Pure, so a node test can check it (mobile/scripts/test_commentary_for.mts).

import type { CommentaryOn } from "./api";

export interface VerseCommentary {
  module: string;
  title: string;
  /** the verse the note begins at (the same as the verse asked for when the commentary has a note exactly there) */
  from: number;
  /** the note's paragraphs, in order */
  texts: string[];
}

/** The commentaries that have a note on `verse`, in the order given, and how many of the others have notes on the chapter only as a whole or further on. */
export function commentariesOnVerse(all: CommentaryOn[], verse: number): { here: VerseCommentary[]; others: number } {
  const here: VerseCommentary[] = [];
  for (const c of all) {
    let from = 0;
    for (const [start] of c.notes) if (start >= 1 && start <= verse && start > from) from = start;
    if (from === 0) continue;
    here.push({ module: c.module, title: c.title, from, texts: c.notes.filter(([start]) => start === from).map(([, text]) => text) });
  }
  return { here, others: all.length - here.length };
}
