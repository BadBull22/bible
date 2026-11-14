// Content Factory: the "Photos" tool. Four places to find a picture to put behind the words: the nature photos that come with the app,
// the Bible paintings that go with this passage (from the collections downloaded in Explore, Pictures), a search of Wikimedia Commons
// for a photograph (credited automatically), and the reader's own picture. The grid sits beside the preview, so a click shows at once.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, PictureInfo } from "../api";
import { PHOTO_IDEAS, searchCommons, type CommonsPhoto } from "../factory/commons";
import { shrinkPhoto } from "../factory/logo";
import { Segmented } from "./FactoryParts";

export interface NaturePhoto {
  id: string;
  theme: string;
  title: string;
  author: string;
  licence: string;
}

interface Props {
  /** the chapter of the picture being made, if it is a verse */
  chapter: { book: string; chapter: number } | null;
  /** a picture was chosen: its pixels, and the credit its licence asks for (empty for none) */
  onPick: (blob: Blob, credit: string) => Promise<void>;
  nature: NaturePhoto[] | null;
  /** how many nature photos the latest pack holds, and its size in MB */
  latest: [number, number];
  natureBusy: boolean;
  onGetNature: () => void;
  onNature: (b: NaturePhoto) => void;
  /** the Christian pictures: a pack of their own, downloaded on request */
  christian: NaturePhoto[] | null;
  christianInfo: [number, number];
  christianBusy: boolean;
  onGetChristian: () => void;
  onChristian: (b: NaturePhoto) => void;
  onMine: (file: File) => void;
}

type Source = "nature" | "christian" | "paintings" | "online" | "mine";

/** the credit a Bible painting's licence asks for (public domain needs none) */
function paintingCredit(p: PictureInfo): string {
  if (/public domain|^pd\b|cc0/i.test(p.licence)) return "";
  return `Picture: ${p.title}, ${p.artist ? `${p.artist}, ` : ""}${p.licence}`.slice(0, 150);
}

export function FactoryPhotos({ chapter, onPick, nature, latest, natureBusy, onGetNature, onNature, christian, christianInfo, christianBusy, onGetChristian, onChristian, onMine }: Props) {
  const [source, setSource] = useState<Source>("nature");
  const [paintings, setPaintings] = useState<PictureInfo[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<CommonsPhoto[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPaintings(null);
    if (!chapter) return;
    api
      .picturesForChapter(chapter.book, chapter.chapter)
      .then((r) => setPaintings(r.pictures.filter((p) => p.downloaded)))
      .catch(() => setPaintings([]));
  }, [chapter?.book, chapter?.chapter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let live = true;
    const made: string[] = [];
    (async () => {
      for (const p of (paintings ?? []).slice(0, 48)) {
        try {
          const u = URL.createObjectURL(new Blob([await api.pictureBytes(p.id)]));
          made.push(u);
          if (live) setThumbs((m) => ({ ...m, [p.id]: u }));
        } catch {
          /* skip */
        }
      }
    })();
    return () => {
      live = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [paintings]);

  const search = async (q: string) => {
    if (!q.trim()) return;
    setBusy("Searching…");
    setError(null);
    try {
      setFound(await searchCommons(q));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  };

  const pickOnline = async (p: CommonsPhoto) => {
    setBusy("Getting the photo…");
    setError(null);
    try {
      const res = await fetch(p.thumb);
      if (!res.ok) throw new Error("The photo could not be fetched.");
      await onPick(await res.blob(), p.credit);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  };

  const nPaint = paintings?.length ?? 0;
  return (
    <div className="fx-photos">
      <Segmented
        label="Where to find a picture"
        value={source}
        onChange={setSource}
        options={[
          { id: "nature", label: nature && nature.length ? `Nature (${nature.length})` : "Nature" },
          { id: "christian", label: christian && christian.length ? `Christian (${christian.length})` : "Christian" },
          { id: "paintings", label: nPaint ? `Paintings (${nPaint})` : "Paintings", disabled: !chapter || nPaint === 0, title: chapter ? (nPaint ? undefined : "No Bible paintings are downloaded for this chapter (Explore, Pictures)") : "Paintings go with a verse from the Bible" },
          { id: "online", label: "Online" },
          { id: "mine", label: "Mine" },
        ]}
      />

      {source === "nature" && (
        <>
          {nature && nature.length === 0 && (
            <div className="fx-offer">
              <p className="muted">Free nature photos to put behind the words, fetched once.</p>
              <button type="button" className="pill-btn" onClick={onGetNature} disabled={natureBusy}>
                {natureBusy ? "Getting the photos…" : `Get the ${latest[0]} nature photos (${latest[1]} MB)`}
              </button>
            </div>
          )}
          {nature && nature.length > 0 && (
            <>
              {nature.length < latest[0] && (
                <p className="muted fx-offer-line">
                  There are {latest[0]} in all.{" "}
                  <button type="button" className="link-btn" onClick={onGetNature} disabled={natureBusy}>
                    {natureBusy ? "Getting the photos…" : `Get the other ${latest[0] - nature.length} (${latest[1]} MB)`}
                  </button>
                </p>
              )}
              <NatureGrid list={nature} onPick={onNature} />
            </>
          )}
        </>
      )}

      {source === "christian" && (
        <>
          {christian && christian.length === 0 && (
            <div className="fx-offer">
              <p className="muted">
                {christianInfo[0]} photographs for the church: crosses, prayer, worship, stained glass, the Bible, communion and Christmas. They come from Unsplash and are free to use. Fetched once.
              </p>
              <button type="button" className="pill-btn" onClick={onGetChristian} disabled={christianBusy}>
                {christianBusy ? "Getting the pictures…" : `Get the ${christianInfo[0]} Christian pictures (${christianInfo[1]} MB)`}
              </button>
            </div>
          )}
          {christian && christian.length > 0 && <NatureGrid list={christian} onPick={onChristian} pack="christian" />}
        </>
      )}

      {source === "paintings" && chapter && nPaint > 0 && (
        <>
          <p className="muted fx-hint">
            Paintings for {chapter.book === "Psalms" ? "Psalm" : chapter.book} {chapter.chapter}. Click one to put it behind the words.
          </p>
          <div className="fx-grid">
            {paintings!.slice(0, 48).map((p) => (
              <button key={p.id} type="button" title={`${p.title}${p.artist ? `, ${p.artist}` : ""}`} onClick={() => void api.pictureBytes(p.id).then((b) => onPick(new Blob([b]), paintingCredit(p)))}>
                {thumbs[p.id] ? <img src={thumbs[p.id]} alt={p.title} /> : <span className="muted">…</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {source === "online" && (
        <>
          <form
            className="factory-row"
            onSubmit={(e) => {
              e.preventDefault();
              void search(query);
            }}
          >
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g. sunrise over hills, candle" aria-label="Search for a photo" />
            <button type="submit" className="outline-btn" disabled={!query.trim() || !!busy}>
              Search
            </button>
          </form>
          <div className="factory-chips factory-ideas">
            {PHOTO_IDEAS.map((i) => (
              <button
                key={i}
                type="button"
                className="fx-idea"
                onClick={() => {
                  setQuery(i);
                  void search(i);
                }}
              >
                {i}
              </button>
            ))}
          </div>
          {busy && <p className="muted">{busy}</p>}
          {error && <p className="status-error">{error}</p>}
          {found && found.length === 0 && <p className="muted">No photo with a usable licence was found. Try other words.</p>}
          {found && found.length > 0 && (
            <>
              <div className="fx-grid">
                {found.map((p) => (
                  <button key={p.page} type="button" title={`${p.title} (${p.licence})`} onClick={() => void pickOnline(p)} disabled={!!busy}>
                    <img src={p.thumb} alt={p.title} loading="lazy" />
                  </button>
                ))}
              </div>
              <p className="muted fx-hint">Public domain, CC0, CC BY and CC BY-SA photographs only. A credit line is put on the picture when the licence asks for one.</p>
            </>
          )}
        </>
      )}

      {source === "mine" && <MyPictures onPick={onPick} onOne={onMine} />}
    </div>
  );
}

/** The nature photos as a grid of small pictures to pick from, with a choice of subject (lakes, mist, sheep...). */
function NatureGrid({ list, onPick, pack }: { list: NaturePhoto[]; onPick: (b: NaturePhoto) => void; pack?: "christian" }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [theme, setTheme] = useState("");
  const themes = useMemo(() => [...new Set(list.map((b) => b.theme))].sort(), [list]);
  const shown = useMemo(() => (theme ? list.filter((b) => b.theme === theme) : list), [list, theme]);
  const loaded = useRef(new Set<string>());
  const made = useRef<string[]>([]);
  useEffect(() => {
    let live = true;
    (async () => {
      for (const b of shown) {
        if (!live) return;
        if (loaded.current.has(b.id)) continue;
        loaded.current.add(b.id);
        try {
          const u = URL.createObjectURL(new Blob([await api.sermonBackgroundBytes(b.id, false, pack)]));
          made.current.push(u);
          if (live) setUrls((m) => ({ ...m, [b.id]: u }));
        } catch {
          loaded.current.delete(b.id);
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [shown]);
  useEffect(() => () => made.current.forEach((u) => URL.revokeObjectURL(u)), []);
  return (
    <>
      <label className="fx-inline-field">
        <span>Show</span>
        <select value={theme} onChange={(e) => setTheme(e.target.value)} aria-label="Which kind of photo">
          <option value="">All {list.length} photos</option>
          {themes.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)} ({list.filter((b) => b.theme === t).length})
            </option>
          ))}
        </select>
      </label>
      <div className="fx-grid">
        {shown.map((b) => (
          <button key={b.id} type="button" onClick={() => onPick(b)} title={b.title}>
            {urls[b.id] ? <img src={urls[b.id]} alt={b.title} /> : <span className="muted">…</span>}
          </button>
        ))}
      </div>
    </>
  );
}

type Mine = { path: string; name: string; size: number; modified: number };

/** small copies of the reader's pictures, kept for the visit so that going back to the tab does not load them again */
const mineThumbs = new Map<string, string>();

/** One of the reader's pictures as a little picture, made when it scrolls into view (the big file is read, shrunk, and let go). */
function MineThumb({ file }: { file: Mine }) {
  const [url, setUrl] = useState<string | null>(mineThumbs.get(file.path) ?? null);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (url) return;
    const el = box.current;
    let live = true;
    const load = async () => {
      try {
        const bytes = await api.factoryFileBytes(file.path);
        const bmp = await createImageBitmap(new Blob([bytes]), { resizeWidth: 280, resizeQuality: "medium" });
        const c = document.createElement("canvas");
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext("2d")!.drawImage(bmp, 0, 0);
        bmp.close();
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.8));
        if (blob && live) {
          const u = URL.createObjectURL(blob);
          mineThumbs.set(file.path, u);
          setUrl(u);
        }
      } catch {
        /* a picture that cannot be read is left as a blank tile */
      }
    };
    if (!el || typeof IntersectionObserver === "undefined") {
      void load();
      return () => {
        live = false;
      };
    }
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (io.disconnect(), void load()), { rootMargin: "160px" });
    io.observe(el);
    return () => {
      live = false;
      io.disconnect();
    };
  }, [file.path, url]);
  return <span ref={box}>{url ? <img src={url} alt={file.name} /> : <span className="muted">…</span>}</span>;
}

/** The "Mine" tab: the pictures in the reader's own folder (added here, shrunk to a sensible size, or put in the folder by hand), and a way to use one from elsewhere. */
function MyPictures({ onPick, onOne }: { onPick: (blob: Blob, credit: string) => Promise<void>; onOne: (file: File) => void }) {
  const [list, setList] = useState<Mine[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const refresh = useCallback(() => api.factoryPicturesList().then(setList).catch(() => setList([])), []);
  useEffect(() => {
    void refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const add = async (files: File[]) => {
    let done = 0;
    let skipped = 0;
    setNote(null);
    for (const f of files) {
      setBusy(`Adding picture ${done + skipped + 1} of ${files.length}…`);
      const blob = await shrinkPhoto(f);
      if (!blob) {
        skipped++;
        continue;
      }
      try {
        await api.factorySave(new Uint8Array(await blob.arrayBuffer()), "My pictures", `${f.name.replace(/\.[^.]+$/, "")}.jpg`);
        done++;
      } catch {
        skipped++;
      }
    }
    setBusy(null);
    setNote(`${done} picture${done === 1 ? "" : "s"} added${skipped ? `; ${skipped} could not be opened (a JPEG or PNG works)` : ""}.`);
    void refresh();
  };

  const use = async (p: Mine) => {
    setBusy("Opening the picture…");
    try {
      await onPick(new Blob([await api.factoryFileBytes(p.path)]), "");
    } finally {
      setBusy(null);
    }
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  }, [list, query]);

  return (
    <>
      <div className="fx-pickrow">
        <label className="pill-btn factory-file fx-small">
          Add pictures…
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              const fs = [...(e.target.files ?? [])];
              e.target.value = "";
              if (fs.length) void add(fs);
            }}
          />
        </label>
        <button type="button" className="outline-btn fx-small" onClick={() => void api.factoryPicturesFolder().then(refresh).catch(() => undefined)} title="Open the folder: pictures you put there appear here">
          Open the folder
        </button>
      </div>
      <p className="muted fx-hint">Photos you downloaded (Unsplash, Pexels, Pixabay...) or took. Large ones are made a sensible size when they are added.</p>
      {busy && <p className="muted fx-hint">{busy}</p>}
      {note && <p className="muted fx-hint">{note}</p>}
      {list && list.length > 12 && <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find one by name" aria-label="Find one of my pictures by name" />}
      {list && list.length === 0 && <p className="muted fx-hint">No pictures yet. Choose “Add pictures…”, then click one to put it behind the words.</p>}
      <div className="fx-grid">
        {shown.map((p) => (
          <button key={p.path} type="button" title={p.name} onClick={() => void use(p)} disabled={!!busy}>
            <MineThumb file={p} />
          </button>
        ))}
      </div>
      <label className="link-btn fx-left factory-file" title="Use one picture from anywhere without keeping a copy">
        Use one picture without adding it…
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onOne(f);
          }}
        />
      </label>
    </>
  );
}
