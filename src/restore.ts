// Restoring a backup: the words the reader sees (what a file is, what the restore brought back). Pure, so it can be tested under Node
// (scripts/test_restore.mts). The doing (asking, reading the file, putting it back) is in restoreRun.ts.

export interface Brought {
  notes: number;
  highlights: number;
  bookmarks: number;
  plans: number;
  sermons: number;
}

/** "12 Nov 2026 at 9:05" (the computer's own time) */
export function whenText(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })} ${d.getFullYear()} at ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The question before anything is changed. */
export function confirmText(name: string, modified: number): string {
  const when = whenText(modified);
  return `Restore from “${name}”${when ? `, saved ${when}` : ""}?\n\nWhat is in it and not here is added to your notes, highlights, bookmarks, reading plans and sermons. Nothing you have now is deleted, and a note is replaced only by a newer copy of itself.`;
}

/** What the restore brought in (the line under the buttons). */
export function broughtText(r: Brought, factory: string): string {
  const parts = [`${r.notes} note${r.notes === 1 ? "" : "s"}`, `${r.highlights} highlight${r.highlights === 1 ? "" : "s"}`, `${r.bookmarks} bookmark${r.bookmarks === 1 ? "" : "s"}`, `${r.plans} reading plan${r.plans === 1 ? "" : "s"}`, `${r.sermons} sermon${r.sermons === 1 ? "" : "s"}`];
  return `Restored ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}. Nothing already here was deleted.${factory ? " " + factory : ""}`;
}
