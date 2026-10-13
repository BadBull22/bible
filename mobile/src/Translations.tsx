import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, Offer } from "./api";
import { todayIso } from "./plans";

interface Props {
  /** called after one was downloaded or removed, so the translation list refreshes */
  onChanged: () => void;
  ask: (message: string, yes: string, then: () => void) => void;
  say: (message: string) => void;
}

/** More translations from eBible.org: every Bible it marks free to share, in hundreds of
 * languages. Downloaded once, then read offline like the built-in ones. */
export function Translations({ onChanged, ask, say }: Props) {
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [language, setLanguage] = useState("English");
  const [wholeOnly, setWholeOnly] = useState(true);
  const [busy, setBusy] = useState<Record<string, number>>({});

  const load = (refresh = false) => {
    setError(null);
    api
      .bibleCatalog(todayIso(), refresh)
      .then(setOffers)
      .catch((e) => setError(String(e)));
  };

  useEffect(() => {
    load();
    const un = listen<{ id: string; pct: number }>("bible-progress", (e) => setBusy((b) => (e.payload.id in b ? { ...b, [e.payload.id]: e.payload.pct } : b)));
    return () => {
      void un.then((f) => f());
    };
  }, []);

  const languages = useMemo(() => [...new Set((offers ?? []).map((o) => o.language))].sort((a, b) => a.localeCompare(b)), [offers]);
  const q = filter.trim().toLowerCase();
  const shown = (offers ?? []).filter(
    (o) =>
      (q
        ? `${o.title} ${o.language} ${o.language_own} ${o.description}`.toLowerCase().includes(q)
        : language === "" || o.language === language) && (!wholeOnly || (o.ot_books >= 39 && o.nt_books >= 27) || q !== ""),
  );
  const installed = (offers ?? []).filter((o) => o.installed);

  async function install(o: Offer) {
    setBusy((b) => ({ ...b, [o.id]: 0 }));
    try {
      const n = await api.bibleInstall(o.id, todayIso());
      say(`${o.title}: ${n.toLocaleString()} verses`);
      setOffers((all) => all?.map((x) => (x.id === o.id ? { ...x, installed: true } : x)) ?? all);
      onChanged();
    } catch (e) {
      setError(`${o.title}: ${String(e)}`);
    } finally {
      setBusy((b) => {
        const { [o.id]: _, ...rest } = b;
        return rest;
      });
    }
  }

  function remove(o: Offer) {
    ask(`Remove ${o.title} from this phone? It can be downloaded again.`, "Remove", () =>
      void api
        .bibleRemove(o.id)
        .then(() => {
          setOffers((all) => all?.map((x) => (x.id === o.id ? { ...x, installed: false } : x)) ?? all);
          onChanged();
        })
        .catch((e) => setError(String(e))),
    );
  }

  const books = (o: Offer) =>
    o.ot_books >= 39 && o.nt_books >= 27 ? "Whole Bible" : o.ot_books === 0 ? (o.nt_books >= 27 ? "New Testament" : `${o.nt_books} NT books`) : o.nt_books === 0 ? "Old Testament" : `${o.ot_books} OT and ${o.nt_books} NT books`;

  return (
    <>
      <p className="hint">
        Bibles from eBible.org that may be shared freely. Each is a one-time download (a few MB); after that it reads offline. They can be read, compared and shown side by side;
        the search uses the built-in English translations.
      </p>
      {error && <p className="hint status">{error}</p>}
      {installed.length > 0 && (
        <>
          <h3>On this phone</h3>
          <ul className="hits plain">
            {installed.map((o) => (
              <li key={o.id} className="offer">
                <div className="hit-head">
                  <strong>{o.title}</strong>
                  <button className="remove" aria-label={`Remove ${o.title}`} onClick={() => remove(o)}>
                    ×
                  </button>
                </div>
                <p>
                  {o.language} · {o.copyright}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      <h3>Get more</h3>
      <input className="field" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search: a language or a name" aria-label="Search the translations" autoCapitalize="none" autoCorrect="off" />
      {!q && offers && (
        <select className="select-field" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
          <option value="">Every language</option>
          {languages.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      )}
      <label className="toggle">
        <input type="checkbox" checked={wholeOnly} onChange={(e) => setWholeOnly(e.target.checked)} /> Whole Bibles only
      </label>
      {!offers && !error && <p className="hint">Loading the list from eBible.org…</p>}
      {offers && shown.length === 0 && <p className="hint">None found. Try another language, or untick “Whole Bibles only”.</p>}
      <ul className="hits plain">
        {shown.slice(0, 150).map((o) => (
          <li key={o.id} className="offer" dir="auto">
            <div className="hit-head">
              <strong>{o.title}</strong>
            </div>
            <p>
              {o.language}
              {o.language_own && ` (${o.language_own})`} · {books(o)} · {o.copyright}
            </p>
            {o.installed ? (
              <span className="hint">✓ On this phone</span>
            ) : o.id in busy ? (
              <span className="hint">Downloading… {busy[o.id] ? `${busy[o.id]}%` : ""}</span>
            ) : (
              <button onClick={() => void install(o)}>Download</button>
            )}
          </li>
        ))}
      </ul>
      {shown.length > 150 && <p className="hint">{shown.length - 150} more: search to narrow the list.</p>}
      <button className="link" onClick={() => load(true)}>
        Refresh the list
      </button>
    </>
  );
}
