// Scripture references written inside a sentence ("... from the lion and the bear (1 Samuel 17:37), and ... the LORD (17:47)."), found so that each can be
// tapped to open that verse. Pure (no React), so that node can test it: mobile/scripts/test_scripture_links.mts.
//
// Two kinds are found, and only these (a loose match could link the wrong verse):
//   * a book, a chapter and a verse or verses:  "1 Samuel 17:37", "Luke 15:3-7", "Psalm 23:1"
//   * a chapter and a verse alone, which belongs to the book named last before it in the same text (or the page's own book): "(17:47)", "17:50-52"
// "verse 37" and "verses 45 to 47" have no chapter and are left as plain words.

/** The books as the app spells them, with the spellings a sentence may use. */
const BOOKS: [string, string][] = [
  ["Genesis", "Genesis"], ["Exodus", "Exodus"], ["Leviticus", "Leviticus"], ["Numbers", "Numbers"], ["Deuteronomy", "Deuteronomy"], ["Joshua", "Joshua"],
  ["Judges", "Judges"], ["Ruth", "Ruth"], ["1 Samuel", "1 Samuel"], ["2 Samuel", "2 Samuel"], ["1 Kings", "1 Kings"], ["2 Kings", "2 Kings"],
  ["1 Chronicles", "1 Chronicles"], ["2 Chronicles", "2 Chronicles"], ["Ezra", "Ezra"], ["Nehemiah", "Nehemiah"], ["Esther", "Esther"], ["Job", "Job"],
  ["Psalms", "Psalms"], ["Psalm", "Psalms"], ["Proverbs", "Proverbs"], ["Ecclesiastes", "Ecclesiastes"], ["Song of Solomon", "Song of Solomon"],
  ["Isaiah", "Isaiah"], ["Jeremiah", "Jeremiah"], ["Lamentations", "Lamentations"], ["Ezekiel", "Ezekiel"], ["Daniel", "Daniel"], ["Hosea", "Hosea"],
  ["Joel", "Joel"], ["Amos", "Amos"], ["Obadiah", "Obadiah"], ["Jonah", "Jonah"], ["Micah", "Micah"], ["Nahum", "Nahum"], ["Habakkuk", "Habakkuk"],
  ["Zephaniah", "Zephaniah"], ["Haggai", "Haggai"], ["Zechariah", "Zechariah"], ["Malachi", "Malachi"], ["Matthew", "Matthew"], ["Mark", "Mark"],
  ["Luke", "Luke"], ["John", "John"], ["Acts", "Acts"], ["Romans", "Romans"], ["1 Corinthians", "1 Corinthians"], ["2 Corinthians", "2 Corinthians"],
  ["Galatians", "Galatians"], ["Ephesians", "Ephesians"], ["Philippians", "Philippians"], ["Colossians", "Colossians"], ["1 Thessalonians", "1 Thessalonians"],
  ["2 Thessalonians", "2 Thessalonians"], ["1 Timothy", "1 Timothy"], ["2 Timothy", "2 Timothy"], ["Titus", "Titus"], ["Philemon", "Philemon"],
  ["Hebrews", "Hebrews"], ["James", "James"], ["1 Peter", "1 Peter"], ["2 Peter", "2 Peter"], ["1 John", "1 John"], ["2 John", "2 John"], ["3 John", "3 John"],
  ["Jude", "Jude"], ["Revelation", "Revelation"],
];
const CANON = new Map(BOOKS);
const NAMES = BOOKS.map(([s]) => s).sort((a, b) => b.length - a.length).map((s) => s.replace(/ /g, "\\s"));
// a book then "chapter:verse(-verse)", or a chapter:verse on its own (not part of a longer number, not the middle of a word)
const REF = new RegExp(`(?<![\\w:])(?:(${NAMES.join("|")})\\s+)?(\\d{1,3}):(\\d{1,3})(?:[-–](\\d{1,3}))?(?![\\w:])`, "g");

export type Piece = { text: string } | { text: string; book: string; chapter: number; verse: number };

/** The sentence cut into plain pieces and references. `defaultBook`: the book a chapter:verse alone belongs to when no book was named before it. */
export function linkRefs(text: string, defaultBook?: string): Piece[] {
  const out: Piece[] = [];
  let last = 0;
  let book = defaultBook;
  for (const m of text.matchAll(REF)) {
    const named = m[1] ? CANON.get(m[1].replace(/\s+/g, " ")) : undefined;
    if (m[1] && !named) continue;
    const use = named ?? book;
    if (!use) continue;
    book = use;
    const start = m.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: m[0], book: use, chapter: Number(m[2]), verse: Number(m[3]) });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
