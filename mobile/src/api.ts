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
  /** the words carry Strong's numbers: a word can be tapped for the Hebrew or Greek behind it */
  tagged: boolean;
}

export interface Book {
  name: string;
  testament: "OT" | "NT";
  chapters: number;
}

/** Who made a story picture, where it is from and the licence (the picture pack's credits.json). */
export interface StoryCredit {
  title: string;
  artist: string;
  credit: string;
  licence: string;
  licence_url: string;
  page: string;
  collection: string;
}

export interface Verse {
  verse: number;
  text: string;
  /** the words of Jesus in it: inclusive [first, last] ranges of its words; usually empty */
  red: [number, number][];
}

/** A passage a search found. `why`: story | core | phrase | words | meaning | name. `text`: the
 * verses of it that were found (numbered when there are several). */
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

/** An answer to a question typed in the search box (ask.rs). */
export type Answer =
  | { kind: "count"; word: string; total: number; verses: number; scope: string | null }
  | {
      kind: "curated";
      question: string;
      /** stated | computed | traditional | commentary_opinion | doctrinal_view | unattested */
      confidence: string;
      answer: string;
      citations: { reference: string; role: string }[];
      note: string | null;
      /** the closest question on file, not the words typed */
      by_meaning: boolean;
    }
  | { kind: "dictionary"; id: number; headword: string; source: string; preview: string }
  | {
      /** the closest question on file, which does not pass the gate: shown labelled, never as THE answer */
      kind: "related";
      question: string;
      confidence: string;
      answer: string;
      citations: { reference: string; role: string }[];
      note: string | null;
    };

/** What Ask returns: the answer, and the question as it was read when a spelling slip was put right. */
export interface AskReply {
  answer: Answer | null;
  corrected: string | null;
}

export interface SearchResult {
  hits: Hit[];
  /** verses with exactly the words typed, in the translation being read */
  exact: number;
  topics: Topic[];
  articles: ArticleHead[];
  /** misspelt words and the Bible's words they were taken for */
  corrected: [string, string][];
  /** whether the Advanced search upgrade took part */
  by_meaning: boolean;
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

/** What a grammar code says: "V-AAI-3S" as "Verb Aorist Active Indicative 3rd Singular". */
export interface MorphPart {
  code: string;
  summary: string;
  detail: string;
}

/** One Hebrew or Greek word of a verse (the "Original words" download). */
export interface OriginalWord {
  pos: number;
  kind: string;
  language: "Hebrew" | "Greek";
  original: string;
  translit: string;
  /** what it means in English in this place */
  gloss: string;
  /** "G25", "H430"; empty for a particle with no number of its own */
  strongs: string;
  /** the dictionary form, and what it means */
  lemma: string;
  lemma_gloss: string;
  morph: string;
  morph_parts: MorphPart[];
  /** the Greek editions with this word (none for Hebrew) */
  editions: string[];
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

/** What a group of meanings is called in everyday English (SIL Semantic Domains, CC BY-SA 4.0). */
export interface SilCard {
  code: string;
  name: string;
  path: string[];
  description: string;
  related: { code: string; name: string }[];
  words: string[];
  by_louw_nida: boolean;
}

/** One meaning of a Hebrew or Greek word (UBS dictionaries, CC BY-SA 4.0), with where it is used. */
export interface Sense {
  entry: number;
  meaning: number;
  glosses: string[];
  definition: string;
  ln: string | null;
  groups: string[];
  domains: string[];
  verses: number;
  /** verses of each of the 66 books, Genesis first */
  by_book: number[];
  /** the verse being read uses this meaning */
  here: boolean;
  sil: SilCard | null;
}

export interface SenseReport {
  strongs: string;
  language: "greek" | "hebrew";
  lemma: string;
  senses: Sense[];
  dictionary: { lemma: string; translit: string | null; definition: string; kjv: string | null } | null;
}

export interface MeaningWord {
  entry: number;
  meaning: number;
  strongs: string[];
  lemma: string;
  glosses: string[];
  definition: string;
  ln: string | null;
  verses: number;
  translit: string | null;
  speak: string;
}

export interface SamplePart {
  text: string;
  mark: boolean;
}

export interface Sample {
  book: string;
  chapter: number;
  verse: number;
  parts: SamplePart[];
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

/** the two sets of photos to put a verse on */
export type BackgroundPack = "nature" | "christian";

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

export interface BackupOut {
  json: string;
  counts: Counts;
  /** the name of the added Bible the file also holds */
  bible: string | null;
}

export interface RestoreOut {
  counts: Counts;
  settings: unknown;
  bible: { code: string; name: string; added: boolean } | null;
}

export interface Counts {
  bookmarks: number;
  highlights: number;
  notes: number;
  plans: number;
  prayers?: number;
  memory?: number;
}

/** One thing the reader is praying about (the prayer list). */
export interface Prayer {
  id: string;
  body: string;
  created_at: string;
  updated_at: string;
  /** the day it was answered ("YYYY-MM-DD"), or absent while still being prayed for */
  answered_at?: string | null;
  answer_note: string;
}

/** A verse (or a few in a row) being learned, as the Rust side keeps it. */
export interface MemoryRow {
  book: string;
  chapter: number;
  verse: number;
  verse_end: number;
  added_on: string;
  /** 0 to 6 */
  box: number;
  due_on: string;
  last_on?: string | null;
  updated_at: string;
}

/** The highlight colours, the same as the desktop app's (and in its order). */
export const COLORS = ["yellow", "green", "blue", "pink", "orange", "lemon", "lime", "sky", "rose", "red", "violet"] as const;

/** Each colour's name until the reader gives it one (the desktop app's names). */
export const COLOR_NAMES: Record<string, string> = {
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

/** A highlight colour's name: the reader's own ("Old Testament prophecy"), or the colour's. */
export const colorName = (color: string, names: Record<string, string>) => names[color]?.trim() || COLOR_NAMES[color] || color;

export type MarkKind = "bookmarks" | "highlights" | "notes";

export const api = {
  versions: () => invoke<Version[]>("versions"),
  highlightNames: () => invoke<Record<string, string>>("highlight_names"),
  setHighlightName: (color: string, title: string) => invoke<void>("set_highlight_name", { color, title }),
  books: () => invoke<Book[]>("books"),
  chapter: (version: string, book: string, chapter: number) => invoke<Verse[]>("chapter", { version, book, chapter }),
  prayers: () => invoke<Prayer[]>("prayers"),
  savePrayer: (id: string, body: string) => invoke<void>("save_prayer", { id, body }),
  /** marks a prayer answered on `day` ("YYYY-MM-DD") with a line on how, or (day null) puts it back among those still being prayed for */
  answerPrayer: (id: string, day: string | null, note: string) => invoke<void>("answer_prayer", { id, day, note }),
  deletePrayer: (id: string) => invoke<void>("delete_prayer", { id }),
  memoryVerses: () => invoke<MemoryRow[]>("memory_verses"),
  /** true when it was added (false: already being learned) */
  addMemoryVerse: (book: string, chapter: number, verse: number, verseEnd: number, today: string) => invoke<boolean>("add_memory_verse", { book, chapter, verse, verseEnd, today }),
  setMemoryProgress: (book: string, chapter: number, verse: number, verseEnd: number, boxNo: number, dueOn: string, today: string) =>
    invoke<void>("set_memory_progress", { book, chapter, verse, verseEnd, boxNo, dueOn, today }),
  removeMemoryVerse: (book: string, chapter: number, verse: number, verseEnd: number) => invoke<void>("remove_memory_verse", { book, chapter, verse, verseEnd }),
  passage: (version: string, book: string, chapter: number, verse: number, verseEnd: number | null = null) =>
    invoke<string>("passage", { version, book, chapter, verse, verseEnd }),
  search: (query: string, version: string, testament: string | null, book: string | null) =>
    invoke<SearchResult>("search_bible", { query, version, testament, book, limit: 300 }),
  /** an answer when what was typed is a question the app can answer, else null */
  ask: (query: string) => invoke<AskReply>("ask_question", { query }),
  searchUpgradeStatus: () => invoke<{ installed: boolean; size_mb: number }>("search_upgrade_status"),
  /** downloads the Advanced search upgrade ("search-upgrade-progress" events report the percentage) */
  searchUpgradeInstall: () => invoke<void>("search_upgrade_install"),
  searchUpgradeRemove: () => invoke<void>("search_upgrade_remove"),
  /** the "Original words" download: the Greek and Hebrew words of a verse one by one */
  originalStatus: () => invoke<{ installed: boolean; size_mb: number }>("original_status"),
  originalInstall: () => invoke<void>("original_install"),
  originalRemove: () => invoke<void>("original_remove"),
  /** the words of a verse, and the credit to show with them (empty if they are not downloaded) */
  picturesStatus: (kind: "stories" | "kids") => invoke<{ installed: boolean; size_mb: number }>("pictures_status", { kind }),
  picturesInstall: (kind: "stories" | "kids") => invoke<void>("pictures_install", { kind }),
  picturesRemove: (kind: "stories" | "kids") => invoke<void>("pictures_remove", { kind }),
  storyPicture: (id: string) => invoke<{ image: string; credit: StoryCredit } | null>("story_picture", { id }),
  kidPicture: (id: string, outline = false) => invoke<string | null>("kid_picture", { id, outline }),
  /** the picture (and the outline to colour in) an additional children's page brought in the fetched file */
  kidPhoto: (id: string) => invoke<{ image: string; outline: string | null; credit: StoryCredit } | null>("kid_photo", { id }),
  /** the additional stories, topics and children's pages fetched earlier (the file's text), or null */
  extraPagesLoad: () => invoke<string | null>("extra_pages_load"),
  /** fetches the additional pages from the app's releases; the file's text, and whether it is the one already here */
  extraPagesFetch: () => invoke<{ text: string; unchanged: boolean }>("extra_pages_fetch"),
  originalWords: (book: string, chapter: number, verse: number) => invoke<[OriginalWord[], string]>("original_words", { book, chapter, verse }),
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
  /** the text of a backup file and how much it holds; `settings` (the preferences, see backupSettings.ts) and the code of the Bible read by default go into the file, which also holds that Bible's text when the reader added it */
  backup: (settings: unknown = null, bible: string | null = null) => invoke<BackupOut>("backup", { settings, bible }),
  /** keeps the newest backup in the small folder Google's automatic backup copies; `stashedBackup` reads it back (a new phone's restore) */
  stashBackup: (json: string) => invoke<void>("stash_backup", { json }),
  stashedBackup: () => invoke<string | null>("stashed_backup"),
  /** adds a backup's contents to what is here (and a Bible it holds, if that is not here); the file's preferences come back for the page to check and apply */
  restore: (json: string) => invoke<RestoreOut>("restore", { json }),

  /** the verse's tagged words, and the translation they come from (the BSB when `version` isn't tagged) */
  verseWords: (version: string, book: string, chapter: number, verse: number) => invoke<[string, Word[]]>("verse_words", { version, book, chapter, verse }),
  strongsEntry: (number: string) => invoke<StrongsEntry | null>("strongs_entry", { number }),
  strongsUses: (version: string, number: string) => invoke<StrongsUse[]>("strongs_uses", { version, number }),
  /** every meaning of a Hebrew or Greek word (since 3.2.0) */
  wordSenses: (strongs: string, book: string | null, chapter: number | null, verse: number | null) => invoke<SenseReport>("word_senses", { strongs, book, chapter, verse }),
  groupWords: (language: string, code: string) => invoke<MeaningWord[]>("group_words", { language, code }),
  groupCard: (language: string, code: string) => invoke<SilCard | null>("group_card", { language, code }),
  senseSamples: (strongs: string, entry: number, meaning: number, version: string, book: string | null, chapter: number | null, verse: number | null) =>
    invoke<Sample[]>("sense_samples", { strongs, entry, meaning, version, book, chapter, verse }),
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

  /** how many photos of a set are downloaded (0: none yet), and the download's size; `pack` is "nature" (the default) or "christian" */
  backgroundsStatus: (pack: BackgroundPack = "nature") => invoke<{ count: number; size_mb: number; latest: number }>("backgrounds_status", { pack }),
  /** downloads a set ("backgrounds-progress", or "backgrounds-progress-christian", events report the percentage); returns how many */
  backgroundsInstall: (pack: BackgroundPack = "nature") => invoke<number>("backgrounds_install", { pack }),
  /** just the ids and subjects of a set's photos: [id, theme] */
  backgroundsIds: (pack: BackgroundPack = "nature") => invoke<[string, string][]>("backgrounds_ids", { pack }),
  backgroundsThumbs: (pack: BackgroundPack = "nature") => invoke<BackgroundThumb[]>("backgrounds_thumbs", { pack }),
  /** one background, full size: [JPEG base64, where it is from] */
  backgroundImage: (id: string, pack: BackgroundPack = "nature") => invoke<[string, BackgroundInfo]>("background_image", { id, pack }),
  backgroundsRemove: (pack: BackgroundPack = "nature") => invoke<void>("backgrounds_remove", { pack }),
  readingStats: (today: string) => invoke<ReadingStats>("reading_stats", { today }),

  /** the newer version of the app on offer, if there is one (asks bible4me.org) */
  /** true in the Google Play build, which Play updates */
  playBuild: () => invoke<boolean>("play_build"),
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
  /** the installed lexicons' entries for a Strong's number */
  libraryLexicon: (strongs: string) => invoke<LibEntry[]>("library_lexicon", { strongs }),
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

/** a picture or video the computer put in the shared folder */
export interface ComputerFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** ms */
  modified: number;
}

export interface SyncStatus {
  /** the computer paired over the home Wi-Fi, or null */
  computer: string | null;
  /** the chosen folder's name, or null */
  folder: string | null;
  /** the chosen folder's address, for the phone's folder access */
  folder_uri: string | null;
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
export interface ListenStatus {
  running: boolean;
  playing: boolean;
  /** which piece of the queue it is on, and how many there are */
  index: number;
  total: number;
  /** the chapter being read, "John 3" */
  label: string;
  /** the queue was read to its end */
  finished: boolean;
  /** the token the queue was started with */
  token: string;
}

export const phone = {
  share: (text: string, title: string | null = null) => invoke<unknown>("plugin:phone|share", { text, title }),
  /** speaks with the phone's voice (`voice`: one of `voices`, or null for the default); resolves when it has finished, or was stopped */
  speak: (text: string, rate: number, voice: string | null = null) => invoke<{ finished: boolean }>("plugin:phone|speak", { text, rate, voice }),
  voices: () => invoke<{ voices: PhoneVoice[] }>("plugin:phone|voices"),
  /** a picture (base64: a PNG, or a JPEG when `mime` is "image/jpeg") to the share sheet, with some text and an e-mail subject */
  shareImage: (name: string, base64: string, text: string | null = null, mime: "image/png" | "image/jpeg" | null = null, title: string | null = null) =>
    invoke<unknown>("plugin:phone|share_image", { name, base64, text, mime, title }),
  /** asks where to save a PNG (base64); `saved` is false if the reader cancelled */
  saveImage: (name: string, base64: string) => invoke<{ saved: boolean }>("plugin:phone|save_image", { name, base64 }),
  stopSpeaking: () => invoke<unknown>("plugin:phone|stop_speaking"),
  /** asks where to save; `saved` is false if the reader cancelled */
  saveText: (name: string, text: string) => invoke<{ saved: boolean }>("plugin:phone|save_text", { name, text }),
  /** asks for a file; `text` is null if the reader cancelled */
  openText: () => invoke<{ text: string | null }>("plugin:phone|open_text"),
  /** asks for any file and copies it into the app: its path there, or null if cancelled */
  openFile: () => invoke<{ path: string | null; name: string }>("plugin:phone|open_file"),
  /** asks Android to let the app run in the background (for the daily reminder) */
  batterySettings: () => invoke<{ asked: boolean }>("plugin:phone|battery_settings"),
  /** opens an https:// address in the phone's browser */
  openLink: (url: string) => invoke<{ opened: boolean }>("plugin:phone|open_link", { url }),
  /** asks for a folder to keep in step through: its uri, or null if cancelled */
  pickFolder: () => invoke<{ uri: string | null; name: string }>("plugin:phone|pick_folder"),
  /** the pictures and videos the computer put in the shared folder (newest first), one's bytes, save one to the gallery, share some (ids joined with "|"), open one */
  listComputerPictures: (uri: string) => invoke<{ found: boolean; files: ComputerFile[] }>("plugin:phone|list_computer_pictures", { uri, id: "" }),
  readComputerPicture: (uri: string, id: string) => invoke<{ base64: string }>("plugin:phone|read_computer_picture", { uri, id }),
  saveComputerPicture: (uri: string, id: string, name: string, mime: string) => invoke<{ saved: boolean; already: boolean; where: string }>("plugin:phone|save_computer_picture", { uri, id, name, mime }),
  shareComputerPictures: (uri: string, ids: string[], names: string[], mime: string) => invoke<unknown>("plugin:phone|share_computer_pictures", { uri, id: ids.join("|"), name: names.join("|"), mime }),
  openComputerFile: (uri: string, id: string, name: string, mime: string) => invoke<unknown>("plugin:phone|open_computer_file", { uri, id, name, mime }),
  /** hands the phone the plan of daily notifications (each { at (ms), id, title, body, open }); it keeps and sends them, even with the app closed */
  scheduleNotifications: (json: string) => invoke<{ scheduled: number; allowed: boolean; exact: boolean }>("plugin:phone|schedule_notifications", { json }),
  cancelNotifications: () => invoke<unknown>("plugin:phone|cancel_notifications"),
  /** one notification at once: { id, title, body, open } */
  notifyNow: (json: string) => invoke<{ allowed: boolean }>("plugin:phone|notify_now", { json }),
  /** the verses for the home-screen widget: [{ day: "YYYY-MM-DD", ref, text }] */
  setWidgetData: (json: string) => invoke<{ widgets: number }>("plugin:phone|set_widget_data", { json }),
  /** asks the launcher to put the verse widget on the home screen */
  pinWidget: () => invoke<{ supported: boolean; asked: boolean; widgets: number }>("plugin:phone|pin_widget"),
  /** where a notification or the widget opened the app to ("scroll", "mood", "prayer", "memory", "listen"), once; null otherwise */
  takeLaunch: () => invoke<{ open: string | null }>("plugin:phone|take_launch"),
  /** reads aloud with the screen off: { pieces: [{ t, h, l }], start, rate, voice, sleepMin, token } */
  listenStart: (json: string) => invoke<unknown>("plugin:phone|listen_start", { json }),
  listenControl: (action: "toggle" | "next" | "prev" | "stop") => invoke<unknown>("plugin:phone|listen_control", { action }),
  listenStatus: () => invoke<ListenStatus>("plugin:phone|listen_status"),
  /** saves pictures (base64 each) in the gallery, Pictures/Bible Concordance: how many were saved and where */
  saveToGallery: (base64: string[], names: string[], mime: string) => invoke<{ saved: number; where: string }>("plugin:phone|save_to_gallery", { base64: base64.join("|"), names: names.join("|"), mime }),
  /** shares one or several pictures (base64 each) through the share sheet, with some text */
  shareImages: (base64: string[], names: string[], mime: string, text: string | null = null) => invoke<unknown>("plugin:phone|share_images", { base64: base64.join("|"), names: names.join("|"), mime, text }),
  /** shares a text file (a backup) through the share sheet */
  shareFile: (name: string, text: string, mime: string | null = null, title: string | null = null) => invoke<unknown>("plugin:phone|share_file", { name, text, mime, title }),
  /** writes a dated automatic backup copy (Documents/Bible Concordance backup) and keeps the newest three */
  saveBackupCopy: (name: string, text: string) => invoke<{ saved: boolean; where: string }>("plugin:phone|save_backup_copy", { name, text }),
  /** the backup copies this app made, newest first */
  listBackupCopies: () => invoke<{ copies: { name: string; modified: number; uri: string }[] }>("plugin:phone|list_backup_copies"),
  readBackupCopy: (uri: string) => invoke<{ text: string }>("plugin:phone|read_backup_copy", { uri }),
  /** hands a downloaded update to Android's installer; `allow`: the reader must first let this app install apps */
  installUpdate: (path: string) => invoke<{ started: boolean; allow: boolean }>("plugin:phone|install_update", { path }),
};
