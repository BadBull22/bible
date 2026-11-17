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
