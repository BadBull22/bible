// What only this computer's screens keep (the Content Factory's names, logos, header and footer, and its inbox of posts live in the window's
// storage, not in the database) travels in the backup file too, in a "desktop" part that the phone's app ignores. The rules for what comes back
// are in factory/carry.ts. Every storage call is guarded: storage can be unavailable.

import { collectFactory, describe, mergeFactory } from "./factory/carry";
import { KEY_HISTORY, KEY_POSTS } from "./factory/inbox";
import { SETTINGS_KEY } from "./factory/store";

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: it is not kept */
  }
}

/** the extras to write into a backup, or null when there is nothing of the factory to keep */
export function collectDesktopExtras(): unknown {
  return collectFactory(read(SETTINGS_KEY), read(KEY_POSTS), read(KEY_HISTORY));
}

/** puts back what a backup brought; returns a sentence for the screen ("" when there was nothing) */
export function applyDesktopExtras(extras: unknown): string {
  if (!extras) return "";
  const stored = read(SETTINGS_KEY);
  const local = {
    settings: stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Record<string, unknown>) : null,
    posts: Array.isArray(read(KEY_POSTS)) ? (read(KEY_POSTS) as unknown[]) : [],
    history: Array.isArray(read(KEY_HISTORY)) ? (read(KEY_HISTORY) as unknown[]) : [],
  };
  const out = mergeFactory(local, extras);
  if (out.settingsRestored) write(SETTINGS_KEY, out.settings);
  if (out.postsAdded) write(KEY_POSTS, out.posts);
  if (out.history !== local.history) write(KEY_HISTORY, out.history);
  return describe(out);
}
