import { StrongsWord } from "./api";

export interface VerseSegment {
  text: string;
  /** The Strong's-tagged word this segment renders, or null for untagged text
   * (punctuation, quotation marks, and words the tagging skipped). */
  word: StrongsWord | null;
}

const LETTER = /\p{L}/u;
const isLetter = (ch: string | undefined) => ch !== undefined && LETTER.test(ch);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches a token's words in order, tolerating punctuation/whitespace between them
 * (the tagging data strips punctuation, so the token "said Let" must match the text
 * "said, “Let"). Callers verify word boundaries around each match separately. */
function tokenPattern(surface: string): RegExp | null {
  const parts = surface.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return new RegExp(parts.map(escapeRe).join("[^\\p{L}\\p{N}]*"), "gu");
}

/** The pipeline's OSIS extraction joined tokens with spaces, leaving artefacts like
 * `“ Let there be light,”` in the stored text. Display-only cleanup: no space after an
 * opening quote/bracket, none before a closing quote or sentence punctuation. */
export function tidyPunctuation(text: string): string {
  return text
    .replace(/([“‘(\[]) +/g, "$1")
    .replace(/ +([”’)\]])/g, "$1")
    .replace(/ +([,.;:!?])/g, "$1");
}

/**
 * Reconciles a verse's Strong's word tokens with its full text so the reader can
 * show the real text (punctuation, quotation marks, untagged words) while keeping
 * each tagged word clickable.
 *
 * The tagging data only carries the tagged words themselves -- no punctuation, and
 * for some translations not even every word -- and its tokens can sit out of order
 * relative to the English (they follow the original-language word order). Each token
 * is therefore located in the text by a boundary-checked, forward-first search that
 * falls back to the earliest unclaimed occurrence; text between placed tokens is
 * emitted verbatim as untagged segments. Empty tokens (untranslated particles such
 * as Hebrew את, H853) have nothing to render and are skipped.
 */
export function segmentVerse(rawText: string, words: StrongsWord[]): VerseSegment[] {
  const text = tidyPunctuation(rawText);
  const claimed = new Uint8Array(text.length);
  const placed: { start: number; end: number; word: StrongsWord }[] = [];
  let cursor = 0;

  for (const w of words) {
    const re = tokenPattern(w.surface_text);
    if (!re) continue;
    let found: [number, number] | null = null;
    for (const from of cursor > 0 ? [cursor, 0] : [0]) {
      re.lastIndex = from;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const s = m.index;
        const e = s + m[0].length;
        if (e === s) {
          re.lastIndex++;
          continue;
        }
        const free = !isLetter(text[s - 1]) && !isLetter(text[e]) && !claimed.subarray(s, e).some((c) => c === 1);
        if (free) {
          found = [s, e];
          break;
        }
      }
      if (found) break;
    }
    if (!found) continue;
    claimed.fill(1, found[0], found[1]);
    placed.push({ start: found[0], end: found[1], word: w });
    if (found[0] >= cursor) cursor = found[1];
  }

  placed.sort((a, b) => a.start - b.start);
  const out: VerseSegment[] = [];
  let pos = 0;
  for (const p of placed) {
    if (p.start > pos) out.push({ text: text.slice(pos, p.start), word: null });
    out.push({ text: text.slice(p.start, p.end), word: p.word });
    pos = p.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), word: null });
  return out;
}
