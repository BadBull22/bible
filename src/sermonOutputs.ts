// What comes out of a finished sermon besides the preacher's own document: a listener's
// outline, a fill-in-the-blanks handout (with its answer key), a small-group guide, and
// slides. All are built mechanically from what the preacher wrote and chose -- the guide's
// questions are a fixed bank, the same for every sermon, with the passages filled in.
import type { SheetBlock } from "./api";
import { isScripture, Material, refLabel, SermonItem, SermonMeta, stripMarks, textRuns } from "./sermon";
import { scriptureSlides, tidyQuotes, versesOf } from "./scriptureSlides";

export { scriptureSlides, tidyQuotes, versesOf };

const when = (d: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : "");

/** The points of the sermon: each heading with the Scripture under it. */
export function outlineOf(items: SermonItem[]): { title: string; scripture: Material[]; apply: string }[] {
  const out: { title: string; scripture: Material[]; apply: string }[] = [];
  for (const i of items) {
    if (i.type === "heading") out.push({ title: i.text, scripture: [], apply: "" });
    else if (i.type === "block" && i.level === 1 && i.role !== "intro" && i.role !== "bigidea" && i.role !== "context" && i.role !== "conclusion" && i.role !== "prayer" && i.role !== "response")
      out.push({ title: i.label, scripture: [], apply: i.role === "apply" ? i.text : "" });
    else if (out.length && i.type === "material" && isScripture(i.material)) out[out.length - 1].scripture.push(i.material);
    else if (out.length && i.type === "block" && i.role === "apply" && i.text.trim()) out[out.length - 1].apply = i.text;
  }
  return out.filter((p) => p.title.trim() && p.title !== "More material you ticked");
}

/** The passages of the sermon, the main one first. */
export function passagesOf(items: SermonItem[]): string[] {
  const refs: string[] = [];
  for (const i of items) {
    if (i.type !== "material" || !isScripture(i.material)) continue;
    const r = i.material.ref;
    const label = r ? (r.verseEnd >= 200 ? `${r.book} ${r.chapter}` : refLabel(r)) : i.material.title;
    if (!refs.includes(label)) refs.push(label);
  }
  return refs;
}

function head(meta: SermonMeta, kind: string): SheetBlock[] {
  const sub = [kind, meta.series.trim() ? `Series: ${meta.series.trim()}` : "", when(meta.preachedOn)].filter(Boolean).join(" · ");
  return [
    { kind: "title", text: meta.title.trim() || "Sermon" },
    { kind: "subtitle", text: sub },
  ];
}

/** A listener's outline: the big idea, the passage, each point with its Scripture, and
 * room for notes. `blanks`: leave the [[marked]] words as gaps to fill in. */
export function listenerOutline(meta: SermonMeta, items: SermonItem[], blanks: boolean, lines = 3): SheetBlock[] {
  const gap = blanks ? "gaps" : "words";
  const out = head(meta, blanks ? "Fill in as you listen" : "Sermon notes");
  const passages = passagesOf(items);
  if (passages.length) out.push({ kind: "para", runs: [{ text: "Scripture: ", bold: true }, { text: passages.slice(0, 6).join("; ") }] });
  if (meta.bigIdea?.trim()) out.push({ kind: "quote", runs: [{ text: "The big idea: ", bold: true }, ...textRuns(meta.bigIdea.trim(), gap)] });
  outlineOf(items).forEach((p, n) => {
    const title = blanks ? p.title.replace(/\[\[([^\]]*)\]\]/g, (_, w: string) => "_".repeat(Math.max(8, w.length + 4))) : stripMarks(p.title);
    out.push({ kind: "heading", text: `${n + 1}. ${title.trim()}` });
    if (p.scripture.length) out.push({ kind: "para", runs: [{ text: p.scripture.map((m) => m.title).join("; "), italic: true }] });
    if (p.apply.trim() && /\[\[/.test(p.apply)) out.push({ kind: "para", runs: textRuns(p.apply.split("\n")[0], gap) });
    if (lines > 0) out.push({ kind: "lines", count: lines });
  });
  out.push({ kind: "heading", text: "My response this week" }, { kind: "lines", count: 3 });
  return out;
}

/** Every [[marked]] word, in order, for the answer key. */
export function blankWords(meta: SermonMeta, items: SermonItem[]): string[] {
  const all = [meta.bigIdea ?? "", ...outlineOf(items).flatMap((p) => [p.title, p.apply.split("\n")[0]])].join("\n");
  return [...all.matchAll(/\[\[([^\]]*)\]\]/g)].map((m) => m[1]);
}

export function answerKey(meta: SermonMeta, items: SermonItem[]): SheetBlock[] {
  const words = blankWords(meta, items);
  return [
    { kind: "heading", text: "Answers" },
    { kind: "para", runs: [{ text: words.length ? words.map((w, i) => `${i + 1}. ${w}`).join("   ") : "No words are marked for blanks yet." }] },
  ];
}

/** A small-group guide: the passages, and a fixed bank of questions to observe, understand
 * and apply them -- the same questions for every sermon, with the passages and points in. */
export function groupGuide(meta: SermonMeta, items: SermonItem[]): SheetBlock[] {
  const out = head(meta, "Small-group guide");
  const passages = passagesOf(items);
  const main = passages[0] ?? "the passage";
  const q = (text: string): SheetBlock => ({ kind: "para", runs: [{ text: "•  " }, { text }] });
  out.push({ kind: "heading", text: "Open" }, q("What stood out to you from the sermon?"), q("Is there something you have been thinking about since?"));
  out.push({ kind: "heading", text: "Read" }, { kind: "para", runs: [{ text: `Read ${passages.slice(0, 3).join(", ") || "the passage"} aloud together.`, italic: true }] });
  out.push(
    { kind: "heading", text: "Observe" },
    q(`What does ${main} show us about God?`),
    q("What does it show us about people — about us?"),
    q("Which words or ideas are repeated? Why might that be?"),
    q("Is there a command to obey, a promise to trust, or an example to follow or avoid?"),
  );
  out.push(
    { kind: "heading", text: "Understand" },
    q("What would this have meant to the people who first heard it?"),
    q("How does the rest of the Bible help us understand it?"),
  );
  if (passages.length > 1) out.push(q(`Look at ${passages.slice(1, 4).join(", ")}. How do these add to it?`));
  if (meta.bigIdea?.trim()) out.push(q(`The sermon's main idea was: “${stripMarks(meta.bigIdea.trim()).replace(/[.!?]+$/, "")}.” How would you say it in your own words?`));
  out.push({ kind: "heading", text: "Apply" });
  for (const p of outlineOf(items).slice(0, 5)) out.push(q(`${stripMarks(p.title)}: where does this touch your life this week?`));
  out.push(q("What is one thing you will do differently because of this?"), q("Who could you share this with?"));
  out.push({ kind: "heading", text: "Pray" }, q("Pray for one another about what you have heard, and about the step each person named."));
  return out;
}

/** "countdown": a clock counting down to zero ("The service starts in 5:00"); its words say how long, or to what time */
import type { SlideLayout } from "./slideLayout";

export type SlideKind = "title" | "point" | "scripture" | "text" | "song" | "image" | "link" | "countdown";

export interface SlideSpec {
  kind: SlideKind;
  title: string;
  body: string;
  /** an "image" slide's picture: a file kept for the sermon */
  image?: string;
  /** this slide's own background: a kept photo, "" for plain navy, or absent to use the one
   * chosen for all the slides */
  background?: string;
  /** a see-through picture over this slide's background: a kept file, "" for none, or absent to use the one for all the slides */
  overlay?: string;
  /** where the heading graphic, the words and the picture beside them have been put by hand (percent of the slide); absent: spaced automatically */
  layout?: SlideLayout;
  /** the written heading is left off the slide (a heading graphic over the background stands in for it) */
  noHeading?: boolean;
  /** a picture beside the words (heading, words, song, Scripture and title slides) */
  picture?: string;
  /** what a "link" slide opens: a web address, or "media:<file>" for a kept file */
  link?: string;
  /** the preacher's own notes, shown only to them in the presenter view */
  notes?: string;
  /** the sermon item a slide was made from (a point's heading, a passage, a picture), so that moving
   * the slide can move the sermon the same way (slideOrder.ts); absent on the preacher's own slides */
  from?: string;
  /** a song's slide: the song it is of, and which part of it (Verse 1, Chorus...); the show groups the slides by song */
  song?: string;
  section?: string;
  /** the title slide stays at the top: it can't be moved (only a title slide can be pinned) */
  pinned?: boolean;
}

/** Slides from the sermon: the title, the big idea, each point, and each Scripture passage
 * (a long passage over several slides, a few verses each). `verseNumbers`: show the verse
 * numbers on Scripture slides. */
export function slidesOf(meta: SermonMeta, items: SermonItem[], version: string, verseNumbers = true): SlideSpec[] {
  const out: SlideSpec[] = [{ kind: "title", title: meta.title.trim() || "Sermon", body: [meta.series.trim(), when(meta.preachedOn)].filter(Boolean).join(" · "), pinned: true }];
  if (meta.bigIdea?.trim()) out.push({ kind: "point", title: stripMarks(meta.bigIdea.trim()), body: "" });
  for (const i of items) {
    if (i.type === "heading" && i.text !== "More material you ticked") {
      out.push({ kind: "point", title: stripMarks(i.text), body: "", from: i.id });
    } else if (i.type === "material" && isScripture(i.material)) {
      const text = tidyQuotes(i.material.text.replace(/⟪\d+⟫/g, "").replace(/\s+/g, " ").trim());
      const v = (i.material.source ?? version).split(" · ")[0];
      const ref = i.material.ref;
      const chunks = scriptureSlides(text, ref?.verse ?? null, verseNumbers);
      chunks.forEach((c, n) => {
        // each slide names its own verses ("John 3:16–18"), when they are known
        const where =
          ref && c.from != null ? `${ref.book} ${ref.chapter}:${c.from}${c.to != null && c.to > c.from ? `–${c.to}` : ""}` : `${i.material.title}${chunks.length > 1 ? ` (${n + 1}/${chunks.length})` : ""}`;
        out.push({ kind: "scripture", title: `${where} · ${v}`, body: c.text, from: i.id });
      });
    } else if (i.type === "media") {
      const m = i.media;
      if (m.kind === "image" && m.file) out.push({ kind: "image", title: m.title, body: "", image: m.file, from: i.id });
      else if (m.url || m.file) out.push({ kind: "link", title: m.title, body: m.kind === "video" || m.kind === "audio" ? "▶ Play" : "Open", link: m.url ?? `media:${m.file}`, from: i.id });
    }
  }
  return out;
}
