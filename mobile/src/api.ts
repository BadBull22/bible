import { invoke } from "@tauri-apps/api/core";

export interface Version {
  code: string;
  name: string;
  license_note: string;
  language: string;
  /** written right to left (Hebrew, Arabic, ...) */
  rtl: boolean;
  /** downloaded by the reader, not built in */
  downloaded: boolean;
}

export interface Book {
  name: string;
  testament: "OT" | "NT";
  chapters: number;
}

export interface Verse {
  verse: number;
  text: string;
  /** the words of Jesus in it: inclusive [first, last] ranges of its words; usually empty */
  red: [number, number][];
}

/** A verse (or short passage) a search found. `why`: core | phrase | words | topical | some. */
export interface Hit {
  book: string;
  chapter: number;
  verse: number;
  verse_end: number;
  why: string[];
  text: string;
}

/** A heading of a topical Bible that fits what was typed. */
export interface Topic {
  id: number;
  name: string;
  source: string;
  verses: number;
}

/** A dictionary article's title. */
export interface ArticleHead {
  id: number;
  name: string;
  source: string;
}

/** A dictionary article; a reference in `body` is marked ⟦Book|chapter|verse|verse_end|label⟧. */
export interface Article extends ArticleHead {
  body: string;
}

export interface SearchResult {
  hits: Hit[];
  /** verses with exactly the words typed, in the translation being read */
  exact: number;
  topics: Topic[];
  articles: ArticleHead[];
}

export interface ChapterMarks {
  bookmarks: number[];
  highlights: [number, string][];
  notes: number[];
}

/** A bookmarked, highlighted or noted verse. `color` is the highlight's colour, the note's
 * text, or "" for a bookmark. */
export interface Mark {
  book: string;
  chapter: number;
  verse: number;
  color: string;
  created_at: string;
  text: string;
  /** a bookmark's or note's tags */
  tags: string[];
}

/** A word of a verse with its Strong's number(s). */
export interface Word {
  text: string;
  numbers: string[];
}

export interface StrongsEntry {
  number: string;
  language: string;
  lemma: string;
  xlit: string;
  pronunciation: string;
  derivation: string;
  definition: string;
  kjv_usage: string;
  /** [translation, verses, occurrences] */
  counts: [string, number, number][];
}

export interface StrongsUse {
  book: string;
  chapter: number;
  verse: number;
  words: string[];
  text: string;
}

/** A commentary note: it covers verse_start up to the next note's start. */
export interface CommentaryNote {
  verse_start: number;
  text: string;
}

export interface CommentaryAbout {
  name: string;
  licence: string;
  licence_url: string;
  website: string;
}

/** A translation eBible.org offers for download. */
export interface Offer {
  id: string;
  language: string;
  language_own: string;
  title: string;
  description: string;
  copyright: string;
  ot_books: number;
  nt_books: number;
  rtl: boolean;
  installed: boolean;
}

export interface ReadingStats {
  streak: number;
  best_streak: number;
  read_today: boolean;
  days: number;
  chapters: number;
  /** [book, chapters of it read] */
  books: [string, number][];
}

export interface BackgroundThumb {
  id: string;
  theme: string;
  /** JPEG, base64 */
  thumb: string;
}

export interface BackgroundInfo {
  id: string;
  theme: string;
  title: string;
  author: string;
  licence: string;
  source: string;
}

export interface PhoneVoice {
  name: string;
  label: string;
  /** works without the internet */
  local: boolean;
}

export interface PlanProgress {
  plan_id: string;
  started_on: string;
  done_days: number[];
}

export interface Counts {
  bookmarks: number;
  highlights: number;
  notes: number;
  plans: number;
}

/** The highlight colours, named as in the desktop app. */
export const COLORS = ["yellow", "green", "blue", "pink", "orange"] as const;

export type MarkKind = "bookmarks" | "highlights" | "notes";

export const api = {
  versions: () => invoke<Version[]>("versions"),
  books: () => invoke<Book[]>("books"),
  chapter: (version: string, book: string, chapter: number) => invoke<Verse[]>("chapter", { version, book, chapter }),
  passage: (version: string, book: string, chapter: number, verse: number, verseEnd: number | null = null) =>
    invoke<string>("passage", { version, book, chapter, verse, verseEnd }),
  search: (query: string, version: string, testament: string | null, book: string | null) =>
    invoke<SearchResult>("search_bible", { query, version, testament, book, limit: 300 }),
  topicVerses: (id: number, version: string) => invoke<Hit[]>("topic_verses", { id, version }),
  crossRefs: (version: string, book: string, chapter: number, verse: number) => invoke<Hit[]>("cross_refs", { version, book, chapter, verse }),
  /** the verse in every translation: [code, text] */
  compare: (book: string, chapter: number, verse: number) => invoke<[string, string][]>("compare", { book, chapter, verse }),
  articles: (query: string) => invoke<ArticleHead[]>("articles", { query }),
  article: (id: number) => invoke<Article | null>("article", { id }),
  chapterMarks: (book: string, chapter: number) => invoke<ChapterMarks>("chapter_marks", { book, chapter }),
  /** returns whether the verse is bookmarked now */
  toggleBookmark: (book: string, chapter: number, verse: number) => invoke<boolean>("toggle_bookmark", { book, chapter, verse }),
  /** `color` null clears the highlight */
  setHighlight: (book: string, chapter: number, verse: number, color: string | null) => invoke<void>("set_highlight", { book, chapter, verse, color }),
  note: (book: string, chapter: number, verse: number) => invoke<string>("note", { book, chapter, verse }),
  /** an empty note removes it */
  setNote: (book: string, chapter: number, verse: number, body: string) => invoke<void>("set_note", { book, chapter, verse, body }),
  marks: (kind: MarkKind, version: string) => invoke<Mark[]>("marks", { kind, version }),
  planProgress: () => invoke<PlanProgress[]>("plan_progress"),
  startPlan: (planId: string, startedOn: string) => invoke<void>("start_plan", { planId, startedOn }),
  stopPlan: (planId: string) => invoke<void>("stop_plan", { planId }),
  setPlanDay: (planId: string, day: number, done: boolean) => invoke<void>("set_plan_day", { planId, day, done }),
  /** the text of a backup file, and how much it holds */
  backup: () => invoke<[string, Counts]>("backup"),
  /** adds a backup's contents to what is here; returns how much was new */
  restore: (json: string) => invoke<Counts>("restore", { json }),

  /** the verse's tagged words, and the translation they come from (the BSB when `version` isn't tagged) */
  verseWords: (version: string, book: string, chapter: number, verse: number) => invoke<[string, Word[]]>("verse_words", { version, book, chapter, verse }),
  strongsEntry: (number: string) => invoke<StrongsEntry | null>("strongs_entry", { number }),
  strongsUses: (version: string, number: string) => invoke<StrongsUse[]>("strongs_uses", { version, number }),
  chapterNotes: (book: string, chapter: number) => invoke<CommentaryNote[]>("chapter_notes", { book, chapter }),
  verseNotes: (book: string, chapter: number, verse: number) => invoke<CommentaryNote[]>("verse_notes", { book, chapter, verse }),
  bookIntro: (book: string) => invoke<string>("book_intro", { book }),
  commentaryAbout: () => invoke<CommentaryAbout>("commentary_about"),

  bibleCatalog: (today: string, refresh = false) => invoke<Offer[]>("bible_catalog", { today, refresh }),
  /** downloads a translation ("bible-progress" events report { id, pct }); returns its verse count */
  bibleInstall: (id: string, today: string) => invoke<number>("bible_install", { id, today }),
  bibleRemove: (code: string) => invoke<void>("bible_remove", { code }),

  setTags: (kind: "bookmarks" | "notes", book: string, chapter: number, verse: number, tags: string[]) => invoke<void>("set_tags", { kind, book, chapter, verse, tags }),
  tagsOf: (kind: "bookmarks" | "notes", book: string, chapter: number, verse: number) => invoke<string[]>("tags_of", { kind, book, chapter, verse }),
  /** [tag, how many bookmarks and notes carry it] */
  allTags: () => invoke<[string, number][]>("all_tags"),

  markRead: (book: string, chapter: number, day: string) => invoke<void>("mark_read", { book, chapter, day }),

  /** how many nature backgrounds are downloaded (0: none yet), and the download's size */
  backgroundsStatus: () => invoke<{ count: number; size_mb: number }>("backgrounds_status"),
  /** downloads them ("backgrounds-progress" events report the percentage); returns how many */
  backgroundsInstall: () => invoke<number>("backgrounds_install"),
  backgroundsThumbs: () => invoke<BackgroundThumb[]>("backgrounds_thumbs"),
  /** one background, full size: [JPEG base64, where it is from] */
  backgroundImage: (id: string) => invoke<[string, BackgroundInfo]>("background_image", { id }),
  backgroundsRemove: () => invoke<void>("backgrounds_remove"),
  readingStats: (today: string) => invoke<ReadingStats>("reading_stats", { today }),

  /** the newer version of the app on offer, if there is one (asks bible4me.org) */
  updateCheck: () => invoke<UpdateOffer | null>("update_check"),
  /** downloads it ("update-progress" events report the percentage); returns the file's path */
  updateDownload: () => invoke<string>("update_download"),
  /** adds the Bible in a file `phone.openFile` copied into the app (e-Sword, MySword or SWORD) */
  bibleAddFile: (path: string, name: string) => invoke<AddedBible>("bible_add_file", { path, name }),
  syncStatus: () => invoke<SyncStatus>("sync_status"),
  /** the folder `phone.pickFolder` gave (null: stop keeping in step) */
  syncSetFolder: (uri: string | null, name: string | null) => invoke<SyncStatus>("sync_set_folder", { uri, name }),
  syncSetName: (name: string) => invoke<SyncStatus>("sync_set_name", { name }),
  syncNow: () => invoke<SyncReport>("sync_now"),
  /** the computers on this Wi-Fi that let the phone sync with them */
  lanFind: () => invoke<FoundComputer[]>("lan_find"),
  /** pairs with a computer (found, or its address typed) using the code it shows */
  lanPair: (address: string, code: string) => invoke<SyncStatus>("lan_pair", { address, code }),
  lanForget: () => invoke<SyncStatus>("lan_forget"),
  libraryCatalog: (refresh: boolean) => invoke<CatalogItem[]>("library_catalog", { refresh }),
  libraryInstall: (name: string) => invoke<LibReport>("library_install", { name }),
  /** a module `phone.openFile` copied into the app: to the Library, or a Bible to the translations */
  libraryAddFile: (path: string, name: string) => invoke<LibReport>("library_add_file", { path, name }),
  libraryInstalled: () => invoke<LibInstalled[]>("library_installed"),
  libraryRemove: (name: string) => invoke<void>("library_remove", { name }),
  libraryCommentary: (book: string, chapter: number) => invoke<CommentaryOn[]>("library_commentary", { book, chapter }),
  librarySearch: (query: string) => invoke<{ id: number; module: string; title: string; headword: string }[]>("library_search", { query }),
  libraryEntry: (id: number) => invoke<LibEntry | null>("library_entry", { id }),
  libraryDevotional: (module: string, month: number, day: number) => invoke<LibEntry | null>("library_devotional", { module, month, day }),
  libraryToc: (module: string) => invoke<TocEntry[]>("library_toc", { module }),
  librarySection: (id: number) => invoke<LibSection | null>("library_section", { id }),
  /** the sections of a book of daily readings that are today's */
  libraryToday: (module: string, month: number, day: number) => invoke<number[]>("library_today", { module, month, day }),
};

/** The Library (since 2.9.0): a module CrossWire offers. */
export interface CatalogItem {
  name: string;
  kind: string;
  title: string;
  lang: string;
  language: string;
  licence: string;
  about: string;
  size_kb: number;
  questionable: boolean;
  supported: boolean;
  /** why it can't be added, or that it is built in */
  note: string | null;
  installed: boolean;
}

export interface LibReport {
  name: string;
  /** "bible" when a file was a Bible (it went to the translations) */
  kind: string;
  title: string;
  entries: number;
  warnings: string[];
}

export interface LibInstalled {
  name: string;
  kind: string;
  title: string;
  language: string;
  licence: string;
  /** "crosswire", or "file" */
  source: string;
}

export interface CommentaryOn {
  module: string;
  title: string;
  /** [first verse, text]; verse 0 is on the whole chapter */
  notes: [number, string][];
}

export interface LibEntry {
  id: number;
  module: string;
  title: string;
  headword: string;
  body: string;
}

export interface TocEntry {
  id: number;
  parent: number | null;
  title: string;
}

export interface LibSection {
  id: number;
  module: string;
  book: string;
  title: string;
  text: string;
  prev: number | null;
  next: number | null;
}

export interface FoundComputer {
  id: string;
  name: string;
  address: string;
}

/** A Bible added from a file. */
export interface AddedBible {
  code: string;
  name: string;
  language: string;
  verses: number;
  books: number;
  /** "e-Sword", "MySword" or "SWORD" */
  program: string;
  warnings: string[];
}

/** Keeping in step with the computers through a shared folder (as in the desktop app). */
export interface SyncReport {
  at: number;
  received: number;
  sent: number;
  conflicts: string[];
  devices: { name: string; kind: string; written: number }[];
  skipped: string[];
  /** e.g. "Your computer wasn't found on this Wi-Fi…" */
  notes: string[];
}

export interface SyncStatus {
  /** the computer paired over the home Wi-Fi, or null */
  computer: string | null;
  /** the chosen folder's name, or null */
  folder: string | null;
  name: string;
  last: SyncReport | null;
  error: string | null;
}

/** A newer version of the app, as the website describes it. */
export interface UpdateOffer {
  version: string;
  url: string;
  sha256: string;
  /** bytes */
  size: number;
  /** a line or two on what is new */
  notes: string;
}

/** What only the phone itself can do (see src-tauri/plugins/phone). */
export const phone = {
  share: (text: string, title: string | null = null) => invoke<unknown>("plugin:phone|share", { text, title }),
  /** speaks with the phone's voice (`voice`: one of `voices`, or null for the default); resolves when it has finished, or was stopped */
  speak: (text: string, rate: number, voice: string | null = null) => invoke<{ finished: boolean }>("plugin:phone|speak", { text, rate, voice }),
  voices: () => invoke<{ voices: PhoneVoice[] }>("plugin:phone|voices"),
  /** a PNG (base64) to the share sheet */
  shareImage: (name: string, base64: string, text: string | null = null) => invoke<unknown>("plugin:phone|share_image", { name, base64, text }),
  /** asks where to save a PNG (base64); `saved` is false if the reader cancelled */
  saveImage: (name: string, base64: string) => invoke<{ saved: boolean }>("plugin:phone|save_image", { name, base64 }),
  stopSpeaking: () => invoke<unknown>("plugin:phone|stop_speaking"),
  /** asks where to save; `saved` is false if the reader cancelled */
  saveText: (name: string, text: string) => invoke<{ saved: boolean }>("plugin:phone|save_text", { name, text }),
  /** asks for a file; `text` is null if the reader cancelled */
  openText: () => invoke<{ text: string | null }>("plugin:phone|open_text"),
  /** asks for any file and copies it into the app: its path there, or null if cancelled */
  openFile: () => invoke<{ path: string | null; name: string }>("plugin:phone|open_file"),
  /** asks for a folder to keep in step through: its uri, or null if cancelled */
  pickFolder: () => invoke<{ uri: string | null; name: string }>("plugin:phone|pick_folder"),
  /** hands a downloaded update to Android's installer; `allow`: the reader must first let this app install apps */
  installUpdate: (path: string) => invoke<{ started: boolean; allow: boolean }>("plugin:phone|install_update", { path }),
};
