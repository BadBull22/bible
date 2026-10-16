// Sermon templates: the shape of a sermon as sections, each with a role and a question for
// the preacher to answer in their own words. A template turns what the preacher ticked into
// a prepared draft -- Scripture under each point, commentary and word studies where the
// point is explained, quotations where it is illustrated -- with every space to write
// marked by its question. The app fills in material; it never writes the sermon.
//
// The structures are the well-known ones homiletics teaches (credited where they have an
// author); a structure is a method, not text, so nothing here is anyone's wording.
import type { Material, MaterialKind, SermonItem } from "./sermon";
import { newId } from "./sermon";

/** What a section of a sermon is for. */
export type Role = "intro" | "bigidea" | "context" | "scripture" | "explain" | "illustrate" | "apply" | "transition" | "story" | "conclusion" | "response" | "prayer";

export const ROLES: Record<Role, { label: string; prompt: string; takes: MaterialKind[] }> = {
  intro: { label: "Introduction", prompt: "How will you open? A question, a story, or a need everyone in the room feels.", takes: [] },
  bigidea: { label: "The big idea", prompt: "The whole sermon in one sentence: what it says, and why it matters.", takes: [] },
  context: { label: "Background", prompt: "Who wrote this, to whom, and why? What was happening at the time?", takes: ["background", "article", "people"] },
  scripture: { label: "Scripture", prompt: "Read the text. Which words will you stress?", takes: ["passage", "verse", "xref"] },
  explain: { label: "Explain", prompt: "What does it mean? What did it mean to the people who first heard it?", takes: ["commentary", "word", "note", "article", "mention", "outline", "sermon"] },
  illustrate: { label: "Illustrate", prompt: "What picture, story or example will make it clear?", takes: ["illustration", "quote"] },
  apply: { label: "Apply", prompt: "What should change this week? Be specific: who does what, and when.", takes: [] },
  transition: { label: "Transition", prompt: "How does this point lead into the next one?", takes: [] },
  story: { label: "The story", prompt: "Tell this part in your own words.", takes: [] },
  conclusion: { label: "Conclusion", prompt: "Gather everything into one closing thought.", takes: [] },
  response: { label: "Response", prompt: "What will you invite people to do now: pray, respond, decide, act?", takes: [] },
  prayer: { label: "Prayer", prompt: "How will you close in prayer?", takes: [] },
};

export interface SectionDef {
  label: string;
  role: Role;
  /** the question to answer here, when it differs from the role's */
  prompt?: string;
}

export interface TemplateDef {
  key: string;
  name: string;
  about: string;
  /** whose method it is, when it has an author */
  credit?: string;
  /** before the points */
  opening: SectionDef[];
  /** the part repeated for each point ("{n}" in the label is the point's number) */
  point?: { label: string; parts: SectionDef[] };
  /** how many points it starts with */
  points: number;
  /** after the points */
  closing: SectionDef[];
  /** made for preaching one passage through */
  passageFirst?: boolean;
  /** the preacher's own (saved in My sermons ▸ Templates) */
  custom?: boolean;
}

const S = (role: Role, label?: string, prompt?: string): SectionDef => ({ role, label: label ?? ROLES[role].label, ...(prompt ? { prompt } : {}) });

export const TEMPLATES: TemplateDef[] = [
  {
    key: "points",
    name: "Points (topical)",
    about: "An introduction, a few points — each with Scripture, explanation, an illustration and application — and a conclusion.",
    opening: [S("intro")],
    point: { label: "Point {n}", parts: [S("scripture"), S("explain"), S("illustrate"), S("apply"), S("transition")] },
    points: 3,
    closing: [S("conclusion"), S("response")],
  },
  {
    key: "expository",
    name: "Through a passage (expository)",
    about: "The passage taken in order, a section at a time: what it says, what it means, what it asks of us.",
    opening: [S("intro"), S("context"), S("scripture", "Reading the passage")],
    point: { label: "Part {n}", parts: [S("scripture", "The verses"), S("explain", "What it says"), S("apply", "What it means for us")] },
    points: 3,
    closing: [S("conclusion"), S("response")],
    passageFirst: true,
  },
  {
    key: "bigidea",
    name: "The big idea",
    about: "One idea, stated clearly, then explained, proved from Scripture, pictured and applied.",
    credit: "after Haddon Robinson, Biblical Preaching",
    opening: [S("intro", "The need", "What question or need will make people want to hear this?"), S("bigidea", "State the big idea", "Say it plainly, the way you wrote it at the top.")],
    point: {
      label: "Movement {n}",
      parts: [S("explain", "Explain it"), S("scripture", "Prove it from Scripture"), S("illustrate", "Picture it"), S("apply", "Apply it")],
    },
    points: 3,
    closing: [S("conclusion", "The big idea again", "Say the big idea once more, so it is what people take home."), S("response")],
  },
  {
    key: "mewe",
    name: "Me – We – God – You – We",
    about: "Start with your own struggle, show it is everyone's, open God's answer, apply it to them, then picture all of you living it.",
    credit: "after Andy Stanley, Communicating for a Change",
    opening: [
      S("story", "Me", "Where have you faced this yourself?"),
      S("story", "We", "Where do we all face it?"),
      S("scripture", "God: the text"),
      S("explain", "God: what it says", "What does God say about it here?"),
      S("apply", "You", "What should each person do about it?"),
      S("conclusion", "We", "What would it look like if we all lived this?"),
    ],
    points: 0,
    closing: [S("response")],
  },
  {
    key: "hbl",
    name: "Hook – Book – Look – Took",
    about: "Catch attention, open the Bible, see the principle, take it home.",
    credit: "after Lawrence O. Richards",
    opening: [
      S("intro", "Hook", "What will catch attention and raise the question?"),
      S("scripture", "Book"),
      S("explain", "Book: what it says"),
      S("explain", "Look", "What is the principle here, for every time and place?"),
      S("apply", "Took", "What will people take home and do?"),
    ],
    points: 0,
    closing: [S("response")],
  },
  {
    key: "problem",
    name: "Problem → God's answer → response",
    about: "Three movements: the need, what God has done about it, and what we do.",
    opening: [S("intro"), S("story", "The problem", "What is the need, the hurt or the question?")],
    point: { label: "God's answer", parts: [S("scripture"), S("explain"), S("illustrate")] },
    points: 1,
    closing: [S("apply", "Our response"), S("response")],
  },
  {
    key: "fourpages",
    name: "Four pages: trouble and grace",
    about: "Trouble in the text, trouble in our world, grace in the text, grace in our world.",
    credit: "after Paul Scott Wilson, The Four Pages of the Sermon",
    opening: [
      S("scripture", "Trouble in the text"),
      S("explain", "Trouble in the text: what it shows", "What is wrong, or hard, in this passage?"),
      S("illustrate", "Trouble in our world", "Where do we see the same trouble today?"),
      S("scripture", "Grace in the text"),
      S("explain", "Grace in the text: what God does", "What does God do about it here?"),
      S("apply", "Grace in our world", "Where is God doing the same today, and how do we join in?"),
    ],
    points: 0,
    closing: [S("response")],
  },
  {
    key: "narrative",
    name: "Telling the story (narrative)",
    about: "Follow the story as it unfolds — setting, tension, turning point, resolution — then bring it to today.",
    opening: [
      S("context", "The setting"),
      S("scripture", "The story"),
      S("story", "The tension", "What goes wrong, or what is at stake?"),
      S("story", "The turning point", "Where does God act, or the story turn?"),
      S("story", "The resolution", "How does it end, and what has changed?"),
      S("apply", "The story today", "Where do we stand in this story now?"),
    ],
    points: 0,
    closing: [S("response")],
  },
  {
    key: "gospel",
    name: "The gospel (evangelistic)",
    about: "God's purpose, our need, what Christ has done, and the invitation to respond.",
    opening: [
      S("intro"),
      S("scripture", "God's purpose", "What did God make us for?"),
      S("explain", "Our need", "What has gone wrong between us and God?"),
      S("explain", "What Christ has done", "How does the cross and the resurrection answer it?"),
      S("illustrate", "A picture of it"),
      S("apply", "Our response", "What does it mean to repent and believe?"),
    ],
    points: 0,
    closing: [S("response", "The invitation", "How will you invite people to respond today?"), S("prayer")],
  },
  {
    key: "funeral",
    name: "Funeral or memorial",
    about: "Comfort, Scripture's hope, the life remembered, and prayer.",
    opening: [
      S("intro", "Welcome and comfort", "What will you say to the family first?"),
      S("scripture", "Scripture of hope"),
      S("story", "The life remembered", "What do you want to remember and give thanks for?"),
      S("explain", "The hope we have", "What does God promise to those who trust him?"),
      S("apply", "For those who mourn", "What comfort and help can you offer?"),
    ],
    points: 0,
    closing: [S("prayer")],
  },
  {
    key: "wedding",
    name: "Wedding",
    about: "Welcome, Scripture on love and marriage, a word to the couple, the charge and a blessing.",
    opening: [
      S("intro", "Welcome"),
      S("scripture"),
      S("explain", "A word to the couple", "What does this passage say to them?"),
      S("apply", "The charge", "What do you charge them to do?"),
    ],
    points: 0,
    closing: [S("prayer", "The blessing", "How will you bless them?")],
  },
  {
    key: "communion",
    name: "Communion",
    about: "The Lord's Supper: remember, examine, receive with thanks.",
    opening: [
      S("scripture", "The Lord's Supper"),
      S("explain", "Remember", "What are we remembering?"),
      S("apply", "Examine", "What should we look at in our own hearts?"),
      S("prayer", "Receive and give thanks"),
    ],
    points: 0,
    closing: [],
  },
  {
    key: "free",
    name: "No template",
    about: "Just the material you ticked, in that order; add your own headings and sections.",
    opening: [],
    points: 0,
    closing: [],
  },
];

export const templateByKey = (key: string, custom: TemplateDef[] = []): TemplateDef => [...TEMPLATES, ...custom].find((t) => t.key === key) ?? TEMPLATES[0];

/** A section's question: the template's own, or the role's. */
export const promptOf = (s: SectionDef) => s.prompt ?? ROLES[s.role].prompt;

const isScripture = (m: Material) => m.kind === "passage" || m.kind === "verse" || m.kind === "xref" || m.kind === "section";

/**
 * Lays the ticked material out as a prepared draft in a template: a section for every part,
 * each with its question; Scripture shared out over the points (a passage's sections in
 * order, for an expository sermon); commentary and word studies where the point is
 * explained, beside the Scripture they are about; quotations where it is illustrated;
 * background where the setting is described. What fits nowhere goes at the end.
 */
export function buildDraft(t: TemplateDef, points: number, chosen: Material[], topics: string[]): SermonItem[] {
  const out: SermonItem[] = [];
  const left = [...chosen];
  const take = (pred: (m: Material) => boolean, max = Infinity): Material[] => {
    const got: Material[] = [];
    for (let i = 0; i < left.length && got.length < max; ) {
      if (pred(left[i])) got.push(...left.splice(i, 1));
      else i++;
    }
    return got;
  };
  const block = (s: SectionDef, level: 1 | 2): SermonItem => ({ id: newId(), type: "block", role: s.role, label: s.label, prompt: promptOf(s), text: "", level });
  const mat = (m: Material): SermonItem => ({ id: newId(), type: "material", material: m });
  const sameChapter = (a: Material, b: Material) => !!a.ref && !!b.ref && a.ref.book === b.ref.book && a.ref.chapter === b.ref.chapter;

  if (t.key === "free") return chosen.map(mat);

  // how Scripture is shared out: a passage's own sections in order first, then the rest
  const scripture = [...chosen.filter((m) => m.kind === "section"), ...chosen.filter((m) => isScripture(m) && m.kind !== "section")];
  const n = t.point ? Math.max(1, points) : 0;
  const perPoint: Material[][] = Array.from({ length: n }, () => []);
  if (n > 0) {
    const sections = scripture.filter((m) => m.kind === "section");
    if (sections.length >= n) {
      sections.forEach((m, i) => perPoint[Math.min(n - 1, Math.floor((i * n) / sections.length))].push(m));
    } else {
      const main = scripture.find((m) => m.kind === "passage");
      const rest = scripture.filter((m) => m !== main);
      rest.forEach((m, i) => perPoint[i % n].push(m));
      if (main && t.opening.every((s) => s.role !== "scripture")) perPoint[0].unshift(main);
    }
  }

  const placeIn = (s: SectionDef, pointScripture: Material[] | null) => {
    const takes = ROLES[s.role].takes;
    if (s.role === "scripture") {
      // a point's share, or (outside the points) everything Scripture not yet placed
      return pointScripture ? take((m) => pointScripture.includes(m)) : take((m) => isScripture(m) && !perPoint.some((p) => p.includes(m)), n > 0 ? 1 : Infinity);
    }
    if (takes.length === 0) return [];
    if (pointScripture) {
      // what explains this point's own Scripture first, then a fair share of the rest
      const near = take((m) => takes.includes(m.kind) && pointScripture.some((sc) => sameChapter(sc, m)));
      return near.length ? near : take((m) => takes.includes(m.kind), 2);
    }
    return take((m) => takes.includes(m.kind), n > 0 ? 2 : Infinity);
  };

  for (const s of t.opening) {
    out.push(block(s, 1));
    out.push(...placeIn(s, null).map(mat));
  }
  for (let p = 0; p < n; p++) {
    const title = t.point!.label.replace("{n}", String(p + 1));
    // with several topics typed, each point is a topic
    const topic = topics.length === n ? topics[p] : "";
    out.push({ id: newId(), type: "heading", text: topic ? `${title}: ${topic.charAt(0).toUpperCase()}${topic.slice(1)}` : title });
    for (const s of t.point!.parts) {
      if (s.role === "transition" && p === n - 1) continue;
      out.push(block(s, 2));
      out.push(...placeIn(s, perPoint[p]).map(mat));
    }
  }
  for (const s of t.closing) {
    out.push(block(s, 1));
    out.push(...placeIn(s, null).map(mat));
  }
  if (left.length) {
    out.push({ id: newId(), type: "heading", text: "More material you ticked" });
    out.push(...left.map(mat));
  }
  return out;
}

/** The layout of a draft, to save as the preacher's own template. */
export function templateFromItems(name: string, items: SermonItem[]): TemplateDef {
  const opening: SectionDef[] = [];
  for (const i of items) {
    if (i.type === "block") opening.push({ role: i.role, label: i.label, prompt: i.prompt });
    else if (i.type === "heading") opening.push({ role: "story", label: i.text, prompt: "" });
  }
  return { key: `custom:${name}`, name, about: "Your own template.", opening, points: 0, closing: [], custom: true };
}
