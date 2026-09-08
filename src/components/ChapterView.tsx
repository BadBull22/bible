import { useEffect, useRef } from "react";
import { VerseWithWords } from "../api";

// TR (Textus Receptus) and WLC (Westminster Leningrad Codex) are original-language
// single-testament texts, not full Bibles -- an empty chapter in one of these is
// expected outside its testament, not missing data.
const SINGLE_TESTAMENT_VERSIONS: Record<string, string> = {
  TR: "Textus Receptus is the Greek New Testament text — it only contains the 27 New Testament books.",
  WLC: "The Westminster Leningrad Codex is the Hebrew Old Testament text — it only contains the 39 Old Testament books.",
};

interface Props {
  book: string;
  chapter: number;
  versionCode: string;
  verses: VerseWithWords[];
  loading: boolean;
  targetVerse: number | null;
  onWordClick: (strongsNumber: string, surfaceText: string) => void;
  onShowCrossRefs: (verse: number) => void;
  onShowParallel: (verse: number) => void;
}

export function ChapterView({
  book,
  chapter,
  versionCode,
  verses,
  loading,
  targetVerse,
  onWordClick,
  onShowCrossRefs,
  onShowParallel,
}: Props) {
  const verseRefs = useRef<Record<number, HTMLElement | null>>({});

  useEffect(() => {
    if (targetVerse == null) return;
    const el = verseRefs.current[targetVerse];
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
    // retrigger the CSS highlight animation even if the same verse was jumped to
    // again while its previous flash was still fading out
    el?.classList.remove("verse-row--target");
    void el?.offsetWidth;
    el?.classList.add("verse-row--target");
  }, [verses, targetVerse]);

  if (loading) return <div className="chapter-view loading">Loading…</div>;
  if (verses.length === 0) {
    const note = SINGLE_TESTAMENT_VERSIONS[versionCode];
    return (
      <div className="chapter-view empty">
        {note ? (
          <>
            <p>No text for {book} {chapter} in this version.</p>
            <p>{note}</p>
          </>
        ) : (
          <p>No text for this chapter in the selected version.</p>
        )}
      </div>
    );
  }

  return (
    <div className="chapter-view">
      <h2>
        {book} {chapter}
      </h2>
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
      {verses.map((v) => (
        <p className="verse-row" key={v.verse} ref={(el) => { verseRefs.current[v.verse] = el; }}>
          <sup className="verse-num">{v.verse}</sup>{" "}
          {v.words.length > 0 ? (
            v.words.map((w, i) => (
              <span
                key={i}
                className={"word" + (w.strongs_numbers.length ? " has-strongs" : "")}
                onClick={() => w.strongs_numbers.length && onWordClick(w.strongs_numbers[0], w.surface_text)}
              >
                {w.surface_text}{" "}
              </span>
            ))
          ) : (
            <span>{v.text}</span>
          )}
          <span className="verse-actions">
            <button title="Cross references" onClick={() => onShowCrossRefs(v.verse)}>
              ⛓
            </button>
            <button title="Compare versions" onClick={() => onShowParallel(v.verse)}>
              ⇄
            </button>
          </span>
        </p>
      ))}
    </div>
  );
}
