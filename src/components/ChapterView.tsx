import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { api, NON_CANON_BOOKS, ChapterMarks, highlightLabel, HIGHLIGHT_COLORS_BRIGHT, HIGHLIGHT_COLORS_SOFT, HighlightColor, Version, VerseWithWords } from "../api";
import { copyText, formatVerseForCopy } from "../clipboard";
import { chapterRedLetter, loadRedLetter, splitRed } from "../redLetter";
import { segmentVerse, tidyPunctuation } from "../verseSegments";
import { addVersesToBasket } from "../basket";
import {
  BasketIcon,
  BookIcon,
  BookmarkIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  ColumnsIcon,
  CompareIcon,
  CopyIcon,
  InterlinearIcon,
  LinkIcon,
  MoreIcon,
  NoteIcon,
  PictureIcon,
  SheetIcon,
  SpeakerIcon,
  TagIcon,
} from "./icons";

// TR / THGNT (Greek NT) and WLC (Hebrew OT) are original-language single-testament
// texts, not full Bibles -- an empty chapter in one of these is expected outside its
// testament, not missing data.
const SINGLE_TESTAMENT_VERSIONS: Record<string, string> = {
  TR: "Textus Receptus is the Greek New Testament text — it only contains the 27 New Testament books.",
  THGNT: "The Tyndale House Greek New Testament only contains the 27 New Testament books.",
  WLC: "The Westminster Leningrad Codex is the Hebrew Old Testament text — it only contains the 39 Old Testament books.",
};
const GREEK_VERSIONS = new Set(["TR", "THGNT"]);

/** Script metadata for a translation's text: Hebrew right-to-left, Greek tagged. */
function scriptFor(code: string): { dir?: "rtl"; lang?: string } {
  return code === "WLC" ? { dir: "rtl", lang: "he" } : GREEK_VERSIONS.has(code) ? { lang: "grc" } : {};
}

// Side-by-side reading. The extra columns are remembered per viewer; the reader always
// starts in a single column when the app opens, and side by side stays on only for the
// rest of that session.
interface ParallelPrefs {
  on: boolean;
  codes: string[];
}
const PARALLEL_KEY = "parallel:prefs";
let parallelOnThisSession = false;

function loadParallel(): ParallelPrefs {
  try {
    const p = JSON.parse(localStorage.getItem(PARALLEL_KEY) ?? "{}") as Partial<ParallelPrefs>;
    const codes = Array.isArray(p.codes) ? p.codes.filter((c): c is string => typeof c === "string").slice(0, 3) : ["KJV"];
    return { on: parallelOnThisSession, codes };
  } catch {
    return { on: parallelOnThisSession, codes: ["KJV"] };
  }
}

function saveParallel(p: ParallelPrefs) {
  parallelOnThisSession = p.on;
  try {
    localStorage.setItem(PARALLEL_KEY, JSON.stringify({ codes: p.codes }));
  } catch {
    /* per-viewer convenience only */
  }
}

interface Location {
  book: string;
  chapter: number;
}

interface Props {
  book: string;
  chapter: number;
  versionCode: string;
  /** every translation (for the side-by-side columns) */
  versions: Version[];
  verses: VerseWithWords[];
  loading: boolean;
  error: string | null;
  targetVerse: number | null;
  prev: Location | null;
  next: Location | null;
  marks: ChapterMarks;
  onMarksChanged: () => void;
  /** The reader's own names for the highlight colours (e.g. "yellow" -> "Love"), if set. */
  highlightTitles: Record<string, string>;
  onNavigate: (to: Location | null) => void;
  onWordClick: (strongsNumbers: string[], surfaceText: string) => void;
  onShowCrossRefs: (verse: number) => void;
  onShowParallel: (verse: number) => void;
  onShowCommentary: (verse: number) => void;
  onShowInterlinear: (verse: number) => void;
  onShowTopics: (verse: number) => void;
  /** open the study-sheet builder for these verses (the range can be changed there) */
  onPrepareSheet: (verseStart: number, verseEnd: number) => void;
  /** read aloud from this verse; null when this translation can't be read aloud */
  onListen: ((fromVerse: number) => void) | null;
  /** the verse being read aloud right now, if in this chapter */
  readingVerse: number | null;
  /** downloaded Bible pictures for this chapter (0 hides the button) */
  pictureCount: number;
  onShowPictures: () => void;
}

export function ChapterView({
  book,
  chapter,
  versionCode,
  versions,
  verses,
  loading,
  error,
  targetVerse,
  prev,
  next,
  marks,
  onMarksChanged,
  highlightTitles,
  onNavigate,
  onWordClick,
  onShowCrossRefs,
  onShowParallel,
  onShowCommentary,
  onShowInterlinear,
  onShowTopics,
  onPrepareSheet,
  onListen,
  readingVerse,
  pictureCount,
  onShowPictures,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const verseRefs = useRef<Record<number, HTMLElement | null>>({});
  const locationKey = `${book}/${chapter}`;
  const lastScrolledLocation = useRef<string | null>(null);
  const [menuVerse, setMenuVerse] = useState<number | null>(null);
  const [noteVerse, setNoteVerse] = useState<number | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteEnd, setNoteEnd] = useState(0);
  const [noteTags, setNoteTags] = useState("");
  const [tagSuggestions, setTagSuggestions] = useState<[string, number][]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [redData, setRedData] = useState<Awaited<ReturnType<typeof loadRedLetter>> | null>(null);

  useEffect(() => {
    loadRedLetter().then(setRedData);
  }, []);
  const redRanges = redData ? chapterRedLetter(redData, versionCode, book, chapter) : {};

  // ---- side by side: the translation being read, plus up to three more in columns
  const [parallel, setParallelState] = useState<ParallelPrefs>(loadParallel);
  const setParallel = (p: ParallelPrefs) => {
    setParallelState(p);
    saveParallel(p);
  };
  const selectable = versions.filter((v) => (v.code === "ENOCH1") === (book === "Enoch"));
  const extras = parallel.on ? parallel.codes.filter((c) => c !== versionCode && selectable.some((v) => v.code === c)).slice(0, 3) : [];
  const parallelMode = parallel.on;
  const extrasKey = extras.join("|");
  const [extraChapter, setExtraChapter] = useState<{ key: string; verses: Record<string, Record<number, string>> }>({ key: "", verses: {} });

  useEffect(() => {
    if (!extrasKey) return;
    let live = true;
    const key = `${locationKey}|${extrasKey}`;
    Promise.all(
      extrasKey.split("|").map((code) =>
        api
          .getChapter(code, book, chapter)
          .then((vs) => [code, Object.fromEntries(vs.map((v) => [v.verse, v.text]))] as const)
          .catch(() => [code, {}] as const),
      ),
    ).then((rows) => live && setExtraChapter({ key, verses: Object.fromEntries(rows) }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationKey, extrasKey]);

  // only use columns fetched for this chapter (never the previous chapter's text)
  const extraVerses = extraChapter.key === `${locationKey}|${extrasKey}` ? extraChapter.verses : {};
  const mainByNum = new Map(verses.map((v) => [v.verse, v]));
  // every verse number any column has, in order -- e.g. the BSB has no Matthew 17:21 but
  // the KJV does, so that row shows the KJV and a dash for the BSB
  const rowNums = parallelMode
    ? [...new Set([...verses.map((v) => v.verse), ...extras.flatMap((c) => Object.keys(extraVerses[c] ?? {}).map(Number))])].sort((a, b) => a - b)
    : verses.map((v) => v.verse);

  const nameOf = (code: string) => versions.find((v) => v.code === code)?.name ?? code;
  const columnChoices = (current: string) => selectable.filter((v) => v.code === current || (v.code !== versionCode && !extras.includes(v.code)));
  const replaceColumn = (i: number, code: string) => setParallel({ ...parallel, codes: extras.map((c, j) => (j === i ? code : c)) });
  const removeColumn = (code: string) => setParallel({ ...parallel, codes: extras.filter((c) => c !== code) });
  function addColumn() {
    const preferred = ["KJV", "BSB", "WEB", "ASV", "YLT"];
    const free = selectable.filter((v) => v.code !== versionCode && !extras.includes(v.code) && !v.is_original_language);
    const pick = preferred.find((c) => free.some((v) => v.code === c)) ?? free[0]?.code;
    if (pick) setParallel({ on: true, codes: [...extras, pick] });
  }
  function toggleParallel() {
    if (parallel.on) setParallel({ ...parallel, on: false });
    else if (extras.length || parallel.codes.some((c) => c !== versionCode && selectable.some((v) => v.code === c))) setParallel({ ...parallel, on: true });
    else {
      const free = selectable.filter((v) => v.code !== versionCode && !v.is_original_language);
      const pick = ["KJV", "BSB", "WEB"].find((c) => free.some((v) => v.code === c)) ?? free[0]?.code;
      setParallel({ on: true, codes: pick ? [pick] : [] });
    }
  }

  // The interlinear (Hebrew/Greek word by word) exists for the 66 books.
  const hasInterlinear = !NON_CANON_BOOKS.has(book);

  /** Text with no Strong's tagging (a Library Bible such as the Afrikaanse Bybel, or a
   * side-by-side column): each word opens the Hebrew/Greek words of its verse, since the
   * app can't know which original word a single untagged word translates. */
  function plainWords(text: string, verse: number) {
    if (!hasInterlinear) return text;
    return text.split(/(\s+)/).map((w, i) =>
      /[\p{L}\p{N}]/u.test(w) ? (
        <span key={i} className="word plain-word" title="See the Hebrew/Greek words of this verse" onClick={() => !window.getSelection()?.toString() && onShowInterlinear(verse)}>
          {w}
        </span>
      ) : (
        w
      ),
    );
  }

  /** A column's text with the words of Jesus marked (plain text, no Strong's links). */
  function redText(code: string, n: number, text: string) {
    const ranges = redData ? chapterRedLetter(redData, code, book, chapter)[String(n)] : undefined;
    const parts = splitRed([{ text: tidyPunctuation(text), word: null }], ranges)[0];
    return parts.map((p, i) => (
      <span key={i} className={p.red ? "wj" : undefined}>
        {plainWords(p.text, n)}
      </span>
    ));
  }

  // a translation with no word tagging at all (most Library Bibles)
  const untagged = hasInterlinear && verses.length > 0 && !verses.some((v) => v.words?.some((w) => w.strongs_numbers.length > 0));

  // Scroll handling runs once the new chapter's verses are actually on screen:
  // either bring the jump target into view with a highlight flash, or (for plain
  // chapter navigation) return to the top, since the previous chapter's content
  // stays visible during the load and would otherwise leave the reader mid-page.
  useEffect(() => {
    if (loading) return;
    // The highlight class is applied imperatively, so React keeps it on a reused <p>
    // (same verse number in another chapter) unless it is cleared explicitly.
    rootRef.current?.querySelectorAll(".verse-row--target").forEach((n) => n.classList.remove("verse-row--target"));
    if (targetVerse != null) {
      const el = verseRefs.current[targetVerse];
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      // retrigger the CSS highlight animation even if the same verse was jumped to
      // again while its previous flash was still fading out
      void el?.offsetWidth;
      el?.classList.add("verse-row--target");
      lastScrolledLocation.current = locationKey;
      return;
    }
    if (lastScrolledLocation.current !== locationKey) {
      rootRef.current?.parentElement?.scrollTo({ top: 0 });
      lastScrolledLocation.current = locationKey;
    }
  }, [loading, verses, targetVerse, locationKey]);

  // Keep the verse being read aloud in view (only scrolls when it has moved off screen,
  // so reading along isn't jolted verse by verse).
  useEffect(() => {
    if (readingVerse == null) return;
    const el = verseRefs.current[readingVerse];
    const pane = rootRef.current?.parentElement;
    if (!el || !pane) return;
    const r = el.getBoundingClientRect();
    const p = pane.getBoundingClientRect();
    const header = stickyRef.current?.offsetHeight ?? 0; // the pinned chapter heading
    if (r.top < p.top + header + 10 || r.bottom > p.bottom - 140) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [readingVerse]);

  // Changing chapter closes any open verse menu / note editor.
  useEffect(() => {
    setMenuVerse(null);
    setNoteVerse(null);
  }, [locationKey]);

  // The verse menu closes on a click anywhere outside it, or on Escape.
  useEffect(() => {
    if (menuVerse == null) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest(".verse-menu, .verse-menu-btn")) setMenuVerse(null);
    };
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setMenuVerse(null);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [menuVerse]);

  function showFlash(msg: string) {
    setFlash(msg);
    window.setTimeout(() => setFlash((f) => (f === msg ? null : f)), 1800);
  }

  function wordKeyDown(e: KeyboardEvent<HTMLSpanElement>, numbers: string[], surface: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onWordClick(numbers, surface);
    }
  }

  const highlightOf = new Map(marks.highlights);
  const bookmarked = new Set(marks.bookmarks);
  const noted = new Set(marks.notes);
  // verses covered by a note on a range (the first verse carries the note marker)
  const spanEnd = new Map(marks.note_spans);
  const inSpan = (n: number) => marks.note_spans.some(([a, b]) => n >= a && n <= b);
  const lastVerse = verses[verses.length - 1]?.verse ?? 1;

  async function toggleBookmark(v: number) {
    setMenuVerse(null);
    const on = await api.toggleBookmark(book, chapter, v).catch(() => null);
    if (on !== null) showFlash(on ? `Bookmarked ${book} ${chapter}:${v}` : "Bookmark removed");
    onMarksChanged();
  }

  async function highlight(v: number, color: HighlightColor | null) {
    setMenuVerse(null);
    await api.setHighlight(book, chapter, v, color).catch(() => undefined);
    onMarksChanged();
  }

  async function openNote(v: number) {
    setMenuVerse(null);
    const existing = await api.getNote(book, chapter, v).catch(() => null);
    setNoteDraft(existing?.body ?? "");
    setNoteEnd(existing?.verse_end ?? v);
    setNoteTags(existing?.tags.join(", ") ?? "");
    setNoteVerse(v);
    api.noteTags().then(setTagSuggestions).catch(() => setTagSuggestions([]));
  }

  async function saveNote() {
    if (noteVerse == null) return;
    await api.saveNote(book, chapter, noteVerse, noteDraft, noteEnd, noteTags.split(",")).catch(() => undefined);
    showFlash(noteDraft.trim() ? "Note saved" : "Note removed");
    setNoteVerse(null);
    onMarksChanged();
  }

  async function copyVerse(v: VerseWithWords) {
    setMenuVerse(null);
    const ok = await copyText(formatVerseForCopy(book, chapter, v.verse, v.text, versionCode));
    showFlash(ok ? "Verse copied" : "Couldn't copy");
  }

  async function copyChapter() {
    if (parallelMode && extras.length) {
      // side by side: each verse in every column's translation
      const codes = [versionCode, ...extras];
      const body = rowNums
        .map((n) => {
          const lines = codes
            .map((c) => [c, c === versionCode ? mainByNum.get(n)?.text : extraVerses[c]?.[n]] as const)
            .filter(([, t]) => t)
            .map(([c, t]) => `  ${c}: ${t!.trim()}`);
          return `${n}\n${lines.join("\n")}`;
        })
        .join("\n\n");
      const ok = await copyText(`${book} ${chapter} (${codes.join(", ")})\n\n${body}`);
      showFlash(ok ? "Chapter copied (all columns)" : "Couldn't copy");
      return;
    }
    const body = verses.map((v) => `${v.verse} ${v.text.trim()}`).join("\n");
    const ok = await copyText(`${book} ${chapter} (${versionCode})\n\n${body}`);
    showFlash(ok ? "Chapter copied" : "Couldn't copy");
  }

  const nav = (
    <nav className="chapter-nav" aria-label="Chapter navigation" dir="ltr" lang="en">
      <button className="chapter-nav-btn" disabled={!prev} onClick={() => onNavigate(prev)} title="Previous chapter (←)">
        <ChevronLeftIcon size={16} />
        <span>{prev ? `${prev.book} ${prev.chapter}` : "Beginning"}</span>
      </button>
      <span className="chapter-nav-hint">Use ← and → to turn chapters</span>
      <button className="chapter-nav-btn" disabled={!next} onClick={() => onNavigate(next)} title="Next chapter (→)">
        <span>{next ? `${next.book} ${next.chapter}` : "End"}</span>
        <ChevronRightIcon size={16} />
      </button>
    </nav>
  );

  if (error) {
    return (
      <div className="chapter-view empty" ref={rootRef}>
        <p>Couldn't load {book} {chapter}.</p>
        <pre className="error-detail">{error}</pre>
        {nav}
      </div>
    );
  }

  if (loading && verses.length === 0) {
    return (
      <div className="chapter-view loading" ref={rootRef} aria-busy="true">
        Loading…
      </div>
    );
  }

  if (!loading && verses.length === 0) {
    const note = SINGLE_TESTAMENT_VERSIONS[versionCode];
    return (
      <div className="chapter-view empty" ref={rootRef}>
        <p>
          No text for {book} {chapter} in {versionCode}.
        </p>
        {note && <p>{note}</p>}
        {nav}
      </div>
    );
  }

  const verseContent = (v: VerseWithWords) => {
    const hl = highlightOf.get(v.verse);
    return (
      <>
        <p data-verse={v.verse} className={"verse-row" + (hl ? ` hl-${hl}` : "") + (readingVerse === v.verse ? " verse-row--reading" : "") + (inSpan(v.verse) ? " in-note-span" : "")} ref={(el) => { verseRefs.current[v.verse] = el; }}>
          <sup className="verse-num">{v.verse}</sup>
          {bookmarked.has(v.verse) && (
            <span className="verse-mark" title="Bookmarked" dir="ltr">
              <BookmarkIcon size={11} />
            </span>
          )}
          {noted.has(v.verse) && (
            <button
              className="verse-mark verse-mark-btn"
              title={spanEnd.has(v.verse) ? `You have a note on verses ${v.verse}–${spanEnd.get(v.verse)} — click to open it` : "You have a note on this verse — click to open it"}
              onClick={() => openNote(v.verse)}
              dir="ltr"
            >
              <NoteIcon size={11} />
            </button>
          )}{" "}
          {(() => {
            const segs = segmentVerse(v.text, v.words);
            const parts = splitRed(segs, redRanges[String(v.verse)]);
            const tx = (s: string) => (untagged ? plainWords(s, v.verse) : s);
            const body = (i: number) =>
              parts[i].length === 1 && !parts[i][0].red
                ? tx(parts[i][0].text)
                : parts[i].map((p, j) => (p.red ? <span key={j} className="wj">{tx(p.text)}</span> : <span key={j}>{tx(p.text)}</span>));
            return segs.map((seg, i) =>
              seg.word && seg.word.strongs_numbers.length > 0 ? (
                <span
                  key={i}
                  className="word has-strongs"
                  role="button"
                  tabIndex={0}
                  title={`Strong's ${seg.word.strongs_numbers.join(", ")}`}
                  onClick={() => onWordClick(seg.word!.strongs_numbers, seg.word!.surface_text)}
                  onKeyDown={(e) => wordKeyDown(e, seg.word!.strongs_numbers, seg.word!.surface_text)}
                >
                  {body(i)}
                </span>
              ) : (
                <span key={i}>{body(i)}</span>
              ),
            );
          })()}
          <span className="verse-actions" dir="ltr" lang="en">
            <button title="Cross references" aria-label={`Cross references for verse ${v.verse}`} onClick={() => onShowCrossRefs(v.verse)}>
              <LinkIcon size={14} />
            </button>
            <button title="Compare translations" aria-label={`Compare translations of verse ${v.verse}`} onClick={() => onShowParallel(v.verse)}>
              <CompareIcon size={14} />
            </button>
            <button title="Commentary" aria-label={`Commentary on verse ${v.verse}`} onClick={() => onShowCommentary(v.verse)}>
              <BookIcon size={14} />
            </button>
            <button
              className="verse-menu-btn"
              title="More: interlinear, topics, bookmark, highlight, note, copy"
              aria-label={`More actions for verse ${v.verse}`}
              aria-expanded={menuVerse === v.verse}
              onClick={() => setMenuVerse((m) => (m === v.verse ? null : v.verse))}
            >
              <MoreIcon size={14} />
            </button>
          </span>
        </p>
        {menuVerse === v.verse && (
          <div className="verse-menu" role="menu" dir="ltr" lang="en">
            <button role="menuitem" onClick={() => { setMenuVerse(null); onShowInterlinear(v.verse); }}>
              <InterlinearIcon size={14} /> Interlinear (Hebrew / Greek)
            </button>
            <button role="menuitem" onClick={() => { setMenuVerse(null); onShowTopics(v.verse); }}>
              <TagIcon size={14} /> Topics &amp; dictionary for this verse
            </button>
            <button role="menuitem" onClick={() => toggleBookmark(v.verse)}>
              <BookmarkIcon size={14} /> {bookmarked.has(v.verse) ? "Remove bookmark" : "Bookmark"}
            </button>
            <button role="menuitem" onClick={() => openNote(v.verse)}>
              <NoteIcon size={14} /> {noted.has(v.verse) ? "Edit note" : "Add note"}
            </button>
            <button role="menuitem" onClick={() => copyVerse(v)}>
              <CopyIcon size={14} /> Copy verse
            </button>
            {onListen && (
              <button role="menuitem" onClick={() => { setMenuVerse(null); onListen(v.verse); }}>
                <SpeakerIcon size={14} /> Listen from here
              </button>
            )}
            <button
              role="menuitem"
              onClick={async () => {
                setMenuVerse(null);
                const ok = await addVersesToBasket(book, chapter, v.verse, v.verse, versionCode);
                showFlash(ok ? `Added ${book} ${chapter}:${v.verse} to the study basket` : "Couldn't add to the basket");
              }}
            >
              <BasketIcon size={14} /> Add to study basket
            </button>
            <button role="menuitem" onClick={() => { setMenuVerse(null); onPrepareSheet(v.verse, v.verse); }}>
              <SheetIcon size={14} /> Prepare study sheet…
            </button>
            <div className="verse-menu-colors" role="group" aria-label="Highlight colour">
              <span className="muted">Highlight</span>
              {[HIGHLIGHT_COLORS_SOFT, HIGHLIGHT_COLORS_BRIGHT].map((row, ri) => (
                <div className="swatch-row" key={ri}>
                  <span className="swatch-row-label muted">{ri === 0 ? "Soft" : "Bright"}</span>
                  {row.map((c) => (
                    <button
                      key={c}
                      role="menuitemradio"
                      aria-checked={hl === c}
                      className={`swatch swatch-${c}` + (hl === c ? " active" : "")}
                      title={highlightLabel(c, highlightTitles)}
                      aria-label={`Highlight ${highlightLabel(c, highlightTitles)}`}
                      onClick={() => highlight(v.verse, c)}
                    />
                  ))}
                </div>
              ))}
              {hl && (
                <button role="menuitem" className="text-btn swatch-clear" onClick={() => highlight(v.verse, null)}>
                  Clear highlight
                </button>
              )}
            </div>
          </div>
        )}
        {noteVerse === v.verse && (
          <div className="note-editor" dir="ltr" lang="en">
            <div className="note-editor-range">
              <label className="muted" htmlFor={`note-${v.verse}`}>
                Your note on {book} {chapter}:{v.verse}
                {noteEnd > v.verse ? `–${noteEnd}` : ""}
              </label>
              {lastVerse > v.verse && (
                <label className="muted">
                  through verse{" "}
                  <select value={noteEnd} onChange={(e) => setNoteEnd(Number(e.target.value))} aria-label="Last verse this note covers">
                    {verses
                      .filter((x) => x.verse >= v.verse)
                      .map((x) => (
                        <option key={x.verse} value={x.verse}>
                          {x.verse}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>
            <textarea
              id={`note-${v.verse}`}
              autoFocus
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) saveNote();
                if (e.key === "Escape") setNoteVerse(null);
              }}
              rows={4}
              placeholder="Write your thoughts, cross-references, prayer points… (Ctrl+Enter to save)"
            />
            <input
              className="note-tags-input"
              value={noteTags}
              onChange={(e) => setNoteTags(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveNote();
                if (e.key === "Escape") setNoteVerse(null);
              }}
              list={`note-tags-${v.verse}`}
              placeholder="Tags, separated by commas (e.g. faith, prayer, sermon: grace)"
              aria-label="Tags for this note"
            />
            <datalist id={`note-tags-${v.verse}`}>
              {tagSuggestions.map(([t]) => (
                <option key={t} value={noteTags.includes(",") ? `${noteTags.slice(0, noteTags.lastIndexOf(",") + 1)} ${t}` : t} />
              ))}
            </datalist>
            <div className="note-editor-actions">
              <button className="pill-btn" onClick={saveNote}>
                Save note
              </button>
              <button className="text-btn" onClick={() => setNoteVerse(null)}>
                Cancel
              </button>
              {noted.has(v.verse) && (
                <button
                  className="text-btn danger"
                  onClick={() => {
                    setNoteDraft("");
                    api.saveNote(book, chapter, v.verse, "").then(onMarksChanged).catch(() => undefined);
                    setNoteVerse(null);
                    showFlash("Note removed");
                  }}
                >
                  Delete note
                </button>
              )}
            </div>
          </div>
        )}
      </>
    );
  };

  // Original-language texts get proper script metadata: Hebrew lays out right-to-left
  // (instead of relying on per-word bidi inside an LTR paragraph) and both get a
  // slightly larger size via CSS.
  // (Side by side: the metadata goes on each column instead, so a Hebrew column doesn't
  // reverse the order of the columns.)
  const script = scriptFor(versionCode);

  return (
    <div
      className={"chapter-view" + (loading ? " is-loading" : "") + (parallelMode ? " parallel" : "")}
      ref={rootRef}
      aria-busy={loading}
      style={parallelMode ? ({ "--parallel-cols": 1 + extras.length } as React.CSSProperties) : undefined}
      {...(parallelMode ? {} : script)}
    >
      {/* stays at the top of the reading pane while the verses scroll under it */}
      <div className="chapter-sticky" ref={stickyRef}>
        <div className="chapter-heading" dir="ltr" lang="en">
          <h2>
            {book} {chapter}
          </h2>
          <span className="chapter-heading-actions">
            {pictureCount > 0 && (
              <button className="text-btn chapter-copy" onClick={onShowPictures} title="Pictures illustrating this chapter">
                <PictureIcon size={14} /> <span className="label">Pictures ({pictureCount})</span>
              </button>
            )}
            {onListen && (
              <button className="text-btn chapter-copy" onClick={() => onListen(verses[0]?.verse ?? 1)} title="Read this chapter aloud">
                <SpeakerIcon size={14} /> <span className="label">Listen</span>
              </button>
            )}
            <button
              className={"text-btn chapter-copy" + (parallelMode ? " active" : "")}
              onClick={toggleParallel}
              aria-pressed={parallelMode}
              title={parallelMode ? "Back to one translation" : "Read this chapter in two to four translations side by side"}
            >
              <ColumnsIcon size={14} /> <span className="label">{parallelMode ? "Single column" : "Side by side"}</span>
            </button>
            {parallelMode && extras.length < 3 && (
              <button className="text-btn chapter-copy" onClick={addColumn} title="Add another translation column">
                + <span className="label">Add translation</span>
              </button>
            )}
            <button className="text-btn chapter-copy" onClick={() => onPrepareSheet(1, verses[verses.length - 1]?.verse ?? 1)} title="Build a study sheet for this chapter or part of it (print, copy, or save as Word)">
              <SheetIcon size={14} /> <span className="label">Study sheet</span>
            </button>
            <button className="text-btn chapter-copy" onClick={copyChapter} title="Copy the whole chapter">
              <CopyIcon size={14} /> <span className="label">Copy chapter</span>
            </button>
          </span>
        </div>
        {flash && (
          <div className="reader-flash" role="status" dir="ltr" lang="en">
            {flash}
          </div>
        )}
        {parallelMode && (
          <div className="sbs-head" dir="ltr" lang="en">
            <div className="sbs-head-cell">
              <strong>{versionCode}</strong> <span className="muted">{nameOf(versionCode)}</span>
            </div>
            {extras.map((code, i) => (
              <div className="sbs-head-cell" key={code}>
                <select value={code} onChange={(e) => replaceColumn(i, e.target.value)} aria-label={`Column ${i + 2} translation`}>
                  {columnChoices(code).map((ver) => (
                    <option key={ver.code} value={ver.code}>
                      {ver.code} — {ver.name}
                    </option>
                  ))}
                </select>
                <button className="icon-only" onClick={() => removeColumn(code)} title="Remove this column" aria-label={`Remove ${code}`}>
                  <CloseIcon size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      {book === "Enoch" && (
        <details className="apparatus-key">
          <summary>What do the ⌜ ⌝ 〚 〛 ‹ › marks mean?</summary>
          <p>
            This translation (R.H. Charles &amp; W.O.E. Oesterley, 1917) is a critical edition that marks textual
            uncertainty rather than smoothing it over. Per the translators' own key:
          </p>
          <ul>
            <li><strong>⌜ ⌝</strong> — words found in the Greek (Gizeh) manuscript but not in the Ethiopic.</li>
            <li><strong>〚 〛</strong> — words found in the Ethiopic but not in the Greek.</li>
            <li><strong>‹ ›</strong> — words restored by the editor.</li>
            <li><strong>[ ]</strong> — interpolations.</li>
            <li><strong>( )</strong> — words supplied by the editor.</li>
            <li><strong>=bold text=</strong> — emended words.</li>
            <li><strong>† †</strong> — a corruption in the text.</li>
            <li><strong>…</strong> — words lost from the text.</li>
          </ul>
        </details>
      )}
      {rowNums.map((n) => {
        const v = mainByNum.get(n);
        if (!parallelMode) {
          return v ? (
            <div className="verse-block" key={n}>
              {verseContent(v)}
            </div>
          ) : null;
        }
        return (
          <div className={"verse-block sbs-row" + (readingVerse === n ? " sbs-row--reading" : "")} key={n}>
            <div className="sbs-cell sbs-main" {...script}>
              {v ? (
                verseContent(v)
              ) : (
                <p className="sbs-missing" dir="ltr" lang="en" title={`${versionCode} has no verse ${n} here`}>
                  <sup className="verse-num">{n}</sup> —
                </p>
              )}
            </div>
            {extras.map((code) => {
              const text = extraVerses[code]?.[n];
              return (
                <div className="sbs-cell" key={code} {...scriptFor(code)}>
                  {text ? (
                    <p className="sbs-text">
                      <sup className="verse-num">{n}</sup> {redText(code, n, text)}
                    </p>
                  ) : (
                    <p className="sbs-missing" title={`${code} has no verse ${n} here`}>
                      <sup className="verse-num">{n}</sup> —
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      {nav}
    </div>
  );
}
