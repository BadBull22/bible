// The answer above the search results when what was typed is a question (ask.rs): a count, a
// hand-checked answer with how sure it is, or a Bible dictionary's entry -- as the desktop
// app's "Ask a question" answers.

import { Answer, Book } from "./api";
import { parseReference } from "./refs";

/** How sure a hand-checked answer is (the desktop's labels). */
const CONFIDENCE: Record<string, string> = {
  stated: "Stated in Scripture",
  computed: "Counted from the Bible text",
  traditional: "Traditional / scholarly view",
  commentary_opinion: "A commentator's view, not Scripture",
  doctrinal_view: "Scripture first, then the Pentecostal reading",
  unattested: "Not stated in Scripture",
};

export function AskAnswer({
  answer,
  books,
  onOpen,
  onArticle,
}: {
  answer: Answer;
  books: Book[];
  onOpen: (book: string, chapter: number, verse: number) => void;
  onArticle: (id: number) => void;
}) {
  if (answer.kind === "count") {
    return (
      <div className="card answer">
        <p className="answer-text">
          “{answer.word}” is in the Bible <strong>{answer.total.toLocaleString()}</strong> time{answer.total === 1 ? "" : "s"}
          {answer.scope ? ` ${answer.scope}` : ""}, in {answer.verses.toLocaleString()} verse{answer.verses === 1 ? "" : "s"} (BSB, counted whole words).
        </p>
      </div>
    );
  }
  if (answer.kind === "dictionary") {
    return (
      <div className="card answer">
        <span className="badge">From {answer.source} — a reference work, not Scripture</span>
        <h3>{answer.headword}</h3>
        <p className="answer-text">{answer.preview.replace(/⟦[^|⟧]*\|\d+\|\d*\|\d*\|([^⟧]*)⟧/g, "$1")}</p>
        <button className="link" onClick={() => onArticle(answer.id)}>
          Read the whole entry
        </button>
      </div>
    );
  }
  return (
    <div className="card answer">
      <span className={`badge conf-${answer.confidence}`}>{CONFIDENCE[answer.confidence] ?? answer.confidence}</span>
      {answer.by_meaning && <p className="hint">The closest question on file: “{answer.question}”</p>}
      <p className="answer-text">{answer.answer}</p>
      {answer.note && <p className="hint">{answer.note}</p>}
      {answer.citations.length > 0 && (
        <div className="chips">
          {answer.citations.map((c, i) => {
            const ref = parseReference(c.reference, books);
            return (
              <button key={`${c.reference}-${i}`} disabled={!ref} title={c.role} onClick={() => ref && onOpen(ref.book, ref.chapter, ref.verse ?? 1)}>
                {c.reference}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
