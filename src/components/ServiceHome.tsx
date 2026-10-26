// The Sunday service: the notices, the music and the sermon, each its own saved presentation. Make or open each one,
// tick which one of each is in this Sunday's service, and present the service: the presenter then has a tab for each
// part to switch between.

import { useCallback, useEffect, useState } from "react";
import { api, BookInfo, Deck, DeckKind, SavedSermon, Version } from "../api";
import { keepChoice, KIND_NAME, loadServicePart, PresenterDeck, savedChoice, ServiceChoice, ServiceKind } from "../service";
import { DeckBuilder } from "./DeckBuilder";
import { Presenter } from "./SlideShow";

interface Props {
  versions: Version[];
  books: BookInfo[];
  versionCode: string;
  /** open the sermon builder, on a saved sermon or (null) a new one */
  onOpenSermon: (id: number | null) => void;
  onClose: () => void;
}

const KINDS: ServiceKind[] = ["notices", "music", "sermon"];

const BLURB: Record<ServiceKind, string> = {
  notices: "What is on this week, shown before the service. Often the same for a few weeks: keep it and use it again.",
  music: "The words of the songs, a verse at a time, and the songs on YouTube that have their own words.",
  sermon: "The sermon you have prepared, with its Scripture, pictures and videos.",
};

const dateOf = (s?: string) => (s ? s.slice(0, 10) : "");

export function ServiceHome({ versions, books, versionCode, onOpenSermon, onClose }: Props) {
  const [editing, setEditing] = useState<{ kind: DeckKind; id: number | null } | null>(null);
  const [decks, setDecks] = useState<Record<DeckKind, Deck[]>>({ notices: [], music: [] });
  const [sermons, setSermons] = useState<SavedSermon[]>([]);
  const [choice, setChoice] = useState<ServiceChoice>(savedChoice);
  const [parts, setParts] = useState<PresenterDeck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // finding one among hundreds: what was typed, and how each list is ordered (the newest first to begin with)
  const [query, setQuery] = useState<Record<ServiceKind, string>>({ notices: "", music: "", sermon: "" });
  const [order, setOrder] = useState<Record<ServiceKind, "new" | "old" | "az">>({ notices: "new", music: "new", sermon: "new" });

  const load = useCallback(() => {
    Promise.all([api.deckList("notices"), api.deckList("music"), api.sermonList()])
      .then(([notices, music, s]) => {
        setDecks({ notices, music });
        setSermons(s);
      })
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(load, [load, editing]);

  const rows = (k: ServiceKind): { id: number; title: string; when: string }[] =>
    k === "sermon" ? sermons.map((s) => ({ id: s.id, title: s.title, when: s.preached_on || dateOf(s.updated_at) })) : decks[k].map((d) => ({ id: d.id, title: d.title, when: dateOf(d.updated_at) }));
  /** what is shown of a list: those that match what was typed, in the order chosen (by the date shown, the newest first) */
  const shown = (k: ServiceKind) => {
    const q = query[k].trim().toLowerCase();
    const list = rows(k).filter((r) => !q || `${r.title} ${r.when}`.toLowerCase().includes(q));
    const byDate = (a: { when: string; id: number }, b: { when: string; id: number }) => b.when.localeCompare(a.when) || b.id - a.id;
    if (order[k] === "az") return [...list].sort((a, b) => a.title.localeCompare(b.title));
    return [...list].sort(order[k] === "old" ? (a, b) => byDate(b, a) : byDate);
  };
  // what is chosen must still exist (a deleted one is no longer in the service)
  const chosen = (k: ServiceKind) => (choice[k] && rows(k).some((r) => r.id === choice[k]) ? choice[k] : undefined);
  const pick = (k: ServiceKind, id: number | undefined) => {
    const next = { ...choice, [k]: id };
    setChoice(next);
    keepChoice(next);
  };
  const names = KINDS.flatMap((k) => {
    const id = chosen(k);
    const r = id ? rows(k).find((x) => x.id === id) : undefined;
    return r ? [`${KIND_NAME[k]}: ${r.title}`] : [];
  });

  const present = async () => {
    setBusy(true);
    setError(null);
    try {
      const got: PresenterDeck[] = [];
      for (const k of KINDS) {
        const id = chosen(k);
        if (!id) continue;
        const part = await loadServicePart(k, id, versionCode);
        if (part && part.slides.length) got.push(part);
      }
      if (got.length === 0) setError("Nothing to present yet: the ones ticked have no slides.");
      else setParts(got);
    } catch (e) {
      setError(`The service couldn't be opened: ${e}`);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (k: DeckKind, id: number, title: string) => {
    if (!window.confirm(`Delete “${title}”? Its slides are lost.`)) return;
    await api.deckDelete(id).catch((e) => setError(String(e)));
    if (choice[k] === id) pick(k, undefined);
    load();
  };

  if (editing) return <DeckBuilder kind={editing.kind} id={editing.id} versions={versions} books={books} versionCode={versionCode} onBack={() => setEditing(null)} />;

  return (
    <article className="service">
      <header className="service-head">
        <h2>Sunday service</h2>
        <button className="outline-btn" onClick={onClose}>
          Close
        </button>
      </header>
      <p className="muted">
        Make the notices, the music and the sermon apart, and keep them to use again. Tick the one of each that is in this Sunday's service, then present: the presenter has a tab for each part to switch between.
      </p>
      {error && (
        <p className="status-error" role="alert">
          {error}
        </p>
      )}
      <div className="service-cols">
        {KINDS.map((k) => (
          <section key={k} className={"service-card k-" + k} aria-label={KIND_NAME[k]}>
            <h3>{KIND_NAME[k]}</h3>
            <p className="muted">{BLURB[k]}</p>
            <button className="pill-btn" onClick={() => (k === "sermon" ? onOpenSermon(null) : setEditing({ kind: k, id: null }))}>
              + New {KIND_NAME[k].toLowerCase()}
            </button>
            {rows(k).length > 1 && (
              <div className="service-find">
                <input value={query[k]} onChange={(e) => setQuery((q) => ({ ...q, [k]: e.target.value }))} placeholder={`Find a ${KIND_NAME[k].toLowerCase()}…`} aria-label={`Find a saved ${KIND_NAME[k].toLowerCase()}`} />
                <select value={order[k]} onChange={(e) => setOrder((o) => ({ ...o, [k]: e.target.value as "new" | "old" | "az" }))} aria-label={`Sort the ${KIND_NAME[k].toLowerCase()} list`} title="Sort the list">
                  <option value="new">Newest first</option>
                  <option value="old">Oldest first</option>
                  <option value="az">A to Z</option>
                </select>
              </div>
            )}
            <ul className="service-list">
              {rows(k).length === 0 && <li className="muted">None saved yet.</li>}
              {rows(k).length > 0 && shown(k).length === 0 && <li className="muted">None match “{query[k].trim()}”.</li>}
              {shown(k).map((r) => (
                  <li key={r.id} className={chosen(k) === r.id ? "on" : undefined}>
                    <label className="service-tick" title="In this Sunday's service">
                      <input type="radio" name={`service-${k}`} checked={chosen(k) === r.id} onChange={() => pick(k, r.id)} aria-label={`Use ${r.title} in the service`} />
                    </label>
                    <button className="service-open" onClick={() => (k === "sermon" ? onOpenSermon(r.id) : setEditing({ kind: k, id: r.id }))} title="Open it to change it">
                      <strong>{r.title}</strong>
                      <span className="muted">{r.when}</span>
                    </button>
                    {k !== "sermon" && (
                      <button className="text-btn" onClick={() => void remove(k, r.id, r.title)} aria-label={`Delete ${r.title}`} title="Delete it">
                        ×
                      </button>
                    )}
                  </li>
                ))}
            </ul>
            {rows(k).length > 8 && (
              <span className="muted service-count">
                {shown(k).length === rows(k).length ? `${rows(k).length} saved` : `${shown(k).length} of ${rows(k).length}`}
              </span>
            )}
            {chosen(k) && (
              <button className="link-btn" onClick={() => pick(k, undefined)}>
                Leave {KIND_NAME[k].toLowerCase()} out of the service
              </button>
            )}
          </section>
        ))}
      </div>
      <footer className="service-foot">
        <span className="muted">{names.length ? names.join("  ·  ") : "Tick one or more above to put them in the service."}</span>
        <button className="pill-btn" onClick={() => void present()} disabled={names.length === 0 || busy}>
          {busy ? "Opening…" : "▶ Present the service"}
        </button>
      </footer>
      {parts && <Presenter decks={parts} versions={versions} books={books} versionCode={versionCode} onEnd={() => setParts(null)} />}
    </article>
  );
}
