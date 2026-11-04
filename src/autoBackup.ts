// The automatic weekly backup of the reader's notes, highlights, bookmarks, plans and sermons: the same
// JSON file that Export writes (and Import reads back), kept in a folder on this computer. The settings are
// per-viewer conveniences kept in localStorage (with try/catch: storage can be unavailable).
import { api } from "./api";

export const BACKUP_AUTO_KEY = "backup:auto"; // "0" = switched off; anything else (or nothing) = on
export const BACKUP_FOLDER_KEY = "backup:folder"; // a folder the reader chose; nothing = the default folder

export function autoBackupOn(): boolean {
  try {
    return localStorage.getItem(BACKUP_AUTO_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setAutoBackupOn(on: boolean) {
  try {
    localStorage.setItem(BACKUP_AUTO_KEY, on ? "1" : "0");
  } catch {
    /* per-viewer convenience only */
  }
}

/** The folder the reader chose, or null for the default one (Documents\Bible Concordance\Automatic backups). */
export function backupFolder(): string | null {
  try {
    return localStorage.getItem(BACKUP_FOLDER_KEY) || null;
  } catch {
    return null;
  }
}

export function setBackupFolder(folder: string | null) {
  try {
    if (folder) localStorage.setItem(BACKUP_FOLDER_KEY, folder);
    else localStorage.removeItem(BACKUP_FOLDER_KEY);
  } catch {
    /* per-viewer convenience only */
  }
}

/** At start-up: one backup a week, unless switched off. A failure is not shown (it is in the app's log). */
export async function runAutoBackup(): Promise<void> {
  if (!autoBackupOn()) return;
  try {
    await api.autoBackup(backupFolder(), false);
  } catch (e) {
    // a convenience: it tries again next time (console warnings go to the app's log)
    console.warn("automatic backup failed:", e);
  }
}
