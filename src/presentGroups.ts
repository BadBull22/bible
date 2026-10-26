// The slide grid of "Present from this laptop": how a sermon's slides fall into groups the way ProPresenter's do
// (a coloured strip under each slide with its number, the group's name on the group's first slide, a letter badge
// that is the group's key), and what colour and word each kind of slide gets. Pure, so it can be tested under Node.

import type { SlideSpec } from "./sermonOutputs";

export interface SlideGroup {
  /** what the strip says on the group's first slide */
  name: string;
  /** the key that jumps to the group ("" when the letters have run out) */
  letter: string;
  /** the group's first slide, and the one after its last */
  from: number;
  to: number;
}

/** Letters that are not offered as group keys, because the show uses them: B (black), N (next), P (back). */
const LETTERS = "ACDEFGHIJKLMOQRSTUVWXYZ".split("");

/** A song's slides (made from the song library) are one group, named for the song; a song slide typed by hand starts its own. */
const startsGroup = (s: SlideSpec, before?: SlideSpec) => {
  if (s.kind === "title") return true;
  // a library song: its title slide starts it (so a song sung twice is two groups); without one, its first slide does
  if (s.song) return s.section === "Title" || before?.song !== s.song;
  return s.kind === "point" || s.kind === "song";
};

/** The groups, and for each slide the number of its group. A title, a point (a heading) or a song (all of a library song's slides are one) starts one; a
 * Scripture, picture, link or words slide joins the group before it. */
export function groupsOf(slides: SlideSpec[]): { groups: SlideGroup[]; groupOf: number[] } {
  const groups: SlideGroup[] = [];
  const groupOf: number[] = [];
  slides.forEach((s, i) => {
    if (i === 0 || startsGroup(s, slides[i - 1])) {
      const n = groups.length;
      groups.push({ name: s.kind === "title" ? "Title" : s.song?.trim() || s.title.trim() || "Slides", letter: LETTERS[n] ?? "", from: i, to: i + 1 });
    } else groups[groups.length - 1].to = i + 1;
    groupOf.push(groups.length - 1);
  });
  return { groups, groupOf };
}

export type StripKind = "title" | "point" | "scripture" | "words" | "song" | "picture" | "video" | "music" | "link" | "countdown";

/** What a slide is, for its colour and the word on its strip. `clip` says what a link slide plays: a video, music, or nothing. */
export function stripKind(s: SlideSpec, clip: "video" | "audio" | null): StripKind {
  if (s.song) return "song";
  switch (s.kind) {
    case "title":
      return "title";
    case "point":
      return "point";
    case "scripture":
      return "scripture";
    case "song":
      return "song";
    case "countdown":
      return "countdown";
    case "image":
      return "picture";
    case "link":
      return clip === "video" ? "video" : clip === "audio" ? "music" : "link";
    default:
      return "words";
  }
}

export const STRIP_LABEL: Record<StripKind, string> = {
  title: "Title",
  point: "Point",
  scripture: "Scripture",
  words: "Words",
  song: "Song",
  picture: "Picture",
  video: "Video",
  music: "Music",
  link: "Link",
  countdown: "Countdown",
};

/** The first slide of the group a key jumps to, or null when no group has that letter. */
export function slideForLetter(groups: SlideGroup[], key: string): number | null {
  if (key.length !== 1) return null;
  const g = groups.find((x) => x.letter !== "" && x.letter === key.toUpperCase());
  return g ? g.from : null;
}
