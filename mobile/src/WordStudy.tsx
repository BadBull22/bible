import { useEffect, useState } from "react";
import { api, StrongsEntry, StrongsUse, Word } from "./api";

interface Props {
  book: string;
  chapter: number;
  verse: number;
  version: string;
  onGo: (book: string, chapter: number, verse: number | null) => void;
  fail: (e: unknown) => void;
}

/** The verse's words with their Hebrew or Greek behind them (Strong's numbers): tap a word
 * for its meaning, how often it is used, and every verse that uses it. */
export function WordStudy({ book, chapter, verse, version, onGo, fail }: Props) {
  const [words, setWords] = useState<Word[] | null>(null);
  const [used, setUsed] = useState(version);
  const [number, setNumber] = useState<string | null>(null);

  useEffect(() => {
    api
      .verseWords(version, book, chapter, verse)
      .then(([v, w]) => {
        setUsed(v);
        setWords(w);
      })
      .catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapter, verse, version]);

  if (number) return <Entry number={number} version={used} onBack={() => setNumber(null)} onPick={setNumber} onGo={onGo} fail={fail} />;
  if (!words) return <p className="hint">Loading…</p>;
  if (words.length === 0) return <p className="hint">This verse has no word study.</p>;
  return (
    <>
      <p className="hint">
        Tap a word to see the Hebrew or Greek behind it{used !== version ? ` (word study uses the ${used} here)` : ""}.
      </p>
      <div className="words">
        {words.map((w, i) => (
          <button key={i} onClick={() => setNumber(w.numbers[0])}>
            {w.text}
            <small>{w.numbers.join(" ")}</small>
          </button>
        ))}
      </div>
    </>
  );
}

function Entry({
  number,
  version,
  onBack,
  onPick,
  onGo,
  fail,
}: {
  number: string;
  version: string;
  onBack: () => void;
  onPick: (n: string) => void;
  onGo: Props["onGo"];
  fail: Props["fail"];
}) {
  const [entry, setEntry] = useState<StrongsEntry | null | undefined>(undefined);
  const [uses, setUses] = useState<StrongsUse[] | null>(null);
  const [showUses, setShowUses] = useState(false);

  useEffect(() => {
    setEntry(undefined);
    setUses(null);
    setShowUses(false);
    api.strongsEntry(number).then(setEntry).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number]);

  useEffect(() => {
    if (showUses && !uses) api.strongsUses(version, number).then(setUses).catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showUses]);

  // "from G25 (ἀγαπάω)": the numbers it comes from are links
  const linked = (text: string) =>
    text.split(/\b([HG]\d{1,5})\b/).map((part, i) =>
      i % 2 ? (
        <button key={i} className="link" onClick={() => onPick(part)}>
          {part}
        </button>
      ) : (
        part
      ),
    );

  return (
    <div className="entry">
      <button className="link" onClick={onBack}>
        ‹ Words
      </button>
      {entry === undefined && <p className="hint">Loading…</p>}
      {entry === null && <p className="hint">No dictionary entry for {number}.</p>}
      {entry && (
        <>
          <p className="lemma" lang={entry.language === "Hebrew" ? "he" : "el"}>
            {entry.lemma}
          </p>
          <p className="hint">
            {entry.number} · {entry.language}
            {entry.xlit && ` · ${entry.xlit}`}
            {entry.pronunciation && ` · “${entry.pronunciation}”`}
          </p>
          <dl>
            {entry.definition && (
              <>
                <dt>Meaning</dt>
                <dd>{linked(entry.definition)}</dd>
              </>
            )}
            {entry.kjv_usage && (
              <>
                <dt>Translated in the KJV as</dt>
                <dd>{entry.kjv_usage}</dd>
              </>
            )}
            {entry.derivation && (
              <>
                <dt>Comes from</dt>
                <dd>{linked(entry.derivation)}</dd>
              </>
            )}
          </dl>
          {entry.counts.length > 0 && (
            <div className="counts">
              {entry.counts.map(([v, verses, times]) => (
                <span key={v}>
                  {v}: {times} time{times === 1 ? "" : "s"} in {verses} verse{verses === 1 ? "" : "s"}
                </span>
              ))}
            </div>
          )}
          {!showUses ? (
            <button className="primary" onClick={() => setShowUses(true)}>
              Every verse with this word ({version})
            </button>
          ) : (
            <>
              <h3>Every verse with {entry.number} <small>{version}{uses ? ` · ${uses.length}${uses.length >= 300 ? "+" : ""}` : ""}</small></h3>
              {!uses && <p className="hint">Loading…</p>}
              <ul className="hits">
                {(uses ?? []).map((u) => (
                  <li key={`${u.book}-${u.chapter}-${u.verse}`} onClick={() => onGo(u.book, u.chapter, u.verse)}>
                    <div className="hit-head">
                      <strong>
                        {u.book} {u.chapter}:{u.verse}
                      </strong>
                    </div>
                    <span>{markWords(u.text, u.words)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="attribution">Strong's Exhaustive Concordance (public domain), with the words of the {version} tagged by number.</p>
        </>
      )}
    </div>
  );
}

/** The verse with the words standing for the number marked. */
function markWords(text: string, words: string[]): React.ReactNode {
  const wanted = words.map((w) => w.trim()).filter(Boolean);
  if (wanted.length === 0) return text;
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${wanted.map((w) => w.split(/\s+/).map(escape).join("[^\\p{L}\\p{N}]+")).join("|")})`, "giu");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i} className="used">{part}</mark> : part));
}
