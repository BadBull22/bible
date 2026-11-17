// The senses of one Hebrew or Greek word, drawn: a ring split by how many verses use each sense, the list beside it, and for the chosen sense its definition, where it
// sits in the groups of meanings, what it is called in everyday English (SIL Semantic Domains), where in the Bible it is used and some verses with the word
// marked. When the word is being read in a verse, the sense used in that verse is the one chosen. A word the UBS dictionaries leave out (mostly small words)
// shows its Strong's definition instead. The senses and groups are from the UBS dictionaries (CC BY-SA 4.0).

import { useEffect, useMemo, useState } from "react";
import { api, type Sample, type Sense, type SenseReport } from "../api";
import { BIBLE_BOOKS } from "../browse/browseLogic";
import { arcPath, senseArcs, senseColour, senseOrder } from "../semantic";
import { BookStrip, type StripBook } from "./BookStrip";
import { SilCardView } from "./SilCardView";

export interface VerseAt {
  book: string;
  chapter: number;
  verse: number;
}

interface Props {
  strongs: string;
  /** the Bible the verses are shown in */
  version: string;
  /** the verse the word is being read in, if any */
  at?: VerseAt | null;
  onJump: (book: string, chapter: number, verse: number) => void;
}

const stripBooks = (counts: number[]): StripBook[] => BIBLE_BOOKS.map((name, i) => ({ name, testament: i < 39 ? "OT" : "NT", count: counts[i] ?? 0 }));

export function SensePanel({ strongs, version, at, onJump }: Props) {
  const [report, setReport] = useState<SenseReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [samples, setSamples] = useState<Sample[] | null>(null);

  useEffect(() => {
    let live = true;
    setReport(null);
    setError(null);
    api
      .semanticSenses(strongs, at?.book ?? null, at?.chapter ?? null, at?.verse ?? null)
      .then((r) => {
        if (!live) return;
        setReport(r);
        const order = senseOrder(r.senses.map((s) => s.verses));
        const here = r.senses.findIndex((s) => s.here);
        setSel(here >= 0 ? here : (order[0] ?? 0));
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [strongs, at?.book, at?.chapter, at?.verse]);

  const sense: Sense | undefined = report?.senses[sel];

  useEffect(() => {
    if (!sense) {
      setSamples(null);
      return;
    }
    let live = true;
    setSamples(null);
    api
      .semanticSenseSamples(strongs, sense.entry, sense.meaning, version, at?.book ?? null, at?.chapter ?? null, at?.verse ?? null)
      .then((s) => live && setSamples(s))
      .catch(() => live && setSamples([]));
    return () => {
      live = false;
    };
  }, [strongs, sense?.entry, sense?.meaning, version, at?.book, at?.chapter, at?.verse]);

  const order = useMemo(() => (report ? senseOrder(report.senses.map((s) => s.verses)) : []), [report]);
  const total = report ? report.senses.reduce((n, s) => n + s.verses, 0) : 0;
  const arcs = useMemo(() => (report ? senseArcs(order.map((i) => report.senses[i].verses)) : []), [report, order]);

  if (error) return <p className="status-error">{error}</p>;
  if (!report) return <p className="muted">Loading the meanings…</p>;
  const lang = report.language === "hebrew" ? "he" : "grc";
  const head = (
    <h3 className="sense-head">
      <span lang={lang} dir={lang === "he" ? "rtl" : "ltr"} className="sense-lemma">
        {report.lemma || report.dictionary?.lemma}
      </span>{" "}
      <span className="muted">{[report.strongs, report.dictionary?.translit, report.language === "hebrew" ? "Hebrew" : "Greek"].filter(Boolean).join(" · ")}</span>
    </h3>
  );

  if (report.senses.length === 0) {
    return (
      <section className="sense-panel" aria-label={`Meanings of ${report.strongs}`}>
        {head}
        {report.dictionary ? (
          <div className="sense-detail">
            <h4>What it means</h4>
            <p className="sense-def">{report.dictionary.definition}</p>
            {report.dictionary.kjv && <p className="muted">The King James Bible translates it: {report.dictionary.kjv}</p>}
            <p className="muted">The UBS dictionaries do not list this word's meanings; this is Strong's definition. Small words such as “to”, “all” and “that” are left out of them.</p>
          </div>
        ) : (
          <p className="muted">This word is not in the dictionary.</p>
        )}
      </section>
    );
  }

  const stats = (
    <div className="sense-stats">
      <span>
        <b>{report.senses.length}</b> meaning{report.senses.length === 1 ? "" : "s"}
      </span>
      <span>
        <b>{total.toLocaleString("en-US")}</b> verse uses
      </span>
    </div>
  );
  const current = sense ?? report.senses[0];
  const colourOf = (i: number) => senseColour(Math.max(0, order.indexOf(i)), report.senses.length);
  const many = report.senses.length > 1;
  const max = Math.max(...report.senses.map((s) => s.verses));

  return (
    <section className="sense-panel" aria-label={`Meanings of ${report.strongs}`}>
      {head}
      {stats}
      <div className={"sense-body" + (many ? " many" : "")}>
        {many && (
          <div className="sense-chart">
            <svg viewBox="0 0 340 340" role="img" aria-label={`The meanings of ${report.strongs}, sized by the number of verses`}>
              {order.map((si, k) => {
                const s = report.senses[si];
                const a = arcs[k];
                if (!a) return null;
                const on = si === sel;
                return (
                  <path
                    key={si}
                    d={arcPath(170, 170, 100, on ? 152 : 146, a.from, a.to)}
                    fill={colourOf(si)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${s.glosses[0] ?? "meaning"}: ${s.verses} verses`}
                    aria-pressed={on}
                    onClick={() => setSel(si)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSel(si);
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  />
                );
              })}
              <text className="sense-mid" x={170} y={160} textAnchor="middle" fontSize={report.senses.length > 8 ? 13 : 15} fontWeight={600}>
                {(current.glosses[0] ?? "").slice(0, 28)}
              </text>
              <text className="sense-mid" x={170} y={183} textAnchor="middle" fontSize={22} fontWeight={700}>
                {current.verses}
              </text>
              <text className="sense-mid faint" x={170} y={201} textAnchor="middle" fontSize={12}>
                verses · {Math.round((current.verses / Math.max(total, 1)) * 100)}%
              </text>
            </svg>
            <ul className="sense-legend">
              {order.map((si) => {
                const s = report.senses[si];
                return (
                  <li key={si}>
                    <button type="button" className={si === sel ? "on" : ""} aria-pressed={si === sel} onClick={() => setSel(si)}>
                      <span className="sense-dot" style={{ background: colourOf(si) }} aria-hidden />
                      <span className="sense-name">{s.glosses.slice(0, 2).join(", ") || s.definition.slice(0, 40)}</span>
                      <span className="sense-n">{s.verses}</span>
                      <span className="sense-bar" aria-hidden>
                        <i style={{ width: `${(s.verses / max) * 100}%`, background: colourOf(si) }} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="sense-detail">
          <h4>
            {many ? `Meaning ${order.indexOf(sel) + 1} of ${report.senses.length}` : "Meaning"}
            {current.here && <span className="sense-here"> · used in this verse</span>}
          </h4>
          <h5 className="sense-gloss">{current.glosses.join(", ") || "—"}</h5>
          <p className="sense-def">{current.definition.replace(/^=\s*/, "")}</p>
          {current.groups.length > 0 && (
            <div className="sil-crumbs">
              {current.groups[0].split(" > ").map((g) => (
                <span key={g}>{g}</span>
              ))}
              {current.ln && <em>Louw-Nida {current.ln}</em>}
            </div>
          )}
          <SilCardView card={current.sil} />
          <h4>Where it is used</h4>
          <BookStrip books={stripBooks(current.by_book)} unit="verse" label={`Verses with this meaning, by book`} />
          <h4>Examples</h4>
          {samples === null && <p className="muted">Loading…</p>}
          {samples?.length === 0 && <p className="muted">The verses are not available.</p>}
          {samples?.map((s) => (
            <p key={`${s.book}${s.chapter}:${s.verse}`} className="sense-verse">
              <button type="button" className="link-btn" onClick={() => onJump(s.book, s.chapter, s.verse)}>
                {s.book} {s.chapter}:{s.verse}
              </button>
              <span>
                {s.parts.map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
              </span>
            </p>
          ))}
          {report.dictionary && <p className="muted sense-strongs">Strong's: {report.dictionary.definition}</p>}
        </div>
      </div>
    </section>
  );
}
