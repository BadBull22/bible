import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, BackgroundInfo, BackgroundThumb, phone } from "./api";

interface Props {
  label: string;
  version: string;
  text: string;
  say: (message: string) => void;
  fail: (e: unknown) => void;
}

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

/** What the verse is drawn on: a colour gradient, or a photo. */
type Ground = { kind: "colour"; look: Look } | { kind: "photo"; image: HTMLImageElement };

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

  const margin = 110;
  const width = SIZE - margin * 2;
  const words = `“${text.trim()}”`.split(/\s+/);
  const serif = 'Georgia, "Noto Serif", serif';
  // the largest size at which the verse fits in the space above the reference
  let size = 88;
  let lines: string[] = [];
  for (; size >= 30; size -= 2) {
    ctx.font = `${size}px ${serif}`;
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
    if (lines.length * size * 1.35 <= SIZE - margin * 2 - 140) break;
  }
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
export function VersePicture({ label, version, text, say, fail }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<"colour" | "nature">("colour");
  const [look, setLook] = useState(0);
  // nature photos: how many are downloaded, the small pictures, the one chosen
  const [status, setStatus] = useState<{ count: number; size_mb: number } | null>(null);
  const [thumbs, setThumbs] = useState<BackgroundThumb[] | null>(null);
  const [photo, setPhoto] = useState<{ image: HTMLImageElement; info: BackgroundInfo } | null>(null);
  const [downloading, setDownloading] = useState<number | null>(null);
  const name = `${label.replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()}.png`;

  useEffect(() => {
    api.backgroundsStatus().then(setStatus).catch(() => setStatus({ count: 0, size_mb: 8 }));
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
      setStatus((s) => ({ count: n, size_mb: s?.size_mb ?? 6 }));
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
            100 nature photos — lakes, mountains, the sea, sunrises, forests, animals — to put a verse on. A one-time download of about {status.size_mb} MB; after that they work
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
        <button className="primary" onClick={() => phone.shareImage(name, png(), `${label} (${version})`).catch(fail)}>
          Share
        </button>
      </div>
    </>
  );
}
