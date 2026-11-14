// The additional pages file on the computer (fetched with "Fetch additional stories", see src-tauri/src/extra_pages.rs): the pure parts: the sentences under the
// button and the pictures inside the file. Pure, so it can be tested under Node (scripts/test_extra_fetch.mts); extraPages.ts does the fetching and the screens.

import { parseExtraPages } from "../../mobile/src/extraValidate.ts";

export interface ExtraInfo {
  stories: number;
  topics: number;
  children: number;
  /** pages in the file that this version of the app could not show */
  skipped: number;
  /** the file's own label, if it has one */
  revision: string;
}

export const NONE: ExtraInfo = { stories: 0, topics: 0, children: 0, skipped: 0, revision: "" };

export const extraTotal = (i: { stories: number; topics: number; children: number }) => i.stories + i.topics + i.children;

/** "1 story, 2 Verses for… pages and 1 children's page" */
export function describe(i: { stories: number; topics: number; children: number }): string {
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

/** who made a picture that came in the file, where it is from and the licence */
export interface ExtraCredit {
  title: string;
  artist: string;
  credit: string;
  licence: string;
  licence_url: string;
  page: string;
}

export interface ExtraPictures {
  /** a story's painting, as an address the page can show */
  stories: Record<string, { url: string; credit: ExtraCredit }>;
  /** a children's page's picture, and its outline to colour in when it has one */
  children: Record<string, { url: string; outline: string | null; credit: ExtraCredit }>;
}

type Any = Record<string, unknown>;
const isObj = (x: unknown): x is Any => typeof x === "object" && x !== null && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0 && x.length < 600;

function creditOf(x: unknown): ExtraCredit | null {
  if (!isObj(x)) return null;
  const f = ["title", "artist", "credit", "licence", "licence_url", "page"] as const;
  if (!f.every((k) => text(x[k]))) return null;
  return { title: x.title as string, artist: x.artist as string, credit: x.credit as string, licence: x.licence as string, licence_url: x.licence_url as string, page: x.page as string };
}

/**
 * The pictures the file carries, for the pages that were accepted only (a JPEG for each, a PNG outline for a children's page, a full credit). The file has
 * already passed the Rust check; this makes the addresses the screens show and drops anything that is not what it should be.
 */
export function picturesFrom(fileText: string, accepted: { stories: string[]; children: string[] }): ExtraPictures {
  const out: ExtraPictures = { stories: {}, children: {} };
  let file: unknown;
  try {
    file = JSON.parse(fileText);
  } catch {
    return out;
  }
  if (!isObj(file)) return out;
  const jpeg = (b: unknown): b is string => typeof b === "string" && b.startsWith("/9j/") && /^[A-Za-z0-9+/=]+$/.test(b);
  const png = (b: unknown): b is string => typeof b === "string" && b.startsWith("iVBOR") && /^[A-Za-z0-9+/=]+$/.test(b);
  if (isObj(file.pictures)) {
    for (const id of accepted.stories) {
      const p = file.pictures[id];
      const credit = isObj(p) ? creditOf(p.credit) : null;
      if (isObj(p) && jpeg(p.image) && credit) out.stories[id] = { url: `data:image/jpeg;base64,${p.image}`, credit };
    }
  }
  if (isObj(file.child_pictures)) {
    for (const id of accepted.children) {
      const p = file.child_pictures[id];
      const credit = isObj(p) ? creditOf(p.credit) : null;
      if (isObj(p) && jpeg(p.image) && credit) out.children[id] = { url: `data:image/jpeg;base64,${p.image}`, outline: png(p.outline) ? `data:image/png;base64,${p.outline}` : null, credit };
    }
  }
  return out;
}

/** The file's text, checked page by page: the pages to add, what was left out, and the pictures that came with them. */
export function readExtraFile(fileText: string) {
  const r = parseExtraPages(fileText);
  const pictures = picturesFrom(fileText, { stories: r.pages.stories.map((s) => s.id), children: r.pages.children.map((c) => c.id) });
  return { ...r, pictures };
}
