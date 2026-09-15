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
  esv_api_key: string | null;
}

export interface OnlineVersionInfo {
  code: string;
  name: string;
  provider: string;
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

export interface DateOverride {
  birthYear: number | null;
  deathYear: number | null;
  reason: string;
}

export interface LineagePerson {
  id: string;
  name: string;
  alt_names: string[];
  citation: string;
  note: string | null;
  theographic_id: string | null;
  age_at_heir_birth: number | null;
  age_citation: string | null;
  lifespan: number | null;
  lifespan_citation: string | null;
  chain_note: string | null;
  date_override: DateOverride | null;
}

/** How a ribbon's years were arrived at. "uncertain" is rendered with Adams' own `?`
 * convention rather than a guessed date. */
export type DateSource = "scripture" | "corrected" | "dataset" | "uncertain";

export interface TimelineRibbon {
  id: string;
  name: string;
  citation: string;
  birth_year: number | null;
  death_year: number | null;
  lifespan: number | null;
  lifespan_citation: string | null;
  age_at_heir_birth: number | null;
  age_citation: string | null;
  date_source: DateSource;
  note: string | null;
  date_note: string | null;
}

export interface TimelineEvent {
  id: string;
  name: string;
  year: number;
  book: string;
  chapter: number;
  verse: number;
}

export interface TimelineData {
  ribbons: TimelineRibbon[];
  events: TimelineEvent[];
}

export type FirstsCategory = "firsts" | "facts" | "promises" | "warfare" | "prophecy";

export interface FirstsEntry {
  id: string;
  category: FirstsCategory;
  question: string;
  answer: string;
  /** For "prophecy" entries this holds the Old Testament reference(s). */
  citations: string[];
  note: string | null;
  /** "prophecy" only: the New Testament reference(s) recording the fulfilment. */
  fulfillment: string[];
  /** "prophecy" only: "His Ancestry" | "His Birth" | "His Life" | "His Death" | "His Reign". */
  section: string | null;
}

export interface CommentaryInfo {
  id: string;
  name: string;
  website: string | null;
  license_name: string | null;
  license_url: string | null;
}

export interface CommentarySection {
  id: number;
  verse_start: number;
  text: string;
}

export interface CommentaryChapter {
  commentary_id: string;
  book: string;
  chapter: number;
  book_introduction: string | null;
  chapter_introduction: string | null;
  sections: CommentarySection[];
}

export interface CommentaryHit {
  commentary_id: string;
  commentary_name: string;
  book: string;
  chapter: number;
  verse_start: number;
  snippet: string;
}

export type EntityKind = "person" | "place" | "event";

export interface EntityRef {
  book: string;
  chapter: number;
  verse: number;
  end_verse: number | null;
}

export interface EntitySummary {
  kind: EntityKind;
  id: string;
  name: string;
  feature_type: string | null;
  start_date: string | null;
  reference_count: number;
  verses: number[];
}

export interface ChapterEntities {
  people: EntitySummary[];
  places: EntitySummary[];
  events: EntitySummary[];
}

export interface EntityLink {
  id: string;
  type: "people" | "places" | "events" | "groups";
  name: string;
}

export interface EntityDetail {
  kind: EntityKind;
  id: string;
  name: string;
  description: string | null;
  gender: string | null;
  birth_year: number | null;
  death_year: number | null;
  feature_type: string | null;
  latitude: number | null;
  longitude: number | null;
  start_date: string | null;
  relations_json: string | null;
  references: EntityRef[];
}

export interface MapPlace {
  id: string;
  name: string;
  feature_type: string | null;
  latitude: number;
  longitude: number;
  reference_count: number;
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
  saveEsvApiKey: (key: string) => invoke<void>("save_esv_api_key", { key }),
  listOnlineVersions: () => invoke<OnlineVersionInfo[]>("list_online_versions"),
  fetchOnlineVerse: (version_code: string, book: string, chapter: number, verse: number) =>
    invoke<OnlineVerseResult>("fetch_online_verse", { versionCode: version_code, book, chapter, verse }),
  listGenealogyPeople: () => invoke<PersonSummary[]>("list_genealogy_people"),
  getLineage: (person_id: string) => invoke<LineagePerson[]>("get_lineage", { personId: person_id }),
  timelineData: () => invoke<TimelineData>("timeline_data"),
  listFirsts: () => invoke<FirstsEntry[]>("list_firsts"),
  searchFirsts: (query: string) => invoke<FirstsEntry[]>("search_firsts", { query }),
  listCommentaries: () => invoke<CommentaryInfo[]>("list_commentaries"),
  getCommentaryChapter: (commentary_id: string, book: string, chapter: number) =>
    invoke<CommentaryChapter>("get_commentary_chapter", { commentaryId: commentary_id, book, chapter }),
  searchCommentaries: (query: string, commentary_id: string | null, limit: number) =>
    invoke<CommentaryHit[]>("search_commentaries", { query, commentaryId: commentary_id, limit }),
  chapterEntities: (book: string, chapter: number) => invoke<ChapterEntities>("chapter_entities", { book, chapter }),
  getEntity: (kind: EntityKind, id: string) => invoke<EntityDetail | null>("get_entity", { kind, id }),
  searchEntities: (query: string, limit: number) => invoke<EntitySummary[]>("search_entities", { query, limit }),
  mapPlaces: () => invoke<MapPlace[]>("map_places"),
  /** Actually quits. The close button is intercepted in Rust so the farewell verse can
   * be shown first; this is what ends the process afterwards. */
  exitApp: () => invoke<void>("exit_app"),
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

/** parseReference() plus chapter-count validation and the "Jude 3" -> Jude 1:3
 * single-chapter-book special case every caller needs. Returns null when the text isn't a
 * valid in-range reference, in which case the caller should treat it as a search query. */
export function resolveReference(input: string, books: BookInfo[], chapterCounts: Record<string, number>): ParsedReference | null {
  const ref = parseReference(input, books);
  if (!ref) return null;
  const count = chapterCounts[ref.book] ?? 0;
  if (count === 1 && ref.verse === null && ref.chapter > 1) {
    return { book: ref.book, chapter: 1, verse: ref.chapter };
  }
  if (ref.chapter >= 1 && ref.chapter <= count) {
    return { book: ref.book, chapter: ref.chapter, verse: ref.verse };
  }
  return null;
}
