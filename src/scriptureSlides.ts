// Scripture on slides and in Preach: the stored text tidied, split into its verses, and put
// a few verses to a slide. Kept free of imports so scripts/test_sermon_layout.mts can load it
// in Node directly.

/** The stored BSB text has a space inside some quotation marks ("“ Rabbi", "again. ”"):
 * closed up wherever a passage is shown on its own (slides, Preach). */
export const tidyQuotes = (s: string) => s.replace(/([“‘])\s+/g, "$1").replace(/\s+([”])/g, "$1");

/** A verse of a passage as gathered ("16 For God so loved…"). */
export interface VerseText {
  n: number | null;
  text: string;
}

/** Splits a gathered passage into its verses, by the verse numbers in it -- only numbers that
 * come in order from the first verse count, so "the 12 tribes" stays in its verse. Text with
 * no verse numbers is one piece. */
export function versesOf(text: string, first: number | null): VerseText[] {
  const found: { at: number; len: number; n: number }[] = [];
  const re = /(^|\s)(\d{1,3})\s/g;
  let expect = first;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = Number(m[2]);
    const at = m.index + m[1].length;
    if (expect == null ? at === 0 : n === expect) {
      found.push({ at, len: m[2].length + 1, n });
      expect = n + 1;
    }
    re.lastIndex = at + m[2].length;
  }
  if (found.length === 0) return [{ n: null, text: text.trim() }];
  const out: VerseText[] = [];
  if (found[0].at > 0 && text.slice(0, found[0].at).trim()) out.push({ n: null, text: text.slice(0, found[0].at).trim() });
  found.forEach((f, i) => out.push({ n: f.n, text: text.slice(f.at + f.len, i + 1 < found.length ? found[i + 1].at : text.length).trim() }));
  return out.filter((v) => v.text);
}

/** A passage in slide-sized pieces: whole verses, at most four and about 280 characters a
 * slide; a single verse longer than that is split at a sentence. Each piece knows its
 * first and last verse, for the slide's reference. */
export function scriptureSlides(text: string, first: number | null, numbers: boolean): { text: string; from: number | null; to: number | null }[] {
  const LIMIT = 280;
  const verses = versesOf(text, first).flatMap((v) => {
    if (v.text.length <= LIMIT + 80) return [v];
    // a long verse: at sentences (or spaces) near the limit
    const parts: VerseText[] = [];
    let rest = v.text;
    while (rest.length > LIMIT + 80) {
      let cut = rest.lastIndexOf(". ", LIMIT);
      if (cut < LIMIT / 2) cut = rest.lastIndexOf(" ", LIMIT);
      if (cut <= 0) break;
      parts.push({ n: parts.length ? null : v.n, text: rest.slice(0, cut + 1).trim() });
      rest = rest.slice(cut + 1).trim();
    }
    parts.push({ n: parts.length ? null : v.n, text: rest });
    return parts.map((p, i) => ({ ...p, part: i > 0 ? v.n : undefined }));
  });
  const out: { text: string; from: number | null; to: number | null }[] = [];
  let cur: (VerseText & { part?: number | null })[] = [];
  const flush = () => {
    if (!cur.length) return;
    const nums = cur.map((v) => v.n ?? (v as { part?: number | null }).part ?? null).filter((n): n is number => n != null);
    out.push({
      text: cur.map((v) => (numbers && v.n != null ? `${v.n} ${v.text}` : v.text)).join(" "),
      from: nums.length ? Math.min(...nums) : null,
      to: nums.length ? Math.max(...nums) : null,
    });
    cur = [];
  };
  for (const v of verses) {
    const size = cur.reduce((n, c) => n + c.text.length + 1, 0);
    if (cur.length && (cur.length >= 4 || size + v.text.length > LIMIT)) flush();
    cur.push(v);
  }
  flush();
  return out;
}
