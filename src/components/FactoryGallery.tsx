// Content Factory: the gallery of finished work, in a window of its own (it can be moved to another screen, left open beside the studio or closed).
// One tile for each project (a week of verses is one tile), newest first, with a small picture of the first one. Click a tile to see the
// pictures and videos large, step through them, and share or copy them or open a site to post on. It updates by itself when the studio saves
// something new.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import { groupFiles, projectCount, type Project } from "../factory/gallery";
import { FileLarge, FileThumb, isVideo, SitesRow, whenLabel, type SavedFile } from "./FactoryFiles";
import { Icon } from "./FactoryIcons";
import "./factory.css";

/** the gallery is the window labelled "gallery" (see factory_gallery_open in the app) */
export const isGalleryWindow = () => {
  try {
    return getCurrentWindow().label === "gallery";
  } catch {
    return false;
  }
};

const SIZE_KEY = "factory:gallery:tile";

export function FactoryGallery() {
  const [files, setFiles] = useState<SavedFile[] | null>(null);
  const [kind, setKind] = useState<"" | "Pictures" | "Videos">("");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [tile, setTile] = useState(() => {
    try {
      return Math.min(320, Math.max(110, Number(localStorage.getItem(SIZE_KEY)) || 170));
    } catch {
      return 170;
    }
  });

  const load = useCallback(() => {
    api
      .factoryFiles()
      .then((l) => setFiles(l.filter((f) => f.folder !== "Music")))
      .catch(() => setFiles((old) => old ?? []));
  }, []);
  useEffect(() => {
    load();
    let stop: (() => void) | undefined;
    void listen("factory:saved", load).then((un) => (stop = un));
    window.addEventListener("focus", load);
    return () => {
      stop?.();
      window.removeEventListener("focus", load);
    };
  }, [load]);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 7000);
    return () => clearTimeout(t);
  }, [note]);

  const projects = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (files ?? []).filter((f) => (kind ? f.folder === kind : true) && (q ? f.name.toLowerCase().includes(q) : true));
    return groupFiles(list);
  }, [files, kind, query]);
  const index = shown ? projects.findIndex((p) => p.title === shown) : -1;
  const project: Project<SavedFile> | null = index >= 0 ? projects[index] : null;
  const file = project ? project.files[Math.min(at, project.files.length - 1)] : null;

  // the project on show went (or no longer matches): close the viewer
  useEffect(() => {
    if (shown && index < 0) setShown(null);
  }, [shown, index]);

  const open = (p: Project<SavedFile>) => {
    setShown(p.title);
    setAt(0);
  };
  /** one file on (within the project; past its end, the next project) */
  const step = useCallback(
    (d: number) => {
      if (!project) return;
      const n = at + d;
      if (n >= 0 && n < project.files.length) setAt(n);
      else {
        const other = projects[(index + (d > 0 ? 1 : -1) + projects.length) % projects.length];
        if (other) {
          setShown(other.title);
          setAt(d > 0 ? 0 : other.files.length - 1);
        }
      }
    },
    [project, at, projects, index],
  );
  useEffect(() => {
    if (!project) return;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (e.key === "Escape") setShown(null);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [project, step]);

  const share = async (paths: string[], title: string) => {
    try {
      await api.factoryShare(paths, title, "");
    } catch (e) {
      setNote(`${String(e instanceof Error ? e.message : e)} You can still copy the files or show them in the folder.`);
    }
  };
  const copy = async (paths: string[]) => {
    try {
      await api.factoryCopyFiles(paths);
      setNote(paths.length === 1 ? "The file is copied: paste it into your message or upload box." : `${paths.length} files are copied: paste them into your message or upload box.`);
    } catch (e) {
      setNote(String(e instanceof Error ? e.message : e));
    }
  };
  const nFiles = (files ?? []).length;

  return (
    <div className="fxg" style={{ ["--fxg-tile" as string]: `${tile}px` }}>
      <header className="fxg-head">
        <h1>Made pictures and videos</h1>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find one by name" aria-label="Find a picture or video by name" className="fxg-search" />
        <label className="fx-inline-field">
          <span>Show</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Pictures or videos">
            <option value="">Pictures and videos</option>
            <option value="Pictures">Pictures only</option>
            <option value="Videos">Videos only</option>
          </select>
        </label>
        <label className="fx-inline-field" title="How big the little pictures are">
          <span>Size</span>
          <input
            type="range"
            min={110}
            max={320}
            step={10}
            value={tile}
            onChange={(e) => {
              const v = Number(e.target.value);
              setTile(v);
              try {
                localStorage.setItem(SIZE_KEY, String(v));
              } catch {
                /* a convenience only */
              }
            }}
            aria-label="Size of the little pictures"
          />
        </label>
        <span className="fx-spacer" />
        <button type="button" className="outline-btn" onClick={load} title="Look for new pictures (this window also does it by itself)">
          Refresh
        </button>
        <button type="button" className="outline-btn" onClick={() => void api.factoryOpenFolder().catch((e) => setNote(String(e)))}>
          Open the folder
        </button>
      </header>

      <main className="fxg-body">
        {files === null && <p className="muted">Looking…</p>}
        {files !== null && projects.length === 0 && (
          <p className="muted fxg-none">{nFiles === 0 ? "Nothing has been saved yet. Pictures and videos you save in the Content Factory appear here." : "Nothing matches."}</p>
        )}
        <ul className="fxg-grid">
          {projects.map((p) => (
            <li key={p.title}>
              <button type="button" className="fx-tile" onClick={() => open(p)} title={p.title}>
                <span className="fx-tile-pic">
                  <FileThumb file={p.cover} />
                  {p.files.length > 1 && <em className="fx-badge count">{p.files.length}</em>}
                  {isVideo(p.cover.name) && (
                    <em className="fx-badge video">
                      <Icon name="play" size={11} /> Video
                    </em>
                  )}
                  {p.videos > 0 && !isVideo(p.cover.name) && (
                    <em className="fx-badge video">
                      <Icon name="video" size={11} /> + video
                    </em>
                  )}
                </span>
                <strong>{p.title}</strong>
                <small>
                  {projectCount(p)} · {whenLabel(p.modified)}
                </small>
              </button>
            </li>
          ))}
        </ul>
      </main>

      {project && file && (
        <div className="fx-modal" role="dialog" aria-modal="true" aria-label={project.title} onMouseDown={(e) => e.target === e.currentTarget && setShown(null)}>
          <div className="fx-dialog">
            <header>
              <h3>{project.title}</h3>
              <span className="muted">
                {Math.min(at, project.files.length - 1) + 1} of {project.files.length}
              </span>
              <span className="fx-spacer" />
              <button type="button" className="fx-btn icon" onClick={() => step(-1)} aria-label="The one before" title="The one before (left arrow)">
                <Icon name="chevronLeft" size={18} />
              </button>
              <button type="button" className="fx-btn icon" onClick={() => step(1)} aria-label="The next one" title="The next one (right arrow)">
                <Icon name="chevronRight" size={18} />
              </button>
              <button type="button" className="fx-btn icon" onClick={() => setShown(null)} aria-label="Close" title="Close (Esc)">
                <Icon name="close" size={18} />
              </button>
            </header>
            <div className="fx-dialog-body">
              <div className="fx-dialog-pic">
                <FileLarge key={file.path} file={file} />
                {project.files.length > 1 && (
                  <div className="fxg-strip" role="group" aria-label="Everything in this project">
                    {project.files.map((f, i) => (
                      <button key={f.path} type="button" className={i === at ? "on" : ""} onClick={() => setAt(i)} aria-label={f.name} aria-pressed={i === at} title={f.name}>
                        <FileThumb file={f} />
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="fx-dialog-actions">
                <p className="muted">
                  {isVideo(file.name) ? "Video" : "Picture"} · {(file.size / 1_000_000).toFixed(1)} MB · saved {whenLabel(file.modified)}
                  <br />
                  {file.name}
                </p>
                <button type="button" className="pill-btn" onClick={() => void share([file.path], project.title)} title="Open the Windows Share window: WhatsApp, Mail, nearby devices">
                  <Icon name="post" size={16} /> Share…
                </button>
                <div className="fx-action-grid">
                  <button type="button" className="outline-btn" onClick={() => void copy([file.path])} title="Copy the file, then paste it into a message or an upload box">
                    <Icon name="copy" size={15} /> Copy file
                  </button>
                  <button type="button" className="outline-btn" onClick={() => void api.factoryReveal(file.path).catch((e) => setNote(String(e)))}>
                    <Icon name="folder" size={15} /> Show in the folder
                  </button>
                  {project.files.length > 1 && (
                    <>
                      <button type="button" className="outline-btn" onClick={() => void share(project.files.map((f) => f.path), project.title)}>
                        Share all {project.files.length}…
                      </button>
                      <button type="button" className="outline-btn" onClick={() => void copy(project.files.map((f) => f.path))}>
                        Copy all {project.files.length}
                      </button>
                    </>
                  )}
                </div>
                <SitesRow what="file" />
              </div>
            </div>
          </div>
        </div>
      )}

      {note && (
        <div className="fx-toasts">
          <p className="fx-toast" role="status">
            <span>{note}</span>
            <button type="button" className="fx-btn icon" onClick={() => setNote(null)} aria-label="Dismiss">
              <Icon name="close" size={14} />
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
