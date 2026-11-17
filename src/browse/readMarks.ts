// Which stories and children's pages have been read on this device. Kept only here (localStorage, nothing leaves the device); on the phone the list also
// travels in the backup file with the other small settings. A page counts as read after it has been on the screen a few seconds, so a mis-tap does not.
// No picture of what the reader did is kept: only the ids.

import { useEffect, useSyncExternalStore } from "react";

export const READ_KEY = "browse:read";
const MAX = 2000;
/** seconds a page stays open before it counts as read */
export const READ_AFTER_MS = 4000;

/** a list of marks as stored or sent in a file, cleaned: text of a sensible size, no repeats, no more than MAX */
export function cleanReadIds(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    if (typeof x !== "string" || x.length === 0 || x.length > 90 || !/^(stories|topics|children):[a-z0-9-]+$/.test(x) || seen.has(x)) continue;
    seen.add(x);
    out.push(x);
    if (out.length >= MAX) break;
  }
  return out;
}

const markKey = (kind: string, id: string) => `${kind}:${id}`;

let ids: Set<string> = load();
let snapshot: ReadonlySet<string> = ids;
const listeners = new Set<() => void>();

function load(): Set<string> {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(READ_KEY);
    return new Set(cleanReadIds(raw ? JSON.parse(raw) : []));
  } catch {
    return new Set();
  }
}

function save() {
  snapshot = new Set(ids);
  try {
    localStorage.setItem(READ_KEY, JSON.stringify([...ids]));
  } catch {
    /* a convenience only */
  }
  listeners.forEach((l) => l());
}

/** read the stored list again (after a restore put a new one there) */
export function reloadReadMarks() {
  ids = load();
  snapshot = new Set(ids);
  listeners.forEach((l) => l());
}

export const isRead = (kind: string, id: string): boolean => ids.has(markKey(kind, id));

export function markRead(kind: string, id: string) {
  const k = markKey(kind, id);
  if (ids.has(k)) return;
  ids.add(k);
  save();
}

/** forget every mark (the "Mark all as unread" link) */
export function markAllUnread() {
  if (ids.size === 0) return;
  ids = new Set();
  save();
}

/** how many of these pages have been read */
export function readCountOf(kind: string, list: { id: string }[], from: ReadonlySet<string> = snapshot): number {
  return list.filter((e) => from.has(markKey(kind, e.id))).length;
}

/** the read pages, drawn again whenever one is marked; `read(kind, id)` says whether a page has been read */
export function useReadMarks(): { read: (kind: string, id: string) => boolean; total: number } {
  const set = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => snapshot,
  );
  return { read: (kind, id) => set.has(markKey(kind, id)), total: set.size };
}

/** on a page: marks it read once it has been open a few seconds */
export function useMarkRead(kind: string, id: string | null) {
  useEffect(() => {
    if (!id) return;
    const t = window.setTimeout(() => markRead(kind, id), READ_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [kind, id]);
}
