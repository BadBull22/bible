// The printed bulletin (order of service) made from the Sunday service: the notices, the songs' TITLES (never their
// words: printing words needs a church music licence), and the sermon's title and Scripture. It is a study-sheet
// block list, so it prints, copies and saves as Word like every other sheet.
// Only types are imported, so this file also runs under plain node (scripts/test_bulletin.mts).

import type { SheetBlock, SheetRun } from "./api";
import type { SlideSpec } from "./sermonOutputs";

export interface BulletinNotice {
  title: string;
  body: string;
}

export interface BulletinSermon {
  title: string;
  series: string;
  /** "John 3:16; Romans 8:28" or "" */
  passages: string;
}

export interface BulletinInput {
  church: string;
  /** "YYYY-MM-DD" or "" */
  date: string;
  /** the order of service, one item to a line */
  order: string;
  notices: BulletinNotice[];
  showNotices: boolean;
  sermon: BulletinSermon | null;
  /** ruled lines for the reader's own notes after the sermon (0 = none) */
  noteLines: number;
}

const clean = (s: string | undefined) => (s ?? "").replace(/\r/g, "").trim();

/** The songs of a music presentation, each once, in the order they come: only their titles. */
export function songTitles(slides: SlideSpec[]): string[] {
  const out: string[] = [];
  for (const s of slides) {
    let t = clean(s.song);
    if (!t && (s.kind === "song" || s.kind === "link")) t = clean(s.title).replace(/^[▶►\s]+/, "");
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** The notices of a notices presentation: the slides that carry words (not pictures, links or countdowns). */
export function noticesOf(slides: SlideSpec[]): BulletinNotice[] {
  return slides
    .filter((s) => s.kind === "text" || s.kind === "point" || s.kind === "title")
    .map((s) => ({ title: clean(s.title), body: clean(s.body) }))
    .filter((n) => n.title || n.body);
}

/** The order of service to start from: it can be changed line by line before printing. */
export function defaultOrder(songs: string[], sermon: BulletinSermon | null, hasNotices: boolean): string {
  const lines = ["Welcome and prayer"];
  if (songs.length) lines.push(...songs.map((t, i) => `${i === 0 ? "Worship" : "Song"}: ${t}`));
  else lines.push("Worship");
  if (hasNotices) lines.push("Notices");
  if (sermon?.passages) lines.push(`Scripture reading: ${sermon.passages}`);
  if (sermon?.title) lines.push(`Message: ${sermon.title}${sermon.series ? ` (${sermon.series})` : ""}`);
  lines.push("Response and prayer", "Offering", "Closing blessing");
  return lines.join("\n");
}

/** "Sunday 9 November 2026" from "2026-11-09" (the date as written, whatever time zone this computer is in). */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  if (Number.isNaN(d.getTime())) return "";
  // put together from its parts, so that every computer writes it the same way (some add a comma)
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });
  return `${part({ weekday: "long" })} ${d.getUTCDate()} ${part({ month: "long" })} ${d.getUTCFullYear()}`;
}

/** The coming Sunday as "YYYY-MM-DD" (today, if it is Sunday). */
export function nextSunday(from: Date = new Date()): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** An order-of-service line: "Worship: Amazing Grace" has its label in bold. */
function lineRuns(line: string): SheetRun[] {
  const i = line.indexOf(":");
  if (i > 0 && i < 30) return [{ text: line.slice(0, i + 1), bold: true }, { text: line.slice(i + 1) }];
  return [{ text: line, bold: true }];
}

export function bulletinBlocks(b: BulletinInput): SheetBlock[] {
  const out: SheetBlock[] = [{ kind: "title", text: clean(b.church) || "Order of service" }];
  const when = longDate(b.date);
  out.push({ kind: "subtitle", text: [clean(b.church) ? "Order of service" : "", when].filter(Boolean).join(" · ") || when || "Order of service" });

  const order = b.order.split("\n").map(clean).filter(Boolean);
  if (order.length) {
    out.push({ kind: "heading", text: "Order of service" });
    for (const line of order) out.push({ kind: "para", runs: lineRuns(line) });
  }

  const notices = b.showNotices ? b.notices.filter((n) => n.title || n.body) : [];
  if (notices.length) {
    out.push({ kind: "heading", text: "Notices" });
    for (const n of notices) {
      if (n.title) out.push({ kind: "subheading", text: n.title });
      if (n.body) for (const p of n.body.split(/\n{1,}/).map(clean).filter(Boolean)) out.push({ kind: "para", runs: [{ text: p }] });
    }
  }

  if (b.sermon && (b.sermon.title || b.sermon.passages)) {
    out.push({ kind: "heading", text: "Today's message" });
    if (b.sermon.title) out.push({ kind: "subheading", text: b.sermon.title });
    const meta = [b.sermon.series ? `Series: ${b.sermon.series}` : "", b.sermon.passages ? `Scripture: ${b.sermon.passages}` : ""].filter(Boolean);
    for (const m of meta) out.push({ kind: "para", runs: [{ text: m, italic: true }] });
  }

  if (b.noteLines > 0) {
    out.push({ kind: "subheading", text: "Notes" });
    out.push({ kind: "lines", count: Math.min(b.noteLines, 30) });
  }
  return out;
}
