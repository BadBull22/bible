// The verse for the day: one of these well-loved passages, chosen by the date (the same for
// everyone on a given day, and a different one each day for some months). [book, chapter,
// first verse, last verse]

type Passage = [string, number, number, number];

const PASSAGES: Passage[] = [
  ["John", 3, 16, 16], ["Psalms", 23, 1, 1], ["Proverbs", 3, 5, 6], ["Philippians", 4, 13, 13], ["Romans", 8, 28, 28],
  ["Isaiah", 40, 31, 31], ["Jeremiah", 29, 11, 11], ["Matthew", 11, 28, 28], ["Joshua", 1, 9, 9], ["Philippians", 4, 6, 7],
  ["Romans", 12, 2, 2], ["Psalms", 46, 1, 1], ["Isaiah", 41, 10, 10], ["2 Timothy", 1, 7, 7], ["Matthew", 6, 33, 33],
  ["Hebrews", 11, 1, 1], ["Galatians", 5, 22, 23], ["Ephesians", 2, 8, 9], ["Psalms", 119, 105, 105], ["1 Corinthians", 13, 4, 7],
  ["Romans", 10, 9, 9], ["John", 14, 6, 6], ["Psalms", 27, 1, 1], ["Lamentations", 3, 22, 23], ["1 Peter", 5, 7, 7],
  ["James", 1, 5, 5], ["Micah", 6, 8, 8], ["Psalms", 37, 4, 4], ["Romans", 5, 8, 8], ["2 Corinthians", 5, 17, 17],
  ["Galatians", 2, 20, 20], ["John", 15, 5, 5], ["Matthew", 28, 19, 20], ["Acts", 1, 8, 8], ["Psalms", 91, 1, 2],
  ["Isaiah", 53, 5, 5], ["Hebrews", 4, 16, 16], ["1 John", 1, 9, 9], ["Romans", 8, 38, 39], ["Psalms", 34, 8, 8],
  ["Proverbs", 18, 10, 10], ["John", 8, 32, 32], ["John", 10, 10, 10], ["Ephesians", 6, 10, 11], ["Colossians", 3, 23, 23],
  ["1 Thessalonians", 5, 16, 18], ["Hebrews", 12, 1, 2], ["James", 4, 7, 7], ["1 John", 4, 19, 19], ["Revelation", 3, 20, 20],
  ["Psalms", 121, 1, 2], ["Isaiah", 26, 3, 3], ["Matthew", 5, 16, 16], ["Mark", 11, 24, 24], ["Luke", 1, 37, 37],
  ["John", 11, 25, 25], ["Acts", 2, 38, 38], ["Romans", 15, 13, 13], ["2 Corinthians", 12, 9, 9], ["Ephesians", 3, 20, 20],
  ["Philippians", 1, 6, 6], ["Psalms", 103, 1, 2], ["Psalms", 139, 14, 14], ["Zephaniah", 3, 17, 17], ["Nahum", 1, 7, 7],
  ["John", 16, 33, 33], ["Deuteronomy", 31, 6, 6], ["Psalms", 16, 11, 11], ["Hebrews", 13, 8, 8], ["2 Chronicles", 7, 14, 14],
  ["Joel", 2, 28, 28], ["Acts", 4, 12, 12], ["Titus", 2, 13, 13], ["1 Thessalonians", 4, 16, 17], ["Psalms", 100, 4, 4],
  ["Numbers", 6, 24, 26], ["Habakkuk", 3, 18, 18], ["Romans", 1, 16, 16], ["Matthew", 7, 7, 7], ["Psalms", 51, 10, 10],
  ["Proverbs", 4, 23, 23], ["Isaiah", 43, 2, 2], ["John", 1, 12, 12], ["Mark", 16, 17, 18], ["James", 5, 15, 16],
];

export interface DayVerse {
  book: string;
  chapter: number;
  verse: number;
  verseEnd: number;
}

export function verseForToday(now = new Date()): DayVerse {
  const day = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(2026, 0, 1)) / 86_400_000);
  const [book, chapter, verse, verseEnd] = PASSAGES[((day % PASSAGES.length) + PASSAGES.length) % PASSAGES.length];
  return { book, chapter, verse, verseEnd };
}
