import assert from "node:assert/strict";
import { BASIS_LABEL, BIBLE_AUTHORS } from "../src/bibleAuthors.ts";

// the app's own spelling of the 66 books (the same as books.name in bible.db)
const BOOKS = [
  "Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth", "1 Samuel", "2 Samuel",
  "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra", "Nehemiah", "Esther", "Job", "Psalms", "Proverbs",
  "Ecclesiastes", "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea", "Joel", "Amos",
  "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah", "Haggai", "Zechariah", "Malachi", "Matthew",
  "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians", "Galatians", "Ephesians", "Philippians",
  "Colossians", "1 Thessalonians", "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James", "1 Peter",
  "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation",
];
assert.equal(BOOKS.length, 66);

// forty writers, none twice, each with something to read
assert.equal(BIBLE_AUTHORS.length, 40);
assert.equal(new Set(BIBLE_AUTHORS.map((a) => a.name)).size, 40);
assert.equal(BIBLE_AUTHORS.filter((a) => a.testament === "Old Testament").length, 31);
assert.equal(BIBLE_AUTHORS.filter((a) => a.testament === "New Testament").length, 9);
for (const a of BIBLE_AUTHORS) {
  assert.ok(a.note.length > 20, `${a.name}: a note`);
  assert.ok(a.books.length > 0, `${a.name}: books`);
  assert.ok(a.basis in BASIS_LABEL, `${a.name}: basis`);
  for (const b of a.books) assert.ok(BOOKS.includes(b), `${a.name}: "${b}" is not a book name the app uses`);
}

// every book of the Bible is credited to someone, and the Old and New Testament writers keep to their own books
const credited = new Set(BIBLE_AUTHORS.flatMap((a) => a.books));
assert.deepEqual(BOOKS.filter((b) => !credited.has(b)), []);
const otBooks = BOOKS.slice(0, 39);
for (const a of BIBLE_AUTHORS) {
  const inOt = a.books.every((b) => otBooks.includes(b));
  const inNt = a.books.every((b) => !otBooks.includes(b));
  assert.ok(a.testament === "Old Testament" ? inOt : inNt, `${a.name}: books in the wrong testament`);
}

// a few facts that are easy to get wrong
const by = (name: string) => BIBLE_AUTHORS.find((a) => a.name === name)!;
assert.deepEqual(by("Moses").books, ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"]);
assert.equal(by("Paul").books.length, 13);
assert.deepEqual(by("John").books, ["John", "1 John", "2 John", "3 John", "Revelation"]);
assert.deepEqual(by("Solomon").books, ["Proverbs", "Ecclesiastes", "Song of Solomon"]);
assert.equal(by("The writer of Hebrews").basis, "unknown");
assert.equal(by("The writer of Job").basis, "unknown");
assert.equal(BIBLE_AUTHORS.filter((a) => a.basis === "unknown").length, 2);

console.log("authors: ok");
