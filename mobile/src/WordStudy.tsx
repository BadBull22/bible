import { useEffect, useState } from "react";
import { api, LibEntry, StrongsEntry, StrongsUse, Word } from "./api";
import { LinkedText } from "./Library";
import { OriginalOffer, OriginalPack, OriginalWords } from "./OriginalWords";

interface Props {
  book: string;
  chapter: number;
  verse: number;
  version: string;
  /** the "Original words" download (shared, so downloading it here shows everywhere) */
  pack: OriginalPack;
  onGo: (book: string, chapter: number, verse: number | null) => void;
  /** opens the Library, where fuller lexicons can be installed */
  onLibrary: () => void;
  fail: (e: unknown) => void;
}

/** The verse's words with their Hebrew or Greek behind them: the original words one by one (once downloaded), or the
 * English words with their Strong's numbers. Tap a word for its meaning, how often it is used, every verse that uses it,
 * and what the lexicons installed from the Library say. */
export function WordStudy({ book, chapter, verse, version, pack, onGo, onLibrary, fail }: Props) {
  const [words, setWords] = useState<Word[] | null>(null);
  const [used, setUsed] = useState(version);
  // the numbers being studied: one, or the several an English word stands for (each a tab)
  const [numbers, setNumbers] = useState<string[] | null>(null);
  // which list: the original words (when downloaded) or the English words; none chosen: the original ones if they are there
  const [mode, setMode] = useState<"original" | "english" | null>(null);

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

  if (numbers) return <Entry numbers={numbers} version={used} onBack={() => setNumbers(null)} onGo={onGo} onLibrary={onLibrary} fail={fail} />;
  const showing = mode ?? (pack.installed ? "original" : "english");
  return (
    <>
      <div className="seg" role="group" aria-label="How to see the words">
        <button className={showing === "original" ? "on" : ""} onClick={() => setMode("original")} aria-pressed={showing === "original"}>
          Original words
        </button>
        <button className={showing === "english" ? "on" : ""} onClick={() => setMode("english")} aria-pressed={showing === "english"}>
          English words
        </button>
      </div>
      {showing === "original" ? (
        pack.installed ? (
          <OriginalWords book={book} chapter={chapter} verse={verse} onStudy={setNumbers} fail={fail} />
        ) : (
          <OriginalOffer pack={pack} />
        )
      ) : !words ? (
        <p className="hint">Loading…</p>
      ) : words.length === 0 ? (
        <p className="hint">This verse has no word study.</p>
      ) : (
        <>
          <p className="hint">
            Tap a word to see the Hebrew or Greek behind it{used !== version ? ` (word study uses the ${used} here)` : ""}. A word that stands for more than one Hebrew or Greek word shows each.
          </p>
          <div className="words">
            {words.map((w, i) => (
              <button key={i} onClick={() => setNumbers(w.numbers)}>
                {w.text}
                <small>{w.numbers.join(" ")}</small>
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Entry({
  numbers,
  version,
  onBack,
  onGo,
  onLibrary,
  fail,
}: {
  numbers: string[];
  version: string;
  onBack: () => void;
  onGo: Props["onGo"];
  onLibrary: Props["onLibrary"];
  fail: Props["fail"];
}) {
  // the number shown; a "from G25" in an entry opens that one in place of it
  const [shown, setShown] = useState(numbers);
  const [active, setActive] = useState(0);
  useEffect(() => {
    setShown(numbers);
    setActive(0);
  }, [numbers]);
  const number = shown[Math.min(active, shown.length - 1)];

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
        <button key={i} className="link" onClick={() => setShown([part])}>
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
      {shown.length > 1 && (
        <div className="seg" role="tablist" aria-label="The Hebrew or Greek words behind this word">
          {shown.map((n, i) => (
            <button key={n} role="tab" aria-selected={i === active} className={i === active ? "on" : ""} onClick={() => setActive(i)}>
              {n}
            </button>
          ))}
        </div>
      )}
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
          <Lexicons number={number} greek={entry.language !== "Hebrew"} onGo={onGo} onLibrary={onLibrary} fail={fail} />
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

/** What the lexicons installed from the Library say about the word (BDB for Hebrew; Abbott-Smith, Dodson... for Greek). */
function Lexicons({ number, greek, onGo, onLibrary, fail }: { number: string; greek: boolean; onGo: Props["onGo"]; onLibrary: Props["onLibrary"]; fail: Props["fail"] }) {
  const [entries, setEntries] = useState<LibEntry[] | null>(null);
  useEffect(() => {
    setEntries(null);
    api.libraryLexicon(number).then(setEntries).catch((e) => (setEntries([]), fail(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number]);
  if (!entries) return null;
  return (
    <div className="lexicons">
      <h3>From your Library</h3>
      {entries.length === 0 ? (
        <p className="hint">
          Fuller {greek ? "Greek" : "Hebrew"} lexicons keyed to Strong's numbers — {greek ? "Abbott-Smith, Dodson, an intermediate Greek–English lexicon" : "BDB glosses"} — can be installed free from the Library and will show here.{" "}
          <button className="link" onClick={onLibrary}>
            Open the Library
          </button>
        </p>
      ) : (
        entries.map((e, i) => (
          <details key={e.id} open={i === 0}>
            <summary>
              {e.title} — {e.headword}
            </summary>
            <div className="lexicon-body">
              <LinkedText text={e.body} onGo={onGo} />
            </div>
          </details>
        ))
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
