import { Book } from "./api";

export interface Reference {
  book: string;
  chapter: number;
  /** absent for a whole chapter ("Romans 8") */
  verse: number | null;
}

// Short forms that aren't simply the start of a book's name, or that several books start with.
const ALIASES: Record<string, string> = {
  gn: "Genesis", ex: "Exodus", exod: "Exodus", lv: "Leviticus", nm: "Numbers", dt: "Deuteronomy", jos: "Joshua", jdg: "Judges", judg: "Judges",
  rth: "Ruth", "1sm": "1 Samuel", "2sm": "2 Samuel", "1kgs": "1 Kings", "2kgs": "2 Kings", "1chr": "1 Chronicles", "2chr": "2 Chronicles",
  ezr: "Ezra", est: "Esther", jb: "Job", ps: "Psalms", psa: "Psalms", psalm: "Psalms", pss: "Psalms", pr: "Proverbs", prv: "Proverbs",
  ecc: "Ecclesiastes", eccl: "Ecclesiastes", qoh: "Ecclesiastes", song: "Song of Solomon", sos: "Song of Solomon", songofsongs: "Song of Solomon",
  canticles: "Song of Solomon", is: "Isaiah", jr: "Jeremiah", lam: "Lamentations", ezk: "Ezekiel", dn: "Daniel", hos: "Hosea", jl: "Joel",
  am: "Amos", ob: "Obadiah", jon: "Jonah", mic: "Micah", na: "Nahum", hab: "Habakkuk", zep: "Zephaniah", hag: "Haggai", zec: "Zechariah",
  mal: "Malachi", mt: "Matthew", mk: "Mark", mrk: "Mark", lk: "Luke", jn: "John", jhn: "John", joh: "John", john: "John", ac: "Acts",
  rm: "Romans", ro: "Romans", "1co": "1 Corinthians", "2co": "2 Corinthians", gl: "Galatians", ep: "Ephesians", php: "Philippians",
  phil: "Philippians", pp: "Philippians", cl: "Colossians", "1th": "1 Thessalonians", "2th": "2 Thessalonians", "1tm": "1 Timothy",
  "2tm": "2 Timothy", tt: "Titus", phm: "Philemon", phlm: "Philemon", philem: "Philemon", hb: "Hebrews", jas: "James", jm: "James",
  "1pt": "1 Peter", "2pt": "2 Peter", "1jn": "1 John", "2jn": "2 John", "3jn": "3 John", "1jhn": "1 John", "2jhn": "2 John", "3jhn": "3 John",
  jud: "Jude", jude: "Jude", rv: "Revelation", rev: "Revelation", revelations: "Revelation", apocalypse: "Revelation",
};

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/^(first|1st|i)\s+(?=[a-z])/, "1")
    .replace(/^(second|2nd|ii)\s+(?=[a-z])/, "2")
    .replace(/^(third|3rd|iii)\s+(?=[a-z])/, "3")
    .replace(/[^a-z0-9]/g, "");

/** The book a name or short form means: an exact name, a known short form, or the one
 * book that starts that way ("gen", "1 cor", "philip"). */
export function findBook(typed: string, books: Book[]): Book | null {
  const key = squash(typed);
  if (!key || /^\d+$/.test(key)) return null;
  const exact = books.find((b) => squash(b.name) === key);
  if (exact) return exact;
  const alias = ALIASES[key];
  if (alias) return books.find((b) => b.name === alias) ?? null;
  const starts = books.filter((b) => squash(b.name).startsWith(key));
  return starts.length === 1 ? starts[0] : null;
}

/** Reads "John 3:16", "jn 3 16", "1 cor 13:4-7", "Romans 8", "ps23" or just "Jude" as a
 * place in the Bible; null for anything else (which is then a search). */
export function parseReference(typed: string, books: Book[]): Reference | null {
  const text = typed.trim();
  const m = /^((?:[1-3]|i{1,3}|first|second|third|1st|2nd|3rd)?\s*[a-z][a-z .]*?)\s*(?:(\d{1,3})(?:\s*[:.,v\s]\s*(\d{1,3}))?(?:\s*[-–]\s*\d{1,3})?)?$/i.exec(text);
  if (!m) return null;
  const book = findBook(m[1], books);
  if (!book) return null;
  // a bare word is a book only when it is typed in full ("Jude", "Romans"), not "love" -> nothing, "mark" -> Mark
  if (!m[2] && squash(m[1]) !== squash(book.name)) return null;
  const chapter = m[2] ? Number(m[2]) : 1;
  if (chapter < 1 || chapter > book.chapters) return null;
  return { book: book.name, chapter, verse: m[3] ? Number(m[3]) : null };
}
