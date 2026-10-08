import { useEffect, useMemo, useRef, useState } from "react";
import { api, BookInfo, SavedSermon, Version } from "../api";
import {
  arrange,
  gather,
  GROUPS,
  Material,
  newId,
  passagesUsed,
  readingMinutes,
  SermonBody,
  sermonBlocks,
  SermonItem,
  SermonShape,
  SHAPES,
  suggestFromOther,
  testamentBalance,
} from "../sermon";
import { plainText } from "./RichText";
import { SheetOutput } from "./SheetOutput";
import { ChevronLeftIcon, CloseIcon, GripIcon } from "./icons";

interface Props {
  versionCode: string;
  versions: Version[];
  books: BookInfo[];
  onJump: (book: string, chapter: number, verse: number) => void;
  onClose: () => void;
}

type Tab = "gather" | "arrange" | "document" | "saved";

interface Work {
  id: number;
  title: string;
  series: string;
  preachedOn: string;
  query: string;
  topics: string[];
  shape: SermonShape;
  blankLines: number;
  gathered: Material[];
  items: SermonItem[];
  tab: Tab;
}

const EMPTY: Work = { id: 0, title: "", series: "", preachedOn: "", query: "", topics: [], shape: "points", blankLines: 4, gathered: [], items: [], tab: "gather" };

// What's being worked on survives leaving the builder to look something up in the Bible
// (for this session; "Save" keeps it for good).
let draft: Work | null = null;

const EXAMPLES = ["healing", "faith", "sin; forgiveness", "sermon on the mount", "crucifixion; resurrection", "how do I forgive someone who hurt me"];

/** Gathers Scripture, cross-references, commentary and more on a subject, lets the
 * preacher tick and arrange what to keep, and lays it out as a document. It writes none
 * of the sermon: the preaching is the preacher's. */
export function SermonBuilder({ versionCode, versions, books, onJump, onClose }: Props) {
  const [work, setWork] = useState<Work>(() => draft ?? EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedSermon[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const dragId = useRef<string | null>(null);
  const run = useRef(0);

  useEffect(() => {
    draft = work;
  }, [work]);
  const set = (patch: Partial<Work>) => setWork((w) => ({ ...w, ...patch }));
  const loadSaved = () => api.sermonList().then(setSaved).catch(() => undefined);
  useEffect(() => {
    loadSaved();
  }, []);

  const chosen = useMemo(() => new Set(work.items.flatMap((i) => (i.type === "material" ? [i.material.key] : []))), [work.items]);
  const balance = useMemo(() => testamentBalance(work.items, books), [work.items, books]);
  const suggestion = useMemo(() => suggestFromOther(work.items, work.gathered, books), [work.items, work.gathered, books]);
  const minutes = useMemo(() => readingMinutes(work.items), [work.items]);
  const blocks = useMemo(
    () => sermonBlocks({ title: work.title, series: work.series, preachedOn: work.preachedOn, topics: work.query, blankLines: work.blankLines }, work.items, versions),
    [work.title, work.series, work.preachedOn, work.query, work.blankLines, work.items, versions],
  );

  function flash(msg: string) {
    setStatus(msg);
    window.setTimeout(() => setStatus((s) => (s === msg ? null : s)), 4000);
  }

  async function runGather(query: string) {
    const q = query.trim();
    if (!q) return;
    const id = ++run.current;
    setError(null);
    setBusy("Starting…");
    try {
      const g = await gather(q, versionCode, books, (s) => id === run.current && setBusy(`${s}…`));
      if (id !== run.current) return;
      setWork((w) => {
        // keep what is already ticked; add the new finds to what was gathered before
        const known = new Set(w.gathered.map((m) => m.key));
        const title = w.title || g.topics.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(" and ");
        return { ...w, query: q, topics: [...new Set([...w.topics, ...g.topics])], gathered: [...w.gathered, ...g.materials.filter((m) => !known.has(m.key))], title };
      });
      if (g.materials.length === 0) setError("Nothing was found for that. Try other words, or a shorter phrase.");
    } catch (e) {
      if (id === run.current) setError(String(e));
    } finally {
      if (id === run.current) setBusy(null);
    }
  }

  function toggle(m: Material) {
    setWork((w) =>
      chosen.has(m.key)
        ? { ...w, items: w.items.filter((i) => !(i.type === "material" && i.material.key === m.key)) }
        : { ...w, items: [...w.items, { id: newId(), type: "material", material: m }] },
    );
  }

  function arrangeNow(shape: SermonShape) {
    setWork((w) => {
      const picked = w.items.flatMap((i) => (i.type === "material" ? [i.material] : []));
      const notes = w.items.filter((i) => i.type === "note");
      return { ...w, shape, items: [...arrange(shape, w.topics, picked, books), ...notes] };
    });
  }

  function goArrange() {
    // the first time, lay the ticked material out in the chosen shape
    if (!work.items.some((i) => i.type === "heading") && work.items.length > 0) arrangeNow(work.shape);
    set({ tab: "arrange" });
  }

  function move(id: string, to: number) {
    setWork((w) => {
      const from = w.items.findIndex((i) => i.id === id);
      if (from < 0 || to < 0 || to >= w.items.length || from === to) return w;
      const items = [...w.items];
      const [it] = items.splice(from, 1);
      items.splice(to, 0, it);
      return { ...w, items };
    });
  }

  const edit = (id: string, text: string) => setWork((w) => ({ ...w, items: w.items.map((i) => (i.id === id && i.type !== "material" ? { ...i, text } : i)) }));
  const remove = (id: string) => setWork((w) => ({ ...w, items: w.items.filter((i) => i.id !== id) }));
  const insertAfter = (index: number, item: SermonItem) =>
    setWork((w) => {
      const items = [...w.items];
      items.splice(index + 1, 0, item);
      return { ...w, items };
    });

  async function save() {
    setError(null);
    const body: SermonBody = { shape: work.shape, blankLines: work.blankLines, items: work.items, gathered: work.gathered };
    try {
      const id = await api.sermonSave({
        id: work.id,
        title: work.title,
        series: work.series,
        preached_on: work.preachedOn,
        topics: work.topics.join("; ") || work.query,
        passages: passagesUsed(work.items),
        body: JSON.stringify(body),
        updated_at: "",
      });
      set({ id });
      flash("Sermon saved.");
      loadSaved();
    } catch (e) {
      setError(String(e));
    }
  }

  async function openSaved(id: number) {
    setError(null);
    try {
      const s = await api.sermonGet(id);
      if (!s) return;
      const body = JSON.parse(s.body) as Partial<SermonBody>;
      setWork({
        id: s.id,
        title: s.title,
        series: s.series,
        preachedOn: s.preached_on,
        query: s.topics,
        topics: s.topics.split(";").map((t) => t.trim()).filter(Boolean),
        shape: body.shape ?? "points",
        blankLines: body.blankLines ?? 4,
        gathered: body.gathered ?? [],
        items: body.items ?? [],
        tab: "arrange",
      });
    } catch (e) {
      setError(`That sermon couldn't be opened: ${e}`);
    }
  }

  async function deleteSaved(id: number) {
    setConfirmDelete(null);
    await api.sermonDelete(id).catch((e) => setError(String(e)));
    if (work.id === id) set({ id: 0 });
    loadSaved();
  }

  const series = useMemo(() => {
    const by = new Map<string, SavedSermon[]>();
    for (const s of saved) by.set(s.series, [...(by.get(s.series) ?? []), s]);
    return [...by.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0])));
  }, [saved]);
  const seriesNames = series.map(([n]) => n).filter(Boolean);

  const preview = (m: Material) => {
    const text = plainText(m.text).replace(/⟪\d+⟫/g, "");
    const isOpen = open.has(m.key);
    const long = text.length > 320;
    return (
      <>
        <span className="sermon-text">{isOpen || !long ? text : `${text.slice(0, 300).trimEnd()}…`}</span>
        {long && (
          <button
            className="link-btn sermon-more"
            onClick={() =>
              setOpen((s) => {
                const n = new Set(s);
                if (n.has(m.key)) n.delete(m.key);
                else n.add(m.key);
                return n;
              })
            }
          >
            {isOpen ? "Show less" : "Show all"}
          </button>
        )}
      </>
    );
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: "gather", label: "1 · Gather" },
    { key: "arrange", label: `2 · Arrange${work.items.length ? ` (${work.items.filter((i) => i.type === "material").length})` : ""}` },
    { key: "document", label: "3 · Document" },
    { key: "saved", label: `My sermons${saved.length ? ` (${saved.length})` : ""}` },
  ];

  return (
    <article className="sermon-builder">
      <div className="book-main-head">
        <h2>Sermon builder</h2>
        <button className="text-btn" onClick={onClose} title="Back to the Bible text (your work here is kept)">
          <ChevronLeftIcon size={14} /> Back to the Bible
        </button>
      </div>
      <p className="search-hint" style={{ marginTop: 0 }}>
        Type what the sermon is about. The app gathers Scripture, cross-references, commentary and more; you tick what to keep,
        arrange it, and get a document to preach from. It gathers and lays out — the sermon itself is yours to write.
      </p>

      <div className="sermon-meta">
        <label className="sermon-title">
          <span className="muted">Title</span>
          <input value={work.title} onChange={(e) => set({ title: e.target.value })} placeholder="Sermon title" />
        </label>
        <label>
          <span className="muted">Series</span>
          <input value={work.series} onChange={(e) => set({ series: e.target.value })} placeholder="(none)" list="sermon-series" />
          <datalist id="sermon-series">
            {seriesNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </label>
        <label>
          <span className="muted">Date preached</span>
          <input type="date" value={work.preachedOn} onChange={(e) => set({ preachedOn: e.target.value })} />
        </label>
        <div className="sermon-meta-actions">
          <button className="pill-btn" onClick={save} disabled={!work.title.trim() || (work.items.length === 0 && work.gathered.length === 0)}>
            {work.id ? "Save changes" : "Save"}
          </button>
          <button
            className="text-btn"
            onClick={() => {
              run.current++;
              setBusy(null);
              setError(null);
              setWork(EMPTY);
            }}
            title="Start a new sermon (save this one first if you want to keep it)"
          >
            New
          </button>
        </div>
      </div>
      {status && <p className="study-status">{status}</p>}
      {error && <p className="status-error">{error}</p>}

      <div className="mode-toggle" role="tablist" aria-label="Sermon builder steps">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={work.tab === t.key} className={work.tab === t.key ? "active" : ""} onClick={() => (t.key === "arrange" ? goArrange() : set({ tab: t.key }))}>
            {t.label}
          </button>
        ))}
      </div>

      {work.tab === "gather" && (
        <>
          <form
            className="sermon-ask"
            onSubmit={(e) => {
              e.preventDefault();
              runGather(work.query);
            }}
          >
            <input
              value={work.query}
              onChange={(e) => set({ query: e.target.value })}
              placeholder="A topic, several topics separated by ; or a sentence"
              aria-label="What the sermon is about"
              autoFocus={work.gathered.length === 0}
            />
            <button className="pill-btn" type="submit" disabled={!!busy || !work.query.trim()}>
              {busy ? "Gathering…" : work.gathered.length ? "Gather more" : "Gather"}
            </button>
          </form>
          {work.gathered.length === 0 && !busy && (
            <p className="sermon-examples muted">
              For example:{" "}
              {EXAMPLES.map((x) => (
                <button
                  key={x}
                  className="note-tag"
                  onClick={() => {
                    set({ query: x });
                    runGather(x);
                  }}
                >
                  {x}
                </button>
              ))}
            </p>
          )}
          {busy && <p className="muted">{busy}</p>}
          {work.gathered.length > 0 && (
            <p className="search-hint">
              {work.gathered.length} items found, {chosen.size} ticked. Tick what you want to keep, then go to{" "}
              <button className="link-btn" onClick={goArrange}>
                Arrange
              </button>
              . Typing another subject and pressing <em>Gather more</em> adds to this list.
            </p>
          )}
          {GROUPS.map((g) => {
            const list = work.gathered.filter((m) => m.kind === g.kind);
            if (list.length === 0) return null;
            return (
              <section key={g.kind} className="sermon-group">
                <h4 className="section-label">
                  {g.label} <span className="tab-count">{list.length}</span>
                </h4>
                <p className="sermon-group-about muted">{g.about}</p>
                <ul className="sermon-list">
                  {list.map((m) => (
                    <li key={m.key} className={chosen.has(m.key) ? "ticked" : undefined}>
                      <label className="sermon-tick">
                        <input type="checkbox" checked={chosen.has(m.key)} onChange={() => toggle(m)} />
                        <span className="sermon-item-title">{m.title}</span>
                      </label>
                      {m.source && <span className="votes">{m.source}</span>}
                      {work.topics.length > 1 && <span className="note-tag small">{m.topic}</span>}
                      {m.ref && (
                        <button className="link-btn sermon-open" onClick={() => onJump(m.ref!.book, m.ref!.chapter, m.ref!.verse)} title="Open this passage in the Bible (your work here is kept)">
                          Open
                        </button>
                      )}
                      <div className="sermon-body">{preview(m)}</div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}

      {work.tab === "arrange" && (
        <>
          <div className="sermon-shape">
            <label>
              <span className="muted">Shape</span>
              <select value={work.shape} onChange={(e) => set({ shape: e.target.value as SermonShape })}>
                {SHAPES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="outline-btn" onClick={() => arrangeNow(work.shape)} disabled={work.items.length === 0} title="Lay the ticked material out again in this shape. Your own notes are kept, at the end.">
              Lay out in this shape
            </button>
            <span className="muted">{SHAPES.find((s) => s.key === work.shape)?.about}</span>
          </div>
          <div className="sermon-facts">
            <span title="Scripture passages from each testament">
              Old Testament <strong>{balance.ot}</strong> · New Testament <strong>{balance.nt}</strong>
            </span>
            <span title="Time to read the gathered material and your notes aloud. What you add while preaching comes on top.">
              About <strong>{minutes}</strong> min of material to read aloud
            </span>
          </div>
          {suggestion && (
            <p className="sermon-suggest">
              Everything ticked is from the {balance.ot === 0 ? "New" : "Old"} Testament. From the {balance.ot === 0 ? "Old" : "New"} Testament:{" "}
              <strong>{suggestion.title}</strong> — “{plainText(suggestion.text).slice(0, 140)}
              {suggestion.text.length > 140 ? "…" : ""}”{" "}
              <button className="link-btn" onClick={() => toggle(suggestion)}>
                Add it
              </button>
            </p>
          )}
          {work.items.length === 0 && (
            <p className="muted">
              Nothing is ticked yet. Go to{" "}
              <button className="link-btn" onClick={() => set({ tab: "gather" })}>
                Gather
              </button>{" "}
              and tick what you want to keep.
            </p>
          )}
          <ol className="sermon-arrange">
            {work.items.map((it, index) => (
              <li
                key={it.id}
                className={`sermon-row sermon-row-${it.type}`}
                draggable
                onDragStart={(e) => {
                  dragId.current = it.id;
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId.current) move(dragId.current, index);
                  dragId.current = null;
                }}
              >
                <span className="sermon-grip" title="Drag to move">
                  <GripIcon size={14} />
                </span>
                <div className="sermon-row-main">
                  {it.type === "heading" && <input className="sermon-heading-input" value={it.text} onChange={(e) => edit(it.id, e.target.value)} aria-label="Heading" />}
                  {it.type === "note" && (
                    <textarea value={it.text} onChange={(e) => edit(it.id, e.target.value)} rows={3} placeholder="Your own words: an explanation, a story, an application…" aria-label="Your note" />
                  )}
                  {it.type === "material" && (
                    <>
                      <div className="sermon-row-head">
                        <span className="basket-kind">{GROUPS.find((g) => g.kind === it.material.kind)?.label.replace(/s$/, "") ?? it.material.kind}</span>
                        <strong>{it.material.title}</strong>
                        {it.material.source && <span className="votes">{it.material.source}</span>}
                      </div>
                      <div className="sermon-body">{preview(it.material)}</div>
                    </>
                  )}
                </div>
                <span className="sermon-row-tools">
                  <button className="text-btn" onClick={() => move(it.id, index - 1)} disabled={index === 0} title="Move up" aria-label="Move up">
                    ▲
                  </button>
                  <button className="text-btn" onClick={() => move(it.id, index + 1)} disabled={index === work.items.length - 1} title="Move down" aria-label="Move down">
                    ▼
                  </button>
                  <button className="text-btn" onClick={() => insertAfter(index, { id: newId(), type: "note", text: "" })} title="Add your own note below this">
                    + Note
                  </button>
                  <button className="text-btn" onClick={() => insertAfter(index, { id: newId(), type: "heading", text: "New heading" })} title="Add a heading below this">
                    + Heading
                  </button>
                  <button className="text-btn" onClick={() => remove(it.id)} title="Take this out of the sermon" aria-label="Remove">
                    <CloseIcon size={12} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <div className="note-editor-actions">
            <button className="outline-btn" onClick={() => insertAfter(work.items.length - 1, { id: newId(), type: "heading", text: "New heading" })}>
              + Heading
            </button>
            <button className="outline-btn" onClick={() => insertAfter(work.items.length - 1, { id: newId(), type: "note", text: "" })}>
              + Your own note
            </button>
            <button className="pill-btn" onClick={() => set({ tab: "document" })} disabled={work.items.length === 0}>
              See the document
            </button>
          </div>
        </>
      )}

      {work.tab === "document" && (
        <>
          <div className="sermon-shape">
            <label>
              <span className="muted">Blank lines under each heading, for handwriting</span>
              <select value={work.blankLines} onChange={(e) => set({ blankLines: Number(e.target.value) })}>
                {[0, 2, 4, 6, 8, 12].map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "None" : n}
                  </option>
                ))}
              </select>
            </label>
            <span className="muted">Scripture is set apart from commentary, which is always named by its author.</span>
          </div>
          {work.items.length === 0 ? <p className="muted">Tick and arrange some material first.</p> : <SheetOutput blocks={blocks} title={work.title.trim() || "Sermon"} building={false} />}
        </>
      )}

      {work.tab === "saved" && (
        <>
          {saved.length === 0 && <p className="muted">No saved sermons yet. Give a sermon a title and press Save.</p>}
          {series.map(([name, list]) => (
            <section key={name || "(none)"} className="sermon-group">
              <h4 className="section-label">
                {name ? `Series: ${name}` : seriesNames.length ? "Not in a series" : "Sermons"} <span className="tab-count">{list.length}</span>
              </h4>
              {name && (
                <p className="sermon-group-about muted">
                  Passages covered so far: {[...new Set(list.flatMap((s) => s.passages.split("; ").filter(Boolean)))].join("; ") || "none yet"}
                </p>
              )}
              <ul className="sermon-list">
                {list.map((s) => (
                  <li key={s.id} className={s.id === work.id ? "ticked" : undefined}>
                    <button className="link-btn sermon-item-title" onClick={() => openSaved(s.id)}>
                      {s.title}
                    </button>
                    <span className="votes">{s.preached_on ? `preached ${s.preached_on}` : `edited ${s.updated_at.slice(0, 10)}`}</span>
                    {confirmDelete === s.id ? (
                      <>
                        <button className="text-btn danger" onClick={() => deleteSaved(s.id)}>
                          Delete
                        </button>
                        <button className="text-btn" onClick={() => setConfirmDelete(null)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <button className="text-btn" onClick={() => setConfirmDelete(s.id)}>
                        Delete
                      </button>
                    )}
                    <div className="sermon-body muted">
                      {s.topics}
                      {s.passages ? ` · ${s.passages}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="search-hint">Saved sermons are kept on this computer and are included in My Study → Export, so they move with your backup.</p>
        </>
      )}
    </article>
  );
}
