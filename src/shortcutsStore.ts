// The reader's shortcuts on the opening screen, remembered between visits (localStorage, wrapped: storage can be unavailable)
// and shared through a tiny store so the opening screen and Settings always agree. The rules are in shortcuts.ts.

import { useSyncExternalStore } from "react";
import { addShortcut, DEFAULT_SHORTCUTS, moveShortcut, parseShortcuts, removeShortcut, resetShortcuts, type ShortcutState } from "./shortcuts";

const KEY = "home:shortcuts";

function load(): ShortcutState {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseShortcuts(JSON.parse(raw)) : DEFAULT_SHORTCUTS;
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

let state: ShortcutState = load();
const listeners = new Set<() => void>();

function commit(next: ShortcutState) {
  if (next === state) return;
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* a per-viewer convenience only */
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useShortcuts(): ShortcutState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export const placeShortcut = (id: string) => commit(addShortcut(state, id));
export const unplaceShortcut = (id: string) => commit(removeShortcut(state, id));
export const moveShortcutTo = (id: string, index: number) => commit(moveShortcut(state, id, index));
export const backToDefaultTiles = () => commit(resetShortcuts());
