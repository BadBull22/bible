// Content Factory: the parts that show a saved picture or video (a thumbnail that loads when it comes into view, the large view, the sites
// to post on). Used by the shelf in the studio and by the gallery window.

import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../api";
import { SITES } from "./FactoryParts";

export type SavedFile = { path: string; name: string; folder: "Pictures" | "Videos" | "Music"; size: number; modified: number };

export const whenLabel = (secs: number) => (secs ? new Date(secs * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "");
export const stemOf = (name: string) => name.replace(/\.[a-z0-9]+$/i, "");
export const isVideo = (name: string) => /\.mp4$/i.test(name);

/** A saved picture or video, loaded when it comes into view. */
export function FileThumb({ file }: { file: SavedFile }) {
  const [url, setUrl] = useState<string | null>(null);
  const [seen, setSeen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setSeen(true), io.disconnect()), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!seen) return;
    let live = true;
    let made: string | null = null;
    api
      .factoryFileBytes(file.path)
      .then((b) => {
        if (!live) return;
        made = URL.createObjectURL(new Blob([b], { type: isVideo(file.name) ? "video/mp4" : "image/png" }));
        setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [seen, file.path, file.name]);
  return (
    <span className="fx-file-thumb" ref={box}>
      {url ? isVideo(file.name) ? <video src={`${url}#t=0.1`} preload="metadata" muted playsInline /> : <img src={url} alt={file.name} /> : <span className="muted">…</span>}
    </span>
  );
}

/** A saved picture or video shown large (a video with its controls). */
export function FileLarge({ file }: { file: SavedFile }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    setUrl(null);
    api
      .factoryFileBytes(file.path)
      .then((b) => {
        if (!live) return;
        made = URL.createObjectURL(new Blob([b], { type: isVideo(file.name) ? "video/mp4" : "image/png" }));
        setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [file.path, file.name]);
  if (!url) return <p className="muted">Opening…</p>;
  return isVideo(file.name) ? <video src={url} controls /> : <img src={url} alt={file.name} />;
}

/** The sites a picture is posted on: copy it first, then open the site and paste. */
export function SitesRow({ what }: { what: string }) {
  return (
    <div className="fx-sites" role="group" aria-label="Post on">
      <span className="muted">Copy the {what}, then post on:</span>
      <span className="factory-chips">
        {SITES.map((s) => (
          <button key={s.name} type="button" className="fx-idea" onClick={() => void openUrl(s.url)}>
            {s.name}
          </button>
        ))}
      </span>
    </div>
  );
}
