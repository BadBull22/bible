import { AskAnswer, AskCitation, QaConfidence, parseCitation } from "../api";

const CONFIDENCE_LABEL: Record<QaConfidence, string> = {
  stated: "Stated in scripture",
  computed: "Computed from this app's own data",
  traditional: "Traditional / scholarly consensus",
  commentary_opinion: "A commentator's view, not scripture",
  doctrinal_view: "Scripture first, then the Pentecostal / evangelical reading",
  unattested: "Not stated in scripture",
};

type OnJump = (book: string, chapter: number, verse: number) => void;

/** A row of citation buttons for a curated answer; a reference that can't be parsed is
 * shown but disabled rather than hidden, so a bad citation is visible instead of
 * silently dropped -- same reasoning as FirstsPanel's RefRow. */
export function AskRefRow({ citations, onJump }: { citations: AskCitation[]; onJump: OnJump }) {
  if (citations.length === 0) return null;
  return (
    <div className="citation-row">
      {citations.map((c, i) => {
        const ref = parseCitation(c.reference);
        return (
          <button
            key={`${c.reference}-${i}`}
            className="link-btn"
            disabled={!ref}
            title={c.role}
            onClick={() => ref && onJump(ref.book, ref.chapter, ref.verse)}
          >
            {c.reference}
          </button>
        );
      })}
    </div>
  );
}

/** Renders the "answer" part of an `AskAnswer` -- the computed-count summary line, or
 * the curated confidence badge + prose + citations, or the fallback heading. Does NOT
 * render the verse-hit list itself: `Computed`/`Fallback` results are unpacked by the
 * caller into whatever hit-list state/markup it already has (SearchPanel's `hits`
 * side-panel list, HomeScreen's own results list), so this only owns the parts that are
 * genuinely new markup shared between both entry points. */
export function AskAnswerView({
  answer,
  hitCount,
  commentaryHitCount = 0,
  onJump,
}: {
  answer: AskAnswer;
  hitCount: number;
  commentaryHitCount?: number;
  onJump: OnJump;
}) {
  if (answer.kind === "computed") {
    return (
      <p className="frequency-summary">
        "{answer.word}" appears <strong>{answer.result.total_occurrences}</strong> time{answer.result.total_occurrences === 1 ? "" : "s"} in the Bible
        (BSB){answer.result.scope_label ? ` ${answer.result.scope_label}` : ""}, across {hitCount} verse{hitCount === 1 ? "" : "s"}.
      </p>
    );
  }
  if (answer.kind === "curated") {
    return (
      <div className="curated-answer">
        <span className={`confidence-badge conf-${answer.entry.confidence}`}>{CONFIDENCE_LABEL[answer.entry.confidence]}</span>
        <p className="curated-answer-text">{answer.entry.answer}</p>
        {answer.entry.note && <p className="snippet note">{answer.entry.note}</p>}
        <AskRefRow citations={answer.entry.citations} onJump={onJump} />
        {answer.matched_by === "semantic" && (
          <p className="search-hint">
            Matched by meaning, not your exact wording{answer.similarity !== null ? ` (similarity ${answer.similarity.toFixed(2)})` : ""} — the closest
            curated question on file was "{answer.entry.question}"
          </p>
        )}
      </div>
    );
  }
  return (
    <p className="result-count">
      {hitCount === 0 && commentaryHitCount === 0
        ? "No direct answer on file, and nothing closely related was found either."
        : "No direct answer on file — here's what's most relevant:"}
    </p>
  );
}
