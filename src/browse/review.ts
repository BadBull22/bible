// Browse review mode: ONLY in the development app (import.meta.env.DEV). The owner marks each page Good / Change / Remove and may leave a
// comment. The marks are kept in localStorage and, when the desktop commands exist, also in Documents\Bible Concordance\Browse review\browse-review.json
// so that they can be read back. The shipped app has none of this (REVIEW_ON is false and the review bar is never drawn).

import { useSyncExternalStore } from "react";
import { api } from "../api";
import type { BrowseKind } from "./types";

export type Verdict = "good" | "change" | "remove";

export interface ReviewEntry {
  verdict: Verdict | "";
  comment: string;
  /** the page's `review.rev` when it was marked, so a rewritten page shows as not yet reviewed */
  rev: number;
  date: string;
}

export const REVIEW_ON: boolean = import.meta.env.DEV;

const KEY = "browse:review";
type Marks = Record<string, ReviewEntry>;

let marks: Marks = readLocal();
let loadedFromDisk = false;
const listeners = new Set<() => void>();

function readLocal(): Marks {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Marks) : {};
  } catch {
    return {};
  }
}

function emit() {
  marks = { ...marks };
  listeners.forEach((l) => l());
}

function persist() {
  const text = JSON.stringify(marks, null, 2);
  try {
    localStorage.setItem(KEY, text);
  } catch {
    /* storage can be unavailable */
  }
  api.browseReviewSave(text).catch(() => undefined);
}

/** read the file on disk once (it wins over what the browser kept when it has more marks) */
function loadFromDisk() {
  if (loadedFromDisk || !REVIEW_ON) return;
  loadedFromDisk = true;
  api
    .browseReviewLoad()
    .then((text) => {
      if (!text) {
        // no file yet: write the marks this browser already holds, so that they can be read back
        if (Object.keys(marks).length > 0) api.browseReviewSave(JSON.stringify(marks, null, 2)).catch(() => undefined);
        return;
      }
      const disk = JSON.parse(text) as Marks;
      if (disk && typeof disk === "object") {
        marks = { ...marks, ...disk };
        emit();
        // marks that only this browser holds (made before the file existed) go into the file too
        if (Object.keys(marks).some((k) => !(k in disk))) persist();
      }
    })
    .catch(() => undefined);
}

export const reviewKey = (kind: BrowseKind, id: string) => `${kind}:${id}`;

export function setReview(kind: BrowseKind, id: string, rev: number, patch: Partial<Pick<ReviewEntry, "verdict" | "comment">>) {
  const k = reviewKey(kind, id);
  const old = marks[k];
  marks[k] = { verdict: old?.verdict ?? "", comment: old?.comment ?? "", ...patch, rev, date: new Date().toISOString().slice(0, 10) };
  persist();
  emit();
}

export function useReviewMarks(): Marks {
  if (REVIEW_ON) loadFromDisk();
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => marks,
  );
}

/** how many pages of this list have been marked (for the review counts in the list) */
export function reviewedCount(m: Marks, kind: BrowseKind, pages: { id: string; review: { rev: number } }[]): { good: number; change: number; remove: number; open: number } {
  const out = { good: 0, change: 0, remove: 0, open: 0 };
  for (const p of pages) {
    const e = m[reviewKey(kind, p.id)];
    if (e && e.verdict && e.rev === p.review.rev) out[e.verdict]++;
    else out.open++;
  }
  return out;
}
