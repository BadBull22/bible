import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, PictureCollection, PictureInfo } from "../api";
import { usePictureUrl } from "../pictures";
import { addBytes, addFiles, kindOfUrl, KIND_LABEL, MediaRef, normaliseUrl, youtubeId } from "../sermonMedia";
import { CloseIcon } from "./icons";

interface Props {
  /** what to add, and for what: "anything" in a sermon, "picture" for a slide's background */
  only?: "picture";
  onAdd: (media: MediaRef[]) => void;
  onClose: () => void;
}

type Source = "computer" | "nature" | "bible" | "link";

type Background = { id: string; theme: string; title: string; author: string; licence: string; source: string };

function useBlobUrl(load: () => Promise<ArrayBuffer>, key: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    load()
      .then((b) => {
        made = URL.createObjectURL(new Blob([b]));
        if (live) setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

function NatureThumb({ b, onPick }: { b: Background; onPick: () => void }) {
  const url = useBlobUrl(() => api.sermonBackgroundBytes(b.id, false), b.id);
  return (
    <button className="mp-thumb" onClick={onPick} title={`${b.theme} — ${b.author}`}>
      {url ? <img src={url} alt={b.theme} /> : <span className="picture-thumb-empty" />}
      <span>{b.theme}</span>
    </button>
  );
}

function BibleThumb({ p, onPick }: { p: PictureInfo; onPick: () => void }) {
  const url = usePictureUrl(p.id);
  return (
    <button className="mp-thumb" onClick={onPick} title={p.caption || p.title}>
      {url ? <img src={url} alt={p.title} loading="lazy" /> : <span className="picture-thumb-empty" />}
      <span>{p.title}</span>
    </button>
  );
}

/** Adds pictures, video, music, files or web links to a sermon (or a picture for slides): from
 * this computer, the nature photos, the Bible pictures, or a link to paste. */
export function MediaPicker({ only, onAdd, onClose }: Props) {
  const [source, setSource] = useState<Source>("computer");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nature, setNature] = useState<Background[] | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [collections, setCollections] = useState<PictureCollection[]>([]);
  const [collection, setCollection] = useState("");
  const [gallery, setGallery] = useState<PictureInfo[]>([]);
  const [more, setMore] = useState(0);
  const [url, setUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.sermonBackgrounds().then(setNature).catch(() => setNature([]));
    api
      .picturesCollections()
      .then((c) => {
        const have = c.filter((x) => x.downloaded > 0);
        setCollections(have);
        if (have[0]) setCollection(have[0].key);
      })
      .catch(() => undefined);
    const un = listen<number>("backgrounds-progress", (e) => setProgress(e.payload));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      void un.then((f) => f());
      window.removeEventListener("keydown", onKey);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!collection) return;
    api
      .picturesGallery(collection, 0, 60)
      .then(([list, total]) => {
        setGallery(list.filter((p) => p.downloaded));
        setMore(total);
      })
      .catch(() => setGallery([]));
  }, [collection]);

  async function run(label: string, f: () => Promise<MediaRef[]>) {
    setBusy(label);
    setError(null);
    try {
      const got = await f();
      if (got.length) onAdd(got);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const pickFiles = (files: File[]) => {
    const list = only === "picture" ? files.filter((f) => /\.(jpe?g|png|gif)$/i.test(f.name)) : files;
    if (list.length === 0) {
      setError(only === "picture" ? "Choose a picture (JPEG, PNG or GIF)." : "Nothing was chosen.");
      return;
    }
    void run(`Adding ${list.length === 1 ? list[0].name : `${list.length} files`}…`, () => addFiles(list));
  };

  async function downloadNature() {
    setError(null);
    setProgress(0);
    try {
      await api.sermonBackgroundsDownload();
      setNature(await api.sermonBackgrounds());
    } catch (e) {
      setError(String(e));
    } finally {
      setProgress(null);
    }
  }

  const link = normaliseUrl(url);
  const linkKind = link ? kindOfUrl(link) : "link";
  const yt = youtubeId(link);

  const SOURCES: [Source, string][] = [
    ["computer", "From this computer"],
    ["nature", "Nature photos"],
    ["bible", "Bible pictures"],
    ...(only === "picture" ? [] : ([["link", "A web link (YouTube, music…)"]] as [Source, string][])),
  ];

  return (
    <div className="mp-backdrop" role="dialog" aria-modal="true" aria-label={only === "picture" ? "Choose a picture" : "Add a picture, video, music or a link"} onClick={onClose}>
      <div className="mp" onClick={(e) => e.stopPropagation()}>
        <div className="mp-head">
          <strong>{only === "picture" ? "Choose a picture" : "Add a picture, video, music, a file or a link"}</strong>
          <button className="text-btn" onClick={onClose} aria-label="Close">
            <CloseIcon size={14} />
          </button>
        </div>
        <div className="mode-toggle" role="tablist">
          {SOURCES.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={source === k} className={source === k ? "active" : ""} onClick={() => setSource(k)}>
              {label}
            </button>
          ))}
        </div>
        {error && <p className="status-error">{error}</p>}
        {busy && <p className="muted">{busy}</p>}

        <div className="mp-body">
          {source === "computer" && (
            <div
              className={"mp-drop" + (dragging ? " over" : "")}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                pickFiles([...e.dataTransfer.files]);
              }}
            >
              <p>
                {only === "picture"
                  ? "Drop a picture here, or choose one."
                  : "Drop pictures, videos, music or any other files here, or choose them. A copy is kept with the app, so the sermon still works if the original is moved."}
              </p>
              <button className="pill-btn" onClick={() => input.current?.click()} disabled={!!busy}>
                Choose {only === "picture" ? "a picture" : "files"}…
              </button>
              <input
                ref={input}
                type="file"
                multiple={only !== "picture"}
                accept={only === "picture" ? "image/png,image/jpeg,image/gif" : undefined}
                hidden
                onChange={(e) => {
                  pickFiles([...(e.target.files ?? [])]);
                  e.target.value = "";
                }}
              />
              {only !== "picture" && <p className="muted">Very large videos (over 1 GB) are better added as a link to where they are kept, or a YouTube link.</p>}
            </div>
          )}

          {source === "nature" &&
            (nature === null ? (
              <p className="muted">Loading…</p>
            ) : nature.length === 0 ? (
              <div className="mp-drop">
                <p>100 photographs of lakes, rivers, mountains, the sea, sunrises, fire and animals — free to use (public domain and CC0, from Wikimedia Commons).</p>
                <button className="pill-btn" onClick={downloadNature} disabled={progress !== null}>
                  {progress !== null ? `Downloading… ${progress}%` : "Download them (about 8 MB, once)"}
                </button>
              </div>
            ) : (
              <div className="mp-grid">
                {nature.map((b) => (
                  <NatureThumb
                    key={b.id}
                    b={b}
                    onPick={() =>
                      void run("Adding the photo…", async () => [
                        await addBytes(await api.sermonBackgroundBytes(b.id, true), `${b.id}.jpg`, b.theme.charAt(0).toUpperCase() + b.theme.slice(1), `${b.author.replace(/<[^>]+>/g, "")}, ${b.licence}`),
                      ])
                    }
                  />
                ))}
              </div>
            ))}

          {source === "bible" &&
            (collections.length === 0 ? (
              <p className="muted">No Bible pictures are downloaded yet. Download a collection in Explore → Bible pictures, then they can be used here.</p>
            ) : (
              <>
                <label className="sb-inline">
                  <span className="muted">Collection</span>
                  <select value={collection} onChange={(e) => setCollection(e.target.value)}>
                    {collections.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.title} ({c.downloaded})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="mp-grid">
                  {gallery.map((p) => (
                    <BibleThumb
                      key={p.id}
                      p={p}
                      onPick={() => void run("Adding the picture…", async () => [await addBytes(await api.pictureBytes(p.id), p.url.split("/").pop() || `${p.id}.jpg`, p.title, [p.artist, p.licence].filter(Boolean).join(", "))])}
                    />
                  ))}
                </div>
                {more > gallery.length && <p className="muted">The first {gallery.length} of {more}. Find others by passage in Explore → Bible pictures.</p>}
              </>
            ))}

          {source === "link" && (
            <form
              className="mp-link"
              onSubmit={(e) => {
                e.preventDefault();
                if (!link) return;
                onAdd([{ kind: linkKind, title: linkTitle.trim() || link.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60), url: link }]);
              }}
            >
              <label>
                <span className="muted">Web address — a YouTube video, a song on YouTube Music or Spotify, a web page</span>
                <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" autoFocus />
              </label>
              <label>
                <span className="muted">What to call it</span>
                <input value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} placeholder="e.g. Everyday Angel — Southern Cross Music" />
              </label>
              {link && (
                <p className="muted">
                  {KIND_LABEL[linkKind]}
                  {yt && <img className="mp-yt" src={`https://img.youtube.com/vi/${yt}/mqdefault.jpg`} alt="" />}
                </p>
              )}
              <button className="pill-btn" type="submit" disabled={!link}>
                Add the link
              </button>
              <p className="muted">It opens in your browser from the sermon, from Preach and from the slides (internet needed).</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
