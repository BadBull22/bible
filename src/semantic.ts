// Search by meaning: the words of the Bible grouped by what they mean (love, forgiveness, joy...), Hebrew and Greek, from the UBS open-licence
// dictionaries (UBS Dictionary of Biblical Hebrew; UBS Dictionary of the Greek New Testament, adapted from Louw and Nida), kept in
// resources/semantic_domains.json by scripts/build_semantic_domains.mts. This file holds the pure pieces both sides use: the shape of the data,
// the packing of verse lists, cleaning the dictionaries' markup, and the wording shown to the reader. Tested under Node (scripts/test_semantic.mts).

export const SEMANTIC_CREDIT =
  "Meanings and groups of meaning: UBS Dictionary of Biblical Hebrew (adapted from the Semantic Dictionary of Biblical Hebrew, © United Bible Societies 2000-2023) and UBS Dictionary of the Greek New Testament (adapted from the Semantic Dictionary of Biblical Greek, © United Bible Societies 2018-2023, which is adapted from Louw and Nida, Greek-English Lexicon of the New Testament: Based on Semantic Domains, © United Bible Societies 1988, 1989). Licensed under Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0). The data here is trimmed and repacked; it is shared under the same licence.";

export const SEMANTIC_LICENCE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";

export interface SemanticMeaning {
  /** the most specific domain code(s) this meaning belongs to ("025007"; "001001003001" in Hebrew): groups of three digits, one for each level */
  d: string[];
  /** the dictionary's glosses ("love", "to love") */
  g: string[];
  /** a short definition */
  t: string;
  /** the Louw-Nida number of a Greek meaning ("25.43") */
  c?: string;
  /** the verses where this meaning is used, sorted, as a first number and then the steps between (see packVerses) */
  v: number[];
}

export interface SemanticEntry {
  /** the Strong's numbers of the word ("G26", "H157"), without leading zeros */
  s: string[];
  /** the word as written in the original language */
  l: string;
  m: SemanticMeaning[];
}

export interface SemanticLanguage {
  /** [code, name] for every group of meanings; a code's parent is the code with its last three digits taken off */
  domains: [string, string][];
  entries: SemanticEntry[];
}

export interface SemanticFile {
  format: 1;
  credit: string;
  licence: string;
  licence_url: string;
  source: string;
  greek: SemanticLanguage;
  hebrew: SemanticLanguage;
}

/** A verse as one number: book (1 to 66), chapter and verse. */
export const verseKey = (book: number, chapter: number, verse: number): number => book * 1_000_000 + chapter * 1_000 + verse;
export const unKey = (k: number): { book: number; chapter: number; verse: number } => ({ book: Math.floor(k / 1_000_000), chapter: Math.floor((k % 1_000_000) / 1_000), verse: k % 1_000 });

/** A list of verses as a first number and the steps between the rest (sorted, no repeats): short to write and to compress. */
export function packVerses(keys: number[]): number[] {
  const sorted = [...new Set(keys)].sort((a, b) => a - b);
  return sorted.map((k, i) => (i === 0 ? k : k - sorted[i - 1]));
}

export function unpackVerses(packed: number[]): number[] {
  const out: number[] = [];
  let at = 0;
  for (const [i, n] of packed.entries()) {
    at = i === 0 ? n : at + n;
    out.push(at);
  }
  return out;
}

/** A UBS reference ("04002401200018": book, chapter, verse, then the word) as its verse; null for a reference that is not to a verse. A note's mark after it ("{N:001}") is ignored. */
export function verseOfRef(ref: string): number | null {
  const m = /^(\d{3})(\d{3})(\d{3})(\d{5})/.exec(ref.replace(/\{.*$/, ""));
  if (!m) return null;
  const [book, chapter, verse] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (book < 1 || book > 66 || chapter < 1 || verse < 1) return null;
  return verseKey(book, chapter, verse);
}

/** A Strong's number as the app writes it: letter and digits without leading zeros ("G0026" -> "G26"; "H1697I" -> "H1697"); "" for anything else. */
export function normStrongs(raw: string): string {
  const m = /^\s*([GHgh])\s*0*(\d{1,5})/.exec(raw);
  return m ? `${m[1].toUpperCase()}${Number(m[2])}` : "";
}

/** The dictionaries' text without their markup: {S:...} and {A:...} marks, |i italics, repeated spaces. */
export function cleanText(raw: string, max = 180): string {
  const t = (raw ?? "")
    .replace(/\{[A-Z]:[^}]*\}/g, "")
    .replace(/\|[a-z]\*?/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:)])/g, "$1")
    .trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 30)).replace(/[,;:\s]+$/, "") + "…";
}

/** The code one level up ("025007" -> "025"; a top-level code has none). */
export const parentCode = (code: string): string => (code.length > 3 ? code.slice(0, -3) : "");
export const levelOf = (code: string): number => Math.max(1, Math.round(code.length / 3));

/** Is `code` this group or inside it? */
export const inDomain = (code: string, domain: string): boolean => code === domain || code.startsWith(domain);

/** "Attitudes and Emotions > Love, Affection, Compassion": the names of a group and the groups above it. */
export function domainPath(code: string, names: Map<string, string>): string {
  const out: string[] = [];
  for (let c = code; c; c = parentCode(c)) out.unshift(names.get(c) ?? c);
  return out.join(" > ");
}

/** The sentence over the books of a meaning search: "Meaning: Love, Affection, Compassion (Greek): 52 words, 1,036 verses." */
export function meaningSummary(name: string, language: "greek" | "hebrew", words: number, verses: number): string {
  const lang = language === "greek" ? "Greek" : "Hebrew";
  return `${name} (${lang}): ${words.toLocaleString("en-US")} word${words === 1 ? "" : "s"}, ${verses.toLocaleString("en-US")} verse${verses === 1 ? "" : "s"}.`;
}

/** A group of meanings in the tree the app shows, with the number of words and verses inside it (from the app, see src-tauri/src/semantic.rs). */
export interface DomainNode {
  code: string;
  name: string;
  level: number;
  words: number;
  verses: number;
}

/** The groups directly under a group (the top ones for ""), in order. */
export const childrenOf = (nodes: DomainNode[], code: string): DomainNode[] => nodes.filter((n) => parentCode(n.code) === code).sort((a, b) => a.code.localeCompare(b.code));

/** The group and the ones above it, top first. */
export function breadcrumb(nodes: DomainNode[], code: string): DomainNode[] {
  const by = new Map(nodes.map((n) => [n.code, n]));
  const out: DomainNode[] = [];
  for (let c = code; c; c = parentCode(c)) {
    const n = by.get(c);
    if (n) out.unshift(n);
  }
  return out;
}

/** Groups whose name has every word typed ("love", "forgive", "to be afraid"), the ones with the most verses first. */
export function searchDomains(nodes: DomainNode[], query: string, limit = 40): DomainNode[] {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return [];
  return nodes
    .filter((n) => {
      const name = n.name.toLowerCase();
      return words.every((w) => name.includes(w));
    })
    .sort((a, b) => b.verses - a.verses || a.code.localeCompare(b.code))
    .slice(0, limit);
}

/** The sentence over the books of a Strong's number search: "G26 is used 116 times in 105 verses." */
export function strongsSummary(strongs: string, occurrences: number, verses: number): string {
  if (occurrences === 0) return `${strongs} is not used in the text of the original languages here.`;
  return `${strongs} is used ${occurrences.toLocaleString("en-US")} time${occurrences === 1 ? "" : "s"} in ${verses.toLocaleString("en-US")} verse${verses === 1 ? "" : "s"}.`;
}

/** Is what was typed a Strong's number (G26, h0157)? The number in the app's own form, or "". */
export const asStrongs = (text: string): string => (/^\s*[GgHh]\s*0*\d{1,5}\s*$/.test(text) ? normStrongs(text.replace(/\s+/g, "")) : "");

// ---- drawing the senses of a word and the tree of a group (the Meaning screens; the pictures are drawn in components/SensePanel.tsx and MeaningTree.tsx)

/** The colour of the n-th of `total` senses in the wheel and its list: evenly spaced hues, the same in the wheel and beside it. */
export const senseColour = (i: number, total: number): string => `hsl(${(Math.round((i * 360) / Math.max(total, 1)) + 8) % 360} 62% 56%)`;

/** The order senses are listed in: the most verses first (the dictionary's own order breaks a tie). */
export function senseOrder(verses: number[]): number[] {
  return verses.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(([, i]) => i);
}

export interface Arc {
  /** index into the senses, in the order given */
  index: number;
  /** radians, 0 at the top, clockwise */
  from: number;
  to: number;
}

/** The slices of the ring: each sense gets the share of the circle its verses are of all the verses; a small gap keeps neighbours apart. */
export function senseArcs(verses: number[], gap = 0.012): Arc[] {
  const total = verses.reduce((n, v) => n + v, 0);
  if (total <= 0) return [];
  const many = verses.length > 1;
  let at = 0;
  return verses.map((v, index) => {
    const span = (v / total) * Math.PI * 2;
    const from = at + (many ? gap / 2 : 0);
    const to = Math.max(at + span - (many ? gap / 2 : 0), from + 0.015);
    at += span;
    return { index, from, to: Math.min(to, Math.PI * 2 - 0.0001) };
  });
}

/** The path of a slice of a ring (centre cx,cy; inner radius r0, outer r1; angles in radians from the top, clockwise). */
export function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number): [number, number] => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r1, a0);
  const [x1, y1] = p(r1, a1);
  const [x2, y2] = p(r0, a1);
  const [x3, y3] = p(r0, a0);
  const f = (n: number) => Math.round(n * 100) / 100;
  return `M${f(x0)},${f(y0)} A${r1},${r1} 0 ${large} 1 ${f(x1)},${f(y1)} L${f(x2)},${f(y2)} A${r0},${r0} 0 ${large} 0 ${f(x3)},${f(y3)} Z`;
}

/** One column of the tree: the groups that share a parent, with the one on the way to the chosen group marked. A level with very many groups shows only the group on the path. */
export interface TreeColumn {
  parent: string;
  selected: string;
  nodes: DomainNode[];
  /** how many other groups the column leaves out */
  others: number;
}

export function treeColumns(all: DomainNode[], code: string, collapseOver = 20): TreeColumn[] {
  const out: TreeColumn[] = [];
  for (let len = 3; len <= code.length; len += 3) {
    const parent = code.slice(0, len - 3);
    const selected = code.slice(0, len);
    const kids = all.filter((n) => n.code.length === len && n.code.startsWith(parent)).sort((a, b) => a.code.localeCompare(b.code));
    const here = kids.find((n) => n.code === selected);
    const last = len === code.length;
    if (kids.length > collapseOver && !last && here) out.push({ parent, selected, nodes: [here], others: kids.length - 1 });
    else out.push({ parent, selected, nodes: kids, others: 0 });
  }
  return out;
}

/** The height of a bar in the book strip: nothing for 0, at least a few pixels for anything, the tallest for the most. */
export const barHeight = (n: number, max: number, full: number): number => (n <= 0 || max <= 0 ? 0 : Math.max(3, (n / max) * full));

/** The English word a search was for, cleaned for the lookup of the Hebrew and Greek words behind it: one lower-case word or a short phrase; "" when there is nothing to look up. */
export function wordToLookUp(text: string): string {
  const t = text.trim().toLowerCase().replace(/[^\p{L}' ]/gu, "").replace(/\s+/g, " ");
  return t.length > 0 && t.length <= 40 ? t : "";
}
