// Concordance: the small pieces of arithmetic and wording behind the screen (a count for every book, the Old and New Testament totals, how strongly a book's
// tile is shaded, the word marked in a verse). Pure, so it can be tested under Node (scripts/test_concordance.mts).

export interface BookCount {
  book: string;
  /** "OT" or "NT" */
  testament: string;
  order_index: number;
  verses: number;
  occurrences: number;
}

export interface TestamentTotals {
  books: BookCount[];
  occurrences: number;
  verses: number;
}

/** The books split into the Old and the New Testament, each with its total. */
export function byTestament(books: BookCount[]): { ot: TestamentTotals; nt: TestamentTotals } {
  const make = (t: string): TestamentTotals => {
    const list = books.filter((b) => b.testament === t).sort((a, b) => a.order_index - b.order_index);
    return { books: list, occurrences: list.reduce((n, b) => n + b.occurrences, 0), verses: list.reduce((n, b) => n + b.verses, 0) };
  };
  return { ot: make("OT"), nt: make("NT") };
}

/** How strongly to shade a book's tile, 0 to 1: its count against the busiest book (a square root, so a book with a few uses is still seen next to one with hundreds). */
export function heat(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(1, Math.sqrt(count / max));
}

/** "1,234" */
export const thousands = (n: number) => n.toLocaleString("en-US");

const times = (n: number) => `${thousands(n)} time${n === 1 ? "" : "s"}`;
const verses = (n: number) => `${thousands(n)} verse${n === 1 ? "" : "s"}`;

/** The sentence over the book grid: "love appears 310 times in 280 verses in the BSB." */
export function summary(word: string, total: number, versesCount: number, version: string, forms: string[]): string {
  const what = forms.length > 1 ? `“${word}” and its forms` : `“${word}”`;
  if (total === 0) return `${what} does not appear in the ${version}.`;
  return `${what} ${forms.length > 1 ? "appear" : "appears"} ${times(total)} in ${verses(versesCount)} in the ${version}.`;
}

/** The line over a book's verses: "John: 57 times in 52 verses". */
export function bookLine(book: string, occurrences: number, versesCount: number): string {
  return `${book}: ${times(occurrences)} in ${verses(versesCount)}`;
}

export interface Piece {
  text: string;
  hit: boolean;
}

/** A verse cut into pieces, the ones that match the pattern marked (the pattern comes from the app, as a regular expression). */
export function mark(text: string, pattern: string): Piece[] {
  let re: RegExp;
  try {
    re = new RegExp(pattern, "gi");
  } catch {
    return [{ text, hit: false }];
  }
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index === undefined || m[0].length === 0) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out.length ? out : [{ text, hit: false }];
}
