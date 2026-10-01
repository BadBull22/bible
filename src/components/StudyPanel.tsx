import { useEffect, useMemo, useRef, useState } from "react";
import { api, BookInfo, HIGHLIGHT_COLORS, highlightLabel, PlanProgress, StudyItem, StudyLists } from "../api";
import { buildPlan, currentDay, describeReadings, PLANS, todayIso } from "../readingPlans";
import { addToBasket, addVersesToBasket } from "../basket";
import { BasketButton } from "./BasketButton";
import { CopyButton } from "./CopyButton";
import { ChevronDownIcon, CloseIcon } from "./icons";

type Tab = "notes" | "highlights" | "bookmarks" | "plans";

interface Props {
  books: BookInfo[];
  chapterCounts: Record<string, number>;
  initialTab?: Tab;
  /** Bumped by the parent whenever a verse is bookmarked/highlighted/noted, so lists stay current. */
  refreshKey: number;
  onJump: (book: string, chapter: number, verse: number) => void;
  onPlansChanged: () => void;
  onClose: () => void;
  /** The reader's own names for the highlight colours (e.g. "yellow" -> "Love"), if set. */
  highlightTitles: Record<string, string>;
}

const TABS: { key: Tab; label: string }[] = [
  { key: "notes", label: "Notes" },
  { key: "highlights", label: "Highlights" },
  { key: "bookmarks", label: "Bookmarks" },
  { key: "plans", label: "Reading plans" },
];

export function StudyPanel({ books, chapterCounts, initialTab, refreshKey, onJump, onPlansChanged, onClose, highlightTitles }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "notes");
  const [lists, setLists] = useState<StudyLists | null>(null);
  const [plans, setPlans] = useState<PlanProgress[]>([]);
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedColors, setExpandedColors] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  function toggleColor(color: string) {
    setExpandedColors((s) => {
      const next = new Set(s);
      if (next.has(color)) next.delete(color);
      else next.add(color);
      return next;
    });
  }

  function reload() {
    api.listStudy().then(setLists).catch((e) => setError(String(e)));
    api.planProgress().then(setPlans).catch((e) => setError(String(e)));
  }
  useEffect(reload, [refreshKey]);
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  const items: StudyItem[] = useMemo(() => {
    if (!lists || tab === "plans") return [];
    const all = lists[tab];
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter((i) =>
      `${i.book} ${i.chapter}:${i.verse} ${i.value} ${highlightTitles[i.value] ?? ""} ${i.verse_text}`.toLowerCase().includes(q),
    );
  }, [lists, tab, filter, highlightTitles]);

  // Highlights grouped by colour (not flat/chronological like the other tabs) -- each
  // colour becomes one collapsible section, so a reader with a lot of highlights can find
  // "everything I called Love" instead of scrolling a single undifferentiated list.
  const highlightGroups = useMemo(() => {
    if (tab !== "highlights") return [];
    const byColor = new Map<string, StudyItem[]>();
    for (const i of items) {
      const arr = byColor.get(i.value);
      if (arr) arr.push(i);
      else byColor.set(i.value, [i]);
    }
    const known = HIGHLIGHT_COLORS.filter((c) => byColor.has(c));
    const other = [...byColor.keys()].filter((c) => !(HIGHLIGHT_COLORS as string[]).includes(c));
    return [...known, ...other].map((color) => ({ color, items: byColor.get(color)! }));
  }, [items, tab]);

  async function doExport() {
    setError(null);
    setStatus("Exporting…");
    try {
      const r = await api.exportStudy();
      setStatus(`Saved ${r.notes} notes, ${r.highlights} highlights and ${r.bookmarks} bookmarks to ${r.markdown_path} (and a .json backup beside it).`);
    } catch (e) {
      setStatus(null);
      setError(String(e));
    }
  }

  function doImport(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const r = await api.importStudy(String(reader.result ?? ""));
        setStatus(`Imported ${r.notes} notes, ${r.highlights} highlights, ${r.bookmarks} bookmarks and ${r.plans} reading plans. Nothing already here was deleted.`);
        reload();
        onPlansChanged();
      } catch (e) {
        setStatus(null);
        setError(String(e));
      }
    };
    reader.readAsText(file);
  }

  async function startPlan(id: string) {
    await api.startPlan(id, todayIso()).catch((e) => setError(String(e)));
    reload();
    onPlansChanged();
  }
  async function stopPlan(id: string) {
    if (!window.confirm("Stop this reading plan? Your ticked-off days for it will be cleared.")) return;
    await api.stopPlan(id).catch((e) => setError(String(e)));
    reload();
    onPlansChanged();
  }
  async function toggleDay(id: string, day: number, done: boolean) {
    await api.setPlanDay(id, day, done).catch((e) => setError(String(e)));
    reload();
    onPlansChanged();
  }

  const counts = lists ? { notes: lists.notes.length, highlights: lists.highlights.length, bookmarks: lists.bookmarks.length, plans: plans.length } : null;

  return (
    <aside className="side-panel wide study-panel">
      <div className="side-panel-header">
        <h3>My Study</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="mode-toggle" role="tablist" aria-label="My study">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
            {t.label}
            {counts && <span className="tab-count">{counts[t.key]}</span>}
          </button>
        ))}
      </div>
      <div className="study-actions">
        <button className="text-btn" onClick={doExport} title="Save everything as a readable Markdown file plus a JSON backup in Documents\Bible Concordance">
          Export
        </button>
        <button className="text-btn" onClick={() => fileRef.current?.click()} title="Restore from a .json backup made with Export (merges; deletes nothing)">
          Import backup
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) doImport(f);
            e.target.value = "";
          }}
        />
      </div>
      {status && <p className="study-status">{status}</p>}
      {error && <p className="status-error">{error}</p>}

      {tab !== "plans" && (
        <>
          <div className="search-controls">
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${tab}…`} aria-label={`Filter ${tab}`} />
          </div>
          {lists && items.length === 0 && (
            <p className="muted">
              {filter.trim()
                ? "Nothing matches that filter."
                : tab === "notes"
                  ? "No notes yet. Use the ⋯ menu beside any verse and choose Add note."
                  : tab === "highlights"
                    ? "No highlights yet. Use the ⋯ menu beside any verse to highlight it."
                    : "No bookmarks yet. Use the ⋯ menu beside any verse to bookmark it."}
            </p>
          )}
          {tab === "highlights" ? (
            <div className="highlight-groups">
              {highlightGroups.map(({ color, items: groupItems }) => {
                const expanded = expandedColors.has(color);
                return (
                  <div className={`highlight-group hl-${color}`} key={color}>
                    <button className="highlight-group-header" onClick={() => toggleColor(color)} aria-expanded={expanded}>
                      <i className={`highlight-swatch swatch-${color}`} />
                      <span className="highlight-group-title">{highlightLabel(color, highlightTitles)}</span>
                      <span className="tab-count">{groupItems.length}</span>
                      <ChevronDownIcon size={14} className={expanded ? "highlight-group-chevron open" : "highlight-group-chevron"} />
                    </button>
                    {expanded && (
                      <ul className="xref-list study-list">
                        {groupItems.map((i) => (
                          <li key={`${i.book}-${i.chapter}-${i.verse}`}>
                            <div className="xref-item-head">
                              <button className="link-btn" onClick={() => onJump(i.book, i.chapter, i.verse)}>
                                {i.book} {i.chapter}:{i.verse}
                              </button>
                              <span className="votes">{i.created_at.slice(0, 10)}</span>
                              <BasketButton
                                add={() => addVersesToBasket(i.book, i.chapter, i.verse, i.verse, "BSB")}
                                title="Add this verse to the study basket"
                              />
                              <CopyButton
                                title="Copy this verse"
                                text={`${i.book} ${i.chapter}:${i.verse} (BSB)${i.verse_text ? ` — ${i.verse_text.trim()}` : ""}`}
                              />
                            </div>
                            {i.verse_text && <div className="snippet">{i.verse_text}</div>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <ul className="xref-list study-list">
              {items.map((i) => (
                <li key={`${i.book}-${i.chapter}-${i.verse}`}>
                  <div className="xref-item-head">
                    <button className="link-btn" onClick={() => onJump(i.book, i.chapter, i.verse)}>
                      {i.book} {i.chapter}:{i.verse}
                    </button>
                    <span className="votes">{(tab === "notes" ? i.updated_at : i.created_at).slice(0, 10)}</span>
                    <BasketButton
                      add={async () =>
                        (await addVersesToBasket(i.book, i.chapter, i.verse, i.verse, "BSB")) &&
                        (tab !== "notes" || (await addToBasket("note", `My note on ${i.book} ${i.chapter}:${i.verse}`, i.value)))
                      }
                      title={tab === "notes" ? "Add the verse and your note to the study basket" : "Add this verse to the study basket"}
                    />
                    <CopyButton
                      title={tab === "notes" ? "Copy the verse and your note" : "Copy this verse"}
                      text={`${i.book} ${i.chapter}:${i.verse} (BSB)${i.verse_text ? ` — ${i.verse_text.trim()}` : ""}${tab === "notes" ? `\n\nMy note: ${i.value}` : ""}`}
                    />
                  </div>
                  {tab === "notes" && <div className="study-note-body">{i.value}</div>}
                  {i.verse_text && <div className="snippet">{i.verse_text}</div>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {tab === "plans" && (
        <div className="plans">
          {PLANS.map((def) => {
            const progress = plans.find((p) => p.plan_id === def.id);
            const days = buildPlan(def.id, books, chapterCounts);
            if (!progress) {
              return (
                <section key={def.id} className="plan-card">
                  <h4>{def.name}</h4>
                  <p className="muted">{def.description}</p>
                  <button className="pill-btn" onClick={() => startPlan(def.id)}>
                    Start today
                  </button>
                </section>
              );
            }
            const today = currentDay(progress.started_on, def.days);
            const done = new Set(progress.done_days);
            const behind = [...Array(today).keys()].map((d) => d + 1).filter((d) => d < today && !done.has(d)).length;
            const pct = Math.round((done.size / def.days) * 100);
            const window_ = [...Array(Math.min(def.days, today + 3)).keys()].map((d) => d + 1).filter((d) => d >= Math.max(1, today - 3));
            return (
              <section key={def.id} className="plan-card active">
                <h4>{def.name}</h4>
                <div className="plan-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div style={{ width: `${pct}%` }} />
                </div>
                <p className="muted">
                  Day {today} of {def.days} · {done.size} days done ({pct}%){behind > 0 ? ` · ${behind} earlier ${behind === 1 ? "day" : "days"} not ticked yet` : ""}
                </p>
                <ul className="plan-days">
                  {window_.map((d) => {
                    const readings = days[d - 1] ?? [];
                    return (
                      <li key={d} className={d === today ? "today" : ""}>
                        <label>
                          <input type="checkbox" checked={done.has(d)} onChange={(e) => toggleDay(def.id, d, e.target.checked)} />
                          <span className="plan-day-label">{d === today ? "Today" : `Day ${d}`}</span>
                        </label>
                        <span className="plan-readings">
                          {readings.length === 0
                            ? "—"
                            : readings.map((r, ri) => (
                                <button key={ri} className="link-btn" onClick={() => onJump(r.book, r.chapter, 1)}>
                                  {r.book} {r.chapter}
                                </button>
                              ))}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="search-hint">Whole plan: {describeReadings(days.flat()).slice(0, 140)}…</p>
                <button className="text-btn" onClick={() => stopPlan(def.id)}>
                  Stop this plan
                </button>
              </section>
            );
          })}
        </div>
      )}
    </aside>
  );
}
