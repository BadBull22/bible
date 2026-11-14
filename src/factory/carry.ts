// Content Factory: what travels in the computer's backup file (the names, the logos, the header and footer, the inbox of posts) and how it
// is put back. Pure, so it can be tested under Node (scripts/test_carry.mts); src/backupExtras.ts does the reading and writing of the window's storage.
//
// What a backup holds is for the reader's work, so putting it back never overwrites newer work: the settings come back only on a computer that has not
// been set up (the name question not answered yet), posts are added next to the ones already there (a post already here keeps its own status),
// and the "made recently" memory is joined.

/** the settings that belong to the reader's work; where the tool bar sits, the open tool and the shelf's view stay with each computer */
export const PORTABLE_SETTINGS = [
  "names",
  "defaultName",
  "namePrefix",
  "mark",
  "place",
  "asked",
  "version",
  "sizes",
  "musicLevel",
  "recipes",
  "header",
  "headerImage",
  "headerOrig",
  "footerBand",
  "footerImage",
  "footerOrig",
  "varyLooks",
] as const;

type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);

/** the most posts a backup brings back, and the longest memory of what was made */
export const MAX_POSTS = 600;
export const MAX_HISTORY = 4000;

/** only the settings that travel, from the window's stored settings (nothing stored: null) */
export function portableSettings(raw: unknown): Dict | null {
  if (!isDict(raw)) return null;
  const out: Dict = {};
  for (const k of PORTABLE_SETTINGS) if (raw[k] !== undefined) out[k] = raw[k];
  return Object.keys(out).length ? out : null;
}

export interface FactoryExtras {
  settings?: Dict;
  posts?: unknown[];
  history?: unknown[];
}

/** what goes into the backup: nothing (null) when the factory has never been used */
export function collectFactory(settingsRaw: unknown, posts: unknown, history: unknown): { factory: FactoryExtras } | null {
  const settings = portableSettings(settingsRaw);
  const p = Array.isArray(posts) ? posts.filter(validPost) : [];
  const h = Array.isArray(history) ? history.filter(validHistory) : [];
  if (!settings && !p.length) return null;
  const factory: FactoryExtras = {};
  if (settings) factory.settings = settings;
  if (p.length) factory.posts = p;
  if (h.length) factory.history = h;
  return { factory };
}

function validPost(p: unknown): boolean {
  if (!isDict(p) || typeof p.id !== "string" || !p.id || !Array.isArray(p.cards) || p.cards.length === 0) return false;
  return p.cards.every((c) => isDict(c) && typeof c.text === "string");
}

function validHistory(h: unknown): h is { key: string; day: number } {
  return isDict(h) && typeof h.key === "string" && typeof h.day === "number" && Number.isFinite(h.day);
}

const STATUSES = ["new", "approved", "posted", "skipped"];

export interface Local {
  /** the stored settings, nothing when none were ever saved */
  settings: Dict | null;
  posts: unknown[];
  history: unknown[];
}

export interface Outcome {
  settings: Dict | null;
  posts: unknown[];
  history: unknown[];
  /** the names, logos and header/footer came back */
  settingsRestored: boolean;
  postsAdded: number;
}

/** a computer where the studio was never set up: nothing saved, or the name question not answered */
export function isFresh(settings: Dict | null): boolean {
  return !settings || settings.asked !== true;
}

/** the backup's factory extras joined to what is here; `incoming` is whatever the file held, so each part is checked */
export function mergeFactory(local: Local, incoming: unknown): Outcome {
  const out: Outcome = { settings: local.settings, posts: local.posts, history: local.history, settingsRestored: false, postsAdded: 0 };
  const factory = isDict(incoming) && isDict(incoming.factory) ? incoming.factory : null;
  if (!factory) return out;

  const theirs = portableSettings(factory.settings);
  if (theirs && isFresh(local.settings)) {
    // the screen's own choices (dock, open tool...) stay as they are here
    out.settings = { ...(local.settings ?? {}), ...theirs };
    out.settingsRestored = true;
  }

  if (Array.isArray(factory.posts)) {
    const have = new Set(local.posts.filter(isDict).map((p) => String(p.id)));
    const added: unknown[] = [];
    for (const p of factory.posts.slice(0, MAX_POSTS)) {
      if (!validPost(p)) continue;
      const post = p as Dict;
      if (have.has(String(post.id))) continue;
      have.add(String(post.id));
      added.push(STATUSES.includes(String(post.status)) ? post : { ...post, status: "new" });
    }
    if (added.length) {
      out.posts = [...local.posts, ...added];
      out.postsAdded = added.length;
    }
  }

  if (Array.isArray(factory.history)) {
    const seen = new Set(local.history.filter(validHistory).map((h) => `${h.key}|${h.day}`));
    const more: unknown[] = [];
    for (const h of factory.history.slice(0, MAX_HISTORY)) {
      if (!validHistory(h)) continue;
      const id = `${h.key}|${h.day}`;
      if (seen.has(id)) continue;
      seen.add(id);
      more.push({ key: h.key, day: h.day });
    }
    if (more.length) out.history = [...local.history, ...more];
  }
  return out;
}

/** a line for the screen after an import ("" when nothing of the factory came back) */
export function describe(o: Pick<Outcome, "settingsRestored" | "postsAdded">): string {
  const parts: string[] = [];
  if (o.settingsRestored) parts.push("your names, logos and header and footer");
  if (o.postsAdded) parts.push(`${o.postsAdded} ready-to-post item${o.postsAdded === 1 ? "" : "s"}`);
  if (!parts.length) return "";
  return `Content Factory: ${parts.join(" and ")} came back.`;
}
