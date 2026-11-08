// Closable new-feature notes on the opening screen. A note the reader closes stays closed (the feature is still in the menus and can be made a
// shortcut); "Show the tips again" in Settings brings them back. Kept in localStorage; if storage is unavailable the note simply shows each time.

import { useSyncExternalStore } from "react";

const KEY = "home:highlights-closed";
let closed: string[] = read();
const listeners = new Set<() => void>();

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function set(next: string[]) {
  closed = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage can be unavailable */
  }
  listeners.forEach((l) => l());
}

export function closeHighlight(id: string) {
  if (!closed.includes(id)) set([...closed, id]);
}

export function showHighlightsAgain() {
  set([]);
}

export function useClosedHighlights(): string[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => closed,
  );
}
