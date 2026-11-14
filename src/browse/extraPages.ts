// Additional stories, "Verses for..." pages and children's pages on the computer: the pages that come inside the app never change; the reader can fetch more
// (one small data file, see src-tauri/src/extra_pages.rs), which is kept in the app's data folder and added after the built-in ones in the three lists.
// This file is the screen's side: reading what was kept when the app starts, fetching a newer file, and telling the screens when the lists have changed.
// The same file the phone reads (mobile/src/extraPages.ts).

import { useEffect, useState } from "react";
import { api } from "../api";
import { setBrowseExtras } from "./data";
import { fetchMessage, NONE, readExtraFile, type ExtraInfo } from "./extraFile";
import { setExtraKidPictures } from "./pictures";
import { setExtraStoryPictures } from "./storyPictures";

export { extraTotal } from "./extraFile";

let info: ExtraInfo = NONE;
const listeners = new Set<() => void>();

/** Puts the file's pages and pictures (or none) into the lists and tells every screen that shows them. */
function apply(text: string | null): ExtraInfo {
  if (!text) {
    setBrowseExtras({});
    setExtraStoryPictures({});
    setExtraKidPictures({});
    info = NONE;
  } else {
    const r = readExtraFile(text);
    const added = setBrowseExtras(r.pages);
    setExtraStoryPictures(r.pictures.stories);
    setExtraKidPictures(r.pictures.children);
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
    /* nothing kept */
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
