import { useEffect, useMemo, useRef, useState } from "react";
import { api, Deck, SongRow } from "../api";
import { bestHit, clearNew, loadList, makeSongsFile, mergeChart, normTitle, readSongsFile, saveList, StoredSong, toTopSongs, TopSong } from "../worshipTop100";
import type { SlideSpec } from "../sermonOutputs";
import { parseSong, parseSongFile, SongData, songSlides, songText } from "../songs";
import { CloseIcon } from "./icons";
import { backdrop } from "../backdrop";

/** A song as kept in the database, with its sections and order. */
export function songOf(row: SongRow): SongData {
  let b: { sections?: SongData["sections"]; arrangement?: number[] } = {};
  try {
    b = JSON.parse(row.body || "{}");
  } catch {
    /* no words yet */
  }
  const sections = b.sections ?? [];
  return { id: row.id, title: row.title, author: row.author, ccli: row.ccli, sections, arrangement: b.arrangement?.length ? b.arrangement : sections.map((_, i) => i) };
}

const rowOf = (s: Omit<SongData, "id"> & { id?: number }): SongRow => ({
  id: s.id ?? 0,
  title: s.title,
  author: s.author,
  ccli: s.ccli,
  body: JSON.stringify({ sections: s.sections, arrangement: s.arrangement }),
});

/** Opens a search for the words of a song in the browser, for the preacher to copy from. */
async function searchTheWeb(title: string, author: string) {
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(`https://www.google.com/search?q=${encodeURIComponent(`${title} ${author} lyrics`.replace(/\s+/g, " ").trim())}`);
}

/** Adds a song, or changes one: its title, writer and words. The words are pasted or typed in one box; a line
 * that says Verse 1, Chorus, Bridge... starts a part, a blank line ends one, and a heading on its own again
 * (Chorus) is that part sung again. */
export function SongEditor({ song, onSaved, onClose, autoLookup = false, autoPick = false }: { song: SongData | null; onSaved: (s: SongData) => void; onClose: () => void; autoLookup?: boolean; autoPick?: boolean }) {
  const [title, setTitle] = useState(song?.title ?? "");
  const [author, setAuthor] = useState(song?.author ?? "");
  const [ccli, setCcli] = useState(song?.ccli ?? "");
  const [text, setText] = useState(song ? songText(song) : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseSong(text), [text]);
  const file = useRef<HTMLInputElement>(null);
  // the online look-up: what was found for the title, and the one whose words are being fetched
  const [found, setFound] = useState<{ title: string; artist: string }[] | null>(null);
  const [looking, setLooking] = useState<string | null>(null);

  const lookUp = async () => {
    setError(null);
    setFound(null);
    setLooking("Looking…");
    try {
      const hits = await api.lyricsSearch(`${title} ${author}`.replace(/\s+/g, " ").trim());
      setFound(hits);
      if (hits.length === 0) setError("The lyrics service doesn't know that one. Check the spelling, or paste the words in.");
      // from the Top 100 list: the same title by the same artist is taken for the preacher to check; otherwise they choose
      const best = autoPick ? bestHit(hits, title, author) : null;
      if (best) void take(best);
    } catch (e) {
      setError(String(e));
    } finally {
      setLooking(null);
    }
  };
  const take = async (h: { title: string; artist: string }) => {
    setError(null);
    setLooking(`Getting the words of ${h.title}…`);
    try {
      const words = await api.lyricsGet(h.artist, h.title);
      setText(songText(parseSong(words)));
      // the title as the service has it, without "(Live)" and the like
      if (!title.trim()) setTitle(h.title.replace(/\s*[(\[][^)\]]*[)\]]\s*$/, "").trim() || h.title);
      setAuthor((a) => a || h.artist);
      setFound(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLooking(null);
    }
  };
  useEffect(() => {
    if (autoLookup && title.trim() && !text.trim()) void lookUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readFile = async (f: File) => {
    const got = parseSongFile(await f.text(), f.name.replace(/\.[^.]+$/, ""));
    setTitle((t) => t || got.title);
    setAuthor((a) => a || got.author);
    setCcli((c) => c || got.ccli);
    setText(songText(got));
  };

  const save = async () => {
    setError(null);
    if (!title.trim()) return setError("Give the song a title.");
    if (parsed.sections.length === 0) return setError("Paste or type the words first.");
    setBusy(true);
    try {
      const data = { id: song?.id ?? 0, title: title.trim(), author: author.trim(), ccli: ccli.trim(), ...parsed };
      const id = await api.songSave(rowOf(data));
      onSaved({ ...data, id });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mp-backdrop" role="dialog" aria-modal="true" aria-label={song ? "Change the song" : "Add a song"} {...backdrop(onClose)}>
      <div className="mp songs-editor" onClick={(e) => e.stopPropagation()}>
        <div className="mp-head">
          <strong>{song ? "Change the song" : "Add a song"}</strong>
          <button className="text-btn" onClick={onClose} aria-label="Close">
            <CloseIcon size={14} />
          </button>
        </div>
        {error && <p className="status-error">{error}</p>}
        <div className="songs-fields">
          <label>
            <span className="muted">Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="e.g. Amazing Grace" />
          </label>
          <label>
            <span className="muted">Written by (optional)</span>
            <input value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>
          <label>
            <span className="muted">CCLI song number (optional)</span>
            <input value={ccli} onChange={(e) => setCcli(e.target.value)} inputMode="numeric" />
          </label>
        </div>
        <div className="songs-tools">
          <button className="pill-btn" onClick={() => void lookUp()} disabled={!title.trim() || !!looking} title="Looks the song up online and fills in the words for you to check (needs the internet)">
            {looking ? "Looking…" : "Look up the words"}
          </button>
          <button className="outline-btn" onClick={() => void searchTheWeb(title, author).catch((e) => setError(String(e)))} disabled={!title.trim()} title="Opens a web search in your browser, to copy the words from a page you trust and paste them below">
            Search the web instead…
          </button>
          <button className="outline-btn" onClick={() => file.current?.click()} title="A text file with the words (a .txt from a song service, or one you wrote)">
            Open a text file…
          </button>
          <input
            ref={file}
            type="file"
            accept=".txt,.text,.cho,.crd,.chordpro,.usr"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void readFile(f).catch((x) => setError(String(x)));
            }}
          />
        </div>
        {found && found.length > 0 && (
          <div className="songs-found" role="group" aria-label="Songs found online">
            <span className="muted">Which one? The words come from the one you choose.</span>
            {found.map((h, i) => (
              <button key={i} className="sf-chip" onClick={() => void take(h)} disabled={!!looking}>
                {h.title} <span>— {h.artist}</span>
              </button>
            ))}
          </div>
        )}
        {looking && looking !== "Looking…" && <p className="muted">{looking}</p>}
        <label className="songs-words">
          <span className="muted">The words</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} placeholder={"Verse 1\nAmazing grace, how sweet the sound\nThat saved a wretch like me\n\nChorus\nMy chains are gone\nI've been set free\n\nVerse 2\n…\n\nChorus"} />
        </label>
        <p className="search-hint">
          Start each part with a line that says <em>Verse 1</em>, <em>Chorus</em>, <em>Bridge</em>… and leave a blank line between parts. Write <em>Chorus</em> on its own line where it is sung again. Look through what comes back from a look-up before
          you keep it: it can have mistakes. Words you did not write are the church's to show under its own licence (CCLI): check with whoever runs the music.
        </p>
        {parsed.sections.length > 0 && (
          <p className="muted songs-order">
            {parsed.sections.length} part{parsed.sections.length === 1 ? "" : "s"} · sung: {parsed.arrangement.map((i) => parsed.sections[i]?.label).join(" → ")}
          </p>
        )}
        <div className="songs-actions">
          <button className="pill-btn" onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save the song"}
          </button>
          <button className="text-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** A song chosen for the list, with the order it will be sung in today. */
interface Picked {
  song: SongData;
  order: number[];
}

/** Makes a list of songs from the saved ones (or adds one, or looks one up): tick the songs, put them in the order
 * they will be sung, change the order of the parts of any of them, and put them all on the slides. */
export function SongPicker({ onUse, onClose, showNow = false }: { onUse: (slides: SlideSpec[], songs: SongData[], show: boolean) => void; onClose?: () => void; showNow?: boolean }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SongRow[] | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [open, setOpen] = useState<number | null>(null); // the picked song whose parts are being arranged
  const [perSlide, setPerSlide] = useState(4);
  const [titles, setTitles] = useState(true);
  const [sort, setSort] = useState<"az" | "new">("az");
  // saved lists: a chosen selection of songs kept with a name and a date, to open again
  const [lists, setLists] = useState<{ deck: Deck; date: string; count: number }[] | null>(null);
  const [showLists, setShowLists] = useState(false);
  const [listId, setListId] = useState(0);
  const [listName, setListName] = useState("");
  const [listDate, setListDate] = useState(() => new Date().toLocaleDateString("sv-SE"));
  const [listNote, setListNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<SongData | null | "new">(null);
  const [error, setError] = useState<string | null>(null);

  const reload = (q = query) =>
    api
      .songSearch(q)
      .then(setRows)
      .catch((e) => (setRows([]), setError(String(e))));
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api
        .songSearch(query)
        .then((r) => live && setRows(r))
        .catch((e) => live && (setRows([]), setError(String(e))));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const add = async (id: number) => {
    setError(null);
    try {
      const row = await api.songGet(id);
      if (!row) return;
      const song = songOf(row);
      setPicked((p) => [...p, { song, order: song.arrangement }]);
    } catch (e) {
      setError(String(e));
    }
  };
  const move = (i: number, d: -1 | 1) =>
    setPicked((p) => {
      const j = i + d;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const setOrder = (i: number, order: number[]) => setPicked((p) => p.map((x, k) => (k === i ? { ...x, order } : x)));
  const remove = async (s: { id: number; title: string }) => {
    if (!window.confirm(`Remove “${s.title}” from your saved songs? (Lists that already use it keep their slides.)`)) return;
    await api.songDelete(s.id).catch((e) => setError(String(e)));
    setPicked((p) => p.filter((x) => x.song.id !== s.id));
    void reload();
  };
  const slides = picked.flatMap((x) => songSlides({ ...x.song, arrangement: x.order }, perSlide, titles));
  const saved = (s: SongData) => {
    setEditing(null);
    setQuery("");
    void reload("");
    // a song just added or looked up goes straight on the list
    setPicked((p) => (p.some((x) => x.song.id === s.id) ? p.map((x) => (x.song.id === s.id ? { song: s, order: s.arrangement } : x)) : [...p, { song: s, order: s.arrangement }]));
  };
  const count = (id: number) => picked.filter((x) => x.song.id === id).length;
  const edit = async (id: number) => {
    const row = await api.songGet(id).catch(() => null);
    if (row) setEditing(songOf(row));
  };

  const sorted = rows && [...rows].sort((a, b) => (sort === "az" ? a.title.localeCompare(b.title) : (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || a.title.localeCompare(b.title)));

  const loadLists = async () => {
    try {
      const all = await api.deckList("songlist");
      const full = await Promise.all(all.map((d) => api.deckGet(d.id)));
      const parsed = full.flatMap((d) => {
        if (!d) return [];
        try {
          const b = JSON.parse(d.body || "{}") as { date?: string; songs?: unknown[] };
          return [{ deck: d, date: b.date ?? "", count: b.songs?.length ?? 0 }];
        } catch {
          return [];
        }
      });
      setLists(parsed.sort((a, b) => b.date.localeCompare(a.date) || b.deck.id - a.deck.id));
    } catch (e) {
      setError(String(e));
    }
  };
  const saveList = async (asNew: boolean) => {
    setError(null);
    if (!listName.trim()) return setError("Give the list a name first, for example “Sunday morning”.");
    try {
      const body = JSON.stringify({ date: listDate, perSlide, titles, songs: picked.map((x) => ({ id: x.song.id, order: x.order })) });
      const id = await api.deckSave({ id: asNew ? 0 : listId, kind: "songlist", title: listName.trim(), body });
      setListId(id);
      setListNote(`Saved “${listName.trim()}” for ${listDate}.`);
      window.setTimeout(() => setListNote(null), 6000);
      void loadLists();
    } catch (e) {
      setError(String(e));
    }
  };
  const openList = async (d: Deck) => {
    setError(null);
    try {
      const full = await api.deckGet(d.id);
      const b = JSON.parse(full?.body || "{}") as { date?: string; perSlide?: number; titles?: boolean; songs?: { id: number; order: number[] }[] };
      const got: Picked[] = [];
      for (const e of b.songs ?? []) {
        const row = await api.songGet(e.id);
        if (!row) continue; // a song since removed
        const song = songOf(row);
        got.push({ song, order: e.order.filter((i) => i >= 0 && i < song.sections.length) });
      }
      setPicked(got);
      setPerSlide(b.perSlide ?? 4);
      setTitles(b.titles ?? true);
      setListId(d.id);
      setListName(d.title);
      setListDate(b.date || new Date().toLocaleDateString("sv-SE"));
      setShowLists(false);
      if ((b.songs?.length ?? 0) > got.length) setError("One or more songs in that list have been removed from your saved songs.");
    } catch (e) {
      setError(String(e));
    }
  };
  const deleteList = async (d: Deck) => {
    if (!window.confirm(`Delete the saved list “${d.title}”? Your songs stay.`)) return;
    await api.deckDelete(d.id).catch((e) => setError(String(e)));
    if (listId === d.id) setListId(0);
    void loadLists();
  };

  return (
    <div className="songs-picker">
      {error && <p className="status-error">{error}</p>}
      <div className="songs-find">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a saved song: its title, who wrote it, or a line of it" autoFocus aria-label="Find a song" />
        <button className="pill-btn" onClick={() => setEditing("new")} title="Look a song up online, or paste its words">
          + New song
        </button>
      </div>
      <div className="songs-cols">
        <div className="songs-col">
          <div className="songs-h-row">
            <h4 className="songs-h">Your saved songs</h4>
            <select value={sort} onChange={(e) => setSort(e.target.value as "az" | "new")} aria-label="Sort the songs" title="Sort the songs">
              <option value="az">A to Z</option>
              <option value="new">Newest first</option>
            </select>
          </div>
          <ul className="songs-list" aria-label="Your saved songs">
            {rows === null && <li className="muted">Looking…</li>}
            {rows?.length === 0 && (
              <li className="muted">
                {query.trim() ? "No saved song matches. " : "No songs saved yet. "}
                <button className="link-btn" onClick={() => setEditing("new")}>
                  {query.trim() ? `Look up “${query.trim()}” online` : "Add one"}
                </button>
                : the words are found for you, or pasted once, and kept for every weekend after.
              </li>
            )}
            {sorted?.map((s) => (
              <li key={s.id} className={count(s.id) ? "on" : undefined}>
                <div className="songs-row">
                  <span className="songs-row-text">
                    <strong>{s.title}</strong>
                    <span className="muted">{[s.author, s.first].filter(Boolean).join(" · ")}</span>
                  </span>
                  <button className={count(s.id) ? "outline-btn" : "pill-btn"} onClick={() => void add(s.id)} title={count(s.id) ? "It is on the list: add it again" : "Put it on today's list"}>
                    {count(s.id) ? "✓ Added" : "+ Add"}
                  </button>
                  <button className="text-btn" onClick={() => void edit(s.id)} title="See or change its words" aria-label={`Change the words of ${s.title}`}>
                    Words
                  </button>
                  <button className="text-btn" onClick={() => void remove(s)} title="Remove it from your saved songs" aria-label={`Remove ${s.title}`}>
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="songs-col songs-set">
          <div className="songs-h-row">
            <h4 className="songs-h">Today's list{picked.length ? ` · ${picked.length} song${picked.length === 1 ? "" : "s"} · ${slides.length} slides` : ""}</h4>
            <button
              className="link-btn"
              onClick={() => {
                setShowLists((v) => !v);
                if (!showLists) void loadLists();
              }}
            >
              {showLists ? "Hide saved lists" : "Saved lists…"}
            </button>
          </div>
          {showLists && (
            <ul className="songs-lists" aria-label="Saved lists">
              {lists === null && <li className="muted">Looking…</li>}
              {lists?.length === 0 && <li className="muted">No lists saved yet. Choose songs, then save the list with a name and a date.</li>}
              {lists?.map((l) => (
                <li key={l.deck.id}>
                  <span className="songs-list-date">{l.date || "no date"}</span>
                  <strong>{l.deck.title}</strong>
                  <span className="muted">{l.count} song{l.count === 1 ? "" : "s"}</span>
                  <button className="pill-btn" onClick={() => void openList(l.deck)}>
                    Open
                  </button>
                  <button className="text-btn" onClick={() => void deleteList(l.deck)} aria-label={`Delete ${l.deck.title}`} title="Delete this saved list">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {picked.length === 0 ? (
            <p className="songs-empty">
              <span aria-hidden>←</span> Choose songs from your saved ones with <strong>+ Add</strong>, in the order you will sing them. A song you look up or add is put on the list for you.
            </p>
          ) : (
            <>
              <ol className="songs-set-list">
                {picked.map((x, i) => (
                  <li key={i}>
                    <div className="songs-set-row">
                      <b>{i + 1}</b>
                      <span className="songs-set-title">
                        <strong>{x.song.title}</strong>
                        <button className="link-btn" onClick={() => setOpen(open === i ? null : i)}>
                          {open === i ? "Done with the order" : `${x.order.length} parts · change the order`}
                        </button>
                      </span>
                      <button className="text-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move it earlier" title="Earlier">
                        ▲
                      </button>
                      <button className="text-btn" onClick={() => move(i, 1)} disabled={i === picked.length - 1} aria-label="Move it later" title="Later">
                        ▼
                      </button>
                      <button className="text-btn" onClick={() => setPicked((p) => p.filter((_, k) => k !== i))} aria-label={`Take ${x.song.title} off the list`} title="Take it off the list">
                        ×
                      </button>
                    </div>
                    {open === i && (
                      <div className="songs-order-edit">
                        <div className="songs-order" role="group" aria-label={`The order ${x.song.title} is sung in today`}>
                          <span className="muted">Sung:</span>
                          {x.order.map((at, n) => (
                            <span key={n} className="songs-chip">
                              {x.song.sections[at]?.label}
                              <button onClick={() => setOrder(i, x.order.filter((_, k) => k !== n))} aria-label={`Leave out ${x.song.sections[at]?.label}`} title="Leave this out">
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                        <div className="songs-order" role="group" aria-label="Add a part to the order">
                          <span className="muted">Add:</span>
                          {x.song.sections.map((sec, at) => (
                            <button key={at} className="sf-chip" onClick={() => setOrder(i, [...x.order, at])}>
                              + {sec.label}
                            </button>
                          ))}
                          <button className="link-btn" onClick={() => setOrder(i, x.song.sections.map((_, k) => k))}>
                            each once
                          </button>
                          <button className="link-btn" onClick={() => setOrder(i, x.song.arrangement)}>
                            as saved
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              <label className="sb-inline">
                <span className="muted">Lines on a slide</span>
                <select value={perSlide} onChange={(e) => setPerSlide(Number(e.target.value))}>
                  {[2, 3, 4, 6, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sb-inline" title="Each song starts with a slide of its own showing its name; the slides after it are that song">
                <input type="checkbox" checked={titles} onChange={(e) => setTitles(e.target.checked)} />
                <span className="muted">A title slide for each song</span>
              </label>
              <div className="songs-save">
                <input value={listName} onChange={(e) => setListName(e.target.value)} placeholder="Name this list, e.g. Sunday morning" aria-label="Name for this list" />
                <input type="date" value={listDate} onChange={(e) => setListDate(e.target.value)} aria-label="The date it is for" />
                <button className="outline-btn" onClick={() => void saveList(false)} title="Keep this selection of songs, in this order, under that name and date">
                  {listId ? "Save changes" : "Save this list"}
                </button>
                {listId ? (
                  <button className="link-btn" onClick={() => void saveList(true)}>
                    Save as a new list
                  </button>
                ) : null}
              </div>
              {listNote && <p className="status-ok">{listNote}</p>}
              <div className="songs-actions">
                {showNow ? (
                  <>
                    <button className="pill-btn" onClick={() => onUse(slides, picked.map((x) => x.song), true)} disabled={slides.length === 0}>
                      Show now
                    </button>
                    <button className="outline-btn" onClick={() => onUse(slides, picked.map((x) => x.song), false)} disabled={slides.length === 0}>
                      Add after this slide
                    </button>
                  </>
                ) : (
                  <button className="pill-btn" onClick={() => onUse(slides, picked.map((x) => x.song), false)} disabled={slides.length === 0}>
                    Put {picked.length === 1 ? "this song" : `these ${picked.length} songs`} on the slides
                  </button>
                )}
                {onClose && (
                  <button className="text-btn" onClick={onClose}>
                    Close
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {editing && (
        <SongEditor
          song={editing === "new" ? (query.trim() ? { id: 0, title: query.trim(), author: "", ccli: "", sections: [], arrangement: [] } : null) : editing}
          autoLookup={editing === "new" && !!query.trim()}
          onSaved={saved}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** Your saved songs down the side of the music page, there from the start: search them, sort them, and press + Add to put
 * a song on the end of the slides (with its name first, if ticked). A new song can be looked up or pasted from here too. */
export function SongSidebar({ onAdd, onArrange }: { onAdd: (slides: SlideSpec[], song: SongData) => void; onArrange: () => void }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SongRow[] | null>(null);
  const [sort, setSort] = useState<"az" | "new">("az");
  const [titles, setTitles] = useState(true);
  const [perSlide, setPerSlide] = useState(4);
  const [editing, setEditing] = useState<SongData | null | "new">(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<number, number>>({});
  const [top, setTop] = useState(false);
  const fileIn = useRef<HTMLInputElement>(null);

  /** Every saved song in one file, to copy to another computer (the church's): the words go with it, nothing is put in the app. */
  const exportSongs = async () => {
    setError(null);
    try {
      const list = await api.songSearch("");
      const rows = (await Promise.all(list.map((r) => api.songGet(r.id)))).filter((r): r is SongRow => !!r);
      if (rows.length === 0) return setError("There are no saved songs to put in a file yet.");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(makeSongsFile(rows), null, 1)], { type: "application/json" }));
      a.download = `My songs ${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 15000);
      setNote(`${rows.length} song${rows.length === 1 ? "" : "s"} put in a file (look in your Downloads).`);
      window.setTimeout(() => setNote(null), 8000);
    } catch (e) {
      setError(String(e));
    }
  };
  /** Songs from a file made by "Songs to a file": added to the library; one with the same title and writer is updated, not doubled. */
  const importSongs = async (f: File) => {
    setError(null);
    const got = readSongsFile(await f.text());
    if ("error" in got) return setError(got.error);
    try {
      for (const s of got.songs) await api.songSave({ id: 0, title: s.title, author: s.author, ccli: s.ccli, body: s.body });
      void load("");
      setNote(`${got.songs.length} song${got.songs.length === 1 ? "" : "s"} loaded from the file.`);
      window.setTimeout(() => setNote(null), 8000);
    } catch (e) {
      setError(String(e));
    }
  };

  const load = (q: string) =>
    api
      .songSearch(q)
      .then(setRows)
      .catch((e) => (setRows([]), setError(String(e))));
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api
        .songSearch(query)
        .then((r) => live && setRows(r))
        .catch((e) => live && (setRows([]), setError(String(e))));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const sorted = rows && [...rows].sort((a, b) => (sort === "az" ? a.title.localeCompare(b.title) : (b.updated_at ?? "").localeCompare(a.updated_at ?? "") || a.title.localeCompare(b.title)));

  const add = async (id: number) => {
    setError(null);
    try {
      const row = await api.songGet(id);
      if (!row) return;
      const song = songOf(row);
      const slides = songSlides(song, perSlide, titles);
      onAdd(slides, song);
      setAdded((a) => ({ ...a, [id]: (a[id] ?? 0) + 1 }));
      setNote(`${song.title} is on the slides (${slides.length}).`);
      window.setTimeout(() => setNote(null), 5000);
    } catch (e) {
      setError(String(e));
    }
  };
  const edit = async (id: number) => {
    const row = await api.songGet(id).catch(() => null);
    if (row) setEditing(songOf(row));
  };

  return (
    <aside className="song-side" aria-label="Your saved songs">
      <div className="song-side-head">
        <strong>Your songs</strong>
        <span className="muted">{rows ? rows.length : ""}</span>
      </div>
      <div className="song-side-tools">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a song…" aria-label="Find a saved song" />
        <select value={sort} onChange={(e) => setSort(e.target.value as "az" | "new")} aria-label="Sort the songs" title="Sort the songs">
          <option value="az">A to Z</option>
          <option value="new">Newest</option>
        </select>
      </div>
      {error && <p className="status-error">{error}</p>}
      {note && <p className="status-ok song-side-note">{note}</p>}
      <ul className="song-side-list">
        {rows === null && <li className="muted">Looking…</li>}
        {rows?.length === 0 && (
          <li className="muted">
            {query.trim() ? `No saved song matches “${query.trim()}”.` : "No songs saved yet."}{" "}
            <button className="link-btn" onClick={() => setEditing("new")}>
              {query.trim() ? `Look up “${query.trim()}” online` : "Add the first one"}
            </button>
          </li>
        )}
        {sorted?.map((s) => (
          <li key={s.id}>
            <span className="song-side-text">
              <strong>{s.title}</strong>
              <span className="muted">{[s.author, s.first].filter(Boolean).join(" · ")}</span>
            </span>
            <button className={added[s.id] ? "outline-btn" : "pill-btn"} onClick={() => void add(s.id)} title={added[s.id] ? "It is on the slides: press to add it again" : "Put this song on the end of the slides"}>
              {added[s.id] ? "✓ Added" : "+ Add"}
            </button>
            <button className="text-btn" onClick={() => void edit(s.id)} aria-label={`See or change the words of ${s.title}`} title="See or change its words">
              Words
            </button>
          </li>
        ))}
      </ul>
      <div className="song-side-foot">
        <button className="outline-btn" onClick={() => setEditing("new")} title="Look a song up online, or paste its words">
          + New song
        </button>
        <button className="outline-btn" onClick={onArrange} title="Choose several songs, set their order, and keep the list with a name and a date">
          Arrange a list…
        </button>
        <button className="outline-btn" onClick={() => setTop(true)} title="The Top 100 worship songs chart: look each one up, check the words, and keep it in your songs; update the list to see what is new">
          Worship Top 100…
        </button>
        <span className="song-side-files">
          <button className="text-btn" onClick={() => void exportSongs()} title="Puts every saved song, words and all, in one file to copy to another computer">
            Songs to a file
          </button>
          <button className="text-btn" onClick={() => fileIn.current?.click()} title="Adds the songs from a file made on another computer (a song already here is updated, not doubled)">
            Songs from a file…
          </button>
        </span>
        <input
          ref={fileIn}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importSongs(f).catch((x) => setError(String(x)));
          }}
        />
        <label className="sb-inline" title="Each song starts with a slide showing its name">
          <input type="checkbox" checked={titles} onChange={(e) => setTitles(e.target.checked)} />
          <span className="muted">A title slide for each song</span>
        </label>
        <label className="sb-inline">
          <span className="muted">Lines on a slide</span>
          <select value={perSlide} onChange={(e) => setPerSlide(Number(e.target.value))}>
            {[2, 3, 4, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {editing && (
        <SongEditor
          song={editing === "new" ? (query.trim() ? { id: 0, title: query.trim(), author: "", ccli: "", sections: [], arrangement: [] } : null) : editing}
          autoLookup={editing === "new" && !!query.trim()}
          onSaved={(song) => {
            setEditing(null);
            setQuery("");
            void load("");
            // a song just looked up or added goes straight on the slides, as the + Add would
            onAdd(songSlides(song, perSlide, titles), song);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {top && (
        <WorshipTop100Dialog
          onClose={() => setTop(false)}
          onSaved={() => {
            setQuery("");
            void load("");
          }}
        />
      )}
    </aside>
  );
}

/** The Top 100 worship songs, as a list to work down: the name and the artist are here, the words are not.
 * "Look up and check" fetches the words of one song, puts them where they can be checked, and keeps the song in the library
 * when it is saved; the next song then opens by itself (untick to stop). "Update the list" reads the chart again (names only)
 * and marks what is new. Green: kept, so it has words. Orange: new on the chart. The church shows the words under its own licence. */
export function WorshipTop100Dialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  /** the saved songs: normalized title -> saved id */
  const [saved, setSaved] = useState<Map<string, number> | null>(null);
  const [stored, setStored] = useState<StoredSong[]>(() => loadList().songs);
  const [updated, setUpdated] = useState<string | null>(() => loadList().updated);
  const [show, setShow] = useState<"todo" | "all" | "done" | "new">("todo");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<TopSong | SongData | null>(null);
  const [keepGoing, setKeepGoing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const refresh = async () => {
    try {
      const rows = await api.songSearch("");
      const m = new Map<string, number>();
      rows.forEach((r) => m.set(normTitle(r.title), r.id));
      setSaved(m);
      return m;
    } catch (e) {
      setError(String(e));
      setSaved(new Map());
      return new Map<string, number>();
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !editing && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, editing]);

  const list = useMemo(() => toTopSongs(stored), [stored]);
  const isDone = (s: TopSong) => !!saved?.has(normTitle(s.title));
  /** a song that has dropped off the chart is shown only if its words are kept */
  const visible = list.filter((s) => s.status !== "dropped" || isDone(s));
  const onChart = list.filter((s) => s.status !== "dropped").length;
  const done = saved ? list.filter((s) => s.status !== "dropped" && isDone(s)).length : 0;
  const fresh = list.filter((s) => s.status === "new" && !isDone(s)).length;
  const q = query.trim().toLowerCase();
  const shown = visible.filter((s) => {
    const match = show === "all" || (show === "todo" && !isDone(s) && s.status !== "dropped") || (show === "done" && isDone(s)) || (show === "new" && s.status === "new");
    return match && (!q || `${s.title} ${s.artists}`.toLowerCase().includes(q));
  });

  /** Reads the chart again (names and artists only) and marks what is new and what has dropped off. */
  const update = async () => {
    setError(null);
    setNote(null);
    setUpdating(true);
    try {
      const chart = await api.chartTopSongs(new Date().getFullYear());
      const merged = mergeChart(stored, chart.songs, new Date().toISOString().slice(0, 10));
      const before = new Set(stored.map((s) => normTitle(s.listed)));
      const added = merged.filter((s) => s.status === "new" && !before.has(normTitle(s.listed))).length;
      const gone = merged.filter((s) => s.status === "dropped" && stored.find((o) => normTitle(o.listed) === normTitle(s.listed))?.status !== "dropped").length;
      saveList(merged, chart.updated);
      setStored(merged);
      setUpdated(chart.updated);
      setNote(`The ${chart.year} list (changed ${chart.updated.slice(0, 10)}): ${added === 0 ? "nothing new" : `${added} new`}${gone ? `, ${gone} off the chart` : ""}.`);
    } catch (e) {
      setError(`Couldn't update the list: ${String(e)} The list you have still works.`);
    } finally {
      setUpdating(false);
    }
  };
  const clearMarks = () => {
    const next = clearNew(stored);
    setStored(next);
    saveList(next, updated ?? "");
  };

  const seeWords = async (s: TopSong) => {
    const id = saved?.get(normTitle(s.title));
    const row = id ? await api.songGet(id).catch(() => null) : null;
    if (row) setEditing(songOf(row));
  };
  const nextAfter = (s: TopSong, now: Map<string, number>) => list.find((t) => t.status !== "dropped" && t.rank > s.rank && !now.has(normTitle(t.title))) ?? null;

  return (
    <div className="mp-backdrop" role="dialog" aria-modal="true" aria-label="Worship Top 100" {...backdrop(onClose)}>
      <div className="mp songs-dialog top100" onClick={(e) => e.stopPropagation()}>
        <div className="mp-head">
          <strong>Worship Top 100</strong>
          <span className="muted">{done} of {onChart} kept</span>
          <button className="text-btn" onClick={onClose} aria-label="Close">
            <CloseIcon size={14} />
          </button>
        </div>
        {error && <p className="status-error">{error}</p>}
        {note && <p className="status-ok">{note}</p>}
        <p className="search-hint">
          The names and artists from the PraiseCharts chart of the worship songs most churches use this year{updated ? ` (changed ${updated.slice(0, 10)})` : " (the list that came with the app, 23 October 2026)"}. The words are not kept in the app: press <em>Look up and
          check</em>, read what comes back (it can have mistakes), and save it; the next one opens. The church shows the words under its own CCLI licence.
        </p>
        <div className="top100-tools">
          <button className="pill-btn" onClick={() => void update()} disabled={updating} title="Reads the chart again (names and artists only) and marks the songs that are new">
            {updating ? "Reading the chart…" : fresh > 0 ? `Update the list (${fresh} new)` : "Update the list"}
          </button>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a song or an artist…" aria-label="Find a song in the list" />
          <select value={show} onChange={(e) => setShow(e.target.value as "todo" | "all" | "done" | "new")} aria-label="Which songs to show">
            <option value="todo">Without words yet</option>
            <option value="all">All</option>
            <option value="done">Kept (with words)</option>
            <option value="new">New on the chart</option>
          </select>
          <label className="sb-inline" title="After a song is saved, the next one without words opens at once">
            <input type="checkbox" checked={keepGoing} onChange={(e) => setKeepGoing(e.target.checked)} />
            <span className="muted">Open the next one after saving</span>
          </label>
        </div>
        <p className="top100-legend">
          <span className="top100-dot kept" /> kept, has words <span className="top100-dot new" /> new on the chart <span className="top100-dot" /> no words yet <span className="top100-dot dropped" /> off the chart now
          {stored.some((s) => s.status === "new") && (
            <button className="text-btn" onClick={clearMarks} title="Takes the New marks off every song">
              Clear the New marks
            </button>
          )}
        </p>
        <ol className="top100-list">
          {saved === null && <li className="muted">Looking…</li>}
          {saved && shown.length === 0 && <li className="muted">{show === "todo" && !q ? "Every song on the list has its words. 🎉" : "Nothing matches."}</li>}
          {shown.map((s) => (
            <li key={`${s.rank}-${s.listed}`} className={`${isDone(s) ? "kept" : s.status}`}>
              <span className="top100-rank">{s.rank || "–"}</span>
              <span className="top100-text">
                <strong>{s.title}</strong>
                <span className="muted">{s.artists.length > 80 ? `${s.artists.slice(0, 80)}…` : s.artists}</span>
              </span>
              {s.status === "new" && !isDone(s) && <span className="top100-badge">New</span>}
              {s.status === "dropped" && <span className="top100-off">off the chart</span>}
              {isDone(s) ? (
                <>
                  <span className="top100-kept">✓ Kept</span>
                  <button className="text-btn" onClick={() => void seeWords(s)}>
                    Words
                  </button>
                </>
              ) : (
                <button className="pill-btn" onClick={() => setEditing(s)} disabled={!saved}>
                  Look up and check
                </button>
              )}
            </li>
          ))}
        </ol>
        {editing && (
          <SongEditor
            key={"rank" in editing ? `${editing.rank}-${editing.listed}` : editing.id}
            song={"rank" in editing ? { id: 0, title: editing.title, author: editing.artist, ccli: "", sections: [], arrangement: [] } : editing}
            autoLookup={"rank" in editing}
            autoPick={"rank" in editing}
            onSaved={() => {
              const was = editing;
              onSaved();
              void refresh().then((now) => {
                if (keepGoing && "rank" in was) setEditing(nextAfter(was, now));
                else setEditing(null);
              });
            }}
            onClose={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  );
}

/** The song picker in a window of its own. */
export function SongPickerDialog({ onUse, onClose }: { onUse: (slides: SlideSpec[], songs: SongData[], show: boolean) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="mp-backdrop" role="dialog" aria-modal="true" aria-label="Choose the songs" {...backdrop(onClose)}>
      <div className="mp songs-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="mp-head">
          <strong>Choose the songs</strong>
          <button className="text-btn" onClick={onClose} aria-label="Close">
            <CloseIcon size={14} />
          </button>
        </div>
        <SongPicker onUse={onUse} />
      </div>
    </div>
  );
}
