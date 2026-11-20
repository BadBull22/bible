// One page for a Hebrew or Greek word (it replaces Word Study): who it is and how it sounds (Overview), every meaning it has drawn as a ring (Meanings), the verses
// that use it (Where used), the other words with the same meaning (Same meaning) and what your Library says about it (Library). Every Hebrew or Greek word in the
// app opens this page by its Strong's number, and the Back in the header returns to where you came from.

import { useEffect, useMemo, useState } from "react";
import { api, type DictionaryEntry, type MeaningWord, type SearchHit, type SenseReport, type StrongsEntry } from "../api";
import { RichText } from "./RichText";
import { CloseIcon } from "./icons";
import { ListenButton } from "./ListenButton";
import { PanelBack } from "../panelNav";
import { PlayWord } from "./PlayWord";
import { NoStrongsNote } from "./NoStrongsNote";
import { BookStrip } from "./BookStrip";
import { SensePanel, stripBooks, type VerseAt } from "./SensePanel";
import type { MeaningSel } from "./MeaningPicker";

export type WordTab = "overview" | "meanings" | "used" | "same" | "library";

interface Props {
  // A single surface word can carry more than one Strong's number (e.g. a Hebrew word with an inseparable prefix); all of them are offered, first one shown.
  strongsNumbers: string[];
  surfaceText: string;
  /** the verse the word was opened from (the Interlinear): the meaning used there is chosen, and "Show in Interlinear" goes back to it */
  at?: VerseAt;
  /** the section to open on */
  tab?: WordTab;
  versionCode: string;
  /** does the Bible being read have Strong's numbers loaded, and what is it called */
  strongsReady?: boolean;
  versionName?: string;
  onClose: () => void;
  onJump: (book: string, chapter: number, verse: number) => void;
  /** open the Hebrew & Greek search on this word */
  onSearchGrammar: (strongs: string) => void;
  onOpenLibrary: () => void;
  /** the verse in the Interlinear */
  onShowInterlinear?: (at: VerseAt) => void;
  /** another word's page (a word of the same meaning) */
  onOpenWord: (strongs: string) => void;
  /** the whole tree of meanings for a group */
  onOpenTree: (sel: MeaningSel) => void;
}

const TABS: { id: WordTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "meanings", label: "Meanings" },
  { id: "used", label: "Where used" },
  { id: "same", label: "Same meaning" },
  { id: "library", label: "Library" },
];

const NAME_OF_LANGUAGE = (s: string) => (s.startsWith("H") ? "Hebrew" : "Greek");

export function WordPanel({ strongsNumbers, surfaceText, at, tab: startTab, versionCode, strongsReady = true, versionName, onClose, onJump, onSearchGrammar, onOpenLibrary, onShowInterlinear, onOpenWord, onOpenTree }: Props) {
  const [active, setActive] = useState(0);
  const [tab, setTab] = useState<WordTab>(startTab ?? "overview");
  const [entry, setEntry] = useState<StrongsEntry | null>(null);
  const [occurrences, setOccurrences] = useState<SearchHit[]>([]);
  const [lexicons, setLexicons] = useState<DictionaryEntry[]>([]);
  const [report, setReport] = useState<SenseReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // reset to the first number and the asked-for section whenever a different word is opened
  useEffect(() => {
    setActive(0);
    setTab(startTab ?? "overview");
  }, [strongsNumbers, startTab]);

  const strongsNumber = strongsNumbers[Math.min(active, strongsNumbers.length - 1)] ?? "";

  useEffect(() => {
    if (!strongsNumber) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReport(null);
    Promise.all([
      api.strongsLookup(strongsNumber),
      api.strongsOccurrences(strongsNumber, versionCode),
      api.libraryLexiconEntries(strongsNumber).catch(() => [] as DictionaryEntry[]),
      api.semanticSenses(strongsNumber, at?.book ?? null, at?.chapter ?? null, at?.verse ?? null).catch(() => null),
    ])
      .then(([e, occ, lex, rep]) => {
        if (cancelled) return;
        setEntry(e);
        setOccurrences(occ);
        setLexicons(lex);
        setReport(rep);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [strongsNumber, versionCode, at?.book, at?.chapter, at?.verse]);

  const language = NAME_OF_LANGUAGE(strongsNumber);
  const lemma = entry?.lemma || report?.lemma || surfaceText;
  const senses = report?.senses ?? [];
  const totalVerses = senses.reduce((n, s) => n + s.verses, 0);
  const here = senses.find((s) => s.here);
  const wholeWord = useMemo(() => {
    const counts = new Array<number>(66).fill(0);
    for (const s of senses) s.by_book.forEach((n, i) => (counts[i] += n));
    return counts;
  }, [senses]);

  return (
    <aside className="side-panel wide word-panel">
      <div className="side-panel-header">
        <PanelBack />
        <h3>Word: {lemma ? lemma : `“${surfaceText}”`}</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      {strongsNumbers.length > 1 && (
        <div className="mode-toggle" role="tablist" aria-label="Strong's numbers for this word">
          {strongsNumbers.map((n, i) => (
            <button key={n} role="tab" aria-selected={i === active} className={i === active ? "active" : ""} onClick={() => setActive(i)}>
              {n}
            </button>
          ))}
        </div>
      )}
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="status-error">Couldn't load this entry: {error}</p>}
      {!loading && !error && (
        <>
          <div className="word-head">
            {lemma && <PlayWord text={entry?.lemma || report?.lemma || lemma} label={lemma} />}
            {lemma && (
              <span className="word-lemma" lang={language === "Hebrew" ? "he" : "grc"} dir={language === "Hebrew" ? "rtl" : "ltr"}>
                {lemma}
              </span>
            )}
            <span className="word-number">{strongsNumber}</span>
            <span className="muted word-meta">
              {[entry?.xlit ? `${entry.xlit}` : null, language, totalVerses ? `${totalVerses.toLocaleString("en-US")} verses` : null].filter(Boolean).join(" · ")}
            </span>
          </div>
          <div className="word-tabs" role="tablist" aria-label="Sections of this word's page">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
                {t.label}
                {t.id === "meanings" && senses.length > 0 && <small> {senses.length}</small>}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <div className="word-pane">
              {entry ? (
                <div className="strongs-entry">
                  <div className="strongs-entry-bar">
                    <ListenButton
                      title="Read this entry aloud"
                      text={() =>
                        [
                          entry.xlit && `${entry.xlit}.`,
                          entry.derivation,
                          entry.strongs_def && `Definition: ${entry.strongs_def}`,
                          entry.kjv_def && `King James usage: ${entry.kjv_def}`,
                        ]
                          .filter(Boolean)
                          .join("\n")
                      }
                    />
                  </div>
                  {entry.pronunciation && <div className="pron">pronounced: {entry.pronunciation}</div>}
                  {entry.derivation && <p className="derivation">{entry.derivation}</p>}
                  {entry.strongs_def && (
                    <p>
                      <strong>Definition:</strong> {entry.strongs_def}
                    </p>
                  )}
                  {entry.kjv_def && (
                    <p>
                      <strong>KJV usage:</strong> {entry.kjv_def}
                    </p>
                  )}
                </div>
              ) : (
                <p>No dictionary entry found for {strongsNumber}.</p>
              )}
              {here && at && (
                <div className="word-card">
                  <h4>
                    In this verse ({at.book} {at.chapter}:{at.verse})
                  </h4>
                  <p>
                    Used as <b>{here.glosses.slice(0, 2).join(", ") || "—"}</b>: {here.definition.replace(/^=\s*/, "")}{" "}
                    <button type="button" className="link-btn" onClick={() => setTab("meanings")}>
                      All meanings
                    </button>
                    {onShowInterlinear && (
                      <>
                        {" · "}
                        <button type="button" className="link-btn" onClick={() => onShowInterlinear(at)}>
                          Show in Interlinear
                        </button>
                      </>
                    )}
                  </p>
                </div>
              )}
              <div className="word-study-more">
                <button className="outline-btn" onClick={() => onSearchGrammar(strongsNumber)} title="Every occurrence of this Hebrew/Greek word, filtered by tense, stem, case…">
                  Search by grammar
                </button>
              </div>
            </div>
          )}

          {tab === "meanings" && (
            <div className="word-pane">
              <SensePanel
                strongs={strongsNumber}
                version={versionCode}
                at={at ?? null}
                onJump={onJump}
                strongsReady={strongsReady}
                versionName={versionName}
                hideHead
              />
            </div>
          )}

          {tab === "used" && (
            <div className="word-pane">
              {totalVerses > 0 && <BookStrip books={stripBooks(wholeWord)} unit="verse" label={`Verses that use ${strongsNumber}, by book`} onPick={(b) => onJump(b, 1, 1)} />}
              <h4 className="section-label">
                {strongsReady || occurrences.length > 0
                  ? `${occurrences.length} ${occurrences.length === 1 ? "verse" : "verses"} in ${versionName ?? versionCode} tagged ${strongsNumber}`
                  : "Where it is used"}
              </h4>
              {occurrences.length === 0 && !strongsReady && <NoStrongsNote name={versionName ?? versionCode} what="the verses that use this word cannot be listed" />}
              {occurrences.length === 0 && strongsReady && (
                <p className="search-hint" style={{ marginTop: "0.4rem" }}>
                  No verse of {versionName ?? versionCode} is tagged with {strongsNumber}. A different Bible may use this word elsewhere: the BSB or KJV list every use.
                </p>
              )}
              <ul className="word-verses">
                {occurrences.map((o) => (
                  <li key={`${o.book}-${o.chapter}-${o.verse}`}>
                    <button className="link-btn" onClick={() => onJump(o.book, o.chapter, o.verse)}>
                      {o.book} {o.chapter}:{o.verse}
                    </button>{" "}
                    <span className="snippet">{o.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {tab === "same" && (
            <div className="word-pane">
              <SameMeaning report={report} here={here ? senses.indexOf(here) : -1} strongs={strongsNumber} onOpenWord={onOpenWord} onOpenTree={onOpenTree} />
            </div>
          )}

          {tab === "library" && (
            <div className="word-pane word-study-lexicons">
              <h4 className="section-label">From your Library</h4>
              {lexicons.length === 0 ? (
                <p className="search-hint" style={{ marginTop: 0 }}>
                  Fuller {language} lexicons keyed to Strong's numbers — {language === "Hebrew" ? "BDB glosses" : "Abbott-Smith, Dodson, an intermediate Greek–English lexicon"} — can be installed free from the{" "}
                  <button className="link-btn" onClick={onOpenLibrary}>
                    Library
                  </button>{" "}
                  and will show here.
                </p>
              ) : (
                lexicons.map((l, i) => (
                  <details key={l.id} className="apparatus-key" open={i === 0}>
                    <summary>
                      {l.dict_name} — {l.headword}
                    </summary>
                    <RichText text={l.body} onJump={onJump} />
                  </details>
                ))
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

/** The other words in the word's group of meanings, each with its speaker, its Strong's number and its verses; the whole tree is one press away. */
function SameMeaning({ report, here, strongs, onOpenWord, onOpenTree }: { report: SenseReport | null; here: number; strongs: string; onOpenWord: (s: string) => void; onOpenTree: (sel: MeaningSel) => void }) {
  const [words, setWords] = useState<MeaningWord[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const senses = report?.senses ?? [];
  const sense = senses[here >= 0 ? here : senses.reduce((best, s, i) => (s.verses > (senses[best]?.verses ?? -1) ? i : best), 0)];
  const code = sense?.domains[0];
  const language = report?.language === "hebrew" ? "hebrew" : "greek";
  useEffect(() => {
    setWords(null);
    setShowAll(false);
    if (!code) return;
    let live = true;
    api.semanticWords(language, code).then((w) => live && setWords(w)).catch(() => live && setWords([]));
    return () => {
      live = false;
    };
  }, [code, language]);
  if (!sense || !code) return <p className="muted">The UBS dictionaries do not list this word's meanings, so there is no group of the same meaning to show.</p>;
  const path = sense.groups[0] ?? "";
  const name = path.split(" > ").pop() ?? path;
  const sorted = [...(words ?? [])].sort((a, b) => b.verses - a.verses);
  const shown = showAll ? sorted : sorted.slice(0, 30);
  return (
    <>
      <div className="word-card">
        <h4>Group</h4>
        <div className="sil-crumbs">
          {path.split(" > ").map((g) => (
            <span key={g}>{g}</span>
          ))}
        </div>
        <button
          type="button"
          className="outline-btn"
          onClick={() => onOpenTree({ language, code, name, path, entry: null, meaning: null, word: null, words: sorted.length })}
          title="The tree of meanings this group sits in, with the groups beside it"
        >
          Open the whole tree
        </button>
      </div>
      {words === null && <p className="muted">Loading the words…</p>}
      {words && (
        <ul className="word-group-list">
          {shown.map((w) => {
            const n = w.strongs[0];
            const me = n === strongs;
            return (
              <li key={`${w.entry}-${w.meaning}`} className={me ? "me" : ""}>
                <PlayWord compact text={w.speak || w.lemma} label={w.lemma} />
                <span className="cc-lemma" lang={language === "hebrew" ? "he" : "grc"}>
                  {w.lemma}
                </span>
                {n ? (
                  <button type="button" className="word-number small" onClick={() => !me && onOpenWord(n)} disabled={me} title={me ? "This word" : "Open this word's page"}>
                    {n}
                  </button>
                ) : (
                  <span className="muted">—</span>
                )}
                <span className="muted word-gloss">{w.glosses.slice(0, 2).join(", ")}</span>
                <span className="muted word-count">
                  {w.verses.toLocaleString("en-US")}
                  {me ? " (this word)" : ""}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {words && sorted.length > 30 && (
        <button type="button" className="link-btn" onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show all ${sorted.length} words`}
        </button>
      )}
    </>
  );
}
