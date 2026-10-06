// Downloaded Bible pictures as displayable URLs. The files live in the app's data folder
// (Rust pictures.rs); their bytes come over IPC and become blob: URLs, cached here so a
// gallery page or a lightbox flip doesn't re-read files it just showed.
import { useEffect, useState } from "react";
import { api, PictureInfo } from "./api";

const MAX = 80;
const cache = new Map<string, Promise<string>>();

export function pictureUrl(id: string): Promise<string> {
  let p = cache.get(id);
  if (p) {
    // refresh its place in the least-recently-used order
    cache.delete(id);
    cache.set(id, p);
    return p;
  }
  p = api.pictureBytes(id).then((buf) => URL.createObjectURL(new Blob([buf])));
  cache.set(id, p);
  p.catch(() => cache.delete(id));
  while (cache.size > MAX) {
    const [oldest, url] = cache.entries().next().value as [string, Promise<string>];
    cache.delete(oldest);
    url.then((u) => URL.revokeObjectURL(u)).catch(() => undefined);
  }
  return p;
}

export function usePictureUrl(id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (id) pictureUrl(id).then((u) => live && setUrl(u)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);
  return url;
}

/** "Genesis 7:1–4", "Acts 2" -- for a picture's first linked passage. */
export function pictureRefLabel(p: PictureInfo): string | null {
  const r = p.refs[0];
  if (!r) return null;
  const [book, ch, v, end] = r;
  return v == null ? `${book} ${ch}` : `${book} ${ch}:${v}${end && end > v ? `–${end}` : ""}`;
}

/** The picture as a PNG data URL plus its size -- what study sheets and Word documents take. */
export async function pictureAsPng(id: string, maxWidth = 1200): Promise<{ src: string; width: number; height: number }> {
  const url = await pictureUrl(id);
  const img = new Image();
  img.src = url;
  await img.decode();
  const scale = Math.min(1, maxWidth / img.naturalWidth);
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
  return { src: canvas.toDataURL("image/png"), width, height };
}
