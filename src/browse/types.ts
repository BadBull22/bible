// Browse: Bible stories, "Verses for..." pages and children's pages. The pages hold Scripture REFERENCES only (the app shows the words from the
// Bible the reader chose); every sentence is original. The plan is research/browse-plan/browse_plan.md; the rules each record must pass are
// enforced by scripts/test_browse.mts. References are always the app's own spelling, one chapter only ("1 Samuel 17:32-40", "Psalms 23:1-6").

export interface Passage {
  /** the reference: "Book c:v" or "Book c:v1-v2" */
  ref: string;
  /** what this passage is, in a few words */
  label: string;
}

export interface Review {
  /** only "approved" pages may ship; the owner approves in the running app (the review mode) */
  status: "draft" | "approved";
  rev: number;
  date?: string;
}

interface PageBase {
  /** permanent name used in links: lower-case letters, digits and hyphens */
  id: string;
  title: string;
  /** "plain", or "needs_review" (a page that touches doctrine or a viewpoint: it carries a visible mark and a reason) */
  doctrine: "plain" | "needs_review";
  doctrine_note?: string;
  /** the owner's own words, shown on contested pages (empty and hidden by default) */
  church_teaching?: string;
  review: Review;
}

export interface Story extends PageBase {
  also?: string[];
  testament: "OT" | "NT";
  age: "all";
  /** paragraphs are separated by a blank line; 40 to 170 words in all */
  summary: string;
  look_closer?: string;
  /** what the story teaches us: one to five short sentences (at most 50 words each); shown in a box after "Look closer" */
  lessons?: string[];
  context?: Passage;
  passages: Passage[];
  /** what "Read the whole story" opens: one chapter, left out if the story crosses chapters */
  whole?: string;
  parallels?: string[];
  also_read?: string[];
  /** ids from People & Places, each cited by a verse inside the story's chapters */
  people?: string[];
  places?: string[];
  tags: string[];
  related?: string[];
  topics?: string[];
  child_page?: string | null;
}

export interface TopicItem {
  ref: string;
  note: string;
  doctrine?: "plain" | "needs_review";
  doctrine_note?: string;
}

export interface Topic extends PageBase {
  also?: string[];
  intro: string;
  items: TopicItem[];
  /** what the "More on this subject" button searches in Nave's and Torrey's */
  dictionary: string;
  see_also?: string[];
  stories?: string[];
  tags: string[];
}

export type AgeBand = "3-5" | "6-8" | "9-12";

export interface ChildPage extends PageBase {
  age: AgeBand;
  story?: string | null;
  /** "read the real story together": one chapter */
  read_from: string;
  retelling: string[];
  /** the big idea, in words a child understands: one to three short sentences, shown after the story and printed on the sheet */
  message: string;
  memory: { ref: string; blanks_hint?: string[] };
  questions: { q: string; a: string }[];
  try_this?: string;
  /** word search words: capital letters A to Z, each appears in the retelling */
  words: string[];
}

export interface BrowseFile<T> {
  format: 1;
  /** the tags a page in this file may use */
  tags?: string[];
  pages: T[];
}

export type BrowseKind = "stories" | "topics" | "children";
