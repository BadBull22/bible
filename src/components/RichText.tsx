import { Fragment } from "react";

type OnJump = (book: string, chapter: number, verse: number) => void;

// Dictionary bodies (study.db) are plain text with scripture references embedded as
// ⟦Book|chapter|verse|verse_end|label⟧ markers -- never HTML -- so they can be shown
// without injecting markup. A chapter-only reference ("Numbers 16") has an empty verse
// and jumps to verse 1.
const MARKER = /⟦([^|⟧]*)\|(\d+)\|(\d*)\|(\d*)\|([^⟧]*)⟧/g;

function Line({ text, onJump }: { text: string; onJump: OnJump }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKER)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    const [, book, ch, v, , label] = m;
    const chapter = Number(ch);
    const verse = v ? Number(v) : 1;
    parts.push(
      <button key={i} className="link-btn inline-ref" onClick={() => onJump(book, chapter, verse)} title={`Go to ${book} ${ch}${v ? `:${v}` : ""}`}>
        {label}
      </button>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** Renders a dictionary/topical entry body: blank lines separate paragraphs, single
 * newlines are line breaks, and reference markers become clickable links. */
export function RichText({ text, onJump }: { text: string; onJump: OnJump }) {
  return (
    <div className="rich-text">
      {text.split(/\n{2,}/).map((para, pi) => (
        <p key={pi}>
          {para.split("\n").map((line, li) => (
            <Fragment key={li}>
              {li > 0 && <br />}
              <Line text={line} onJump={onJump} />
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  );
}

/** Marker-free plain text (for copying). */
export function plainText(text: string): string {
  return text.replace(MARKER, (_m, _b, _c, _v, _e, label) => label);
}
