import { useEffect, useMemo, useState } from "react";
import { api, MeaningWord, Sample, Sense, SenseReport, SilCard } from "./api";
import { BIBLE_BOOKS } from "../../src/browse/browseLogic";
import { arcPath, senseArcs, senseColour, senseOrder, topBooks } from "./senseDraw";

interface Props {
  strongs: string;
  /** the Bible the example verses are shown in (the Bible being read, or the BSB when that has no Strong's numbers) */
  version: string;
  /** the Bible being read, when it is not the one the examples come from: say so */
  asked?: string;
  /** the verse the word is being read in: the meaning used there is chosen first */
  at: { book: string; chapter: number; verse: number } | null;
  onGo: (book: string, chapter: number, verse: number | null) => void;
  /** open another word's page (from the other words of a group) */
  onWord: (strongs: string) => void;
  fail: (e: unknown) => void;
}

/** All the meanings of one Hebrew or Greek word, drawn as a ring with the list under it; for the chosen meaning its definition, where it sits in the groups of
 * meanings, what it is called in everyday English, where in the Bible it is used, example verses with the word marked, and the other words with the same meaning.
 * The meanings are from the UBS dictionaries (CC BY-SA 4.0), the everyday English from SIL Semantic Domains (CC BY-SA 4.0). */
export function WordMeanings({ strongs, version, asked, at, onGo, onWord, fail }: Props) {
  const [report, setReport] = useState<SenseReport | null>(null);
  const [sel, setSel] = useState(0);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [same, setSame] = useState<MeaningWord[] | null>(null);
  const [showSame, setShowSame] = useState(false);

  useEffect(() => {
    let live = true;
    setReport(null);
    api
      .wordSenses(strongs, at?.book ?? null, at?.chapter ?? null, at?.verse ?? null)
      .then((r) => {
        if (!live) return;
        setReport(r);
        const order = senseOrder(r.senses.map((s) => s.verses));
        const here = r.senses.findIndex((s) => s.here);
        setSel(here >= 0 ? here : (order[0] ?? 0));
      })
      .catch((e) => live && fail(e));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strongs, at?.book, at?.chapter, at?.verse]);

  const sense: Sense | undefined = report?.senses[sel];

  useEffect(() => {
    setShowSame(false);
    setSame(null);
    if (!sense) {
      setSamples(null);
      return;
    }
    let live = true;
    setSamples(null);
    api
      .senseSamples(strongs, sense.entry, sense.meaning, version, at?.book ?? null, at?.chapter ?? null, at?.verse ?? null)
      .then((s) => live && setSamples(s))
      .catch(() => live && setSamples([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strongs, sense?.entry, sense?.meaning, version]);

  useEffect(() => {
    if (!showSame || !report || !sense || !sense.domains[0] || same) return;
    api
      .groupWords(report.language, sense.domains[0])
      .then(setSame)
      .catch((e) => {
        setSame([]);
        fail(e);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSame]);

  const order = useMemo(() => (report ? senseOrder(report.senses.map((s) => s.verses)) : []), [report]);
  const arcs = useMemo(() => (report ? senseArcs(order.map((i) => report.senses[i].verses)) : []), [report, order]);

  if (!report) return <p className="hint">Loading the meanings…</p>;

  if (report.senses.length === 0) {
    return (
      <div className="meanings">
        {report.dictionary ? (
          <>
            <h3>What it means</h3>
            <p>{report.dictionary.definition}</p>
            {report.dictionary.kjv && <p className="hint">The King James Bible translates it: {report.dictionary.kjv}</p>}
            <p className="hint">The UBS dictionaries do not list this word’s meanings, so this is Strong’s definition. Small words such as “to”, “all” and “that” are left out of them.</p>
          </>
        ) : (
          <p className="hint">This word is not in the dictionary.</p>
        )}
      </div>
    );
  }

  const total = report.senses.reduce((n, s) => n + s.verses, 0);
  const current = sense ?? report.senses[0];
  const many = report.senses.length > 1;
  const colourOf = (i: number) => senseColour(Math.max(0, order.indexOf(i)), report.senses.length);
  const lang = report.language === "hebrew" ? "he" : "el";
  const group = current.groups[0]?.split(" > ") ?? [];
  const top = topBooks(current.by_book, BIBLE_BOOKS);

  return (
    <div className="meanings">
      <p className="meanings-count">
        <b>{report.senses.length}</b> meaning{report.senses.length === 1 ? "" : "s"} · <b>{total.toLocaleString("en-US")}</b> verse uses
      </p>
      {many && (
        <>
          <svg className="sense-ring" viewBox="0 0 340 340" role="img" aria-label={`The meanings of ${report.strongs}, sized by the number of verses`}>
            {order.map((si, k) => {
              const a = arcs[k];
              if (!a) return null;
              return (
                <path
                  key={si}
                  d={arcPath(170, 170, 100, si === sel ? 156 : 148, a.from, a.to)}
                  fill={colourOf(si)}
                  role="button"
                  aria-label={`${report.senses[si].glosses[0] ?? "meaning"}: ${report.senses[si].verses} verses`}
                  onClick={() => setSel(si)}
                />
              );
            })}
            <text className="ring-mid" x={170} y={158} textAnchor="middle" fontSize={report.senses.length > 8 ? 14 : 16} fontWeight={600}>
              {(current.glosses[0] ?? "").slice(0, 24)}
            </text>
            <text className="ring-mid" x={170} y={186} textAnchor="middle" fontSize={24} fontWeight={700}>
              {current.verses}
            </text>
            <text className="ring-mid faint" x={170} y={206} textAnchor="middle" fontSize={13}>
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
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <div className="sense-detail">
        <h3>
          {many ? `Meaning ${order.indexOf(sel) + 1} of ${report.senses.length}` : "Meaning"}
          {current.here && <span className="sense-here"> · used in this verse</span>}
        </h3>
        <p className="sense-gloss">{current.glosses.join(", ") || "—"}</p>
        <p>{current.definition.replace(/^=\s*/, "")}</p>
        {group.length > 0 && (
          <p className="crumbs">
            {group.map((g) => (
              <span key={g}>{g}</span>
            ))}
            {current.ln && <em>Louw-Nida {current.ln}</em>}
          </p>
        )}
        <SilCardView card={current.sil} />
        {top.length > 0 && (
          <>
            <h3>Where it is used</h3>
            <p className="top-books">
              {top.map((b) => (
                <span key={b.book}>
                  {b.book} <b>{b.count}</b>
                </span>
              ))}
            </p>
          </>
        )}
        <h3>Examples</h3>
        {asked && asked !== version && (
          <p className="hint status">
            {asked} does not have Strong’s numbers loaded, so the examples are shown in the {version}, with the word marked.
          </p>
        )}
        {samples === null && <p className="hint">Loading…</p>}
        {samples?.length === 0 && <p className="hint">The verses are not available.</p>}
        {samples?.map((s) => (
          <p key={`${s.book}${s.chapter}:${s.verse}`} className="sense-verse">
            <button type="button" className="link" onClick={() => onGo(s.book, s.chapter, s.verse)}>
              {s.book} {s.chapter}:{s.verse}
            </button>{" "}
            {s.parts.map((p, i) => (p.mark ? <mark key={i} className="used">{p.text}</mark> : <span key={i}>{p.text}</span>))}
          </p>
        ))}
        {current.domains[0] && (
          <>
            <h3>Other words with this meaning</h3>
            {!showSame ? (
              <button type="button" className="outline" onClick={() => setShowSame(true)}>
                Show the other {report.language === "hebrew" ? "Hebrew" : "Greek"} words in this group
              </button>
            ) : !same ? (
              <p className="hint">Loading…</p>
            ) : (
              <ul className="same-words">
                {same
                  .filter((w) => !w.strongs.includes(report.strongs))
                  .slice(0, 60)
                  .map((w) => (
                    <li key={`${w.entry}-${w.meaning}`}>
                      <button type="button" disabled={!w.strongs[0]} onClick={() => w.strongs[0] && onWord(w.strongs[0])}>
                        <span className="sw-lemma" lang={lang} dir={lang === "he" ? "rtl" : "ltr"}>
                          {w.lemma}
                        </span>
                        <span className="sw-gloss">
                          {w.translit ? `${w.translit} · ` : ""}
                          {w.glosses.slice(0, 2).join(", ") || w.definition.slice(0, 40)}
                        </span>
                        <span className="sw-n">{w.verses}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </>
        )}
        {report.dictionary && <p className="hint">Strong’s: {report.dictionary.definition}</p>}
        <p className="attribution">Meanings: UBS Dictionary of Biblical Hebrew and Dictionary of the Greek New Testament, CC BY-SA 4.0.</p>
      </div>
    </div>
  );
}

function SilCardView({ card }: { card: SilCard | null }) {
  const [more, setMore] = useState(false);
  if (!card) return null;
  const long = card.description.length > 260;
  const text = long && !more ? card.description.slice(0, 257).replace(/\s+\S*$/, "") + "…" : card.description;
  return (
    <div className="sil-card">
      <h3>In everyday English</h3>
      <p className="crumbs">
        {card.path.map((p) => (
          <span key={p}>{p}</span>
        ))}
        <strong>{card.name}</strong>
      </p>
      <p>
        {text}{" "}
        {long && (
          <button type="button" className="link" onClick={() => setMore(!more)}>
            {more ? "Less" : "More"}
          </button>
        )}
      </p>
      {card.words.length > 0 && (
        <p className="sil-words">
          {card.words.slice(0, 14).map((w) => (
            <span key={w}>{w}</span>
          ))}
        </p>
      )}
      <p className="attribution">SIL Global, SIL Semantic Domains {card.code}, CC BY-SA 4.0.</p>
    </div>
  );
}
