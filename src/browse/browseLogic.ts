// Browse: the pure rules (no JSON, no app code) so that node can test them: reading a reference, finding pages for what the reader types,
// and the tags a list can be narrowed by.

import type { BrowseKind } from "./types";

export interface ParsedRef {
  book: string;
  chapter: number;
  verse: number;
  verseEnd: number;
}

/** "1 Samuel 17:32-40" becomes { book: "1 Samuel", chapter: 17, verse: 32, verseEnd: 40 }; a single verse has verseEnd = verse. */
export function parseRef(ref: string): ParsedRef | null {
  const m = /^(.+?) (\d+):(\d+)(?:-(\d+))?$/.exec(ref.trim());
  if (!m) return null;
  const verse = Number(m[3]);
  const verseEnd = m[4] ? Number(m[4]) : verse;
  if (verseEnd < verse) return null;
  return { book: m[1], chapter: Number(m[2]), verse, verseEnd };
}

/** What a list needs to know about any page, whatever its kind. */
export interface BrowseEntry {
  kind: BrowseKind;
  id: string;
  title: string;
  also: string[];
  tags: string[];
  /** every other word on the page that search may match (summary, intro, notes, retelling) */
  body: string;
  flagged: boolean;
}

const STOP = new Set(["the", "a", "an", "of", "in", "on", "to", "for", "and", "with", "is", "are", "was", "what", "about", "verse", "verses", "story", "stories", "bible", "page", "pages", "kids", "children", "childrens", "who", "whom", "how", "why", "when", "where", "which", "tell", "me", "my", "i", "do", "does", "did", "can", "you", "your", "from", "give", "show", "find", "some", "any", "there", "it", "this", "that", "be", "by", "at", "as", "or", "if", "into", "we", "say", "says", "said", "were", "has", "have", "had", "am", "his", "her", "its", "our", "their", "please", "show", "feel", "feels", "feeling"]);

/** lower-case words, without small joining words, with a plain plural s dropped ("lions" finds "lion"; "Jesus" and "grass" are left alone) */
export function words(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().replace(/[’']/g, "").split(/[^a-z0-9]+/)) {
    if (!raw || STOP.has(raw)) continue;
    out.push(raw.length > 3 && /[^su]s$/.test(raw) ? raw.slice(0, -1) : raw);
  }
  return out;
}

/** The pages that match what the reader typed, best first. Every word typed must be found somewhere on the page; an empty search keeps every page in its own order. */
export function searchEntries<T extends BrowseEntry>(entries: T[], query: string): T[] {
  const need = words(query);
  if (need.length === 0) return entries;
  const scored: { e: T; score: number; order: number }[] = [];
  entries.forEach((e, order) => {
    const title = new Set(words(e.title));
    const also = new Set(e.also.flatMap(words));
    const tags = new Set(e.tags.flatMap(words));
    const body = new Set(words(e.body));
    let score = 0;
    for (const w of need) {
      if (title.has(w)) score += 8;
      else if (also.has(w)) score += 7;
      else if (tags.has(w)) score += 4;
      else if (body.has(w)) score += 1;
      else return; // a word that is nowhere on the page: not a match
    }
    scored.push({ e, score, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((s) => s.e);
}

/** the tags used on these pages, most used first (alphabetical among equals) */
export function tagCounts(entries: BrowseEntry[]): { tag: string; count: number }[] {
  const n = new Map<string, number>();
  for (const e of entries) for (const t of e.tags) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export function withTag<T extends BrowseEntry>(entries: T[], tag: string | null): T[] {
  return tag ? entries.filter((e) => e.tags.includes(tag)) : entries;
}

/** the age bands of the children's pages, in the order they are shown */
export const AGE_BANDS = ["3-5", "6-8", "9-12"] as const;

export function ageLabel(age: string): string {
  return age === "3-5" ? "Ages 3 to 5" : age === "6-8" ? "Ages 6 to 8" : age === "9-12" ? "Ages 9 to 12" : age;
}

/** Flagged pages first (the owner reviews them with most care), then the rest in their own order. */
export function flaggedFirst<T extends BrowseEntry>(entries: T[]): T[] {
  return [...entries.filter((e) => e.flagged), ...entries.filter((e) => !e.flagged)];
}

/**
 * The few pages that a typed search is about, for the offer under the search boxes. It looks only at titles, other names, the hidden search words and
 * subjects (never at the body, which would find far too much), and a page is offered when at least half of the meaningful words typed (and at
 * least one) are found there (half of them when two or more are typed): "I am afraid" finds the page on fear, "Jesus rose from the dead" finds the empty tomb, "joseph and his coat of many
 * colours" finds Joseph. Best first: most words found, then a phrase typed whole. None when the words are too general to point at a page.
 */
export function findNamed<T extends BrowseEntry>(named: T[], query: string, limit = 4, tooMany = 6): T[] {
  const need = words(query);
  if (need.length === 0) return [];
  const must = need.length >= 2 ? Math.ceil(need.length / 2) : 1;
  const typed = need.join(" ");
  const scored: { e: T; found: number; score: number; order: number }[] = [];
  named.forEach((e, order) => {
    const title = new Set(words(e.title));
    const also = new Set(e.also.flatMap(words));
    const tags = new Set(e.tags.flatMap(words));
    let found = 0;
    let score = 0;
    for (const w of need) {
      if (title.has(w)) {
        found++;
        score += 8;
      } else if (also.has(w)) {
        found++;
        score += 7;
      } else if (tags.has(w)) {
        found++;
        score += 4;
      }
    }
    if (found < must) return;
    // a whole name typed (the title, or one of the other names) is the best match; a grown-up page comes before the children's page of the same story
    if (words(e.title).join(" ") === typed || e.also.some((a) => words(a).join(" ") === typed)) score += 20;
    if (e.kind === "children") score -= 2;
    scored.push({ e, found, score, order });
  });
  scored.sort((a, b) => b.found - a.found || b.score - a.score || a.order - b.order);
  if (scored.length === 0) return [];
  // only the best-matching group is offered (the pages that have the most of the typed words); too many in it means the words are too general
  const top = scored.filter((x) => x.found === scored[0].found);
  return top.length > tooMany ? [] : top.slice(0, limit).map((x) => x.e);
}
