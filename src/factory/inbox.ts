// Content Factory: the "Ready to post" inbox. What the factory made for the reader, each with a status the reader moves along
// (New, Approved, Posted, Skipped). The words are kept in the post, so it opens exactly as it was made. Kept in the window's own
// storage (a convenience: if it is cleared the inbox is simply empty).

import { forget, type HistoryEntry, type RecipeId } from "./autopilot.ts";

export type PostStatus = "new" | "approved" | "posted" | "skipped";

export interface PostCard {
  text: string;
  /** the line under the words ("John 3:16", "Bible story"); empty for none */
  reference: string;
  /** the Bible version, when the words are Scripture */
  version: string;
}

export interface Post {
  id: string;
  recipe: RecipeId;
  title: string;
  /** the day number it is meant for */
  day: number;
  cards: PostCard[];
  /** the caption to post with it */
  caption: string;
  status: PostStatus;
  /** picks the look (the first of makeLooks(seed)) */
  lookSeed: number;
  /** what it used (for the no-repeat memory) */
  keys: string[];
  madeDay: number;
}

const KEY_POSTS = "factory:inbox:v1";
const KEY_HISTORY = "factory:history:v1";

export function loadPosts(): Post[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_POSTS) ?? "[]");
    return Array.isArray(raw) ? (raw as Post[]).filter((p) => p && typeof p.id === "string" && Array.isArray(p.cards) && p.cards.length > 0) : [];
  } catch {
    return [];
  }
}

export function savePosts(posts: Post[]): void {
  try {
    localStorage.setItem(KEY_POSTS, JSON.stringify(posts));
  } catch {
    /* storage unavailable: the inbox lasts for this visit only */
  }
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_HISTORY) ?? "[]");
    return Array.isArray(raw) ? (raw as HistoryEntry[]).filter((h) => h && typeof h.key === "string" && typeof h.day === "number") : [];
  } catch {
    return [];
  }
}

export function saveHistory(h: HistoryEntry[]): void {
  try {
    localStorage.setItem(KEY_HISTORY, JSON.stringify(h));
  } catch {
    /* ignore */
  }
}

/** the inbox in the order to read it: by day, then as made */
export function inOrder(posts: Post[]): Post[] {
  return [...posts].sort((a, b) => a.day - b.day || a.madeDay - b.madeDay);
}

export function setStatus(posts: Post[], id: string, status: PostStatus): Post[] {
  return posts.map((p) => (p.id === id ? { ...p, status } : p));
}

export function removePost(posts: Post[], id: string): Post[] {
  return posts.filter((p) => p.id !== id);
}

/** Skipping or deleting a post gives back what it used, so it can come round again. */
export function giveBack(history: HistoryEntry[], post: Post): HistoryEntry[] {
  return forget(history, post.keys);
}

/** posts still waiting (not posted or skipped) */
export const waiting = (posts: Post[]) => posts.filter((p) => p.status === "new" || p.status === "approved");

/** old posts that were posted or skipped over `days` ago are dropped, so the inbox does not grow for ever */
export function tidy(posts: Post[], today: number, days = 60): Post[] {
  return posts.filter((p) => (p.status === "new" || p.status === "approved") || today - p.day < days);
}
