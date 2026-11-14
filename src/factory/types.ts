// Content Factory: the shapes shared by the drawing, the looks, the music and the video.
// Everything a card needs to be drawn again later is plain data here (a "scene"), so a project can be saved and re-edited.

export type SizeId = "square" | "portrait" | "story" | "wide" | "link";

export interface SizeInfo {
  id: SizeId;
  label: string;
  /** where it is used, in plain words */
  note: string;
  w: number;
  h: number;
}

export const SIZES: SizeInfo[] = [
  { id: "square", label: "Square", note: "Facebook, Instagram, WhatsApp", w: 1080, h: 1080 },
  { id: "portrait", label: "Portrait", note: "Instagram and Facebook feeds", w: 1080, h: 1350 },
  { id: "story", label: "Story / Reel / Status", note: "Tall: Stories, Reels, TikTok, Shorts, WhatsApp Status", w: 1080, h: 1920 },
  { id: "wide", label: "Wide", note: "YouTube, church screens", w: 1920, h: 1080 },
  { id: "link", label: "Link picture", note: "The picture shown with a web link", w: 1200, h: 630 },
];

export const sizeById = (id: SizeId): SizeInfo => SIZES.find((s) => s.id === id) ?? SIZES[0];

/** How the words sit on the picture. */
export type LayoutId = "centre" | "low" | "top" | "card" | "quote" | "ribbon";

export const LAYOUTS: { id: LayoutId; label: string }[] = [
  { id: "centre", label: "Centred" },
  { id: "low", label: "Low" },
  { id: "top", label: "High" },
  { id: "card", label: "On a card" },
  { id: "quote", label: "Big quote mark" },
  { id: "ribbon", label: "Reference ribbon" },
];

export interface FontChoice {
  id: string;
  label: string;
  /** CSS family list; only fonts that come with Windows, so the picture looks the same on every computer that runs the app */
  family: string;
}

export const FONTS: FontChoice[] = [
  { id: "classic", label: "Classic", family: 'Georgia, "Times New Roman", serif' },
  { id: "book", label: "Book", family: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif' },
  { id: "elegant", label: "Elegant", family: 'Constantia, "Palatino Linotype", Georgia, serif' },
  { id: "modern", label: "Modern", family: '"Segoe UI", Inter, Arial, sans-serif' },
  { id: "soft", label: "Soft", family: 'Candara, "Segoe UI", Calibri, sans-serif' },
  { id: "bold", label: "Bold", family: '"Trebuchet MS", "Segoe UI", Arial, sans-serif' },
];

export const fontById = (id: string): FontChoice => FONTS.find((f) => f.id === id) ?? FONTS[0];

/** A flat background: two colours and a direction, with an optional soft glow. */
export interface GradientBg {
  kind: "gradient";
  from: string;
  to: string;
  /** degrees, 0 = top to bottom */
  angle: number;
  glow?: { x: number; y: number; r: number; color: string };
}

/** A picture behind the words (a nature photo, a Bible painting, the reader's own). The pixels live in `Pictures`, by key. */
export interface ImageBg {
  kind: "image";
  /** key into the pictures the page holds (see pictureBank) */
  key: string;
  /** 0 to 0.8: how much the picture is darkened so the words stay readable */
  darken: number;
  /** a credit the picture's licence needs (empty for public domain and CC0) */
  credit?: string;
  /** where the picture is focused, 0..1 (0.5 = the middle) */
  focusX: number;
  focusY: number;
  /** 0 to 1: how much the picture is softened (blurred) so that it does not clash with the words; none when left out */
  blur?: number;
}

export type Background = GradientBg | ImageBg;

export interface Look {
  id: string;
  label: string;
  layout: LayoutId;
  fontId: string;
  bold: boolean;
  capitals: boolean;
  /** text, reference and accent colours */
  ink: string;
  accent: string;
  background: Background;
  /** a soft see-through card behind the words (for the "On a card" layout) */
  cardColor: string;
}

/** What goes in the footer bar across the bottom: the name, the site mark, the credits, a logo. */
export interface FooterSettings {
  /** at the left: the person's name (empty = none) */
  name: string;
  /** a word in front of the name: "", "by ", "Shared by " */
  namePrefix: string;
  /** at the right: the small site mark */
  mark: { kind: "site" | "custom" | "none"; text: string };
  /** tall sizes: keep the footer above the buttons the apps lay over the bottom ("safe"), or at the very edge */
  place: "safe" | "edge";
  /** a band across the top of every picture: the church name or a line of text, a logo, or a banner picture */
  header?: BandConfig;
  /** the footer bar's own content and look: the church's text, a logo or a banner, its background (black by default), size and placement; the credit, name and site mark are always in it */
  band?: BandConfig;
}

/** Where something sits on a picture, as fractions: the middle of it across and down, and its width as a share of the picture's width. A logo the reader
 * has dragged to a place of their own (and made bigger or smaller) has one. */
export interface Place {
  x: number;
  y: number;
  w: number;
}

/** A header or footer band, the same set of choices for both. What it shows: text, a logo, a logo with text beside it, or a banner picture (kept in the
 * picture bank under "band:header" or "band:footer"; text on a banner is drawn over it). */
export interface BandConfig {
  kind: "none" | "text" | "logo" | "logotext" | "picture";
  text: string;
  /** where the text (and the logo, in the header) sit */
  align: "left" | "center" | "right";
  /** clear: no strip, straight on the picture; black; shade: a soft dark strip; solid: a strip of `color` */
  style: "clear" | "black" | "shade" | "solid";
  color: string;
  size: "small" | "medium" | "large";
  /** switched off: kept for later, shown on no picture (undefined = on) */
  on?: boolean;
  /** a logo with a plain black or white background: take the background away so it sits on the strip or the picture cleanly */
  cut?: LogoCut;
  /** the saved default place of the logo, on every picture: when there is one the logo is drawn there, on the picture, not in the strip */
  logoAt?: Place;
  /** the same for the text (its width sets the size of the letters) */
  textAt?: Place;
  /** the colour of the text (the footer's: of all its small texts); when left out it is white or dark by what is behind it */
  ink?: string;
}

export interface LogoCut {
  on: boolean;
  /** how different from the background colour a pixel may be and still count as background, 0 to 100 */
  tolerance: number;
  /** also take away the background colour inside the logo (the holes in letters), not only what joins the edge */
  holes: boolean;
}

export const DEFAULT_CUT: LogoCut = { on: false, tolerance: 28, holes: false };

export const NO_BAND: BandConfig = { kind: "none", text: "", align: "center", style: "black", color: "#1c2440", size: "medium" };

export const SITE_MARK = "bible4me.org";

/** `postedBy` of a card that carries no name at all (an empty one means "the default name") */
export const NO_NAME = "-";

/** One picture: the words, how they look and who posted it. */
export interface Card {
  id: string;
  /** the words shown */
  text: string;
  /** "John 3:16" */
  reference: string;
  /** "BSB" */
  version: string;
  look: Look;
  /** a multiplier on the automatic text size (0.6 to 1.4) */
  fontScale: number;
  showReference: boolean;
  showVersion: boolean;
  /** the name for the bottom-left corner on this card (overrides the default) */
  postedBy: string;
  /** the words moved away from their usual place: across by this share of the picture's width, down by this share of its height */
  textShift?: { x: number; y: number };
  /** a place of its own for the header's logo and the footer's logo on this picture (instead of the saved default, or the strip) */
  logoAt?: { header?: Place; footer?: Place };
  /** a place of its own for the header's text and the footer's text on this picture */
  textAt?: { header?: Place; footer?: Place };
  /** leave the header off this picture */
  hideHeader?: boolean;
  /** leave the footer's own content (church text, logo, banner) off this picture; the credit, name and site mark stay */
  hideFooter?: boolean;
}

export interface Credit {
  /** the line shown small above the footer, and put in the caption */
  text: string;
}

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
