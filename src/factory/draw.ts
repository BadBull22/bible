// Content Factory: draws one card (a picture) on a canvas. The same function makes the still pictures and every frame of a
// video, so what is previewed is what is saved. Motion (slow zoom, words fading in) is a few numbers in `DrawOptions`.

import { bandHeight, barLayout, type BarLayout, footerEdge, headerTop, layoutText, Measure } from "./layout";
import { BandConfig, Card, clamp, Credit, FooterSettings, fontById, ImageBg, NO_NAME, Place, SITE_MARK } from "./types";

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type PictureSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas;

/** The pictures behind the words, by key (decoded once, used for every frame). */
export type PictureBank = Map<string, PictureSource>;

/** a rectangle on the picture, in its pixels */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where things ended up on the picture (for the handles that move and resize them): the words, and the header's and the footer's logo (`free`: placed on the picture, not in a strip). */
export interface DrawReport {
  text: Box | null;
  /** the shift the words were drawn with (a share of the picture's width and height) */
  textShift: { x: number; y: number };
  headerLogo: (Box & { free: boolean }) | null;
  footerLogo: (Box & { free: boolean }) | null;
  /** the header's and the footer's own text (the footer's church text, not the name) */
  headerText: (Box & { free: boolean }) | null;
  footerText: (Box & { free: boolean }) | null;
}

export interface DrawOptions {
  footer: FooterSettings;
  /** told where the words and the logos are, each time the picture is drawn (the studio's preview asks for it) */
  report?: (r: DrawReport) => void;
  /** a credit the licence needs, shown in the footer bar */
  credit?: Credit | null;
  /** a second credit line (the music), on a line of its own in the footer bar */
  extraCredit?: string | null;
  /** keep room for the music's credit line even while none is shown (a video: the words must not change size when it comes and goes) */
  reserveCredit?: boolean;
  bank: PictureBank;
  /** the background grows slowly: 1 = still, 1.08 = 8 percent larger */
  zoom?: number;
  /** the background moves sideways by this many pixels */
  panX?: number;
  /** 0..1: how much of the words show (they fade in) */
  textAlpha?: number;
  /** the words start this many pixels low and rise to place as they fade in */
  textRise?: number;
  /** 0..1 for the whole card (cross-fades) */
  alpha?: number;
  /** 0..1 for the footer */
  footerAlpha?: number;
  /** a ready colour for the footer text (otherwise worked out from the picture) */
  footerInk?: "light" | "dark";
}

const widthOf = (s: PictureSource) => ("naturalWidth" in s ? s.naturalWidth : s.width);
const heightOf = (s: PictureSource) => ("naturalHeight" in s ? s.naturalHeight : s.height);

function fontString(card: Card, size: number, role: "body" | "ref"): string {
  const f = fontById(card.look.fontId);
  const weight = role === "ref" ? 600 : card.look.bold ? 700 : 400;
  return `${weight} ${Math.round(size)}px ${f.family}`;
}

function drawBackground(ctx: Ctx2D, card: Card, w: number, h: number, o: DrawOptions) {
  const bg = card.look.background;
  const zoom = o.zoom ?? 1;
  if (bg.kind === "gradient") {
    const a = (bg.angle * Math.PI) / 180;
    const len = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
    const cx = w / 2;
    const cy = h / 2;
    const dx = (Math.sin(a) * len) / 2;
    const dy = (Math.cos(a) * len) / 2;
    const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    g.addColorStop(0, bg.from);
    g.addColorStop(1, bg.to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    if (bg.glow) {
      const r = bg.glow.r * Math.max(w, h) * zoom;
      const gx = w * bg.glow.x + (o.panX ?? 0) * 0.5;
      const gy = h * bg.glow.y;
      const rg = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
      rg.addColorStop(0, bg.glow.color);
      rg.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
    }
    return;
  }
  drawImageBackground(ctx, bg, w, h, o);
}

function drawImageBackground(ctx: Ctx2D, bg: ImageBg, w: number, h: number, o: DrawOptions) {
  const img = o.bank.get(bg.key);
  if (!img) {
    ctx.fillStyle = "#222";
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const iw = widthOf(img);
  const ih = heightOf(img);
  // softened: a little larger, so the blur does not show soft edges at the border
  const soft = clamp(bg.blur ?? 0, 0, 1);
  const blurPx = soft * Math.min(w, h) * 0.02;
  const scale = Math.max(w / iw, h / ih) * (o.zoom ?? 1) * (1 + (blurPx * 4) / Math.min(w, h));
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (w - dw) * bg.focusX + (o.panX ?? 0);
  const dy = (h - dh) * bg.focusY;
  if (blurPx > 0.4 && "filter" in ctx) {
    ctx.save();
    ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  } else ctx.drawImage(img, dx, dy, dw, dh);
  // darken so the words stay readable: even, a little more toward the bottom
  ctx.fillStyle = `rgba(0,0,0,${clamp(bg.darken, 0, 0.85)})`;
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, h * 0.55, 0, h);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, `rgba(0,0,0,${clamp(bg.darken * 0.55, 0, 0.5)})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);
}

/** "#rrggbb" as its three numbers, or null */
function rgbOf(hexColour: string | undefined): [number, number, number] | null {
  const m = (hexColour ?? "").match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function roundRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** the small text under the words: "John 3:16 · BSB" */
export function referenceLine(card: Card): string {
  if (!card.showReference || !card.reference) return "";
  return card.showVersion && card.version ? `${card.reference} · ${card.version}` : card.reference;
}

export function footerMarkText(f: FooterSettings): string {
  if (f.mark.kind === "none") return "";
  if (f.mark.kind === "custom") return f.mark.text.trim();
  return SITE_MARK;
}

export function footerNameText(card: Card, f: FooterSettings): string {
  const own = card.postedBy.trim();
  if (own === NO_NAME) return "";
  const name = (own || f.name).trim();
  return name ? `${f.namePrefix}${name}` : "";
}

/** Light or dark text for a stretch of the picture, from how bright it is. */
function inkOfRegion(ctx: Ctx2D, w: number, h: number, left: number, top: number, width: number, height: number): "light" | "dark" {
  const x = Math.max(0, Math.round(left));
  const y = Math.max(0, Math.round(top));
  const rw = Math.max(1, Math.min(w - x, Math.round(width)));
  const rh = Math.max(1, Math.min(h - y, Math.round(height)));
  try {
    const d = ctx.getImageData(x, y, rw, rh).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 7) {
      sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      n++;
    }
    return n && sum / n > 0.62 ? "dark" : "light";
  } catch {
    return "light";
  }
}

export type Which = "header" | "footer";

/** The place the header's or the footer's logo has been given on this card: its own (dragged on this picture), or the saved default. None: it stays in the strip. */
export function freePlace(card: Card, f: FooterSettings, which: Which): Place | undefined {
  const cfg = which === "header" ? f.header : f.band;
  if (!cfg || cfg.on === false || (which === "header" ? card.hideHeader : card.hideFooter)) return undefined;
  if (cfg.kind !== "logo" && cfg.kind !== "logotext") return undefined;
  return card.logoAt?.[which] ?? cfg.logoAt;
}

/** The same for the header's or the footer's text. */
export function freeTextPlace(card: Card, f: FooterSettings, which: Which): Place | undefined {
  const cfg = which === "header" ? f.header : f.band;
  if (!cfg || cfg.on === false || (which === "header" ? card.hideHeader : card.hideFooter)) return undefined;
  if ((cfg.kind !== "text" && cfg.kind !== "logotext") || !cfg.text.trim()) return undefined;
  return card.textAt?.[which] ?? cfg.textAt;
}

/** A band without the logo and the text that have a place of their own on the picture (what is left stays in the strip; nothing left, no strip). */
function inStrip(cfg: BandConfig, freeLogo: Place | undefined, freeText?: Place): BandConfig {
  if (!freeLogo && !freeText) return cfg;
  const logo = (cfg.kind === "logo" || cfg.kind === "logotext") && !freeLogo;
  const text = (cfg.kind === "text" || cfg.kind === "logotext") && !freeText;
  return { ...cfg, kind: logo && text ? "logotext" : logo ? "logo" : text ? "text" : "none" };
}

/** The footer bar with the church's text that is in it (to know where that part is). */
export type FooterBar = BarLayout & { church: string };

/** The footer bar of this card: where it goes and what is in it (null when there is nothing to show). The church's text and logo are left out when
 * the header and footer are turned off for this picture. */
export function footerBar(ctx: Ctx2D, card: Card, w: number, h: number, o: DrawOptions): FooterBar | null {
  const f = o.footer;
  const cfg = f.band;
  const bands = !card.hideFooter && cfg && cfg.on !== false ? inStrip(cfg, freePlace(card, f, "footer"), freeTextPlace(card, f, "footer")) : null;
  const logoImg = bands && (bands.kind === "logo" || bands.kind === "logotext") ? o.bank.get("band:footer") : undefined;
  const church = bands && (bands.kind === "text" || bands.kind === "logotext") ? bands.text.trim() : "";
  const left = [church, footerNameText(card, f)].filter(Boolean).join("  \u00b7  ");
  const measure: Measure = (t, size) => {
    ctx.font = `500 ${size}px "Segoe UI", Inter, Arial, sans-serif`;
    return ctx.measureText(t).width;
  };
  const layout = barLayout({
    w,
    h,
    place: f.place,
    left,
    credit: o.credit?.text?.trim() ?? "",
    extra: o.extraCredit?.trim() ?? "",
    mark: footerMarkText(f),
    logo: logoImg && bands ? { aspect: widthOf(logoImg) / Math.max(1, heightOf(logoImg)), size: bands.size } : null,
    keepExtraRow: !!o.reserveCredit,
    align: bands?.align ?? "left",
    size: bands?.size ?? "medium",
    measure,
  });
  return layout ? { ...layout, church } : null;
}

/** the footer bar's background: black unless the reader chose another (the choices of the footer band, the same as the header's) */
export function barStyleOf(f: FooterSettings): { style: "black" | "shade" | "solid" | "clear"; color: string } {
  const b = f.band;
  return { style: b?.style ?? "black", color: b?.color ?? "#1c2440" };
}

/** The footer bar: a strip across the bottom (black, a soft dark strip, a colour of the reader's, or none: then the words go straight on the picture)
 * with the name and the church's text at the left, the credit and the site mark at the right, and a logo. */
function drawBar(ctx: Ctx2D, w: number, o: DrawOptions, bar: BarLayout, ink: "light" | "dark") {
  const st = barStyleOf(o.footer);
  let light = true;
  ctx.save();
  ctx.globalAlpha *= clamp(o.footerAlpha ?? 1, 0, 1);
  if (st.style === "black") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, bar.top, w, bar.height + 1);
  } else if (st.style === "shade") {
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(0, bar.top, w, bar.height + 1);
  } else if (st.style === "solid") {
    ctx.fillStyle = st.color;
    ctx.fillRect(0, bar.top, w, bar.height + 1);
    light = contrastOn(st.color) === "#ffffff";
  } else {
    light = ink === "light";
    ctx.shadowColor = light ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.4)";
    ctx.shadowBlur = bar.fontSize * 0.35;
    ctx.shadowOffsetY = 1;
  }
  const custom = rgbOf(o.footer.band?.ink);
  const color = custom ? custom.join(",") : light ? "255,255,255" : "29,26,22";
  if (bar.logo) {
    const img = o.bank.get("band:footer");
    if (img) ctx.drawImage(img, bar.logo.x, bar.logo.y, bar.logo.w, bar.logo.h);
  }
  ctx.textBaseline = "alphabetic";
  const alpha = { left: 0.95, credit: 0.78, mark: 0.7, extra: 0.78 };
  for (const row of bar.rows) {
    for (const it of row.items) {
      ctx.font = `500 ${bar.fontSize}px "Segoe UI", Inter, Arial, sans-serif`;
      ctx.textAlign = it.align === "center" ? "center" : it.align;
      ctx.fillStyle = `rgba(${color},${alpha[it.role]})`;
      ctx.fillText(it.text, it.x, row.baseline);
    }
  }
  ctx.restore();
}

/** The heights of the header band and of a footer banner picture for this card: 0 when there is none, it has nothing to show, or the bands are left off this picture.
 * (The footer's text and logo are not a band of their own: they go in the footer bar.) */
export function bandMetrics(card: Card, f: FooterSettings, bank: PictureBank, w: number, h: number): { header: number; footer: number } {
  const one = (cfg: BandConfig | undefined, key: string, onlyPicture: boolean) => {
    if (!cfg || cfg.kind === "none" || cfg.on === false) return 0;
    if (onlyPicture && cfg.kind !== "picture") return 0;
    const img = bank.get(key);
    const hasText = cfg.text.trim().length > 0;
    if (cfg.kind === "text" && !hasText) return 0;
    if ((cfg.kind === "logo" || cfg.kind === "picture") && !img) return 0;
    if (cfg.kind === "logotext" && !img && !hasText) return 0;
    return bandHeight(w, h, cfg, img ? widthOf(img) / Math.max(1, heightOf(img)) : 0);
  };
  const header = f.header ? inStrip(f.header, freePlace(card, f, "header"), freeTextPlace(card, f, "header")) : undefined;
  return { header: card.hideHeader ? 0 : one(header, "band:header", false), footer: card.hideFooter ? 0 : one(f.band, "band:footer", true) };
}

/** One band: text, a logo, a logo with text beside it, or a banner picture across the width. */
function drawBand(ctx: Ctx2D, cfg: BandConfig, img: PictureSource | undefined, top: number, bh: number, w: number, h: number): { logo: Box | null; text: Box | null } {
  ctx.save();
  if (cfg.kind === "picture" && img) {
    const iw = Math.max(1, widthOf(img));
    const ih = Math.max(1, heightOf(img));
    const k = Math.max(w / iw, bh / ih);
    ctx.beginPath();
    ctx.rect(0, top, w, bh);
    ctx.clip();
    ctx.drawImage(img, (w - iw * k) / 2, top + (bh - ih * k) / 2, iw * k, ih * k);
    const words = cfg.text.trim();
    if (words) {
      // text on the banner: white, with a soft dark veil and a shadow so it reads on any picture
      ctx.fillStyle = "rgba(0,0,0,0.38)";
      ctx.fillRect(0, top, w, bh);
      const family = '"Segoe UI", Inter, Arial, sans-serif';
      let fs = Math.round(bh * 0.4);
      ctx.font = `600 ${fs}px ${family}`;
      const pad = Math.round(w * 0.05);
      while (fs > 10 && ctx.measureText(words).width > w - 2 * pad) {
        fs = Math.round(fs * 0.93);
        ctx.font = `600 ${fs}px ${family}`;
      }
      ctx.fillStyle = rgbOf(cfg.ink) ? (cfg.ink as string) : "#ffffff";
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = fs * 0.3;
      ctx.textBaseline = "middle";
      ctx.textAlign = cfg.align === "left" ? "left" : cfg.align === "right" ? "right" : "center";
      ctx.fillText(words, cfg.align === "left" ? pad : cfg.align === "right" ? w - pad : w / 2, Math.round(top + bh / 2));
    }
    ctx.restore();
    return { logo: null, text: null };
  }
  let ink: "light" | "dark";
  if (cfg.style === "black") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, top, w, bh);
    ink = "light";
  } else if (cfg.style === "solid") {
    ctx.fillStyle = cfg.color;
    ctx.fillRect(0, top, w, bh);
    ink = contrastOn(cfg.color) === "#ffffff" ? "light" : "dark";
  } else if (cfg.style === "shade") {
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fillRect(0, top, w, bh);
    ink = "light";
  } else ink = inkOfRegion(ctx, w, h, 0, top, w, bh);
  const family = '"Segoe UI", Inter, Arial, sans-serif';
  const hasText = cfg.text.trim().length > 0 && (cfg.kind === "text" || cfg.kind === "logotext");
  const pad = Math.round(w * 0.05);
  const gap = Math.round(bh * 0.25);
  let logoW = 0;
  let logoH = 0;
  if ((cfg.kind === "logo" || cfg.kind === "logotext") && img) {
    logoH = Math.round(bh * (cfg.kind === "logo" ? 0.78 : 0.72));
    logoW = Math.round((widthOf(img) * logoH) / Math.max(1, heightOf(img)));
    const maxW = Math.round(w * (hasText ? 0.3 : 0.5));
    if (logoW > maxW) {
      logoH = Math.round((logoH * maxW) / logoW);
      logoW = maxW;
    }
  }
  let fs = Math.round(bh * (cfg.kind === "text" ? 0.42 : 0.36));
  let tw = 0;
  if (hasText) {
    const avail = w - 2 * pad - (logoW ? logoW + gap : 0);
    ctx.font = `600 ${fs}px ${family}`;
    while (fs > 10 && ctx.measureText(cfg.text).width > avail) {
      fs = Math.round(fs * 0.93);
      ctx.font = `600 ${fs}px ${family}`;
    }
    tw = ctx.measureText(cfg.text).width;
  }
  const total = logoW + (logoW && tw ? gap : 0) + tw;
  let x = cfg.align === "left" ? pad : cfg.align === "right" ? w - pad - total : (w - total) / 2;
  let logoBox: Box | null = null;
  if (logoW && img) {
    logoBox = { x: Math.round(x), y: Math.round(top + (bh - logoH) / 2), w: logoW, h: logoH };
    ctx.drawImage(img, logoBox.x, logoBox.y, logoW, logoH);
    x += logoW + gap;
  }
  let textBox: Box | null = null;
  if (hasText) {
    ctx.fillStyle = rgbOf(cfg.ink) ? (cfg.ink as string) : ink === "light" ? "#ffffff" : "#1d1a16";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    if (cfg.style === "clear") {
      ctx.shadowColor = ink === "light" ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.4)";
      ctx.shadowBlur = fs * 0.25;
    }
    ctx.fillText(cfg.text, Math.round(x), Math.round(top + bh / 2));
    textBox = { x: Math.round(x), y: Math.round(top + bh / 2 - fs * 0.62), w: tw, h: Math.round(fs * 1.24) };
  }
  ctx.restore();
  return { logo: logoBox, text: textBox };
}

/** Text with a place of its own: drawn on the picture, over everything, in white or dark by what is behind it, with a faint shadow. The width sets the size of the letters. */
function drawFreeText(ctx: Ctx2D, text: string, place: Place, w: number, h: number, alpha: number, colour?: string): Box {
  const family = '"Segoe UI", Inter, Arial, sans-serif';
  ctx.save();
  ctx.font = `600 100px ${family}`;
  const at100 = Math.max(1, ctx.measureText(text).width);
  const fs = clamp((place.w * w * 100) / at100, 8, h / 3);
  ctx.font = `600 ${fs}px ${family}`;
  const tw = ctx.measureText(text).width;
  const box = { x: place.x * w - tw / 2, y: place.y * h - fs * 0.62, w: tw, h: fs * 1.24 };
  const ink = inkOfRegion(ctx, w, h, box.x, box.y, box.w, box.h);
  ctx.globalAlpha *= clamp(alpha, 0, 1);
  ctx.fillStyle = rgbOf(colour) ? (colour as string) : ink === "light" ? "#ffffff" : "#1d1a16";
  ctx.shadowColor = ink === "light" ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.45)";
  ctx.shadowBlur = fs * 0.25;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, place.x * w, place.y * h);
  ctx.restore();
  return box;
}

/** A logo with a place of its own: drawn on the picture, over everything, with a faint shadow so it stands off any background. */
function drawFreeLogo(ctx: Ctx2D, img: PictureSource, place: Place, w: number, h: number, alpha: number): Box {
  const lw = Math.max(8, place.w * w);
  const lh = (lw * heightOf(img)) / Math.max(1, widthOf(img));
  const box = { x: place.x * w - lw / 2, y: place.y * h - lh / 2, w: lw, h: lh };
  ctx.save();
  ctx.globalAlpha *= clamp(alpha, 0, 1);
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = Math.max(3, lw * 0.04);
  ctx.drawImage(img, box.x, box.y, box.w, box.h);
  ctx.restore();
  return box;
}

/** Draws the whole card at size w x h. Returns the colour of the text in the footer bar (light or dark), which a video works out once per picture. */
export function drawCard(ctx: Ctx2D, card: Card, w: number, h: number, o: DrawOptions): "light" | "dark" {
  ctx.save();
  ctx.globalAlpha = clamp(o.alpha ?? 1, 0, 1);
  drawBackground(ctx, card, w, h, o);

  const look = card.look;
  const isImage = look.background.kind === "image";
  const ref = referenceLine(card);
  const text = look.capitals ? card.text.toUpperCase() : card.text;
  const measure: Measure = (t, s) => {
    ctx.font = fontString(card, s, "body");
    return ctx.measureText(t).width;
  };
  // the header band and a footer banner, if there are any, and the footer bar: the words keep clear of them
  const bands = bandMetrics(card, o.footer, o.bank, w, h);
  const hTop = headerTop(w, h, o.footer.place);
  const bar = footerBar(ctx, card, w, h, o);
  const stackTop = bar ? bar.top : footerEdge(w, h, o.footer.place);
  const bannerTop = stackTop - bands.footer;
  const freeHeader = freePlace(card, o.footer, "header");
  const freeFooter = freePlace(card, o.footer, "footer");
  const freeHeaderText = freeTextPlace(card, o.footer, "header");
  const freeFooterText = freeTextPlace(card, o.footer, "footer");
  let headerLogo: Box | null = null;
  let headerStripText: Box | null = null;
  if (bands.header && o.footer.header) {
    const drawn = drawBand(ctx, inStrip(o.footer.header, freeHeader, freeHeaderText), o.bank.get("band:header"), hTop, bands.header, w, h);
    headerLogo = drawn.logo;
    headerStripText = drawn.text;
  }
  if (bands.footer && o.footer.band) drawBand(ctx, o.footer.band, o.bank.get("band:footer"), bannerTop, bands.footer, w, h);
  const limit = bannerTop - Math.round(Math.min(w, h) * 0.035);
  const lay = layoutText({ text, reference: ref, layout: look.layout, w, h, place: o.footer.place, hasCredit: false, fontScale: card.fontScale, measure, topMin: bands.header ? hTop + bands.header + Math.min(w, h) * 0.03 : 0, limit });

  ctx.save();
  const ta = clamp(o.textAlpha ?? 1, 0, 1);
  ctx.globalAlpha *= ta;
  if (o.textRise) ctx.translate(0, o.textRise * (1 - ta));
  if (card.textShift) ctx.translate(card.textShift.x * w, card.textShift.y * h);
  if (isImage) {
    ctx.shadowColor = "rgba(0,0,0,0.4)";
    ctx.shadowBlur = lay.fontSize * 0.2;
    ctx.shadowOffsetY = lay.fontSize * 0.04;
  }
  if (lay.panel) {
    const p = lay.panel;
    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = look.cardColor;
    roundRect(ctx, p.x, p.y, p.w, p.h, p.r);
    ctx.fill();
    ctx.restore();
  }
  if (lay.ribbon) {
    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = look.accent;
    ctx.globalAlpha *= 0.92;
    ctx.fillRect(lay.ribbon.x, lay.ribbon.y, lay.ribbon.w, lay.ribbon.h);
    ctx.restore();
  }
  if (lay.quoteMark) {
    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = look.accent;
    ctx.globalAlpha *= 0.85;
    ctx.font = `700 ${lay.quoteMark.size}px ${fontById(look.fontId).family}`;
    ctx.textAlign = lay.align;
    ctx.textBaseline = "alphabetic";
    ctx.fillText("“", lay.quoteMark.x, lay.quoteMark.y);
    ctx.restore();
  }
  ctx.textAlign = lay.align;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = look.ink;
  ctx.font = fontString(card, lay.fontSize, "body");
  for (const l of lay.lines) ctx.fillText(l.text, l.x, l.y);
  if (lay.rule) {
    ctx.save();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = look.accent;
    ctx.lineWidth = Math.max(2, lay.fontSize * 0.04);
    ctx.globalAlpha *= 0.9;
    ctx.beginPath();
    ctx.moveTo(lay.rule.x1, lay.rule.y);
    ctx.lineTo(lay.rule.x2, lay.rule.y);
    ctx.stroke();
    ctx.restore();
  }
  if (lay.ref) {
    ctx.font = fontString(card, lay.refSize, "ref");
    ctx.fillStyle = lay.ribbon ? (look.accent === look.ink ? "#222" : contrastOn(look.accent)) : look.accent;
    try {
      (ctx as CanvasRenderingContext2D).letterSpacing = `${Math.round(lay.refSize * 0.08)}px`;
    } catch {
      /* older engines: no letter spacing */
    }
    ctx.fillText(lay.ref.text, lay.ref.x, lay.ref.y);
    try {
      (ctx as CanvasRenderingContext2D).letterSpacing = "0px";
    } catch {
      /* ignore */
    }
  }
  ctx.restore();

  // the footer bar, last: the name and the church's text, the credit and the site mark, a logo
  let ink: "light" | "dark" = "light";
  if (bar) {
    ink = o.footerInk ?? (barStyleOf(o.footer).style === "clear" ? inkOfRegion(ctx, w, h, 0, bar.top, w, bar.height) : "light");
    drawBar(ctx, w, o, bar, ink);
  }
  // the logos that have a place of their own go over everything
  let hLogo: (Box & { free: boolean }) | null = headerLogo ? { ...headerLogo, free: false } : null;
  let fLogo: (Box & { free: boolean }) | null = bar?.logo ? { ...bar.logo, free: false } : null;
  const hImg = o.bank.get("band:header");
  const fImg = o.bank.get("band:footer");
  if (freeHeader && hImg) hLogo = { ...drawFreeLogo(ctx, hImg, freeHeader, w, h, o.footerAlpha ?? 1), free: true };
  if (freeFooter && fImg) fLogo = { ...drawFreeLogo(ctx, fImg, freeFooter, w, h, o.footerAlpha ?? 1), free: true };
  // the header's and the footer's text: in the strip, or on the picture
  let hText: (Box & { free: boolean }) | null = headerStripText ? { ...headerStripText, free: false } : null;
  let fText: (Box & { free: boolean }) | null = null;
  if (bar && bar.church) {
    const item = bar.rows.flatMap((r) => r.items.map((it) => ({ it, baseline: r.baseline }))).find((x) => x.it.role === "left");
    if (item) {
      ctx.font = `500 ${bar.fontSize}px "Segoe UI", Inter, Arial, sans-serif`;
      const whole = ctx.measureText(item.it.text).width;
      const church = Math.min(whole, ctx.measureText(bar.church).width);
      const x0 = item.it.align === "center" ? item.it.x - whole / 2 : item.it.align === "right" ? item.it.x - whole : item.it.x;
      fText = { x: x0, y: item.baseline - bar.fontSize * 0.8, w: church, h: bar.fontSize * 1.1, free: false };
    }
  }
  const hCfg = o.footer.header;
  const fCfg = o.footer.band;
  if (freeHeaderText && hCfg) hText = { ...drawFreeText(ctx, hCfg.text.trim(), freeHeaderText, w, h, o.footerAlpha ?? 1, hCfg.ink), free: true };
  if (freeFooterText && fCfg) fText = { ...drawFreeText(ctx, fCfg.text.trim(), freeFooterText, w, h, o.footerAlpha ?? 1, fCfg.ink), free: true };
  if (o.report) o.report({ text: textBox(ctx, card, lay, w, h), textShift: card.textShift ?? { x: 0, y: 0 }, headerLogo: hLogo, footerLogo: fLogo, headerText: hText, footerText: fText });
  ctx.restore();
  return ink;
}

/** The rectangle the words (and the reference, and the card or ribbon behind them) take up, where they are drawn. */
function textBox(ctx: Ctx2D, card: Card, lay: ReturnType<typeof layoutText>, w: number, h: number): Box | null {
  if (lay.lines.length === 0) return null;
  let x0 = Infinity;
  let x1 = -Infinity;
  ctx.font = fontString(card, lay.fontSize, "body");
  const span = (text: string, x: number) => {
    const tw = ctx.measureText(text).width;
    const a = lay.align === "center" ? x - tw / 2 : x;
    x0 = Math.min(x0, a);
    x1 = Math.max(x1, a + tw);
  };
  for (const l of lay.lines) span(l.text, l.x);
  let y0 = lay.lines[0].y - lay.fontSize * 0.9;
  let y1 = lay.lines[lay.lines.length - 1].y + lay.fontSize * 0.3;
  if (lay.ref) {
    ctx.font = fontString(card, lay.refSize, "ref");
    span(lay.ref.text, lay.ref.x);
    y1 = Math.max(y1, lay.ref.y + lay.refSize * 0.3);
  }
  if (lay.panel) {
    x0 = Math.min(x0, lay.panel.x);
    x1 = Math.max(x1, lay.panel.x + lay.panel.w);
    y0 = Math.min(y0, lay.panel.y);
    y1 = Math.max(y1, lay.panel.y + lay.panel.h);
  }
  if (lay.ribbon) {
    x0 = Math.min(x0, lay.ribbon.x);
    x1 = Math.max(x1, lay.ribbon.x + lay.ribbon.w);
    y1 = Math.max(y1, lay.ribbon.y + lay.ribbon.h);
  }
  const sx = (card.textShift?.x ?? 0) * w;
  const sy = (card.textShift?.y ?? 0) * h;
  return { x: x0 + sx, y: y0 + sy, w: x1 - x0, h: y1 - y0 };
}

/** black or white, whichever reads on this colour */
export function contrastOn(color: string): string {
  const m = color.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.6 ? "#1d1a16" : "#ffffff";
}

/** Draws a card on a new canvas of its own size and returns it. */
export function renderCard(card: Card, w: number, h: number, o: DrawOptions): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  drawCard(ctx, card, w, h, o);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: "image/png" | "image/jpeg" = "image/png"): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The picture could not be made."))), type, 0.92));
}
