// Verse of the day: a fixed rotation through well-known verses, chosen by day of the year
// so everyone sees the same verse on the same date and it changes at midnight. Only the
// references live here; the text is read from the bundled BSB at display time.

export const DAILY_VERSES: [string, number, number][] = [
  ["John", 3, 16], ["Psalms", 23, 1], ["Philippians", 4, 13], ["Jeremiah", 29, 11], ["Romans", 8, 28],
  ["Proverbs", 3, 5], ["Proverbs", 3, 6], ["Isaiah", 40, 31], ["Joshua", 1, 9], ["Matthew", 11, 28],
  ["Romans", 12, 2], ["Philippians", 4, 6], ["Philippians", 4, 7], ["2 Timothy", 1, 7], ["Psalms", 46, 1],
  ["Isaiah", 41, 10], ["Galatians", 5, 22], ["Hebrews", 11, 1], ["Romans", 10, 9], ["Ephesians", 2, 8],
  ["Matthew", 6, 33], ["John", 14, 6], ["1 John", 1, 9], ["2 Corinthians", 5, 17], ["Psalms", 119, 105],
  ["Romans", 5, 8], ["Romans", 6, 23], ["Acts", 1, 8], ["Acts", 2, 38], ["Acts", 4, 12],
  ["John", 1, 1], ["John", 1, 12], ["John", 8, 32], ["John", 10, 10], ["John", 11, 25],
  ["John", 14, 27], ["John", 15, 5], ["John", 16, 33], ["Matthew", 5, 16], ["Matthew", 7, 7],
  ["Matthew", 22, 37], ["Matthew", 28, 19], ["Matthew", 28, 20], ["Mark", 10, 27], ["Mark", 11, 24],
  ["Luke", 1, 37], ["Luke", 6, 31], ["Luke", 11, 13], ["Romans", 1, 16], ["Romans", 3, 23],
  ["Romans", 8, 1], ["Romans", 8, 38], ["Romans", 8, 39], ["Romans", 15, 13], ["1 Corinthians", 10, 13],
  ["1 Corinthians", 13, 4], ["1 Corinthians", 13, 13], ["1 Corinthians", 15, 57], ["1 Corinthians", 16, 14], ["2 Corinthians", 12, 9],
  ["Galatians", 2, 20], ["Galatians", 6, 9], ["Ephesians", 3, 20], ["Ephesians", 4, 32], ["Ephesians", 6, 10],
  ["Philippians", 1, 6], ["Philippians", 2, 3], ["Philippians", 4, 8], ["Philippians", 4, 19], ["Colossians", 3, 23],
  ["1 Thessalonians", 5, 16], ["1 Thessalonians", 5, 17], ["1 Thessalonians", 5, 18], ["2 Timothy", 3, 16], ["Titus", 2, 11],
  ["Hebrews", 4, 12], ["Hebrews", 4, 16], ["Hebrews", 10, 23], ["Hebrews", 12, 1], ["Hebrews", 13, 5],
  ["Hebrews", 13, 8], ["James", 1, 2], ["James", 1, 5], ["James", 4, 7], ["James", 5, 16],
  ["1 Peter", 1, 18], ["1 Peter", 2, 9], ["1 Peter", 5, 7], ["2 Peter", 3, 9], ["1 John", 3, 1],
  ["1 John", 4, 4], ["1 John", 4, 8], ["1 John", 4, 19], ["1 John", 5, 14], ["Revelation", 3, 20],
  ["Revelation", 12, 11], ["Revelation", 21, 4], ["Revelation", 22, 17], ["Genesis", 1, 1], ["Genesis", 28, 15],
  ["Exodus", 14, 14], ["Exodus", 15, 26], ["Numbers", 6, 24], ["Deuteronomy", 31, 6], ["Deuteronomy", 31, 8],
  ["1 Samuel", 16, 7], ["2 Chronicles", 7, 14], ["Nehemiah", 8, 10], ["Job", 19, 25], ["Psalms", 1, 1],
  ["Psalms", 16, 11], ["Psalms", 18, 2], ["Psalms", 27, 1], ["Psalms", 34, 8], ["Psalms", 37, 4],
  ["Psalms", 37, 5], ["Psalms", 51, 10], ["Psalms", 55, 22], ["Psalms", 91, 1], ["Psalms", 91, 11],
  ["Psalms", 100, 4], ["Psalms", 103, 2], ["Psalms", 103, 12], ["Psalms", 118, 24], ["Psalms", 121, 1],
  ["Psalms", 121, 2], ["Psalms", 139, 14], ["Psalms", 145, 18], ["Proverbs", 4, 23], ["Proverbs", 16, 3],
  ["Proverbs", 18, 10], ["Proverbs", 22, 6], ["Ecclesiastes", 3, 1], ["Isaiah", 9, 6], ["Isaiah", 26, 3],
  ["Isaiah", 40, 8], ["Isaiah", 43, 2], ["Isaiah", 53, 5], ["Isaiah", 55, 8], ["Isaiah", 55, 11],
  ["Jeremiah", 17, 7], ["Jeremiah", 33, 3], ["Lamentations", 3, 22], ["Lamentations", 3, 23], ["Ezekiel", 36, 26],
  ["Joel", 2, 28], ["Micah", 6, 8], ["Habakkuk", 3, 19], ["Zephaniah", 3, 17], ["Zechariah", 4, 6],
  ["Malachi", 3, 10], ["Matthew", 5, 14], ["Matthew", 6, 34], ["Matthew", 19, 26], ["Mark", 16, 15],
  ["John", 3, 3], ["John", 13, 34], ["Acts", 16, 31], ["Romans", 12, 12], ["Ephesians", 1, 7],
];

export function verseOfTheDay(date = new Date()): [string, number, number] {
  const start = new Date(date.getFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - start.getTime()) / 86_400_000);
  // Offset by year so a given date doesn't repeat the same verse every single year.
  return DAILY_VERSES[(day + date.getFullYear() * 7) % DAILY_VERSES.length];
}
