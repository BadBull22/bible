import { useEffect, useMemo, useRef, useState } from "react";
import { api, ThemeFile } from "../api";
import { kindOfName, mediaUrl } from "../sermonMedia";
import { CloseIcon } from "./icons";
import { backdrop } from "../backdrop";

const FOLDERS_KEY = "bc-theme-folders";

const savedFolders = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
};
const keepFolders = (list: string[]) => {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(list));
  } catch {
    /* not remembered */
  }
};

const mb = (n: number) => (n >= 1 << 20 ? `${Math.round(n / (1 << 20))} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const lastPart = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

/** A picture from the folder drawn small, when it scrolls into view; a video is a film strip with its size. */
function Thumb({ f, behind }: { f: ThemeFile; behind: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (f.kind !== "image") return;
    let live = true;
    let made: string | null = null;
    const watch = new IntersectionObserver((seen) => {
      if (!seen[0]?.isIntersecting) return;
      watch.disconnect();
      api
        .themeThumb(f.path)
        .then((b) => {
          made = URL.createObjectURL(new Blob([b]));
          if (live) setUrl(made);
        })
        .catch(() => undefined);
    });
    if (box.current) watch.observe(box.current);
    return () => {
      live = false;
      watch.disconnect();
      if (made) URL.revokeObjectURL(made);
    };
  }, [f.path, f.kind]);
  return (
    <div
      className={"theme-thumb " + f.kind + (f.role === "overlay" ? " overlay" : "")}
      ref={box}
      style={f.role === "overlay" && behind ? { backgroundImage: `linear-gradient(rgba(0,0,0,.45), rgba(0,0,0,.45)), url(${behind})`, backgroundSize: "cover" } : undefined}
    >
      {f.kind === "image" ? url ? <img src={url} alt="" draggable={false} /> : <span className="muted">…</span> : <span className="theme-film">▶ moving</span>}
    </div>
  );
}

/** A look for the slides from a folder of backgrounds and title graphics (a pack made for ProPresenter, say): a picture
 * or a looping video for the background, and a see-through picture (a title graphic, a paint sweep) over it. The folder
 * stays where it is; only what is chosen is copied into the app. */
export function ThemePicker({
  background,
  overlay,
  canOverlay,
  forSlide,
  start,
  onBackground,
  onOverlay,
  onClose,
}: {
  background: string | null;
  overlay: string | null;
  canOverlay: boolean;
  /** the number of the one slide this is for (none: all the slides) */
  forSlide?: number;
  /** which tab to open on */
  start?: "background" | "video" | "overlay";
  onBackground: (file: string | null) => void;
  onOverlay: (file: string | null) => void;
  onClose: () => void;
}) {
  const [folders, setFolders] = useState<string[]>(savedFolders);
  const [folder, setFolder] = useState<string>(() => savedFolders()[0] ?? "");
  const [files, setFiles] = useState<ThemeFile[] | null>(null);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"background" | "video" | "overlay">(start ?? "background");
  const [behind, setBehind] = useState<string | null>(null);
  const [inside, setInside] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // the background now chosen, to show the headings over it
  useEffect(() => {
    let live = true;
    setBehind(null);
    if (background && kindOfName(background) !== "video") mediaUrl(background).then((u) => live && setBehind(u)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [background]);

  useEffect(() => {
    let live = true;
    setFiles(null);
    setInside("");
    if (!folder) return;
    api
      .themeList(folder)
      .then((l) => live && setFiles(l))
      .catch((e) => live && (setFiles([]), setError(String(e))));
    return () => {
      live = false;
    };
  }, [folder]);

  const addFolder = async () => {
    setError(null);
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const got = await open({ directory: true, multiple: false, title: "Choose the folder of backgrounds" });
      if (typeof got !== "string") return;
      const next = [got, ...folders.filter((f) => f !== got)];
      setFolders(next);
      keepFolders(next);
      setFolder(got);
    } catch (e) {
      setError(`The folder couldn't be chosen: ${e}`);
    }
  };
  const forget = (f: string) => {
    const next = folders.filter((x) => x !== f);
    setFolders(next);
    keepFolders(next);
    if (folder === f) setFolder(next[0] ?? "");
  };

  const subfolders = useMemo(() => [...new Set((files ?? []).map((f) => f.folder))].sort(), [files]);
  const counts = useMemo(
    () => ({
      background: (files ?? []).filter((f) => f.role === "background").length,
      video: (files ?? []).filter((f) => f.kind === "video").length,
      overlay: (files ?? []).filter((f) => f.role === "overlay").length,
    }),
    [files],
  );
  // a folder with no backgrounds in it (only headings) opens on the headings
  useEffect(() => {
    if (files && counts.background === 0 && counts.overlay > 0) setShow("overlay");
  }, [files, counts]);
  const shown = useMemo(
    () =>
      (files ?? []).filter(
        (f) =>
          (show === "overlay" ? f.role === "overlay" : show === "video" ? f.kind === "video" : f.role === "background") &&
          (!inside || f.folder === inside) &&
          (!query.trim() || `${f.name} ${f.folder}`.toLowerCase().includes(query.trim().toLowerCase())),
      ),
    [files, show, inside, query],
  );

  const use = async (f: ThemeFile, as: "background" | "overlay") => {
    setError(null);
    setBusy(`Adding ${f.name}…`);
    try {
      const kept = await api.themeUse(f.path);
      if (as === "background") onBackground(kept.file);
      else onOverlay(kept.file);
      // chosen: the window is put away, so the slide can be seen
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  const nameOf = (file: string | null) => (file ? (kindOfName(file) === "video" ? "a moving background" : "a picture") : "none");

  return (
    <div className="mp-backdrop" role="dialog" aria-modal="true" aria-label="Moving backgrounds and themes" {...backdrop(onClose)}>
      <div className="mp theme-picker" onClick={(e) => e.stopPropagation()}>
        <div className="mp-head">
          <strong>{forSlide ? (start === "overlay" ? `A heading over slide ${forSlide}` : `A moving background for slide ${forSlide}`) : "Moving backgrounds and layers"}</strong>
          <button className="text-btn" onClick={onClose} aria-label="Close">
            <CloseIcon size={14} />
          </button>
        </div>
        <div className="theme-now">
          <span>
            <span className="muted">Background:</span> {nameOf(background)}{" "}
            {background && (
              <button className="link-btn" onClick={() => onBackground(null)}>
                Take it off
              </button>
            )}
          </span>
          {canOverlay && (
            <span>
              <span className="muted">Picture over it:</span> {nameOf(overlay)}{" "}
              {overlay && (
                <button className="link-btn" onClick={() => onOverlay(null)}>
                  Take it off
                </button>
              )}
            </span>
          )}
        </div>
        <div className="theme-folders">
          <button className="pill-btn" onClick={() => void addFolder()}>
            {folders.length ? "+ Another folder…" : "Choose a folder of backgrounds…"}
          </button>
          {folders.map((f) => (
            <span key={f} className={"songs-chip" + (f === folder ? " on" : "")}>
              <button className="theme-folder-pick" onClick={() => setFolder(f)} title={f}>
                {lastPart(f)}
              </button>
              <button onClick={() => forget(f)} aria-label={`Forget ${lastPart(f)}`} title="Forget this folder (nothing is deleted)">
                ×
              </button>
            </span>
          ))}
        </div>
        {error && <p className="status-error">{error}</p>}
        {busy && <p className="muted">{busy}</p>}
        {!folder ? (
          <p className="theme-empty">
            Unzip a pack of backgrounds (the free packs churches use with ProPresenter work) into a folder on this computer, then choose that folder here. The pictures and the looping videos in it are listed to choose from. Nothing is copied
            until you choose one.
          </p>
        ) : files === null ? (
          <p className="muted">Looking in the folder…</p>
        ) : files.length === 0 ? (
          <p className="theme-empty">There are no pictures or videos in that folder. Choose the folder the pictures and videos were unzipped into.</p>
        ) : (
          <>
            <div className="theme-kinds" role="tablist" aria-label="What to look at">
              <button role="tab" aria-selected={show === "background"} className={"sf-chip" + (show === "background" ? " on" : "")} onClick={() => setShow("background")} title="Pictures and moving backgrounds that fill the slide">
                Backgrounds ({counts.background})
              </button>
              <button role="tab" aria-selected={show === "video"} className={"sf-chip" + (show === "video" ? " on" : "")} onClick={() => setShow("video")} title="Looping videos for behind the words">
                Moving ({counts.video})
              </button>
              {canOverlay && (
                <button
                  role="tab"
                  aria-selected={show === "overlay"}
                  className={"sf-chip" + (show === "overlay" ? " on" : "")}
                  onClick={() => setShow("overlay")}
                  title="Headings and layers with see-through parts: they lie over a background, under the words"
                >
                  Headings and layers ({counts.overlay})
                </button>
              )}
            </div>
            {show === "overlay" && (
              <p className="muted theme-hint">
                These are see-through: a heading such as “Announcements” or a paint-sweep layer. {forSlide ? "Chosen here, one lies over this slide's background." : "Chosen here, one lies over every slide's background."} They are shown on the
                background you have now.
              </p>
            )}
            <div className="songs-find">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find one by name" aria-label="Find a background by name" />
              {subfolders.length > 1 && (
                <select value={inside} onChange={(e) => setInside(e.target.value)} aria-label="Which folder">
                  <option value="">All the folders</option>
                  {subfolders.map((s) => (
                    <option key={s} value={s}>
                      {s || "(the top)"}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="theme-grid" role="list">
              {shown.map((f) => (
                <div key={f.path} className="theme-tile" role="listitem">
                  <Thumb f={f} behind={behind} />
                  <span className="theme-name" title={f.path}>
                    {f.name}
                  </span>
                  <span className="muted theme-size">{mb(f.size)}</span>
                  <span className="theme-use">
                    {f.role === "overlay" ? (
                      <button className="pill-btn" onClick={() => void use(f, "overlay")} disabled={!!busy || !canOverlay} title="Laid over the background, under the words">
                        {forSlide ? "Use as this slide's heading" : "Put over every slide"}
                      </button>
                    ) : (
                      <button className="pill-btn" onClick={() => void use(f, "background")} disabled={!!busy}>
                        {forSlide ? "Use for this slide" : "Use as the background"}
                      </button>
                    )}
                  </span>
                </div>
              ))}
              {shown.length === 0 && <p className="muted">Nothing matches.</p>}
            </div>
            <p className="muted">
              {shown.length} shown. A moving background plays quietly on a loop behind the words. It plays on the screen, not in a PowerPoint file.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
