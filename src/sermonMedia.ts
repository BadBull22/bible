// Pictures, video, music, files and web links in a sermon. A file is copied into the app's
// own folder when it is added (sermon_media.rs), so the sermon keeps working if the
// original is moved; a link is kept as it is.

import { api } from "./api";

export type MediaKind = "image" | "video" | "audio" | "link" | "file";

export interface MediaRef {
  kind: MediaKind;
  title: string;
  /** a file kept in the app's sermon folder */
  file?: string;
  /** a web address */
  url?: string;
  /** the file's own name when it was added */
  name?: string;
  /** where a picture came from, to credit it ("Wikimedia Commons, CC0") */
  credit?: string;
}

const EXT: Record<string, MediaKind> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  mp4: "video",
  mov: "video",
  m4v: "video",
  avi: "video",
  wmv: "video",
  mkv: "video",
  webm: "video",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  aac: "audio",
  ogg: "audio",
  flac: "audio",
  wma: "audio",
};

export function kindOfName(name: string): MediaKind {
  return EXT[name.split(".").pop()?.toLowerCase() ?? ""] ?? "file";
}

/** What a web address is: a video (YouTube, Vimeo), music (YouTube Music, Spotify,
 * SoundCloud, Apple Music) or a web page. */
export function kindOfUrl(url: string): MediaKind {
  const u = url.toLowerCase();
  if (/music\.youtube\.com|open\.spotify\.com|soundcloud\.com|music\.apple\.com/.test(u)) return "audio";
  if (/youtube\.com|youtu\.be|vimeo\.com/.test(u)) return "video";
  if (/\.(mp4|mov|webm)(\?|$)/.test(u)) return "video";
  if (/\.(mp3|m4a|wav)(\?|$)/.test(u)) return "audio";
  if (/\.(jpe?g|png|gif|webp)(\?|$)/.test(u)) return "image";
  return "link";
}

/** A web address as typed: "youtube.com/..." gets its https://. */
export function normaliseUrl(url: string): string {
  const u = url.trim();
  if (!u) return u;
  return /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`;
}

/** A YouTube video's id, for its small picture. */
export function youtubeId(url: string): string | null {
  const m = /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/.exec(url);
  return m ? m[1] : null;
}

export const KIND_LABEL: Record<MediaKind, string> = { image: "Picture", video: "Video", audio: "Music", link: "Link", file: "File" };

/** Keeps a copy of each chosen file for the sermon. */
export async function addFiles(files: File[]): Promise<MediaRef[]> {
  const out: MediaRef[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const kept = await api.sermonMediaAdd(bytes, f.name);
    out.push({ kind: kindOfName(f.name), title: f.name.replace(/\.[^.]+$/, ""), file: kept.file, name: f.name });
  }
  return out;
}

/** Keeps a copy of a picture's bytes (a nature photo, a Bible picture). */
export async function addBytes(bytes: ArrayBuffer, name: string, title: string, credit?: string): Promise<MediaRef> {
  const kept = await api.sermonMediaAdd(new Uint8Array(bytes), name);
  return { kind: "image", title, file: kept.file, name, credit };
}

// a picture's address for showing it, made once per file
const urls = new Map<string, Promise<string>>();
export function mediaUrl(file: string): Promise<string> {
  let u = urls.get(file);
  if (!u) {
    u = api.sermonMediaBytes(file).then((b) => URL.createObjectURL(new Blob([b])));
    urls.set(file, u);
    u.catch(() => urls.delete(file));
  }
  return u;
}

export interface PngPicture {
  src: string;
  width: number;
  height: number;
}

// a picture as a PNG data: URL (what the printed and Word documents take), at most 1400 px
const pngs = new Map<string, Promise<PngPicture>>();
export function pngOf(file: string): Promise<PngPicture> {
  let p = pngs.get(file);
  if (!p) {
    p = mediaUrl(file).then(
      (url) =>
        new Promise<PngPicture>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const scale = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
            const c = document.createElement("canvas");
            c.width = Math.max(1, Math.round(img.naturalWidth * scale));
            c.height = Math.max(1, Math.round(img.naturalHeight * scale));
            c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
            resolve({ src: c.toDataURL("image/png"), width: c.width, height: c.height });
          };
          img.onerror = () => reject(new Error("not a picture"));
          img.src = url;
        }),
    );
    pngs.set(file, p);
    p.catch(() => pngs.delete(file));
  }
  return p;
}

/** Opens a link in the browser, or a kept file in the program Windows uses for it. */
export async function openMedia(m: MediaRef): Promise<void> {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  if (m.url) await openUrl(m.url);
  else if (m.file) await api.sermonMediaOpen(m.file);
}
