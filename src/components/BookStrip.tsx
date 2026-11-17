// One bar for every book of the Bible, Genesis to Revelation: how often a word, a meaning or a group is used where, at a glance. The Old Testament bars are
// amber and the New Testament bars blue. Every bar can be pressed (to read that book's verses) and has its number in a tip; the same numbers are also
// listed in the table kept below the strip by the Concordance.

import { useState } from "react";
import { barHeight } from "../semantic";

export interface StripBook {
  name: string;
  testament: "OT" | "NT";
  count: number;
}

interface Props {
  books: StripBook[];
  /** what the numbers count: "verse", "time" */
  unit: string;
  label: string;
  onPick?: (book: string) => void;
}

const W = 660;
const FULL = 52;
/** the books that get a name under the strip (the first of a group of books people look for) */
const MARKS = ["Genesis", "Psalms", "Isaiah", "Matthew", "Romans", "Revelation"];

export function BookStrip({ books, unit, label, onPick }: Props) {
  const [tip, setTip] = useState<string>("");
  const n = books.length || 66;
  const bw = W / n;
  const max = Math.max(0, ...books.map((b) => b.count));
  const say = (b: StripBook) => setTip(b.count ? `${b.name}: ${b.count.toLocaleString("en-US")} ${unit}${b.count === 1 ? "" : "s"}` : `${b.name}: not used`);
  const firstNt = books.findIndex((b) => b.testament === "NT");
  return (
    <div className="book-strip">
      <div className="book-strip-scroll">
        <svg viewBox={`0 0 ${W} 78`} role="group" aria-label={label}>
          {books.map((b, i) => {
            const h = barHeight(b.count, max, FULL);
            const x = i * bw + 0.8;
            const cls = b.testament === "OT" ? "ot" : "nt";
            const press = onPick && b.count > 0 ? () => onPick(b.name) : undefined;
            return (
              <g key={b.name}>
                <rect className="bs-hit" x={i * bw} y={0} width={bw} height={62} fill="transparent" onMouseEnter={() => say(b)} onMouseLeave={() => setTip("")} onClick={press} style={press ? { cursor: "pointer" } : undefined} />
                {h > 0 ? (
                  <rect
                    className={"bs-bar " + cls}
                    x={x}
                    y={56 - h}
                    width={bw - 1.6}
                    height={h}
                    rx={1.5}
                    tabIndex={press ? 0 : undefined}
                    role={press ? "button" : undefined}
                    aria-label={press ? `${b.name}: ${b.count} ${unit}${b.count === 1 ? "" : "s"}. Read the verses` : undefined}
                    onFocus={() => say(b)}
                    onBlur={() => setTip("")}
                    onKeyDown={(e) => {
                      if (press && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        press();
                      }
                    }}
                    onMouseEnter={() => say(b)}
                    onMouseLeave={() => setTip("")}
                    onClick={press}
                    style={press ? { cursor: "pointer" } : undefined}
                  />
                ) : (
                  <rect className="bs-none" x={x} y={55} width={bw - 1.6} height={1.5} />
                )}
              </g>
            );
          })}
          {firstNt > 0 && <line className="bs-divide" x1={firstNt * bw} y1={2} x2={firstNt * bw} y2={60} />}
          {books.map((b, i) =>
            MARKS.includes(b.name) ? (
              <text key={b.name} className="bs-mark" x={i * bw + bw / 2} y={73} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
                {b.name}
              </text>
            ) : null,
          )}
        </svg>
      </div>
      <div className="book-strip-tip" aria-live="polite">
        {tip || " "}
      </div>
    </div>
  );
}
