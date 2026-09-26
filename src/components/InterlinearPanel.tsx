import { useEffect, useMemo, useState } from "react";
import { api, InterlinearWord } from "../api";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from "./icons";

interface Props {
  book: string;
  chapter: number;
  verse: number;
  verseCount: number;
  onChangeVerse: (verse: number) => void;
  onWordStudy: (strongsNumbers: string[], surfaceText: string) => void;
  onClose: () => void;
}

// Which Greek text to show. TAGNT records, per word, every edition that contains it, so
// the same word list serves both texts this app bundles as reading versions.
type GreekText = "Tyn" | "TR" | "all";
const GREEK_TEXTS: { key: GreekText; label: string; title: string }[] = [
  { key: "Tyn", label: "Critical text", title: "Tyndale House Greek New Testament (2017) -- the text behind most modern translations" },
  { key: "TR", label: "Textus Receptus", title: "The Greek text behind the King James Version" },
  { key: "all", label: "Show all", title: "Every word found in any edition, with the editions marked" },
];

const EDITION_NAMES: Record<string, string> = {
  NA28: "Nestle-Aland 28",
  NA27: "Nestle-Aland 27",
  Tyn: "Tyndale House",
  SBL: "SBL",
  WH: "Westcott-Hort",
  Treg: "Tregelles",
  TR: "Textus Receptus",
  Byz: "Byzantine",
};

function cleanGloss(g: string) {
  // STEPBible marks grammatical helper words as "<obj.>", "<the>" and joins morphemes
  // with "/" -- tidy those for reading.
  return g.replace(/[<>]/g, "").replace(/\/\s*/g, " ").trim();
}

export function InterlinearPanel({ book, chapter, verse, verseCount, onChangeVerse, onWordStudy, onClose }: Props) {
  const [words, setWords] = useState<InterlinearWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [greekText, setGreekText] = useState<GreekText>("Tyn");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .interlinearVerse(book, chapter, verse)
      .then((w) => !cancelled && setWords(w))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [book, chapter, verse]);

  const isGreek = words.some((w) => w.editions.length > 0);
  const isHebrew = words.length > 0 && !isGreek;
  const shown = useMemo(() => {
    if (!isGreek || greekText === "all") return words;
    return words.filter((w) => w.editions.includes(greekText));
  }, [words, isGreek, greekText]);
  const differs = isGreek ? words.filter((w) => !(w.editions.includes("Tyn") && w.editions.includes("TR"))).length : 0;

  return (
    <aside className="side-panel wide interlinear-panel">
      <div className="side-panel-header">
        <h3>
          Interlinear: {book} {chapter}:{verse}
        </h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="interlinear-nav">
        <button className="text-btn" disabled={verse <= 1} onClick={() => onChangeVerse(verse - 1)} title="Previous verse">
          <ChevronLeftIcon size={14} /> Verse {verse - 1 || ""}
        </button>
        <span className="muted">{isHebrew ? "Hebrew (Leningrad Codex)" : isGreek ? "Greek New Testament" : ""}</span>
        <button className="text-btn" disabled={verseCount > 0 && verse >= verseCount} onClick={() => onChangeVerse(verse + 1)} title="Next verse">
          Verse {verse + 1} <ChevronRightIcon size={14} />
        </button>
      </div>
      {isGreek && (
        <div className="mode-toggle" role="tablist" aria-label="Greek text">
          {GREEK_TEXTS.map((t) => (
            <button key={t.key} role="tab" aria-selected={greekText === t.key} className={greekText === t.key ? "active" : ""} title={t.title} onClick={() => setGreekText(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {isGreek && differs > 0 && (
        <p className="search-hint interlinear-note">
          {differs} {differs === 1 ? "word differs" : "words differ"} between the critical text and the Textus Receptus in this
          verse. Choose <em>Show all</em> to see each word's editions.
        </p>
      )}
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="status-error">Couldn't load the interlinear: {error}</p>}
      {!loading && !error && words.length === 0 && <p className="muted">No original-language data for this verse.</p>}
      <div className="interlinear-words" dir={isHebrew ? "rtl" : "ltr"}>
        {shown.map((w, i) => {
          const grammar = w.morph_parts.map((p) => p.summary || p.code).filter(Boolean).join(" + ");
          const detail = w.morph_parts.map((p) => `${p.code}: ${p.detail || p.summary}`).join("\n");
          const notInAll = isGreek && w.editions.length < 8;
          return (
            <div key={`${w.word_pos}-${i}`} className={"iw" + (notInAll && greekText === "all" ? " iw--variant" : "")} dir="ltr">
              <div className="iw-original" lang={isHebrew ? "he" : "grc"} dir={isHebrew ? "rtl" : "ltr"}>
                {w.original.replace(/\//g, "")}
              </div>
              <div className="iw-translit">{w.translit.replace(/\//g, "")}</div>
              <div className="iw-gloss">{cleanGloss(w.gloss)}</div>
              {w.strongs ? (
                <button className="link-btn iw-strongs" onClick={() => onWordStudy([w.strongs], w.original)} title="Open in Word Study">
                  {w.strongs}
                </button>
              ) : (
                <span className="iw-strongs muted">—</span>
              )}
              {w.lemma && (
                <div className="iw-lemma" title="Dictionary form">
                  <span lang={isHebrew ? "he" : "grc"}>{w.lemma}</span>
                  {w.lemma_gloss && <span className="muted"> · {w.lemma_gloss.replace(/_/g, " ")}</span>}
                </div>
              )}
              {grammar && (
                <div className="iw-grammar" title={detail}>
                  {grammar}
                </div>
              )}
              {greekText === "all" && notInAll && (
                <div className="iw-editions" title={w.editions.map((e) => EDITION_NAMES[e] ?? e).join(", ")}>
                  in: {w.editions.join(", ") || "—"}
                </div>
              )}
              {isHebrew && w.word_type !== "L" && (
                <div className="iw-editions" title="Ketiv = the written form; Qere = the form read aloud (a scribal note)">
                  {w.word_type.startsWith("Q") ? "Qere (read)" : w.word_type.startsWith("K") || w.word_type.startsWith("k") ? "Ketiv (written)" : w.word_type}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="search-hint">
        Word-by-word data: STEPBible TAHOT / TAGNT (Tyndale House, Cambridge), CC BY 4.0. Hover a grammar line for the full
        parsing. Click a Strong's number to open Word Study.
      </p>
    </aside>
  );
}
