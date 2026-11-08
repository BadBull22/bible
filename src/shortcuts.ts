// The reader's own shortcuts on the opening screen (owner, 2026-11-07): up to six, chosen from anything in the menus, which
// REPLACE the six default tiles ("Inside this Bible") until the reader goes back to the default. Pure functions on plain data,
// so they can be tested exactly (scripts/test_shortcuts.mts); the storage and the screen are in shortcutsStore.ts and HomeScreen.tsx.

import type { ReactNode } from "react";

export const MAX_SHORTCUTS = 6;

export interface ShortcutState {
  /** true once the reader has placed at least one shortcut: the six default tiles are then replaced by `ids` */
  custom: boolean;
  /** the shortcuts, in order (no repeats, at most MAX_SHORTCUTS) */
  ids: string[];
}

export const DEFAULT_SHORTCUTS: ShortcutState = { custom: false, ids: [] };

/** Something a shortcut can open: a menu item, or one of the default tiles that has somewhere to go. */
export interface ShortcutTarget {
  id: string;
  /** the heading it is listed under in the picker */
  group: string;
  label: string;
  /** one short line under the label */
  sub: string;
  /** a figure shown in place of the icon (a default tile: "66") */
  value?: string;
  icon?: ReactNode;
  onOpen: () => void;
}

export function addShortcut(s: ShortcutState, id: string): ShortcutState {
  if (s.ids.includes(id) || s.ids.length >= MAX_SHORTCUTS) return s;
  return { custom: true, ids: [...s.ids, id] };
}

/** Removing the last one brings the default tiles back. */
export function removeShortcut(s: ShortcutState, id: string): ShortcutState {
  const ids = s.ids.filter((x) => x !== id);
  return ids.length === 0 ? DEFAULT_SHORTCUTS : { custom: true, ids };
}

/** Moves a shortcut so that it takes the place at `toIndex` (the place of the tile it is dropped on); the others make room. */
export function moveShortcut(s: ShortcutState, id: string, toIndex: number): ShortcutState {
  const from = s.ids.indexOf(id);
  if (from < 0) return s;
  const to = Math.max(0, Math.min(s.ids.length - 1, toIndex));
  if (to === from) return s;
  const ids = s.ids.filter((x) => x !== id);
  ids.splice(to, 0, id);
  return { custom: true, ids };
}

export function resetShortcuts(): ShortcutState {
  return DEFAULT_SHORTCUTS;
}

/** What is saved, made safe: only strings, no repeats, at most six; an empty list is the default. */
export function parseShortcuts(raw: unknown): ShortcutState {
  const ids = Array.isArray((raw as { ids?: unknown } | null)?.ids)
    ? [...new Set(((raw as { ids: unknown[] }).ids).filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 60))].slice(0, MAX_SHORTCUTS)
    : [];
  return ids.length === 0 ? DEFAULT_SHORTCUTS : { custom: true, ids };
}

/** The shortcuts that can still be shown (a target that no longer exists is skipped, not an error). */
export function resolveShortcuts<T extends { id: string }>(s: ShortcutState, targets: T[]): T[] {
  return s.ids.map((id) => targets.find((t) => t.id === id)).filter((t): t is T => !!t);
}
