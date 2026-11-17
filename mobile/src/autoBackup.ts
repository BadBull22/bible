// The phone's own backup copies: made by themselves, in Documents/Bible Concordance backup, when something worth keeping changed (see backupPlan.ts), and
// the same file is kept in one small private folder that Google's automatic backup copies to a new phone. Also what "Back up now", "Share a backup" and
// "Restore latest" do. The file is the one the computer reads too.

import { useEffect, useRef } from "react";
import { api, phone, type Counts } from "./api";
import { collectSettings, READ_KEY, STATE_KEY, THEME_KEY } from "./backupSettings";
import { backupFileName, hashOf, isEmpty, timeForCopy } from "./backupPlan";
import { todayIso } from "./plans";

const LAST_KEY = "pocket:backup-last";
const HASH_KEY = "pocket:backup-hash";

const get = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* a convenience only */
  }
};

/** the stored preferences, as text */
export function readSettings() {
  return { state: get(STATE_KEY), theme: get(THEME_KEY), read: get(READ_KEY) };
}

/** when the last copy was made (ms), 0 if never */
export const lastBackupAt = (): number => Number(get(LAST_KEY)) || 0;

/** The text of a backup as it is now (preferences, and the default Bible's text when the reader added it). */
export function makeBackup(version: string) {
  return api.backup(collectSettings(readSettings()), version);
}

/** Makes today's copy in Documents and the one for Google's backup. Returns where it went and what it holds, or null when there is nothing to keep yet. */
export async function backUpNow(version: string, force: boolean): Promise<{ where: string; counts: Counts; bible: string | null } | null> {
  const out = await makeBackup(version);
  if (!force && isEmpty(out.counts, out.bible)) return null;
  const saved = await phone.saveBackupCopy(backupFileName(todayIso()), out.json);
  await api.stashBackup(out.json).catch(() => undefined);
  set(LAST_KEY, String(Date.now()));
  set(HASH_KEY, hashOf(JSON.stringify(readSettings())));
  return { where: saved.where, counts: out.counts, bible: out.bible };
}

/**
 * Keeps the automatic copies: a change to a highlight, bookmark or note (`marksVersion` goes up) or to a preference marks the data changed; the copy is made
 * about two minutes after the last change, or at once when the app goes to the background. Nothing changed, no new file.
 */
export function useAutoBackup(version: string, marksVersion: number, onDone: () => void) {
  const state = useRef({ dirty: false, changedAt: 0, first: true });
  const latest = useRef(version);
  latest.current = version;

  // a highlight, bookmark or note changed (and, the first time, a phone that has never made a copy: made once there is something in it)
  useEffect(() => {
    const s = state.current;
    if (s.first) {
      s.first = false;
      if (lastBackupAt() === 0) {
        s.dirty = true;
        s.changedAt = Date.now();
      }
      return;
    }
    s.dirty = true;
    s.changedAt = Date.now();
  }, [marksVersion]);

  useEffect(() => {
    const flush = async (leaving: boolean) => {
      const s = state.current;
      // a changed preference counts too (they live in the page's storage, so they are looked for, not announced)
      const h = hashOf(JSON.stringify(readSettings()));
      const known = get(HASH_KEY);
      if (known !== null && known !== h && !s.dirty) {
        s.dirty = true;
        s.changedAt = Date.now();
      }
      if (!timeForCopy({ dirty: s.dirty, changedAt: s.changedAt, now: Date.now(), leaving })) return;
      s.dirty = false;
      try {
        await backUpNow(latest.current, false);
        onDone();
      } catch (e) {
        // tried again at the next change; the reader is not bothered
        console.warn("automatic backup failed:", e);
        s.dirty = true;
      }
    };
    const timer = window.setInterval(() => void flush(false), 30_000);
    const hidden = () => {
      if (document.visibilityState === "hidden") void flush(true);
    };
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [onDone]);
}
