// The notices the church uses again and again (Welcome 1, 2 and 3, Bible study on Tuesdays, Birthdays, Giving...), kept
// in a library down the side of the notices page, in the order the preacher puts them: choose one to put it on today's
// notices, edit it, add one, move it up or down. Each is one slide or a few.

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { SlideSpec } from "../sermonOutputs";
import { deckBody, parseDeck } from "../service";
import { CloseIcon } from "./icons";
import { backdrop } from "../backdrop";

interface Notice {
  id: number;
  title: string;
  slides: SlideSpec[];
}

/** A few to start from, to be changed: shown only if the library is empty and the preacher asks. */
const EXAMPLES: { title: string; slides: SlideSpec[] }[] = [
  { title: "Welcome 1", slides: [{ kind: "text", title: "Welcome", body: "A warm welcome to everyone here this morning, whether it is your first time with us or you have been here for years." }] },
  { title: "Welcome 2", slides: [{ kind: "text", title: "Welcome", body: "If you are new, please say hello to someone near you. We would love you to join us for tea after the service." }] },
  { title: "Welcome 3", slides: [{ kind: "point", title: "We are glad you are here", body: "Come as you are" }] },
  { title: "Bible study", slides: [{ kind: "text", title: "Bible study", body: "Every Tuesday at [time], at [place].\nEveryone is welcome." }] },
  { title: "Birthdays", slides: [{ kind: "text", title: "Birthdays this week", body: "[Names]\nGod bless you!" }] },
  { title: "Giving and tithing", slides: [{ kind: "text", title: "Giving", body: "Your tithes and offerings may be given during the service, or by [how]." }] },
  { title: "Other notices", slides: [{ kind: "text", title: "Other notices", body: "[Notice]" }] },
];

const KINDS_WITH_WORDS = ["text", "point", "title", "scripture", "song"];

const firstWords = (slides: SlideSpec[]) =>
  slides
    .map((s) => s.body || s.title)
    .find((t) => t?.trim())
    ?.replace(/\s+/g, " ")
    .slice(0, 70) ?? "";

async function loadNotices(): Promise<Notice[]> {
  const list = await api.deckList("notice");
  const full = await Promise.all(list.map((d) => api.deckGet(d.id)));
  return full.flatMap((d) => (d ? [{ id: d.id, title: d.title, slides: parseDeck(d.body).slides }] : []));
}

/** One notice in a window: its name, and its slides (a heading and words each), to add to, change, move and take away. */
export function NoticeEditor({ notice, onSaved, onClose }: { notice: Notice | null; onSaved: (n: Notice) => void; onClose: () => void }) {
  const [title, setTitle] = useState(notice?.title ?? "");
  const [slides, setSlides] = useState<SlideSpec[]>(notice?.slides.length ? notice.slides : [{ kind: "text", title: "", body: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (i: number, patch: Partial<SlideSpec>) => setSlides((l) => l.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, d: -1 | 1) =>
    setSlides((l) => {
      const j = i + d;
      if (j < 0 || j >= l.length) return l;
      const next = [...l];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = async () => {
    setError(null);
    const name = title.trim() || slides.find((s) => s.title.trim())?.title.trim() || "";
    if (!name) return setError("Give the notice a name.");
    const kept = slides.filter((s) => s.title.trim() || s.body.trim() || s.image || s.link);
    if (kept.length === 0) return setError("Write something on at least one slide.");
    setBusy(true);
    try {
      const id = await api.deckSave({ id: notice?.id ?? 0, kind: "notice", title: name, body: deckBody(kept, null) });
      onSaved({ id, title: name, slides: kept });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mp-backdrop" role="dialog" aria-modal="true" aria-label={notice ? "Change the notice" : "Add a notice"} {...backdrop(onClose)}>
      <div className="mp notice-editor" onClick={(e) => e.stopPropagation()}>
        <div className="mp-head">
          <strong>{notice ? "Change the notice" : "A new notice"}</strong>
          <button className="text-btn" onClick={onClose} aria-label="Close">
            <CloseIcon size={14} />
          </button>
        </div>
        {error && <p className="status-error">{error}</p>}
        <label className="notice-name">
          <span className="muted">Its name in your list (only you see it)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Bible study on Tuesdays" autoFocus />
        </label>
        <ol className="notice-slides">
          {slides.map((s, i) => (
            <li key={i}>
              <div className="notice-slide-head">
                <b>Slide {i + 1}</b>
                {KINDS_WITH_WORDS.includes(s.kind) && (
                  <select value={s.kind === "point" ? "point" : "text"} onChange={(e) => set(i, { kind: e.target.value as SlideSpec["kind"] })} aria-label="How the slide is laid out">
                    <option value="text">A heading, and words</option>
                    <option value="point">A big heading, and a line under it</option>
                  </select>
                )}
                <span className="notice-slide-tools">
                  <button className="text-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move the slide earlier" title="Earlier">
                    ▲
                  </button>
                  <button className="text-btn" onClick={() => move(i, 1)} disabled={i === slides.length - 1} aria-label="Move the slide later" title="Later">
                    ▼
                  </button>
                  <button className="text-btn" onClick={() => setSlides((l) => l.filter((_, k) => k !== i))} disabled={slides.length === 1} aria-label="Take the slide away" title="Take this slide away">
                    ×
                  </button>
                </span>
              </div>
              <label>
                <span className="muted">{s.kind === "image" ? "Caption" : "Heading"}</span>
                <input value={s.title} onChange={(e) => set(i, { title: e.target.value })} placeholder="e.g. Bible study" />
              </label>
              {KINDS_WITH_WORDS.includes(s.kind) ? (
                <label>
                  <span className="muted">{s.kind === "point" ? "The line under it" : "The words"}</span>
                  <textarea value={s.body} rows={s.kind === "point" ? 2 : 4} onChange={(e) => set(i, { body: e.target.value })} placeholder="e.g. Every Tuesday at 7 pm in the hall." />
                </label>
              ) : (
                <p className="muted">A {s.kind === "image" ? "picture" : "link"} slide: change what it shows on the notices page itself.</p>
              )}
            </li>
          ))}
        </ol>
        <div className="songs-actions">
          <button className="outline-btn" onClick={() => setSlides((l) => [...l, { kind: "text", title: "", body: "" }])}>
            + Another slide
          </button>
          <span className="spacer" />
          <button className="pill-btn" onClick={() => void save()} disabled={busy}>
            {busy ? "Saving…" : "Save the notice"}
          </button>
          <button className="text-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** Your saved notices down the side of the notices page, there from the start: search them, put them in the order you
 * like, press + Add to put one on the end of today's notices, change one, add one. `reload` changes when a notice has been
 * kept from the slides, so the list shows it. */
export function NoticeSidebar({ onAdd, reload }: { onAdd: (slides: SlideSpec[], title: string) => void; reload: number }) {
  const [items, setItems] = useState<Notice[] | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"mine" | "az">("mine");
  const [editing, setEditing] = useState<Notice | null | "new">(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<number, number>>({});

  const load = () =>
    loadNotices()
      .then(setItems)
      .catch((e) => (setItems([]), setError(String(e))));
  useEffect(() => {
    void load();
  }, [reload]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (items ?? []).filter((n) => !q || `${n.title} ${n.slides.map((s) => `${s.title} ${s.body}`).join(" ")}`.toLowerCase().includes(q));
    return sort === "az" ? [...list].sort((a, b) => a.title.localeCompare(b.title)) : list;
  }, [items, query, sort]);
  // moving only makes sense in the library's own order, and with all of it showing
  const canMove = sort === "mine" && !query.trim();

  const move = async (id: number, d: -1 | 1) => {
    if (!items) return;
    const i = items.findIndex((n) => n.id === id);
    const j = i + d;
    if (i < 0 || j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
    await api.deckOrder("notice", next.map((n) => n.id)).catch((e) => setError(String(e)));
  };
  const remove = async (n: Notice) => {
    if (!window.confirm(`Take “${n.title}” out of your notices? (Notices that already use it keep their slides.)`)) return;
    await api.deckDelete(n.id).catch((e) => setError(String(e)));
    void load();
  };
  const add = (n: Notice) => {
    onAdd(n.slides.map((s) => ({ ...s })), n.title);
    setAdded((a) => ({ ...a, [n.id]: (a[n.id] ?? 0) + 1 }));
    setNote(`“${n.title}” is on the notices.`);
    window.setTimeout(() => setNote(null), 5000);
  };
  const startWithExamples = async () => {
    setError(null);
    try {
      for (const e of EXAMPLES) await api.deckSave({ id: 0, kind: "notice", title: e.title, body: deckBody(e.slides, null) });
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <aside className="song-side notice-side" aria-label="Your saved notices">
      <div className="song-side-head">
        <strong>Your notices</strong>
        <span className="muted">{items ? items.length : ""}</span>
      </div>
      <div className="song-side-tools">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a notice…" aria-label="Find a saved notice" />
        <select value={sort} onChange={(e) => setSort(e.target.value as "mine" | "az")} aria-label="Sort the notices" title="Sort the notices">
          <option value="mine">My order</option>
          <option value="az">A to Z</option>
        </select>
      </div>
      {error && <p className="status-error">{error}</p>}
      {note && <p className="status-ok song-side-note">{note}</p>}
      <ul className="song-side-list">
        {items === null && <li className="muted">Looking…</li>}
        {items?.length === 0 && (
          <li className="notice-empty muted">
            <span>No notices saved yet. Add one, or keep a slide you have made with “Keep in my notices” under it.</span>
            <button className="outline-btn" onClick={() => void startWithExamples()} title="Welcome 1, 2 and 3, Bible study, Birthdays, Giving and Other notices, for you to change">
              Start me off with some examples
            </button>
          </li>
        )}
        {items && items.length > 0 && shown.length === 0 && <li className="muted">No notice matches “{query.trim()}”.</li>}
        {shown.map((n) => (
          <li key={n.id}>
            {canMove && (
              <span className="notice-move">
                <button className="text-btn" onClick={() => void move(n.id, -1)} disabled={items?.[0]?.id === n.id} aria-label={`Move ${n.title} up the list`} title="Up the list">
                  ▲
                </button>
                <button className="text-btn" onClick={() => void move(n.id, 1)} disabled={items?.[items.length - 1]?.id === n.id} aria-label={`Move ${n.title} down the list`} title="Down the list">
                  ▼
                </button>
              </span>
            )}
            <span className="song-side-text">
              <strong>{n.title}</strong>
              <span className="muted">
                {n.slides.length > 1 ? `${n.slides.length} slides · ` : ""}
                {firstWords(n.slides)}
              </span>
            </span>
            <button className={added[n.id] ? "outline-btn" : "pill-btn"} onClick={() => add(n)} title={added[n.id] ? "It is on the notices: press to add it again" : "Put this notice on the end of today's notices"}>
              {added[n.id] ? "✓ Added" : "+ Add"}
            </button>
            <button className="text-btn" onClick={() => setEditing(n)} aria-label={`Change ${n.title}`} title="Change this notice">
              Edit
            </button>
            <button className="text-btn" onClick={() => void remove(n)} aria-label={`Take ${n.title} away`} title="Take it out of your notices">
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="song-side-foot">
        <button className="outline-btn" onClick={() => setEditing("new")}>
          + New notice
        </button>
        <span className="muted">The order here is the order you keep them in. Add the ones for today and they go on the end of the slides; move them there if you like.</span>
      </div>
      {editing && (
        <NoticeEditor
          notice={editing === "new" ? null : editing}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </aside>
  );
}

/** Keeps a slide you have made as a notice in the library. */
export async function keepAsNotice(slide: SlideSpec): Promise<string> {
  const { from: _f, pinned: _p, ...rest } = slide;
  const title = slide.title.trim() || slide.body.trim().slice(0, 40) || "Notice";
  await api.deckSave({ id: 0, kind: "notice", title, body: deckBody([rest], null) });
  return title;
}
