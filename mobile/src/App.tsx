import { useEffect, useMemo, useRef, useState } from "react";
import { exit, onBackButtonPress } from "@tauri-apps/api/app";
import { api, Article, ArticleHead, Book, ChapterMarks, COLORS, Counts, Hit, Mark, MarkKind, phone, PlanProgress, SearchResult, Topic, Verse, Version } from "./api";
import { buildPlan, currentDay, describeReadings, PLANS, todayIso } from "./plans";
import { parseReference, Reference } from "./refs";
import { verseForToday } from "./votd";

type Tab = "read" | "search" | "study" | "plans" | "more";
type Theme = "system" | "light" | "dark";

interface Saved {
  version: string;
  book: string;
  chapter: number;
  size: number;
  theme: Theme;
  /** show the verse for the day when the app opens */
  dayVerse: boolean;
  /** how fast the phone's voice reads */
  rate: number;
}

const SAVED_KEY = "pocket:state";
const RECENT_KEY = "pocket:recent";
const DAY_SEEN_KEY = "pocket:day-verse-seen";

function loadSaved(): Saved {
  const start: Saved = { version: "BSB", book: "John", chapter: 1, size: 1, theme: "system", dayVerse: true, rate: 1 };
  try {
    return { ...start, ...(JSON.parse(localStorage.getItem(SAVED_KEY) ?? "{}") as Partial<Saved>) };
  } catch {
    return start;
  }
}

const stored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a convenience only */
  }
};

/** What was typed into the search box lately, newest first. */
function loadRecent(): string[] {
  try {
    const list = JSON.parse(stored(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, 15) : [];
  } catch {
    return [];
  }
}

// --- the phone's Back button: each open layer (a sheet, a tab other than Read) is a step
// of browser history, so Back closes the top one instead of leaving the app.
const layers: { close: () => void }[] = [];
let ignorePops = 0;
window.addEventListener("popstate", () => {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  layers.pop()?.close();
});

// Android hands the Back button to the app: close the top layer, or leave from the Read screen.
void onBackButtonPress(() => {
  if (layers.length > 0) history.back();
  else void exit(0);
}).catch(() => undefined);

function useBack(active: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active) return;
    const layer = { close: () => closeRef.current() };
    layers.push(layer);
    history.pushState({ layer: layers.length }, "");
    return () => {
      const i = layers.indexOf(layer);
      if (i < 0) return; // closed by Back itself
      layers.splice(i, 1);
      ignorePops++;
      history.back();
    };
  }, [active]);
}

const WHY: Record<string, string> = { core: "Key passage", phrase: "Exact words", topical: "Topic" };
const COLOR_NAMES: Record<string, string> = { yellow: "Yellow", green: "Green", blue: "Blue", pink: "Pink", orange: "Orange" };
const RATES: [number, string][] = [
  [0.8, "Slower"],
  [1, "Normal"],
  [1.2, "Faster"],
  [1.5, "Fast"],
];

const refLabel = (h: { book: string; chapter: number; verse: number; verse_end?: number }) =>
  `${h.book} ${h.chapter}:${h.verse}${h.verse_end && h.verse_end > h.verse ? `–${h.verse_end}` : ""}`;

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

const countsText = (c: Counts) =>
  `${c.bookmarks} bookmark${c.bookmarks === 1 ? "" : "s"}, ${c.highlights} highlight${c.highlights === 1 ? "" : "s"}, ${c.notes} note${c.notes === 1 ? "" : "s"} and ${c.plans} reading plan${c.plans === 1 ? "" : "s"}`;

export function App() {
  const saved = useMemo(loadSaved, []);
  const [versions, setVersions] = useState<Version[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [version, setVersion] = useState(saved.version);
  const [place, setPlace] = useState({ book: saved.book, chapter: saved.chapter });
  const [size, setSize] = useState(saved.size);
  const [theme, setTheme] = useState<Theme>(saved.theme);
  const [dayVerse, setDayVerse] = useState(saved.dayVerse);
  const [rate, setRate] = useState(saved.rate);
  const [tab, setTab] = useState<Tab>("read");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // a question to answer before something is deleted (the phone's own confirm box isn't shown inside the app)
  const [asking, setAsking] = useState<null | { message: string; yes: string; then: () => void }>(null);
  const ask = (message: string, yes: string, then: () => void) => setAsking({ message, yes, then });

  // reading
  const [verses, setVerses] = useState<Verse[]>([]);
  const [marks, setMarks] = useState<ChapterMarks>({ bookmarks: [], highlights: [], notes: [] });
  const [marksVersion, setMarksVersion] = useState(0);
  const [target, setTarget] = useState<number | null>(null);
  const [chosen, setChosen] = useState<number | null>(null); // the verse whose actions are open
  const [picker, setPicker] = useState<null | { book: Book | null; testament: "OT" | "NT" }>(null);
  const [today, setToday] = useState<null | { label: string; text: string; book: string; chapter: number; verse: number }>(null);
  const pane = useRef<HTMLDivElement>(null);

  // reading aloud: the verse being spoken; each run has a number, so an old one knows to stop
  const [speaking, setSpeaking] = useState<number | null>(null);
  const run = useRef(0);
  const thenListen = useRef(false);

  // searching
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "OT" | "NT" | "book">("all");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [topic, setTopic] = useState<{ topic: Topic; hits: Hit[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [article, setArticle] = useState<Article | null>(null);

  // my study
  const [kind, setKind] = useState<MarkKind>("bookmarks");
  const [list, setList] = useState<Mark[]>([]);

  // reading plans
  const [progress, setProgress] = useState<PlanProgress[]>([]);

  // dictionary and backup (More)
  const [word, setWord] = useState("");
  const [found, setFound] = useState<ArticleHead[] | null>(null);
  const [backupNote, setBackupNote] = useState<string | null>(null);

  const fail = (e: unknown) => setError(String(e));
  const say = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 1800);
  };

  useEffect(() => {
    api.versions().then(setVersions).catch(fail);
    api.books().then(setBooks).catch(fail);
  }, []);

  useEffect(() => {
    store(SAVED_KEY, JSON.stringify({ version, ...place, size, theme, dayVerse, rate } satisfies Saved));
  }, [version, place, size, theme, dayVerse, rate]);

  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  // --- the verse for the day, once a day when the app opens
  useEffect(() => {
    if (!dayVerse || stored(DAY_SEEN_KEY) === todayIso()) return;
    const v = verseForToday();
    api
      .passage(version, v.book, v.chapter, v.verse, v.verseEnd)
      .then((text) => text && setToday({ label: refLabel({ ...v, verse_end: v.verseEnd }), text, book: v.book, chapter: v.chapter, verse: v.verse }))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closeToday = () => {
    store(DAY_SEEN_KEY, todayIso());
    setToday(null);
  };

  // --- the chapter being read
  useEffect(() => {
    let current = true;
    api
      .chapter(version, place.book, place.chapter)
      .then((v) => current && setVerses(v))
      .catch(fail);
    return () => {
      current = false;
    };
  }, [version, place]);

  useEffect(() => {
    api.chapterMarks(place.book, place.chapter).then(setMarks).catch(fail);
  }, [place, marksVersion]);

  // land on the verse asked for (and show which it is), or at the top of a new chapter
  useEffect(() => {
    if (tab !== "read" || verses.length === 0) return;
    if (thenListen.current) {
      thenListen.current = false;
      pane.current?.scrollTo({ top: 0 });
      void listenFrom(verses[0].verse, verses);
      return;
    }
    if (target == null) {
      pane.current?.scrollTo({ top: 0 });
      return;
    }
    const el = pane.current?.querySelector<HTMLElement>(`[data-verse="${target}"]`);
    el?.scrollIntoView({ block: "center" });
    const t = window.setTimeout(() => setTarget(null), 2200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verses, tab]);

  function go(book: string, chapter: number, verse: number | null = null) {
    stopListening();
    setChosen(null);
    setPicker(null);
    setArticle(null);
    setTarget(verse);
    setPlace({ book, chapter });
    setTab("read");
  }

  const bookInfo = books.find((b) => b.name === place.book);
  const bookAt = books.findIndex((b) => b.name === place.book);
  const prev = place.chapter > 1 ? { book: place.book, chapter: place.chapter - 1 } : bookAt > 0 ? { book: books[bookAt - 1].name, chapter: books[bookAt - 1].chapters } : null;
  const next =
    bookInfo && place.chapter < bookInfo.chapters ? { book: place.book, chapter: place.chapter + 1 } : bookAt >= 0 && bookAt < books.length - 1 ? { book: books[bookAt + 1].name, chapter: 1 } : null;
  const nextRef = useRef(next);
  nextRef.current = next;

  // a sideways swipe turns the chapter
  const touch = useRef<{ x: number; y: number } | null>(null);
  function swiped(e: React.TouchEvent) {
    const from = touch.current;
    touch.current = null;
    const end = e.changedTouches[0];
    if (!from || !end) return;
    const dx = end.clientX - from.x;
    if (Math.abs(dx) < 80 || Math.abs(end.clientY - from.y) > 50) return;
    const to = dx < 0 ? next : prev;
    if (to) go(to.book, to.chapter);
  }

  // --- reading aloud with the phone's voice, verse by verse, on into the next chapter
  async function listenFrom(verse: number, from: Verse[] = verses) {
    const mine = ++run.current;
    setChosen(null);
    for (const v of from) {
      if (v.verse < verse) continue;
      if (mine !== run.current) return;
      setSpeaking(v.verse);
      let done = false;
      try {
        done = (await phone.speak(v.text, rate)).finished;
      } catch (e) {
        if (mine === run.current) {
          setSpeaking(null);
          fail(e);
        }
        return;
      }
      if (mine !== run.current) return;
      if (!done) {
        setSpeaking(null);
        return;
      }
    }
    setSpeaking(null);
    const to = nextRef.current;
    if (to) {
      thenListen.current = true;
      setTarget(null);
      setPlace(to);
    }
  }

  function stopListening() {
    if (speaking == null && !thenListen.current) return;
    run.current++;
    thenListen.current = false;
    setSpeaking(null);
    void phone.stopSpeaking().catch(() => undefined);
  }

  useEffect(() => {
    if (speaking == null) return;
    const el = pane.current?.querySelector<HTMLElement>(`[data-verse="${speaking}"]`);
    const box = pane.current;
    if (!el || !box) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    if (r.top < b.top + 70 || r.bottom > b.bottom - 40) el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [speaking]);

  // --- the search box: a reference goes there; anything else is searched for
  const reference: Reference | null = useMemo(() => parseReference(typed, books), [typed, books]);

  function remember(text: string) {
    const list = [text, ...recent.filter((r) => r.toLowerCase() !== text.toLowerCase())].slice(0, 15);
    setRecent(list);
    store(RECENT_KEY, JSON.stringify(list));
  }

  function submit(text = typed.trim()) {
    if (!text) return;
    (document.activeElement as HTMLElement | null)?.blur();
    const ref = parseReference(text, books);
    remember(ref ? `${ref.book} ${ref.chapter}${ref.verse ? `:${ref.verse}` : ""}` : text);
    if (ref) {
      setTyped("");
      go(ref.book, ref.chapter, ref.verse);
    } else {
      setTyped(text);
      setTopic(null);
      setQuery(text);
      setTab("search");
    }
  }

  useEffect(() => {
    if (!query) return;
    let current = true;
    setSearching(true);
    api
      .search(query, version, scope === "OT" || scope === "NT" ? scope : null, scope === "book" ? place.book : null)
      .then((r) => current && setResult(r))
      .catch(fail)
      .finally(() => current && setSearching(false));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, version, scope, scope === "book" ? place.book : ""]);

  function openTopic(t: Topic) {
    setSearching(true);
    api
      .topicVerses(t.id, version)
      .then((hits) => setTopic({ topic: t, hits }))
      .catch(fail)
      .finally(() => setSearching(false));
  }

  const openArticle = (id: number) =>
    api
      .article(id)
      .then((a) => a && setArticle(a))
      .catch(fail);

  // --- bookmarks, highlights and notes
  useEffect(() => {
    if (tab !== "study") return;
    api.marks(kind, version).then(setList).catch(fail);
  }, [tab, kind, version, marksVersion]);

  const highlightOf = useMemo(() => new Map(marks.highlights), [marks]);
  const changed = () => setMarksVersion((n) => n + 1);

  async function bookmark(book: string, chapter: number, verse: number) {
    const on = await api.toggleBookmark(book, chapter, verse).catch(fail);
    if (on !== undefined) say(on ? "Bookmarked" : "Bookmark removed");
    changed();
  }

  async function highlight(book: string, chapter: number, verse: number, color: string | null) {
    await api.setHighlight(book, chapter, verse, color).catch(fail);
    changed();
  }

  // --- reading plans
  const loadPlans = () => api.planProgress().then(setProgress).catch(fail);
  useEffect(() => {
    if (tab === "plans") void loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // --- the dictionary (More)
  useEffect(() => {
    const q = word.trim();
    if (q.length < 2) {
      setFound(null);
      return;
    }
    let current = true;
    const t = window.setTimeout(() => {
      api
        .articles(q)
        .then((a) => current && setFound(a))
        .catch(fail);
    }, 250);
    return () => {
      current = false;
      window.clearTimeout(t);
    };
  }, [word]);

  // --- backup
  async function saveBackup() {
    setBackupNote(null);
    try {
      const [json, counts] = await api.backup();
      const r = await phone.saveText(`Bible Concordance backup ${todayIso()}.json`, json);
      setBackupNote(r.saved ? `Saved: ${countsText(counts)}. Keep the file somewhere safe; it can also be restored in the desktop app (My Study → Import backup).` : "Nothing was saved.");
    } catch (e) {
      setBackupNote(String(e));
    }
  }

  async function restoreBackup() {
    setBackupNote(null);
    try {
      const r = await phone.openText();
      if (r.text == null) return;
      const n = await api.restore(r.text);
      changed();
      setBackupNote(`Restored: ${countsText(n)} were new. Nothing already here was removed.`);
    } catch (e) {
      setBackupNote(String(e));
    }
  }

  // --- Back closes the top layer
  useBack(tab !== "read", () => setTab("read"));
  useBack(topic != null, () => setTopic(null));
  useBack(picker != null, () => setPicker(null));
  useBack(article != null, () => setArticle(null));
  useBack(chosen != null, () => setChosen(null));
  useBack(asking != null, () => setAsking(null));

  const chosenVerse = chosen != null ? verses.find((v) => v.verse === chosen) : undefined;
  const shown = topic ? topic.hits : (result?.hits ?? []);
  const versionName = versions.find((v) => v.code === version);

  return (
    <div className="app" style={{ ["--scale" as string]: size }}>
      <header className="top">
        <form
          className="search-box"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="John 3:16, a word, or a topic"
            aria-label="Go to a passage, or search the Bible"
            enterKeyHint={reference ? "go" : "search"}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {typed && (
            <button type="button" className="clear" onClick={() => setTyped("")} aria-label="Clear">
              ×
            </button>
          )}
        </form>
        <select value={version} onChange={(e) => setVersion(e.target.value)} aria-label="Translation">
          {versions.map((v) => (
            <option key={v.code} value={v.code}>
              {v.code}
            </option>
          ))}
        </select>
      </header>
      {typed.trim() && typed.trim() !== query && (
        <button className="suggest" onClick={() => submit()}>
          {reference ? (
            <>
              Go to <strong>{reference.book} {reference.chapter}{reference.verse ? `:${reference.verse}` : ""}</strong>
            </>
          ) : (
            <>
              Search for <strong>“{typed.trim()}”</strong>
            </>
          )}
        </button>
      )}
      {error && (
        <p className="error" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <main ref={pane} className="pane" onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })} onTouchEnd={tab === "read" ? swiped : undefined}>
        {tab === "read" && (
          <>
            <button className="place" onClick={() => setPicker({ book: null, testament: bookInfo?.testament ?? "NT" })}>
              {place.book} {place.chapter} <span aria-hidden>▾</span>
            </button>
            {today && (
              <aside className="today">
                <div className="hit-head">
                  <span className="today-label">Verse for today</span>
                  <strong>{today.label}</strong>
                  <button className="remove" onClick={closeToday} aria-label="Close">
                    ×
                  </button>
                </div>
                <p>{today.text}</p>
                <button
                  className="link"
                  onClick={() => {
                    closeToday();
                    go(today.book, today.chapter, today.verse);
                  }}
                >
                  Read the chapter ›
                </button>
              </aside>
            )}
            <div className="chapter">
              {verses.map((v) => {
                const color = highlightOf.get(v.verse);
                return (
                  <p
                    key={v.verse}
                    data-verse={v.verse}
                    className={"verse" + (color ? ` hl-${color}` : "") + (target === v.verse ? " target" : "") + (chosen === v.verse ? " chosen" : "") + (speaking === v.verse ? " speaking" : "")}
                    onClick={() => setChosen(v.verse)}
                  >
                    <sup>{v.verse}</sup>
                    {marks.bookmarks.includes(v.verse) && <span className="ribbon" aria-label="Bookmarked" />}
                    {v.text}
                    {marks.notes.includes(v.verse) && <span className="has-note" aria-label="Has a note">✎</span>}
                  </p>
                );
              })}
            </div>
            <nav className="turn">
              <button disabled={!prev} onClick={() => prev && go(prev.book, prev.chapter)}>
                ‹ {prev ? `${prev.book} ${prev.chapter}` : ""}
              </button>
              <button disabled={!next} onClick={() => next && go(next.book, next.chapter)}>
                {next ? `${next.book} ${next.chapter}` : ""} ›
              </button>
            </nav>
            <p className="licence">{versionName?.name} · {versionName?.license_note}</p>
          </>
        )}

        {tab === "search" && (
          <>
            {topic ? (
              <div className="summary">
                <button className="link" onClick={() => setTopic(null)}>
                  ‹ Results
                </button>
                <strong>{topic.topic.name}</strong> · {topic.hits.length} verses · {topic.topic.source}
              </div>
            ) : (
              <>
                <div className="chips" role="group" aria-label="Where to search">
                  {(
                    [
                      ["all", "Whole Bible"],
                      ["OT", "Old Testament"],
                      ["NT", "New Testament"],
                      ["book", place.book],
                    ] as const
                  ).map(([key, label]) => (
                    <button key={key} className={scope === key ? "on" : ""} onClick={() => setScope(key)}>
                      {label}
                    </button>
                  ))}
                </div>
                {!query && <p className="hint">Type a word, a phrase or a subject above — “your faith has healed you”, “gifts of the Spirit”, “forgiveness”. A reference such as “Romans 8:28” opens the passage.</p>}
                {recent.length > 0 && !typed.trim() && (
                  <section className="recent">
                    <h3>
                      Recent
                      <button
                        className="link"
                        onClick={() => {
                          setRecent([]);
                          store(RECENT_KEY, "[]");
                        }}
                      >
                        Clear
                      </button>
                    </h3>
                    <div className="chips">
                      {recent.map((r) => (
                        <button key={r} onClick={() => submit(r)}>
                          {r}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {query && result && (
                  <p className="summary">
                    <strong>“{query}”</strong>: {result.exact === 0 ? "not found word for word" : `word for word in ${result.exact} verse${result.exact === 1 ? "" : "s"}`} ({version}).
                    {result.hits.length > 0 && ` ${result.hits.length} passages, the most relevant first.`}
                  </p>
                )}
                {query && result && (result.topics.length > 0 || result.articles.length > 0) && (
                  <div className="chips topics" role="group" aria-label="Topics and dictionary articles">
                    {result.topics.map((t) => (
                      <button key={`t${t.id}`} onClick={() => openTopic(t)} title={t.source}>
                        Topic: {t.name}{" "}
                        <small>
                          {t.source.split("'")[0]} · {t.verses}
                        </small>
                      </button>
                    ))}
                    {result.articles.map((a) => (
                      <button key={`a${a.id}`} className="article" onClick={() => openArticle(a.id)} title={a.source}>
                        Dictionary: {a.name} <small>{a.source.split("'")[0]}</small>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {searching && <p className="hint">Searching…</p>}
            {!searching && query && result && shown.length === 0 && <p className="hint">Nothing found. Try fewer or different words, or another translation.</p>}
            <HitList hits={shown} showWhy={!topic} onOpen={go} />
          </>
        )}

        {tab === "study" && (
          <>
            <div className="chips segmented" role="tablist">
              {(
                [
                  ["bookmarks", "Bookmarks"],
                  ["highlights", "Highlights"],
                  ["notes", "Notes"],
                ] as const
              ).map(([key, label]) => (
                <button key={key} role="tab" aria-selected={kind === key} className={kind === key ? "on" : ""} onClick={() => setKind(key)}>
                  {label}
                </button>
              ))}
            </div>
            {list.length === 0 && (
              <p className="hint">
                {kind === "bookmarks" ? "No bookmarks yet." : kind === "highlights" ? "No highlights yet." : "No notes yet."} Tap a verse while reading to{" "}
                {kind === "bookmarks" ? "bookmark it" : kind === "highlights" ? "highlight it" : "write a note on it"}.
              </p>
            )}
            {(kind === "highlights" ? COLORS.filter((c) => list.some((m) => m.color === c)) : [null]).map((color) => (
              <section key={color ?? "all"}>
                {color && (
                  <h3>
                    <i className={`dot hl-${color}`} /> {COLOR_NAMES[color]} <small>{list.filter((m) => m.color === color).length}</small>
                  </h3>
                )}
                <ul className="hits">
                  {list
                    .filter((m) => color == null || m.color === color)
                    .map((m) => (
                      <li key={`${m.book}-${m.chapter}-${m.verse}`} className={color ? `hl-${color}` : ""} onClick={() => go(m.book, m.chapter, m.verse)}>
                        <div className="hit-head">
                          <strong>{refLabel(m)}</strong>
                          <button
                            className="remove"
                            aria-label="Remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (kind === "bookmarks") void bookmark(m.book, m.chapter, m.verse);
                              else if (kind === "highlights") void highlight(m.book, m.chapter, m.verse, null);
                              else ask(`Delete your note on ${refLabel(m)}?`, "Delete", () => void api.setNote(m.book, m.chapter, m.verse, "").then(changed).catch(fail));
                            }}
                          >
                            ×
                          </button>
                        </div>
                        {kind === "notes" && <p className="note-body">{m.color}</p>}
                        <span>{m.text}</span>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </>
        )}

        {tab === "plans" && (
          <>
            <h2>Reading plans</h2>
            {PLANS.map((plan) => {
              const mine = progress.find((p) => p.plan_id === plan.id);
              if (!mine)
                return (
                  <section key={plan.id} className="card">
                    <h3>{plan.name}</h3>
                    <p className="hint">{plan.description}</p>
                    <button className="primary" onClick={() => api.startPlan(plan.id, todayIso()).then(loadPlans).catch(fail)}>
                      Start today
                    </button>
                  </section>
                );
              const days = buildPlan(plan.id, books);
              const day = currentDay(mine.started_on, plan.days);
              const done = new Set(mine.done_days);
              // today's reading, and any earlier day not ticked off yet (the oldest few)
              const behind = Array.from({ length: day - 1 }, (_, i) => i + 1)
                .filter((d) => !done.has(d))
                .slice(0, 3);
              return (
                <section key={plan.id} className="card">
                  <h3>{plan.name}</h3>
                  <p className="hint">
                    Day {day} of {plan.days} · {done.size} day{done.size === 1 ? "" : "s"} read
                  </p>
                  <div className="bar" aria-hidden>
                    <i style={{ width: `${Math.round((done.size / plan.days) * 100)}%` }} />
                  </div>
                  {[...behind, day].map((d) => {
                    const readings = days[d - 1] ?? [];
                    return (
                      <div key={d} className={"plan-day" + (d === day ? " today-row" : "")}>
                        <label>
                          <input type="checkbox" checked={done.has(d)} onChange={(e) => api.setPlanDay(plan.id, d, e.target.checked).then(loadPlans).catch(fail)} />
                          <span>
                            <strong>{d === day ? "Today" : `Day ${d}`}</strong> {describeReadings(readings)}
                          </span>
                        </label>
                        <div className="chips">
                          {readings.map((r) => (
                            <button key={`${r.book}${r.chapter}`} onClick={() => go(r.book, r.chapter)}>
                              {r.book} {r.chapter}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <button
                    className="link"
                    onClick={() => ask(`Stop “${plan.name}”? The days you ticked off will be cleared.`, "Stop the plan", () => void api.stopPlan(plan.id).then(loadPlans).catch(fail))}
                  >
                    Stop this plan
                  </button>
                </section>
              );
            })}
          </>
        )}

        {tab === "more" && (
          <>
            <h2>Bible dictionary</h2>
            <input className="field" value={word} onChange={(e) => setWord(e.target.value)} placeholder="A person, place or word — e.g. Passover" aria-label="Look up in the dictionary" autoCapitalize="none" autoCorrect="off" />
            {found && found.length === 0 && <p className="hint">No article by that name. Try the main search box for verses on it.</p>}
            {found && found.length > 0 && (
              <ul className="hits plain">
                {found.map((a) => (
                  <li key={a.id} onClick={() => openArticle(a.id)}>
                    <strong>{a.name}</strong> <small>{a.source}</small>
                  </li>
                ))}
              </ul>
            )}

            <h2>Backup</h2>
            <p className="hint">Your bookmarks, highlights, notes and reading plans live only on this phone. Save a backup file now and then; the same file works in the desktop app.</p>
            <div className="actions">
              <button onClick={saveBackup}>Save a backup</button>
              <button onClick={restoreBackup}>Restore a backup</button>
            </div>
            {backupNote && <p className="hint status">{backupNote}</p>}

            <h2>Reading</h2>
            <h3>Text size</h3>
            <div className="actions">
              <button disabled={size <= 0.85} onClick={() => setSize((s) => Math.round((s - 0.1) * 100) / 100)}>
                A−
              </button>
              <span className="size-now">{Math.round(size * 100)}%</span>
              <button disabled={size >= 1.8} onClick={() => setSize((s) => Math.round((s + 0.1) * 100) / 100)}>
                A+
              </button>
            </div>
            <h3>Theme</h3>
            <div className="chips">
              {(["system", "light", "dark"] as const).map((t) => (
                <button key={t} className={theme === t ? "on" : ""} onClick={() => setTheme(t)}>
                  {t === "system" ? "Same as phone" : t === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </div>
            <h3>Read aloud speed</h3>
            <div className="chips">
              {RATES.map(([value, label]) => (
                <button key={value} className={rate === value ? "on" : ""} onClick={() => setRate(value)}>
                  {label}
                </button>
              ))}
            </div>
            <p className="hint">Tap a verse and choose Listen. It uses this phone's own voice; a better one can be chosen in the phone's settings under Text-to-speech.</p>
            <label className="toggle">
              <input type="checkbox" checked={dayVerse} onChange={(e) => setDayVerse(e.target.checked)} /> Show a verse for the day when the app opens
            </label>

            <h2>About</h2>
            <ul className="about">
              {versions.map((v) => (
                <li key={v.code}>
                  <strong>{v.code}</strong> {v.name} — {v.license_note}
                </li>
              ))}
            </ul>
            <p className="licence">
              Topics: Nave's Topical Bible and Torrey's New Topical Textbook. Dictionary: Easton's and Smith's Bible Dictionaries. Cross-references: OpenBible.info (CC BY 4.0). The rest is public domain.
              Everything works offline.
            </p>
          </>
        )}
      </main>

      {speaking != null && (
        <div className="playing">
          <span>
            Reading {place.book} {place.chapter}:{speaking}
          </span>
          <button onClick={stopListening}>Stop</button>
        </div>
      )}

      <nav className="tabs">
        {(
          [
            ["read", "Read"],
            ["search", "Search"],
            ["study", "My Study"],
            ["plans", "Plans"],
            ["more", "More"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} className={tab === key ? "on" : ""} onClick={() => setTab(key)} aria-current={tab === key}>
            {label}
          </button>
        ))}
      </nav>

      {toast && <div className="toast" role="status">{toast}</div>}

      {chosenVerse && (
        <VerseSheet
          book={place.book}
          chapter={place.chapter}
          verse={chosenVerse}
          version={version}
          color={highlightOf.get(chosenVerse.verse) ?? null}
          bookmarked={marks.bookmarks.includes(chosenVerse.verse)}
          onClose={() => setChosen(null)}
          onBookmark={() => {
            void bookmark(place.book, place.chapter, chosenVerse.verse);
            setChosen(null);
          }}
          onHighlight={(c) => {
            void highlight(place.book, place.chapter, chosenVerse.verse, c);
            setChosen(null);
          }}
          onListen={() => void listenFrom(chosenVerse.verse)}
          onGo={go}
          onChanged={changed}
          ask={ask}
          say={say}
          fail={fail}
        />
      )}

      {picker && (
        <Sheet tall onClose={() => setPicker(null)}>
          {picker.book ? (
            <>
              <h3>
                <button className="link" onClick={() => setPicker({ ...picker, book: null })}>
                  ‹ Books
                </button>{" "}
                {picker.book.name}
              </h3>
              <div className="grid numbers">
                {Array.from({ length: picker.book.chapters }, (_, i) => i + 1).map((n) => (
                  <button key={n} className={picker.book?.name === place.book && n === place.chapter ? "on" : ""} onClick={() => go(picker.book!.name, n)}>
                    {n}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="chips">
                {(["OT", "NT"] as const).map((t) => (
                  <button key={t} className={picker.testament === t ? "on" : ""} onClick={() => setPicker({ book: null, testament: t })}>
                    {t === "OT" ? "Old Testament" : "New Testament"}
                  </button>
                ))}
              </div>
              <div className="grid">
                {books
                  .filter((b) => b.testament === picker.testament)
                  .map((b) => (
                    <button key={b.name} className={b.name === place.book ? "on" : ""} onClick={() => (b.chapters === 1 ? go(b.name, 1) : setPicker({ ...picker, book: b }))}>
                      {b.name}
                    </button>
                  ))}
              </div>
            </>
          )}
        </Sheet>
      )}

      {asking && (
        <Sheet onClose={() => setAsking(null)}>
          <p className="question">{asking.message}</p>
          <div className="actions">
            <button onClick={() => setAsking(null)}>Cancel</button>
            <button
              className="primary danger"
              onClick={() => {
                const then = asking.then;
                setAsking(null);
                then();
              }}
            >
              {asking.yes}
            </button>
          </div>
        </Sheet>
      )}

      {article && (
        <Sheet tall onClose={() => setArticle(null)}>
          <h3>
            {article.name} <small>{article.source}</small>
          </h3>
          <ArticleBody text={article.body} onGo={go} />
        </Sheet>
      )}
    </div>
  );
}

function HitList({ hits, showWhy, onOpen }: { hits: Hit[]; showWhy: boolean; onOpen: (book: string, chapter: number, verse: number) => void }) {
  return (
    <ul className="hits">
      {hits.map((h) => (
        <li key={`${h.book}-${h.chapter}-${h.verse}`} onClick={() => onOpen(h.book, h.chapter, h.verse)}>
          <div className="hit-head">
            <strong>{refLabel(h)}</strong>
            {showWhy && h.why.filter((w) => WHY[w]).map((w) => <span key={w} className={`why why-${w}`}>{WHY[w]}</span>)}
          </div>
          <span>{h.text}</span>
        </li>
      ))}
    </ul>
  );
}

// ⟦Book|chapter|verse|verse_end|label⟧ marks a Scripture reference in a dictionary article.
const MARKER = /⟦([^|⟧]*)\|(\d+)\|(\d*)\|(\d*)\|([^⟧]*)⟧/g;

/** A dictionary article: paragraphs of plain text, with its references as links. */
function ArticleBody({ text, onGo }: { text: string; onGo: (book: string, chapter: number, verse: number | null) => void }) {
  return (
    <div className="article-body">
      {text.split(/\n{2,}/).map((para, pi) => {
        const parts: React.ReactNode[] = [];
        let last = 0;
        for (const m of para.matchAll(MARKER)) {
          const at = m.index ?? 0;
          if (at > last) parts.push(para.slice(last, at));
          const [, book, chapter, verse, , label] = m;
          parts.push(
            <button key={at} className="ref" onClick={() => onGo(book, Number(chapter), verse ? Number(verse) : null)}>
              {label}
            </button>,
          );
          last = at + m[0].length;
        }
        if (last < para.length) parts.push(para.slice(last));
        return <p key={pi}>{parts}</p>;
      })}
    </div>
  );
}

interface VerseSheetProps {
  book: string;
  chapter: number;
  verse: Verse;
  version: string;
  color: string | null;
  bookmarked: boolean;
  onClose: () => void;
  onBookmark: () => void;
  onHighlight: (color: string | null) => void;
  onListen: () => void;
  onGo: (book: string, chapter: number, verse: number | null) => void;
  onChanged: () => void;
  ask: (message: string, yes: string, then: () => void) => void;
  say: (message: string) => void;
  fail: (e: unknown) => void;
}

/** Everything that can be done with one verse: mark it, write a note on it, pass it on,
 * hear it, and see what else Scripture says alongside it. */
function VerseSheet({ book, chapter, verse, version, color, bookmarked, onClose, onBookmark, onHighlight, onListen, onGo, onChanged, ask, say, fail }: VerseSheetProps) {
  const [view, setView] = useState<"main" | "note" | "refs" | "compare">("main");
  const [note, setNote] = useState("");
  const [had, setHad] = useState(false);
  const [refs, setRefs] = useState<Hit[] | null>(null);
  const [all, setAll] = useState<[string, string][] | null>(null);
  const label = `${book} ${chapter}:${verse.verse}`;
  const quoted = `${label} (${version}) — ${verse.text}`;

  useEffect(() => {
    api
      .note(book, chapter, verse.verse)
      .then((n) => {
        setNote(n);
        setHad(!!n);
      })
      .catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapter, verse.verse]);

  useEffect(() => {
    if (view === "refs" && !refs) api.crossRefs(version, book, chapter, verse.verse).then(setRefs).catch(fail);
    if (view === "compare" && !all) api.compare(book, chapter, verse.verse).then(setAll).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const saveNote = (body: string) =>
    api
      .setNote(book, chapter, verse.verse, body)
      .then(() => {
        onChanged();
        say(body.trim() ? "Note saved" : "Note deleted");
        onClose();
      })
      .catch(fail);

  return (
    <Sheet tall={view !== "main"} onClose={onClose}>
      <h3>
        {view !== "main" && (
          <button className="link" onClick={() => setView("main")}>
            ‹
          </button>
        )}
        {label} <small>{version}</small>
      </h3>
      {view === "main" && (
        <>
          <p className="sheet-text">{verse.text}</p>
          {had && (
            <button className="note-peek" onClick={() => setView("note")}>
              ✎ {note}
            </button>
          )}
          <div className="colors" role="group" aria-label="Highlight">
            {COLORS.map((c) => (
              <button key={c} className={`dot hl-${c}` + (color === c ? " on" : "")} aria-label={`Highlight ${COLOR_NAMES[c]}`} onClick={() => onHighlight(color === c ? null : c)} />
            ))}
            {color && (
              <button className="text" onClick={() => onHighlight(null)}>
                Clear
              </button>
            )}
          </div>
          <div className="actions wrap">
            <button onClick={onBookmark}>{bookmarked ? "Remove bookmark" : "Bookmark"}</button>
            <button onClick={() => setView("note")}>{had ? "Edit note" : "Add a note"}</button>
            <button onClick={() => setView("refs")}>Cross-references</button>
            <button onClick={() => setView("compare")}>Compare translations</button>
            <button onClick={onListen}>Listen from here</button>
            <button
              onClick={() =>
                phone
                  .share(quoted, label)
                  .then(onClose)
                  .catch(async () => {
                    // (not on a phone) the next best thing
                    say((await copy(quoted)) ? "Copied" : "Couldn't share");
                    onClose();
                  })
              }
            >
              Share
            </button>
            <button
              onClick={async () => {
                const ok = await copy(quoted);
                onClose();
                say(ok ? "Copied" : "Couldn't copy");
              }}
            >
              Copy
            </button>
          </div>
        </>
      )}
      {view === "note" && (
        <>
          <p className="sheet-text small">{verse.text}</p>
          <textarea className="field note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Your note on this verse" rows={6} autoFocus={!had} />
          <div className="actions">
            {had && <button onClick={() => ask(`Delete your note on ${label}?`, "Delete", () => void saveNote(""))}>Delete</button>}
            <button className="primary" disabled={!note.trim() && !had} onClick={() => void saveNote(note)}>
              Save
            </button>
          </div>
        </>
      )}
      {view === "refs" && (
        <>
          <p className="hint">Verses most often read alongside this one.</p>
          {refs && refs.length === 0 && <p className="hint">No cross-references for this verse.</p>}
          <HitList hits={refs ?? []} showWhy={false} onOpen={onGo} />
        </>
      )}
      {view === "compare" && (
        <ul className="hits plain">
          {(all ?? []).map(([code, text]) => (
            <li key={code}>
              <div className="hit-head">
                <strong>{code}</strong>
              </div>
              <span>{text}</span>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/** A panel that slides up from the bottom; a tap outside it closes it. */
function Sheet({ children, onClose, tall = false }: { children: React.ReactNode; onClose: () => void; tall?: boolean }) {
  return (
    <div className="veil" onClick={onClose}>
      <div className={"sheet" + (tall ? " tall" : "")} role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="grip" aria-hidden />
        {children}
      </div>
    </div>
  );
}
