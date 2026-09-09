import { KeyboardEvent, useEffect, useRef } from "react";
import { VerseWithWords } from "../api";
import { segmentVerse } from "../verseSegments";
import { ChevronLeftIcon, ChevronRightIcon, CompareIcon, LinkIcon } from "./icons";

// TR (Textus Receptus) and WLC (Westminster Leningrad Codex) are original-language
// single-testament texts, not full Bibles -- an empty chapter in one of these is
// expected outside its testament, not missing data.
const SINGLE_TESTAMENT_VERSIONS: Record<string, string> = {
  TR: "Textus Receptus is the Greek New Testament text — it only contains the 27 New Testament books.",
  WLC: "The Westminster Leningrad Codex is the Hebrew Old Testament text — it only contains the 39 Old Testament books.",
};

interface Location {
  book: string;
  chapter: number;
}

interface Props {
  book: string;
  chapter: number;
  versionCode: string;
  verses: VerseWithWords[];
  loading: boolean;
  error: string | null;
  targetVerse: number | null;
  prev: Location | null;
  next: Location | null;
  onNavigate: (to: Location | null) => void;
  onWordClick: (strongsNumbers: string[], surfaceText: string) => void;
  onShowCrossRefs: (verse: number) => void;
  onShowParallel: (verse: number) => void;
}

export function ChapterView({
  book,
  chapter,
  versionCode,
  verses,
  loading,
  error,
  targetVerse,
  prev,
  next,
  onNavigate,
  onWordClick,
  onShowCrossRefs,
  onShowParallel,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const verseRefs = useRef<Record<number, HTMLElement | null>>({});
  const locationKey = `${book}/${chapter}`;
  const lastScrolledLocation = useRef<string | null>(null);

  // Scroll handling runs once the new chapter's verses are actually on screen:
  // either bring the jump target into view with a highlight flash, or (for plain
  // chapter navigation) return to the top, since the previous chapter's content
  // stays visible during the load and would otherwise leave the reader mid-page.
  useEffect(() => {
    if (loading) return;
    if (targetVerse != null) {
      const el = verseRefs.current[targetVerse];
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      // retrigger the CSS highlight animation even if the same verse was jumped to
      // again while its previous flash was still fading out
      el?.classList.remove("verse-row--target");
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

  function wordKeyDown(e: KeyboardEvent<HTMLSpanElement>, numbers: string[], surface: string) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onWordClick(numbers, surface);
    }
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

  // Original-language texts get proper script metadata: Hebrew lays out right-to-left
  // (instead of relying on per-word bidi inside an LTR paragraph) and both get a
  // slightly larger size via CSS.
  const script = versionCode === "WLC" ? { dir: "rtl" as const, lang: "he" } : versionCode === "TR" ? { lang: "grc" } : {};

  return (
    <div className={"chapter-view" + (loading ? " is-loading" : "")} ref={rootRef} aria-busy={loading} {...script}>
      <h2 dir="ltr" lang="en">
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
          {segmentVerse(v.text, v.words).map((seg, i) =>
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
                {seg.text}
              </span>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
          <span className="verse-actions">
            <button title="Cross references" aria-label={`Cross references for verse ${v.verse}`} onClick={() => onShowCrossRefs(v.verse)}>
              <LinkIcon size={14} />
            </button>
            <button title="Compare translations" aria-label={`Compare translations of verse ${v.verse}`} onClick={() => onShowParallel(v.verse)}>
              <CompareIcon size={14} />
            </button>
          </span>
        </p>
      ))}
      {nav}
    </div>
  );
}
