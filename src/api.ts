import { invoke } from "@tauri-apps/api/core";

export interface Version {
  code: string;
  name: string;
  language: string;
  is_original_language: boolean;
}

export interface BookInfo {
  name: string;
  testament: string;
  order_index: number;
}

export interface Verse {
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

export interface StrongsWord {
  word_order: number;
  surface_text: string;
  strongs_numbers: string[];
}

export interface VerseWithWords extends Verse {
  words: StrongsWord[];
}

export interface StrongsEntry {
  strongs_number: string;
  language: string;
  lemma: string | null;
  xlit: string | null;
  pronunciation: string | null;
  derivation: string | null;
  strongs_def: string | null;
  kjv_def: string | null;
}

export interface SearchHit {
  version_code: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

export interface CrossReference {
  to_book: string;
  to_chapter: number;
  to_verse_start: number;
  to_verse_end: number;
  votes: number;
}

export interface WordFrequencyResult {
  total_occurrences: number;
  verses: SearchHit[];
}

export interface AppSettings {
  api_bible_key: string | null;
}

export interface OnlineVersionInfo {
  code: string;
  name: string;
  configured: boolean;
}

export interface OnlineVerseResult {
  version_code: string;
  book: string;
  chapter: number;
  verse: number;
  text: string;
  copyright: string;
}

export interface PersonSummary {
  id: string;
  name: string;
}

export interface LineagePerson {
  id: string;
  name: string;
  alt_names: string[];
  citation: string;
  note: string | null;
}

export type FirstsCategory = "firsts" | "facts" | "promises" | "warfare";

export interface FirstsEntry {
  id: string;
  category: FirstsCategory;
  question: string;
  answer: string;
  citations: string[];
  note: string | null;
}

export const api = {
  listVersions: () => invoke<Version[]>("list_versions"),
  listBooks: () => invoke<BookInfo[]>("list_books"),
  chapterCounts: () => invoke<[string, number][]>("chapter_counts"),
  getChapter: (version_code: string, book: string, chapter: number) =>
    invoke<Verse[]>("get_chapter", { versionCode: version_code, book, chapter }),
  getChapterWithStrongs: (version_code: string, book: string, chapter: number) =>
    invoke<VerseWithWords[]>("get_chapter_with_strongs", { versionCode: version_code, book, chapter }),
  getParallelVerse: (book: string, chapter: number, verse: number, version_codes: string[]) =>
    invoke<SearchHit[]>("get_parallel_verse", { book, chapter, verse, versionCodes: version_codes }),
  getVerseWithStrongs: (version_code: string, book: string, chapter: number, verse: number) =>
    invoke<VerseWithWords>("get_verse_with_strongs", { versionCode: version_code, book, chapter, verse }),
  strongsLookup: (strongs_number: string) =>
    invoke<StrongsEntry | null>("strongs_lookup", { strongsNumber: strongs_number }),
  strongsOccurrences: (strongs_number: string, version_code: string) =>
    invoke<SearchHit[]>("strongs_occurrences", { strongsNumber: strongs_number, versionCode: version_code }),
  searchKeyword: (version_code: string, query: string, limit: number) =>
    invoke<SearchHit[]>("search_keyword", { versionCode: version_code, query, limit }),
  semanticSearch: (query: string, limit: number) => invoke<SearchHit[]>("semantic_search", { query, limit }),
  wordFrequency: (version_code: string, word: string) =>
    invoke<WordFrequencyResult>("word_frequency", { versionCode: version_code, word }),
  crossReferencesFor: (book: string, chapter: number, verse: number) =>
    invoke<CrossReference[]>("cross_references_for", { book, chapter, verse }),
  getSettings: () => invoke<AppSettings>("get_settings"),
  saveApiBibleKey: (key: string) => invoke<void>("save_api_bible_key", { key }),
  listOnlineVersions: () => invoke<OnlineVersionInfo[]>("list_online_versions"),
  fetchOnlineVerse: (version_code: string, book: string, chapter: number, verse: number) =>
    invoke<OnlineVerseResult>("fetch_online_verse", { versionCode: version_code, book, chapter, verse }),
  listGenealogyPeople: () => invoke<PersonSummary[]>("list_genealogy_people"),
  getLineage: (person_id: string) => invoke<LineagePerson[]>("get_lineage", { personId: person_id }),
  listFirsts: () => invoke<FirstsEntry[]>("list_firsts"),
  searchFirsts: (query: string) => invoke<FirstsEntry[]>("search_firsts", { query }),
};

/** Parses a citation like "Genesis 4:8" or "Genesis 4:21-22" into book/chapter/verse
 * (the first verse of a range) for jump-to-verse navigation. */
export function parseCitation(citation: string): { book: string; chapter: number; verse: number } | null {
  const m = citation.match(/^(.+?)\s+(\d+):(\d+)/);
  if (!m) return null;
  return { book: m[1], chapter: parseInt(m[2], 10), verse: parseInt(m[3], 10) };
}

export interface ParsedReference {
  book: string;
  chapter: number;
  verse: number | null;
}

/** Interprets free text typed into the search box as a scripture reference, e.g.
 * "John 3:16", "gen 1", "1 sam 17:4", "Rev 21". Book names match case-insensitively
 * on either the full name or an unambiguous prefix. Returns null when the text isn't
 * shaped like a reference or the book can't be identified, in which case the caller
 * should treat it as an ordinary search query. */
export function parseReference(input: string, books: BookInfo[]): ParsedReference | null {
  const m = input.trim().match(/^([1-3]?\s*[a-z][a-z .]*?)\s*(\d+)(?::(\d+))?$/i);
  if (!m) return null;
  const rawBook = m[1].replace(/\s+/g, " ").replace(/\./g, "").trim().toLowerCase();
  if (rawBook.length < 2) return null;

  const norm = (n: string) => n.toLowerCase();
  let match = books.find((b) => norm(b.name) === rawBook);
  if (!match) {
    const candidates = books.filter((b) => norm(b.name).startsWith(rawBook));
    if (candidates.length !== 1) return null;
    match = candidates[0];
  }
  return {
    book: match.name,
    chapter: parseInt(m[2], 10),
    verse: m[3] ? parseInt(m[3], 10) : null,
  };
}
