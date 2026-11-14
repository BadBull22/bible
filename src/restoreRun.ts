// Restoring a backup: asking first, then putting it back. The words are in restore.ts. A restore only adds (nothing here is deleted), so it is safe to
// ask once and go ahead.

import { api, type BackupFile } from "./api";
import { applyDesktopExtras } from "./backupExtras";
import { backupFolder } from "./autoBackup";
import { broughtText, confirmText } from "./restore";
import { confirmAsk } from "./confirm";

/** Asks, then restores from this backup. Returns the line to show, or null when the reader said no. */
export async function restoreFrom(file: BackupFile): Promise<string | null> {
  if (!(await confirmAsk(confirmText(file.name, file.modified)))) return null;
  const r = await api.importStudy(file.text);
  return broughtText(r, applyDesktopExtras(r.desktop));
}

/** Lets the reader pick a backup file (starting in the backup folder), then restores from it. Null when nothing was chosen or the reader said no. */
export async function restoreFromChosenFile(startIn: string | null): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ multiple: false, directory: false, title: "Choose the backup to restore", defaultPath: startIn || undefined, filters: [{ name: "Backup", extensions: ["json"] }] });
  if (typeof picked !== "string" || !picked) return null;
  return restoreFrom(await api.backupRead(picked));
}

/**
 * "Restore latest": the newest backup there is (the reader's backup folder, the usual one, and the files Back up made in Documents). When there is none
 * the reader is told so and asked to choose a file.
 */
export async function restoreLatest(): Promise<string | null> {
  const folder = backupFolder();
  const latest = await api.backupLatest(folder);
  if (latest) return restoreFrom(latest);
  const defaultFolder = folder ?? (await api.autoBackupFolder().catch(() => ""));
  if (!(await confirmAsk("No backup was found on this computer yet. Choose a backup file to restore (for example one copied from another computer)?"))) return null;
  return restoreFromChosenFile(defaultFolder);
}
