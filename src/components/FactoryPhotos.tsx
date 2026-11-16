// Content Factory: the "Photos" tool. Four places to find a picture to put behind the words: the nature photos that come with the app,
// the Bible paintings that go with this passage (from the collections downloaded in Explore, Pictures), a search of Wikimedia Commons
// for a photograph (credited automatically), and the reader's own picture. The grid sits beside the preview, so a click shows at once.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, PictureInfo } from "../api";
import { PHOTO_IDEAS, searchCommons, type CommonsPhoto } from "../factory/commons";
import { shrinkPhoto } from "../factory/logo";
import { filterPaintings, isSmallPicture, paintingBooks, paintingCredit, paintingsTabLabel } from "../factory/paintings";
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
  /** the book names in Bible order, for the book chooser of the paintings */
  bookOrder?: string[];
  /** open Explore, Pictures (to download the painting collections) */
  onOpenPictures?: () => void;
}

type Source = "nature" | "christian" | "paintings" | "online" | "mine";

export function FactoryPhotos({ chapter, onPick, nature, latest, natureBusy, onGetNature, onNature, christian, christianInfo, christianBusy, onGetChristian, onChristian, onMine, bookOrder, onOpenPictures }: Props) {
  const [source, setSource] = useState<Source>("nature");
  const [paintingTotal, setPaintingTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<CommonsPhoto[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // how many paintings are downloaded in all (for the tab's label); asked again when a collection is added or removed
  useEffect(() => {
    let live = true;
    const count = () =>
      api
        .picturesCollections()
        .then((cs) => live && setPaintingTotal(cs.reduce((n, c) => n + c.downloaded, 0)))
        .catch(() => undefined);
    void count();
    const un = listen("pictures-changed", () => void count());
    window.addEventListener("focus", count);
    return () => {
      live = false;
      window.removeEventListener("focus", count);
      void un.then((f) => f());
    };
  }, []);

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

  return (
    <div className="fx-photos">
      <Segmented
        label="Where to find a picture"
        value={source}
        onChange={setSource}
        options={[
          { id: "nature", label: nature && nature.length ? `Nature (${nature.length})` : "Nature" },
          { id: "christian", label: christian && christian.length ? `Christian (${christian.length})` : "Christian" },
          { id: "paintings", label: paintingsTabLabel(paintingTotal), title: "Every Bible painting downloaded in Explore, Pictures" },
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

      {source === "paintings" && <PaintingsTab chapter={chapter} onPick={onPick} bookOrder={bookOrder ?? []} onOpenPictures={onOpenPictures} />}

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

/** small copies of the paintings, kept for the visit so that going back to the tab does not load them again */
const paintingThumbs = new Map<string, string>();

/** One painting as a little picture, made when it scrolls into view (the big file is read, shrunk and let go). */
function PaintingThumb({ p }: { p: PictureInfo }) {
  const [url, setUrl] = useState<string | null>(paintingThumbs.get(p.id) ?? null);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (url) return;
    const el = box.current;
    let live = true;
    const load = async () => {
      try {
        const bmp = await createImageBitmap(new Blob([await api.pictureBytes(p.id)]), { resizeWidth: 280, resizeQuality: "medium" });
        const c = document.createElement("canvas");
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext("2d")!.drawImage(bmp, 0, 0);
        bmp.close();
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.8));
        if (blob && live) {
          const u = URL.createObjectURL(blob);
          paintingThumbs.set(p.id, u);
          setUrl(u);
        }
      } catch {
        /* a picture that cannot be read stays a blank tile */
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
  }, [p.id, url]);
  return <span ref={box}>{url ? <img src={url} alt={p.title} /> : <span className="muted">…</span>}</span>;
}

const PAINT_PAGE = 60;

/** The "Paintings" tab: the paintings that go with this passage first, then everything downloaded in Explore, Pictures, with a collection, a book and a search by words. */
function PaintingsTab({ chapter, onPick, bookOrder, onOpenPictures }: { chapter: { book: string; chapter: number } | null; onPick: (blob: Blob, credit: string) => Promise<void>; bookOrder: string[]; onOpenPictures?: () => void }) {
  const [all, setAll] = useState<PictureInfo[] | null>(null);
  const [collections, setCollections] = useState<{ key: string; title: string; downloaded: number; count: number }[]>([]);
  const [forChapter, setForChapter] = useState<PictureInfo[]>([]);
  const [collection, setCollection] = useState("");
  const [book, setBook] = useState("");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAINT_PAGE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const cs = await api.picturesCollections();
      setCollections(cs.map((c) => ({ key: c.key, title: c.title, downloaded: c.downloaded, count: c.count })));
      const lists = await Promise.all(cs.filter((c) => c.downloaded > 0).map((c) => api.picturesGallery(c.key, 0, 100000).then(([items]) => items)));
      setAll(lists.flat());
    } catch {
      setAll([]);
    }
  }, []);
  useEffect(() => {
    void load();
    const un = listen("pictures-changed", () => void load());
    return () => void un.then((f) => f());
  }, [load]);

  useEffect(() => {
    setForChapter([]);
    if (!chapter) return;
    let live = true;
    api
      .picturesForChapter(chapter.book, chapter.chapter)
      .then((r) => live && setForChapter(r.pictures.filter((p) => p.downloaded)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [chapter?.book, chapter?.chapter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setShown(PAINT_PAGE), [collection, book, query]);

  const books = useMemo(() => paintingBooks(all ?? [], bookOrder), [all, bookOrder]);
  const list = useMemo(() => filterPaintings(all ?? [], { collection, book, query }), [all, collection, book, query]);
  const missing = collections.filter((c) => c.downloaded > 0 && c.downloaded < c.count).reduce((n, c) => n + c.count - c.downloaded, 0);

  const pick = async (p: PictureInfo) => {
    setBusy(true);
    setError(null);
    try {
      await onPick(new Blob([await api.pictureBytes(p.id)]), paintingCredit(p));
    } catch {
      setError("That painting could not be opened.");
    } finally {
      setBusy(false);
    }
  };

  const tile = (p: PictureInfo) => (
    <button key={p.id} type="button" title={`${p.title}${p.artist ? `, ${p.artist}` : ""}${paintingCredit(p) ? " (a credit line goes on the picture)" : ""}${isSmallPicture(p) ? ". A small picture: it may look soft in a tall size." : ""}`} onClick={() => void pick(p)} disabled={busy}>
      <PaintingThumb p={p} />
      {isSmallPicture(p) && <span className="fx-small-badge">small</span>}
    </button>
  );

  if (all === null) return <p className="muted fx-hint">Looking for your paintings…</p>;
  if (all.length === 0)
    return (
      <div className="fx-offer">
        <p className="muted">No Bible paintings are downloaded yet. James Tissot, Gustave Doré and Sweet Publishing are free collections you can fetch once in Explore, Pictures.</p>
        {onOpenPictures && (
          <button type="button" className="pill-btn" onClick={onOpenPictures}>
            Get the painting collections
          </button>
        )}
      </div>
    );

  return (
    <>
      {forChapter.length > 0 && chapter && (
        <>
          <p className="muted fx-hint">
            For {chapter.book === "Psalms" ? "Psalm" : chapter.book} {chapter.chapter}:
          </p>
          <div className="fx-grid">{forChapter.slice(0, 12).map(tile)}</div>
        </>
      )}
      <div className="fx-pickrow">
        <label className="fx-inline-field">
          <span>From</span>
          <select value={collection} onChange={(e) => setCollection(e.target.value)} aria-label="Which collection of paintings">
            <option value="">All collections</option>
            {collections
              .filter((c) => c.downloaded > 0)
              .map((c) => (
                <option key={c.key} value={c.key}>
                  {c.title.replace(/ — .*$/, "")} ({c.downloaded})
                </option>
              ))}
          </select>
        </label>
        <label className="fx-inline-field">
          <span>Book</span>
          <select value={book} onChange={(e) => setBook(e.target.value)} aria-label="Which book of the Bible">
            <option value="">Any book</option>
            {books.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      </div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find one by words, e.g. manger, Moses, Psalms 23" aria-label="Find a painting by words" />
      <p className="muted fx-hint">
        {list.length.toLocaleString("en-US")} painting{list.length === 1 ? "" : "s"}. Click one to put it behind the words. Sweet Publishing and the Tissot Old Testament scans need a credit, so a small line is added to the picture.
      </p>
      {error && <p className="status-error">{error}</p>}
      <div className="fx-grid">{list.slice(0, shown).map(tile)}</div>
      {list.length > shown && (
        <button type="button" className="outline-btn fx-small" onClick={() => setShown((n) => n + PAINT_PAGE)}>
          Show more ({(list.length - shown).toLocaleString("en-US")} left)
        </button>
      )}
      {missing > 0 && onOpenPictures && (
        <p className="muted fx-hint">
          {missing.toLocaleString("en-US")} more in these collections are not downloaded.{" "}
          <button type="button" className="link-btn" onClick={onOpenPictures}>
            Get them
          </button>
        </p>
      )}
    </>
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
