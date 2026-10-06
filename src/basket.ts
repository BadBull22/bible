// The study basket: gather verses, notes, commentary, dictionary entries and answers from
// anywhere in the app, then turn them into one study sheet (BasketPanel). Items live in
// userdata.db; this module adds them and tells the rest of the UI (the top-bar count, an
// open basket panel) that the basket changed.
import { useEffect, useState } from "react";
import { api, BasketItem, BasketKind, BasketVerseMeta, SheetBlock, SheetRun } from "./api";
import { pictureAsPng } from "./pictures";
import { loadPrefs } from "./readingPrefs";
import { chapterRedLetter, loadRedLetter, splitRed } from "./redLetter";
import { tidyPunctuation } from "./verseSegments";

const EVENT = "basket-changed";

export function notifyBasketChanged() {
  window.dispatchEvent(new Event(EVENT));
}

export async function addToBasket(kind: BasketKind, title: string, body: string, meta?: object): Promise<boolean> {
  try {
    await api.basketAdd(kind, title, body, meta ? JSON.stringify(meta) : "");
    notifyBasketChanged();
    return true;
  } catch {
    return false;
  }
}

/** A verse or verse range, with its text fetched in the given translation. */
export async function addVersesToBasket(book: string, chapter: number, verseStart: number, verseEnd: number, version: string): Promise<boolean> {
  const text = await api.passageText(version, book, chapter, verseStart, verseEnd).catch(() => "");
  const ref = `${book} ${chapter}:${verseStart}${verseEnd > verseStart ? `–${verseEnd}` : ""}`;
  const meta: BasketVerseMeta = { book, chapter, verseStart, verseEnd, version };
  return addToBasket("verse", `${ref} (${version})`, text, meta);
}

/** The basket's items, kept current as they change anywhere in the app. */
export function useBasket(): [BasketItem[], () => void] {
  const [items, setItems] = useState<BasketItem[]>([]);
  const reload = () => {
    api.basketList().then(setItems).catch(() => undefined);
  };
  useEffect(() => {
    reload();
    window.addEventListener(EVENT, reload);
    return () => window.removeEventListener(EVENT, reload);
  }, []);
  return [items, reload];
}

function verseMeta(item: BasketItem): BasketVerseMeta | null {
  try {
    const m = JSON.parse(item.meta) as BasketVerseMeta;
    return m && m.book && m.chapter ? m : null;
  } catch {
    return null;
  }
}

const paras = (text: string): SheetBlock[] =>
  text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ kind: "para", runs: [{ text: p }] }));

/** The basket as a study sheet, in the basket's order. Verses keep their verse numbers
 * (and red letters, when that setting is on). */
export async function basketSheet(items: BasketItem[], title: string, blankLines: number): Promise<SheetBlock[]> {
  const today = new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  const blocks: SheetBlock[] = [
    { kind: "title", text: title.trim() || "Study notes" },
    { kind: "subtitle", text: `Study sheet · ${today}` },
  ];
  const red = loadPrefs().redLetter ? await loadRedLetter() : null;
  for (const item of items) {
    switch (item.kind) {
      case "verse": {
        blocks.push({ kind: "subheading", text: item.title });
        const m = verseMeta(item);
        if (m) {
          const verses = (await api.getChapter(m.version, m.book, m.chapter).catch(() => [])).filter((v) => v.verse >= m.verseStart && v.verse <= m.verseEnd);
          if (verses.length) {
            const ranges = red ? chapterRedLetter(red, m.version, m.book, m.chapter) : {};
            const runs: SheetRun[] = [];
            verses.forEach((v, j) => {
              if (verses.length > 1) runs.push({ text: `${j ? " " : ""}${v.verse} `, bold: true });
              for (const p of splitRed([{ text: tidyPunctuation(v.text.trim()), word: null }], ranges[String(v.verse)])[0]) runs.push(p.red ? { text: p.text, red: true } : { text: p.text });
            });
            blocks.push({ kind: "quote", runs });
            break;
          }
        }
        blocks.push({ kind: "quote", runs: [{ text: item.body }] });
        break;
      }
      case "text":
        if (item.title.trim()) blocks.push({ kind: "heading", text: item.title });
        blocks.push(...paras(item.body));
        break;
      case "picture": {
        let meta: { id?: string; credit?: string } = {};
        try {
          meta = JSON.parse(item.meta);
        } catch {
          /* no picture data */
        }
        const png = meta.id ? await pictureAsPng(meta.id).catch(() => null) : null;
        if (png) {
          blocks.push({ kind: "image", ...png, caption: [item.title, meta.credit].filter(Boolean).join(" — ") });
        } else {
          blocks.push({ kind: "para", runs: [{ text: `[Picture not available: ${item.title}]`, italic: true }] });
        }
        if (item.body.trim()) blocks.push(...paras(item.body));
        break;
      }
      case "commentary":
      case "dictionary":
        blocks.push({ kind: "subheading", text: item.title });
        blocks.push(...paras(item.body));
        blocks.push({ kind: "para", runs: [{ text: item.kind === "commentary" ? "(A commentator's view, not scripture.)" : "(From a Bible reference work, not scripture.)", italic: true }] });
        break;
      default:
        blocks.push({ kind: "subheading", text: item.title });
        blocks.push(...paras(item.body));
    }
  }
  if (blankLines > 0) {
    blocks.push({ kind: "heading", text: "Notes" });
    blocks.push({ kind: "lines", count: blankLines });
  }
  return blocks;
}
