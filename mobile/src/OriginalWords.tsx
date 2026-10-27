// The "Original words" download (since 2.9.5): a verse's Hebrew or Greek words one by one -- as written, how to say them,
// what each means here, its dictionary form and its grammar in plain words -- as the computer app's interlinear shows them.
// The words are a one-time download (about 12 MB, STEPBible's data, CC BY 4.0), kept on the phone; this offers it, shows the
// words, and lets it be removed. The work is in `src-tauri/src/original_pack.rs`.

import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, OriginalWord } from "./api";

export interface OriginalPack {
  /** null until known */
  installed: boolean | null;
  size: number;
  /** the percentage downloaded, while downloading */
  downloading: number | null;
  error: string | null;
  install: () => Promise<void>;
  remove: () => Promise<void>;
}

const listeners = new Set<() => void>();

export function useOriginalPack(): OriginalPack {
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [size, setSize] = useState(12);
  const [downloading, setDownloading] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () =>
    api
      .originalStatus()
      .then((s) => {
        setInstalled(s.installed);
        setSize(s.size_mb);
      })
      .catch(() => setInstalled(false));
  useEffect(() => {
    void refresh();
    listeners.add(refresh);
    return () => void listeners.delete(refresh);
  }, []);
  return {
    installed,
    size,
    downloading,
    error,
    install: async () => {
      setError(null);
      setDownloading(0);
      const un = await listen<number>("original-pack-progress", (e) => setDownloading(e.payload));
      try {
        await api.originalInstall();
      } catch (e) {
        setError(String(e));
      } finally {
        un();
        setDownloading(null);
        listeners.forEach((f) => void f());
      }
    },
    remove: async () => {
      await api.originalRemove();
      listeners.forEach((f) => void f());
    },
  };
}

function Progress({ pct }: { pct: number }) {
  return (
    <>
      <div className="bar" aria-hidden>
        <i style={{ width: `${pct}%` }} />
      </div>
      <p className="hint keep">Downloading… {pct}%</p>
    </>
  );
}

/** In Word Study while the words are not downloaded. */
export function OriginalOffer({ pack }: { pack: OriginalPack }) {
  if (pack.installed !== false) return null;
  return (
    <div className="card upgrade-offer">
      <strong>See every Greek or Hebrew word</strong>
      <p className="hint">
        Each word as it was written, how to say it, what it means in this verse, its dictionary form and its grammar in plain words — as the computer app's interlinear does. A one-time {pack.size} MB download; then it works offline.
      </p>
      {pack.downloading != null ? (
        <Progress pct={pack.downloading} />
      ) : (
        <div className="actions">
          <button className="primary" onClick={() => void pack.install()}>
            Get the original words ({pack.size} MB)
          </button>
        </div>
      )}
      {pack.error && <p className="hint status">{pack.error}</p>}
    </div>
  );
}

/** In More. */
export function OriginalSettings({ pack }: { pack: OriginalPack }) {
  return (
    <>
      <h2>Original words (offline)</h2>
      <p className="hint">
        Every word of the Hebrew Old Testament and the Greek New Testament, one by one, in Word Study (tap a verse, then Words): as written, how to say it, what it means, its dictionary form and its grammar in plain words. It stays on
        this phone and works without the internet.
      </p>
      {pack.installed ? (
        <>
          <p className="hint status">Downloaded.</p>
          <div className="actions">
            <button onClick={() => void pack.remove()}>Remove it ({pack.size} MB)</button>
          </div>
        </>
      ) : pack.downloading != null ? (
        <Progress pct={pack.downloading} />
      ) : (
        <div className="actions">
          <button className="primary" onClick={() => void pack.install()}>
            Get it ({pack.size} MB)
          </button>
        </div>
      )}
      {pack.error && <p className="hint status">{pack.error}</p>}
    </>
  );
}

// Which Greek text to show: the pack records, for each word, every edition that has it.
type GreekText = "Tyn" | "TR" | "all";
const GREEK_TEXTS: { key: GreekText; label: string }[] = [
  { key: "Tyn", label: "Critical text" },
  { key: "TR", label: "Textus Receptus (KJV)" },
  { key: "all", label: "Show all" },
];

/** STEPBible marks helper words as "<obj.>" and "<the>" and joins their parts with "/": tidied for reading. */
const cleanGloss = (g: string) => g.replace(/[<>]/g, "").replace(/\/\s*/g, " ").trim();
/** A Hebrew word joins its prefix and its body with "/" (בְּ/רֵאשִׁית): shown with a small gap. */
const cleanOriginal = (o: string) => o.replace(/\//g, " · ");
const cleanTranslit = (t: string) => t.replace(/\//g, " · ");

interface Props {
  book: string;
  chapter: number;
  verse: number;
  /** opens the Strong's entry for a word (a word may have more than one number) */
  onStudy: (numbers: string[]) => void;
  fail: (e: unknown) => void;
}

/** The verse's words one by one, each a card: tap it for the dictionary entry. */
export function OriginalWords({ book, chapter, verse, onStudy, fail }: Props) {
  const [data, setData] = useState<[OriginalWord[], string] | null>(null);
  const [greek, setGreek] = useState<GreekText>("Tyn");

  useEffect(() => {
    setData(null);
    api.originalWords(book, chapter, verse).then(setData).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapter, verse]);

  if (!data) return <p className="hint">Loading…</p>;
  const [words, credit] = data;
  if (words.length === 0) return <p className="hint">This verse has no word-by-word data.</p>;
  const isGreek = words[0].language === "Greek";
  const shown = isGreek && greek !== "all" ? words.filter((w) => w.editions.includes(greek)) : words;
  const differs = isGreek ? words.filter((w) => !(w.editions.includes("Tyn") && w.editions.includes("TR"))).length : 0;

  return (
    <>
      <p className="hint">
        {isGreek ? "The Greek" : "The Hebrew"} of this verse, word by word{isGreek ? "" : ", read from the right"}. Tap a word for its dictionary entry.
      </p>
      {isGreek && differs > 0 && (
        <div className="seg" role="group" aria-label="Which Greek text">
          {GREEK_TEXTS.map((g) => (
            <button key={g.key} className={greek === g.key ? "on" : ""} onClick={() => setGreek(g.key)} aria-pressed={greek === g.key}>
              {g.label}
            </button>
          ))}
        </div>
      )}
      {isGreek && greek === "all" && <p className="hint">Every word in any edition; the editions that have each word are listed under it.</p>}
      <div className="ow-list">
        {shown.map((w, i) => {
          const grammar = w.morph_parts.map((p) => p.summary || p.code).filter(Boolean).join(" + ");
          const body = (
            <>
              <span className="ow-orig" lang={w.language === "Hebrew" ? "he" : "grc"} dir={w.language === "Hebrew" ? "rtl" : "ltr"}>
                {cleanOriginal(w.original)}
              </span>
              <span className="ow-gloss">{cleanGloss(w.gloss) || "—"}</span>
              <span className="ow-tr">{cleanTranslit(w.translit)}</span>
              {w.strongs && <span className="ow-num">{w.strongs} ›</span>}
              {w.lemma && (
                <span className="ow-lemma">
                  <span lang={w.language === "Hebrew" ? "he" : "grc"}>{w.lemma}</span>
                  {w.lemma_gloss && <> · {w.lemma_gloss.replace(/_/g, " ")}</>}
                </span>
              )}
              {grammar && <span className="ow-gram">{grammar}</span>}
              {isGreek && greek === "all" && <span className="ow-gram">in: {w.editions.join(", ") || "—"}</span>}
            </>
          );
          return w.strongs ? (
            <button key={i} className="ow" onClick={() => onStudy([w.strongs])}>
              {body}
            </button>
          ) : (
            <div key={i} className="ow plain">
              {body}
            </div>
          );
        })}
      </div>
      <p className="attribution">{credit}</p>
    </>
  );
}
