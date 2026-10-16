import { useMemo, useState } from "react";
import { api, SavedSermon } from "../api";
import { advent1, Appointed, churchYear, dayName, gatherable, upcoming } from "../lectionary";

interface Props {
  saved: SavedSermon[];
  /** a sermon planned on these readings: open it and gather them */
  onPrepare: (id: number, topics: string) => void;
  onChanged: () => void;
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const long = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "long", year: "numeric" });

/** What Gather looks up for a day: its readings (the first passage of each), the psalm too. */
function topicsOf(a: Appointed): string {
  const cites = [...a.day.readings, a.day.psalm.split(" or ")[0]].map(gatherable).filter(Boolean);
  return [...new Set(cites)].slice(0, 6).join("; ");
}

/** The Prayer Book's readings for the coming Sundays and feasts, to plan sermons on. */
export function LectionaryView({ saved, onPrepare, onChanged }: Props) {
  const [from, setFrom] = useState(() => iso(new Date()));
  const [count, setCount] = useState(12);
  const [sundaysOnly, setSundaysOnly] = useState(false);
  const [openCollect, setOpenCollect] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const start = useMemo(() => new Date(`${from}T12:00:00`), [from]);
  const days = useMemo(() => upcoming(start, sundaysOnly ? count * 3 : count).filter((a) => !sundaysOnly || a.sunday).slice(0, count), [start, count, sundaysOnly]);
  const cy = churchYear(start);

  async function plan(a: Appointed, thenPrepare: boolean) {
    const key = `${iso(a.date)}:${a.day.key}`;
    setBusy(key);
    setError(null);
    try {
      const topics = topicsOf(a);
      const id = await api.sermonSave({
        id: 0,
        title: dayName(a.day),
        series: "",
        preached_on: iso(a.date),
        topics,
        passages: a.day.readings.join("; "),
        body: JSON.stringify({ shape: "expository", blankLines: 4, items: [], gathered: [], points: 3 }),
        updated_at: "",
        stage: "idea",
        venue: "",
      });
      onChanged();
      if (thenPrepare) onPrepare(id, topics);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="lectionary">
      <div className="sermon-meta">
        <label>
          <span className="muted">From</span>
          <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        </label>
        <label>
          <span className="muted">Show</span>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[6, 12, 26, 52].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="check lect-check">
          <input type="checkbox" checked={sundaysOnly} onChange={(e) => setSundaysOnly(e.target.checked)} /> Sundays only
        </label>
      </div>
      <p className="search-hint">
        <strong>Year {cy.letter}</strong> of the three-year cycle, from Advent {advent1(cy.year - 1).getFullYear()} to Advent {cy.year}. Readings from the
        lectionary of the Book of Common Prayer (1979, The Episcopal Church), which is not under copyright. Many churches now use the Revised Common
        Lectionary, which is close to it but not the same.
      </p>
      {error && <p className="status-error">{error}</p>}
      <ul className="lect-list">
        {days.map((a) => {
          const key = `${iso(a.date)}:${a.day.key}`;
          const planned = saved.filter((s) => s.preached_on === iso(a.date));
          return (
            <li key={key} className={"lect-day" + (a.sunday ? " sunday" : "")}>
              <div className="lect-head">
                <span className="lect-date">{long(a.date)}</span>
                <strong>{dayName(a.day)}</strong>
                {/^Proper \d+/.test(a.day.title) && <span className="muted">{a.day.title.replace(/^[^:]*:\s*/, "").replace(/^Proper \d+.*$/, "")}</span>}
                {a.day.year && <span className="note-tag">Year {a.day.year}</span>}
              </div>
              <ul className="lect-readings">
                {a.day.readings.map((r) => (
                  <li key={r}>{r}</li>
                ))}
                {a.day.psalm && <li className="muted">{a.day.psalm}</li>}
              </ul>
              {a.day.collect && (
                <>
                  <button className="link-btn" onClick={() => setOpenCollect(openCollect === key ? null : key)} aria-expanded={openCollect === key}>
                    {openCollect === key ? "Hide the collect" : "The collect of the day"}
                  </button>
                  {openCollect === key && <p className="lect-collect">{a.day.collect}</p>}
                </>
              )}
              <div className="lect-actions">
                {planned.length > 0 && (
                  <span className="muted">
                    Planned: {planned.map((s) => s.title).join(", ")}
                    {" · "}
                  </span>
                )}
                <button className="text-btn" disabled={busy === key} onClick={() => plan(a, false)} title="Save a sermon for this day with these readings, to prepare later">
                  Plan a sermon
                </button>
                <button className="pill-btn" disabled={busy === key} onClick={() => plan(a, true)} title="Save it and start gathering on these readings now">
                  Prepare it now
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="search-hint">
        Lectionary: The Book of Common Prayer (1979), The Episcopal Church; collects from the same. Thanksgiving Day and Independence Day are
        American observances.
      </p>
    </div>
  );
}
