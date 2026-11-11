// Additional stories, topics and children's pages (the file the reader fetches with "Fetch additional stories"): the phone's own check of every page
// BEFORE it is shown. The computer checks the pages against the Bibles and the writing rules when the file is made (scripts/build_extra_pages.mts); this
// is the second, shorter check on the phone, and its job is different: nothing that arrives may be able to break a screen. A page that does not have the
// shape the screens read (a missing summary, a passage that is not a reference, a draft) is left out, and the others are kept. Pure (node tests it).

import type { ChildPage, Story, Topic } from "../../src/browse/types.ts";
import { AGE_BANDS, parseRef } from "../../src/browse/browseLogic.ts";

/** What the file holds, once checked. */
export interface ExtraPages {
  stories: Story[];
  topics: Topic[];
  children: ChildPage[];
  /** words a reader may type that are not in a page's title: they help the search find the page and are never shown */
  keywords: { stories: Record<string, string[]>; topics: Record<string, string[]> };
}

export interface ExtraResult {
  pages: ExtraPages;
  /** the pages left out, and why (for the computer's check; the phone only counts them) */
  skipped: { where: string; why: string }[];
  /** the file's own label (a date or a number), if it has one */
  revision: string;
}

type Any = Record<string, unknown>;

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isObj = (x: unknown): x is Any => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown, max = 6000): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= max;
const optStr = (x: unknown, max = 6000) => x === undefined || x === null || (typeof x === "string" && x.length <= max);
const strList = (x: unknown, maxItems = 40, maxLen = 3000): x is string[] => Array.isArray(x) && x.length <= maxItems && x.every((s) => str(s, maxLen));
const optList = (x: unknown, maxItems?: number, maxLen?: number) => x === undefined || x === null || strList(x, maxItems, maxLen);
const refOk = (x: unknown): x is string => typeof x === "string" && parseRef(x) !== null;
const refList = (x: unknown) => x === undefined || x === null || (Array.isArray(x) && x.length <= 20 && x.every(refOk));
const idList = (x: unknown) => x === undefined || x === null || (Array.isArray(x) && x.length <= 40 && x.every((i) => typeof i === "string" && ID.test(i)));

/** Why a page of any kind cannot be shown, or null when its common parts are right. */
function common(p: Any): string | null {
  if (typeof p.id !== "string" || !ID.test(p.id) || p.id.length >= 80) return "the id is not lower-case letters, digits and hyphens";
  if (!str(p.title, 60)) return "the title is missing or longer than 60 characters";
  if (p.doctrine !== "plain" && p.doctrine !== "needs_review") return 'doctrine is not "plain" or "needs_review"';
  if (p.doctrine === "needs_review" && !str(p.doctrine_note, 1500)) return "a page that needs review has no doctrine note";
  if (!optStr(p.doctrine_note, 1500) || !optStr(p.church_teaching, 3000)) return "a note is not text";
  if (!optList(p.also, 12, 80)) return '"also" is not a list of names';
  if (!isObj(p.review) || p.review.status !== "approved") return "the page is not approved";
  return null;
}

function story(p: Any): string | null {
  const c = common(p);
  if (c) return c;
  if (p.testament !== "OT" && p.testament !== "NT") return "testament is not OT or NT";
  if (!str(p.summary, 5000)) return "the summary is missing";
  if (!optStr(p.look_closer, 1500)) return "look_closer is not text";
  if (!optList(p.lessons, 6, 600)) return "lessons is not a list of sentences";
  if (p.context != null && !(isObj(p.context) && refOk(p.context.ref) && str(p.context.label, 200))) return "the context passage is not a reference and a label";
  if (!Array.isArray(p.passages) || p.passages.length < 1 || p.passages.length > 8 || !p.passages.every((x) => isObj(x) && refOk(x.ref) && str(x.label, 200))) return "the passages are not 1 to 8 of a reference and a label";
  if (p.whole != null && !refOk(p.whole)) return '"whole" is not a reference';
  if (!refList(p.parallels) || !refList(p.also_read)) return "the other passages are not references";
  if (!strList(p.tags, 8, 40)) return "tags is not a list of words";
  if (!idList(p.related) || !idList(p.topics) || (p.child_page != null && !(typeof p.child_page === "string" && ID.test(p.child_page)))) return "a link to another page is not a page name";
  return null;
}

function topic(p: Any): string | null {
  const c = common(p);
  if (c) return c;
  if (!str(p.intro, 1500)) return "the intro is missing";
  if (!Array.isArray(p.items) || p.items.length < 1 || p.items.length > 30) return "there are no passages";
  for (const i of p.items) {
    if (!isObj(i) || !refOk(i.ref) || !str(i.note, 800)) return "a passage is not a reference and a note";
    if (i.doctrine === "needs_review" && !str(i.doctrine_note, 1500)) return "a passage that needs review has no doctrine note";
    if (!optStr(i.doctrine_note, 1500)) return "a note is not text";
  }
  if (!str(p.dictionary, 100)) return "the dictionary word is missing";
  if (!idList(p.see_also) || !idList(p.stories)) return "a link to another page is not a page name";
  if (!strList(p.tags, 8, 40)) return "tags is not a list of words";
  return null;
}

function child(p: Any): string | null {
  const c = common(p);
  if (c) return c;
  if (typeof p.age !== "string" || !(AGE_BANDS as readonly string[]).includes(p.age)) return 'age is not "3-5", "6-8" or "9-12"';
  if (p.story != null && !(typeof p.story === "string" && ID.test(p.story))) return "the story link is not a page name";
  if (!refOk(p.read_from)) return "read_from is not a reference";
  if (!Array.isArray(p.retelling) || p.retelling.length < 1 || !strList(p.retelling, 20, 1500)) return "the retelling is missing";
  if (!str(p.message, 600)) return "the big idea is missing";
  if (!isObj(p.memory) || !refOk(p.memory.ref)) return "the memory verse is not a reference";
  if (!Array.isArray(p.questions) || p.questions.length < 1 || p.questions.length > 8 || !p.questions.every((q) => isObj(q) && str(q.q, 400) && str(q.a, 800))) return "the questions are not questions with answers";
  if (!optStr(p.try_this, 600)) return "try_this is not text";
  return null;
}

function keywords(x: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!isObj(x)) return out;
  for (const [id, list] of Object.entries(x)) if (ID.test(id) && strList(list, 40, 60)) out[id] = list;
  return out;
}

/**
 * The file's text, checked page by page. A file that is not what the app reads gives no pages at all; a page that is not right is left out and listed
 * in `skipped`, and the rest are kept. A page whose id is already used earlier in the file is left out too.
 */
export function parseExtraPages(text: string): ExtraResult {
  const none: ExtraResult = { pages: { stories: [], topics: [], children: [], keywords: { stories: {}, topics: {} } }, skipped: [], revision: "" };
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return { ...none, skipped: [{ where: "file", why: "not JSON" }] };
  }
  if (!isObj(file) || file.format !== 1) return { ...none, skipped: [{ where: "file", why: "not format 1" }] };
  const out = none;
  out.revision = typeof file.revision === "string" ? file.revision.slice(0, 40) : "";
  const take = <T,>(kind: "story" | "topic" | "child", list: unknown, check: (p: Any) => string | null, into: T[]) => {
    if (!Array.isArray(list)) return;
    const seen = new Set<string>();
    for (const p of list) {
      const where = `${kind} ${isObj(p) && typeof p.id === "string" ? p.id : "?"}`;
      if (!isObj(p)) {
        out.skipped.push({ where, why: "not a page" });
        continue;
      }
      const why = check(p);
      if (why) out.skipped.push({ where, why });
      else if (seen.has(p.id as string)) out.skipped.push({ where, why: "the id is used twice" });
      else {
        seen.add(p.id as string);
        into.push(p as unknown as T);
      }
    }
  };
  take("story", file.stories, story, out.pages.stories);
  take("topic", file.topics, topic, out.pages.topics);
  take("child", file.children, child, out.pages.children);
  if (isObj(file.keywords)) out.pages.keywords = { stories: keywords(file.keywords.stories), topics: keywords(file.keywords.topics) };
  return out;
}
