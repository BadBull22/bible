// Hebrew and Greek words as text: which language, the vowel points, and the marks the interlinear data puts in a word. No screen code here, so it can be tested alone.

export type OriginalLang = "grc" | "he";

/** the pointed Hebrew letters carry vowel points; a word without them cannot be said */
export const hasHebrewPoints = (text: string) => /[\u05B0-\u05BD\u05BF-\u05C7]/.test(text);

/** An original word as the interlinear data writes it has morpheme marks (ו/לא־\) that are not part of the word: take them off for showing. */
export const tidyOriginal = (text: string) => text.replace(/[/\\]/g, "").trim();

/** The same, ready to be said: the maqaf that joins two Hebrew words is only a joint. */
export const speakable = (text: string) => tidyOriginal(text).replace(/\u05BE/g, " ").trim();

/** the text to say and the language: Hebrew letters or Greek letters */
export function languageOf(text: string): OriginalLang | null {
  if (/[\u0590-\u05FF]/.test(text)) return "he";
  if (/[\u0370-\u03FF\u1F00-\u1FFF]/.test(text)) return "grc";
  return null;
}
