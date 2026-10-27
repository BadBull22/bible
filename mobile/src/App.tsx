import { useEffect, useMemo, useRef, useState } from "react";
import { exit, onBackButtonPress } from "@tauri-apps/api/app";
import {
  api,
  Article,
  ArticleHead,
  Book,
  ChapterMarks,
  COLORS,
  COLOR_NAMES,
  colorName,
  CommentaryAbout,
  CommentaryNote,
  Counts,
  Hit,
  Mark,
  MarkKind,
  phone,
  PhoneVoice,
  PlanProgress,
  ReadingStats,
  SearchResult,
  Answer,
  Topic,
  Verse,
  Version,
} from "./api";
import { applyAppearance, Contrast, DEFAULT_APPEARANCE, Font, TextColor, Theme, watchSystemTheme } from "./appearance";
import { buildPlan, currentDay, describeReadings, PLANS, todayIso } from "./plans";
import { parseReference, Reference } from "./refs";
import { canRemind, setReminder, testReminder } from "./reminder";
import { Translations } from "./Translations";
import { UpdateBanner, UpdateSettings, useUpdates } from "./Updates";
import { SyncSettings, useAutoSync } from "./Sync";
import { OriginalPack, OriginalSettings, useOriginalPack } from "./OriginalWords";
import { SearchUpgradeOffer, SearchUpgradeSettings, useSearchUpgrade } from "./SearchUpgrade";
import { AskAnswer } from "./AskAnswer";
import { Library } from "./Library";
import { VersePicture } from "./VersePicture";
import { verseForToday } from "./votd";
import { WordStudy } from "./WordStudy";

type Tab = "read" | "search" | "study" | "plans" | "more";

interface Saved {
  version: string;
  book: string;
  chapter: number;
  size: number;
  theme: Theme;
  textColor: TextColor;
  contrast: Contrast;
  font: Font;
  /** show the verse for the day when the app opens */
  dayVerse: boolean;
  /** how fast the phone's voice reads */
  rate: number;
  /** the phone voice chosen (one of phone.voices' names), or null for the default */
  voice: string | null;
  /** the words of Jesus in red */
  red: boolean;
  /** a second translation shown under each verse, or null */
  second: string | null;
  /** the daily reminder's time ("07:30"), or null when it is off */
  reminder: string | null;
  /** look for a newer version of the app once a day */
  updates: boolean;
}

const SAVED_KEY = "pocket:state";
const RECENT_KEY = "pocket:recent";
const DAY_SEEN_KEY = "pocket:day-verse-seen";

function loadSaved(): Saved {
  const start: Saved = {
    version: "BSB",
    book: "John",
    chapter: 1,
    size: 1,
    ...DEFAULT_APPEARANCE,
    dayVerse: true,
    rate: 1,
    voice: null,
    red: true,
    second: null,
    reminder: null,
    updates: true,
  };
  try {
    // (the words of Jesus in red and the verse for the day are always on; they have no switch any more)
    return { ...start, ...(JSON.parse(localStorage.getItem(SAVED_KEY) ?? "{}") as Partial<Saved>), red: true, dayVerse: true };
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

const WHY: Record<string, string> = { story: "Well-known passage", core: "Key passage", phrase: "Exact words", topical: "Topic" };

/** A search on the web, for when the Bible in the app isn't enough. */
const webSearch = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(`${query} Bible`)}`;
/** An explanation in More (as against a line saying how things stand). */
const EXPLAIN = ".hint:not(.keep):not(.status)";

/** The reading speed slider: -10 (slowest) to +10 (fastest), 0 in the middle = the normal speed; each step is about 7 %. */
const rateToStep = (rate: number) => Math.max(-10, Math.min(10, Math.round(Math.log2(rate) * 10)));
const stepToRate = (step: number) => Math.round(2 ** (step / 10) * 100) / 100;

const refLabel = (h: { book: string; chapter: number; verse: number; verse_end?: number }) =>
  `${h.book} ${h.chapter}:${h.verse}${h.verse_end && h.verse_end > h.verse ? `–${h.verse_end}` : ""}`;

// --- the words of Jesus. A verse says which of its words are His, as [first, last] ranges
// counting words (runs of letters and digits) -- the desktop app's rule (src/redLetter.ts),
// which this follows, widening each range over the punctuation and quotation marks touching it.
const WORD = /[\p{L}\p{N}]+/gu;
const WORD_CHAR = /[\p{L}\p{N}]/u;

function redParts(text: string, ranges: [number, number][]): { text: string; red: boolean }[] {
  const words = [...text.matchAll(WORD)].map((m) => [m.index, m.index + m[0].length] as const);
  const spans: [number, number][] = [];
  for (const [a, b] of ranges) {
    const first = words[a];
    const last = words[Math.min(b, words.length - 1)];
    if (!first || !last) continue;
    let s = first[0];
    let e = last[1];
    while (s > 0 && !/\s/.test(text[s - 1]) && !WORD_CHAR.test(text[s - 1])) s--;
    while (e < text.length && !/\s/.test(text[e]) && !WORD_CHAR.test(text[e])) e++;
    spans.push([s, e]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  const parts: { text: string; red: boolean }[] = [];
  let at = 0;
  for (const [s, e] of spans) {
    if (e <= at) continue;
    const from = Math.max(s, at);
    if (from > at) parts.push({ text: text.slice(at, from), red: false });
    parts.push({ text: text.slice(from, e), red: true });
    at = e;
  }
  if (at < text.length) parts.push({ text: text.slice(at), red: false });
  return parts;
}

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

const SLEEP: [string, string][] = [
  ["off", "No timer"],
  ["15", "Stop in 15 min"],
  ["30", "Stop in 30 min"],
  ["60", "Stop in 60 min"],
  ["chapter", "Stop after this chapter"],
];

/** Chapters in the 66 books, for "how much of the Bible have I read". */
const ALL_CHAPTERS = 1189;

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
  const [textColor, setTextColor] = useState<TextColor>(saved.textColor);
  const [contrast, setContrast] = useState<Contrast>(saved.contrast);
  const [font, setFont] = useState<Font>(saved.font);
  const dayVerse = true;
  const [autoUpdates, setAutoUpdates] = useState(saved.updates);
  const updates = useUpdates(saved.updates);
  const [rate, setRate] = useState(saved.rate);
  const [voice, setVoice] = useState<string | null>(saved.voice);
  const [voices, setVoices] = useState<PhoneVoice[] | null>(null);
  const red = true;
  const [second, setSecond] = useState<string | null>(saved.second);
  const [reminder, setReminderTime] = useState<string | null>(saved.reminder);
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
  const moreBox = useRef<HTMLDivElement>(null);
  /** More: tapping a heading shows (or hides) the explanations under it, up to the next heading. The headings that have some show a small (i). */
  const toggleExplanations = (e: React.MouseEvent) => {
    const h = (e.target as HTMLElement).closest("h2");
    if (!h || !moreBox.current?.contains(h)) return;
    const shown = !h.classList.contains("open");
    h.classList.toggle("open", shown);
    h.nextElementSibling?.classList.contains("info-pop") && h.nextElementSibling.remove();
    if (!shown) return;
    const pop = document.createElement("div");
    pop.className = "info-pop";
    for (let el = h.nextElementSibling; el && el.tagName !== "H2"; el = el.nextElementSibling) {
      const hints = el.matches(EXPLAIN) ? [el] : Array.from(el.querySelectorAll(EXPLAIN));
      hints.forEach((x) => pop.appendChild(Object.assign(document.createElement("p"), { textContent: x.textContent ?? "" })));
    }
    h.after(pop);
  };
  useEffect(() => {
    // (after every drawing: a heading shows its (i) when something under it is an explanation)
    moreBox.current?.querySelectorAll("h2").forEach((h) => {
      let has = false;
      for (let el = h.nextElementSibling; el && el.tagName !== "H2"; el = el.nextElementSibling) {
        if (el.matches(EXPLAIN) || el.querySelector(EXPLAIN)) has = true;
      }
      h.classList.toggle("has-info", has);
    });
  });
  const [secondVerses, setSecondVerses] = useState<Map<number, string>>(new Map());
  // the book's introduction, or the commentary's notes on the chapter
  const [study, setStudy] = useState<null | { kind: "intro"; text: string } | { kind: "notes"; notes: CommentaryNote[] }>(null);
  const [about, setAbout] = useState<CommentaryAbout | null>(null);
  const [showTranslations, setShowTranslations] = useState(false);
  // the Library: open (on its first page, or on the chapter's commentaries)
  const [library, setLibrary] = useState<null | "home" | "commentary">(null);
  const [hasCommentary, setHasCommentary] = useState(false);
  useEffect(() => {
    if (library !== null) return;
    api
      .libraryInstalled()
      .then((m) => setHasCommentary(m.some((x) => x.kind === "commentary")))
      .catch(() => undefined);
  }, [library]);

  // reading aloud: the verse being spoken; each run has a number, so an old one knows to stop
  const [speaking, setSpeaking] = useState<number | null>(null);
  const run = useRef(0);
  const thenListen = useRef(false);
  // the sleep timer: "off", minutes ("15"), or "chapter" (stop at the end of this one)
  const [sleep, setSleep] = useState("off");
  const sleepAt = useRef<number | null>(null);

  // searching
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "OT" | "NT" | "book">("all");
  const [result, setResult] = useState<SearchResult | null>(null);
  // an answer above the results, when the search is a question (as the desktop's "Ask")
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [topic, setTopic] = useState<{ topic: Topic; hits: Hit[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const searchUpgrade = useSearchUpgrade();
  // the Greek and Hebrew words one by one (an optional download), in Word Study and in More
  const originalPack = useOriginalPack();
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [article, setArticle] = useState<Article | null>(null);

  // my study
  const [kind, setKind] = useState<MarkKind>("highlights");
  const [openMarks, setOpenMarks] = useState<Set<string>>(new Set());
  const [list, setList] = useState<Mark[]>([]);
  // the reader's names for the highlight colours (kept in step with the computer)
  const [names, setNames] = useState<Record<string, string>>({});
  const [tags, setTags] = useState<[string, number][]>([]);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  // reading plans, and the streak
  const [progress, setProgress] = useState<PlanProgress[]>([]);
  const [stats, setStats] = useState<ReadingStats | null>(null);

  // dictionary and backup (More)
  const [word, setWord] = useState("");
  const [found, setFound] = useState<ArticleHead[] | null>(null);
  const [backupNote, setBackupNote] = useState<string | null>(null);

  const fail = (e: unknown) => setError(String(e));
  const say = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 1800);
  };

  const loadVersions = () =>
    api
      .versions()
      .then((vs) => {
        setVersions(vs);
        // a translation removed from the phone gives way to the BSB
        setVersion((v) => (vs.some((x) => x.code === v) ? v : "BSB"));
        setSecond((v) => (v && vs.some((x) => x.code === v) ? v : null));
      })
      .catch(fail);

  useEffect(() => {
    void loadVersions();
    api.books().then(setBooks).catch(fail);
    api.commentaryAbout().then(setAbout).catch(() => undefined);
    // the plans now, so the daily reminder can name the one being read
    api.planProgress().then(setProgress).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    store(
      SAVED_KEY,
      JSON.stringify({ version, ...place, size, theme, textColor, contrast, font, dayVerse, rate, voice, red, second, reminder, updates: autoUpdates } satisfies Saved),
    );
  }, [version, place, size, theme, textColor, contrast, font, dayVerse, rate, voice, red, second, reminder, autoUpdates]);

  // the look: applied now, and again when the phone switches between light and dark
  useEffect(() => {
    const a = { theme, textColor, contrast, font };
    applyAppearance(a);
    return theme === "system" ? watchSystemTheme(() => applyAppearance(a)) : undefined;
  }, [theme, textColor, contrast, font]);

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

  // the second translation, verse by verse
  useEffect(() => {
    if (!second || second === version) {
      setSecondVerses(new Map());
      return;
    }
    let current = true;
    api
      .chapter(second, place.book, place.chapter)
      .then((v) => current && setSecondVerses(new Map(v.map((x) => [x.verse, x.text]))))
      .catch(() => current && setSecondVerses(new Map()));
    return () => {
      current = false;
    };
  }, [second, version, place]);

  // --- the reading streak: a chapter counts as read when its end has been reached and it
  // has been open for a little while (or it was listened to the end)
  const loadStats = () => api.readingStats(todayIso()).then(setStats).catch(() => undefined);
  useEffect(() => {
    void loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reading = useRef({ key: "", openedAt: 0, endSeen: false, done: false });
  const endRef = useRef<HTMLElement>(null);

  function markRead(book: string, chapter: number) {
    const before = stats;
    api
      .markRead(book, chapter, todayIso())
      .then(() => api.readingStats(todayIso()))
      .then((s) => {
        setStats(s);
        if (before && !before.read_today && s.read_today) say(s.streak > 1 ? `${s.streak} days in a row` : "Read today ✓");
      })
      .catch(() => undefined);
  }

  function tryMarkRead() {
    const r = reading.current;
    if (r.done || !r.endSeen || Date.now() - r.openedAt < 15000) return;
    r.done = true;
    markRead(place.book, place.chapter);
  }

  useEffect(() => {
    if (tab !== "read" || verses.length === 0) return;
    const key = `${version}|${place.book}|${place.chapter}`;
    if (reading.current.key !== key) reading.current = { key, openedAt: Date.now(), endSeen: false, done: false };
    const el = endRef.current;
    const seen = el
      ? new IntersectionObserver((entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            reading.current.endSeen = true;
            tryMarkRead();
          }
        })
      : null;
    if (el && seen) seen.observe(el);
    const t = window.setInterval(tryMarkRead, 5000);
    return () => {
      seen?.disconnect();
      window.clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verses, tab]);

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
    setStudy(null);
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
        done = (await phone.speak(v.text, rate, voice)).finished;
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
    // listened to the end: that counts as read
    if (reading.current.key.endsWith(`|${place.book}|${place.chapter}`) && !reading.current.done) {
      reading.current.done = true;
      markRead(place.book, place.chapter);
    }
    if (sleepRef.current === "chapter") {
      setSleep("off");
      return;
    }
    const to = nextRef.current;
    if (to) {
      thenListen.current = true;
      setTarget(null);
      setPlace(to);
    }
  }

  function stopListening() {
    setSleep("off");
    if (speaking == null && !thenListen.current) return;
    run.current++;
    thenListen.current = false;
    setSpeaking(null);
    void phone.stopSpeaking().catch(() => undefined);
  }

  // the sleep timer
  const sleepRef = useRef(sleep);
  sleepRef.current = sleep;
  useEffect(() => {
    const minutes = Number(sleep);
    sleepAt.current = minutes > 0 ? Date.now() + minutes * 60000 : null;
    if (!sleepAt.current) return;
    const t = window.setInterval(() => {
      if (sleepAt.current && Date.now() >= sleepAt.current) stopListening();
    }, 5000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleep]);

  // the phone's voices, the first time More is opened
  useEffect(() => {
    if (tab !== "more" || voices) return;
    phone
      .voices()
      .then((r) => setVoices(r.voices))
      .catch(() => setVoices([]));
  }, [tab, voices]);

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
    setAnswer(null);
    api
      .ask(query)
      .then((a) => current && setAnswer(a))
      .catch(() => undefined);
    api
      .search(query, version, scope === "OT" || scope === "NT" ? scope : null, scope === "book" ? place.book : null)
      .then((r) => current && setResult(r))
      .catch(fail)
      .finally(() => current && setSearching(false));
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, version, scope, scope === "book" ? place.book : "", searchUpgrade.installed]);

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
    api.allTags().then(setTags).catch(() => undefined);
  }, [tab, kind, version, marksVersion]);

  const highlightOf = useMemo(() => new Map(marks.highlights), [marks]);
  const changed = () => setMarksVersion((n) => n + 1);
  useEffect(() => {
    api
      .highlightNames()
      .then(setNames)
      .catch(() => undefined);
  }, [marksVersion]);
  // the shared folder with the computers: their changes arriving show at once
  useAutoSync(changed);

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
    if (tab === "plans") {
      void loadPlans();
      void loadStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // the daily reminder: scheduled again whenever its time or the plans change
  const reminderBody = () => {
    const plan = PLANS.find((p) => progress.some((x) => x.plan_id === p.id));
    return plan ? `Today's reading in “${plan.name}” is waiting.` : "A few minutes with the Bible today?";
  };
  async function chooseReminder(time: string | null) {
    const ok = await setReminder(time, reminderBody()).catch((e) => {
      fail(e);
      return false;
    });
    if (time && !ok) {
      say("Notifications aren't allowed for this app");
      setReminderTime(null);
      return;
    }
    setReminderTime(time);
    if (time) say(`Reminder set for ${time} every day`);
  }
  useEffect(() => {
    if (reminder) void setReminder(reminder, reminderBody()).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  // --- the book's introduction and the chapter's notes
  const openIntro = () =>
    api
      .bookIntro(place.book)
      .then((text) => setStudy({ kind: "intro", text }))
      .catch(fail);
  const openChapterNotes = () =>
    api
      .chapterNotes(place.book, place.chapter)
      .then((notes) => setStudy({ kind: "notes", notes }))
      .catch(fail);

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
  useBack(study != null, () => setStudy(null));
  useBack(showTranslations, () => setShowTranslations(false));
  useBack(library !== null, () => setLibrary(null));

  const chosenVerse = chosen != null ? verses.find((v) => v.verse === chosen) : undefined;
  const shown = topic ? topic.hits : (result?.hits ?? []);
  const versionName = versions.find((v) => v.code === version);
  const secondName = versions.find((v) => v.code === second);
  const shownList = tagFilter ? list.filter((m) => m.tags.some((t) => t.toLowerCase() === tagFilter.toLowerCase())) : list;

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
          <optgroup label="Built in">
            {versions
              .filter((v) => !v.downloaded)
              .map((v) => (
                <option key={v.code} value={v.code}>
                  {v.code}
                </option>
              ))}
          </optgroup>
          {versions.some((v) => v.downloaded) && (
            <optgroup label="Downloaded">
              {versions
                .filter((v) => v.downloaded)
                .map((v) => (
                  <option key={v.code} value={v.code}>
                    {v.name.length > 14 ? v.code : v.name}
                  </option>
                ))}
            </optgroup>
          )}
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
      <UpdateBanner updates={updates} />

      <main ref={pane} className="pane" onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })} onTouchEnd={tab === "read" ? swiped : undefined}>
        {tab === "read" && (
          <>
            <button className="place" onClick={() => setPicker({ book: null, testament: bookInfo?.testament ?? "NT" })}>
              {place.book} {place.chapter} <span aria-hidden>▾</span>
            </button>
            <div className="read-tools">
              <button onClick={() => void openIntro()}>About {place.book}</button>
              <button onClick={() => void openChapterNotes()}>Study notes</button>
              {hasCommentary && <button onClick={() => setLibrary("commentary")}>Commentaries</button>}
              <select
                className={second ? "on" : ""}
                value={second ?? ""}
                onChange={(e) => setSecond(e.target.value || null)}
                aria-label="A second translation under each verse"
              >
                <option value="">Side by side…</option>
                {versions
                  .filter((v) => v.code !== version)
                  .map((v) => (
                    <option key={v.code} value={v.code}>
                      + {v.downloaded ? v.name : v.code}
                    </option>
                  ))}
              </select>
            </div>
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
            <div className="chapter" dir={versionName?.rtl ? "rtl" : undefined}>
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
                    {red && v.red.length > 0 ? redParts(v.text, v.red).map((p, i) => (p.red ? <span key={i} className="wj">{p.text}</span> : p.text)) : v.text}
                    {marks.notes.includes(v.verse) && <span className="has-note" aria-label="Has a note">✎</span>}
                    {secondVerses.has(v.verse) && (
                      <span className="verse-second" dir={secondName?.rtl ? "rtl" : undefined}>
                        <b>{second}</b>
                        {secondVerses.get(v.verse)}
                      </span>
                    )}
                  </p>
                );
              })}
            </div>
            <nav className="turn" ref={endRef}>
              <button disabled={!prev} onClick={() => prev && go(prev.book, prev.chapter)}>
                ‹ {prev ? `${prev.book} ${prev.chapter}` : ""}
              </button>
              <button disabled={!next} onClick={() => next && go(next.book, next.chapter)}>
                {next ? `${next.book} ${next.chapter}` : ""} ›
              </button>
            </nav>
            <p className="licence">
              {versionName?.name} · {versionName?.license_note}
              {secondName && ` — ${secondName.name} · ${secondName.license_note}`}
            </p>
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
                {!query && !typed.trim() && (
                  <section className="dictionary">
                    <h3>Bible dictionary</h3>
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
                  </section>
                )}
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
                    {result.corrected.length > 0 && (
                      <>
                        {" "}
                        Searched for <strong>{result.corrected.map(([, to]) => to).join(", ")}</strong>.
                      </>
                    )}{" "}
                    <button className="link" onClick={() => void phone.openLink(webSearch(query)).catch(fail)}>
                      Search online
                    </button>
                  </p>
                )}
                {query && answer && <AskAnswer answer={answer} books={books} onOpen={go} onArticle={openArticle} />}
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
            {!topic && query && result && !searching && (
              <>
                <SearchUpgradeOffer upgrade={searchUpgrade} />
                <div className="actions">
                  <button onClick={() => void phone.openLink(webSearch(query)).catch(fail)}>Search online for “{query}”</button>
                </div>
              </>
            )}
          </>
        )}

        {tab === "study" && (
          <>
            <div className="chips segmented" role="tablist">
              {(
                [
                  ["highlights", "Highlights"],
                  ["bookmarks", "Bookmarks"],
                  ["notes", "Notes"],
                ] as const
              ).map(([key, label]) => (
                <button key={key} role="tab" aria-selected={kind === key} className={kind === key ? "on" : ""} onClick={() => setKind(key)}>
                  {label}
                </button>
              ))}
            </div>
            {kind !== "highlights" && tags.length > 0 && (
              <div className="chips" role="group" aria-label="Tags">
                <button className={tagFilter == null ? "on" : ""} onClick={() => setTagFilter(null)}>
                  All
                </button>
                {tags.map(([t, n]) => (
                  <button key={t} className={tagFilter === t ? "on" : ""} onClick={() => setTagFilter(tagFilter === t ? null : t)}>
                    {t} <small>{n}</small>
                  </button>
                ))}
              </div>
            )}
            {list.length === 0 && (
              <p className="hint">
                {kind === "bookmarks" ? "No bookmarks yet." : kind === "highlights" ? "No highlights yet." : "No notes yet."} Tap a verse while reading to{" "}
                {kind === "bookmarks" ? "bookmark it" : kind === "highlights" ? "highlight it" : "write a note on it"}.
                {kind !== "highlights" && " Bookmarks and notes can have tags, to group them (“Prayer”, “Sunday's sermon”)."}
              </p>
            )}
            {list.length > 0 && shownList.length === 0 && <p className="hint">Nothing here has the tag “{tagFilter}”.</p>}
            {(kind === "highlights" ? COLORS.filter((c) => list.some((m) => m.color === c)) : [null]).map((color) => (
              // highlights: one folded group per colour, as on the computer
              <details key={color ?? "all"} className={color ? `hl-group hl-${color}` : "hl-all"} open={color == null}>
                {color ? (
                  <summary>
                    <i className={`dot hl-${color}`} /> <span>{colorName(color, names)}</span> <small>{list.filter((m) => m.color === color).length}</small>
                  </summary>
                ) : (
                  // (an empty heading, hidden by the style: a details block without one shows the word “Details”)
                  <summary />
                )}
                <ul className="hits">
                  {(kind === "highlights" ? list : shownList)
                    .filter((m) => color == null || m.color === color)
                    .map((m) => (
                      <li
                        key={`${m.book}-${m.chapter}-${m.verse}`}
                        className={`${color ? `hl-${color}` : ""}${kind === "bookmarks" ? " mark-fold" : ""}${kind === "bookmarks" && openMarks.has(`${m.book} ${m.chapter}:${m.verse}`) ? " open" : ""}`}
                        onClick={() => {
                          if (kind !== "bookmarks") return go(m.book, m.chapter, m.verse);
                          // a bookmark shows only its reference until tapped
                          const key = `${m.book} ${m.chapter}:${m.verse}`;
                          setOpenMarks((s) => {
                            const n = new Set(s);
                            if (!n.delete(key)) n.add(key);
                            return n;
                          });
                        }}
                      >
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
                        {m.tags.length > 0 && (kind !== "bookmarks" || openMarks.has(`${m.book} ${m.chapter}:${m.verse}`)) && (
                          <div className="tag-row">
                            {m.tags.map((t) => (
                              <span key={t} className="tag">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                        {(kind !== "bookmarks" || openMarks.has(`${m.book} ${m.chapter}:${m.verse}`)) && <span>{m.text}</span>}
                        {kind === "bookmarks" && openMarks.has(`${m.book} ${m.chapter}:${m.verse}`) && (
                          <div className="actions open-here">
                            <button
                              className="primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                go(m.book, m.chapter, m.verse);
                              }}
                            >
                              Go there
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMarks((s) => {
                                  const n = new Set(s);
                                  n.delete(`${m.book} ${m.chapter}:${m.verse}`);
                                  return n;
                                });
                              }}
                            >
                              Close
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                </ul>
              </details>
            ))}
          </>
        )}

        {tab === "plans" && (
          <>
            <h2>Your reading</h2>
            {stats && (
              <>
                <div className="streak">
                  <div className={stats.streak > 0 ? "hot" : ""}>
                    <strong>{stats.streak > 0 ? `🔥 ${stats.streak}` : "0"}</strong>
                    <span>day{stats.streak === 1 ? "" : "s"} in a row</span>
                  </div>
                  <div>
                    <strong>{stats.best_streak}</strong>
                    <span>best run</span>
                  </div>
                  <div>
                    <strong>{stats.days}</strong>
                    <span>day{stats.days === 1 ? "" : "s"} read</span>
                  </div>
                </div>
                <p className="hint">
                  {stats.chapters.toLocaleString()} of {ALL_CHAPTERS.toLocaleString()} chapters of the Bible read ({Math.floor((stats.chapters / ALL_CHAPTERS) * 100)}%).{" "}
                  {stats.read_today ? "You've read today." : "A chapter counts once you reach its end."}
                </p>
                <div className="bar" aria-hidden>
                  <i style={{ width: `${Math.min(100, (stats.chapters / ALL_CHAPTERS) * 100)}%` }} />
                </div>
              </>
            )}

            <h3>Daily reminder</h3>
            {canRemind ? (
              <>
                <div className="time-row">
                  <label className="toggle" style={{ margin: 0 }}>
                    <input type="checkbox" checked={reminder != null} onChange={(e) => void chooseReminder(e.target.checked ? "07:00" : null)} /> Remind me every day at
                  </label>
                  <input type="time" value={reminder ?? "07:00"} disabled={reminder == null} onChange={(e) => e.target.value && void chooseReminder(e.target.value)} aria-label="Reminder time" />
                </div>
                <p className="hint">A notification once a day, even when the app is closed.</p>
                <div className="actions">
                  <button onClick={() => void testReminder().then((ok) => say(ok ? "A test reminder will come in about a minute" : "Notifications aren't allowed for this app")).catch(fail)}>
                    Test the reminder
                  </button>
                  <button onClick={() => void phone.batterySettings().catch(fail)}>Let it run in the background</button>
                </div>
                <p className="hint">
                  If the test doesn't arrive, allow the app to run in the background. On Huawei and Honor phones also open Settings → Apps → App launch → Bible
                  Concordance, switch to <em>Manage manually</em> and turn on all three; on Samsung, Settings → Battery → Background usage limits.
                </p>
              </>
            ) : (
              <p className="hint">The daily reminder works on the phone.</p>
            )}

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
                    Day {day} of {plan.days} · {done.size} day{done.size === 1 ? "" : "s"} read · {Math.round((done.size / plan.days) * 100)}% done
                    {behindCount(day, done) > 0 && ` · ${behindCount(day, done)} day${behindCount(day, done) === 1 ? "" : "s"} to catch up`}
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
          <div className="more" ref={moreBox} onClick={toggleExplanations}>
            <h2>Translations</h2>
            <p className="hint keep">
              Built in: {versions.filter((v) => !v.downloaded).map((v) => v.code).join(", ")}.
              {versions.some((v) => v.downloaded) && ` Downloaded: ${versions.filter((v) => v.downloaded).map((v) => v.name).join(", ")}.`}
            </p>
            <div className="actions">
              <button onClick={() => setShowTranslations(true)}>More translations (other languages)</button>
            </div>

            <h2>Additional downloads</h2>
            <p className="hint keep">Everything you add is available offline.</p>
            <details className="fold">
              <summary>Library</summary>
              <p className="hint keep">Commentaries, dictionaries, books and devotionals: free ones from CrossWire, or files you have.</p>
              <div className="actions">
                <button onClick={() => setLibrary("home")}>Open the library</button>
              </div>
            </details>
            <details className="fold">
              <summary>
                Advanced search <em>(Recommended)</em>
                {searchUpgrade.installed && <small>✓</small>}
              </summary>
              <SearchUpgradeSettings upgrade={searchUpgrade} bare />
            </details>
            <details className="fold">
              <summary>
                Original words <em>(Recommended)</em>
                {originalPack.installed && <small>✓</small>}
              </summary>
              <OriginalSettings pack={originalPack} bare />
            </details>

            <h2>Name your highlights</h2>
            <p className="hint">Give each colour a meaning (“Promises”, “Old Testament prophecy”). Names you give on the computer show here too when the two keep in step.</p>
            <div className="hl-names">
              {COLORS.map((c) => (
                <label key={c} className={`hl-name hl-${c}`}>
                  <i className={`dot hl-${c}`} />
                  <input
                    defaultValue={names[c] ?? ""}
                    key={`${c}:${names[c] ?? ""}`}
                    placeholder={COLOR_NAMES[c]}
                    maxLength={60}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v !== (names[c] ?? "")) void api.setHighlightName(c, v).then(changed).catch(fail);
                    }}
                  />
                </label>
              ))}
            </div>

            <h2>Keep in step with your computer</h2>
            <SyncSettings onChanged={changed} />

            <h2>Backup</h2>
            <p className="hint">Your bookmarks, highlights, notes and reading plans live only on this phone. Save a backup file now and then; the same file works in the desktop app.</p>
            <div className="actions">
              <button onClick={saveBackup}>Save a backup</button>
              <button onClick={restoreBackup}>Restore a backup</button>
            </div>
            {backupNote && <p className="hint status">{backupNote}</p>}

            <h2>Appearance</h2>
            <div className="row">
              <span>Text size</span>
              <div className="stepper">
                <button disabled={size <= 0.85} onClick={() => setSize((s) => Math.round((s - 0.1) * 100) / 100)} aria-label="Smaller text">
                  A−
                </button>
                <span className="size-now">{Math.round(size * 100)}%</span>
                <button disabled={size >= 1.8} onClick={() => setSize((s) => Math.round((s + 0.1) * 100) / 100)} aria-label="Larger text">
                  A+
                </button>
              </div>
            </div>
            <label className="row">
              <span>Theme</span>
              <select className="select-field" value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
                <option value="system">Same as phone</option>
                <option value="light">Light</option>
                <option value="sepia">Sepia</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <label className="row">
              <span>Text colour</span>
              <select className="select-field" value={textColor} onChange={(e) => setTextColor(e.target.value as TextColor)}>
                <option value="default">Standard</option>
                <option value="strong">Strongest</option>
                <option value="sepia">Warm</option>
                <option value="blue">Blue-black</option>
              </select>
            </label>
            <label className="row">
              <span>Contrast</span>
              <select className="select-field" value={contrast} onChange={(e) => setContrast(e.target.value as Contrast)}>
                <option value="standard">Standard</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="row">
              <span>Font</span>
              <select className="select-field" value={font} onChange={(e) => setFont(e.target.value as Font)}>
                <option value="serif">Classic</option>
                <option value="sans">Modern</option>
              </select>
            </label>
            <p className="hint">High contrast makes the grey labels and hints darker (lighter on the dark page), for reading in bright light.</p>

            <h2>Read aloud</h2>
            <div className="speed">
              <div className="speed-head">
                <span>Speed</span>
                <strong>{rateToStep(rate) === 0 ? "Normal" : `${rateToStep(rate) > 0 ? "+" : ""}${rateToStep(rate)}`}</strong>
              </div>
              <input type="range" min={-10} max={10} step={1} value={rateToStep(rate)} onChange={(e) => setRate(stepToRate(Number(e.target.value)))} aria-label="Reading speed: slower to the left, faster to the right" />
              <div className="speed-ends">
                <span>Slower</span>
                <span>0</span>
                <span>Faster</span>
              </div>
            </div>
            {voices && voices.length > 0 ? (
              <label className="row">
                <span>Voice</span>
                <select className="select-field" value={voice ?? ""} onChange={(e) => setVoice(e.target.value || null)} aria-label="Voice">
                <option value="">The phone's default voice</option>
                {voices.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.label}
                    {v.local ? "" : " (needs internet)"}
                  </option>
                ))}
                </select>
              </label>
            ) : (
              <p className="hint keep">{voices ? "This phone offers one voice. More can be added in the phone's settings under Text-to-speech." : "Looking for the phone's voices…"}</p>
            )}
            <div className="actions">
              <button onClick={() => void phone.speak("For God so loved the world, that he gave his only begotten Son.", rate, voice).catch(fail)}>Try this voice</button>
            </div>
            <p className="hint">Tap a verse and choose Listen from here. While it reads, the bar at the bottom has a sleep timer.</p>

            <UpdateSettings updates={updates} enabled={autoUpdates} onEnabled={setAutoUpdates} />

            <details className="fold about-fold">
              <summary>
                About <small>Version {updates.current || "…"}</small>
              </summary>
            <ul className="about">
              {versions.map((v) => (
                <li key={v.code}>
                  <strong>{v.code}</strong> {v.name} — {v.license_note}
                </li>
              ))}
            </ul>
            <p className="licence">
              Topics: Nave's Topical Bible and Torrey's New Topical Textbook. Dictionary: Easton's and Smith's Bible Dictionaries. Word study: Strong's Exhaustive Concordance; the optional Original words: STEPBible (Tyndale House, Cambridge; CC BY 4.0).
              Cross-references: OpenBible.info (CC BY 4.0).{" "}
              {about && about.name ? `Study notes and book introductions: ${about.name} (${about.licence}), ${about.website}.` : ""} The rest is public domain. Everything works offline;
              only downloading more translations (from eBible.org), the nature backgrounds and a new version of the app needs the internet.
            </p>
            </details>
          </div>
        )}
      </main>

      {speaking != null && (
        <div className="playing">
          <span>
            Reading {place.book} {place.chapter}:{speaking}
          </span>
          <select value={sleep} onChange={(e) => setSleep(e.target.value)} aria-label="Sleep timer">
            {SLEEP.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
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
          names={names}
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
          originalPack={originalPack}
          onLibrary={() => {
            setChosen(null);
            setLibrary("home");
          }}
          about={about}
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
        // above any other sheet: the question can come from inside one (Library, Translations)
        <Sheet top onClose={() => setAsking(null)}>
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

      {study && (
        <Sheet tall onClose={() => setStudy(null)}>
          <h3>
            {study.kind === "intro" ? `About ${place.book}` : `Study notes on ${place.book} ${place.chapter}`} <small>{about?.name}</small>
          </h3>
          <div className="commentary">
            {study.kind === "intro" &&
              (study.text ? study.text.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>) : <p className="hint">No introduction for this book.</p>)}
            {study.kind === "notes" &&
              (study.notes.length > 0 ? (
                study.notes.map((n, i) => (
                  <div key={i}>
                    {(i === 0 || study.notes[i - 1].verse_start !== n.verse_start) && (
                      <h4>
                        <button className="link" onClick={() => go(place.book, place.chapter, n.verse_start)}>
                          Verse {n.verse_start}
                        </button>
                      </h4>
                    )}
                    <p>{n.text}</p>
                  </div>
                ))
              ) : (
                <p className="hint">No notes on this chapter.</p>
              ))}
          </div>
          {about && (
            <p className="attribution">
              {about.name} © Tyndale House Publishers, {about.licence} ({about.licence_url}). Shown here unchanged.
            </p>
          )}
        </Sheet>
      )}

      {library !== null && (
        <Sheet tall onClose={() => setLibrary(null)}>
          <Library
            book={place.book}
            chapter={place.chapter}
            start={library === "commentary" ? "commentary" : undefined}
            onGo={(b, c, v) => {
              setLibrary(null);
              go(b, c, v);
            }}
            onBibles={() => void loadVersions()}
            ask={ask}
            say={say}
          />
        </Sheet>
      )}

      {showTranslations && (
        <Sheet tall onClose={() => setShowTranslations(false)}>
          <h3>More translations</h3>
          <Translations onChanged={() => void loadVersions()} ask={ask} say={say} />
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

/** Earlier days of a plan not ticked off yet. */
function behindCount(day: number, done: Set<number>): number {
  let n = 0;
  for (let d = 1; d < day; d++) if (!done.has(d)) n++;
  return n;
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
  /** the reader's names for the highlight colours */
  names: Record<string, string>;
  bookmarked: boolean;
  onClose: () => void;
  onBookmark: () => void;
  onHighlight: (color: string | null) => void;
  onListen: () => void;
  onGo: (book: string, chapter: number, verse: number | null) => void;
  onChanged: () => void;
  originalPack: OriginalPack;
  onLibrary: () => void;
  about: CommentaryAbout | null;
  ask: (message: string, yes: string, then: () => void) => void;
  say: (message: string) => void;
  fail: (e: unknown) => void;
}

/** "Prayer, hope" <-> ["Prayer", "hope"] */
const tagText = (tags: string[]) => tags.join(", ");
const textTags = (text: string) =>
  text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

/** Everything that can be done with one verse: mark it, write a note on it, pass it on,
 * hear it, and see what else Scripture says alongside it. */
function VerseSheet({ book, chapter, verse, version, color, names, bookmarked, onClose, onBookmark, onHighlight, onListen, onGo, onChanged, originalPack, onLibrary, about, ask, say, fail }: VerseSheetProps) {
  const [view, setView] = useState<"main" | "note" | "refs" | "compare" | "words" | "notes" | "picture" | "tags">("main");
  const [note, setNote] = useState("");
  const [had, setHad] = useState(false);
  const [noteTags, setNoteTags] = useState("");
  const [bookmarkTags, setBookmarkTags] = useState("");
  const [refs, setRefs] = useState<Hit[] | null>(null);
  const [all, setAll] = useState<[string, string][] | null>(null);
  const [comments, setComments] = useState<CommentaryNote[] | null>(null);
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
    api.tagsOf("notes", book, chapter, verse.verse).then((t) => setNoteTags(tagText(t))).catch(() => undefined);
    api.tagsOf("bookmarks", book, chapter, verse.verse).then((t) => setBookmarkTags(tagText(t))).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapter, verse.verse]);

  useEffect(() => {
    if (view === "refs" && !refs) api.crossRefs(version, book, chapter, verse.verse).then(setRefs).catch(fail);
    if (view === "compare" && !all) api.compare(book, chapter, verse.verse).then(setAll).catch(fail);
    if (view === "notes" && !comments) api.verseNotes(book, chapter, verse.verse).then(setComments).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const saveNote = (body: string) =>
    api
      .setNote(book, chapter, verse.verse, body)
      .then(() => (body.trim() ? api.setTags("notes", book, chapter, verse.verse, textTags(noteTags)) : undefined))
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
              <button key={c} className={`dot hl-${c}` + (color === c ? " on" : "")} aria-label={`Highlight: ${colorName(c, names)}`} title={colorName(c, names)} onClick={() => onHighlight(color === c ? null : c)} />
            ))}
            {color && (
              <button className="text" onClick={() => onHighlight(null)}>
                Clear
              </button>
            )}
          </div>
          {color && <p className="hl-chosen">{colorName(color, names)}</p>}
          <div className="actions wrap">
            <button onClick={onBookmark}>{bookmarked ? "Remove bookmark" : "Bookmark"}</button>
            {bookmarked && <button onClick={() => setView("tags")}>{bookmarkTags ? `Tags: ${bookmarkTags}` : "Tag the bookmark"}</button>}
            <button onClick={() => setView("note")}>{had ? "Edit note" : "Add a note"}</button>
            <button onClick={() => setView("words")}>Word study</button>
            <button onClick={() => setView("notes")}>Study notes</button>
            <button onClick={() => setView("refs")}>Cross-references</button>
            <button onClick={() => setView("compare")}>Compare translations</button>
            <button onClick={onListen}>Listen from here</button>
            <button onClick={() => setView("picture")}>Verse picture</button>
            <button
              onClick={() =>
                phone
                  // shared (not copied) verses say where they came from: the link shows its preview
                  .share(`${quoted}\n\nShared from Bible Concordance · https://bible4me.org`, label)
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
          <input className="field tag-edit" value={noteTags} onChange={(e) => setNoteTags(e.target.value)} placeholder="Tags, e.g. Prayer, Sunday's sermon" aria-label="Tags for this note" />
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
      {view === "tags" && (
        <>
          <p className="hint">Tags group your bookmarks (and notes) in My Study. Separate them with commas.</p>
          <input className="field" value={bookmarkTags} onChange={(e) => setBookmarkTags(e.target.value)} placeholder="e.g. Prayer, Promises" aria-label="Tags for this bookmark" autoFocus />
          <div className="actions">
            <button
              className="primary"
              onClick={() =>
                void api
                  .setTags("bookmarks", book, chapter, verse.verse, textTags(bookmarkTags))
                  .then(() => {
                    onChanged();
                    say("Tags saved");
                    onClose();
                  })
                  .catch(fail)
              }
            >
              Save
            </button>
          </div>
        </>
      )}
      {view === "words" && <WordStudy book={book} chapter={chapter} verse={verse.verse} version={version} pack={originalPack} onGo={onGo} onLibrary={onLibrary} fail={fail} />}
      {view === "notes" && (
        <div className="commentary">
          {!comments && <p className="hint">Loading…</p>}
          {comments && comments.length === 0 && <p className="hint">No study note on this verse.</p>}
          {(comments ?? []).map((n, i) => (
            <p key={i}>{n.text}</p>
          ))}
          {about && comments && comments.length > 0 && (
            <p className="attribution">
              {about.name} © Tyndale House Publishers, {about.licence}.
            </p>
          )}
        </div>
      )}
      {view === "picture" && <VersePicture label={label} version={version} text={verse.text} say={say} fail={fail} />}
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
function Sheet({ children, onClose, tall = false, top = false }: { children: React.ReactNode; onClose: () => void; tall?: boolean; top?: boolean }) {
  return (
    <div className={"veil" + (top ? " top" : "")} onClick={onClose}>
      <div className={"sheet" + (tall ? " tall" : "")} role="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="grip" aria-hidden />
        {children}
      </div>
    </div>
  );
}
