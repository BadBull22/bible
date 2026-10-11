import { invoke } from "@tauri-apps/api/core";

export interface Version {
  code: string;
  name: string;
  license_note: string;
}

export interface Book {
  name: string;
  testament: "OT" | "NT";
  chapters: number;
}

export interface Verse {
  verse: number;
  text: string;
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
};

/** What only the phone itself can do (see src-tauri/plugins/phone). */
export const phone = {
  share: (text: string, title: string | null = null) => invoke<unknown>("plugin:phone|share", { text, title }),
  /** speaks with the phone's voice; resolves when it has finished, or was stopped */
  speak: (text: string, rate: number) => invoke<{ finished: boolean }>("plugin:phone|speak", { text, rate }),
  stopSpeaking: () => invoke<unknown>("plugin:phone|stop_speaking"),
  /** asks where to save; `saved` is false if the reader cancelled */
  saveText: (name: string, text: string) => invoke<{ saved: boolean }>("plugin:phone|save_text", { name, text }),
  /** asks for a file; `text` is null if the reader cancelled */
  openText: () => invoke<{ text: string | null }>("plugin:phone|open_text"),
};
