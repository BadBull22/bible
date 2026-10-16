import { useEffect, useState } from "react";
import { api, DictionaryEntry, StrongsEntry, VerseWithWords, WordCandidate } from "../api";
import { Material, Ref, refLabel } from "../sermon";
import { plainText } from "./RichText";
import { ChevronLeftIcon } from "./icons";

// The Hebrew and Greek behind the words of a sermon, in one or two clicks: a passage's words
// (click one), or a word looked up ("love", "G26"), shown as a small card -- the original
// word, its Strong's number and meaning, how often it is used, and any downloaded lexicon's
// entry -- with one button to add it to the sermon (it goes to the point's Explain section).

/** What to show: the words of a passage, or a word looked up. */
export type WordsRequest = { ref: Ref } | { query: string };

interface Props {
  request: WordsRequest;
  versionCode: string;
  chosen: Set<string>;
  onToggle: (m: Material) => void;
  onBack: () => void;
}

/** Versions whose words carry Strong's numbers, in the order to try them. */
const TAGGED = ["BSB", "KJV"];

interface Picked {
  numbers: string[];
  surface: string;
}

export function SermonWords({ request, versionCode, chosen, onToggle, onBack }: Props) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [lookup, setLookup] = useState(""); // the box at the top
  const [req, setReq] = useState<WordsRequest>(request);
  useEffect(() => {
    setReq(request);
    setPicked(null);
  }, [request]);

  return (
    <div className="sf">
      <div className="sf-top">
        <button className="text-btn" onClick={onBack}>
          <ChevronLeftIcon size={14} /> Back to what was found
        </button>
        <form
          className="sf-ask sw-lookup"
          onSubmit={(e) => {
            e.preventDefault();
            if (lookup.trim()) {
              setReq({ query: lookup.trim() });
              setPicked(null);
            }
          }}
        >
          <input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Look up a word: love, G26, H2617" aria-label="Look up a Hebrew or Greek word" />
          <button className="outline-btn" type="submit" disabled={!lookup.trim()}>
            Look up
          </button>
        </form>
      </div>
      <div className="sf-scroll">
        {picked && <WordCard picked={picked} chosen={chosen} onToggle={onToggle} onClose={() => setPicked(null)} />}
        {"ref" in req ? <PassageWords r={req.ref} versionCode={versionCode} onPick={setPicked} /> : <Candidates query={req.query} onPick={setPicked} />}
      </div>
    </div>
  );
}

/** A passage's words: each one with a Hebrew or Greek word behind it can be clicked. */
function PassageWords({ r, versionCode, onPick }: { r: Ref; versionCode: string; onPick: (p: Picked) => void }) {
  const [verses, setVerses] = useState<VerseWithWords[] | null>(null);
  const [version, setVersion] = useState("");
  useEffect(() => {
    let live = true;
    setVerses(null);
    (async () => {
      const last = Math.min(r.verseEnd, r.verse + 11);
      for (const v of [versionCode, ...TAGGED.filter((t) => t !== versionCode)]) {
        const all = await api.getChapterWithStrongs(v, r.book, r.chapter).catch(() => [] as VerseWithWords[]);
        const some = all.filter((x) => x.verse >= r.verse && x.verse <= last);
        if (some.some((x) => x.words.some((w) => w.strongs_numbers.length))) {
          if (live) {
            setVersion(v);
            setVerses(some);
          }
          return;
        }
      }
      if (live) setVerses([]);
    })();
    return () => {
      live = false;
    };
  }, [r.book, r.chapter, r.verse, r.verseEnd, versionCode]);

  if (!verses) return <p className="muted">Finding the words…</p>;
  if (verses.length === 0) return <p className="muted">This passage has no Hebrew or Greek words to show.</p>;
  const cut = r.verseEnd > r.verse + 11 && r.verseEnd < 200;
  return (
    <section className="sw-passage">
      <h4 className="section-label">
        {refLabel(r)} · {version} — click a word
      </h4>
      {verses.map((v) => (
        <p key={v.verse} className="sw-verse">
          <sup>{v.verse}</sup>{" "}
          {v.words.map((w, n) =>
            w.strongs_numbers.length ? (
              <button key={n} className="sw-word" onClick={() => onPick({ numbers: w.strongs_numbers, surface: w.surface_text })} title={w.strongs_numbers.join(", ")}>
                {w.surface_text}
              </button>
            ) : (
              <span key={n}>{w.surface_text} </span>
            ),
          )}
        </p>
      ))}
      {(cut || r.verseEnd >= 200) && verses.length >= 12 && <p className="muted">The first twelve verses are shown.</p>}
    </section>
  );
}

/** The Hebrew and Greek words a looked-up word could be. */
function Candidates({ query, onPick }: { query: string; onPick: (p: Picked) => void }) {
  const [found, setFound] = useState<WordCandidate[] | null>(null);
  useEffect(() => {
    let live = true;
    setFound(null);
    api
      .originalWordLookup(query, 12)
      .then((c) => {
        if (!live) return;
        setFound(c);
        // a Strong's number, or a single answer: straight to its card
        if (c.length === 1) onPick({ numbers: [c[0].strongs], surface: query });
      })
      .catch(() => live && setFound([]));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  if (!found) return <p className="muted">Looking…</p>;
  if (found.length === 0)
    return <p className="muted">No Hebrew or Greek word found for “{query}”. Try an English word (love, grace), a Strong's number (G26), or the word in Greek or Hebrew letters.</p>;
  return (
    <section>
      <h4 className="section-label">Words for “{query}”</h4>
      <ul className="sw-candidates">
        {found.map((c) => (
          <li key={c.strongs}>
            <button className="link-btn" onClick={() => onPick({ numbers: [c.strongs], surface: query })}>
              <span className="sw-lemma">{c.lemma}</span> {c.gloss}
            </button>{" "}
            <span className="muted">
              {c.language}, {c.strongs}, {c.count.toLocaleString()} times
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface CardWord {
  entry: StrongsEntry;
  count: number | null;
  lexicon: DictionaryEntry[];
}

/** The card: what a word is, and "Add to the sermon". */
function WordCard({ picked, chosen, onToggle, onClose }: { picked: Picked; chosen: Set<string>; onToggle: (m: Material) => void; onClose: () => void }) {
  const [words, setWords] = useState<CardWord[] | null>(null);
  const [more, setMore] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setWords(null);
    Promise.all(
      picked.numbers.slice(0, 3).map(async (num) => {
        const entry = await api.strongsLookup(num).catch(() => null);
        if (!entry) return null;
        const cand = await api.originalWordLookup(num, 1).catch(() => [] as WordCandidate[]);
        const lexicon = await api.libraryLexiconEntries(num).catch(() => [] as DictionaryEntry[]);
        return { entry, count: cand[0]?.count ?? null, lexicon } as CardWord;
      }),
    ).then((all) => live && setWords(all.filter((w): w is CardWord => !!w)));
    return () => {
      live = false;
    };
  }, [picked]);

  const materialOf = (w: CardWord): Material => {
    const e = w.entry;
    const def = [e.strongs_def, e.kjv_def ? `KJV: ${e.kjv_def}` : ""].filter(Boolean).join(" ").trim();
    return {
      key: `w:${e.strongs_number}`,
      kind: "word",
      title: `${e.lemma ?? e.strongs_number}${e.xlit ? ` (${e.xlit})` : ""} — “${picked.surface}”`,
      text: `${e.language}, Strong's ${e.strongs_number}${w.count != null ? `, used ${w.count.toLocaleString()} times` : ""}. ${def}`.trim(),
      topic: "",
    };
  };

  return (
    <div className="sw-card" role="region" aria-label={`The word “${picked.surface}”`}>
      <button className="text-btn sw-close" onClick={onClose} aria-label="Close">
        ×
      </button>
      {!words && <p className="muted">Looking up “{picked.surface}”…</p>}
      {words && words.length === 0 && <p className="muted">No dictionary entry for this word.</p>}
      {words?.map((w) => {
        const e = w.entry;
        const m = materialOf(w);
        const added = chosen.has(m.key);
        return (
          <div key={e.strongs_number} className="sw-entry">
            <p className="sw-head">
              <span className="sw-lemma">{e.lemma}</span>
              {e.xlit && <span className="sw-xlit"> {e.xlit}</span>}
              {e.pronunciation && <span className="muted"> ({e.pronunciation})</span>}
            </p>
            <p className="muted">
              “{picked.surface}” · {e.language} · Strong's {e.strongs_number}
              {w.count != null && ` · used ${w.count.toLocaleString()} times`}
            </p>
            {e.strongs_def && <p>{e.strongs_def}</p>}
            {e.kjv_def && (
              <p className="muted">
                <strong>KJV:</strong> {e.kjv_def}
              </p>
            )}
            {w.lexicon.slice(0, 2).map((x) => (
              <div key={x.id} className="sw-lexicon">
                <button className="link-btn" onClick={() => setMore(more === `${x.id}` ? null : `${x.id}`)}>
                  {x.dict_name} {more === `${x.id}` ? "▾" : "▸"}
                </button>
                {more === `${x.id}` && <p className="sw-lexicon-text">{plainText(x.body).slice(0, 1500)}</p>}
              </div>
            ))}
            <button className={added ? "outline-btn" : "pill-btn"} onClick={() => onToggle(m)}>
              {added ? "✓ In the sermon — take it out" : "Add to the sermon"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
