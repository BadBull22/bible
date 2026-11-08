// Browse: the printable pages, built for the screen (they fetch the Bible words and draw the pictures). The pure parts are in sheets.ts and printBlocks.ts.

import { api, SheetBlock } from "../api";
import { parseRef } from "./browseLogic";
import { storyBlocks, topicBlocks, type Texts } from "./printBlocks";
import { kidPicture } from "./pictures";
import { pictureCaption, storyPicture } from "./storyPictures";
import { drawWordSearch } from "./sheetImage";
import { rasterize } from "./rasterize";
import { kidsSheetBlocks, levelFor, wordSearch } from "./sheets";
import { printSheet } from "../studySheet";
import type { ChildPage, Story, Topic } from "./types";

/** the words of a passage in the Bible the reader chose (the BSB when that Bible does not have it) */
async function words(ref: string, code: string): Promise<string> {
  const r = parseRef(ref);
  if (!r) return "";
  const ask = (c: string) => api.passageText(c, r.book, r.chapter, r.verse, r.verseEnd).catch(() => "");
  return (await ask(code)) || (code === "BSB" ? "" : await ask("BSB"));
}

async function wordsFor(refs: string[], code: string): Promise<Texts> {
  const out: Texts = {};
  await Promise.all(refs.map(async (ref) => (out[ref] = await words(ref, code))));
  return out;
}

/**
 * The activity sheet for a children's page. `picture`: the colour picture, small, as a reference under the title.
 * `colouringPage`: the outline picture on a page of its own at the end, to colour in.
 */
export async function childSheet(page: ChildPage, o: { answers: boolean; picture: boolean; colouringPage: boolean }): Promise<SheetBlock[]> {
  // the memory verse is always the BSB, like the rest of the children's pages
  const verse = await words(page.memory.ref, "BSB");
  const ws = wordSearch(page.words, levelFor(page.age), page.id);
  const colour = o.picture ? kidPicture(page.id) : null;
  const outline = o.colouringPage ? kidPicture(page.id, true) : null;
  const picture = colour ? await rasterize(colour, 320, 240) : null;
  const colouringPage = outline ? await rasterize(outline, 1500, 1100) : null;
  return kidsSheetBlocks(page, { verse, picture, colouringPage, search: drawWordSearch(ws, false), searchAnswers: drawWordSearch(ws, true), answers: o.answers });
}

/** A story as a printed page. `picture`: its painting or engraving, small, under the title (a reference picture). */
export async function storySheet(page: Story, code: string, o: { words: boolean; picture: boolean }): Promise<SheetBlock[]> {
  const refs = [...(page.context ? [page.context.ref] : []), ...page.passages.map((p) => p.ref)];
  const found = o.picture ? storyPicture(page.id) : null;
  const png = found ? await rasterize(found.url, 320, 340) : null;
  const picture = found && png ? { ...png, caption: pictureCaption(found.credit) } : null;
  return storyBlocks(page, o.words ? await wordsFor(refs, code) : {}, picture);
}

export async function topicSheet(page: Topic, code: string, withWords: boolean): Promise<SheetBlock[]> {
  return topicBlocks(page, withWords ? await wordsFor(page.items.map((i) => i.ref), code) : {});
}

/** straight to the print dialog: only this page is printed (everything else in the window is hidden while it prints) */
export const printPage = (blocks: SheetBlock[], large = false) => printSheet(blocks, { page: "a4", large });
