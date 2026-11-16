// Listen mode: what the phone reads aloud with the screen off. The page cannot do the reading itself (it is paused when the screen goes off), so it hands the phone a
// queue of pieces (a heading "John, chapter 3", then each verse) for several chapters on, and afterwards works out from where the phone got to which chapters were heard to
// the end. Pure, so Node tests it (scripts/test_listen_queue.mts).

export interface Piece {
  /** what is said */
  t: string;
  /** the first piece of a chapter (a "next chapter" button goes here) */
  h: boolean;
  /** what the notification shows: "John 3" */
  l: string;
}

export interface ChapterText {
  book: string;
  chapter: number;
  verses: { verse: number; text: string }[];
}

export interface Queue {
  pieces: Piece[];
  /** for each chapter, the index of its first piece and of the piece after its last */
  spans: { from: number; to: number }[];
}

/** The chapters after this one, in the order of the books (`count` of them, fewer at the end of Revelation). */
export function chaptersFrom(books: { name: string; chapters: number }[], book: string, chapter: number, count: number): { book: string; chapter: number }[] {
  const out: { book: string; chapter: number }[] = [];
  let b = books.findIndex((x) => x.name === book);
  if (b < 0) return out;
  let c = chapter;
  while (out.length < count && b < books.length) {
    if (c <= books[b].chapters) out.push({ book: books[b].name, chapter: c });
    c++;
    if (c > books[b].chapters) {
      b++;
      c = 1;
    }
  }
  return out;
}

/** The pieces for these chapters. The first chapter starts at `startVerse` (its heading is still read). */
export function buildQueue(chapters: ChapterText[], startVerse = 1): Queue {
  const pieces: Piece[] = [];
  const spans: { from: number; to: number }[] = [];
  chapters.forEach((ch, i) => {
    const from = pieces.length;
    const label = `${ch.book} ${ch.chapter}`;
    pieces.push({ t: `${ch.book}, chapter ${ch.chapter}`, h: true, l: label });
    for (const v of ch.verses) {
      if (i === 0 && v.verse < startVerse) continue;
      const t = v.text.replace(/\s+/g, " ").trim();
      if (t) pieces.push({ t, h: false, l: label });
    }
    spans.push({ from, to: pieces.length });
  });
  return { pieces, spans };
}

/** How many chapters (from the first) were heard to the end, given the piece the phone is on and whether it read the whole queue. */
export function chaptersFinished(spans: { from: number; to: number }[], index: number, finished: boolean): number {
  if (finished) return spans.length;
  let n = 0;
  for (const s of spans) {
    if (index >= s.to) n++;
    else break;
  }
  return n;
}
