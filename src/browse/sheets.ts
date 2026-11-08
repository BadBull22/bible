// Browse: the printable sheet for a children's page. Everything here is plain data (no screen, no app code), so node can test it:
// a word search made from the page's words, the memory verse with some words blanked out, and the sheet itself as study-sheet blocks
// (the same blocks the app prints, saves as Word and copies). Drawing the word search as a picture is in sheetImage.ts (it needs a screen).

import type { SheetBlock } from "../api";
import { ageLabel } from "./browseLogic.ts";
import type { ChildPage } from "./types";

// ---- a small seeded random source, so the same page always makes the same word search -------------------------------
function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the word search ------------------------------------------------------------------------------------------------
export type Level = "easy" | "medium" | "hard";

/** younger children: words run across and down; older: also on the slant; the oldest: also backwards */
const DIRECTIONS: Record<Level, [number, number][]> = {
  easy: [[0, 1], [1, 0]],
  medium: [[0, 1], [1, 0], [1, 1]],
  hard: [[0, 1], [1, 0], [1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1], [-1, 1]],
};

export const levelFor = (age: string): Level => (age === "3-5" ? "easy" : age === "6-8" ? "medium" : "hard");

export interface Placed {
  word: string;
  row: number;
  col: number;
  dr: number;
  dc: number;
}

export interface WordSearch {
  size: number;
  grid: string[][];
  placed: Placed[];
}

/** Puts every word in a square grid and fills the rest with letters. The same words and seed always give the same grid. */
export function wordSearch(wordsIn: string[], level: Level, seedText: string): WordSearch {
  const words = [...new Set(wordsIn.map((w) => w.toUpperCase().replace(/[^A-Z]/g, "")).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (words.length === 0) return { size: 0, grid: [], placed: [] };
  const letters = words.reduce((n, w) => n + w.length, 0);
  let size = Math.max(words[0].length + (level === "easy" ? 1 : 0), Math.ceil(Math.sqrt(letters * 2.4)), level === "easy" ? 8 : 9);
  const dirs = DIRECTIONS[level];
  for (let grow = 0; grow < 8; grow++, size++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const rnd = random(seedFrom(`${seedText}|${size}|${attempt}`));
      const grid: string[][] = Array.from({ length: size }, () => Array(size).fill(""));
      const placed: Placed[] = [];
      let ok = true;
      for (const word of words) {
        let done = false;
        for (let t = 0; t < 300 && !done; t++) {
          const [dr, dc] = dirs[Math.floor(rnd() * dirs.length)];
          const row = Math.floor(rnd() * size);
          const col = Math.floor(rnd() * size);
          const endR = row + dr * (word.length - 1);
          const endC = col + dc * (word.length - 1);
          if (endR < 0 || endR >= size || endC < 0 || endC >= size) continue;
          let fits = true;
          for (let i = 0; i < word.length && fits; i++) {
            const cell = grid[row + dr * i][col + dc * i];
            if (cell && cell !== word[i]) fits = false;
          }
          if (!fits) continue;
          for (let i = 0; i < word.length; i++) grid[row + dr * i][col + dc * i] = word[i];
          placed.push({ word, row, col, dr, dc });
          done = true;
        }
        if (!done) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!grid[r][c]) grid[r][c] = String.fromCharCode(65 + Math.floor(rnd() * 26));
      return { size, grid, placed };
    }
  }
  throw new Error(`could not place the words: ${words.join(", ")}`);
}

/** every word that can be read in the grid along a straight line (for the test: each placed word is there, and where it was put) */
export function readWord(ws: WordSearch, p: Placed): string {
  let s = "";
  for (let i = 0; i < p.word.length; i++) s += ws.grid[p.row + p.dr * i]?.[p.col + p.dc * i] ?? "?";
  return s;
}

// ---- the memory verse with blanks -----------------------------------------------------------------------------------
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The verse with each hint word (its first appearance) replaced by a line, and the words to choose from in a mixed order. */
export function blankOut(verse: string, hints: string[]): { text: string; blanked: string[]; bank: string[] } {
  let text = verse;
  const blanked: string[] = [];
  for (const hint of hints) {
    const m = new RegExp(`(^|[^A-Za-z])(${escapeRe(hint)})(?![A-Za-z])`, "i").exec(text);
    if (!m) continue;
    const at = m.index + m[1].length;
    blanked.push(m[2]);
    text = text.slice(0, at) + "_".repeat(Math.max(7, m[2].length + 3)) + text.slice(at + m[2].length);
  }
  const rnd = random(seedFrom(verse));
  const bank = [...blanked].sort(() => rnd() - 0.5);
  return { text, blanked, bank };
}

// ---- the sheet ------------------------------------------------------------------------------------------------------
export interface Picture {
  src: string;
  width: number;
  height: number;
}

export interface SheetInput {
  /** the memory verse in the BSB, without its number */
  verse: string;
  search: Picture | null;
  /** the word search with the words circled (for the answer key) */
  searchAnswers: Picture | null;
  /** the answer key is printed after the sheet */
  answers: boolean;
  /** the colour picture of the story, small, under the title (a reference for the child) */
  picture?: Picture | null;
  /** the outline picture, on a page of its own after the sheet, to colour in */
  colouringPage?: Picture | null;
}

const text = (t: string): SheetBlock => ({ kind: "para", runs: [{ text: t }] });
const bold = (t: string): SheetBlock => ({ kind: "para", runs: [{ text: t, bold: true }] });

/** The activity sheet as study-sheet blocks: the story, the memory verse to fill in, the questions with lines to write on, the activity and the word search. */
export function kidsSheetBlocks(page: ChildPage, input: SheetInput): SheetBlock[] {
  const out: SheetBlock[] = [];
  const blanks = blankOut(input.verse, page.memory.blanks_hint ?? []);
  out.push({ kind: "title", text: page.title });
  out.push({ kind: "subtitle", text: `${ageLabel(page.age)}. Name: ______________________    Date: ______________` });

  if (input.picture) out.push({ kind: "image", src: input.picture.src, width: input.picture.width, height: input.picture.height, caption: "" });

  out.push({ kind: "heading", text: "The story" });
  for (const para of page.retelling) out.push(text(para));
  out.push({ kind: "para", runs: [{ text: `Read the real story together in the Bible: ${page.read_from}`, italic: true }] });

  out.push({ kind: "heading", text: "The big idea" });
  out.push(bold(page.message));

  out.push({ kind: "heading", text: "Memory verse" });
  out.push(bold(page.memory.ref));
  out.push({ kind: "quote", runs: [{ text: blanks.blanked.length > 0 ? blanks.text : input.verse }] });
  if (blanks.bank.length > 0) out.push(text(`Words to put in: ${blanks.bank.join(",  ")}`));

  out.push({ kind: "heading", text: "Talk about it" });
  page.questions.forEach((q, i) => {
    out.push(bold(`${i + 1}. ${q.q}`));
    out.push({ kind: "lines", count: 2 });
  });

  if (page.try_this) {
    out.push({ kind: "heading", text: "Try this" });
    out.push(text(page.try_this));
  }

  if (input.search) {
    out.push({ kind: "heading", text: "Word search" });
    out.push({ kind: "image", src: input.search.src, width: input.search.width, height: input.search.height, caption: `Find these words: ${page.words.join(",  ")}` });
  }

  if (input.colouringPage) {
    out.push({ kind: "image", src: input.colouringPage.src, width: input.colouringPage.width, height: input.colouringPage.height, caption: `Colour this picture: ${page.title}`, layout: "page" });
  }

  if (input.answers) {
    out.push({ kind: "heading", text: "Answer key (for the grown-up)" });
    out.push(bold(`Memory verse, ${page.memory.ref}`));
    out.push({ kind: "quote", runs: [{ text: input.verse }] });
    page.questions.forEach((q, i) => {
      out.push(bold(`${i + 1}. ${q.q}`));
      out.push(text(q.a));
    });
    if (input.searchAnswers) out.push({ kind: "image", src: input.searchAnswers.src, width: input.searchAnswers.width, height: input.searchAnswers.height, caption: "The words in the word search" });
  }
  return out;
}
