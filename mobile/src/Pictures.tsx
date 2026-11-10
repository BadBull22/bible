// The Bible pictures (since 3.0.0): the story pictures (paintings and engravings) and the children's pictures, each an optional one-time download, so
// the app stays small. Without them every Browse page reads as well, with no empty gaps. Same way of downloading as the Advanced search upgrade and
// the Original words: checked, with progress, and removable.

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, phone, type StoryCredit } from "./api";

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

/** More > Bible pictures: the two downloads. */
export function PicturesSettings() {
  return (
    <>
      <p className="hint keep">Optional, so the app stays small. Everything reads as well without them.</p>
      {(["stories", "kids"] as const).map((k) => (
        <PackCard key={k} kind={k} />
      ))}
    </>
  );
}

function PackCard({ kind }: { kind: PicKind }) {
  const pack = usePicturePack(kind);
  return (
    <div className="card">
      <strong>{NAME[kind].title}</strong>
      <p className="hint">{NAME[kind].blurb}</p>
      {pack.downloading != null ? (
        <Progress pct={pack.downloading} />
      ) : pack.installed ? (
        <div className="actions">
          <span className="hint status">Downloaded.</span>
          <button onClick={() => void pack.remove()}>Remove it ({pack.size} MB)</button>
        </div>
      ) : (
        <div className="actions">
          <button className="primary" onClick={() => void pack.install()}>
            Get it ({pack.size} MB)
          </button>
        </div>
      )}
      {pack.error && <p className="hint status">{pack.error}</p>}
    </div>
  );
}

/** The line printed under a story picture: what it shows, who made it, the licence, and that it is shown at a smaller file size. */
function caption(c: StoryCredit): string {
  const who = c.artist.replace(/ \(published \d{4}\)/, "");
  return `${c.title}, ${who}. ${c.licence.replace(/^Public domain artwork; scans by /, "Public domain; scan by ")}. Shown at a smaller file size, otherwise unchanged.`;
}

/** A story's painting or engraving with its credit, when the story pictures are downloaded. */
export function StoryFigure({ id, title }: { id: string; title: string }) {
  const pack = usePicturePack("stories");
  const [pic, setPic] = useState<{ image: string; credit: StoryCredit } | null>(null);
  useEffect(() => {
    let live = true;
    setPic(null);
    if (pack.installed) void api.storyPicture(id).then((p) => live && setPic(p)).catch(() => undefined);
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

/** A children's page picture (the colour one), when the children's pictures are downloaded. */
export function KidFigure({ id, title }: { id: string; title: string }) {
  const pack = usePicturePack("kids");
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSvg(null);
    if (pack.installed) void api.kidPicture(id, false).then((p) => live && setSvg(p)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id, pack.installed]);
  if (!svg) return null;
  return <img className="browse-picture" src={`data:image/svg+xml;base64,${svg}`} alt={`A picture of the story: ${title}`} />;
}
