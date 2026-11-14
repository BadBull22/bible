// Pictures and videos the Windows app made, as the phone lists them (the computer copies them into the shared sync folder, in a "pictures" folder). Pure
// helpers: Node tests them (scripts/test_computer_pictures.mts).

export interface PicFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  modified: number;
}

export const isVideo = (f: Pick<PicFile, "mime">) => f.mime.startsWith("video/");

/** "John 3-16 Square" from "John 3-16 Square 1080x1080.png": the name as the reader knows it, without the ending */
export const titleOf = (name: string) => name.replace(/\.[A-Za-z0-9]{2,4}$/, "");

/** "1.4 MB", "820 KB" */
export function sizeText(bytes: number): string {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The kind of thing a share of these files is, for the share sheet: all pictures, all videos, or a mix. */
export function shareMime(files: Pick<PicFile, "mime">[]): string {
  if (files.length > 0 && files.every((f) => f.mime.startsWith("image/"))) return "image/*";
  if (files.length > 0 && files.every((f) => f.mime.startsWith("video/"))) return "video/*";
  return "*/*";
}

/** The line over the list: "12 pictures and 2 videos". */
export function countText(files: Pick<PicFile, "mime">[]): string {
  const v = files.filter(isVideo).length;
  const p = files.length - v;
  const parts: string[] = [];
  if (p > 0) parts.push(`${p} picture${p === 1 ? "" : "s"}`);
  if (v > 0) parts.push(`${v} video${v === 1 ? "" : "s"}`);
  return parts.join(" and ");
}

/** What the phone says after saving: new files saved, and how many were saved before. */
export function savedText(saved: number, already: number, where: string): string {
  const parts: string[] = [];
  if (saved > 0) parts.push(`Saved ${saved} to ${where}`);
  if (already > 0) parts.push(`${already} ${already === 1 ? "was" : "were"} already saved`);
  return (parts.length ? parts.join("; ") : "Nothing to save") + ".";
}
