// Red-letter text: which words of a verse are the words of Jesus. The data is built by
// data-pipeline/build_red_letter.py as inclusive [first, last] *word* ranges per verse
// (words = maximal runs of letters/digits, counted on the displayed text), and loaded
// lazily as its own chunk the first time a chapter needs it.
import { VerseSegment } from "./verseSegments";

type RedLetterData = Record<string, Record<string, Record<string, Record<string, [number, number][]>>>>;

let cache: Promise<RedLetterData> | null = null;

export function loadRedLetter(): Promise<RedLetterData> {
  cache ??= import("./redLetter.json").then((m) => m.default as unknown as RedLetterData).catch(() => ({}));
  return cache;
}

/** Word ranges for each verse of a chapter in a translation (empty if none are His words). */
export function chapterRedLetter(data: RedLetterData, version: string, book: string, chapter: number): Record<string, [number, number][]> {
  return data[version]?.[book]?.[String(chapter)] ?? {};
}

export interface SegmentPart {
  text: string;
  red: boolean;
}

const WORD = /[\p{L}\p{N}]+/gu;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const SPACE = /\s/;

/** Character ranges of the red words in `text`, widened over the punctuation and
 * quotation marks touching them (so “…yourself.” is red including the stop). */
function redCharRanges(text: string, ranges: [number, number][]): [number, number][] {
  const words = [...text.matchAll(WORD)].map((m) => [m.index!, m.index! + m[0].length] as const);
  const out: [number, number][] = [];
  for (const [a, b] of ranges) {
    if (!words[a] || !words[Math.min(b, words.length - 1)]) continue;
    let s = words[a][0];
    let e = words[Math.min(b, words.length - 1)][1];
    while (s > 0 && !SPACE.test(text[s - 1]) && !WORD_CHAR.test(text[s - 1])) s--;
    while (e < text.length && !SPACE.test(text[e]) && !WORD_CHAR.test(text[e])) e++;
    out.push([s, e]);
  }
  return out;
}

/** Splits each segment's text into red / not-red parts. Segments stay whole (a clickable
 * Strong's word keeps one click target even if the red boundary falls inside it). */
export function splitRed(segments: VerseSegment[], ranges: [number, number][] | undefined): SegmentPart[][] {
  if (!ranges || ranges.length === 0) return segments.map((s) => [{ text: s.text, red: false }]);
  const full = segments.map((s) => s.text).join("");
  const red = redCharRanges(full, ranges);
  const isRed = (i: number) => red.some(([s, e]) => i >= s && i < e);
  let pos = 0;
  return segments.map((seg) => {
    const parts: SegmentPart[] = [];
    for (let i = 0; i < seg.text.length; i++) {
      const r = isRed(pos + i);
      const last = parts[parts.length - 1];
      if (last && last.red === r) last.text += seg.text[i];
      else parts.push({ text: seg.text[i], red: r });
    }
    pos += seg.text.length;
    return parts;
  });
}
