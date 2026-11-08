import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, AskAnswer, BookInfo, HomeStats, PlanProgress, ReadingStats, resolveReference, SearchHit } from "../api";
import { addSearchHistory, getSearchHistory } from "../searchHistory";
import { AskAnswerView } from "./AskAnswerView";
import { BrowseMatches } from "./BrowseMatches";
import type { BrowseKind } from "../browse/types";
import { verseOfTheDay } from "../dailyVerse";
import { buildPlan, currentDay, PLANS, todayIso } from "../readingPlans";
import { copyText, formatVerseForCopy } from "../clipboard";
import { SearchIcon } from "./icons";
import "../themes/themes.css";
import { effectiveLook, refreshSeason, useThemeState } from "../themes/themeStore";
import { SeasonPrompt } from "../themes/SeasonPrompt";
import { MAX_SHORTCUTS, resolveShortcuts, ShortcutTarget } from "../shortcuts";
import { backToDefaultTiles, moveShortcutTo, placeShortcut, unplaceShortcut, useShortcuts } from "../shortcutsStore";
import { ShortcutGrid } from "./ShortcutGrid";
import { ShortcutPicker } from "./ShortcutPicker";
import { closeHighlight, useClosedHighlights } from "../highlights";

/** the id of the closable "New" note about the Browse area */
const BROWSE_NOTE = "browse-1";

interface Props {
  books: BookInfo[];
  chapterCounts: Record<string, number>;
  onGo: (book: string, chapter: number, verse: number | null) => void;
  /** Jumps to a verse and opens its cross-reference graph -- used by the "Cross-references" tile. */
  onOpenCrossRefs: (book: string, chapter: number, verse: number) => void;
  /** Jumps to a verse and opens the parallel-translations compare view -- used by "Translations". */
  onOpenParallel: (book: string, chapter: number, verse: number) => void;
  /** Bumped when the reader's study data (reading-plan progress) changes. */
  studyVersion: number;
  onOpenPlans: () => void;
  onOpenDictionary: (query: string) => void;
  /** Opens the page listing the Bible's authors -- used by the "Authors" tile. */
  onOpenAuthors: () => void;
  /** Opens Settings at Appearance, where the opening-screen look is chosen. */
  onOpenLook: () => void;
  /** the "New" note about the Browse area opens this */
  onOpenBrowse: (tab: BrowseKind, page?: string) => void;
  /** Everything a menu opens: what the reader can place as a shortcut on this screen (up to six, replacing the default tiles). */
  shortcutTargets: ShortcutTarget[];
  /** The chapter the reader was last at, for the "Continue reading" button (null: nowhere yet). */
  resume: { book: string; chapter: number } | null;
  /** The Bible the reader is using: the verse of the day is shown in it. */
  versionCode: string;
}

const EXAMPLES = ["John 3:16", "the creation of light", "the prodigal son", "Psalm 23", "the parting of the Red Sea"];

// Genesis 1:1 carries 68 outgoing cross-references in the bundled TSK-derived dataset --
// the most cross-referenced opening verse of any book, and thematically apt ("in the
// beginning") for the tile that explains what a cross-reference even is.
const CROSS_REF_DEMO = { book: "Genesis", chapter: 1, verse: 1 };
// The natural choice for "compare translations": the most widely known verse in English,
// and one every bundled translation actually contains (unlike some Enoch/Apocrypha-only
// edge cases), so all 7 rows in the compare view are guaranteed to show real text.
const PARALLEL_DEMO = { book: "John", chapter: 3, verse: 16 };

/** One tile in the "Inside this Bible" strip. `action`, when present, makes the tile a
 * button that jumps into the reader and demonstrates the stat live; a tile with no
 * natural destination (no feature to expand into) is left as a plain, non-interactive
 * figure instead of a fake button that goes nowhere. */
interface StatTile {
  key: string;
  value: string;
  label: string;
  sub: string;
  action?: () => void;
}

function buildStatTiles(
  stats: HomeStats,
  onGo: Props["onGo"],
  onOpenCrossRefs: Props["onOpenCrossRefs"],
  onOpenParallel: Props["onOpenParallel"],
  onOpenAuthors: Props["onOpenAuthors"],
): StatTile[] {
  const n = (x: number) => x.toLocaleString();
  return [
    {
      key: "books",
      value: n(stats.books),
      label: "Books",
      sub: `${stats.ot_books} Old Testament, ${stats.nt_books} New`,
      action: () => onGo("Genesis", 1, null), // "Books" -> start reading from the first one
    },
    {
      key: "chapters",
      value: n(stats.chapters),
      label: "Chapters",
      sub: `${stats.ot_chapters} Old Testament, ${stats.nt_chapters} New`,
      // "Books" starts the Old Testament at Genesis, so this one starts the New Testament at Matthew.
      action: () => onGo("Matthew", 1, null),
    },
    {
      key: "verses",
      value: n(stats.verses),
      label: "Verses",
      sub: "counted in the King James Version",
      // No single "browse all verses" feature exists to expand into.
    },
    {
      key: "authors",
      value: "40",
      label: "Authors",
      sub: "traditional list, across ~1,500 years",
      // Not in the bundled data (no authorship field): the page it opens is written into the app
      // itself (src/bibleAuthors.ts), with a note on each writer and the books they wrote.
      action: onOpenAuthors,
    },
    {
      key: "xrefs",
      value: n(stats.cross_references),
      label: "Cross-references",
      sub: "verses linked to each other across Scripture",
      action: () => onOpenCrossRefs(CROSS_REF_DEMO.book, CROSS_REF_DEMO.chapter, CROSS_REF_DEMO.verse),
    },
    {
      key: "translations",
      value: n(stats.translations),
      label: "Translations",
      sub: "bundled offline, plus the original Hebrew & Greek",
      action: () => onOpenParallel(PARALLEL_DEMO.book, PARALLEL_DEMO.chapter, PARALLEL_DEMO.verse),
    },
  ];
}

/** "5 days in a row", with what to do next, and how much has been read. */
function streakLine(s: ReadingStats): string {
  const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
  const parts: string[] = [];
  if (s.streak > 0) {
    parts.push(`Reading streak: ${days(s.streak)} in a row${s.read_today ? "" : ", read a chapter to the end today to keep it going"}`);
  } else {
    parts.push("Read a chapter to the end to start a reading streak");
  }
  if (s.best_streak > s.streak) parts.push(`best: ${days(s.best_streak)}`);
  parts.push(`${s.chapters} different ${s.chapters === 1 ? "chapter" : "chapters"} read`);
  return parts.join(" · ");
}

export function HomeScreen({ books, chapterCounts, onGo, onOpenCrossRefs, onOpenParallel, studyVersion, onOpenPlans, onOpenDictionary, onOpenAuthors, onOpenLook, onOpenBrowse, shortcutTargets, resume, versionCode }: Props) {
  const [dailyText, setDailyText] = useState<string | null>(null);
  const [dailyVersion, setDailyVersion] = useState("BSB");
  const [readStats, setReadStats] = useState<ReadingStats | null>(null);
  const [plans, setPlans] = useState<PlanProgress[]>([]);
  const [copiedDaily, setCopiedDaily] = useState(false);
  const [dailyBook, dailyChapter, dailyVerse] = verseOfTheDay();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [askAnswer, setAskAnswer] = useState<AskAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<HomeStats | null>(null);
  const [picking, setPicking] = useState(false);
  // The recent searches and the suggestions share two lines (owner, 2026-11-07): the recent searches take what they need, up to two
  // lines, and the suggestions get what is left (none when the recent searches already fill two lines). Measured on screen, so it
  // follows the window's width.
  const chipsRef = useRef<HTMLDivElement>(null);
  const [tryLines, setTryLines] = useState(2);
  const [chipRow, setChipRow] = useState(34);
  const shortcuts = useShortcuts();
  const closedNotes = useClosedHighlights();
  // Lazy init: reads localStorage once, synchronously, on first render -- so "Recent"
  // is already there on the very first paint rather than popping in after an effect.
  const [history, setHistory] = useState<string[]>(() => getSearchHistory());
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    api.homeStats().then(setStats).catch(console.error);
    api
      .readingStats(todayIso())
      .then(setReadStats)
      .catch(() => setReadStats(null));
  }, []);

  // The verse of the day in the Bible the reader is using; the built-in BSB when that one can't give it
  // (a Bible that is online only, or Enoch's single translation).
  useEffect(() => {
    let stale = false;
    const fetchIn = (code: string) => api.getVerseWithStrongs(code, dailyBook, dailyChapter, dailyVerse).then((v) => ({ code, text: v.text }));
    fetchIn(versionCode)
      .catch(() => (versionCode === "BSB" ? Promise.reject(new Error("no verse")) : fetchIn("BSB")))
      .then((r) => {
        if (stale) return;
        setDailyText(r.text);
        setDailyVersion(r.code);
      })
      .catch(() => !stale && setDailyText(null));
    return () => {
      stale = true;
    };
  }, [versionCode, dailyBook, dailyChapter, dailyVerse]);

  useEffect(() => {
    api.planProgress().then(setPlans).catch(() => setPlans([]));
  }, [studyVersion]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const reference = query.trim() ? resolveReference(query, books, chapterCounts) : null;

  useLayoutEffect(() => {
    const box = chipsRef.current;
    if (!box) return;
    const measure = () => {
      const chips = [...box.querySelectorAll<HTMLElement>(".home-recent button")];
      const lines = new Set(chips.map((b) => b.offsetTop)).size;
      setTryLines(Math.max(0, 2 - Math.min(2, lines)));
      const first = box.querySelector<HTMLElement>("button");
      if (first && first.offsetHeight > 0) setChipRow(first.offsetHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, [history.length, query]);

  // what a shortcut can open: every menu item, and the default tiles that go somewhere
  const statTiles = stats ? buildStatTiles(stats, onGo, onOpenCrossRefs, onOpenParallel, onOpenAuthors) : [];
  const allTargets: ShortcutTarget[] = [
    ...shortcutTargets,
    ...statTiles
      .filter((t) => t.action)
      .map((t) => ({ id: `stat-${t.key}`, group: "Inside this Bible", label: t.label, sub: t.sub, value: t.value, onOpen: t.action! })),
  ];

  // the theme of the opening screen (an occasion theme, or the plain wordmark); today's date may start or end a season
  const themeState = useThemeState();
  const look = effectiveLook(themeState);
  // the default theme has a slight glow too, unless the reader chose a plain background
  const defaultGlow = look.defaultGlow;
  useEffect(() => {
    refreshSeason();
  }, []);

  useEffect(() => {
    const q = query.trim();
    // A recognized reference is unambiguous -- no need to also run a search under it.
    if (!q || reference) {
      setResults([]);
      setAskAnswer(null);
      setError(null);
      return;
    }
    const id = ++requestId.current;
    const handle = setTimeout(() => {
      setLoading(true);
      api
        .askQuestion(q)
        .then((a) => {
          if (id !== requestId.current) return;
          setAskAnswer(a);
          setResults(a.kind === "computed" ? a.result.verses : a.kind === "fallback" ? a.hits : []);
          setError(null);
        })
        .catch((e) => {
          if (id !== requestId.current) return;
          setError(String(e));
          setResults([]);
          setAskAnswer(null);
        })
        .finally(() => {
          if (id === requestId.current) setLoading(false);
        });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  // Records the term that was actually typed at the moment a search leads somewhere real
  // (a resolved reference, or a clicked result) -- not every debounced keystroke, which
  // would fill history with half-typed fragments instead of things worth returning to.
  function goAndRemember(book: string, chapter: number, verse: number | null) {
    setHistory(addSearchHistory(query));
    onGo(book, chapter, verse);
  }

  function submit() {
    if (reference) goAndRemember(reference.book, reference.chapter, reference.verse);
    else if (results.length > 0) goAndRemember(results[0].book, results[0].chapter, results[0].verse);
  }

  return (
    <div className="home-screen" data-occasion={look.screenLook?.slug} data-screen={look.screenOn ? "on" : undefined} data-glow={defaultGlow ? "default" : undefined}>
      <div className="home-box">
        <h1 className={look.art ? "gospel-wordmark has-art" : "gospel-wordmark"} aria-label="Gospel">
          {look.art ? (
            // the look's own wordmark (a trusted SVG that ships with the app); the real text "Gospel" stays in the label above
            <span className="wordmark-art" data-wm={look.wordmarkLook?.slug} aria-hidden="true" dangerouslySetInnerHTML={{ __html: look.art }} />
          ) : (
            ["G", "o", "s", "p", "e", "l"].map((letter, i) => (
              <span key={i} aria-hidden="true">
                {letter}
              </span>
            ))
          )}
        </h1>
        <form
          className="home-search-box"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <SearchIcon size={18} className="icon" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a reference, a story, or a theme…"
            aria-label="Find a passage to begin reading"
          />
        </form>
        <SeasonPrompt />
        {!query.trim() && (
          <p className="home-look-line">
            Theme: {look.mixed ? "Your own mix" : look.look ? look.look.name : "Default"}
            {" · "}
            <button className="link-btn" onClick={onOpenLook}>
              Change the theme
            </button>
          </p>
        )}
        {!query.trim() && !closedNotes.includes(BROWSE_NOTE) && (
          <p className="home-highlight" role="note">
            <span className="home-highlight-new">New</span>
            <button className="link-btn" onClick={() => onOpenBrowse("stories")}>
              Bible stories
            </button>
            <button className="link-btn" onClick={() => onOpenBrowse("topics")}>
              Verses for…
            </button>
            <button className="link-btn" onClick={() => onOpenBrowse("children")}>
              For children
            </button>
            <button className="home-highlight-close" aria-label="Hide this note" title="Hide this note (Settings can show it again)" onClick={() => closeHighlight(BROWSE_NOTE)}>
              ×
            </button>
          </p>
        )}
        {look.screenOn && look.screenLook?.verse && !query.trim() && (
          <p className="occ-verse">
            “{look.screenLook.verse.text}”<cite>{look.screenLook.verse.ref} (BSB)</cite>
          </p>
        )}
        {!query.trim() && resume && books.some((b) => b.name === resume.book) && resume.chapter <= (chapterCounts[resume.book] ?? 0) && (
          <div className="home-examples">
            <button className="pill-btn" onClick={() => onGo(resume.book, resume.chapter, null)}>
              Continue reading: {resume.book} {resume.chapter}
            </button>
          </div>
        )}
        {!query.trim() && (
          <div className="home-chips" ref={chipsRef} style={{ "--row": `${chipRow}px` } as React.CSSProperties}>
            {history.length > 0 && (
              <div className="home-examples home-recent" style={{ "--lines": 2 } as React.CSSProperties}>
                <span className="muted">Recent:</span>
                {history.map((term) => (
                  <button key={term} className="outline-btn" onClick={() => setQuery(term)}>
                    {term}
                  </button>
                ))}
              </div>
            )}
            {tryLines > 0 && (
              <div className="home-examples home-try" style={{ "--lines": tryLines } as React.CSSProperties}>
                <span className="muted">Try:</span>
                {EXAMPLES.map((ex) => (
                  <button key={ex} className="outline-btn" onClick={() => setQuery(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {reference && (
          <button className="pill-btn home-result-reference" onClick={() => goAndRemember(reference.book, reference.chapter, reference.verse)}>
            Go to {reference.book} {reference.chapter}
            {reference.verse ? `:${reference.verse}` : ""}
          </button>
        )}
        {loading && <p className="muted">Searching…</p>}
        {error && <p className="status-error">{error}</p>}
        {!reference && <BrowseMatches query={query} onOpen={(kind, id) => onOpenBrowse(kind, id)} onJump={(book, chapter, verse) => goAndRemember(book, chapter, verse)} />}
        {!loading && !reference && askAnswer && (
          <AskAnswerView answer={askAnswer} hitCount={results.length} onJump={(book, chapter, verse) => goAndRemember(book, chapter, verse)} onOpenDictionaryEntry={onOpenDictionary} />
        )}
        {!loading && !error && !askAnswer && query.trim() && !reference && results.length === 0 && <p className="muted">No matches for "{query.trim()}".</p>}
        {!reference && results.length > 0 && (
          <ul className="xref-list">
            {results.map((h) => (
              <li key={`${h.book}-${h.chapter}-${h.verse}`}>
                <button className="link-btn" onClick={() => goAndRemember(h.book, h.chapter, h.verse)}>
                  {h.book} {h.chapter}:{h.verse}
                </button>
                <div className="snippet">{h.text}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!query.trim() && (dailyText || plans.length > 0) && (
        <div className="home-daily">
          {dailyText && (
            <figure className="daily-verse">
              <p className="muted daily-label">Verse of the day</p>
              <blockquote>{dailyText}</blockquote>
              <figcaption>
                <button className="link-btn" onClick={() => goAndRemember(dailyBook, dailyChapter, dailyVerse)}>
                  {dailyBook} {dailyChapter}:{dailyVerse}
                </button>{" "}
                <span className="muted">({dailyVersion})</span>{" "}
                <button
                  className="text-btn"
                  onClick={async () => {
                    setCopiedDaily(await copyText(formatVerseForCopy(dailyBook, dailyChapter, dailyVerse, dailyText, dailyVersion)));
                    window.setTimeout(() => setCopiedDaily(false), 1500);
                  }}
                >
                  {copiedDaily ? "Copied" : "Copy"}
                </button>
              </figcaption>
            </figure>
          )}
          {plans.map((p) => {
            const def = PLANS.find((d) => d.id === p.plan_id);
            if (!def) return null;
            const day = currentDay(p.started_on, def.days);
            const readings = buildPlan(def.id, books, chapterCounts)[day - 1] ?? [];
            const done = p.done_days.includes(day);
            return (
              <div key={p.plan_id} className="today-reading">
                <p className="muted daily-label">
                  Today's reading · {def.name} · day {day} of {def.days}
                  {done ? " · done ✓" : ""}
                </p>
                <div className="today-reading-links">
                  {readings.map((r, i) => (
                    <button key={i} className="outline-btn" onClick={() => goAndRemember(r.book, r.chapter, 1)}>
                      {r.book} {r.chapter}
                    </button>
                  ))}
                  <button className="text-btn" onClick={onOpenPlans}>
                    Tick off / see plan →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!query.trim() && readStats && (readStats.chapters > 0 || readStats.streak > 0) && <p className="home-streak">{streakLine(readStats)}</p>}
      {/* Hidden while actively searching, same reasoning as the example chips above:
          keep the screen focused on results rather than competing for attention. */}
      {!query.trim() && (stats || shortcuts.custom) && (
        <div className="home-stats">
          <p className="home-stats-heading">{shortcuts.custom ? "Your shortcuts" : "Inside this Bible"}</p>
          {shortcuts.custom ? (
            <ShortcutGrid
              items={resolveShortcuts(shortcuts, allTargets)}
              canAdd={shortcuts.ids.length < MAX_SHORTCUTS}
              onAdd={() => setPicking(true)}
              onRemove={unplaceShortcut}
              onMove={moveShortcutTo}
            />
          ) : (
            <div className="home-stats-grid">
              {statTiles.map((tile) => {
                const content = (
                  <>
                    <div className="home-stat-number">{tile.value}</div>
                    <div className="home-stat-label">{tile.label}</div>
                    <div className="home-stat-sub">{tile.sub}</div>
                  </>
                );
                return tile.action ? (
                  <button key={tile.key} className="home-stat-tile is-active" onClick={tile.action}>
                    {content}
                  </button>
                ) : (
                  <div key={tile.key} className="home-stat-tile">
                    {content}
                  </div>
                );
              })}
            </div>
          )}
          <p className="home-shortcut-line">
            {shortcuts.custom ? (
              <button className="link-btn" onClick={backToDefaultTiles}>
                Back to the default tiles
              </button>
            ) : (
              <button className="link-btn" onClick={() => setPicking(true)}>
                Make these your own: add up to six shortcuts
              </button>
            )}
          </p>
          {picking && (
            <ShortcutPicker
              targets={allTargets}
              placed={shortcuts.ids}
              onPick={(id) => {
                placeShortcut(id);
                setPicking(false);
              }}
              onClose={() => setPicking(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}
