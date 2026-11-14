// Content Factory: the recipes that make posts by themselves, from what the app already holds: well-loved verses, the verses of the
// church year, the Browse pages (a story, "Verses for...", a children's memory verse) and Firsts and Milestones. The words of Scripture
// come from the chosen free-to-share Bible; everything else is the app's own wording. A recipe returns a Post for the inbox, or null
// when it has nothing fresh to make.

import { api, BookInfo } from "../api";
import { CHILDREN, STORIES, TOPICS } from "../browse/data";
import { DAILY_VERSES } from "../dailyVerse";
import type { OccasionId } from "../themes/themeCalendar";
import { pickFresh, type RecipeId } from "./autopilot";
import { DEFAULT_HASHTAGS, buildCaption, loadPassage, parsePassage, referenceLabel, type CardText, type Passage } from "./content";
import type { Post, PostCard } from "./inbox";
import { SEASON_VERSES } from "./seasonVerses";
import { SITE_MARK, type FooterSettings } from "./types";

export interface Env {
  books: BookInfo[];
  counts: Record<string, number>;
  /** a free-to-share Bible */
  version: string;
  today: number;
  /** what was made lately (not made again) */
  used: Set<string>;
  seed: number;
  footer: FooterSettings;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const vkey = (p: Passage) => `v:${referenceLabel(p)}`;

async function firstText(ref: string, env: Env): Promise<{ text: CardText; key: string }> {
  const p = parsePassage(ref, env.books, env.counts);
  if (!p) throw new Error(`The reference ${ref} could not be read.`);
  const texts = await loadPassage(p, env.version);
  return { text: texts[0], key: vkey(p) };
}

const verseCard = (t: CardText, env: Env): PostCard => ({ text: t.text, reference: t.reference, version: env.version });

/** the link line for a caption, following the reader's choice for the bottom-right corner */
function linkOf(f: FooterSettings): string {
  return f.mark.kind === "site" ? SITE_MARK : f.mark.kind === "custom" ? f.mark.text.trim() : "";
}

function captionLines(lines: string[], env: Env, tags: string[] = []): string {
  let c = lines.join("\n\n");
  const all = [...tags, ...DEFAULT_HASHTAGS].filter((t, i, a) => a.indexOf(t) === i);
  c += `\n\n${all.join(" ")}`;
  const link = linkOf(env.footer);
  if (link) c += `\n\n${link}`;
  return c;
}

function post(recipe: RecipeId, title: string, day: number, cards: PostCard[], caption: string, keys: string[], env: Env, n = 0): Post {
  return { id: `${recipe}-${day}-${uid()}`, recipe, title, day, cards, caption, status: "new", lookSeed: env.seed + n * 7 + day, keys, madeDay: env.today };
}

/** A well-loved verse that has not been made lately. */
export async function buildDaily(env: Env, day: number, n = 0): Promise<Post> {
  const all = DAILY_VERSES.map(([book, chapter, verse]) => ({ book, chapter, verseStart: verse, verseEnd: verse }) as Passage);
  const [p] = pickFresh(all, vkey, env.used, 1, env.seed + n * 31 + day);
  const t = (await loadPassage(p, env.version))[0];
  const card = verseCard(t, env);
  return post("daily", t.reference, day, [card], buildCaption([card], env.footer), [vkey(p)], env, n);
}

/** A set of verses for a season of the church year. */
export async function buildSeason(env: Env, occasion: OccasionId, day: number, count = 7): Promise<Post | null> {
  const list = SEASON_VERSES[occasion];
  if (!list) return null;
  const parsed = list.refs.map((r) => parsePassage(r, env.books, env.counts)).filter((p): p is Passage => !!p);
  const chosen = pickFresh(parsed, vkey, env.used, count, env.seed + day);
  const cards: PostCard[] = [];
  const keys: string[] = [];
  for (const p of chosen) {
    try {
      const text = (await loadPassage(p, env.version))[0];
      cards.push(verseCard(text, env));
      keys.push(vkey(p));
    } catch {
      /* a reference this Bible cannot give is left out */
    }
  }
  if (cards.length === 0) return null;
  const caption = buildCaption(cards, env.footer, { hashtags: [`#${list.name.replace(/[^A-Za-z]/g, "")}`, ...DEFAULT_HASHTAGS] });
  return post("season", `${list.name}: ${cards.length} verses`, day, cards, caption, keys, env);
}

/** "Verses for fear": a title card and up to six verses, with the page's own one-line notes in the caption. */
export async function buildTopic(env: Env, day: number): Promise<Post | null> {
  const ok = TOPICS.filter((t) => t.review.status === "approved" && t.doctrine === "plain");
  const [t] = pickFresh(ok, (x) => `t:${x.id}`, env.used, 1, env.seed + day);
  if (!t) return null;
  const items = t.items.filter((i) => (i.doctrine ?? "plain") === "plain").slice(0, 6);
  const cards: PostCard[] = [{ text: t.title, reference: "From the Bible", version: "" }];
  const noted: string[] = [];
  for (const it of items) {
    try {
      const { text } = await firstText(it.ref, env);
      cards.push(verseCard(text, env));
      noted.push(`${text.reference}: ${it.note}`);
    } catch {
      /* left out */
    }
  }
  if (cards.length < 2) return null;
  const caption = captionLines([`${t.title}\n${t.intro.split("\n")[0]}`, noted.join("\n")], env, [`#${t.id.replace(/[^a-z]/g, "")}`]);
  return post("topic", t.title, day, cards, caption, [`t:${t.id}`], env);
}

/** a short story or intro cut into card-sized pieces at the ends of sentences */
export function chunks(text: string, max = 230, limit = 3): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (cur && (cur + " " + s).length > max) {
      out.push(cur);
      cur = s;
    } else cur = cur ? `${cur} ${s}` : s;
  }
  if (cur) out.push(cur);
  return out.slice(0, limit);
}

/** A Bible story as a picture set: its title, the retelling, a passage, what it teaches, and where to read it. */
export async function buildStory(env: Env, day: number): Promise<Post | null> {
  const ok = STORIES.filter((s) => s.review.status === "approved" && s.doctrine === "plain");
  const [s] = pickFresh(ok, (x) => `s:${x.id}`, env.used, 1, env.seed + day);
  if (!s) return null;
  const cards: PostCard[] = [{ text: s.title, reference: "A Bible story", version: "" }];
  for (const c of chunks(s.summary.split(/\n\s*\n/)[0], 230, 3)) cards.push({ text: c, reference: s.title, version: "" });
  const first = s.passages[0];
  if (first) {
    try {
      const { text } = await firstText(first.ref, env);
      cards.push(verseCard(text, env));
    } catch {
      /* left out */
    }
  }
  if (s.lessons?.[0]) cards.push({ text: s.lessons[0], reference: "What this teaches us", version: "" });
  const where = s.whole ?? first?.ref ?? "";
  if (where) cards.push({ text: `Read the whole story in your Bible: ${where.replace(/^Psalms /, "Psalm ")}`, reference: "", version: "" });
  const caption = captionLines([`${s.title}\n${chunks(s.summary.split(/\n\s*\n/)[0], 400, 1)[0]}`, where ? `Read it: ${where.replace(/^Psalms /, "Psalm ")}` : ""].filter(Boolean), env, ["#BibleStory"]);
  return post("story", s.title, day, cards, caption, [`s:${s.id}`], env);
}

/** A children's memory verse and the big idea. */
export async function buildMemory(env: Env, day: number): Promise<Post | null> {
  const ok = CHILDREN.filter((c) => c.review.status === "approved" && c.doctrine === "plain");
  const [c] = pickFresh(ok, (x) => `m:${x.id}`, env.used, 1, env.seed + day);
  if (!c) return null;
  const { text } = await firstText(c.memory.ref, env);
  const cards: PostCard[] = [{ text: text.text, reference: `Memory verse: ${text.reference}`, version: env.version }, { text: c.message, reference: "The big idea", version: "" }];
  const caption = captionLines([`Memory verse: ${text.reference}\n\u201C${text.text}\u201D (${env.version})`, `The big idea: ${c.message}`], env, ["#MemoryVerse", "#KidsMinistry"]);
  return post("memory", `Memory verse: ${text.reference}`, day, cards, caption, [`m:${c.id}`], env);
}

/** A question from Firsts and Milestones and its answer. */
export async function buildFact(env: Env, day: number): Promise<Post | null> {
  const all = (await api.listFirsts()).filter((f) => (f.category === "firsts" || f.category === "facts" || f.category === "promises") && f.answer.length <= 240 && f.question.length <= 120);
  const [f] = pickFresh(all, (x) => `f:${x.id}`, env.used, 1, env.seed + day);
  if (!f) return null;
  const cite = f.citations[0] ?? "";
  const cards: PostCard[] = [{ text: f.question, reference: "Did you know?", version: "" }, { text: f.answer, reference: cite, version: "" }];
  const caption = captionLines([`${f.question}\n${f.answer}${cite ? ` (${cite})` : ""}`], env, ["#BibleFacts"]);
  return post("fact", f.question.slice(0, 60), day, cards, caption, [`f:${f.id}`], env);
}
