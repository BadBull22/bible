// The sermon builder's working parts. Nothing here writes a sermon: it gathers Scripture,
// cross-references, commentary, dictionary articles, word studies, the reader's own notes
// and passages from their books on a subject, and lays out what the preacher ticks and
// arranges as a document. The words of the sermon are the preacher's.
//
// Gathering uses what the app already has -- search by meaning (sentences work), word
// search, the topical Bibles (Nave's, Torrey's), cross-references, commentaries -- plus a
// short table of passages known by name ("Sermon on the Mount").
import { api, BookInfo, Discourse, IllustrationItem, LibraryMention, SheetBlock, SpurgeonSermon, SheetRun, Version } from "./api";
import { plainText } from "./components/RichText";
import type { Role } from "./sermonTemplates";
import { KIND_LABEL, type MediaRef, type PngPicture } from "./sermonMedia";

/** "section": one part of a passage being preached through; "background": a book's or a
 * chapter's introduction; "people": the people and places in the passage; "quote" and
 * "outline": quotations and historic sermon outlines (public domain). */
export type MaterialKind =
  | "passage"
  | "section"
  | "verse"
  | "xref"
  | "background"
  | "people"
  | "commentary"
  | "article"
  | "mention"
  | "word"
  | "note"
  | "illustration"
  | "quote"
  | "outline"
  | "sermon";

export interface Ref {
  book: string;
  chapter: number;
  verse: number;
  verseEnd: number;
}

/** One thing that can go into a sermon. */
export interface Material {
  key: string;
  kind: MaterialKind;
  /** "John 3:16–17 (BSB)", "Matthew Henry on John 3:16", "Faith — Easton's" */
  title: string;
  text: string;
  /** where it's from, when the title doesn't already say */
  source?: string;
  ref?: Ref;
  /** which of the typed topics it was found for */
  topic: string;
}

/** One line of the sermon as it is arranged. A "block" is a section the preacher writes
 * (Introduction, Explain, Apply, ...) with the question it answers; a "heading" starts a
 * point; "note" is the preacher's own words outside any section (from earlier versions). */
export type SermonItem =
  | { id: string; type: "material"; material: Material }
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "note"; text: string }
  | { id: string; type: "block"; role: Role; label: string; prompt: string; text: string; level: 1 | 2 }
  /** a picture, video, music, file or web link the preacher added (sermonMedia.ts) */
  | { id: string; type: "media"; media: MediaRef };

export const GROUPS: { kind: MaterialKind; label: string; about: string }[] = [
  { kind: "passage", label: "Key passages", about: "The passages most central to the subject." },
  { kind: "section", label: "The passage, section by section", about: "The passage divided into parts, to take one at a time." },
  { kind: "background", label: "Background", about: "Introductions to the book and the chapter. The writers' views are their own." },
  { kind: "people", label: "People and places", about: "Who and where the passage mentions." },
  { kind: "verse", label: "Supporting verses", about: "Other verses on the subject." },
  { kind: "xref", label: "Cross-references", about: "Verses linked to the key passages." },
  { kind: "commentary", label: "Commentary", about: "What commentators say on the key passages. Their views are their own." },
  { kind: "article", label: "Dictionary and topical articles", about: "Bible dictionary and topical Bible entries." },
  { kind: "mention", label: "In your Library", about: "What the books, devotionals, dictionaries and commentaries you've downloaded say on the subject, and where they refer to the passages." },
  { kind: "word", label: "Word studies", about: "The Hebrew and Greek words behind the subject." },
  { kind: "note", label: "Your own notes", about: "Notes you've written that touch the subject." },
  { kind: "illustration", label: "Illustrations", about: "Stories from D. L. Moody's books, each with its source." },
  { kind: "quote", label: "Quotations", about: "Sayings of Moody and Spurgeon, with their source." },
  { kind: "outline", label: "How others outlined it", about: "Historic sermon outlines on the passage — to learn from, not to copy." },
  { kind: "sermon", label: "Spurgeon preached on it", about: "C. H. Spurgeon's sermons on these texts (1855–1891), with how each began. Read them in full at CCEL." },
];

export interface Gathered {
  topics: string[];
  materials: Material[];
}

// ---------------------------------------------------------------- passages known by name

type Named = [names: string[], book: string, chapter: number, verse: number, verseEnd: number, lastChapter?: number];

/** Passages people ask for by name. A `lastChapter` means whole chapters (Matthew 5-7). */
const NAMED: Named[] = [
  [["sermon on the mount"], "Matthew", 5, 1, 0, 7],
  [["beatitudes"], "Matthew", 5, 3, 12],
  [["lord's prayer", "lords prayer", "our father"], "Matthew", 6, 9, 13],
  [["golden rule"], "Matthew", 7, 12, 12],
  [["great commission"], "Matthew", 28, 18, 20],
  [["great commandment", "greatest commandment"], "Matthew", 22, 36, 40],
  [["ten commandments", "decalogue"], "Exodus", 20, 1, 17],
  [["creation"], "Genesis", 1, 1, 31],
  [["the fall", "fall of man"], "Genesis", 3, 1, 24],
  [["the flood", "noah's ark", "noahs ark"], "Genesis", 7, 1, 24],
  [["passover"], "Exodus", 12, 1, 28],
  [["shepherd psalm", "the lord is my shepherd", "psalm 23"], "Psalms", 23, 1, 6],
  [["suffering servant"], "Isaiah", 53, 1, 12],
  [["valley of dry bones", "dry bones"], "Ezekiel", 37, 1, 14],
  [["birth of jesus", "nativity", "christmas"], "Luke", 2, 1, 20],
  [["baptism of jesus"], "Matthew", 3, 13, 17],
  [["temptation of jesus", "temptation in the wilderness"], "Matthew", 4, 1, 11],
  [["transfiguration"], "Matthew", 17, 1, 9],
  [["prodigal son", "lost son"], "Luke", 15, 11, 32],
  [["good samaritan"], "Luke", 10, 25, 37],
  [["parable of the sower", "the sower"], "Matthew", 13, 1, 23],
  [["good shepherd"], "John", 10, 1, 18],
  [["true vine", "the vine and the branches"], "John", 15, 1, 17],
  [["born again", "new birth", "nicodemus"], "John", 3, 1, 21],
  [["woman at the well", "samaritan woman"], "John", 4, 1, 42],
  [["raising of lazarus", "lazarus"], "John", 11, 1, 44],
  [["triumphal entry", "palm sunday"], "Matthew", 21, 1, 11],
  [["last supper", "lord's supper", "lords supper", "communion"], "Luke", 22, 14, 23],
  [["gethsemane"], "Matthew", 26, 36, 46],
  [["crucifixion", "crucifixtion", "the cross", "good friday"], "Luke", 23, 26, 49],
  [["resurrection", "ressurection", "easter", "empty tomb"], "Luke", 24, 1, 12],
  [["road to emmaus", "emmaus"], "Luke", 24, 13, 35],
  [["ascension"], "Acts", 1, 1, 11],
  [["pentecost", "day of pentecost", "outpouring of the spirit"], "Acts", 2, 1, 21],
  [["conversion of paul", "damascus road", "road to damascus"], "Acts", 9, 1, 19],
  [["love chapter"], "1 Corinthians", 13, 1, 13],
  [["resurrection chapter"], "1 Corinthians", 15, 1, 28],
  [["fruit of the spirit"], "Galatians", 5, 16, 26],
  [["armour of god", "armor of god", "spiritual warfare"], "Ephesians", 6, 10, 18],
  [["faith chapter", "hall of faith", "heroes of faith"], "Hebrews", 11, 1, 40],
  [["rapture", "catching away"], "1 Thessalonians", 4, 13, 18],
  [["new heaven and new earth", "new jerusalem"], "Revelation", 21, 1, 8],
];

/** Where the 19th-century topical Bibles keep a subject that is asked for in today's words. */
const TOPIC_ALIASES: Record<string, string[]> = {
  healing: ["disease", "miracles", "physician"],
  heal: ["disease", "miracles"],
  sickness: ["disease", "afflictions"],
  salvation: ["salvation", "regeneration"],
  rapture: ["second coming of christ, the", "jesus, the christ"],
  worry: ["care", "anxiety"],
  anxiety: ["care"],
  depression: ["afflictions", "despondency"],
  suffering: ["afflictions"],
  trials: ["afflictions", "temptation"],
  cross: ["crucifixion", "atonement"],
  crucifixion: ["atonement"],
  marriage: ["marriage", "husband", "wife"],
  money: ["riches", "liberality"],
  giving: ["liberality", "alms"],
  tithing: ["tithes"],
  worship: ["worship", "praise"],
  holiness: ["holiness", "sanctification"],
  revival: ["revivals"],
  evangelism: ["missions", "minister"],
  discipleship: ["disciples", "self-denial"],
  obedience: ["obedience"],
  hope: ["hope"],
  grace: ["grace"],
  mercy: ["mercy"],
  peace: ["peace"],
  joy: ["joy"],
  fear: ["fear of god", "courage"],
};

const STOP = new Set(
  "a an and are as at be but by can do does for from had has have he her his how i if in into is it its me my no not of on or our shall she should so that the their them then there these they this to us was we were what when where which who why will with would you your about after all also any been being did get got him just more most must only over some than too very".split(
    " ",
  ),
);

/** The words of a topic that carry its meaning (for word searches; sentences go to
 * search-by-meaning whole). */
export function keywords(topic: string): string[] {
  const words = topic
    .toLowerCase()
    .replace(/[^\p{L}\p{N}' -]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  return [...new Set(words)];
}

export function refLabel(r: Ref): string {
  return `${r.book} ${r.chapter}:${r.verse}${r.verseEnd > r.verse ? `–${r.verseEnd}` : ""}`;
}

/** A sentence or two around the first place `words` appear in `text`. */
function excerpt(text: string, words: string[], max: number): string {
  const plain = plainText(text).replace(/⟪\d+⟫/g, "").replace(/\s+/g, " ").trim();
  if (plain.length <= max) return plain;
  const lower = plain.toLowerCase();
  const at = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  let start = Math.max(0, at - Math.floor(max / 3));
  const stop = plain.lastIndexOf(". ", start);
  start = stop >= 0 && start - stop < 200 ? stop + 2 : start;
  let out = plain.slice(start, start + max);
  const end = out.lastIndexOf(". ");
  if (end > max * 0.5) out = out.slice(0, end + 1);
  return (start > 0 ? "… " : "") + out.trim() + (start + out.length < plain.length ? " …" : "");
}

// ---------------------------------------------------------------- gathering

const verseKey = (book: string, chapter: number, verse: number) => `${book}|${chapter}|${verse}`;

/** Why a passage was found, in the reader's words. */
const WHY: Record<string, string> = {
  core: "core passage",
  phrase: "has your exact words",
  words: "has the words",
  some: "has some of the words",
  topical: "topical Bible",
  meaning: "close in meaning",
};

async function gatherTopic(topic: string, version: string, books: BookInfo[], onStage: (s: string) => void): Promise<Material[]> {
  const out: Material[] = [];
  const words = keywords(topic);
  const lower = topic.toLowerCase().trim();
  const canon = new Set(books.filter((b) => b.testament !== "Apocrypha").map((b) => b.name));
  const add = (m: Omit<Material, "topic">) => {
    if (m.text.trim() && !out.some((x) => x.key === m.key)) out.push({ ...m, topic });
  };
  const passage = async (r: Ref) => (await api.passageText(version, r.book, r.chapter, r.verse, r.verseEnd).catch(() => "")) || (await api.passageText("BSB", r.book, r.chapter, r.verse, r.verseEnd).catch(() => ""));

  // --- 1. a passage asked for by name, or by reference ("Romans 8", "John 3:16")
  onStage("Looking for the passages");
  const named: Ref[] = [];
  for (const [names, book, chapter, verse, verseEnd, lastChapter] of NAMED) {
    if (!names.some((n) => lower === n || lower.includes(n))) continue;
    if (lastChapter) for (let c = chapter; c <= lastChapter; c++) named.push({ book, chapter: c, verse: 1, verseEnd: 200 });
    else named.push({ book, chapter, verse, verseEnd });
  }
  const typed = /^([1-3]?\s*[a-z][a-z .]*?)\s*(\d+)(?::(\d+)(?:\s*[-–]\s*(\d+))?)?$/i.exec(topic.trim());
  if (typed) {
    const name = typed[1].replace(/\./g, "").replace(/\s+/g, " ").trim().toLowerCase();
    const book = books.find((b) => b.name.toLowerCase() === name) ?? books.find((b) => b.name.toLowerCase().startsWith(name) && name.length >= 3);
    if (book && canon.has(book.name)) {
      const verse = typed[3] ? Number(typed[3]) : 1;
      named.push({ book: book.name, chapter: Number(typed[2]), verse, verseEnd: typed[3] ? Number(typed[4] ?? typed[3]) : 200 });
    }
  }
  for (const r of named) {
    const text = await passage(r);
    if (!text) continue;
    const whole = r.verseEnd >= 200;
    add({ key: `p:${verseKey(r.book, r.chapter, r.verse)}:${r.verseEnd}`, kind: "passage", title: whole ? `${r.book} ${r.chapter}` : refLabel(r), text, source: version, ref: r });
  }

  // --- 2. Scripture on the subject. The app's sermon search (sermon.rs) brings the core
  //        passages, the exact words, every form of the words and the topical Bibles'
  //        lists; search by meaning adds verses that say it in other words.
  onStage("Finding Scripture on the subject");
  interface Cand {
    ref: Ref;
    score: number;
    text: string;
    why: string[];
  }
  const cands: Cand[] = (await api.sermonVerses(topic, 220).catch(() => [])).map((h) => ({
    ref: { book: h.book, chapter: h.chapter, verse: h.verse, verseEnd: h.verse_end },
    score: h.score,
    text: h.text,
    why: [...h.why],
  }));
  const byMeaning = await api.semanticSearch(topic, 40).catch(() => []);
  byMeaning.forEach((h, i) => {
    if (!canon.has(h.book)) return;
    const weight = 1.6 * (1 - i / 50);
    const inside = cands.find((c) => c.ref.book === h.book && c.ref.chapter === h.chapter && h.verse >= c.ref.verse && h.verse <= c.ref.verseEnd);
    if (inside) {
      if (!inside.why.includes("meaning")) {
        inside.why.push("meaning");
        inside.score += weight;
      }
    } else {
      cands.push({ ref: { book: h.book, chapter: h.chapter, verse: h.verse, verseEnd: h.verse }, score: weight, text: h.text, why: ["meaning"] });
    }
  });
  cands.sort((a, b) => b.score - a.score);
  const taken = (r: Ref) => out.some((m) => m.ref && m.ref.book === r.book && m.ref.chapter === r.chapter && r.verse >= m.ref.verse && r.verse <= m.ref.verseEnd);
  const fresh = cands.filter((c) => !taken(c.ref));
  // the strongest are the key passages; the rest (up to 70) stay available as supporting verses
  const keyCount = Math.max(0, 10 - out.length);
  fresh.slice(0, keyCount + 70).forEach((c, i) =>
    add({
      key: `v:${verseKey(c.ref.book, c.ref.chapter, c.ref.verse)}`,
      kind: i < keyCount ? "passage" : "verse",
      title: refLabel(c.ref),
      text: c.text,
      source: `BSB · ${c.why.map((w) => WHY[w] ?? w).join(", ")}`,
      ref: c.ref,
    }),
  );
  const keyPassages = out.filter((m) => m.kind === "passage" && m.ref).slice(0, 5);

  // the dictionary and topical articles on the subject (used in step 5)
  const also = words.flatMap((w) => TOPIC_ALIASES[w] ?? []);
  const lookups = [...new Set([topic, ...words.slice(0, 3), ...also])];
  const dictHits = (await Promise.all(lookups.map((q) => api.searchDictionaries(q, null, 10).catch(() => [])))).flat();
  const wanted = new Set([lower, ...words, ...also]);
  const seenEntry = new Set<number>();
  const entries = (
    await Promise.all(
      dictHits
        .filter((h) => wanted.has(h.headword.toLowerCase()) || h.headword.toLowerCase().startsWith(lower))
        .filter((h) => !seenEntry.has(h.id) && seenEntry.add(h.id))
        .slice(0, 8)
        .map((h) => api.dictionaryEntry(h.id).catch(() => null)),
    )
  ).filter((e): e is NonNullable<typeof e> => !!e);

  // --- 3. cross-references of the key passages
  onStage("Following cross-references");
  for (const k of keyPassages.slice(0, 4)) {
    const refs = await api.crossReferencesFor(k.ref!.book, k.ref!.chapter, k.ref!.verse).catch(() => []);
    for (const x of refs.filter((r) => canon.has(r.to_book)).slice(0, 4)) {
      const r: Ref = { book: x.to_book, chapter: x.to_chapter, verse: x.to_verse_start, verseEnd: Math.max(x.to_verse_start, x.to_verse_end) };
      if (taken(r)) continue;
      const text = await api.passageText("BSB", r.book, r.chapter, r.verse, r.verseEnd).catch(() => "");
      add({ key: `x:${verseKey(r.book, r.chapter, r.verse)}`, kind: "xref", title: refLabel(r), text, source: `BSB · linked from ${refLabel(k.ref!)}`, ref: r });
    }
  }

  // --- 4. commentary on the key passages (the commentators' own views)
  onStage("Reading the commentaries");
  const commentaries = (await api.listCommentaries().catch(() => [])).slice(0, 5);
  for (const k of keyPassages.slice(0, 3)) {
    for (const c of commentaries) {
      const ch = await api.getCommentaryChapter(c.id, k.ref!.book, k.ref!.chapter).catch(() => null);
      const section = ch?.sections.filter((s) => s.verse_start <= k.ref!.verse).pop();
      if (!section?.text.trim()) continue;
      add({
        key: `c:${c.id}:${verseKey(k.ref!.book, k.ref!.chapter, section.verse_start)}`,
        kind: "commentary",
        title: `${c.name} on ${k.ref!.book} ${k.ref!.chapter}:${section.verse_start}`,
        text: excerpt(section.text, words, 1100),
        ref: { ...k.ref!, verse: section.verse_start, verseEnd: section.verse_start },
      });
    }
  }

  // --- 4b. how others outlined the key passages, and sermons titled with the subject
  for (const k of keyPassages.slice(0, 5)) {
    for (const d of (await api.sermonOutlines(k.ref!.book, k.ref!.chapter, k.ref!.verse, k.ref!.verseEnd).catch(() => [])).slice(0, 2)) add(outlineMaterial(d, topic));
  }
  for (const d of await api.sermonOutlinesTitled(words.length ? words.join(" ") : topic, 6).catch(() => [])) add(outlineMaterial(d, topic));

  // --- 5. dictionary and topical articles
  for (const e of entries) {
    add({ key: `a:${e.id}`, kind: "article", title: `${e.headword} — ${e.dict_name}`, text: excerpt(e.body, words, 1400) });
  }

  // --- 6. the Hebrew and Greek words
  onStage("Looking up the original words");
  for (const w of words.slice(0, 3)) {
    const found = await api.originalWordLookup(w, 3).catch(() => []);
    for (const cand of found.slice(0, 2)) {
      const s = await api.strongsLookup(cand.strongs).catch(() => null);
      const def = [s?.strongs_def, s?.kjv_def ? `KJV: ${s.kjv_def}` : ""].filter(Boolean).join(" ").trim();
      add({
        key: `w:${cand.strongs}`,
        kind: "word",
        title: `${cand.lemma}${s?.xlit ? ` (${s.xlit})` : ""} — ${cand.gloss}`,
        text: `${cand.language}, Strong's ${cand.strongs}, used ${cand.count.toLocaleString()} times. ${def}`.trim(),
      });
    }
  }

  // --- 7. the reader's own notes: on the gathered verses, or mentioning the subject
  const notes = (await api.listStudy().catch(() => null))?.notes ?? [];
  const gatheredVerses = out.filter((m) => m.ref);
  for (const n of notes) {
    const onVerse = gatheredVerses.some((m) => m.ref!.book === n.book && m.ref!.chapter === n.chapter && n.verse >= m.ref!.verse && n.verse <= m.ref!.verseEnd);
    const hay = `${n.value} ${(n.tags ?? []).join(" ")}`.toLowerCase();
    if (!onVerse && !(words.length && words.every((w) => hay.includes(w))) && !hay.includes(lower)) continue;
    const r: Ref = { book: n.book, chapter: n.chapter, verse: n.verse, verseEnd: n.verse_end ?? n.verse };
    add({ key: `n:${verseKey(n.book, n.chapter, n.verse)}`, kind: "note", title: `My note on ${refLabel(r)}`, text: n.value, ref: r });
  }

  // --- 7b. stories and sayings on the subject
  for (const i of await api.sermonIllustrations(topic, 14).catch(() => [])) add(illustrationMaterial(i, topic));

  // --- 7c. Spurgeon's sermons: titled with the subject, and on the key passages
  for (const s of await api.spurgeonSermonsTitled(topic, 6).catch(() => [])) add(spurgeonMaterial(s));
  for (const p of out.filter((m) => m.kind === "passage" && m.ref).slice(0, 4)) {
    for (const s of (await api.spurgeonSermonsOn(p.ref!.book, p.ref!.chapter, p.ref!.verse, p.ref!.verseEnd).catch(() => [])).slice(0, 2)) add(spurgeonMaterial(s));
  }

  // --- 8. the reader's books: what they say on the subject, and where they refer to the key passages
  onStage("Searching your Library");
  for (const h of await api.libraryTopic(topic, 3, 20).catch(() => [])) add(mentionMaterial(h));
  for (const p of out.filter((m) => m.kind === "passage" && m.ref).slice(0, 3)) {
    for (const m of await libraryMentions(p.ref!.book, p.ref!.chapter, p.ref!.verse, p.ref!.verseEnd, 6)) add(m);
  }
  return out;
}

// ---------------------------------------------------------------- in the reader's Library

/** Where the downloaded books, dictionaries, devotionals and commentaries refer to a passage. */
export async function libraryMentions(book: string, chapter: number, verse: number, verseEnd: number, limit: number, perModule = 3): Promise<Omit<Material, "topic">[]> {
  const found = await api.libraryMentions(book, chapter, verse, verseEnd, perModule, limit).catch(() => null);
  return (found?.hits ?? []).map(mentionMaterial);
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A Library place's title; devotional entries are keyed by date ("01.02" -> "2 January"). */
export function mentionTitle(h: LibraryMention): string {
  const day = h.kind === "devotional" ? /^(\d{2})\.(\d{2})$/.exec(h.title.trim()) : null;
  return day ? `${Number(day[2])} ${MONTHS[Number(day[1]) - 1] ?? day[1]}` : h.title;
}

/** A place in the reader's Library as material: the paragraph, with the book it is from. */
export function mentionMaterial(h: LibraryMention): Omit<Material, "topic"> {
  const title = mentionTitle(h);
  return {
    key: `lm:${h.module}:${h.kind === "commentary" ? "c" : ""}${h.id}`,
    kind: "mention",
    title,
    text: h.snippet,
    source: h.cited ? `${h.module_title}, citing ${h.cited}` : h.module_title,
  };
}

// ---------------------------------------------------------------- Spurgeon's sermons

/** A Spurgeon sermon's text, as "John 3:16" or "John 3". */
export function spurgeonText(s: SpurgeonSermon): string {
  if (!s.verse) return `${s.book} ${s.chapter}`;
  return `${s.book} ${s.chapter}:${s.verse}${s.verse_end > s.verse ? `–${s.verse_end}` : ""}`;
}

/** "7 January 1877" from "1877-01-07". */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}

/** A Spurgeon sermon as material: its number, text, when and where, and how it began. */
export function spurgeonMaterial(s: SpurgeonSermon): Omit<Material, "topic"> {
  const when = [s.date ? `preached ${longDate(s.date)}` : "", s.place ? `at the ${s.place}` : ""].filter(Boolean).join(" ");
  return {
    key: `sp:${s.n}`,
    kind: "sermon",
    title: `No. ${s.n}: ${s.title} — ${spurgeonText(s)}`,
    text: `${when ? `Spurgeon, ${when}. ` : ""}It began:\n\n${s.opening}\n\nRead it in full: ${s.url}`,
    source: "Spurgeon",
  };
}

// ---------------------------------------------------------------- how others outlined it

const ROMAN_HEADS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/** A Simeon discourse as material: its outline, numbered as he numbered it. */
export function outlineMaterial(d: Discourse, topic: string): Material {
  let head = 0;
  let point = 0;
  const lines = d.outline.map((o) => {
    if (o.level === 1) {
      point = 0;
      return `${ROMAN_HEADS[head++] ?? "•"}. ${o.text}`;
    }
    return `    ${++point}. ${o.text}`;
  });
  const ref: Ref = { book: d.book, chapter: d.chapter, verse: d.verse, verseEnd: d.verse_end };
  return {
    key: `o:${d.n}`,
    kind: "outline",
    title: `Simeon: “${d.title}” — ${refLabel(ref)}`,
    text: [d.announce ? `${d.announce}:` : "", ...lines].filter(Boolean).join("\n"),
    source: `Horae Homileticae, discourse ${d.n} (1832, public domain)`,
    ref,
    topic,
  };
}

/** A story or saying as material, named by its book. */
export function illustrationMaterial(i: IllustrationItem, topic: string): Material {
  const book = i.source.split(" (")[0];
  return {
    key: `il:${i.id}`,
    kind: i.kind,
    title: i.title ? `${i.title} — ${book}` : `${i.subject ? `${i.subject}: ` : ""}${book}`,
    text: i.text,
    source: i.source,
    topic,
  };
}

// ---------------------------------------------------------------- preaching a passage

/** A typed reference ("Romans 8", "John 3:1-21", "1 cor 13") as a passage, or null. A
 * whole chapter has verseEnd 200 (cut to the chapter's length when it is read). */
export function parseRef(text: string, books: BookInfo[]): Ref | null {
  const m = /^\s*([1-3]?\s*[a-z][a-z .]*?)\s*(\d+)(?::(\d+)(?:\s*[-–]\s*(\d+))?)?\s*$/i.exec(text);
  if (!m) return null;
  const name = m[1].replace(/\./g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  const book =
    books.find((b) => b.name.toLowerCase() === name) ??
    books.find((b) => name.length >= 3 && (b.name.toLowerCase().startsWith(name) || squash(b.name).startsWith(squash(name))));
  if (!book || book.testament === "Apocrypha") return null;
  const verse = m[3] ? Number(m[3]) : 1;
  return { book: book.name, chapter: Number(m[2]), verse, verseEnd: m[3] ? Number(m[4] ?? m[3]) : 200 };
}

/** Splits verses first..last into about `parts` sections of similar length. */
function sections(first: number, last: number, parts: number): [number, number][] {
  const count = last - first + 1;
  const n = Math.max(1, Math.min(parts, count));
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = first + Math.floor((i * count) / n);
    const b = first + Math.floor(((i + 1) * count) / n) - 1;
    out.push([a, b]);
  }
  return out;
}

const COMMON_WORDS = new Set(
  "the and of to that in he shall unto for i his a lord they be is him not them it with all thou thy was which my me but ye have from you will your said were their are this when one has had there who what into upon then so as at by on or no an do did we us our out up even".split(" "),
);

/**
 * Everything for preaching one passage: the passage itself and in sections, the book's and
 * chapter's introductions, the people and places in it, cross-references, what the
 * commentaries say on each section, the words it repeats in Hebrew or Greek, and the
 * preacher's own notes on its verses.
 */
async function gatherPassage(r: Ref, typed: string, version: string, books: BookInfo[], onStage: (s: string) => void): Promise<Material[]> {
  const out: Material[] = [];
  const topic = typed;
  const add = (m: Omit<Material, "topic">) => {
    if (m.text.trim() && !out.some((x) => x.key === m.key)) out.push({ ...m, topic });
  };
  const canon = new Set(books.filter((b) => b.testament !== "Apocrypha").map((b) => b.name));
  onStage("Reading the passage");
  const chapter = await api.getChapter(version, r.book, r.chapter).catch(() => []);
  const verses = chapter.length ? chapter : await api.getChapter("BSB", r.book, r.chapter).catch(() => []);
  if (verses.length === 0) return out;
  const last = Math.min(r.verseEnd, verses[verses.length - 1].verse);
  const first = Math.max(1, r.verse);
  const whole: Ref = { book: r.book, chapter: r.chapter, verse: first, verseEnd: last };
  const textOf = (a: number, b: number) =>
    verses
      .filter((v) => v.verse >= a && v.verse <= b)
      .map((v) => `${v.verse} ${v.text}`)
      .join(" ");
  const label = first === 1 && last === verses[verses.length - 1].verse ? `${r.book} ${r.chapter}` : refLabel(whole);
  add({ key: `p:${r.book}|${r.chapter}|${first}:${last}`, kind: "passage", title: label, text: textOf(first, last), source: version, ref: whole });

  // the passage in sections of about five verses (two to eight of them)
  const parts = Math.max(2, Math.min(8, Math.round((last - first + 1) / 5)));
  for (const [a, b] of sections(first, last, parts)) {
    const ref: Ref = { book: r.book, chapter: r.chapter, verse: a, verseEnd: b };
    add({ key: `s:${r.book}|${r.chapter}|${a}:${b}`, kind: "section", title: refLabel(ref), text: textOf(a, b), source: version, ref });
  }

  // the book's and the chapter's introductions
  onStage("Reading the introductions");
  const commentaries = await api.listCommentaries().catch(() => []);
  const intros = commentaries.filter((c) => /tyndale/i.test(c.id)).concat(commentaries.filter((c) => !/tyndale/i.test(c.id)));
  let bookIntro = false;
  let chapterIntro = false;
  for (const c of intros) {
    if (bookIntro && chapterIntro) break;
    const ch = await api.getCommentaryChapter(c.id, r.book, r.chapter).catch(() => null);
    if (!ch) continue;
    if (!bookIntro && ch.book_introduction?.trim()) {
      bookIntro = true;
      add({ key: `b:${c.id}:${r.book}`, kind: "background", title: `${r.book}: introduction — ${c.name}`, text: excerpt(ch.book_introduction, [], 1800), ref: { ...whole } });
    }
    if (!chapterIntro && ch.chapter_introduction?.trim()) {
      chapterIntro = true;
      add({ key: `bc:${c.id}:${r.book}|${r.chapter}`, kind: "background", title: `${r.book} ${r.chapter}: introduction — ${c.name}`, text: excerpt(ch.chapter_introduction, [], 1400), ref: { ...whole } });
    }
  }

  // who and where
  const entities = await api.chapterEntities(r.book, r.chapter).catch(() => null);
  if (entities) {
    const line = (e: { name: string; feature_type: string | null; verses: number[] }) => {
      const here = e.verses.filter((v) => v >= first && v <= last);
      return `${e.name}${e.feature_type ? ` (${e.feature_type})` : ""}${here.length ? ` — verse${here.length > 1 ? "s" : ""} ${here.slice(0, 6).join(", ")}` : ""}`;
    };
    if (entities.people.length)
      add({ key: `pe:${r.book}|${r.chapter}`, kind: "people", title: `People in ${r.book} ${r.chapter}`, text: entities.people.slice(0, 12).map(line).join("\n"), ref: { ...whole } });
    if (entities.places.length)
      add({ key: `pl:${r.book}|${r.chapter}`, kind: "people", title: `Places in ${r.book} ${r.chapter}`, text: entities.places.slice(0, 12).map(line).join("\n"), ref: { ...whole } });
  }

  // cross-references: the most agreed-on for each section's verses
  onStage("Following cross-references");
  const taken = (x: Ref) => out.some((m) => m.ref && m.kind !== "background" && m.kind !== "people" && m.ref.book === x.book && m.ref.chapter === x.chapter && x.verse >= m.ref.verse && x.verse <= m.ref.verseEnd);
  for (const [a, b] of sections(first, last, parts)) {
    let n = 0;
    for (let v = a; v <= b && n < 3; v++) {
      const refs = await api.crossReferencesFor(r.book, r.chapter, v).catch(() => []);
      for (const x of refs.filter((y) => canon.has(y.to_book)).slice(0, 2)) {
        const to: Ref = { book: x.to_book, chapter: x.to_chapter, verse: x.to_verse_start, verseEnd: Math.max(x.to_verse_start, x.to_verse_end) };
        if (taken(to)) continue;
        const text = await api.passageText("BSB", to.book, to.chapter, to.verse, to.verseEnd).catch(() => "");
        add({ key: `x:${to.book}|${to.chapter}|${to.verse}`, kind: "xref", title: refLabel(to), text, source: `BSB · linked from ${r.book} ${r.chapter}:${v}`, ref: to });
        n++;
      }
    }
  }

  // the commentaries on each section
  onStage("Reading the commentaries");
  for (const c of commentaries.slice(0, 4)) {
    const ch = await api.getCommentaryChapter(c.id, r.book, r.chapter).catch(() => null);
    if (!ch) continue;
    for (const [a, b] of sections(first, last, parts)) {
      const sec = ch.sections.filter((x) => x.verse_start <= b).pop();
      if (!sec?.text.trim() || sec.verse_start < a - 6) continue;
      add({
        key: `c:${c.id}:${r.book}|${r.chapter}|${sec.verse_start}`,
        kind: "commentary",
        title: `${c.name} on ${r.book} ${r.chapter}:${sec.verse_start}`,
        text: excerpt(sec.text, [], 1100),
        ref: { book: r.book, chapter: r.chapter, verse: sec.verse_start, verseEnd: sec.verse_start },
      });
    }
  }

  // the words the passage repeats, in the original
  onStage("Looking up the original words");
  const tagged = await api.getChapterWithStrongs("BSB", r.book, r.chapter).catch(() => []);
  const counts = new Map<string, { n: number; surface: string }>();
  for (const v of tagged.filter((x) => x.verse >= first && x.verse <= last)) {
    for (const w of v.words) {
      const surface = w.surface_text.trim();
      if (surface.length < 4 || COMMON_WORDS.has(surface.toLowerCase())) continue;
      for (const num of w.strongs_numbers) {
        const c = counts.get(num) ?? { n: 0, surface };
        c.n++;
        counts.set(num, c);
      }
    }
  }
  const repeated = [...counts.entries()].filter(([, c]) => c.n >= 2).sort((a, b) => b[1].n - a[1].n).slice(0, 5);
  for (const [num, c] of repeated) {
    const s = await api.strongsLookup(num).catch(() => null);
    if (!s) continue;
    const def = [s.strongs_def, s.kjv_def ? `KJV: ${s.kjv_def}` : ""].filter(Boolean).join(" ").trim();
    add({
      key: `w:${num}`,
      kind: "word",
      title: `${s.lemma ?? num}${s.xlit ? ` (${s.xlit})` : ""} — “${c.surface}”`,
      text: `Strong's ${num}, ${c.n} times in this passage. ${def}`.trim(),
      ref: { ...whole },
    });
  }

  // where the downloaded books refer to it
  onStage("Looking through your Library");
  for (const m of await libraryMentions(r.book, r.chapter, first, last, 18)) add(m);

  // Spurgeon's sermons on it
  for (const s of (await api.spurgeonSermonsOn(r.book, r.chapter, first, last).catch(() => [])).slice(0, 12)) add(spurgeonMaterial(s));

  // how others outlined it
  const outlines = (await api.sermonOutlines(r.book, r.chapter, first, last).catch(() => [])).slice(0, 12);
  for (const d of outlines) add(outlineMaterial(d, topic));

  // stories and sayings on what the passage is about: its repeated words and the outlines' titles
  const about = [...repeated.map(([, c]) => c.surface), ...outlines.map((d) => d.title)].join(" ");
  for (const i of await api.sermonIllustrations(about, 10).catch(() => [])) add(illustrationMaterial(i, topic));

  // the preacher's own notes on these verses
  const notes = (await api.listStudy().catch(() => null))?.notes ?? [];
  for (const n of notes) {
    if (n.book !== r.book || n.chapter !== r.chapter || n.verse < first || n.verse > last) continue;
    const ref: Ref = { book: n.book, chapter: n.chapter, verse: n.verse, verseEnd: n.verse_end ?? n.verse };
    add({ key: `n:${n.book}|${n.chapter}|${n.verse}`, kind: "note", title: `My note on ${refLabel(ref)}`, text: n.value, ref });
  }
  return out;
}

/** Gathers material for what was typed: one topic, several separated by ";", or a sentence. */
export async function gather(query: string, version: string, books: BookInfo[], onStage: (s: string) => void): Promise<Gathered> {
  const topics = query
    .split(";")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 6);
  const materials: Material[] = [];
  for (const topic of topics) {
    const stage = (s: string) => onStage(topics.length > 1 ? `${topic}: ${s}` : s);
    const asPassage = parseRef(topic, books);
    const found = asPassage ? await gatherPassage(asPassage, topic, version, books, stage) : await gatherTopic(topic, version, books, stage);
    for (const m of found) {
      if (!materials.some((x) => x.key === m.key)) materials.push(m);
    }
  }
  return { topics, materials };
}

// ---------------------------------------------------------------- arranging

let nextId = 0;
export const newId = () => `i${Date.now().toString(36)}${(nextId++).toString(36)}`;

export const isScripture = (m: Material) => m.kind === "passage" || m.kind === "section" || m.kind === "verse" || m.kind === "xref";

// ---------------------------------------------------------------- what the arrangement tells you

export function testamentBalance(items: SermonItem[], books: BookInfo[]): { ot: number; nt: number } {
  const of = new Map(books.map((b) => [b.name, b.testament]));
  let ot = 0;
  let nt = 0;
  for (const i of items) {
    if (i.type !== "material" || !isScripture(i.material) || !i.material.ref) continue;
    if (of.get(i.material.ref.book) === "NT") nt++;
    else if (of.get(i.material.ref.book) === "OT") ot++;
  }
  return { ot, nt };
}

/** The best unticked Scripture from the testament the sermon is missing. */
export function suggestFromOther(items: SermonItem[], gathered: Material[], books: BookInfo[]): Material | null {
  const { ot, nt } = testamentBalance(items, books);
  if (ot + nt === 0 || (ot > 0 && nt > 0)) return null;
  const want = ot === 0 ? "OT" : "NT";
  const of = new Map(books.map((b) => [b.name, b.testament]));
  const used = new Set(items.flatMap((i) => (i.type === "material" ? [i.material.key] : [])));
  return gathered.find((m) => isScripture(m) && m.ref && of.get(m.ref.book) === want && !used.has(m.key)) ?? null;
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Minutes to read the gathered material and notes aloud at an unhurried pace. It leaves
 * out everything the preacher will say that isn't written here. */
export function readingMinutes(items: SermonItem[]): number {
  const words = items.reduce((n, i) => n + wordCount(i.type === "material" ? i.material.text : i.type === "media" ? "" : i.text), 0);
  return Math.round(words / 130);
}

/** Words the preacher has written in the sections (not the gathered material). */
export function wordsWritten(items: SermonItem[]): number {
  return items.reduce((n, i) => n + (i.type === "block" || i.type === "note" ? wordCount(stripMarks(i.text)) : 0), 0);
}

/** "John 3:16; Romans 8:28", for the saved sermon's list entry and its series. */
export function passagesUsed(items: SermonItem[]): string {
  const refs = items.flatMap((i) => (i.type === "material" && isScripture(i.material) && i.material.ref ? [i.material.ref] : []));
  return [...new Set(refs.map((r) => (r.verseEnd >= 200 ? `${r.book} ${r.chapter}` : refLabel(r))))].join("; ");
}

// ---------------------------------------------------------------- the preacher's own words
//
// Sections are plain text with three marks the preacher can use: **bold**, *italic*, and a
// line starting "- " for a bullet. [[words]] marks words to leave blank on a fill-in-the-
// blanks handout; everywhere else the brackets are simply dropped.

/** The text without the blank marks ("[[faith]]" -> "faith"). */
export const stripMarks = (text: string) => text.replace(/\[\[([^\]]*)\]\]/g, "$1");

/** One line of the preacher's text as formatted runs; blanks shown or kept as words. */
export function textRuns(line: string, blanks: "words" | "gaps" = "words"): SheetRun[] {
  const runs: SheetRun[] = [];
  const withBlanks = line.replace(/\[\[([^\]]*)\]\]/g, (_, w: string) => (blanks === "gaps" ? "_".repeat(Math.max(8, w.length + 4)) : w));
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let at = 0;
  for (const m of withBlanks.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > at) runs.push({ text: withBlanks.slice(at, i) });
    if (m[2] !== undefined) runs.push({ text: m[2], bold: true });
    else runs.push({ text: m[3], italic: true });
    at = i + m[0].length;
  }
  if (at < withBlanks.length) runs.push({ text: withBlanks.slice(at) });
  return runs.length ? runs : [{ text: "" }];
}

/** The preacher's text as document paragraphs (a "- " line is a bullet). */
export function textBlocks(text: string, blanks: "words" | "gaps" = "words"): SheetBlock[] {
  const out: SheetBlock[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const lines = para.split("\n").filter((l) => l.trim());
    if (lines.length === 0) continue;
    if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
      for (const l of lines) out.push({ kind: "para", runs: [{ text: "•  " }, ...textRuns(l.replace(/^\s*[-•]\s+/, ""), blanks)] });
    } else {
      out.push({ kind: "para", runs: textRuns(lines.join(" "), blanks) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- the document

export interface SermonMeta {
  title: string;
  series: string;
  preachedOn: string;
  topics: string;
  /** ruled lines under each heading for handwritten notes; 0 = none */
  blankLines: number;
  bigIdea?: string;
  /** what listeners should know, feel and do */
  purpose?: string;
  venue?: string;
  /** print each section's name (Explain, Apply, ...) */
  showLabels?: boolean;
  /** print the question of each section left empty */
  showPrompts?: boolean;
  /** for a screen (Preach), where links are clicked: no web addresses written out */
  forScreen?: boolean;
}

/** The arrangement as a study-sheet document (preview, print, copy, Word). `pictures` holds
 * the sermon's pictures as PNGs, by file (a picture not there yet is named instead). */
export function sermonBlocks(meta: SermonMeta, items: SermonItem[], versions: Version[], pictures?: Map<string, PngPicture>): SheetBlock[] {
  const nameOf = (code?: string) => versions.find((v) => v.code === code)?.name ?? code ?? "";
  const blocks: SheetBlock[] = [{ kind: "title", text: meta.title.trim() || "Sermon" }];
  const when = meta.preachedOn ? new Date(`${meta.preachedOn}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";
  const sub = [meta.series.trim() ? `Series: ${meta.series.trim()}` : "", when, meta.venue?.trim() ?? ""].filter(Boolean).join(" · ");
  if (sub) blocks.push({ kind: "subtitle", text: sub });
  if (meta.bigIdea?.trim()) blocks.push({ kind: "quote", runs: [{ text: "Big idea: ", bold: true }, ...textRuns(meta.bigIdea.trim())] });
  if (meta.purpose?.trim()) blocks.push({ kind: "para", runs: [{ text: "Purpose: ", bold: true }, ...textRuns(meta.purpose.trim())] });
  const showLabels = meta.showLabels ?? true;
  items.forEach((i, n) => {
    if (i.type === "heading") {
      blocks.push({ kind: "heading", text: stripMarks(i.text) });
      // room to write, unless the preacher's own words follow straight away
      const next = items[n + 1];
      // (a point whose sections follow gets its lines in the sections left empty)
      if (meta.blankLines > 0 && next?.type !== "note" && next?.type !== "block") blocks.push({ kind: "lines", count: meta.blankLines });
      return;
    }
    if (i.type === "block") {
      if (i.level === 1) blocks.push({ kind: "heading", text: i.label });
      else if (showLabels) blocks.push({ kind: "subheading", text: i.label });
      if (i.text.trim()) blocks.push(...textBlocks(i.text));
      else {
        // an empty section: its question (if wanted), and room to write -- unless material
        // follows it, which is then what the section holds
        const filled = items[n + 1]?.type === "material" || items[n + 1]?.type === "media";
        if (meta.showPrompts && !filled) blocks.push({ kind: "para", runs: [{ text: i.prompt, italic: true }] });
        if (meta.blankLines > 0 && !filled) blocks.push({ kind: "lines", count: Math.max(2, Math.round(meta.blankLines / 2)) });
      }
      return;
    }
    if (i.type === "note") {
      blocks.push(...textBlocks(i.text));
      return;
    }
    if (i.type === "media") {
      blocks.push(...mediaBlocks(i.media, pictures, meta.forScreen));
      return;
    }
    const m = i.material;
    const text = plainText(m.text).replace(/⟪\d+⟫/g, "").trim();
    if (isScripture(m)) {
      const version = (m.source ?? "").split(" · ")[0];
      blocks.push({ kind: "subheading", text: `${m.title}${version ? ` (${nameOf(version)})` : ""}` });
      blocks.push({ kind: "quote", runs: [{ text }] });
    } else if (m.kind === "outline") {
      // a historic outline, line by line under its source
      blocks.push({ kind: "subheading", text: m.title });
      for (const line of m.text.split("\n").filter((l) => l.trim())) blocks.push({ kind: "para", runs: [{ text: line.replace(/^ {4}/, "      "), italic: true }] });
      if (m.source) blocks.push({ kind: "para", runs: [{ text: m.source, italic: true }] });
    } else if (m.kind === "note") {
      blocks.push({ kind: "para", runs: [{ text: `${m.title}: `, bold: true }, { text }] });
    } else {
      // someone else's words: named, and set apart from Scripture
      blocks.push({
        kind: "para",
        runs: [{ text: `${m.title}: `, bold: true }, { text, italic: m.kind === "commentary" || m.kind === "illustration" || m.kind === "quote" || m.kind === "background" }],
      });
    }
  });
  return blocks;
}

/** A picture, video, music, file or link in the document: the picture itself, or its name
 * and where to find it. */
export function mediaBlocks(m: MediaRef, pictures?: Map<string, PngPicture>, forScreen = false): SheetBlock[] {
  const caption = [m.title, m.credit].filter(Boolean).join(" — ");
  const pic = m.kind === "image" && m.file ? pictures?.get(m.file) : undefined;
  if (pic) return [{ kind: "image", src: pic.src, width: pic.width, height: pic.height, caption }];
  const where = m.url ?? m.name ?? "";
  return [
    {
      kind: "para",
      runs: [
        { text: `${m.kind === "video" || m.kind === "audio" ? "▶ " : ""}${KIND_LABEL[m.kind]}: `, bold: true },
        { text: m.title, link: m.url ?? (m.file ? `media:${m.file}` : undefined) },
        ...(where && where !== m.title && !forScreen ? [{ text: ` (${where})`, italic: true }] : []),
      ],
    },
  ];
}

/** What is stored for a saved sermon (the JSON in `Sermon.body`). */
export interface SermonBody {
  /** the template's key (older sermons: "points" | "expository" | "problem" | "free") */
  shape: string;
  blankLines: number;
  items: SermonItem[];
  /** everything that was gathered, so more can be ticked after reopening */
  gathered: Material[];
  // since 2.7
  bigIdea?: string;
  purpose?: string;
  points?: number;
  /** minutes the sermon should take */
  targetMinutes?: number;
  showLabels?: boolean;
  showPrompts?: boolean;
  // since 2.8: the slides as the preacher edited them (none: made from the sermon), and the
  // photo behind them (a kept file)
  slides?: import("./sermonOutputs").SlideSpec[] | null;
  slideBackground?: string | null;
}
