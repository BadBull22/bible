import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, ChapterPictures, PictureCollection, PictureInfo, PicturesProgress } from "../api";
import { pictureRefLabel, usePictureUrl } from "../pictures";
import { CloseIcon } from "./icons";
import { PictureViewer } from "./PictureViewer";

interface Props {
  book: string;
  chapter: number;
  initialTab?: "chapter" | "gallery" | "download";
  onJump: (book: string, chapter: number, verse: number) => void;
  onClose: () => void;
}

function Thumb({ p, onOpen }: { p: PictureInfo; onOpen: () => void }) {
  const url = usePictureUrl(p.id);
  const ref = pictureRefLabel(p);
  return (
    <button className="picture-thumb" onClick={onOpen} title={ref ? `${p.title} — ${ref}` : p.title}>
      {url ? <img src={url} alt={p.title} loading="lazy" /> : <span className="picture-thumb-empty" />}
      <span className="picture-thumb-label">{ref ?? p.title}</span>
    </button>
  );
}

const PAGE = 48;

export function PicturesPanel({ book, chapter, initialTab, onJump, onClose }: Props) {
  const [tab, setTab] = useState<"chapter" | "gallery" | "download">(initialTab ?? "chapter");
  const [chapterPics, setChapterPics] = useState<ChapterPictures | null>(null);
  const [collections, setCollections] = useState<PictureCollection[]>([]);
  const [progress, setProgress] = useState<Record<string, PicturesProgress>>({});
  const [galleryKey, setGalleryKey] = useState<string>("");
  const [gallery, setGallery] = useState<{ items: PictureInfo[]; total: number }>({ items: [], total: 0 });
  const [viewer, setViewer] = useState<{ list: PictureInfo[]; index: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reloadCollections = () => api.picturesCollections().then(setCollections).catch(() => undefined);
  const reloadChapter = () => api.picturesForChapter(book, chapter).then(setChapterPics).catch(() => undefined);

  useEffect(() => {
    reloadChapter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapter]);

  useEffect(() => {
    reloadCollections();
    const a = listen<PicturesProgress>("pictures-progress", (e) => setProgress((m) => ({ ...m, [e.payload.collection]: e.payload })));
    const b = listen<string>("pictures-changed", (e) => {
      setProgress((m) => {
        const n = { ...m };
        delete n[e.payload];
        return n;
      });
      reloadCollections();
      reloadChapter();
    });
    return () => {
      a.then((f) => f());
      b.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the gallery shows the first collection that has pictures downloaded
  useEffect(() => {
    if (!galleryKey) {
      const first = collections.find((c) => c.downloaded > 0);
      if (first) setGalleryKey(first.key);
    }
  }, [collections, galleryKey]);

  function loadGallery(key: string, offset: number) {
    api
      .picturesGallery(key, offset, PAGE)
      .then(([items, total]) => setGallery((g) => ({ items: offset === 0 ? items : [...g.items, ...items], total })))
      .catch((e) => setError(String(e)));
  }

  useEffect(() => {
    if (tab === "gallery" && galleryKey) loadGallery(galleryKey, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, galleryKey]);

  async function download(key: string) {
    setError(null);
    setCollections((cs) => cs.map((c) => (c.key === key ? { ...c, downloading: true } : c)));
    try {
      await api.picturesDownload(key);
    } catch (e) {
      setError(String(e));
    }
    reloadCollections();
  }

  const downloadedAny = collections.some((c) => c.downloaded > 0);

  return (
    <aside className="side-panel wide pictures-panel">
      <div className="side-panel-header">
        <h3>Pictures</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="mode-toggle" role="tablist" aria-label="Pictures view">
        <button role="tab" aria-selected={tab === "chapter"} className={tab === "chapter" ? "active" : ""} onClick={() => setTab("chapter")}>
          {book} {chapter}
        </button>
        <button role="tab" aria-selected={tab === "gallery"} className={tab === "gallery" ? "active" : ""} onClick={() => setTab("gallery")} disabled={!downloadedAny}>
          Gallery
        </button>
        <button role="tab" aria-selected={tab === "download"} className={tab === "download" ? "active" : ""} onClick={() => setTab("download")}>
          Download
        </button>
      </div>
      {error && <p className="status-error">{error}</p>}

      {tab === "chapter" && chapterPics && (
        <>
          {chapterPics.pictures.length > 0 ? (
            <div className="picture-grid">
              {chapterPics.pictures.map((p, i) => (
                <Thumb key={p.id} p={p} onOpen={() => setViewer({ list: chapterPics.pictures, index: i })} />
              ))}
            </div>
          ) : (
            <p className="muted">
              {chapterPics.available.length ? `No downloaded pictures for ${book} ${chapter} yet.` : `No pictures in the catalogue for ${book} ${chapter}.`}
            </p>
          )}
          {chapterPics.available.length > 0 && (
            <p className="search-hint">
              More for this chapter in:{" "}
              {chapterPics.available.map(([title, n], i) => (
                <span key={title}>
                  {i > 0 && ", "}
                  {title} ({n})
                </span>
              ))}{" "}
              —{" "}
              <button className="link-btn" onClick={() => setTab("download")}>
                download
              </button>
            </p>
          )}
        </>
      )}

      {tab === "gallery" && (
        <>
          <div className="search-controls">
            <select value={galleryKey} onChange={(e) => setGalleryKey(e.target.value)} aria-label="Collection">
              {collections
                .filter((c) => c.downloaded > 0)
                .map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.title} ({c.downloaded})
                  </option>
                ))}
            </select>
          </div>
          <div className="picture-grid">
            {gallery.items.map((p, i) => (
              <Thumb key={p.id} p={p} onOpen={() => setViewer({ list: gallery.items, index: i })} />
            ))}
          </div>
          {gallery.items.length < gallery.total && (
            <button className="outline-btn picture-more" onClick={() => loadGallery(galleryKey, gallery.items.length)}>
              Show more ({gallery.total - gallery.items.length} left)
            </button>
          )}
        </>
      )}

      {tab === "download" && (
        <>
          <p className="search-hint">
            Choose the collections you want. Each downloads once (internet needed only then) and then shows offline beside the
            chapters it illustrates. Downloads go gently, one picture at a time, and can be stopped and resumed.
          </p>
          <ul className="library-list">
            {collections.map((c) => {
              const pr = progress[c.key];
              const done = c.downloaded >= c.count;
              return (
                <li key={c.key} className="library-item">
                  <div className="library-item-head">
                    <span className="library-title">{c.title}</span>
                    <span className="item-tools">
                      {c.downloading ? (
                        <>
                          <span className="muted library-progress">
                            {pr ? `${pr.done} of ${pr.total}` : "Starting…"}
                            {pr && pr.failed ? ` (${pr.failed} skipped)` : ""}
                          </span>
                          <button className="text-btn" onClick={() => api.picturesCancel(c.key)}>
                            Stop
                          </button>
                        </>
                      ) : done ? (
                        <span className="library-installed">✓ Downloaded</span>
                      ) : (
                        <button className="pill-btn small" onClick={() => download(c.key)}>
                          {c.downloaded > 0 ? "Resume" : "Download"}
                        </button>
                      )}
                      {c.downloaded > 0 && !c.downloading && (
                        <button className="text-btn" onClick={() => api.picturesRemove(c.key).then(reloadCollections).catch((e) => setError(String(e)))}>
                          Remove
                        </button>
                      )}
                    </span>
                  </div>
                  <div className="library-meta muted">
                    {c.artist}
                    {c.year ? `, ${c.year}` : ""} · {c.count} pictures · about {c.approx_mb} MB · {c.licence}
                    {c.downloaded > 0 && !done ? ` · ${c.downloaded} downloaded` : ""}
                  </div>
                  {c.about && <div className="library-meta">{c.about}</div>}
                  {c.downloading && pr && pr.total > 0 && (
                    <div className="plan-progress" role="progressbar" aria-valuenow={Math.round((pr.done / pr.total) * 100)} aria-valuemin={0} aria-valuemax={100}>
                      <div style={{ width: `${(pr.done / pr.total) * 100}%` }} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="search-hint">Pictures come from Wikimedia Commons; each shows its artist, licence and a link to its source page.</p>
        </>
      )}

      {viewer && <PictureViewer pictures={viewer.list} index={viewer.index} onIndex={(i) => setViewer({ ...viewer, index: i })} onClose={() => setViewer(null)} onJump={onJump} />}
    </aside>
  );
}
