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

export const STORY_ENTRIES: BrowseEntry[] = STORIES.map((s) => ({
  kind: "stories",
  id: s.id,
  title: s.title,
  also: [...(s.also ?? []), ...(KEYWORDS.stories[s.id] ?? [])],
  tags: s.tags,
  body: [s.summary, s.look_closer ?? ""].join(" "),
  flagged: flagged(s),
}));

export const TOPIC_ENTRIES: BrowseEntry[] = TOPICS.map((t) => ({
  kind: "topics",
  id: t.id,
  title: t.title,
  also: [...(t.also ?? []), ...(KEYWORDS.topics[t.id] ?? [])],
  tags: t.tags,
  body: [t.intro, ...t.items.map((i) => i.note)].join(" "),
  flagged: flagged(t) || t.items.some(flagged),
}));

export const CHILD_ENTRIES: BrowseEntry[] = CHILDREN.map((c) => ({
  kind: "children",
  id: c.id,
  title: c.title,
  // a children's page is found by the words of the story it belongs to
  also: c.story ? KEYWORDS.stories[c.story] ?? [] : [],
  tags: [],
  body: c.retelling.join(" "),
  flagged: flagged(c),
}));

export const ENTRIES: Record<BrowseKind, BrowseEntry[]> = { stories: STORY_ENTRIES, topics: TOPIC_ENTRIES, children: CHILD_ENTRIES };

/** every page that exists, for the shortcut and search entry points */
export const hasBrowsePages = STORIES.length + TOPICS.length + CHILDREN.length > 0;

// the same pages with only their title, other names and subjects searchable: a question typed in the search box finds a page only when the page is about it
const NAMED: BrowseEntry[] = [...STORY_ENTRIES, ...TOPIC_ENTRIES, ...CHILD_ENTRIES].map((e) => ({ ...e, body: "" }));

/** The few Browse pages whose title, other names or subjects match what the reader typed in a search box (none when the words are too general to point at a page). */
export const findBrowse = (query: string, limit = 4): BrowseEntry[] => findNamed(NAMED, query, limit);
