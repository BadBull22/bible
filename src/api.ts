import { invoke as tauriInvoke, InvokeArgs, InvokeOptions } from "@tauri-apps/api/core";
import { logEvent } from "./errorLog";

// Every command goes through here so a failure is also written to the app's log (many
// callers deliberately swallow errors, which would otherwise leave no trace at all).
function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  return tauriInvoke<T>(cmd, args, options).catch((e) => {
    logEvent("warn", `${cmd} failed:`, e);
    throw e;
  });
}

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

/** A cross-reference that involves the Apocrypha, from the reference notes of older Bibles. */
export interface ApocryphaRef {
  book: string;
  chapter: number;
  /** null = the whole chapter */
  verse: number | null;
  verse_end: number | null;
  /** that passage is in the Apocrypha (outside the canon) */
  apocrypha: boolean;
  /** "out": this verse's note points there; "in": that passage's note points here */
  direction: "out" | "in";
  /** the Bible(s) whose printed notes make the link */
  sources: string[];
  text: string;
  version: string;
}

/** Books outside the 66: the built-in Enoch, and the Apocrypha of a Library Bible that has
 * them (the names library/refs.rs gives them). They have no interlinear or cross references. */
export const NON_CANON_BOOKS = new Set([
  "Enoch", "Tobit", "Judith", "Additions to Esther", "Esther (Greek)", "Wisdom of Solomon", "Sirach", "Baruch",
  "Letter of Jeremiah", "Prayer of Azariah", "Susanna", "Bel and the Dragon", "Additions to Daniel", "1 Maccabees",
  "2 Maccabees", "3 Maccabees", "4 Maccabees", "1 Esdras", "2 Esdras", "Prayer of Manasseh", "Psalm 151",
  "Psalms of Solomon", "Odes", "Letter to the Laodiceans", "1 Enoch (Greek)",
]);

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
  /** Human-readable applied scope ("in the New Testament", "in Romans"), or null for an
   * unscoped whole-Bible count. */
  scope_label: string | null;
}

/** An optional restriction on a `wordFrequency` query -- omitted/null searches the
 * whole Bible. */
export type FrequencyScope = { kind: "testament"; testament: string } | { kind: "book"; book: string };

export interface AppSettings {
  api_bible_key: string | null;
  esv_api_key: string | null;
  highlight_titles: Record<string, string>;
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

/** How certain a curated "Ask a question" answer is -- see `qa.rs`'s `QaConfidence` for
 * what each level means and when it's used. Never inferred by the UI; always set by
 * whoever curated the entry. */
export type QaConfidence = "stated" | "computed" | "traditional" | "commentary_opinion" | "doctrinal_view" | "unattested";

export interface AskCitation {
  reference: string;
  role: string;
}

export interface AskCuratedEntry {
  question: string;
  confidence: QaConfidence;
  answer: string;
  citations: AskCitation[];
  note: string | null;
}

/** The tagged result of `askQuestion`, in the order its three layers are tried: an exact
 * computed count, a curated hand-verified answer, or (when neither hits) a labeled
 * best-effort fallback -- kept distinguishable so the UI never lets a guess look as
 * certain as a verified answer. */
export type AskAnswer =
  | { kind: "computed"; word: string; result: WordFrequencyResult }
  | { kind: "curated"; entry: AskCuratedEntry; matched_by: "exact" | "semantic"; similarity: number | null }
  | { kind: "dictionary"; entry: DictionaryEntry; term: string }
  | { kind: "fallback"; hits: SearchHit[]; commentary_hits: CommentaryHit[] };

// ---------------------------------------------------------------- study data (v2.2)

export interface MorphPart {
  code: string;
  /** Plain-English reading, e.g. "Verb Aorist Active Indicative 3rd Singular". */
  summary: string;
  detail: string;
}

export interface InterlinearWord {
  word_pos: number;
  word_type: string;
  original: string;
  translit: string;
  gloss: string;
  /** App-format Strong's number ("G25"), or "" for STEPBible-only particle codes. */
  strongs: string;
  lemma: string;
  lemma_gloss: string;
  morph: string;
  morph_parts: MorphPart[];
  /** Greek editions containing the word ("NA28", "Tyn", "TR", ...); empty for Hebrew. */
  editions: string[];
}

export interface DictionaryInfo {
  code: string;
  name: string;
  kind: "dictionary" | "topical";
  entry_count: number;
}

export interface DictionaryHit {
  id: number;
  dict_code: string;
  dict_name: string;
  headword: string;
  snippet: string;
}

export interface DictionaryEntry {
  id: number;
  dict_code: string;
  dict_name: string;
  kind: "dictionary" | "topical";
  headword: string;
  /** Plain text with ⟦Book|chapter|verse|verse_end|label⟧ reference markers. */
  body: string;
}

export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "orange" | "lemon" | "lime" | "sky" | "rose" | "red" | "violet";
// Soft (pastel) colours, then bright ones.
export const HIGHLIGHT_COLORS_SOFT: HighlightColor[] = ["yellow", "green", "blue", "pink", "orange"];
export const HIGHLIGHT_COLORS_BRIGHT: HighlightColor[] = ["lemon", "lime", "sky", "rose", "red", "violet"];
export const HIGHLIGHT_COLORS: HighlightColor[] = [...HIGHLIGHT_COLORS_SOFT, ...HIGHLIGHT_COLORS_BRIGHT];
export const HIGHLIGHT_COLOR_NAMES: Record<HighlightColor, string> = {
  yellow: "Soft yellow",
  green: "Soft green",
  blue: "Soft blue",
  pink: "Soft pink",
  orange: "Soft orange",
  lemon: "Bright yellow",
  lime: "Bright green",
  sky: "Bright blue",
  rose: "Hot pink",
  red: "Red",
  violet: "Purple",
};

/** The label to show for a highlight colour: the reader's own custom title (e.g. "Love")
 * if they've set one, otherwise the default descriptive name ("Soft yellow"). */
export function highlightLabel(color: string, titles: Record<string, string>): string {
  const custom = titles[color]?.trim();
  return custom || HIGHLIGHT_COLOR_NAMES[color as HighlightColor] || color;
}

export interface ChapterMarks {
  bookmarks: number[];
  highlights: [number, HighlightColor][];
  /** verses a note starts on */
  notes: number[];
  /** [first, last] verse of each note on more than one verse */
  note_spans: [number, number][];
}

/** A reader's note; `verse_end` equals `verse` for a one-verse note. */
export interface Note {
  verse: number;
  verse_end: number;
  body: string;
  tags: string[];
}

export interface StudyItem {
  book: string;
  chapter: number;
  verse: number;
  /** Highlight colour, or the note text; "" for bookmarks. */
  value: string;
  created_at: string;
  updated_at: string;
  verse_text: string;
  /** notes only: last verse of a note on a range */
  verse_end?: number;
  /** notes only */
  tags?: string[];
}

export interface StudyLists {
  bookmarks: StudyItem[];
  highlights: StudyItem[];
  notes: StudyItem[];
}

export interface PlanProgress {
  plan_id: string;
  started_on: string;
  done_days: number[];
}

export interface ExportResult {
  markdown_path: string;
  json_path: string;
  notes: number;
  highlights: number;
  bookmarks: number;
}

/** The natural read-aloud voice: present, running, or downloadable. */
export interface VoiceStatus {
  available: boolean;
  running: boolean;
  source: "downloaded" | "bundled" | null;
  download_bytes: number | null;
  downloading: boolean;
}

export interface UpdateInfo {
  version: string;
  current_version: string;
  notes: string | null;
  date: string | null;
}

export interface ImportResult {
  notes: number;
  highlights: number;
  bookmarks: number;
  plans: number;
}

/** One run of text inside a study-sheet paragraph. */
export interface SheetRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** words of Jesus, when red letters are on */
  red?: boolean;
}

/** A study sheet is a flat list of these blocks: the same list drives the on-screen
 * preview, printing, copying, and the Word document built in Rust (`sheet.rs`). */
export type SheetBlock =
  | { kind: "title"; text: string }
  | { kind: "subtitle"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "subheading"; text: string }
  | { kind: "para"; runs: SheetRun[] }
  | { kind: "quote"; runs: SheetRun[] }
  | { kind: "lines"; count: number }
  /** a picture: PNG data URL + its pixel size, and a caption line under it */
  | { kind: "image"; src: string; width: number; height: number; caption: string };

export type BasketKind = "verse" | "note" | "commentary" | "dictionary" | "answer" | "text" | "picture";

/** A study-basket item. `meta` is kind-specific JSON (for "verse": BasketVerseMeta). */
export interface BasketItem {
  id: number;
  kind: BasketKind;
  title: string;
  body: string;
  meta: string;
  created_at: string;
}

export interface BasketVerseMeta {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  version: string;
}

// ---------------------------------------------------------------- the Library (SWORD modules)

export type LibraryKind = "bible" | "commentary" | "dictionary" | "devotional" | "book" | "other";

/** A repository the Library can browse (CrossWire, eBible.org, ...). */
export interface LibrarySource {
  id: string;
  name: string;
  about: string;
}

/** A module in a source's catalogue. */
export interface CatalogItem {
  name: string;
  kind: LibraryKind;
  title: string;
  lang: string;
  language: string;
  licence: string;
  about: string;
  size_kb: number;
  version: string;
  category: string;
  /** CrossWire's own "Cults / Unorthodox / Questionable Material" category */
  questionable: boolean;
  supported: boolean;
  /** why it can't be installed, or that the app already includes it */
  note: string | null;
  built_in: boolean;
  installed: boolean;
  installed_version: string | null;
  /** id of the source this entry comes from */
  source: string;
}

export interface InstalledModule {
  name: string;
  kind: LibraryKind;
  title: string;
  language: string;
  licence: string;
  about: string;
  version: string;
  entries: number;
  installed_at: string;
  /** a source id, or "file" for something added from the reader's own file */
  source: string;
  /** a book added from a PDF: its number of printed pages (0 = no page numbers) */
  pages: number;
}

export interface InstallReport {
  name: string;
  kind: LibraryKind;
  title: string;
  entries: number;
  /** Bibles and commentaries: how many of the 66 books have text */
  books: number;
  language: string;
  licence: string;
  warnings: string[];
  /** title of an installed work this one would replace */
  replaces: string | null;
}

export interface LibraryProgress {
  name: string;
  stage: "downloading" | "unpacking" | "reading" | "saving";
  pct: number | null;
}

export interface TocEntry {
  id: number;
  parent: number | null;
  title: string;
  has_text: boolean;
  /** length of the section's text */
  chars: number;
}

export interface BookSection {
  id: number;
  module: string;
  module_title: string;
  title: string;
  /** plain text with ⟦..⟧ reference markers (RichText) */
  text: string;
  prev: number | null;
  next: number | null;
}

export interface BookHit {
  id: number;
  module: string;
  module_title: string;
  title: string;
  snippet: string;
}

// ---------------------------------------------------------------- Hebrew & Greek search

export interface WordCandidate {
  strongs: string;
  lemma: string;
  gloss: string;
  language: "Greek" | "Hebrew";
  count: number;
}

export interface OriginalFacet {
  key: string;
  /** [value, occurrences] */
  values: [string, number][];
}

export interface OriginalHit {
  book: string;
  chapter: number;
  verse: number;
  original: string;
  translit: string;
  gloss: string;
  parsing: string;
  /** the verse in the BSB */
  text: string;
}

export interface OriginalSearchResult {
  word: WordCandidate | null;
  total: number;
  matched: number;
  facets: OriginalFacet[];
  by_book: [string, number][];
  hits: OriginalHit[];
}

// ---------------------------------------------------------------- Bible pictures

export interface PictureCollection {
  key: string;
  title: string;
  artist: string;
  year: string;
  licence: string;
  licence_url: string;
  about: string;
  count: number;
  approx_mb: number;
  downloaded: number;
  downloading: boolean;
}

/** [book, chapter, first verse, last verse] */
export type PictureRef = [string, number, number | null, number | null];

export interface PictureInfo {
  id: string;
  /** collection key */
  c: string;
  title: string;
  caption: string;
  refs: PictureRef[];
  url: string;
  w: number;
  h: number;
  /** its Wikimedia Commons page */
  page: string;
  credit: string;
  collection_title: string;
  artist: string;
  licence: string;
  licence_url: string;
  downloaded: boolean;
}

export interface ChapterPictures {
  pictures: PictureInfo[];
  /** [collection title, number of pictures for this chapter not downloaded yet] */
  available: [string, number][];
}

export interface PicturesProgress {
  collection: string;
  done: number;
  total: number;
  failed: number;
}

export interface MapPlace {
  id: string;
  name: string;
  feature_type: string | null;
  latitude: number;
  longitude: number;
  reference_count: number;
}

/** The opening screen's stat tiles. Every field is counted live against the bundled
 * data on the Rust side -- never hardcoded -- so these can't drift out of sync. */
export interface HomeStats {
  books: number;
  ot_books: number;
  nt_books: number;
  chapters: number;
  ot_chapters: number;
  nt_chapters: number;
  verses: number;
  cross_references: number;
  translations: number;
  strongs_hebrew: number;
  strongs_greek: number;
  people: number;
  places: number;
  events: number;
  commentaries: number;
}

export const api = {
  listVersions: () => invoke<Version[]>("list_versions"),
  listBooks: () => invoke<BookInfo[]>("list_books"),
  chapterCounts: () => invoke<[string, number][]>("chapter_counts"),
  homeStats: () => invoke<HomeStats>("home_stats"),
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
  wordFrequency: (version_code: string, word: string, scope: FrequencyScope | null = null) =>
    invoke<WordFrequencyResult>("word_frequency", { versionCode: version_code, word, scope }),
  crossReferencesFor: (book: string, chapter: number, verse: number) =>
    invoke<CrossReference[]>("cross_references_for", { book, chapter, verse }),
  getSettings: () => invoke<AppSettings>("get_settings"),
  saveApiBibleKey: (key: string) => invoke<void>("save_api_bible_key", { key }),
  saveEsvApiKey: (key: string) => invoke<void>("save_esv_api_key", { key }),
  saveHighlightTitle: (color: HighlightColor, title: string) => invoke<void>("save_highlight_title", { color, title }),
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
  askQuestion: (query: string, fallback_limit: number = 12) => invoke<AskAnswer>("ask_question", { query, fallbackLimit: fallback_limit }),
  interlinearVerse: (book: string, chapter: number, verse: number) =>
    invoke<InterlinearWord[]>("interlinear_verse", { book, chapter, verse }),
  listDictionaries: () => invoke<DictionaryInfo[]>("list_dictionaries"),
  searchDictionaries: (query: string, dict_code: string | null, limit: number) =>
    invoke<DictionaryHit[]>("search_dictionaries", { query, dictCode: dict_code, limit }),
  dictionaryEntry: (id: number) => invoke<DictionaryEntry | null>("dictionary_entry", { id }),
  topicsForVerse: (book: string, chapter: number, verse: number) =>
    invoke<DictionaryHit[]>("topics_for_verse", { book, chapter, verse }),
  chapterMarks: (book: string, chapter: number) => invoke<ChapterMarks>("chapter_marks", { book, chapter }),
  toggleBookmark: (book: string, chapter: number, verse: number) => invoke<boolean>("toggle_bookmark", { book, chapter, verse }),
  setHighlight: (book: string, chapter: number, verse: number, color: HighlightColor | null) =>
    invoke<void>("set_highlight", { book, chapter, verse, color }),
  getNote: (book: string, chapter: number, verse: number) => invoke<Note | null>("get_note", { book, chapter, verse }),
  /** an empty body deletes the note; `verseEnd` past `verse` makes it a note on the range */
  saveNote: (book: string, chapter: number, verse: number, body: string, verseEnd?: number, tags?: string[]) =>
    invoke<void>("save_note", { book, chapter, verse, body, verseEnd: verseEnd ?? null, tags: tags ?? null }),
  chapterNotes: (book: string, chapter: number) => invoke<Note[]>("chapter_notes", { book, chapter }),
  /** every tag used on a note, with its count, most used first */
  noteTags: () => invoke<[string, number][]>("note_tags"),
  listStudy: () => invoke<StudyLists>("list_study"),
  planProgress: () => invoke<PlanProgress[]>("plan_progress"),
  startPlan: (plan_id: string, started_on: string) => invoke<void>("start_plan", { planId: plan_id, startedOn: started_on }),
  stopPlan: (plan_id: string) => invoke<void>("stop_plan", { planId: plan_id }),
  setPlanDay: (plan_id: string, day: number, done: boolean) => invoke<void>("set_plan_day", { planId: plan_id, day, done }),
  exportStudy: () => invoke<ExportResult>("export_study"),
  importStudy: (json: string) => invoke<ImportResult>("import_study", { json }),
  /** the last lines of the app's error log */
  logRecent: (lines = 200) => invoke<string>("log_recent", { lines }),
  logPath: () => invoke<string | null>("log_path"),
  openLogFolder: () => invoke<void>("open_log_folder"),
  voiceStatus: () => invoke<VoiceStatus>("voice_status"),
  /** progress arrives as "voice-progress" events, "voice-changed" when it's ready */
  voiceDownload: () => invoke<void>("voice_download"),
  voiceCancelDownload: () => invoke<void>("voice_cancel_download"),
  voiceRemove: () => invoke<void>("voice_remove"),
  /** null when this is the latest version */
  updateCheck: () => invoke<UpdateInfo | null>("update_check"),
  /** progress arrives as "update-progress" events; the app restarts when done */
  updateInstall: () => invoke<void>("update_install"),
  passageText: (version_code: string, book: string, chapter: number, verse_start: number, verse_end: number) =>
    invoke<string>("passage_text", { versionCode: version_code, book, chapter, verseStart: verse_start, verseEnd: verse_end }),
  /** Writes the sheet as a .docx in Documents\Bible Concordance; returns the path. */
  saveStudySheet: (title: string, blocks: SheetBlock[]) => invoke<string>("save_study_sheet", { title, blocks }),
  originalWordLookup: (query: string, limit = 20) => invoke<WordCandidate[]>("original_word_lookup", { query, limit }),
  originalWordSearch: (strongs: string, filters: Record<string, string>, limit = 200) =>
    invoke<OriginalSearchResult>("original_word_search", { strongs, filters, limit }),
  picturesCollections: () => invoke<PictureCollection[]>("pictures_collections"),
  picturesForChapter: (book: string, chapter: number) => invoke<ChapterPictures>("pictures_for_chapter", { book, chapter }),
  picturesGallery: (collection: string, offset: number, limit: number) =>
    invoke<[PictureInfo[], number]>("pictures_gallery", { collection, offset, limit }),
  pictureBytes: (id: string) => invoke<ArrayBuffer>("picture_bytes", { id }),
  picturesDownload: (collection: string) => invoke<number>("pictures_download", { collection }),
  picturesCancel: (collection: string) => invoke<void>("pictures_cancel", { collection }),
  picturesRemove: (collection: string) => invoke<void>("pictures_remove", { collection }),
  librarySources: () => invoke<LibrarySource[]>("library_sources"),
  libraryCatalog: (refresh: boolean, source = "crosswire") => invoke<CatalogItem[]>("library_catalog", { refresh, source }),
  libraryInstall: (name: string, source = "crosswire") => invoke<InstallReport>("library_install", { name, source }),
  /** "Add from file", step 1: checks an e-book (EPUB) or module zip and reports what it holds; installs nothing */
  libraryImportCheck: (file: Uint8Array, fileName: string) =>
    invoke<InstallReport>("library_import_check", file, { headers: { "x-file-name": encodeURIComponent(fileName) } }),
  /** step 2: installs the file that was just checked */
  libraryImportInstall: () => invoke<InstallReport>("library_import_install"),
  libraryImportCancel: () => invoke<void>("library_import_cancel"),
  libraryRemove: (name: string) => invoke<void>("library_remove", { name }),
  libraryInstalled: (kind: LibraryKind | null = null) => invoke<InstalledModule[]>("library_installed", { kind }),
  libraryToc: (name: string) => invoke<TocEntry[]>("library_toc", { name }),
  librarySection: (id: number) => invoke<BookSection | null>("library_section", { id }),
  /** where printed page `page` of a PDF book starts: [section id, the page found] */
  /** cross-references between this verse and the Apocrypha (and, for an Apocrypha verse, all its references) */
  apocryphaXrefs: (book: string, chapter: number, verse: number, version: string) =>
    invoke<ApocryphaRef[]>("apocrypha_xrefs", { book, chapter, verse, version }),
  /** the Apocrypha books an installed Bible has: [name, chapters] ([] for the built-in Bibles) */
  libraryExtraBooks: (version: string) => invoke<[string, number][]>("library_extra_books", { version }),
  libraryBookPage: (name: string, page: number) => invoke<[number, number] | null>("library_book_page", { name, page }),
  /** entries for a Strong's number ("G25") in installed Library lexicons */
  libraryLexiconEntries: (strongs: string) => invoke<DictionaryEntry[]>("library_lexicon_entries", { strongs }),
  librarySearchBooks: (query: string, name: string | null, limit: number) =>
    invoke<BookHit[]>("library_search_books", { query, name, limit }),
  basketList: () => invoke<BasketItem[]>("basket_list"),
  basketAdd: (kind: BasketKind, title: string, body: string, meta: string = "") => invoke<number>("basket_add", { kind, title, body, meta }),
  basketUpdate: (id: number, title: string, body: string) => invoke<void>("basket_update", { id, title, body }),
  basketRemove: (id: number) => invoke<void>("basket_remove", { id }),
  basketClear: () => invoke<void>("basket_clear"),
  basketReorder: (ids: number[]) => invoke<void>("basket_reorder", { ids }),
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
