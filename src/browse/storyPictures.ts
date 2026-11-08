// One picture for each Bible story, built into the app: a painting or engraving that shows the event (James Tissot, Gustave Doré; three colour
// illustrations from Sweet Publishing where neither made one). The collections can still be downloaded in full from the Pictures panel; these are
// the ones every reader has. Each file is the unaltered picture, and credits.json says who made it, where it is from and under which licence.

import credits from "./pictures/stories/credits.json";

const urls = import.meta.glob("./pictures/stories/*.{jpg,jpeg,png}", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

export interface StoryPictureCredit {
  title: string;
  artist: string;
  credit: string;
  licence: string;
  licence_url: string;
  page: string;
  collection: string;
}

/** the address of a story's picture and who it is by, or null when the story has none */
export function storyPicture(id: string): { url: string; credit: StoryPictureCredit } | null {
  const key = Object.keys(urls).find((k) => k.replace(/^\.\/pictures\/stories\//, "").replace(/\.(jpe?g|png)$/, "") === id);
  const credit = (credits as Record<string, StoryPictureCredit>)[id];
  return key && credit ? { url: urls[key], credit } : null;
}

/** the line printed under a picture: what it shows, who made it, the licence */
export function pictureCaption(c: StoryPictureCredit): string {
  const who = c.artist.replace(/ \(published \d{4}\)/, "");
  return `${c.title}, ${who}. ${c.licence.replace(/^Public domain artwork; scans by /, "Public domain; scan by ")}.`;
}
