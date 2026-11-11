// Additional stories, "Verses for..." pages and children's pages: the pages that come inside the app never change; the reader can fetch more (a small data
// file made on the computer, see src-tauri/src/extra_pages.rs), which are kept on the phone and added after the built-in ones in the three lists. This file
// is the phone's side: reading what was kept when the app starts, fetching a newer file, and telling the screens when the lists have changed.

import { useEffect, useState } from "react";
import { api } from "./api";
import { setBrowseExtras } from "../../src/browse/data";
import { parseExtraPages } from "./extraValidate";

export interface ExtraInfo {
  stories: number;
  topics: number;
  children: number;
  /** pages in the file that this version of the app could not show */
  skipped: number;
  /** the file's own label, if it has one */
  revision: string;
}

const NONE: ExtraInfo = { stories: 0, topics: 0, children: 0, skipped: 0, revision: "" };
let info: ExtraInfo = NONE;
const listeners = new Set<() => void>();

export const extraTotal = (i: { stories: number; topics: number; children: number }) => i.stories + i.topics + i.children;

/** Puts the file's pages (or none) into the lists and tells every screen that shows them. */
function apply(text: string | null): ExtraInfo {
  if (!text) {
    setBrowseExtras({});
    info = NONE;
  } else {
    const r = parseExtraPages(text);
    const added = setBrowseExtras(r.pages);
    info = { ...added, skipped: r.skipped.length, revision: r.revision };
  }
  listeners.forEach((f) => f());
  return info;
}

/** At start: the pages fetched earlier, if any. Nothing to read (or not readable) leaves the lists as the app made them. */
export async function loadExtraPages(): Promise<void> {
  try {
    apply(await api.extraPagesLoad());
  } catch {
    /* nothing kept, or not on a phone */
  }
}

/** What the lists now hold beyond the built-in pages; the component draws again whenever that changes (the lists themselves are changed in place). */
export function useExtraPages(): ExtraInfo {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    listeners.add(f);
    return () => void listeners.delete(f);
  }, []);
  return info;
}

/** "1 story, 2 Verses for… pages and 1 children's page" */
function describe(i: { stories: number; topics: number; children: number }): string {
  const parts: string[] = [];
  if (i.stories > 0) parts.push(i.stories === 1 ? "1 story" : `${i.stories} stories`);
  if (i.topics > 0) parts.push(i.topics === 1 ? "1 Verses for… page" : `${i.topics} Verses for… pages`);
  if (i.children > 0) parts.push(i.children === 1 ? "1 children's page" : `${i.children} children's pages`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "";
}

/** The sentence under the button after a fetch: what was added, or why nothing was. */
export function fetchMessage(before: ExtraInfo, after: ExtraInfo, unchanged: boolean): string {
  const total = extraTotal(after);
  const pages = (n: number) => (n === 1 ? "1 page" : `${n} pages`);
  if (total === 0) return after.skipped > 0 ? "There are additional stories, but this version of the app can't show them yet." : "There are no additional stories yet. Please look again later.";
  const note = after.skipped > 0 ? ` ${pages(after.skipped)} need a newer version of the app.` : "";
  if (unchanged) return `You already have all of them: ${describe(after)}.${note}`;
  const fresh = { stories: Math.max(0, after.stories - before.stories), topics: Math.max(0, after.topics - before.topics), children: Math.max(0, after.children - before.children) };
  if (extraTotal(fresh) === 0) return `Updated. You have ${describe(after)}.${note}`;
  return extraTotal(before) === 0 ? `Added ${describe(fresh)}.${note}` : `Added ${describe(fresh)}. In all you have ${pages(total)} beyond the ones that came with the app.${note}`;
}

/** The button's state: fetching, and the message to show. */
export function useFetchExtras() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  return {
    busy,
    message,
    failed,
    fetch: async () => {
      if (busy) return;
      setBusy(true);
      setMessage(null);
      setFailed(false);
      const before = info;
      try {
        const got = await api.extraPagesFetch();
        setMessage(fetchMessage(before, apply(got.text), got.unchanged));
      } catch (e) {
        setFailed(true);
        setMessage(String(e));
      } finally {
        setBusy(false);
      }
    },
  };
}
