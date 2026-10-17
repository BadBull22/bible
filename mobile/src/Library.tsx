// The Library on the phone: commentaries, dictionaries and lexicons, books and devotionals --
// downloaded from CrossWire, or added from a file the reader has -- and the screens to read
// them. Bible references in the text are links that open the passage.

import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, CatalogItem, CommentaryOn, LibEntry, LibInstalled, LibSection, phone, TocEntry } from "./api";

const KIND_LABEL: Record<string, string> = { commentary: "Commentaries", dictionary: "Dictionaries", book: "Books", devotional: "Devotionals" };
const KIND_ONE: Record<string, string> = { commentary: "Commentary", dictionary: "Dictionary", book: "Book", devotional: "Devotional", bible: "Bible" };
const KINDS = ["commentary", "dictionary", "book", "devotional"];

type Go = (book: string, chapter: number, verse: number | null) => void;

/** Text with the library's verse links (⟦Book|ch|v|v_end|label⟧) as buttons that open the passage. */
export function LinkedText({ text, onGo }: { text: string; onGo: Go }) {
  const paras = text.split(/\n{2,}/);
  return (
    <>
      {paras.map((para, i) => (
        <p key={i}>
          {para.split(/(⟦[^⟧]*⟧)/).map((part, j) => {
            const m = /^⟦([^|]*)\|(\d+)\|(\d*)\|(\d*)\|([^⟧]*)⟧$/.exec(part);
            if (!m) return part;
            const [, book, ch, v, , label] = m;
            return (
              <button key={j} className="link" onClick={() => onGo(book, Number(ch), v ? Number(v) : null)}>
                {label || `${book} ${ch}${v ? `:${v}` : ""}`}
              </button>
            );
          })}
        </p>
      ))}
    </>
  );
}

type View =
  | { at: "home" }
  | { at: "get" }
  | { at: "commentary" }
  | { at: "dictionary"; module?: string }
  | { at: "entry"; id: number; back: View }
  | { at: "book"; module: string; title: string }
  | { at: "section"; id: number; back: View }
  | { at: "devotional"; module: string; title: string };

interface Props {
  /** where the reader is (for commentaries) */
  book: string;
  chapter: number;
  /** open straight on this chapter's commentaries */
  start?: "commentary";
  onGo: Go;
  /** a Bible was added from a file: the translation list should refresh */
  onBibles: () => void;
  ask: (message: string, yes: string, then: () => void) => void;
  say: (message: string) => void;
}

export function Library({ book, chapter, start, onGo, onBibles, ask, say }: Props) {
  const [view, setView] = useState<View>(start === "commentary" ? { at: "commentary" } : { at: "home" });
  const [mine, setMine] = useState<LibInstalled[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const load = () =>
    api
      .libraryInstalled()
      .then(setMine)
      .catch((e) => setError(String(e)));
  useEffect(() => void load(), []);

  async function addFile() {
    setError(null);
    const f = await phone.openFile().catch((e) => {
      setError(String(e));
      return null;
    });
    if (!f?.path) return;
    setAdding(true);
    try {
      const r = await api.libraryAddFile(f.path, f.name);
      say(`${KIND_ONE[r.kind] ?? "Added"}: ${r.title}${r.warnings.length ? `. ${r.warnings.join(" ")}` : ""}`);
      if (r.kind === "bible") onBibles();
      else void load();
    } catch (e) {
      setError(`${f.name}: ${String(e)}`);
    } finally {
      setAdding(false);
    }
  }

  const back = (to: View) => (
    <button className="link back" onClick={() => setView(to)}>
      ‹ Back
    </button>
  );

  if (view.at === "get") return <GetMore onBack={() => (setView({ at: "home" }), void load())} say={say} />;
  if (view.at === "commentary") return <Commentaries book={book} chapter={chapter} onGo={onGo} head={back({ at: "home" })} />;
  if (view.at === "dictionary") return <Dictionary onOpen={(id) => setView({ at: "entry", id, back: view })} head={back({ at: "home" })} />;
  if (view.at === "entry") return <EntryView id={view.id} onGo={onGo} head={back(view.back)} />;
  if (view.at === "book") return <BookView module={view.module} title={view.title} onOpen={(id) => setView({ at: "section", id, back: view })} head={back({ at: "home" })} />;
  if (view.at === "section") return <SectionView id={view.id} onGo={onGo} head={back(view.back)} onMove={(id) => setView({ ...view, id })} />;
  if (view.at === "devotional") return <DevotionalView module={view.module} title={view.title} onGo={onGo} head={back({ at: "home" })} />;

  const has = (k: string) => (mine ?? []).some((m) => m.kind === k);
  return (
    <>
      <h3>Library</h3>
      <p className="hint">Commentaries, dictionaries, books and devotionals to read offline. Download free ones from CrossWire, or add files you have (SWORD, e-Sword, MySword).</p>
      {error && <p className="hint status">{error}</p>}
      <div className="actions">
        <button onClick={() => setView({ at: "get" })}>Get more</button>
        <button onClick={() => void addFile()} disabled={adding}>
          {adding ? "Adding…" : "Add from a file"}
        </button>
      </div>
      {(has("commentary") || has("dictionary")) && (
        <div className="actions">
          {has("commentary") && (
            <button onClick={() => setView({ at: "commentary" })}>
              Commentaries on {book} {chapter}
            </button>
          )}
          {has("dictionary") && <button onClick={() => setView({ at: "dictionary" })}>Look up a word</button>}
        </div>
      )}
      {mine && mine.length === 0 && <p className="hint">Nothing in your library yet.</p>}
      {KINDS.filter(has).map((k) => (
        <div key={k}>
          <h3>{KIND_LABEL[k]}</h3>
          <ul className="hits plain">
            {(mine ?? [])
              .filter((m) => m.kind === k)
              .map((m) => (
                <li key={m.name} className="offer">
                  <div className="hit-head">
                    <button
                      className="link lib-open"
                      onClick={() =>
                        setView(
                          k === "book"
                            ? { at: "book", module: m.name, title: m.title }
                            : k === "devotional"
                              ? { at: "devotional", module: m.name, title: m.title }
                              : k === "dictionary"
                                ? { at: "dictionary", module: m.name }
                                : { at: "commentary" },
                        )
                      }
                    >
                      {m.title}
                    </button>
                    <button
                      className="remove"
                      aria-label={`Remove ${m.title}`}
                      onClick={() =>
                        ask(`Remove ${m.title} from this phone?`, "Remove", () =>
                          void api
                            .libraryRemove(m.name)
                            .then(load)
                            .catch((e) => setError(String(e))),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                  <p>
                    {[m.language, m.source === "file" ? "Added from a file" : m.licence].filter(Boolean).join(" · ")}
                  </p>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <p className="hint">
        Only add files you have the right to use: many modules shared online are copies of copyrighted books made without permission. Modules bought for e-Sword are locked and
        can't be opened.
      </p>
    </>
  );
}

/** What CrossWire offers: by kind, with a search, each downloaded with one tap. */
function GetMore({ onBack, say }: { onBack: () => void; say: (m: string) => void }) {
  const [items, setItems] = useState<CatalogItem[] | null>(null);
  const [kind, setKind] = useState("commentary");
  const [q, setQ] = useState("");
  const [english, setEnglish] = useState(true);
  const [busy, setBusy] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const load = (refresh = false) => {
    setError(null);
    api
      .libraryCatalog(refresh)
      .then(setItems)
      .catch((e) => setError(String(e)));
  };
  useEffect(() => {
    load();
    const un = listen<{ name: string; pct: number }>("library-progress", (e) => setBusy((b) => (e.payload.name in b ? { ...b, [e.payload.name]: e.payload.pct } : b)));
    return () => void un.then((f) => f());
  }, []);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (items ?? []).filter(
      (i) => i.kind === kind && !i.questionable && (!english || i.lang === "en" || i.lang.startsWith("en-")) && (!s || `${i.title} ${i.name} ${i.about}`.toLowerCase().includes(s)),
    );
  }, [items, kind, q, english]);
  async function install(i: CatalogItem) {
    setBusy((b) => ({ ...b, [i.name]: 0 }));
    try {
      const r = await api.libraryInstall(i.name);
      say(`${r.title}: added`);
      setItems((all) => all?.map((x) => (x.name === i.name ? { ...x, installed: true } : x)) ?? all);
    } catch (e) {
      setError(`${i.title}: ${String(e)}`);
    } finally {
      setBusy((b) => {
        const { [i.name]: _, ...rest } = b;
        return rest;
      });
    }
  }
  return (
    <>
      <button className="link back" onClick={onBack}>
        ‹ Back
      </button>
      <h3>Get more from CrossWire</h3>
      <p className="hint">Free works the CrossWire Bible Society shares. Each is a one-time download; then it reads offline.</p>
      <div className="chips">
        {KINDS.map((k) => (
          <button key={k} className={kind === k ? "on" : undefined} onClick={() => setKind(k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <input className="lib-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: Spurgeon, Greek, Matthew Henry…" />
      <label className="hint">
        <input type="checkbox" checked={english} onChange={(e) => setEnglish(e.target.checked)} /> English only
      </label>
      {error && <p className="hint status">{error}</p>}
      {!items && !error && <p className="hint">Loading the list from CrossWire…</p>}
      <ul className="hits plain">
        {shown.map((i) => (
          <li key={i.name} className="offer">
            <div className="hit-head">
              <strong>{i.title}</strong>
            </div>
            <p>
              {[i.language, i.size_kb ? `${Math.max(1, Math.round(i.size_kb / 1024))} MB` : "", i.licence].filter(Boolean).join(" · ")}
            </p>
            {i.note ? (
              <p className="hint">{i.note}</p>
            ) : i.installed ? (
              <p className="hint">In your library</p>
            ) : i.name in busy ? (
              <p className="hint">{busy[i.name] >= 100 ? "Putting it in place…" : `Downloading… ${busy[i.name]}%`}</p>
            ) : (
              <div className="actions">
                <button onClick={() => void install(i)}>Download</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {items && shown.length === 0 && <p className="hint">Nothing matches.</p>}
      {items && (
        <div className="actions">
          <button onClick={() => load(true)}>Refresh the list</button>
        </div>
      )}
    </>
  );
}

/** Every installed commentary on the chapter being read, with ‹ › to move chapters. */
function Commentaries({ book, chapter, onGo, head }: { book: string; chapter: number; onGo: Go; head: React.ReactNode }) {
  const [at, setAt] = useState(chapter);
  const [notes, setNotes] = useState<CommentaryOn[] | null>(null);
  const [which, setWhich] = useState<string | null>(null);
  useEffect(() => {
    setNotes(null);
    api
      .libraryCommentary(book, at)
      .then((n) => {
        setNotes(n);
        setWhich((w) => (w && n.some((c) => c.module === w) ? w : (n[0]?.module ?? null)));
      })
      .catch(() => setNotes([]));
  }, [book, at]);
  const shown = notes?.find((c) => c.module === which);
  return (
    <>
      {head}
      <h3>
        Commentaries on {book} {at}
      </h3>
      <div className="actions">
        {at > 1 && (
          <button onClick={() => setAt(at - 1)}>
            ‹ {book} {at - 1}
          </button>
        )}
        <button onClick={() => setAt(at + 1)}>
          {book} {at + 1} ›
        </button>
      </div>
      {notes && notes.length > 1 && (
        <div className="chips">
          {notes.map((c) => (
            <button key={c.module} className={c.module === which ? "on" : undefined} onClick={() => setWhich(c.module)}>
              {c.title}
            </button>
          ))}
        </div>
      )}
      {notes && notes.length === 0 && <p className="hint">None of your commentaries has notes on this chapter.</p>}
      {shown && (
        <div className="commentary">
          {shown.notes.map(([verse, text], i) => (
            <div key={i}>
              {(i === 0 || shown.notes[i - 1][0] !== verse) && (
                <h4>
                  {verse > 0 ? (
                    <button className="link" onClick={() => onGo(book, at, verse)}>
                      Verse {verse}
                    </button>
                  ) : (
                    `${book} ${at}`
                  )}
                </h4>
              )}
              <LinkedText text={text} onGo={onGo} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Looking up a word (or a Strong's number) in every dictionary and lexicon. */
function Dictionary({ onOpen, head }: { onOpen: (id: number) => void; head: React.ReactNode }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: number; title: string; headword: string }[] | null>(null);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) {
      setHits(null);
      return;
    }
    const t = setTimeout(() => void api.librarySearch(s).then(setHits).catch(() => setHits([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <>
      {head}
      <h3>Look up a word</h3>
      <input className="lib-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="grace, Jerusalem, G26, H2617…" autoFocus />
      {hits && hits.length === 0 && <p className="hint">Not found in your dictionaries.</p>}
      <ul className="hits plain">
        {(hits ?? []).map((h) => (
          <li key={h.id}>
            <button className="link lib-open" onClick={() => onOpen(h.id)}>
              {h.headword}
            </button>
            <small> — {h.title}</small>
          </li>
        ))}
      </ul>
    </>
  );
}

function EntryView({ id, onGo, head }: { id: number; onGo: Go; head: React.ReactNode }) {
  const [e, setE] = useState<LibEntry | null>(null);
  useEffect(() => void api.libraryEntry(id).then(setE), [id]);
  return (
    <>
      {head}
      {e && (
        <>
          <h3>
            {e.headword} <small>{e.title}</small>
          </h3>
          <div className="commentary">
            <LinkedText text={e.body} onGo={onGo} />
          </div>
        </>
      )}
    </>
  );
}

/** A book's contents; a book of daily readings also offers today's. */
function BookView({ module, title, onOpen, head }: { module: string; title: string; onOpen: (id: number) => void; head: React.ReactNode }) {
  const [toc, setToc] = useState<TocEntry[] | null>(null);
  const [today, setToday] = useState<number[]>([]);
  useEffect(() => {
    void api.libraryToc(module).then(setToc);
    const d = new Date();
    void api.libraryToday(module, d.getMonth() + 1, d.getDate()).then(setToday);
  }, [module]);
  const depth = (t: TocEntry) => {
    let n = 0;
    let p = t.parent;
    while (p != null && n < 6) {
      n++;
      p = toc?.find((x) => x.id === p)?.parent ?? null;
    }
    return n;
  };
  return (
    <>
      {head}
      <h3>{title}</h3>
      {today.length > 0 && (
        <div className="actions">
          {today.map((id, i) => {
            // "17 AM Oct": this morning's; "17 PM Oct": this evening's
            const t = (toc?.find((x) => x.id === id)?.title ?? "").toLowerCase();
            const when = /\b(am|morning)\b/.test(t) ? "This morning" : /\b(pm|evening)\b/.test(t) ? "This evening" : today.length > 1 ? `Today (${i + 1})` : "Today's reading";
            return (
              <button key={id} onClick={() => onOpen(id)}>
                {when}
              </button>
            );
          })}
        </div>
      )}
      <ul className="toc">
        {(toc ?? []).map((t) => (
          <li key={t.id} style={{ paddingLeft: `${depth(t) * 1}rem` }}>
            <button className="link" onClick={() => onOpen(t.id)}>
              {t.title}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function SectionView({ id, onGo, onMove, head }: { id: number; onGo: Go; onMove: (id: number) => void; head: React.ReactNode }) {
  const [s, setS] = useState<LibSection | null>(null);
  useEffect(() => void api.librarySection(id).then(setS), [id]);
  if (!s) return <>{head}</>;
  const nav = (
    <div className="actions">
      <button disabled={s.prev == null} onClick={() => s.prev != null && onMove(s.prev)}>
        ‹ Before
      </button>
      <button disabled={s.next == null} onClick={() => s.next != null && onMove(s.next)}>
        Next ›
      </button>
    </div>
  );
  return (
    <>
      {head}
      <h3>
        {s.title} <small>{s.book}</small>
      </h3>
      <div className="commentary">{s.text ? <LinkedText text={s.text} onGo={onGo} /> : <p className="hint">This section is a heading; its parts follow.</p>}</div>
      {nav}
    </>
  );
}

/** A devotional opens on today; ‹ › go a day back or forward. */
function DevotionalView({ module, title, onGo, head }: { module: string; title: string; onGo: Go; head: React.ReactNode }) {
  const [day, setDay] = useState(() => new Date());
  const [e, setE] = useState<LibEntry | null | undefined>(undefined);
  useEffect(() => {
    setE(undefined);
    void api
      .libraryDevotional(module, day.getMonth() + 1, day.getDate())
      .then(setE)
      .catch(() => setE(null));
  }, [module, day]);
  const move = (n: number) => setDay((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
  const label = day.toLocaleDateString(undefined, { day: "numeric", month: "long" });
  return (
    <>
      {head}
      <h3>
        {title} <small>{label}</small>
      </h3>
      <div className="actions">
        <button onClick={() => move(-1)}>‹ Day before</button>
        <button onClick={() => setDay(new Date())}>Today</button>
        <button onClick={() => move(1)}>Next day ›</button>
      </div>
      {e === null && <p className="hint">No reading for {label}.</p>}
      {e && (
        <div className="commentary">
          <LinkedText text={e.body} onGo={onGo} />
        </div>
      )}
    </>
  );
}
