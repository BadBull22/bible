// The Sunday service: notices, music and the sermon, each its own saved presentation, put together for the
// presenter. A saved notices or music deck holds its slides (and the photo behind them) as JSON; a saved sermon
// makes its slides the way the sermon builder does.

import { api, Deck, DeckKind, SavedSermon } from "./api";
import type { SermonBody } from "./sermon";
import type { MediaRef } from "./sermonMedia";
import { SlideSpec, slidesOf } from "./sermonOutputs";

export type ServiceKind = DeckKind | "sermon";

export const KIND_NAME: Record<ServiceKind, string> = { notices: "Notices", music: "Music", sermon: "Sermon" };

export interface DeckBody {
  slides: SlideSpec[];
  background: string | null;
  /** a see-through picture over the background */
  overlay?: string | null;
}

export function parseDeck(body: string): DeckBody {
  try {
    const b = JSON.parse(body || "{}") as Partial<DeckBody>;
    return { slides: Array.isArray(b.slides) ? b.slides : [], background: b.background ?? null, overlay: b.overlay ?? null };
  } catch {
    return { slides: [], background: null, overlay: null };
  }
}

export const deckBody = (slides: SlideSpec[], background: string | null, overlay: string | null = null): string => JSON.stringify({ slides, background, overlay } satisfies DeckBody);

/** What the presenter is given for one part of the service. */
export interface PresenterDeck {
  /** the part: "Notices", "Music", "Sermon" */
  kind: ServiceKind;
  /** its name, "Notices for March" */
  title: string;
  slides: SlideSpec[];
  background: string | null;
  /** a see-through picture over the background */
  overlay?: string | null;
  /** what its place is remembered under */
  resumeKey: string;
}

/** A saved sermon's slides: the ones the preacher edited, or those made from the sermon. */
export function slidesOfSermon(s: SavedSermon, version: string): { slides: SlideSpec[]; background: string | null; overlay: string | null } {
  let b: Partial<SermonBody> = {};
  try {
    b = JSON.parse(s.body || "{}");
  } catch {
    /* an empty sermon */
  }
  const numbers = b.slideVerseNumbers ?? true;
  const slides =
    b.slides ??
    slidesOf(
      {
        title: s.title,
        series: s.series,
        preachedOn: s.preached_on,
        topics: s.topics,
        blankLines: b.blankLines ?? 4,
        bigIdea: b.bigIdea ?? "",
        purpose: b.purpose ?? "",
        venue: s.venue,
        showLabels: b.showLabels ?? true,
        showPrompts: b.showPrompts ?? false,
      },
      b.items ?? [],
      version,
      numbers,
    );
  return { slides, background: b.slideBackground ?? null, overlay: b.slideOverlay ?? null };
}

export async function loadServicePart(kind: ServiceKind, id: number, version: string): Promise<PresenterDeck | null> {
  if (kind === "sermon") {
    const s = await api.sermonGet(id);
    if (!s) return null;
    const { slides, background, overlay } = slidesOfSermon(s, version);
    return { kind, title: s.title, slides, background, overlay, resumeKey: String(s.id) };
  }
  const d: Deck | null = await api.deckGet(id);
  if (!d) return null;
  const { slides, background, overlay } = parseDeck(d.body);
  return { kind, title: d.title, slides, background, overlay, resumeKey: `${kind}:${d.id}` };
}

/** Which saved one of each is in the service (kept for next time). */
export type ServiceChoice = Partial<Record<ServiceKind, number>>;
const CHOICE_KEY = "bc-service";

export function savedChoice(): ServiceChoice {
  try {
    return JSON.parse(localStorage.getItem(CHOICE_KEY) ?? "{}") as ServiceChoice;
  } catch {
    return {};
  }
}

export function keepChoice(c: ServiceChoice): void {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(c));
  } catch {
    /* not remembered */
  }
}

/** The Bible that "show this verse" starts with: chosen once, kept. */
const BIBLE_KEY = "bc-default-bible";
export function defaultBible(fallback: string): string {
  try {
    return localStorage.getItem(BIBLE_KEY) || fallback;
  } catch {
    return fallback;
  }
}
export function keepDefaultBible(code: string): void {
  try {
    localStorage.setItem(BIBLE_KEY, code);
  } catch {
    /* not remembered */
  }
}

/** The slide a picture, video, music file or web link makes: a picture is a picture slide; the rest are words to click. */
export const slideOfMedia = (m: MediaRef): SlideSpec =>
  m.kind === "image" && m.file
    ? { kind: "image", title: m.title, body: "", image: m.file }
    : { kind: "link", title: m.title, body: m.kind === "video" || m.kind === "audio" ? "▶ Play" : "Open", link: m.url ?? `media:${m.file}` };
