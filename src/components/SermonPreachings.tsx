import { useEffect, useState } from "react";
import { api, Preaching } from "../api";

// When and where a sermon was preached: one sermon, many times. Recording one makes the
// sermon "Preached" with that date (the latest one counts).

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const niceDate = (d: string) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

/** "12 Jan 2025 South Point (evening)" */
export const preachingLine = (p: { date: string; venue: string; audience?: string }) =>
  `${niceDate(p.date)}${p.venue ? ` ${p.venue}` : ""}${p.audience ? ` (${p.audience})` : ""}`;

interface Props {
  /** the saved sermon (0: not saved yet) */
  sermonId: number;
  /** where the sermon says it is preached, to start a new record with */
  venue: string;
  /** open the form straight away (the stage was just set to Preached) */
  ask: boolean;
  onAsked: () => void;
  /** the sermon's stage and date now follow its latest preaching */
  onChanged: (latest: string | null) => void;
}

export function SermonPreachings({ sermonId, venue, ask, onAsked, onChanged }: Props) {
  const [list, setList] = useState<Preaching[]>([]);
  const [form, setForm] = useState<Preaching | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!sermonId) return setList([]);
    api
      .sermonPreachings(sermonId)
      .then(setList)
      .catch((e) => setError(String(e)));
  };
  useEffect(load, [sermonId]); // eslint-disable-line react-hooks/exhaustive-deps

  const blank = (): Preaching => ({ id: 0, sermon_id: sermonId, date: today(), venue, audience: "", notes: "", length_min: null });
  useEffect(() => {
    if (ask && sermonId) {
      setForm((f) => f ?? blank());
      onAsked();
    }
  }, [ask, sermonId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    if (!form) return;
    setError(null);
    try {
      await api.sermonPreachingSave(form);
      setForm(null);
      const fresh = await api.sermonPreachings(sermonId);
      setList(fresh);
      onChanged(fresh.length ? fresh[fresh.length - 1].date : null);
    } catch (e) {
      setError(String(e));
    }
  }

  async function remove(id: number) {
    await api.sermonPreachingDelete(id).catch((e) => setError(String(e)));
    const fresh = await api.sermonPreachings(sermonId).catch(() => list);
    setList(fresh);
    onChanged(fresh.length ? fresh[fresh.length - 1].date : null);
  }

  if (!sermonId) {
    return <p className="muted sp-none">Save the sermon to record when and where it is preached.</p>;
  }
  return (
    <div className="sermon-preachings">
      <div className="sp-head">
        <strong>{list.length === 0 ? "Not preached yet" : list.length === 1 ? "Preached once" : `Preached ${list.length} times`}</strong>
        {!form && (
          <button className="outline-btn" onClick={() => setForm(blank())}>
            + Record a preaching
          </button>
        )}
      </div>
      {list.length > 0 && (
        <ul className="sp-list">
          {list.map((p) => (
            <li key={p.id}>
              <button className="link-btn" onClick={() => setForm(p)} title="Change this">
                {preachingLine(p)}
              </button>
              {p.length_min ? <span className="muted"> · {p.length_min} min</span> : null}
              {p.notes && <span className="muted sp-notes"> · {p.notes}</span>}
            </li>
          ))}
        </ul>
      )}
      {form && (
        <form
          className="sp-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            <span className="muted">Date</span>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
          </label>
          <label>
            <span className="muted">Where</span>
            <input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder="South Point" />
          </label>
          <label>
            <span className="muted">To whom</span>
            <input value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} placeholder="evening service, youth…" />
          </label>
          <label>
            <span className="muted">Minutes</span>
            <input
              type="number"
              min={1}
              max={600}
              value={form.length_min ?? ""}
              onChange={(e) => setForm({ ...form, length_min: e.target.value ? Number(e.target.value) : null })}
            />
          </label>
          <label className="sp-wide">
            <span className="muted">Notes</span>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="how it went, what to change next time" />
          </label>
          <span className="sp-actions">
            <button className="pill-btn" type="submit">
              {form.id ? "Save" : "Record it"}
            </button>
            <button className="text-btn" type="button" onClick={() => setForm(null)}>
              Cancel
            </button>
            {form.id > 0 && (
              <button
                className="text-btn danger"
                type="button"
                onClick={() => {
                  const id = form.id;
                  setForm(null);
                  void remove(id);
                }}
              >
                Delete this record
              </button>
            )}
          </span>
        </form>
      )}
      {error && <p className="status-error">{error}</p>}
    </div>
  );
}
