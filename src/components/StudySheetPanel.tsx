import { useEffect, useMemo, useRef, useState } from "react";
import { api, CommentaryInfo, SheetBlock, Version } from "../api";
import { buildSheet, passageLabel, SheetOptions } from "../studySheet";
import { CloseIcon } from "./icons";
import { SheetOutput } from "./SheetOutput";

interface Props {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  /** verses in the chapter (0 = unknown) */
  verseCount: number;
  versions: Version[];
  /** the translation being read, used as the default first translation */
  versionCode: string;
  onClose: () => void;
}

// What to include is remembered between sheets (per viewer); the passage and title are not.
type Remembered = Omit<SheetOptions, "book" | "chapter" | "verseStart" | "verseEnd" | "title">;
const PREFS_KEY = "studySheet:prefs";
const DEFAULTS: Remembered = { translations: [], crossRefs: 8, myNotes: true, commentaries: [], topics: true, keyWords: true, blankLines: 12 };

function readPrefs(): Remembered {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function StudySheetPanel({ book, chapter, verseStart, verseEnd, verseCount, versions, versionCode, onClose }: Props) {
  const [prefs, setPrefs] = useState<Remembered>(readPrefs);
  const [from, setFrom] = useState(verseStart);
  const [to, setTo] = useState(verseEnd);
  const [title, setTitle] = useState("");
  const [commentaries, setCommentaries] = useState<CommentaryInfo[]>([]);
  const [blocks, setBlocks] = useState<SheetBlock[]>([]);
  const [building, setBuilding] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    setFrom(verseStart);
    setTo(verseEnd);
  }, [book, chapter, verseStart, verseEnd]);

  useEffect(() => {
    api.listCommentaries().then(setCommentaries).catch(() => undefined);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* per-viewer convenience only */
    }
  }, [prefs]);

  // Translations: keep the remembered ones that exist; default to the one being read
  // (or BSB when reading an original-language text).
  const readable = versions.filter((v) => v.code !== "ENOCH1");
  const translations = useMemo(() => {
    const valid = prefs.translations.filter((c) => readable.some((v) => v.code === c)).slice(0, 3);
    if (valid.length) return valid;
    const cur = versions.find((v) => v.code === versionCode);
    return [cur && !cur.is_original_language ? versionCode : "BSB"];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.translations, versions, versionCode]);

  const lo = Math.max(1, Math.min(from, to));
  const hi = Math.max(from, to);
  const defaultTitle = passageLabel(book, chapter, lo, hi);

  useEffect(() => {
    if (versions.length === 0) return;
    const id = ++requestId.current;
    setBuilding(true);
    const timer = window.setTimeout(() => {
      buildSheet({ ...prefs, translations, book, chapter, verseStart: lo, verseEnd: hi, title: title || defaultTitle }, versions)
        .then((b) => id === requestId.current && setBlocks(b))
        .catch((e) => id === requestId.current && setStatus(`Couldn't build the sheet: ${e}`))
        .finally(() => id === requestId.current && setBuilding(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [prefs, translations, book, chapter, lo, hi, title, defaultTitle, versions]);

  const set = <K extends keyof Remembered>(k: K, v: Remembered[K]) => setPrefs((p) => ({ ...p, [k]: v }));

  function setTranslation(slot: number, code: string) {
    const next = [...translations];
    if (code) next[slot] = code;
    else next.splice(slot, 1);
    set("translations", [...new Set(next.filter(Boolean))]);
  }

  const sheetTitle = title.trim() || defaultTitle;

  const verseOptions = Array.from({ length: Math.max(verseCount, hi) }, (_, i) => i + 1);

  return (
    <aside className="side-panel wide sheet-panel">
      <div className="side-panel-header">
        <h3>Study sheet: {defaultTitle}</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>

      <details className="sheet-options" open>
        <summary>Choose what to include</summary>
        <div className="sheet-grid">
          <label htmlFor="sheet-title">Title</label>
          <input id="sheet-title" value={title} placeholder={defaultTitle} onChange={(e) => setTitle(e.target.value)} />

          <span>Verses</span>
          <span className="sheet-inline">
            <select value={from} onChange={(e) => setFrom(Number(e.target.value))} aria-label="First verse">
              {verseOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            to
            <select value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label="Last verse">
              {verseOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <span className="muted">
              of {book} {chapter}
            </span>
          </span>

          <span>Translations</span>
          <span className="sheet-inline sheet-translations">
            {[0, 1, 2].map((slot) =>
              slot > translations.length ? null : (
                <select key={slot} value={translations[slot] ?? ""} onChange={(e) => setTranslation(slot, e.target.value)} aria-label={`Translation ${slot + 1}`}>
                  {slot > 0 && <option value="">{slot === translations.length ? "+ add another" : "— remove —"}</option>}
                  {readable.map((v) => (
                    <option key={v.code} value={v.code} disabled={translations.includes(v.code) && translations[slot] !== v.code}>
                      {v.code} — {v.name}
                    </option>
                  ))}
                </select>
              ),
            )}
          </span>

          <span>Cross references</span>
          <select value={prefs.crossRefs} onChange={(e) => set("crossRefs", Number(e.target.value))}>
            {[0, 5, 8, 12, 20].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Leave out" : `Strongest ${n}, with their text`}
              </option>
            ))}
          </select>

          <span>Include</span>
          <span className="sheet-checks">
            <label>
              <input type="checkbox" checked={prefs.keyWords} onChange={(e) => set("keyWords", e.target.checked)} /> Key Hebrew / Greek words
            </label>
            <label>
              <input type="checkbox" checked={prefs.myNotes} onChange={(e) => set("myNotes", e.target.checked)} /> My notes &amp; highlights
            </label>
            <label>
              <input type="checkbox" checked={prefs.topics} onChange={(e) => set("topics", e.target.checked)} /> Topics (Nave's, Torrey's)
            </label>
          </span>

          <span>Commentaries</span>
          <span className="sheet-checks">
            {commentaries.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={prefs.commentaries.includes(c.id)}
                  onChange={(e) =>
                    set("commentaries", e.target.checked ? [...prefs.commentaries, c.id] : prefs.commentaries.filter((x) => x !== c.id))
                  }
                />{" "}
                {c.name}
              </label>
            ))}
          </span>

          <span>Space for notes</span>
          <select value={prefs.blankLines} onChange={(e) => set("blankLines", Number(e.target.value))}>
            {[0, 8, 12, 20, 30].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "None" : `${n} blank lines`}
              </option>
            ))}
          </select>
        </div>
      </details>

      {status && (
        <p className="status-error" role="status">
          {status}
        </p>
      )}
      <SheetOutput blocks={blocks} title={sheetTitle} building={building} />
    </aside>
  );
}
