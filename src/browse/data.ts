// Browse: the pages as the app uses them. The JSON files in ./data are the single source (they are checked by scripts/test_browse.mts).

import storiesFile from "./data/stories.json";
import topicsFile from "./data/topics.json";
import childrenFile from "./data/children.json";
import keywordsFile from "./data/keywords.json";
import type { BrowseFile, BrowseKind, ChildPage, Story, Topic } from "./types";
import { findNamed, type BrowseEntry } from "./browseLogic";

export const STORIES: Story[] = (storiesFile as unknown as BrowseFile<Story>).pages;
export const TOPICS: Topic[] = (topicsFile as unknown as BrowseFile<Topic>).pages;
export const CHILDREN: ChildPage[] = (childrenFile as unknown as BrowseFile<ChildPage>).pages;

export const story = (id: string | null | undefined): Story | undefined => (id ? STORIES.find((s) => s.id === id) : undefined);
export const topic = (id: string | null | undefined): Topic | undefined => (id ? TOPICS.find((t) => t.id === id) : undefined);
export const childPage = (id: string | null | undefined): ChildPage | undefined => (id ? CHILDREN.find((c) => c.id === id) : undefined);

const flagged = (p: { doctrine?: string }) => p.doctrine === "needs_review";

// words a reader may type that are not in a page's title: they help the search find the page and are never shown
const KEYWORDS = keywordsFile as unknown as { topics: Record<string, string[]>; stories: Record<string, string[]> };
// the same kind of words for the additional pages (see setBrowseExtras)
let EXTRA_KEYWORDS: { topics: Record<string, string[]>; stories: Record<string, string[]> } = { topics: {}, stories: {} };
const keywordsOf = (group: "topics" | "stories", id: string): string[] => [...(KEYWORDS[group][id] ?? []), ...(EXTRA_KEYWORDS[group][id] ?? [])];

const storyEntry = (s: Story): BrowseEntry => ({
  kind: "stories",
  id: s.id,
  title: s.title,
  also: [...(s.also ?? []), ...keywordsOf("stories", s.id)],
  tags: s.tags,
  body: [s.summary, s.look_closer ?? ""].join(" "),
  flagged: flagged(s),
});

const topicEntry = (t: Topic): BrowseEntry => ({
  kind: "topics",
  id: t.id,
  title: t.title,
  also: [...(t.also ?? []), ...keywordsOf("topics", t.id)],
  tags: t.tags,
  body: [t.intro, ...t.items.map((i) => i.note)].join(" "),
  flagged: flagged(t) || t.items.some(flagged),
});

const childEntry = (c: ChildPage): BrowseEntry => ({
  kind: "children",
  id: c.id,
  title: c.title,
  // a children's page is found by the words of the story it belongs to
  also: c.story ? keywordsOf("stories", c.story) : [],
  tags: [],
  body: c.retelling.join(" "),
  flagged: flagged(c),
});

export const STORY_ENTRIES: BrowseEntry[] = STORIES.map(storyEntry);
export const TOPIC_ENTRIES: BrowseEntry[] = TOPICS.map(topicEntry);
export const CHILD_ENTRIES: BrowseEntry[] = CHILDREN.map(childEntry);

export const ENTRIES: Record<BrowseKind, BrowseEntry[]> = { stories: STORY_ENTRIES, topics: TOPIC_ENTRIES, children: CHILD_ENTRIES };

/** every page that exists, for the shortcut and search entry points */
export const hasBrowsePages = STORIES.length + TOPICS.length + CHILDREN.length > 0;

// the same pages with only their title, other names and subjects searchable: a question typed in the search box finds a page only when the page is about it
const named = (): BrowseEntry[] => [...STORY_ENTRIES, ...TOPIC_ENTRIES, ...CHILD_ENTRIES].map((e) => ({ ...e, body: "" }));
let NAMED: BrowseEntry[] = named();

/** The few Browse pages whose title, other names or subjects match what the reader typed in a search box (none when the words are too general to point at a page). */
export const findBrowse = (query: string, limit = 4): BrowseEntry[] => findNamed(NAMED, query, limit);

// ---- additional pages ------------------------------------------------------------------------------------------------
// The pages above ship inside the app and never change. The phone can add more after them (its "Fetch additional stories" button, mobile/src/extraPages.ts):
// pages that were already checked, placed after the shipped ones. A page whose id is already used by a shipped page is not added (the shipped one stays).
// Called again, it replaces the pages added before (a new fetch brings the whole list, a corrected page included). The desktop app never calls it.
const SHIPPED = { stories: STORIES.length, topics: TOPICS.length, children: CHILDREN.length };

export interface ExtraBrowsePages {
  stories?: Story[];
  topics?: Topic[];
  children?: ChildPage[];
  keywords?: { stories?: Record<string, string[]>; topics?: Record<string, string[]> };
}

/** Puts these pages after the shipped ones (dropping any added earlier); how many of each were added. */
export function setBrowseExtras(extra: ExtraBrowsePages): { stories: number; topics: number; children: number } {
  STORIES.length = SHIPPED.stories;
  TOPICS.length = SHIPPED.topics;
  CHILDREN.length = SHIPPED.children;
  STORY_ENTRIES.length = SHIPPED.stories;
  TOPIC_ENTRIES.length = SHIPPED.topics;
  CHILD_ENTRIES.length = SHIPPED.children;
  EXTRA_KEYWORDS = { stories: extra.keywords?.stories ?? {}, topics: extra.keywords?.topics ?? {} };
  const added = { stories: 0, topics: 0, children: 0 };
  for (const s of extra.stories ?? []) {
    if (STORIES.some((x) => x.id === s.id)) continue;
    STORIES.push(s);
    STORY_ENTRIES.push(storyEntry(s));
    added.stories++;
  }
  for (const t of extra.topics ?? []) {
    if (TOPICS.some((x) => x.id === t.id)) continue;
    TOPICS.push(t);
    TOPIC_ENTRIES.push(topicEntry(t));
    added.topics++;
  }
  for (const c of extra.children ?? []) {
    if (CHILDREN.some((x) => x.id === c.id)) continue;
    CHILDREN.push(c);
    CHILD_ENTRIES.push(childEntry(c));
    added.children++;
  }
  NAMED = named();
  return added;
}
