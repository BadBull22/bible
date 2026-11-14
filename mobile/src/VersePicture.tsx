import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, BackgroundInfo, BackgroundThumb, phone, type Verse } from "./api";

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
}

/** The most verses on one picture. */
export const MOST_VERSES = 3;
/** The smallest the words may be drawn (on the 1080 picture): below it a passage is "too long for one picture", so the words are always legible. */
export const MIN_SIZE = 40;

interface Look {
  name: string;
  /** gradient stops, top-left to bottom-right */
  colors: string[];
  ink: string;
  soft: string;
}

const LOOKS: Look[] = [
  { name: "Dawn", colors: ["#f6c27a", "#e0767e", "#7a4b8f"], ink: "#ffffff", soft: "rgba(255,255,255,0.85)" },
  { name: "Sea", colors: ["#1f6fa8", "#123f68", "#0b2340"], ink: "#ffffff", soft: "rgba(255,255,255,0.8)" },
  { name: "Olive", colors: ["#8aa36a", "#4f6b3c", "#2c3d23"], ink: "#ffffff", soft: "rgba(255,255,255,0.82)" },
  { name: "Night", colors: ["#2b3459", "#161c33", "#0b0e1a"], ink: "#f3e7c9", soft: "rgba(243,231,201,0.8)" },
  { name: "Paper", colors: ["#fbf6ea", "#f1e6cc", "#e6d6b0"], ink: "#3b2f20", soft: "rgba(59,47,32,0.75)" },
  { name: "Stone", colors: ["#d9d6cf", "#a9a49a", "#6f6a61"], ink: "#1f1d1a", soft: "rgba(31,29,26,0.75)" },
];

const SIZE = 1080;
/** On every verse picture, so a picture passed on shows where to find the app. */
const WEBSITE = "bible4me.org";

/** What the verse is drawn on: a colour gradient, or a photo. */
type Ground = { kind: "colour"; look: Look } | { kind: "photo"; image: HTMLImageElement };

const MARGIN = 110;
const SERIF = 'Georgia, "Noto Serif", serif';

/** The words as large as fit above the reference (88 down to MIN_SIZE). `fits` is false when even the smallest legible size is too small for them;
 *  the lines are then cut to what fits, ending in "...", so a long passage is never drawn off the picture. */
function layoutWords(ctx: CanvasRenderingContext2D, text: string): { size: number; lines: string[]; fits: boolean } {
  const width = SIZE - MARGIN * 2;
  const words = `“${text.trim()}”`.split(/\s+/);
  const room = SIZE - MARGIN * 2 - 140;
  let lines: string[] = [];
  let size = 88;
  for (; size >= MIN_SIZE; size -= 2) {
    ctx.font = `${size}px ${SERIF}`;
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
    if (lines.length * size * 1.35 <= room) return { size, lines, fits: true };
  }
  size = MIN_SIZE;
  const most = Math.max(1, Math.floor(room / (size * 1.35)));
  const cut = lines.slice(0, most);
  cut[cut.length - 1] = cut[cut.length - 1].replace(/[\s,;:.]*$/, "") + "…";
  return { size, lines: cut, fits: false };
}

/** Would these words (with their reference) fit on one picture at a legible size? */
export function fitsOnePicture(text: string): boolean {
  const ctx = document.createElement("canvas").getContext("2d");
  return ctx ? layoutWords(ctx, text).fits : true;
}

/** Draws the verse on a square picture: the words as large as fit, the reference below. */
function draw(canvas: HTMLCanvasElement, ground: Ground, text: string, label: string, version: string) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  canvas.width = SIZE;
  canvas.height = SIZE;
  let ink = "#ffffff";
  let soft = "rgba(255,255,255,0.88)";
  if (ground.kind === "colour") {
    const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    ground.look.colors.forEach((c, i) => g.addColorStop(i / (ground.look.colors.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ink = ground.look.ink;
    soft = ground.look.soft;
  } else {
    // the photo fills the square (cropped to its middle), under a soft shade so the words read
    const im = ground.image;
    const scale = Math.max(SIZE / im.naturalWidth, SIZE / im.naturalHeight);
    const w = im.naturalWidth * scale;
    const h = im.naturalHeight * scale;
    ctx.drawImage(im, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
    const shade = ctx.createLinearGradient(0, 0, 0, SIZE);
    shade.addColorStop(0, "rgba(0,0,0,0.30)");
    shade.addColorStop(0.5, "rgba(0,0,0,0.45)");
    shade.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, SIZE, SIZE);
  }

  // the largest size at which the words fit in the space above the reference
  const { size, lines } = layoutWords(ctx, text);
  ctx.font = `${size}px ${SERIF}`;
  const lineHeight = size * 1.35;
  const block = lines.length * lineHeight;
  let y = (SIZE - block - 120) / 2 + size;
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.shadowColor = ink === "#ffffff" || ground.kind === "photo" ? "rgba(0,0,0,0.45)" : "transparent";
  ctx.shadowBlur = ground.kind === "photo" ? 18 : 12;
  for (const l of lines) {
    ctx.fillText(l, SIZE / 2, y);
    y += lineHeight;
  }
  ctx.fillStyle = soft;
  ctx.font = `600 ${Math.max(34, Math.round(size * 0.55))}px system-ui, Roboto, sans-serif`;
  ctx.fillText(`${label} · ${version}`, SIZE / 2, y + 60);
  // where the picture came from, small at the foot, on every picture
  ctx.globalAlpha = 0.8;
  ctx.shadowBlur = ground.kind === "photo" ? 10 : 6;
  ctx.font = "600 30px system-ui, Roboto, sans-serif";
  ctx.fillText(WEBSITE, SIZE / 2, SIZE - 46);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

const loadImage = (base64: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("The picture couldn't be opened."));
    im.src = `data:image/jpeg;base64,${base64}`;
  });

/** Makes a picture of a verse to share or keep: on a colour, or on a nature photo. */
export function VersePicture({ book, chapter, first, last, version, text: firstText, say, fail }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // up to three verses in a row go on one picture: the passage starts as given, and "+ previous / + next verse" widen it
  const [range, setRange] = useState<[number, number]>([first, last]);
  const [chapterVerses, setChapterVerses] = useState<Verse[] | null>(null);
  useEffect(() => setRange([first, last]), [first, last, book, chapter]);
  useEffect(() => {
    let live = true;
    api
      .chapter(version, book, chapter)
      .then((v) => live && setChapterVerses(v))
      .catch(() => live && setChapterVerses([]));
    return () => {
      live = false;
    };
  }, [version, book, chapter]);
  const wordsOf = (a: number, b: number) =>
    (chapterVerses ?? [])
      .filter((v) => v.verse >= a && v.verse <= b)
      .map((v) => v.text.trim())
      .join(" ");
  const text = range[0] === first && range[1] === last ? firstText : wordsOf(range[0], range[1]) || firstText;
  const label = `${book} ${chapter}:${range[0]}${range[1] > range[0] ? `-${range[1]}` : ""}`;
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
  const [mode, setMode] = useState<"colour" | "nature">("colour");
  const [look, setLook] = useState(0);
  // nature photos: how many are downloaded, the small pictures, the one chosen
  const [status, setStatus] = useState<{ count: number; size_mb: number; latest: number } | null>(null);
  const [thumbs, setThumbs] = useState<BackgroundThumb[] | null>(null);
  const [photo, setPhoto] = useState<{ image: HTMLImageElement; info: BackgroundInfo } | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const name = `${label.replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()}.png`;

  useEffect(() => {
    api.backgroundsStatus().then(setStatus).catch(() => setStatus({ count: 0, size_mb: 36, latest: 331 }));
    const un = listen<number>("backgrounds-progress", (e) => setDownloading(e.payload));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (mode === "nature" && status && status.count > 0 && !thumbs) {
      api
        .backgroundsThumbs()
        .then((t) => {
          setThumbs(t);
          if (!photo && t.length > 0) void choose(t[Math.floor(Math.random() * t.length)].id);
        })
        .catch(fail);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, status]);

  useEffect(() => {
    if (!canvas.current) return;
    if (mode === "nature" && photo) draw(canvas.current, { kind: "photo", image: photo.image }, text, label, version);
    else draw(canvas.current, { kind: "colour", look: LOOKS[look] }, text, label, version);
  }, [mode, look, photo, text, label, version]);

  async function choose(id: string) {
    try {
      const [b64, info] = await api.backgroundImage(id);
      setPhoto({ image: await loadImage(b64), info });
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
      const n = await api.backgroundsInstall();
      setStatus((s) => ({ count: n, size_mb: s?.size_mb ?? 36, latest: s?.latest ?? 331 }));
      say(`${n} nature backgrounds ready`);
    } catch (e) {
      fail(e);
    } finally {
      setDownloading(null);
    }
  }

  const png = () => canvas.current?.toDataURL("image/png").split(",")[1] ?? "";

  return (
    <>
      <canvas ref={canvas} className="picture-preview" aria-label={`Picture of ${label}`} />
      {chapterVerses && chapterVerses.length > 0 && (
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
      {chapterVerses && (canAdd.prev === "long" || canAdd.next === "long") && <p className="hint">Too long for one picture: a longer passage would need words too small to read.</p>}
      {count >= MOST_VERSES && <p className="hint">Up to {MOST_VERSES} verses fit on one picture.</p>}
      <div className="chips segmented" role="tablist">
        <button role="tab" aria-selected={mode === "colour"} className={mode === "colour" ? "on" : ""} onClick={() => setMode("colour")}>
          Colours
        </button>
        <button role="tab" aria-selected={mode === "nature"} className={mode === "nature" ? "on" : ""} onClick={() => setMode("nature")}>
          Nature
        </button>
      </div>
      {mode === "colour" && (
        <div className="swatches" role="group" aria-label="Background">
          {LOOKS.map((l, i) => (
            <button
              key={l.name}
              className={i === look ? "on" : ""}
              style={{ background: `linear-gradient(135deg, ${l.colors.join(", ")})` }}
              aria-label={l.name}
              onClick={() => setLook(i)}
            />
          ))}
        </div>
      )}
      {mode === "nature" && status && status.count === 0 && (
        <div className="card">
          <p className="hint">
            {status.latest} nature photos — lakes, mountains, the sea, skies, forests, flowers, animals — to put a verse on. A one-time download of about {status.size_mb} MB; after that they work
            offline.
          </p>
          {downloading == null ? (
            <button className="primary" onClick={() => void download()}>
              Get nature backgrounds
            </button>
          ) : (
            <p className="hint">Downloading… {downloading}%</p>
          )}
        </div>
      )}
      {mode === "nature" && status && status.count > 0 && (
        <>
          {status.count < status.latest && (
            <p className="hint">
              You have {status.count} of the {status.latest} nature photos.{" "}
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
          <div className="photo-grid" role="group" aria-label="Nature photos">
            {(thumbs ?? []).map((t) => (
              <button key={t.id} className={photo?.info.id === t.id ? "on" : ""} onClick={() => void choose(t.id)} aria-label={t.theme}>
                <img src={`data:image/jpeg;base64,${t.thumb}`} alt="" loading="lazy" />
              </button>
            ))}
          </div>
          {photo && <p className="attribution">Photo: {photo.info.title} — {photo.info.author || "unknown"}, {photo.info.licence} (Wikimedia Commons). Free to use and share.</p>}
        </>
      )}
      <div className="actions">
        <button
          onClick={() =>
            phone
              .saveImage(name, png())
              .then((r) => say(r.saved ? "Picture saved" : "Not saved"))
              .catch(fail)
          }
        >
          Save
        </button>
        <button className="primary" onClick={() => phone.shareImage(name, png(), `${label} (${version}) · https://bible4me.org`).catch(fail)}>
          Share
        </button>
      </div>
    </>
  );
}
