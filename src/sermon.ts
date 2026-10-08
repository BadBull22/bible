// The sermon builder's working parts. Nothing here writes a sermon: it gathers Scripture,
// cross-references, commentary, dictionary articles, word studies, the reader's own notes
// and passages from their books on a subject, and lays out what the preacher ticks and
// arranges as a document. The words of the sermon are the preacher's.
//
// Gathering uses what the app already has -- search by meaning (sentences work), word
// search, the topical Bibles (Nave's, Torrey's), cross-references, commentaries -- plus a
// short table of passages known by name ("Sermon on the Mount").
import { api, BookInfo, SheetBlock, Version } from "./api";
import { plainText } from "./components/RichText";

export type MaterialKind = "passage" | "verse" | "xref" | "commentary" | "article" | "word" | "note" | "illustration";

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

export type SermonItem =
  | { id: string; type: "material"; material: Material }
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "note"; text: string };

export type SermonShape = "points" | "expository" | "problem" | "free";

export const SHAPES: { key: SermonShape; label: string; about: string }[] = [
  { key: "points", label: "Points", about: "An introduction, a heading for each topic or point, and a conclusion." },
  { key: "expository", label: "Through a passage", about: "The main passage first, then its supporting material in Bible order." },
  { key: "problem", label: "Problem → God's answer → response", about: "Three movements: the need, what God has done, what we do." },
  { key: "free", label: "No headings", about: "Just the material in the order you ticked it; add your own headings." },
];

export const GROUPS: { kind: MaterialKind; label: string; about: string }[] = [
  { kind: "passage", label: "Key passages", about: "The passages most central to the subject." },
  { kind: "verse", label: "Supporting verses", about: "Other verses on the subject." },
  { kind: "xref", label: "Cross-references", about: "Verses linked to the key passages." },
  { kind: "commentary", label: "Commentary", about: "What commentators say on the key passages. Their views are their own." },
  { kind: "article", label: "Dictionary and topical articles", about: "Bible dictionary and topical Bible entries." },
  { kind: "word", label: "Word studies", about: "The Hebrew and Greek words behind the subject." },
  { kind: "note", label: "Your own notes", about: "Notes you've written that touch the subject." },
  { kind: "illustration", label: "From your books", about: "Passages in your Library books, to quote with their source." },
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

  // --- 8. the reader's books
  onStage("Searching your books");
  const bookHits = await api.librarySearchBooks(words.length ? words.join(" ") : topic, null, 8).catch(() => []);
  for (const h of bookHits.slice(0, 6)) {
    const section = await api.librarySection(h.id).catch(() => null);
    add({
      key: `i:${h.id}`,
      kind: "illustration",
      title: `${h.module_title} — ${h.title}`,
      text: section ? excerpt(section.text, words, 800) : h.snippet,
    });
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
    for (const m of await gatherTopic(topic, version, books, (s) => onStage(topics.length > 1 ? `${topic}: ${s}` : s))) {
      if (!materials.some((x) => x.key === m.key)) materials.push(m);
    }
  }
  return { topics, materials };
}

// ---------------------------------------------------------------- arranging

let nextId = 0;
export const newId = () => `i${Date.now().toString(36)}${(nextId++).toString(36)}`;

const isScripture = (m: Material) => m.kind === "passage" || m.kind === "verse" || m.kind === "xref";

/** A first arrangement of the ticked material in the chosen shape; the preacher moves
 * things from there. Scripture comes first under every heading, commentary after it. */
export function arrange(shape: SermonShape, topics: string[], chosen: Material[], books: BookInfo[]): SermonItem[] {
  const heading = (text: string): SermonItem => ({ id: newId(), type: "heading", text });
  const item = (material: Material): SermonItem => ({ id: newId(), type: "material", material });
  const scriptureFirst = (list: Material[]) => [...list.filter(isScripture), ...list.filter((m) => !isScripture(m))];
  const order = new Map(books.map((b, i) => [b.name, i]));
  const main = chosen.find((m) => m.kind === "passage");
  const rest = chosen.filter((m) => m !== main);
  const title = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

  if (shape === "free") return chosen.map(item);

  if (shape === "expository") {
    const inOrder = [...rest.filter((m) => m.ref)].sort(
      (a, b) => (order.get(a.ref!.book) ?? 99) - (order.get(b.ref!.book) ?? 99) || a.ref!.chapter - b.ref!.chapter || a.ref!.verse - b.ref!.verse,
    );
    return [
      heading("The passage"),
      ...(main ? [item(main)] : []),
      heading("Working through it"),
      ...scriptureFirst(inOrder).map(item),
      heading("Background and word studies"),
      ...rest.filter((m) => !m.ref).map(item),
      heading("Application"),
    ];
  }

  if (shape === "problem") {
    return [
      heading("Main text"),
      ...(main ? [item(main)] : []),
      heading("The problem"),
      heading("God's answer"),
      ...scriptureFirst(rest).map(item),
      heading("Our response"),
    ];
  }

  // points: one per topic when several were typed, otherwise three open points
  const out: SermonItem[] = [heading("Introduction"), ...(main ? [item(main)] : [])];
  if (topics.length > 1) {
    for (const t of topics) {
      out.push(heading(title(t)));
      out.push(...scriptureFirst(rest.filter((m) => m.topic === t)).map(item));
    }
  } else {
    const scripture = rest.filter(isScripture);
    const per = Math.ceil(scripture.length / 3) || 1;
    for (let p = 0; p < 3; p++) {
      out.push(heading(`Point ${p + 1}`));
      out.push(...scripture.slice(p * per, (p + 1) * per).map(item));
    }
    const other = rest.filter((m) => !isScripture(m));
    if (other.length) out.push(heading("Supporting material"), ...other.map(item));
  }
  out.push(heading("Conclusion and response"));
  return out;
}

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
  const words = items.reduce((n, i) => n + wordCount(i.type === "material" ? i.material.text : i.text), 0);
  return Math.round(words / 130);
}

/** "John 3:16; Romans 8:28", for the saved sermon's list entry and its series. */
export function passagesUsed(items: SermonItem[]): string {
  const refs = items.flatMap((i) => (i.type === "material" && isScripture(i.material) && i.material.ref ? [i.material.ref] : []));
  return [...new Set(refs.map((r) => (r.verseEnd >= 200 ? `${r.book} ${r.chapter}` : refLabel(r))))].join("; ");
}

// ---------------------------------------------------------------- the document

export interface SermonMeta {
  title: string;
  series: string;
  preachedOn: string;
  topics: string;
  /** ruled lines under each heading for handwritten notes; 0 = none */
  blankLines: number;
}

/** The arrangement as a study-sheet document (preview, print, copy, Word). */
export function sermonBlocks(meta: SermonMeta, items: SermonItem[], versions: Version[]): SheetBlock[] {
  const nameOf = (code?: string) => versions.find((v) => v.code === code)?.name ?? code ?? "";
  const blocks: SheetBlock[] = [{ kind: "title", text: meta.title.trim() || "Sermon" }];
  const when = meta.preachedOn ? new Date(`${meta.preachedOn}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "";
  const sub = [meta.series.trim() ? `Series: ${meta.series.trim()}` : "", when].filter(Boolean).join(" · ");
  if (sub) blocks.push({ kind: "subtitle", text: sub });
  items.forEach((i, n) => {
    if (i.type === "heading") {
      blocks.push({ kind: "heading", text: i.text });
      // room to write, unless the preacher's own note follows straight away
      if (meta.blankLines > 0 && items[n + 1]?.type !== "note") blocks.push({ kind: "lines", count: meta.blankLines });
      return;
    }
    if (i.type === "note") {
      for (const para of i.text.split(/\n{2,}/)) if (para.trim()) blocks.push({ kind: "para", runs: [{ text: para.trim() }] });
      return;
    }
    const m = i.material;
    const text = plainText(m.text).replace(/⟪\d+⟫/g, "").trim();
    if (isScripture(m)) {
      const version = (m.source ?? "").split(" · ")[0];
      blocks.push({ kind: "subheading", text: `${m.title}${version ? ` (${nameOf(version)})` : ""}` });
      blocks.push({ kind: "quote", runs: [{ text }] });
    } else if (m.kind === "note") {
      blocks.push({ kind: "para", runs: [{ text: `${m.title}: `, bold: true }, { text }] });
    } else {
      // someone else's words: named, and set apart from Scripture
      blocks.push({ kind: "para", runs: [{ text: `${m.title}: `, bold: true }, { text, italic: m.kind === "commentary" || m.kind === "illustration" }] });
    }
  });
  return blocks;
}

/** What is stored for a saved sermon (the JSON in `Sermon.body`). */
export interface SermonBody {
  shape: SermonShape;
  blankLines: number;
  items: SermonItem[];
  /** everything that was gathered, so more can be ticked after reopening */
  gathered: Material[];
}
