// Offline Assistant: the calls to offline_ai.rs. Hidden until unlocked from the search bar.

import { invoke } from "@tauri-apps/api/core";

export interface AiStatus {
  enabled: boolean;
  runtime: boolean;
  model: boolean;
  /** "generic-gpu" | "generic-cpu" once known */
  variant: string | null;
  downloading: boolean;
  loaded: boolean;
}

export interface AiChat {
  id: number;
  title: string;
  created_at: string;
}

export interface AiSource {
  tag: string;
  label: string;
  book: string;
  chapter: number;
  verse: number;
  verse_end: number;
  text: string;
}

export interface AiMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources: AiSource[];
  /** references or quotations in the answer that its sources don't support */
  unsupported: string[];
  /** model | curated | none | memory | question */
  kind: string;
  created_at: string;
}

export interface AiOtherWord {
  strongs: string;
  lemma: string;
  gloss: string;
  uses: number;
  /** this word's dictionary entry, when it compares itself with the word on the card */
  note: string | null;
}

/** One original word of a passage, as the app's own interlinear and Strong's entries show it. */
export interface AiWordInsight {
  verse: number;
  english: string;
  original: string;
  translit: string;
  strongs: string;
  lemma_gloss: string;
  definition: string;
  renderings: string[];
  uses: number;
  others: AiOtherWord[];
  reasons: string[];
  /** one or two sentences from the model, written from this card's text alone */
  explanation: string | null;
}

export interface AiThreadLink {
  book: string;
  chapter: number;
  verse: number;
  verse_end: number;
  /** the verses in the Berean Standard Bible */
  text: string;
  why: string;
}

/** Other places in the Bible that tie in with a passage, with what ties them (all from the app's own data). */
export interface AiThread {
  /** cross | word | topic | person */
  kind: string;
  title: string;
  source: string;
  links: AiThreadLink[];
}

/** What the app already holds that goes with a passage: what Simeon and Spurgeon preached on it, and stories. */
export interface AiStory {
  /** simeon | spurgeon | illustration */
  kind: string;
  title: string;
  source: string;
  /** the passage a sermon is on, or the book's own subject for a story */
  subject: string;
  text: string;
  url: string | null;
  /** the model's YES or NO to "does it illustrate what the passage teaches?" (null: not asked) */
  fits: boolean | null;
  found_by: string;
}

/** A part of a passage for an outline, with a short heading in the passage's own words (null when none passed its check). */
export interface AiPart {
  verse_start: number;
  verse_end: number;
  text: string;
  heading: string | null;
  said: string;
}

/** A discussion question for a small group, from what a passage says (look = what it says, think = what it means, do = how to live it). */
export interface AiGroupQuestion {
  kind: string;
  text: string;
}

export const ai = {
  /** true when what was typed unlocks the beta */
  tryUnlock: (text: string) => invoke<boolean>("ai_try_unlock", { text }),
  turnOff: () => invoke<void>("ai_turn_off"),
  status: () => invoke<AiStatus>("ai_status"),
  /** "ai-progress" events: { stage: "runtime" | "accelerator" | "model", percent } */
  install: () => invoke<void>("ai_install"),
  remove: () => invoke<void>("ai_remove"),
  chats: () => invoke<AiChat[]>("ai_chats"),
  messages: (chatId: number) => invoke<AiMessage[]>("ai_messages", { chatId }),
  deleteChat: (chatId: number) => invoke<void>("ai_delete_chat", { chatId }),
  memory: () => invoke<{ id: number; fact: string }[]>("ai_memory"),
  forget: (id: number) => invoke<void>("ai_forget", { id }),
  /** "ai-token" events ({ chat_id, text }) carry the answer as it is written */
  ask: (chatId: number | null, question: string) => invoke<{ chat_id: number; messages: AiMessage[] }>("ai_ask", { chatId, question }),
  /** the words of a passage whose Hebrew or Greek says more than the English ("ai-status" events while the model writes) */
  threads: (book: string, chapter: number, verseStart: number, verseEnd: number) => invoke<AiThread[]>("ai_threads", { book, chapter, verseStart, verseEnd }),
  stories: (book: string, chapter: number, verseStart: number, verseEnd: number, topics: string[], judge: boolean) =>
    invoke<AiStory[]>("ai_stories", { book, chapter, verseStart, verseEnd, topics, judge }),
  structure: (book: string, chapter: number, verseStart: number, verseEnd: number, headings: boolean) =>
    invoke<AiPart[]>("ai_structure", { book, chapter, verseStart, verseEnd, headings }),
  /** one sentence per link on what it has in common with the passage (null: nothing clear, or not kept by the check) */
  threadNotes: (book: string, chapter: number, verseStart: number, verseEnd: number, links: { book: string; chapter: number; verse: number; verse_end: number }[]) =>
    invoke<(string | null)[]>("ai_thread_notes", { book, chapter, verseStart, verseEnd, links }),
  groupQuestions: (book: string, chapter: number, verseStart: number, verseEnd: number) =>
    invoke<AiGroupQuestion[]>("ai_group_questions", { book, chapter, verseStart, verseEnd }),
  wordInsights: (book: string, chapter: number, verseStart: number, verseEnd: number, explain: boolean) =>
    invoke<AiWordInsight[]>("ai_word_insights", { book, chapter, verseStart, verseEnd, explain }),
};
