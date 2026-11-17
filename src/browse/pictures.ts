// The children's pictures (src/browse/pictures/kids): the app's own drawings, <page id>.svg in colour and <page id>-line.svg as an outline to colour in; and,
// for the pages that came after them, a painting <page id>.jpg with <page id>-line.png as its outline, credited in credits.json.

import credits from "./pictures/kids/credits.json";

const urls = import.meta.glob("./pictures/kids/*.svg", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const paintings = import.meta.glob("./pictures/kids/*.{jpg,png}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const CREDITS = credits as unknown as Record<string, ExtraKidPicture["credit"]>;

/** the address of a children's page picture, or null when that page has none yet */
export function kidPicture(id: string, outline = false): string | null {
  const own = urls[`./pictures/kids/${id}${outline ? "-line" : ""}.svg`];
  if (own) return own;
  const painted = paintings[`./pictures/kids/${id}${outline ? "-line.png" : ".jpg"}`];
  if (painted) return painted;
  const extra = EXTRA[id];
  return extra ? (outline ? extra.outline : extra.url) : null;
}

// pictures that came with additional children's pages (the file fetched with "Fetch additional stories", see extraPages.ts): a built-in picture always wins
export interface ExtraKidPicture {
  url: string;
  outline: string | null;
  credit: { title: string; artist: string; credit: string; licence: string; licence_url: string; page: string };
}
let EXTRA: Record<string, ExtraKidPicture> = {};
export function setExtraKidPictures(pictures: Record<string, ExtraKidPicture>): void {
  EXTRA = pictures;
}

/** who made a picture that came with an additional children's page (built-in pictures are original artwork and need none) */
export function kidPictureCredit(id: string): ExtraKidPicture["credit"] | null {
  if (urls[`./pictures/kids/${id}.svg`]) return null;
  return CREDITS[id] ?? EXTRA[id]?.credit ?? null;
}
