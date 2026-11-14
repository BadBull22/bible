// Content Factory: what is remembered between visits: the names for the bottom-left corner, the small mark in the bottom-right,
// where the footer sits in the tall sizes. Kept in the window's own storage (a convenience: if it is ever cleared the studio
// simply asks for the name again).

import { DEFAULT_RECIPES, type RecipeId } from "./autopilot";
import { DEFAULT_CUT, FooterSettings, NO_BAND, SITE_MARK, SizeId, type BandConfig, type LogoCut } from "./types";

const KEY = "factory:settings:v1";

export interface FactorySettings {
  /** the list of names a picture can carry (the first listed with `defaultName`) */
  names: string[];
  defaultName: number;
  namePrefix: string;
  mark: FooterSettings["mark"];
  place: FooterSettings["place"];
  /** has the name question been asked */
  asked: boolean;
  version: string;
  sizes: SizeId[];
  musicLevel: number;
  /** what "Make my week" makes */
  recipes: RecipeId[];
  /** the header and the footer: the same choices for both, and the picture each carries (a logo or a banner, as a data address): the one drawn, and the
   * one the reader chose (the same unless the logo's background is taken off) */
  header: BandConfig;
  headerImage: string;
  headerOrig: string;
  footerBand: BandConfig;
  footerImage: string;
  footerOrig: string;
  /** whether a set made from several verses gets a different look on each picture (or the same look on all) */
  varyLooks: boolean;
  /** the studio: which side the tool bar is docked to, the tool open (and whether its panel is shown), the shelf of made pictures */
  dock: Dock;
  tool: ToolId;
  panelOpen: boolean;
  libOpen: boolean;
  libView: "icons" | "list";
}

export type Dock = "left" | "right" | "top" | "bottom";
export const DOCKS: Dock[] = ["left", "right", "top", "bottom"];
export type ToolId = "text" | "look" | "photos" | "sizes" | "header" | "footer" | "video" | "post";
export const TOOL_IDS: ToolId[] = ["text", "look", "photos", "sizes", "header", "footer", "video", "post"];

export const DEFAULTS: FactorySettings = {
  names: [],
  defaultName: 0,
  namePrefix: "",
  mark: { kind: "site", text: "" },
  place: "safe",
  asked: false,
  version: "BSB",
  sizes: ["square", "story"],
  musicLevel: 0.85,
  recipes: DEFAULT_RECIPES,
  header: NO_BAND,
  headerImage: "",
  headerOrig: "",
  footerBand: { ...NO_BAND, align: "left" },
  footerImage: "",
  footerOrig: "",
  varyLooks: true,
  dock: "left",
  tool: "look",
  panelOpen: true,
  libOpen: false,
  libView: "icons",
};

const KINDS = ["none", "text", "logo", "logotext", "picture"];
const cleanImage = (v: unknown) => (typeof v === "string" && v.startsWith("data:image/") ? v : "");

/** a band read back from storage, with anything odd put right */
function cleanBand(v: unknown): BandConfig {
  const b = (v ?? {}) as Partial<BandConfig>;
  const cut = (b.cut ?? {}) as Partial<LogoCut>;
  return {
    kind: KINDS.includes(String(b.kind)) ? (b.kind as BandConfig["kind"]) : "none",
    text: typeof b.text === "string" ? b.text.slice(0, 80) : "",
    align: b.align === "left" || b.align === "right" ? b.align : "center",
    style: b.style === "clear" || b.style === "solid" || b.style === "shade" ? b.style : "black",
    color: typeof b.color === "string" && /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : NO_BAND.color,
    size: b.size === "small" || b.size === "large" ? b.size : "medium",
    on: b.on !== false,
    ink: typeof b.ink === "string" && /^#[0-9a-fA-F]{6}$/.test(b.ink) ? b.ink : undefined,
    cut: { on: cut.on === true, tolerance: typeof cut.tolerance === "number" ? Math.max(0, Math.min(100, cut.tolerance)) : DEFAULT_CUT.tolerance, holes: cut.holes === true },
  };
}

export function loadSettings(): FactorySettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS, mark: { ...DEFAULTS.mark } };
    const s = JSON.parse(raw) as Omit<Partial<FactorySettings>, "tool"> & { bar?: { style?: string; color?: string }; tool?: string };
    // the footer bar's look used to be kept apart; it is now the footer's own background, like the header's
    const footerBand = cleanBand(s.footerBand);
    // a footer the reader never set up keeps its usual place: the text at the left, the small print at the right
    if (footerBand.kind === "none" && !footerBand.text) footerBand.align = "left";
    if (s.bar) {
      if (s.bar.style === "shade" || s.bar.style === "solid" || s.bar.style === "clear" || s.bar.style === "black") footerBand.style = s.bar.style;
      if (typeof s.bar.color === "string" && /^#[0-9a-fA-F]{6}$/.test(s.bar.color)) footerBand.color = s.bar.color;
    }
    return {
      ...DEFAULTS,
      ...s,
      names: Array.isArray(s.names) ? s.names.filter((n) => typeof n === "string") : [],
      mark: s.mark && ["site", "custom", "none"].includes(s.mark.kind) ? { kind: s.mark.kind, text: String(s.mark.text ?? "") } : { ...DEFAULTS.mark },
      sizes: Array.isArray(s.sizes) && s.sizes.length ? s.sizes : DEFAULTS.sizes,
      recipes: Array.isArray(s.recipes) ? s.recipes : DEFAULT_RECIPES,
      header: cleanBand(s.header),
      headerImage: cleanImage(s.headerImage),
      headerOrig: cleanImage(s.headerOrig) || cleanImage(s.headerImage),
      footerBand,
      footerImage: cleanImage(s.footerImage),
      footerOrig: cleanImage(s.footerOrig) || cleanImage(s.footerImage),
      varyLooks: s.varyLooks !== false,
      dock: DOCKS.includes(s.dock as Dock) ? (s.dock as Dock) : DEFAULTS.dock,
      tool: s.tool === "brand" ? "footer" : TOOL_IDS.includes(s.tool as ToolId) ? (s.tool as ToolId) : DEFAULTS.tool,
      panelOpen: s.panelOpen !== false,
      libOpen: s.libOpen === true,
      libView: s.libView === "list" ? "list" : "icons",
    };
  } catch {
    return { ...DEFAULTS, mark: { ...DEFAULTS.mark } };
  }
}

export function saveSettings(s: FactorySettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: the settings last for this visit only */
  }
}

/** the name on pictures when nothing else is chosen */
export const defaultName = (s: FactorySettings) => s.names[s.defaultName] ?? s.names[0] ?? "";

export function footerOf(s: FactorySettings): FooterSettings {
  return { name: defaultName(s), namePrefix: s.namePrefix, mark: s.mark.kind === "site" ? { kind: "site", text: SITE_MARK } : s.mark, place: s.place, header: s.header, band: s.footerBand };
}
