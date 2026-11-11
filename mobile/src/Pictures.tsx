// The Bible pictures (since 3.0.0): the story pictures (paintings and engravings) and the children's pictures, each an optional one-time download, so
// the app stays small. Without them every Browse page reads as well, with no empty gaps. Same way of downloading as the Advanced search upgrade and
// the Original words: checked, with progress, and removable.

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, phone, type StoryCredit } from "./api";
import { DownloadRows, type DownloadItem } from "./Downloads";

export type PicKind = "stories" | "kids";

const listeners: Record<PicKind, Set<() => void>> = { stories: new Set(), kids: new Set() };
const NAME: Record<PicKind, { title: string; blurb: string; offer: string }> = {
  stories: { title: "Story pictures", blurb: "A painting or engraving for each Bible story (James Tissot, Gustave Doré and others), with its credit.", offer: "Add the story pictures" },
  kids: { title: "Children's pictures", blurb: "A picture for each children's page, in colour and as an outline to colour in.", offer: "Add the children's pictures" },
};

export interface PicturePack {
  installed: boolean | null;
  size: number;
  downloading: number | null;
  error: string | null;
  install: () => Promise<void>;
  remove: () => Promise<void>;
}

export function usePicturePack(kind: PicKind): PicturePack {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [size, setSize] = useState(kind === "stories" ? 7 : 1);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    api
      .picturesStatus(kind)
      .then((s) => {
        setInstalled(s.installed);
        setSize(s.size_mb);
      })
      .catch(() => setInstalled(false));
  useEffect(() => {
    void refresh();
    listeners[kind].add(refresh);
    return () => void listeners[kind].delete(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  return {
    installed,
    size,
    downloading,
    error,
    install: async () => {
      setError(null);
      setDownloading(0);
      const un = await listen<number>(`pictures-progress-${kind}`, (e) => setDownloading(e.payload));
      try {
        await api.picturesInstall(kind);
      } catch (e) {
        setError(String(e));
      } finally {
        un();
        setDownloading(null);
        listeners[kind].forEach((f) => void f());
      }
    },
    remove: async () => {
      await api.picturesRemove(kind);
      listeners[kind].forEach((f) => void f());
    },
  };
}

function Progress({ pct }: { pct: number }) {
  return (
    <>
      <div className="bar" aria-hidden>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className="hint keep">Downloading… {pct}%</p>
    </>
  );
}

/** A small offer on a Browse page whose pictures are not downloaded (nothing when they are). */
export function PictureOffer({ kind }: { kind: PicKind }) {
  const pack = usePicturePack(kind);
  if (pack.installed !== false) return null;
  return (
    <div className="picture-offer">
      {pack.downloading != null ? (
        <Progress pct={pack.downloading} />
      ) : (
        <button className="browse-pill quiet" onClick={() => void pack.install()}>
          {NAME[kind].offer} ({pack.size} MB)
        </button>
      )}
      {pack.error && <p className="hint status">{pack.error}</p>}
    </div>
  );
}

/** The downloads of More > Downloads: the ones in `others` (Advanced search, Original words) and the two picture packs, the ones not yet on the phone as rows
 * and the ones already there in one closed "Installed" row. */
export function PictureRows({ others }: { others: DownloadItem[] }) {
  const stories = usePicturePack("stories");
  const kids = usePicturePack("kids");
  return (
    <DownloadRows
      items={[
        ...others,
        { key: "stories", title: "Story pictures", note: "Paintings for the stories", pack: stories },
        { key: "kids", title: "Children's pictures", note: "Colour and outline", pack: kids },
      ]}
    />
  );
}

/** The line printed under a story picture: what it shows, who made it, the licence, and that it is shown at a smaller file size. */
function caption(c: StoryCredit): string {
  const who = c.artist.replace(/ \(published \d{4}\)/, "");
  return `${c.title}, ${who}. ${c.licence.replace(/^Public domain artwork; scans by /, "Public domain; scan by ")}. Shown at a smaller file size, otherwise unchanged.`;
}

/** The line printed under the picture of an additional children's page: what it is, who made it, and the licence (the picture is shown as it came). */
function kidCaption(c: StoryCredit): string {
  return `${c.title}. ${c.credit}. ${c.licence}.`;
}

/** A drawing (SVG, base64) as a PNG (base64): chat apps and e-mail show a picture file, not a drawing. Null if it cannot be drawn. */
async function drawingToPng(svg: string, width = 1000): Promise<string | null> {
  try {
    const img = new Image();
    img.src = `data:image/svg+xml;base64,${svg}`;
    await img.decode();
    const scale = width / (img.naturalWidth || 800);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.max(1, Math.round((img.naturalHeight || 600) * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1] ?? null;
  } catch {
    return null;
  }
}

/** The picture of a page as a file for the share sheet (a story's painting, a children's page's colour drawing), with the line that credits it; null when the page has none or its pictures are not downloaded. */
export interface SharePicture {
  name: string;
  base64: string;
  mime: "image/jpeg" | "image/png";
  /** the credit line to write with it (the children's drawings are the app's own and need none) */
  credit: string | null;
}
export async function sharePicture(kind: "stories" | "topics" | "children", id: string): Promise<SharePicture | null> {
  try {
    if (kind === "stories") {
      const p = await api.storyPicture(id);
      return p ? { name: `${id}.jpg`, base64: p.image, mime: "image/jpeg", credit: caption(p.credit) } : null;
    }
    if (kind === "children") {
      const svg = await api.kidPicture(id, false);
      const png = svg ? await drawingToPng(svg) : null;
      if (png) return { name: `${id}.png`, base64: png, mime: "image/png", credit: null };
      // an additional children's page brings its own picture in the file the reader fetched
      const photo = await api.kidPhoto(id);
      return photo ? { name: `${id}.jpg`, base64: photo.image, mime: "image/jpeg", credit: kidCaption(photo.credit) } : null;
    }
  } catch {
    /* no picture: the page is shared without one */
  }
  return null;
}

/** A story's painting or engraving with its credit, when the story pictures are downloaded. */
export function StoryFigure({ id, title }: { id: string; title: string }) {
  const pack = usePicturePack("stories");
  const [pic, setPic] = useState<{ image: string; credit: StoryCredit } | null>(null);
  useEffect(() => {
    let live = true;
    setPic(null);
    // also without the download: an additional story can bring its own picture in the file the reader fetched
    void api.storyPicture(id).then((p) => live && setPic(p)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id, pack.installed]);
  if (!pic) return null;
  return (
    <figure className="browse-story-picture">
      <img src={`data:image/jpeg;base64,${pic.image}`} alt={`A painting or engraving of the story: ${title}`} />
      <figcaption>
        {caption(pic.credit)}{" "}
        <button className="link" onClick={() => void phone.openLink(pic.credit.page).catch(() => undefined)}>
          Source
        </button>
      </figcaption>
    </figure>
  );
}

/** A children's page picture, in colour or as an outline to colour in: the app's own drawing when the children's pictures are downloaded, or the picture an
 * additional page brought in the file the reader fetched (with its credit). Without either, the offer to download the children's pictures. */
export function KidFigure({ id, title }: { id: string; title: string }) {
  const pack = usePicturePack("kids");
  const [drawing, setDrawing] = useState<{ colour: string; outline: string | null } | null>(null);
  const [photo, setPhoto] = useState<{ image: string; outline: string | null; credit: StoryCredit } | null>(null);
  const [looked, setLooked] = useState(false);
  const [outline, setOutline] = useState(false);
  useEffect(() => {
    let live = true;
    setDrawing(null);
    setPhoto(null);
    setLooked(false);
    setOutline(false);
    const own = pack.installed
      ? Promise.all([api.kidPicture(id, false), api.kidPicture(id, true)]).then(([colour, line]) => (colour ? { colour, outline: line } : null)).catch(() => null)
      : Promise.resolve(null);
    const extra = api.kidPhoto(id).catch(() => null);
    void Promise.all([own, extra]).then(([d, p]) => {
      if (!live) return;
      setDrawing(d);
      setPhoto(p);
      setLooked(true);
    });
    return () => {
      live = false;
    };
  }, [id, pack.installed]);
  const hasOutline = !!(drawing ? drawing.outline : photo?.outline);
  const toggle = hasOutline && (
    <p className="picture-switch">
      <button className="browse-pill quiet" aria-pressed={outline} onClick={() => setOutline(!outline)}>
        {outline ? "Show it in colour" : "Outline to colour in"}
      </button>
    </p>
  );
  if (drawing) {
    const shown = outline && drawing.outline ? drawing.outline : drawing.colour;
    return (
      <>
        <img className="browse-picture" src={`data:image/svg+xml;base64,${shown}`} alt={`A picture of the story: ${title}`} />
        {toggle}
      </>
    );
  }
  if (photo) {
    const src = outline && photo.outline ? `data:image/png;base64,${photo.outline}` : `data:image/jpeg;base64,${photo.image}`;
    return (
      <>
        <figure className="browse-story-picture">
          <img src={src} alt={`A picture of the story: ${title}`} />
          <figcaption>
            {kidCaption(photo.credit)}{" "}
            <button className="link" onClick={() => void phone.openLink(photo.credit.page).catch(() => undefined)}>
              Source
            </button>
          </figcaption>
        </figure>
        {toggle}
      </>
    );
  }
  return looked ? <PictureOffer kind="kids" /> : null;
}
