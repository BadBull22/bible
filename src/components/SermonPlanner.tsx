import { useMemo, useState } from "react";
import { api, BookInfo, SavedSermon, SermonStage } from "../api";
import { appointedOn, dayName } from "../lectionary";
import { LectionaryView } from "./LectionaryView";
import { SermonSearch } from "./SermonSearch";

interface Props {
  saved: SavedSermon[];
  books: BookInfo[];
  chapterCounts: Record<string, number>;
  /** the sermon open in the builder (0 = none) */
  currentId: number;
  onOpen: (id: number) => void;
  onChanged: () => void;
  /** open a sermon just planned from the lectionary and gather its readings */
  onPrepare: (id: number, topics: string) => void;
}

export const STAGES: { key: SermonStage; label: string }[] = [
  { key: "idea", label: "Idea" },
  { key: "research", label: "Researching" },
  { key: "draft", label: "Drafting" },
  { key: "ready", label: "Ready" },
  { key: "preached", label: "Preached" },
];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const nice = (d: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

/** The preacher's sermons: by series or on a calendar, filtered by stage; and a planner that
 * lays a book out as a dated series, a passage a week. */
export function SermonPlanner({ saved, books, chapterCounts, currentId, onOpen, onChanged, onPrepare }: Props) {
  const [view, setView] = useState<"find" | "list" | "calendar" | "lectionary" | "plan">("list");
  const [stage, setStage] = useState<SermonStage | "all">("all");
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const shown = saved.filter((s) => stage === "all" || s.stage === stage);
  const series = useMemo(() => {
    const by = new Map<string, SavedSermon[]>();
    for (const s of shown) by.set(s.series, [...(by.get(s.series) ?? []), s]);
    for (const list of by.values()) list.sort((a, b) => (a.preached_on || "9999").localeCompare(b.preached_on || "9999"));
    return [...by.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0])));
  }, [shown]);

  async function remove(id: number) {
    setConfirmDelete(null);
    await api.sermonDelete(id).catch((e) => setError(String(e)));
    onChanged();
  }

  const row = (s: SavedSermon) => (
    <li key={s.id} className={s.id === currentId ? "ticked" : undefined}>
      <button className="link-btn sermon-item-title" onClick={() => onOpen(s.id)}>
        {s.title}
      </button>
      <span className={`stage-chip stage-${s.stage}`}>{STAGES.find((x) => x.key === s.stage)?.label ?? s.stage}</span>
      <span className="votes">
        {s.preached_on ? nice(s.preached_on) : `edited ${s.updated_at.slice(0, 10)}`}
        {s.venue ? ` · ${s.venue}` : ""}
      </span>
      {confirmDelete === s.id ? (
        <>
          <button className="text-btn danger" onClick={() => remove(s.id)}>
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
  );

  // the month on the calendar, Monday first
  const days = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(first.getDate() - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [month]);

  return (
    <div className="sermon-planner">
      <div className="sermon-shape">
        <div className="mode-toggle" role="tablist" aria-label="How to show the sermons">
          {(
            [
              ["find", "Find a sermon"],
              ["list", "By series"],
              ["calendar", "Calendar"],
              ["lectionary", "Lectionary"],
              ["plan", "Plan a series"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={view === k} className={view === k ? "active" : ""} onClick={() => setView(k)}>
              {label}
            </button>
          ))}
        </div>
        {(view === "list" || view === "calendar") && (
          <div className="stage-filter" role="group" aria-label="Show sermons at a stage">
            <button className={stage === "all" ? "note-tag on" : "note-tag"} onClick={() => setStage("all")}>
              All {saved.length}
            </button>
            {STAGES.map((s) => {
              const n = saved.filter((x) => x.stage === s.key).length;
              return (
                <button key={s.key} className={`note-tag stage-${s.key}${stage === s.key ? " on" : ""}`} onClick={() => setStage(s.key)} disabled={n === 0}>
                  {s.label} {n}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {error && <p className="status-error">{error}</p>}

      {view === "find" && <SermonSearch saved={saved} books={books} stages={STAGES} currentId={currentId} onOpen={onOpen} />}

      {view === "list" && (
        <>
          {saved.length === 0 && <p className="muted">No saved sermons yet. Give a sermon a title and press Save, or plan a series.</p>}
          {series.map(([name, list]) => (
            <section key={name || "(none)"} className="sermon-group">
              <h4 className="section-label">
                {name ? `Series: ${name}` : "Not in a series"} <span className="tab-count">{list.length}</span>
              </h4>
              {name && (
                <p className="sermon-group-about muted">
                  Passages covered: {[...new Set(list.filter((s) => s.stage === "preached").flatMap((s) => s.passages.split("; ").filter(Boolean)))].join("; ") || "none preached yet"}
                </p>
              )}
              <ul className="sermon-list">{list.map(row)}</ul>
            </section>
          ))}
        </>
      )}

      {view === "calendar" && (
        <>
          <div className="calendar-head">
            <button className="text-btn" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}>
              ‹
            </button>
            <strong>{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</strong>
            <button className="text-btn" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}>
              ›
            </button>
            <button
              className="text-btn"
              onClick={() => {
                const d = new Date();
                setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
              }}
            >
              Today
            </button>
          </div>
          <div className="sermon-calendar">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="cal-dow">
                {d}
              </div>
            ))}
            {days.map((d) => {
              const key = iso(d);
              const here = shown.filter((s) => s.preached_on === key);
              return (
                <div key={key} className={"cal-day" + (d.getMonth() !== month.getMonth() ? " other" : "") + (key === iso(new Date()) ? " today" : "")}>
                  <span className="cal-num">{d.getDate()}</span>
                  {d.getDay() === 0 && appointedOn(d)[0] && <span className="cal-lect">{dayName(appointedOn(d)[0].day)}</span>}
                  {here.map((s) => (
                    <button key={s.id} className={`cal-sermon stage-${s.stage}`} onClick={() => onOpen(s.id)} title={`${s.title} — ${STAGES.find((x) => x.key === s.stage)?.label}`}>
                      {s.title}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          {shown.some((s) => !s.preached_on) && (
            <section className="sermon-group">
              <h4 className="section-label">Not on a date yet</h4>
              <ul className="sermon-list">{shown.filter((s) => !s.preached_on).map(row)}</ul>
            </section>
          )}
        </>
      )}

      {view === "lectionary" && <LectionaryView saved={saved} onPrepare={onPrepare} onChanged={onChanged} />}

      {view === "plan" && <SeriesPlanner books={books} chapterCounts={chapterCounts} onDone={() => (onChanged(), setView("calendar"))} />}
    </div>
  );
}

/** Lays a book (or part of it) out as a series: one sermon per passage, one a week (or as
 * often as chosen), each saved as an idea with its passage ready to gather from. */
function SeriesPlanner({ books, chapterCounts, onDone }: { books: BookInfo[]; chapterCounts: Record<string, number>; onDone: () => void }) {
  const canon = books.filter((b) => b.testament !== "Apocrypha");
  const [book, setBook] = useState("Romans");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(0);
  const [per, setPer] = useState(1);
  const [start, setStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); // next Sunday
    return iso(d);
  });
  const [every, setEvery] = useState(7);
  const [name, setName] = useState("");
  const [venue, setVenue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chapters = chapterCounts[book] ?? 1;
  const last = to > 0 ? Math.min(to, chapters) : chapters;
  const first = Math.min(Math.max(1, from), last);

  const plan = useMemo(() => {
    const out: { title: string; ref: string; gather: string; date: string }[] = [];
    let d = new Date(`${start}T12:00:00`);
    for (let c = first; c <= last; c += per) {
      const end = Math.min(last, c + per - 1);
      const ref = end > c ? `${book} ${c}–${end}` : `${book} ${c}`;
      // what Gather looks up: each chapter ("Romans 1; Romans 2")
      const gather = Array.from({ length: end - c + 1 }, (_, i) => `${book} ${c + i}`).join("; ");
      out.push({ title: ref, ref, gather, date: iso(d) });
      d = new Date(d);
      d.setDate(d.getDate() + every);
    }
    return out;
  }, [book, first, last, per, start, every]);

  async function create() {
    setBusy(true);
    setError(null);
    const series = name.trim() || `${book}`;
    try {
      for (const p of plan) {
        const body = { shape: "expository", blankLines: 4, items: [], gathered: [], points: 3 };
        // each is saved with what to gather (open it and press Gather)
        await api.sermonSave({
          id: 0,
          title: p.title,
          series,
          preached_on: p.date,
          topics: p.gather,
          passages: p.ref,
          body: JSON.stringify(body),
          updated_at: "",
          stage: "idea",
          venue,
        });
      }
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="series-planner">
      <p className="search-hint">Preach through a book: choose the chapters, how many each week, and when. Each sermon is saved as an idea with its passage — open it and press Gather to start preparing.</p>
      <div className="sermon-meta">
        <label>
          <span className="muted">Book</span>
          <select
            value={book}
            onChange={(e) => {
              setBook(e.target.value);
              setFrom(1);
              setTo(0);
            }}
          >
            {canon.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="muted">From chapter</span>
          <input type="number" min={1} max={chapters} value={from} onChange={(e) => setFrom(Number(e.target.value) || 1)} />
        </label>
        <label>
          <span className="muted">To chapter</span>
          <input type="number" min={1} max={chapters} value={to || chapters} onChange={(e) => setTo(Number(e.target.value) || 0)} />
        </label>
        <label>
          <span className="muted">Chapters each time</span>
          <select value={per} onChange={(e) => setPer(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="muted">First date</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          <span className="muted">How often</span>
          <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>
            <option value={7}>Every week</option>
            <option value={14}>Every two weeks</option>
            <option value={1}>Every day</option>
          </select>
        </label>
        <label>
          <span className="muted">Series name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={book} />
        </label>
        <label>
          <span className="muted">Where</span>
          <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="(optional)" />
        </label>
      </div>
      <p className="muted">
        {plan.length} sermon{plan.length === 1 ? "" : "s"}, {plan[0] ? nice(plan[0].date) : ""} to {plan.length ? nice(plan[plan.length - 1].date) : ""}:
      </p>
      <ol className="series-preview">
        {plan.slice(0, 60).map((p) => (
          <li key={p.date + p.ref}>
            <strong>{p.ref}</strong> <span className="muted">{nice(p.date)}</span>
          </li>
        ))}
      </ol>
      {error && <p className="status-error">{error}</p>}
      <button className="pill-btn" disabled={busy || plan.length === 0 || plan.length > 150} onClick={create}>
        {busy ? "Creating…" : `Create ${plan.length} sermon${plan.length === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}
