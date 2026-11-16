// The picture studio: a verse (or a story's line, or the reader's own words) made into a picture to keep or share. Full-screen portrait or square; a colour look, a
// nature or Christian photo, the story's painting or the reader's own picture behind the words; five fonts, the words' colour, how dark the photo is; one logo
// that is dragged and pinched into place; a small credit line at the foot for a picture that needs one; JPEG or PNG; save to the gallery or share; and a set of
// several pictures at once. It opens from every Share button, from the Daily Scroll and from More > Make a picture.

import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, BackgroundInfo, BackgroundThumb, phone, type BackgroundPack, type Book, type Verse } from "./api";
import { parseReference } from "./refs";

interface Props {
  book: string;
  chapter: number;
  /** the verse (or the first and last of the passage) the picture starts with; up to three verses in a row can be put on one picture */
  first: number;
  last: number;
  version: string;
  /** the words of first..last, shown at once (the rest of the chapter is read in behind them) */
  text: string;
  say: (message: string) => void;
  fail: (e: unknown) => void;
  /** words that are not a Bible verse (a story's lines, an author's note, the reader's own words): no verse buttons, and `label` is the line under them */
  free?: { label: string; text: string };
  /** a painting that belongs to the story or passage, with the line that credits it */
  painting?: { base64: string; credit: string };
  /** start on this photo (the Daily Scroll hands over the one the card showed) */
  start?: { pack: BackgroundPack; id: string } | null;
}

/** The most verses on one picture. */
export const MOST_VERSES = 3;
/** The smallest the words may be drawn (on the 1080 picture): below it a passage is "too long for one picture", so the words are always legible. */
export const MIN_SIZE = 40;

export interface Look {
  name: string;
  /** gradient stops, top-left to bottom-right */
  colors: string[];
  ink: string;
  soft: string;
}

export const LOOKS: Look[] = [
  { name: "Dawn", colors: ["#f6c27a", "#e0767e", "#7a4b8f"], ink: "#ffffff", soft: "rgba(255,255,255,0.85)" },
  { name: "Sea", colors: ["#1f6fa8", "#123f68", "#0b2340"], ink: "#ffffff", soft: "rgba(255,255,255,0.8)" },
  { name: "Olive", colors: ["#8aa36a", "#4f6b3c", "#2c3d23"], ink: "#ffffff", soft: "rgba(255,255,255,0.82)" },
  { name: "Night", colors: ["#2b3459", "#161c33", "#0b0e1a"], ink: "#f3e7c9", soft: "rgba(243,231,201,0.8)" },
  { name: "Paper", colors: ["#fbf6ea", "#f1e6cc", "#e6d6b0"], ink: "#3b2f20", soft: "rgba(59,47,32,0.75)" },
  { name: "Stone", colors: ["#d9d6cf", "#a9a49a", "#6f6a61"], ink: "#1f1d1a", soft: "rgba(31,29,26,0.75)" },
];

/** The five fonts (all open licence, bundled: public/fonts). */
export interface FontChoice {
  key: string;
  label: string;
  family: string;
  weight: number;
}
export const FONTS: FontChoice[] = [
  { key: "classic", label: "Classic", family: 'Lora, Georgia, "Noto Serif", serif', weight: 500 },
  { key: "clean", label: "Clean", family: "Poppins, Roboto, sans-serif", weight: 600 },
  { key: "strong", label: "Strong", family: "Poppins, Roboto, sans-serif", weight: 700 },
  { key: "script", label: "Script", family: '"Dancing Script", cursive', weight: 600 },
  { key: "soft", label: "Soft", family: "Nunito, Roboto, sans-serif", weight: 600 },
];

/** the words' colours: null is "automatic" (white on a photo, the look's own on a colour) */
const INKS: { name: string; value: string | null }[] = [
  { name: "Automatic", value: null },
  { name: "White", value: "#ffffff" },
  { name: "Cream", value: "#f3e7c9" },
  { name: "Gold", value: "#f5c451" },
  { name: "Sky", value: "#9ad1ff" },
  { name: "Dark", value: "#1a1a1a" },
];

const WIDTH = 1080;
type SizeKey = "portrait" | "square";
const HEIGHTS: Record<SizeKey, number> = { portrait: 1920, square: 1080 };
/** On every picture, so a picture passed on shows where to find the app. */
const WEBSITE = "bible4me.org";

/** What the words are drawn on: a colour gradient, or a photo (or painting, or the reader's own picture). */
export type Ground = { kind: "colour"; look: Look } | { kind: "photo"; image: HTMLImageElement };

interface Spec {
  w: number;
  h: number;
  ground: Ground;
  text: string;
  /** the line under the words (a reference, a title); empty for none */
  label: string;
  font: FontChoice;
  ink: string | null;
  align: "center" | "left";
  /** how dark the photo is made so the words read (0 to 0.8) */
  darken: number;
  credit: string | null;
  logo: { image: HTMLImageElement; x: number; y: number; scale: number } | null;
}

interface Layout {
  size: number;
  lines: string[];
  fits: boolean;
}

/** The words as large as fit in `room` (maxSize down to MIN_SIZE). `fits` is false when even the smallest legible size is too small; the lines are then cut to
 *  what fits, ending in "...", so a long passage is never drawn off the picture. */
function layoutWords(ctx: CanvasRenderingContext2D, text: string, width: number, room: number, font: FontChoice, maxSize: number): Layout {
  const words = `“${text.trim()}”`.split(/\s+/);
  let lines: string[] = [];
  let size = maxSize;
  for (; size >= MIN_SIZE; size -= 2) {
    ctx.font = `${font.weight} ${size}px ${font.family}`;
    lines = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width > width && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    if (lines.length * size * 1.32 <= room) return { size, lines, fits: true };
  }
  size = MIN_SIZE;
  const most = Math.max(1, Math.floor(room / (size * 1.32)));
  const cut = lines.slice(0, most);
  cut[cut.length - 1] = cut[cut.length - 1].replace(/[\s,;:.]*$/, "") + "…";
  return { size, lines: cut, fits: false };
}

const roomFor = (h: number, credit: boolean) => h - WIDTH * 0.2 - 150 - (credit ? 50 : 0);

/** Would these words fit on one picture at a legible size? (Judged on the square picture, the tighter one.) */
export function fitsOnePicture(text: string): boolean {
  const ctx = document.createElement("canvas").getContext("2d");
  return ctx ? layoutWords(ctx, text, WIDTH * 0.8, roomFor(HEIGHTS.square, false), FONTS[0], 88).fits : true;
}

/** Draws the picture. */
function drawPicture(canvas: HTMLCanvasElement, s: Spec) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = s.w;
  canvas.height = s.h;
  let ink = "#ffffff";
  if (s.ground.kind === "colour") {
    const g = ctx.createLinearGradient(0, 0, s.w, s.h);
    s.ground.look.colors.forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s.w, s.h);
    ink = s.ground.look.ink;
  } else {
    // the photo fills the picture: a portrait photo fills a portrait picture as it is, a wide one is cropped to its middle
    const im = s.ground.image;
    const scale = Math.max(s.w / im.naturalWidth, s.h / im.naturalHeight);
    const w = im.naturalWidth * scale;
    const h = im.naturalHeight * scale;
    ctx.drawImage(im, (s.w - w) / 2, (s.h - h) / 2, w, h);
    const d = Math.min(0.85, s.darken);
    const shade = ctx.createLinearGradient(0, 0, 0, s.h);
    shade.addColorStop(0, `rgba(0,0,0,${d * 0.75})`);
    shade.addColorStop(0.5, `rgba(0,0,0,${Math.min(0.9, d * 1.05)})`);
    shade.addColorStop(1, `rgba(0,0,0,${Math.min(0.9, d * 1.25)})`);
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, s.w, s.h);
  }
  if (s.ink) ink = s.ink;
  const photo = s.ground.kind === "photo";

  const m = s.w * 0.1;
  const width = s.w - m * 2;
  const room = roomFor(s.h, !!s.credit);
  const { size, lines } = layoutWords(ctx, s.text, width, room, s.font, s.h > s.w ? 96 : 88);
  const lineHeight = size * 1.32;
  const refSize = Math.max(34, Math.round(size * 0.5));
  const block = lines.length * lineHeight + (s.label ? refSize * 1.9 : 0);
  const left = s.align === "left";
  const x = left ? m : s.w / 2;
  ctx.textAlign = left ? "left" : "center";
  ctx.fillStyle = ink;
  ctx.shadowColor = photo ? "rgba(0,0,0,0.5)" : "transparent";
  ctx.shadowBlur = photo ? 18 : 0;
  let y = (s.h - 100 - block) / 2 + size;
  ctx.font = `${s.font.weight} ${size}px ${s.font.family}`;
  for (const l of lines) {
    ctx.fillText(l, x, y);
    y += lineHeight;
  }
  if (s.label) {
    ctx.globalAlpha = 0.88;
    ctx.font = `${Math.max(500, s.font.weight - 100)} ${refSize}px ${s.font.family}`;
    ctx.fillText(s.label, x, y + refSize * 0.7);
    ctx.globalAlpha = 1;
  }
  // the small lines at the foot: the credit of a picture that needs one, and where to find the app
  ctx.shadowBlur = photo ? 10 : 0;
  ctx.textAlign = "center";
  ctx.globalAlpha = 0.85;
  if (s.credit) {
    let cs = 27;
    ctx.font = `500 ${cs}px Roboto, sans-serif`;
    while (cs > 16 && ctx.measureText(s.credit).width > s.w - 80) {
      cs -= 1;
      ctx.font = `500 ${cs}px Roboto, sans-serif`;
    }
    ctx.fillText(s.credit, s.w / 2, s.h - 84);
  }
  ctx.font = "600 28px Roboto, sans-serif";
  ctx.fillText(WEBSITE, s.w / 2, s.h - 40);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  if (s.logo) {
    const lw = s.w * 0.2 * s.logo.scale;
    const lh = lw * (s.logo.image.naturalHeight / Math.max(1, s.logo.image.naturalWidth));
    ctx.drawImage(s.logo.image, s.logo.x * s.w - lw / 2, s.logo.y * s.h - lh / 2, lw, lh);
  }
}

function loadImageFrom(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("The picture couldn't be opened."));
    im.src = src;
  });
}
const loadJpeg = (base64: string) => loadImageFrom(`data:image/jpeg;base64,${base64}`);

/** A picture file the reader chose, as a (smaller, if large) data address. */
function readPicture(file: File, longest: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("That file couldn't be read."));
    r.onload = async () => {
      try {
        const im = await loadImageFrom(String(r.result));
        const scale = Math.min(1, longest / Math.max(im.naturalWidth, im.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(im.naturalWidth * scale));
        c.height = Math.max(1, Math.round(im.naturalHeight * scale));
        c.getContext("2d")?.drawImage(im, 0, 0, c.width, c.height);
        resolve(c.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.9));
      } catch (e) {
        reject(e);
      }
    };
    r.readAsDataURL(file);
  });
}

// ---- what the studio remembers (a convenience: if storage is unavailable it starts fresh each time)
const PREFS_KEY = "studio:prefs";
const LOGO_KEY = "studio:logo";
const LOGO_POS_KEY = "studio:logo-pos";

interface Prefs {
  size: SizeKey;
  font: string;
  ink: string | null;
  align: "center" | "left";
  darken: number;
  format: "jpeg" | "png";
}
const DEFAULT_PREFS: Prefs = { size: "portrait", font: "classic", ink: null, align: "center", darken: 0.4, format: "jpeg" };

const store = {
  get: (k: string): string | null => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* a convenience only */
    }
  },
};

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(store.get(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return {
      size: p.size === "square" ? "square" : "portrait",
      font: FONTS.some((f) => f.key === p.font) ? (p.font as string) : "classic",
      ink: INKS.some((i) => i.value === (p.ink ?? null)) ? (p.ink ?? null) : null,
      align: p.align === "left" ? "left" : "center",
      darken: typeof p.darken === "number" && p.darken >= 0 && p.darken <= 0.8 ? p.darken : DEFAULT_PREFS.darken,
      format: p.format === "png" ? "png" : "jpeg",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

interface LogoPos {
  x: number;
  y: number;
  scale: number;
}
const CORNER: LogoPos = { x: 0.84, y: 0.07, scale: 1 };
function loadLogoPos(): LogoPos {
  try {
    const p = JSON.parse(store.get(LOGO_POS_KEY) ?? "null") as LogoPos | null;
    if (p && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1 && p.scale >= 0.2 && p.scale <= 3) return p;
  } catch {
    /* the corner */
  }
  return CORNER;
}

type Tool = "look" | "words" | "logo" | "file";
type Mode = "colour" | "nature" | "christian" | "painting" | "mine";

/** Makes a picture to share or keep. */
export function VersePicture({ book, chapter, first, last, version, text: firstText, say, fail, free, painting, start }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) =>
    setPrefs((p) => {
      const next = { ...p, [k]: v };
      store.set(PREFS_KEY, JSON.stringify(next));
      return next;
    });
  const [tool, setTool] = useState<Tool>("look");
  const font = FONTS.find((f) => f.key === prefs.font) ?? FONTS[0];
  const w = WIDTH;
  const h = HEIGHTS[prefs.size];

  // up to three verses in a row go on one picture: the passage starts as given, and "+ previous / + next verse" widen it
  const [range, setRange] = useState<[number, number]>([first, last]);
  const [chapterVerses, setChapterVerses] = useState<Verse[] | null>(null);
  useEffect(() => setRange([first, last]), [first, last, book, chapter]);
  useEffect(() => {
    if (free) return;
    let live = true;
    api
      .chapter(version, book, chapter)
      .then((v) => live && setChapterVerses(v))
      .catch(() => live && setChapterVerses([]));
    return () => {
      live = false;
    };
  }, [version, book, chapter, free]);
  const wordsOf = (a: number, b: number) =>
    (chapterVerses ?? [])
      .filter((v) => v.verse >= a && v.verse <= b)
      .map((v) => v.text.trim())
      .join(" ");
  const text = free ? free.text : range[0] === first && range[1] === last ? firstText : wordsOf(range[0], range[1]) || firstText;
  const labelFor = (a: number, b: number) => `${book} ${chapter}:${a}${b > a ? `-${b}` : ""} · ${version}`;
  const label = free ? free.label : labelFor(range[0], range[1]);
  const count = range[1] - range[0] + 1;
  const have = (n: number) => (chapterVerses ?? []).some((v) => v.verse === n);
  // widening is offered while there are fewer than three verses, the neighbour exists, and all the words still fit at a legible size
  const canAdd = useMemo(() => {
    const room = (n: number) => count < MOST_VERSES && have(n);
    const fit = (a: number, b: number) => fitsOnePicture(wordsOf(a, b));
    return {
      prev: room(range[0] - 1) ? (fit(range[0] - 1, range[1]) ? "yes" : "long") : "none",
      next: room(range[1] + 1) ? (fit(range[0], range[1] + 1) ? "yes" : "long") : "none",
    } as { prev: "yes" | "long" | "none"; next: "yes" | "long" | "none" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, chapterVerses]);

  // the ground: a colour look, a photo of a set, the story's painting, or the reader's own picture
  const [mode, setMode] = useState<Mode>(painting ? "painting" : "colour");
  const [look, setLook] = useState(0);
  const pack: BackgroundPack = mode === "christian" ? "christian" : "nature";
  const isSetPhoto = mode === "nature" || mode === "christian";
  const [statuses, setStatuses] = useState<Record<BackgroundPack, { count: number; size_mb: number; latest: number } | null>>({ nature: null, christian: null });
  const [thumbsBy, setThumbsBy] = useState<Record<BackgroundPack, BackgroundThumb[] | null>>({ nature: null, christian: null });
  const status = statuses[pack];
  const thumbs = thumbsBy[pack];
  const [photo, setPhoto] = useState<{ image: HTMLImageElement; info: BackgroundInfo } | null>(null);
  const [paintingImage, setPaintingImage] = useState<HTMLImageElement | null>(null);
  const [mine, setMine] = useState<HTMLImageElement | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const name = `${(free ? free.label || "Words" : labelFor(range[0], range[1])).replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()} ${prefs.size}.${prefs.format === "png" ? "png" : "jpg"}`;

  // the fonts are files the page loads: draw again once they are ready, or the first picture would be in a stand-in font
  useEffect(() => {
    let live = true;
    void Promise.all(FONTS.map((f) => document.fonts.load(`${f.weight} 40px ${f.family}`).catch(() => undefined))).then(() => live && setFontsReady(true));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const load = (p: BackgroundPack, fallback: { count: number; size_mb: number; latest: number }) =>
      api.backgroundsStatus(p).then((s) => setStatuses((x) => ({ ...x, [p]: s }))).catch(() => setStatuses((x) => ({ ...x, [p]: fallback })));
    void load("nature", { count: 0, size_mb: 36, latest: 331 });
    void load("christian", { count: 0, size_mb: 12, latest: 55 });
    const un = [listen<number>("backgrounds-progress", (e) => setDownloading(e.payload)), listen<number>("backgrounds-progress-christian", (e) => setDownloading(e.payload))];
    return () => {
      un.forEach((u) => void u.then((f) => f()));
    };
  }, []);

  useEffect(() => {
    if (painting) void loadJpeg(painting.base64).then(setPaintingImage).catch(() => undefined);
  }, [painting]);

  // the photo shown belongs to one set: changing set starts again with a photo of the new one
  const autoPicked = useRef(false);
  const startPending = useRef(start ?? null);
  useEffect(() => {
    setPhoto(null);
    autoPicked.current = false;
  }, [pack]);

  // the Daily Scroll hands over the photo its card showed
  useEffect(() => {
    if (!startPending.current) return;
    const s = startPending.current;
    startPending.current = null;
    setMode(s.pack);
    void api
      .backgroundImage(s.id, s.pack)
      .then(async ([b64, info]) => {
        setPhoto({ image: await loadJpeg(b64), info });
        autoPicked.current = true;
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isSetPhoto) return;
    if (status && status.count > 0 && !thumbs) {
      api
        .backgroundsThumbs(pack)
        .then((t) => {
          setThumbsBy((x) => ({ ...x, [pack]: t }));
          if (!photo && !autoPicked.current && t.length > 0) {
            autoPicked.current = true;
            void choose(t[Math.floor(Math.random() * t.length)].id);
          }
        })
        .catch(fail);
    } else if (thumbs && thumbs.length > 0 && !photo && !autoPicked.current) {
      autoPicked.current = true;
      void choose(thumbs[Math.floor(Math.random() * thumbs.length)].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status, thumbs, photo]);

  // the logo
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  const [logoPos, setLogoPos] = useState<LogoPos>(loadLogoPos);
  const [logoOn, setLogoOn] = useState(true);
  useEffect(() => {
    const saved = store.get(LOGO_KEY);
    if (saved) void loadImageFrom(saved).then(setLogo).catch(() => undefined);
  }, []);

  const ground = (): Ground => {
    if (mode === "painting" && paintingImage) return { kind: "photo", image: paintingImage };
    if (mode === "mine" && mine) return { kind: "photo", image: mine };
    if (isSetPhoto && photo) return { kind: "photo", image: photo.image };
    return { kind: "colour", look: LOOKS[look] };
  };
  const credit = mode === "painting" && paintingImage && painting ? painting.credit : null;
  const spec = (over: Partial<Spec> = {}): Spec => ({
    w,
    h,
    ground: ground(),
    text,
    label,
    font,
    ink: prefs.ink,
    align: prefs.align,
    darken: prefs.darken,
    credit,
    logo: logo && logoOn ? { image: logo, x: logoPos.x, y: logoPos.y, scale: logoPos.scale } : null,
    ...over,
  });

  useEffect(() => {
    if (canvas.current) drawPicture(canvas.current, spec());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, look, photo, paintingImage, mine, text, label, prefs, logo, logoOn, logoPos, fontsReady]);

  async function choose(id: string) {
    const asked = pack;
    try {
      const [b64, info] = await api.backgroundImage(id, asked);
      setPhoto({ image: await loadJpeg(b64), info });
    } catch (e) {
      fail(e);
    }
  }
  const random = () => {
    if (!thumbs || thumbs.length === 0) return;
    const others = thumbs.filter((t) => t.id !== photo?.info.id);
    void choose(others[Math.floor(Math.random() * others.length)].id);
  };
  async function download() {
    setDownloading(0);
    try {
      const n = await api.backgroundsInstall(pack);
      setStatuses((x) => ({ ...x, [pack]: { count: n, size_mb: x[pack]?.size_mb ?? 36, latest: x[pack]?.latest ?? 331 } }));
      // a set that was only partly there has more pictures now
      setThumbsBy((x) => ({ ...x, [pack]: null }));
      say(`${n} ${pack === "christian" ? "Christian pictures" : "nature backgrounds"} ready`);
    } catch (e) {
      fail(e);
    } finally {
      setDownloading(null);
    }
  }

  // ---- the logo: dragged with a finger, pinched to its size
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const drag = useRef<{ dx: number; dy: number; startDist: number; startScale: number } | null>(null);
  const toFraction = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  const onLogo = (f: { x: number; y: number }) => {
    if (!logo || !logoOn) return false;
    const lw = 0.2 * logoPos.scale;
    const lh = lw * (logo.naturalHeight / Math.max(1, logo.naturalWidth)) * (w / h);
    return Math.abs(f.x - logoPos.x) <= lw / 2 + 0.04 && Math.abs(f.y - logoPos.y) <= lh / 2 + 0.04;
  };
  const dist = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const down = (e: React.PointerEvent) => {
    if (tool !== "logo" || !logo) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const f = toFraction(e);
    if (pointers.current.size === 2) drag.current = { dx: 0, dy: 0, startDist: dist(), startScale: logoPos.scale };
    else if (onLogo(f)) drag.current = { dx: f.x - logoPos.x, dy: f.y - logoPos.y, startDist: 0, startScale: logoPos.scale };
  };
  const move = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !drag.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && drag.current.startDist > 0) {
      const scale = Math.min(3, Math.max(0.2, (drag.current.startScale * dist()) / drag.current.startDist));
      setLogoPos((p) => ({ ...p, scale }));
    } else if (pointers.current.size === 1) {
      const f = toFraction(e);
      const d = drag.current;
      setLogoPos((p) => ({ ...p, x: Math.min(1, Math.max(0, f.x - d.dx)), y: Math.min(1, Math.max(0, f.y - d.dy)) }));
    }
  };
  const up = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) drag.current = null;
    else if (pointers.current.size === 1) {
      // one finger left after a pinch: carry on dragging from where it is
      const f = toFraction(e);
      drag.current = { dx: 0, dy: 0, startDist: 0, startScale: logoPos.scale };
      void f;
    }
  };

  async function addLogo(file: File | undefined) {
    if (!file) return;
    try {
      const data = await readPicture(file, 400);
      store.set(LOGO_KEY, data);
      setLogo(await loadImageFrom(data));
      setLogoOn(true);
      setLogoPos(loadLogoPos());
    } catch (e) {
      fail(e);
    }
  }
  async function addMine(file: File | undefined) {
    if (!file) return;
    try {
      setMine(await loadImageFrom(await readPicture(file, 2400)));
      setMode("mine");
    } catch (e) {
      fail(e);
    }
  }

  // ---- the file
  const mime = prefs.format === "png" ? "image/png" : "image/jpeg";
  const toBase64 = (c: HTMLCanvasElement) => c.toDataURL(mime, 0.92).split(",")[1] ?? "";
  const png = () => (canvas.current ? toBase64(canvas.current) : "");
  const caption = free ? `${free.label} · https://bible4me.org` : `${labelFor(range[0], range[1])} · https://bible4me.org`;
  const save = () =>
    phone
      .saveToGallery([png()], [name], mime)
      .then((r) => say(`Saved in ${r.where}`))
      .catch(fail);
  const share = () => phone.shareImages([png()], [name], mime, caption).catch(fail);

  // ---- a set: the next verses, each on a picture of its own (a different photo or colour each), saved or shared together
  const [setSize, setSetSize] = useState(5);
  const [making, setMaking] = useState<string | null>(null);
  async function makeSet(action: "save" | "share") {
    if (free || !chapterVerses) return;
    const verses = chapterVerses.filter((v) => v.verse >= range[0]).slice(0, setSize);
    if (verses.length < 2) {
      say("There are not enough verses after this one for a set.");
      return;
    }
    setMaking(`Making ${verses.length} pictures…`);
    try {
      let ids: string[] = [];
      let usePack: BackgroundPack | null = null;
      if (isSetPhoto && status && status.count > 0) {
        usePack = pack;
        ids = (await api.backgroundsIds(pack)).map(([id]) => id);
        for (let i = ids.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [ids[i], ids[j]] = [ids[j], ids[i]];
        }
      }
      const data: string[] = [];
      const names: string[] = [];
      const c = document.createElement("canvas");
      for (let i = 0; i < verses.length; i++) {
        const v = verses[i];
        let g: Ground;
        if (usePack && ids.length > 0) {
          const [b64] = await api.backgroundImage(ids[i % ids.length], usePack);
          g = { kind: "photo", image: await loadJpeg(b64) };
        } else if ((mode === "painting" && paintingImage) || (mode === "mine" && mine)) {
          g = ground();
        } else {
          g = { kind: "colour", look: LOOKS[(look + i) % LOOKS.length] };
        }
        drawPicture(c, spec({ ground: g, text: v.text.trim(), label: labelFor(v.verse, v.verse) }));
        data.push(toBase64(c));
        names.push(`${book} ${chapter}-${v.verse} ${prefs.size}.${prefs.format === "png" ? "png" : "jpg"}`);
      }
      if (action === "save") {
        const r = await phone.saveToGallery(data, names, mime);
        say(`${r.saved} pictures saved in ${r.where}`);
      } else {
        await phone.shareImages(data, names, mime, `${book} ${chapter}:${verses[0].verse}-${verses[verses.length - 1].verse} · https://bible4me.org`);
      }
    } catch (e) {
      fail(e);
    } finally {
      setMaking(null);
    }
  }

  const photoSection = (
    <>
      {status && status.count === 0 && (
        <div className="card">
          <p className="hint">
            {mode === "christian" ? `${status.latest} Christian pictures — crosses, prayer, worship, stained glass, the Bible, communion, Christmas — to put a verse on.` : `${status.latest} nature photos — lakes, mountains, the sea, skies, forests, flowers, animals — to put a verse on.`} A one-time download of about {status.size_mb} MB; after that
            offline.
          </p>
          {downloading == null ? (
            <button className="primary" onClick={() => void download()}>
              {mode === "christian" ? "Get Christian pictures" : "Get nature backgrounds"}
            </button>
          ) : (
            <p className="hint">Downloading… {downloading}%</p>
          )}
        </div>
      )}
      {status && status.count > 0 && (
        <>
          {status.count < status.latest && (
            <p className="hint">
              You have {status.count} of the {status.latest} {mode === "christian" ? "Christian pictures" : "nature photos"}.{" "}
              {downloading == null ? (
                <button className="link" onClick={() => void download()}>
                  Get all {status.latest} (about {status.size_mb} MB)
                </button>
              ) : (
                <span>Downloading… {downloading}%</span>
              )}
            </p>
          )}
          <div className="actions">
            <button onClick={random}>🔀 Random photo</button>
          </div>
          <div className="photo-grid" role="group" aria-label={mode === "christian" ? "Christian pictures" : "Nature photos"}>
            {(thumbs ?? []).map((t) => (
              <button key={t.id} className={photo?.info.id === t.id ? "on" : ""} onClick={() => void choose(t.id)} aria-label={t.theme}>
                <img src={`data:image/jpeg;base64,${t.thumb}`} alt="" loading="lazy" />
              </button>
            ))}
          </div>
          {photo && mode === "nature" && (
            <p className="attribution">
              Photo: {photo.info.title} — {photo.info.author || "unknown"}, {photo.info.licence} (Wikimedia Commons). Free to use and share.
            </p>
          )}
          {photo && mode === "christian" && (
            <p className="attribution">
              Photo: {photo.info.title} — {photo.info.author || "unknown"} (Unsplash, {photo.info.licence}).
            </p>
          )}
        </>
      )}
    </>
  );

  return (
    <>
      <canvas
        ref={canvas}
        className={"picture-preview studio-preview" + (tool === "logo" && logo ? " dragging" : "")}
        aria-label={`Picture of ${label || "your words"}`}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      />
      {!free && chapterVerses && chapterVerses.length > 0 && (
        <div className="picture-verses" role="group" aria-label="Verses on the picture">
          <button disabled={canAdd.prev !== "yes"} onClick={() => setRange([range[0] - 1, range[1]])}>
            + Previous verse
          </button>
          <button disabled={canAdd.next !== "yes"} onClick={() => setRange([range[0], range[1] + 1])}>
            + Next verse
          </button>
          {(range[0] !== first || range[1] !== last) && <button onClick={() => setRange([first, last])}>Just {first === last ? "this verse" : "the first passage"}</button>}
        </div>
      )}
      {!free && chapterVerses && (canAdd.prev === "long" || canAdd.next === "long") && <p className="hint">Too long for one picture: a longer passage would need words too small to read.</p>}
      {!free && count >= MOST_VERSES && <p className="hint">Up to {MOST_VERSES} verses fit on one picture.</p>}

      <div className="chips segmented studio-tools" role="tablist" aria-label="Picture tools">
        {(["look", "words", "logo", "file"] as Tool[]).map((t) => (
          <button key={t} role="tab" aria-selected={tool === t} className={tool === t ? "on" : ""} onClick={() => setTool(t)}>
            {t === "look" ? "Look" : t === "words" ? "Words" : t === "logo" ? "Logo" : "Size & file"}
          </button>
        ))}
      </div>

      {tool === "look" && (
        <>
          <div className="chips segmented" role="tablist" aria-label="Background">
            <button role="tab" aria-selected={mode === "colour"} className={mode === "colour" ? "on" : ""} onClick={() => setMode("colour")}>
              Colours
            </button>
            <button role="tab" aria-selected={mode === "nature"} className={mode === "nature" ? "on" : ""} onClick={() => setMode("nature")}>
              Nature
            </button>
            <button role="tab" aria-selected={mode === "christian"} className={mode === "christian" ? "on" : ""} onClick={() => setMode("christian")}>
              Christian
            </button>
            {painting && (
              <button role="tab" aria-selected={mode === "painting"} className={mode === "painting" ? "on" : ""} onClick={() => setMode("painting")}>
                Painting
              </button>
            )}
            <button role="tab" aria-selected={mode === "mine"} className={mode === "mine" ? "on" : ""} onClick={() => (mine ? setMode("mine") : document.getElementById("studio-mine")?.click())}>
              My picture
            </button>
          </div>
          <input id="studio-mine" type="file" accept="image/*" hidden onChange={(e) => void addMine(e.target.files?.[0]).then(() => (e.target.value = ""))} />
          {mode === "colour" && (
            <div className="swatches" role="group" aria-label="Colour">
              {LOOKS.map((l, i) => (
                <button key={l.name} className={i === look ? "on" : ""} style={{ background: `linear-gradient(135deg, ${l.colors.join(", ")})` }} aria-label={l.name} onClick={() => setLook(i)} />
              ))}
            </div>
          )}
          {isSetPhoto && photoSection}
          {mode === "painting" && painting && <p className="attribution">{painting.credit}</p>}
          {mode === "mine" && (
            <div className="actions">
              <button onClick={() => document.getElementById("studio-mine")?.click()}>Choose another picture</button>
              <p className="hint">Use pictures you took, or that you have the right to use.</p>
            </div>
          )}
        </>
      )}

      {tool === "words" && (
        <>
          <div className="chips segmented" role="group" aria-label="Font">
            {FONTS.map((f) => (
              <button key={f.key} className={prefs.font === f.key ? "on" : ""} style={{ fontFamily: f.family, fontWeight: f.weight }} onClick={() => setPref("font", f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          <div className="chips segmented" role="group" aria-label="Words colour">
            {INKS.map((i) => (
              <button key={i.name} className={prefs.ink === i.value ? "on" : ""} onClick={() => setPref("ink", i.value)}>
                {i.value && <i className="dot" style={{ background: i.value, border: "1px solid #8886" }} />} {i.name}
              </button>
            ))}
          </div>
          <div className="chips segmented" role="group" aria-label="Alignment">
            <button className={prefs.align === "center" ? "on" : ""} onClick={() => setPref("align", "center")}>
              Centred
            </button>
            <button className={prefs.align === "left" ? "on" : ""} onClick={() => setPref("align", "left")}>
              Left
            </button>
          </div>
          {ground().kind === "photo" && (
            <label className="studio-slider">
              <span>Darken the picture so the words are easy to read: {Math.round(prefs.darken * 100)}%</span>
              <input type="range" min={0} max={80} value={Math.round(prefs.darken * 100)} onChange={(e) => setPref("darken", Number(e.target.value) / 100)} />
            </label>
          )}
        </>
      )}

      {tool === "logo" && (
        <>
          <input id="studio-logo" type="file" accept="image/*" hidden onChange={(e) => void addLogo(e.target.files?.[0]).then(() => (e.target.value = ""))} />
          {!logo ? (
            <div className="actions">
              <button className="primary" onClick={() => document.getElementById("studio-logo")?.click()}>
                Add my logo
              </button>
              <p className="hint">Your church's or your own. Then drag it where you want it on the picture, and pinch to change its size.</p>
            </div>
          ) : (
            <>
              <p className="hint">Drag the logo on the picture with a finger; pinch to make it larger or smaller.</p>
              <label className="studio-slider">
                <span>Logo size</span>
                <input type="range" min={20} max={300} value={Math.round(logoPos.scale * 100)} onChange={(e) => setLogoPos((p) => ({ ...p, scale: Number(e.target.value) / 100 }))} />
              </label>
              <label className="set-check">
                <input type="checkbox" checked={logoOn} onChange={(e) => setLogoOn(e.target.checked)} /> Show the logo on this picture
              </label>
              <div className="actions">
                <button
                  onClick={() => {
                    store.set(LOGO_POS_KEY, JSON.stringify(logoPos));
                    say("The logo will start here every time");
                  }}
                >
                  Use this place every time
                </button>
                <button onClick={() => setLogoPos(CORNER)}>Back to the corner</button>
              </div>
              <div className="actions">
                <button onClick={() => document.getElementById("studio-logo")?.click()}>Change logo</button>
                <button
                  onClick={() => {
                    store.set(LOGO_KEY, null);
                    store.set(LOGO_POS_KEY, null);
                    setLogo(null);
                    setLogoPos(CORNER);
                  }}
                >
                  Remove logo
                </button>
              </div>
            </>
          )}
        </>
      )}

      {tool === "file" && (
        <>
          <div className="chips segmented" role="group" aria-label="Size">
            <button className={prefs.size === "portrait" ? "on" : ""} onClick={() => setPref("size", "portrait")}>
              Portrait, full screen
            </button>
            <button className={prefs.size === "square" ? "on" : ""} onClick={() => setPref("size", "square")}>
              Square
            </button>
          </div>
          <div className="chips segmented" role="group" aria-label="File type">
            <button className={prefs.format === "jpeg" ? "on" : ""} onClick={() => setPref("format", "jpeg")}>
              JPEG (small)
            </button>
            <button className={prefs.format === "png" ? "on" : ""} onClick={() => setPref("format", "png")}>
              PNG (sharp)
            </button>
          </div>
          {!free && chapterVerses && chapterVerses.length > 1 && (
            <div className="card">
              <h4>Make a set</h4>
              <p className="hint">The next verses, each on a picture of its own with a different look, saved or shared together.</p>
              <div className="chips segmented" role="group" aria-label="How many pictures">
                {[3, 5, 7].map((n) => (
                  <button key={n} className={setSize === n ? "on" : ""} onClick={() => setSetSize(n)}>
                    {n} pictures
                  </button>
                ))}
              </div>
              <div className="actions">
                <button disabled={making != null} onClick={() => void makeSet("save")}>
                  Save the set
                </button>
                <button disabled={making != null} onClick={() => void makeSet("share")}>
                  Share the set
                </button>
              </div>
              {making && <p className="hint">{making}</p>}
            </div>
          )}
        </>
      )}

      <div className="actions">
        <button onClick={() => void save()}>Save</button>
        <button className="primary" onClick={() => void share()}>
          Share
        </button>
      </div>
    </>
  );
}

/** More > Make a picture: type a reference (John 3:16) or your own words, and the studio opens on them. */
export function MakePicture({ books, version, say, fail }: { books: Book[]; version: string; say: (m: string) => void; fail: (e: unknown) => void }) {
  const [typed, setTyped] = useState("");
  const [words, setWords] = useState("");
  const [open, setOpen] = useState<null | { kind: "verse"; book: string; chapter: number; verse: number; text: string } | { kind: "free"; text: string }>(null);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setError(null);
    if (words.trim()) {
      setOpen({ kind: "free", text: words.trim() });
      return;
    }
    const r = parseReference(typed, books);
    if (!r || r.verse == null) {
      setError("Type a verse, like John 3:16, or your own words.");
      return;
    }
    try {
      const text = await api.passage(version, r.book, r.chapter, r.verse);
      if (!text.trim()) throw new Error(`${r.book} ${r.chapter}:${r.verse} is not in ${version}.`);
      setOpen({ kind: "verse", book: r.book, chapter: r.chapter, verse: r.verse, text });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  if (open?.kind === "verse") return <VersePicture book={open.book} chapter={open.chapter} first={open.verse} last={open.verse} version={version} text={open.text} say={say} fail={fail} />;
  if (open?.kind === "free") return <VersePicture book="" chapter={0} first={0} last={0} version={version} text={open.text} free={{ label: "", text: open.text }} say={say} fail={fail} />;
  return (
    <>
      <h3>Make a picture</h3>
      <p className="hint">A verse or your own words on a picture to keep or share. Portrait or square, with a photo, your own picture or a colour behind the words, and your logo if you like.</p>
      <label className="studio-field">
        <span>A verse</span>
        <input className="field" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="John 3:16" aria-label="A verse" autoCapitalize="words" />
      </label>
      <label className="studio-field">
        <span>Or your own words</span>
        <textarea className="field" value={words} onChange={(e) => setWords(e.target.value)} placeholder="Type or paste the words for the picture" rows={4} aria-label="Your own words" />
      </label>
      {error && <p className="hint status">{error}</p>}
      <div className="actions">
        <button className="primary" onClick={() => void go()}>
          Make the picture
        </button>
      </div>
    </>
  );
}
