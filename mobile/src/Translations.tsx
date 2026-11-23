import { Menu } from "./Menu";
import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, Offer, phone, Version } from "./api";
import { todayIso } from "./plans";
import { InstalledFold } from "./Downloads";

// The Bibles screen (More > Bible translations, and Library > Get more > Bibles). Since 3.2.1 it lists eBible.org's free Bibles AND the Bibles of
// CrossWire's libraries (CrossWire, Wycliffe, the NET Bible, CrossWire's Attic): until then the phone could not download any Bible CrossWire has,
// the Afrikaans 1933/1953 among them. The order is the owner's: the search first; what is on the phone (closed); the results of a search, above
// the recommended Bibles; and only at the bottom adding a Bible from a file and the small print.

/** Shown first, in this order (ids as the list gives them). Afrikaans is pinned for everyone, as in the computer app's Library: a download the
 *  reader chooses, from CrossWire, which shares it under its own licence (shown on the card). The free modern English Bibles follow; the built-in
 *  ones (BSB, KJV, ASV, WEB, YLT) are not repeated. */
const RECOMMENDED: [string, string][] = [
  ["crosswire/Afr1953", "Die Afrikaanse Bybel (1933/1953 translation), as CrossWire shares it."],
  ["englsv", "A modern, word-for-word translation (2020)."],
  ["engnet", "NET Bible: a readable modern translation."],
  ["engmsb", "The Berean Standard Bible's sister, from the Majority Greek text."],
  ["engfbv", "Plain, everyday English."],
  ["engULB", "A literal translation made to be freely shared."],
  ["engoebus", "Modern English (the Old Testament is still being translated)."],
];

/** Lower case without accents, so "wereld" finds "wêreld" and "afrikaans" finds "Afrikaans". */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The phone's own language in English ("Afrikaans" for af-ZA), when it is not English: its Bibles are shown first, unasked. */
function phoneLanguage(): string | null {
  try {
    const code = (navigator.language || "").split("-")[0].toLowerCase();
    if (!code || code === "en") return null;
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? null;
  } catch {
    return null;
  }
}
const PHONE_LANGUAGE = phoneLanguage();

interface Props {
  /** called after one was downloaded or removed, so the translation list refreshes */
  onChanged: () => void;
  ask: (message: string, yes: string, then: () => void) => void;
  say: (message: string) => void;
}

export function Translations({ onChanged, ask, say }: Props) {
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [language, setLanguage] = useState("");
  const [wholeOnly, setWholeOnly] = useState(true);
  const [busy, setBusy] = useState<Record<string, number>>({});
  // Bibles the reader added from a file (not in either list)
  const [ownBibles, setOwnBibles] = useState<Version[]>([]);
  const [adding, setAdding] = useState(false);
  const [foldOpen, setFoldOpen] = useState(false); // the closed "On this phone" row, kept as the reader left it while this screen is open
  const loadOwn = () =>
    api
      .versions()
      .then((vs) => setOwnBibles(vs.filter((v) => v.downloaded)))
      .catch(() => undefined);
  useEffect(() => void loadOwn(), []);

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

  async function addFromFile() {
    setError(null);
    const f = await phone.openFile().catch((e) => {
      setError(String(e));
      return null;
    });
    if (!f?.path) return;
    setAdding(true);
    try {
      const a = await api.bibleAddFile(f.path, f.name);
      say(`${a.name} (${a.code}): ${a.verses.toLocaleString()} verses${a.warnings.length ? `. ${a.warnings.join(" ")}` : ""}`);
      void loadOwn();
      onChanged();
    } catch (e) {
      setError(`${f.name}: ${String(e)}`);
    } finally {
      setAdding(false);
    }
  }

  const languages = useMemo(() => [...new Set((offers ?? []).map((o) => o.language))].sort((a, b) => a.localeCompare(b)), [offers]);
  const q = fold(filter.trim());
  const searching = q !== "" || language !== "";
  const isWhole = (o: Offer) => o.ot_books >= 39 && o.nt_books >= 27;
  // what was searched for: words in its name, language, code, source or description; a language chosen narrows it; "Whole Bibles only" applies
  // when browsing a language (a search shows New Testaments too), and never hides a Bible whose books the source does not list
  const results = useMemo(
    () =>
      searching
        ? (offers ?? []).filter(
            (o) =>
              (q === "" || fold(`${o.title} ${o.language} ${o.language_own} ${o.code} ${o.source_name} ${o.description}`).includes(q)) &&
              (language === "" || o.language === language) &&
              (q !== "" || !wholeOnly || !o.books_known || isWhole(o)),
          )
        : [],
    [offers, q, language, wholeOnly, searching],
  );
  const installed = (offers ?? []).filter((o) => o.installed);
  // Bibles added from a file (in neither list)
  const ownOnly = ownBibles.filter((v) => !(offers ?? []).some((o) => o.code.toLowerCase() === v.code.toLowerCase()));
  // the phone's own language (not English): its Bibles, unasked, above Recommended (names as the lists give them start with it: "German, Standard")
  const mine = PHONE_LANGUAGE && !searching ? (offers ?? []).filter((o) => !o.installed && fold(o.language).startsWith(fold(PHONE_LANGUAGE))).slice(0, 6) : [];
  const recommended = RECOMMENDED.map(([id, why]) => [(offers ?? []).find((o) => o.id === id), why] as const).filter(
    (r): r is readonly [Offer, string] => !!r[0] && !r[0].installed && !mine.some((m) => m.id === r[0]?.id),
  );

  async function install(o: Offer) {
    setBusy((b) => ({ ...b, [o.id]: 0 }));
    setError(null);
    try {
      const n = await api.bibleInstall(o.id, todayIso());
      say(`${o.title}: ${n.toLocaleString()} verses. Choose it at the top of the Read screen.`);
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
        .bibleRemove(o.code)
        .then(() => {
          setOffers((all) => all?.map((x) => (x.id === o.id ? { ...x, installed: false } : x)) ?? all);
          onChanged();
        })
        .catch((e) => setError(String(e))),
    );
  }

  const books = (o: Offer) =>
    !o.books_known
      ? ""
      : isWhole(o)
        ? "Whole Bible"
        : o.ot_books === 0
          ? o.nt_books >= 27
            ? "New Testament"
            : `${o.nt_books} NT books`
          : o.nt_books === 0
            ? "Old Testament"
            : `${o.ot_books} OT and ${o.nt_books} NT books`;
  const size = (o: Offer) => (o.size_kb > 0 ? `${Math.max(1, Math.round(o.size_kb / 1024))} MB` : "");

  /** One Bible: name, language, books, where it comes from, its licence, and one button. */
  const card = (o: Offer, why?: string) => (
    <li key={o.id} className="offer" dir="auto">
      <div className="hit-head">
        <strong>{o.title}</strong>
      </div>
      {why && <p>{why}</p>}
      <p>{[o.language_own ? `${o.language} (${o.language_own})` : o.language, books(o), `from ${o.source_name}`, size(o)].filter(Boolean).join(" · ")}</p>
      {o.copyright && <p className="hint">{o.copyright}</p>}
      {o.source !== "ebible" && o.description && (
        <details className="offer-about">
          <summary>About this Bible</summary>
          <p className="hint">{o.description}</p>
        </details>
      )}
      {o.installed ? (
        <span className="hint">✓ On this phone</span>
      ) : o.id in busy ? (
        <span className="hint">{busy[o.id] >= 100 ? "Putting it in place…" : `Downloading… ${busy[o.id] ? `${busy[o.id]}%` : ""}`}</span>
      ) : (
        <button onClick={() => void install(o)}>Download</button>
      )}
    </li>
  );

  return (
    <>
      <input
        className="field"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Search Bibles: a language or a name (Afrikaans, Greek, Luther…)"
        aria-label="Search the Bibles"
        autoCapitalize="none"
        autoCorrect="off"
        enterKeyHint="search"
      />
      <div className="finder-row">
        {offers && (
          <Menu className="select-field" label="Language" title="Choose a language" value={language} onChange={setLanguage} shown={language || "Or choose a language…"} items={[{ value: "", label: "Every language" }, ...languages.map((l) => ({ value: l, label: l }))]} />
        )}
        {language !== "" && q === "" && (
          <label className="toggle">
            <input type="checkbox" checked={wholeOnly} onChange={(e) => setWholeOnly(e.target.checked)} /> Whole Bibles only
          </label>
        )}
      </div>
      {error && <p className="hint status">{error}</p>}
      {!offers && !error && <p className="hint">Loading the lists from eBible.org and CrossWire…</p>}

      <InstalledFold count={ownOnly.length + installed.length} open={foldOpen} onToggle={setFoldOpen}>
        <ul className="hits plain">
          {installed.map((o) => (
            <li key={o.id} className="offer">
              <div className="hit-head">
                <strong>{o.title}</strong>
                <button className="remove" aria-label={`Remove ${o.title}`} onClick={() => remove(o)}>
                  ×
                </button>
              </div>
              <p>{[o.language, `from ${o.source_name}`].join(" · ")}</p>
            </li>
          ))}
          {ownOnly.map((v) => (
            <li key={v.code} className="offer">
              <div className="hit-head">
                <strong>
                  {v.name} ({v.code})
                </strong>
                <button
                  className="remove"
                  aria-label={`Remove ${v.name}`}
                  onClick={() =>
                    ask(`Remove ${v.name} from this phone? You can add it again from its file.`, "Remove", () =>
                      void api
                        .bibleRemove(v.code)
                        .then(() => {
                          void loadOwn();
                          onChanged();
                        })
                        .catch((e) => setError(String(e))),
                    )
                  }
                >
                  ×
                </button>
              </div>
              <p>{v.license_note || "Added from a file"}</p>
            </li>
          ))}
        </ul>
      </InstalledFold>

      {searching && offers && (
        <>
          <h3>{results.length === 0 ? "None found" : `Found ${results.length.toLocaleString()}`}</h3>
          {results.length === 0 && (
            <p className="hint">{q ? "Try a shorter word, or the language's name in English (Afrikaans, German, Greek)." : "Untick “Whole Bibles only” to see New Testaments too."}</p>
          )}
          <ul className="hits plain">{results.slice(0, 150).map((o) => card(o))}</ul>
          {results.length > 150 && <p className="hint">{results.length - 150} more: type more of the name to narrow the list.</p>}
        </>
      )}

      {mine.length > 0 && (
        <>
          <h3>In your phone's language ({PHONE_LANGUAGE})</h3>
          <ul className="hits plain">{mine.map((o) => card(o))}</ul>
        </>
      )}

      {recommended.length > 0 && (
        <>
          <h3>Recommended</h3>
          <ul className="hits plain">{recommended.map(([o, why]) => card(o, why))}</ul>
        </>
      )}

      <h3>Add a Bible from a file</h3>
      <div className="actions">
        <button onClick={() => void addFromFile()} disabled={adding}>
          {adding ? "Adding…" : "Choose a file…"}
        </button>
      </div>
      <p className="hint small-print">
        A file you already have: e-Sword (.bblx), MySword (.bbl.mybible), MyBible (.SQLite3) or SWORD (.zip). Only add Bibles you have the right to use; Bibles bought in
        e-Sword are locked and can't be opened.
      </p>
      <p className="hint small-print">
        The Bibles here come from eBible.org and from CrossWire's libraries (CrossWire, Wycliffe, the NET Bible and CrossWire's Attic), each with its own licence. Each is a
        one-time download; then it reads offline, side by side with the others, and the search looks inside it. NIV, ESV, NASB and NLT are not free to share, so they can't be
        offered here.
      </p>
      <button className="link" onClick={() => load(true)}>
        Refresh the lists
      </button>
    </>
  );
}
