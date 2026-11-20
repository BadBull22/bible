// The Concordance's "Meaning" mode: choose a group of meanings (love, forgiveness, joy, fear...) from the Hebrew or the Greek, by typing a few words or by
// opening the groups one level at a time, and optionally one word in it. The Concordance then shows the books and the verses, as it does for a word.
// The groups come from the UBS open-licence dictionaries (CC BY-SA 4.0; credit in Settings, About).

import { useEffect, useMemo, useState } from "react";
import { api, type DomainNode, type MeaningWord } from "../api";
import { PlayWord } from "./PlayWord";
import { breadcrumb, childrenOf, searchDomains } from "../semantic";

export type Language = "greek" | "hebrew";

/** What was chosen: a group, or one meaning of one word in it. */
export interface MeaningSel {
  language: Language;
  code: string;
  /** the group's name */
  name: string;
  /** "Attitudes and Emotions > Love, Affection, Compassion" */
  path: string;
  entry: number | null;
  meaning: number | null;
  /** the word, when one was chosen ("ἀγάπη, love") */
  word: string | null;
  words: number;
}

interface Props {
  selected: MeaningSel | null;
  onPick: (sel: MeaningSel) => void;
  /** a word's Strong's number was pressed: open its meanings */
  onStrongs?: (strongs: string) => void;
}

/** the groups of each language, kept for the visit */
const trees = new Map<Language, DomainNode[]>();

export function MeaningPicker({ selected, onPick, onStrongs }: Props) {
  const [language, setLanguage] = useState<Language>(selected?.language ?? "greek");
  const [nodes, setNodes] = useState<DomainNode[] | null>(trees.get(language) ?? null);
  const [at, setAt] = useState(selected && selected.language === language ? selected.code.slice(0, Math.max(0, selected.code.length - 3)) : "");
  const [query, setQuery] = useState("");
  const [words, setWords] = useState<MeaningWord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const have = trees.get(language);
    if (have) {
      setNodes(have);
      return;
    }
    let live = true;
    setNodes(null);
    api
      .semanticTree(language)
      .then((t) => {
        trees.set(language, t);
        if (live) setNodes(t);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [language]);

  // the words in the chosen group
  useEffect(() => {
    setWords(null);
    if (!selected || selected.language !== language) return;
    let live = true;
    api
      .semanticWords(language, selected.code)
      .then((w) => live && setWords(w))
      .catch(() => live && setWords([]));
    return () => {
      live = false;
    };
  }, [selected?.code, selected?.language, language]); // eslint-disable-line react-hooks/exhaustive-deps

  const names = useMemo(() => new Map((nodes ?? []).map((n) => [n.code, n.name])), [nodes]);
  const pathOf = (code: string) => breadcrumb(nodes ?? [], code).map((n) => n.name).join(" > ");
  const shown = useMemo(() => (nodes ? (query.trim() ? searchDomains(nodes, query) : childrenOf(nodes, at)) : []), [nodes, query, at]);
  const trail = nodes ? breadcrumb(nodes, at) : [];

  const pick = (n: DomainNode) =>
    onPick({ language, code: n.code, name: n.name, path: pathOf(n.code), entry: null, meaning: null, word: null, words: n.words });
  const pickWord = (w: MeaningWord) =>
    selected &&
    onPick({ ...selected, entry: w.entry, meaning: w.meaning, word: `${w.lemma}${w.glosses[0] ? `, ${w.glosses[0]}` : ""}`, words: 1 });

  return (
    <div className="cc-meaning">
      <div className="cc-forms" role="group" aria-label="Which language">
        <button type="button" className={language === "greek" ? "on" : ""} aria-pressed={language === "greek"} onClick={() => (setLanguage("greek"), setAt(""), setQuery(""))} title="The words of the New Testament in Greek">
          New Testament (Greek)
        </button>
        <button type="button" className={language === "hebrew" ? "on" : ""} aria-pressed={language === "hebrew"} onClick={() => (setLanguage("hebrew"), setAt(""), setQuery(""))} title="The words of the Old Testament in Hebrew">
          Old Testament (Hebrew)
        </button>
      </div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="A meaning, like love, forgive, fear, joy" aria-label="Find a group of meanings by its name" />
      {error && <p className="status-error">{error}</p>}
      {!nodes && !error && <p className="muted">Opening the meanings…</p>}
      {nodes && !query.trim() && (
        <p className="cc-trail">
          <button type="button" className="link-btn" onClick={() => setAt("")} disabled={!at}>
            All groups
          </button>
          {trail.map((n) => (
            <span key={n.code}>
              {" › "}
              <button type="button" className="link-btn" onClick={() => setAt(n.code)}>
                {n.name}
              </button>
            </span>
          ))}
        </p>
      )}
      {nodes && (
        <ul className="cc-domains" aria-label="Groups of meanings">
          {shown.map((n) => {
            const kids = childrenOf(nodes, n.code).length > 0;
            return (
              <li key={n.code} className={selected?.language === language && selected.code === n.code ? "on" : undefined}>
                <button type="button" className="cc-domain" onClick={() => pick(n)} title={pathOf(n.code)}>
                  <span className="cc-dname">{n.name}</span>
                  {query.trim() && n.level > 1 && <span className="muted cc-dpath">{pathOf(n.code)}</span>}
                  <span className="muted cc-dcount">
                    {n.words.toLocaleString("en-US")} word{n.words === 1 ? "" : "s"} · {n.verses.toLocaleString("en-US")} verse{n.verses === 1 ? "" : "s"}
                  </span>
                </button>
                {kids && (
                  <button type="button" className="outline-btn cc-deeper" onClick={() => (setQuery(""), setAt(n.code))} title={`The groups inside ${n.name}`} aria-label={`The groups inside ${n.name}`}>
                    ›
                  </button>
                )}
              </li>
            );
          })}
          {shown.length === 0 && <li className="muted">{query.trim() ? "No group has those words in its name. Try another word." : "No groups here."}</li>}
        </ul>
      )}
      {selected && selected.language === language && words && words.length > 0 && (
        <details className="cc-words">
          <summary>
            The {words.length > 599 ? "first 600 " : ""}word{words.length === 1 ? "" : "s"} in “{names.get(selected.code) ?? selected.name}”
            {selected.word ? ` · showing only ${selected.word}` : ""}
          </summary>
          {selected.word && (
            <p>
              <button type="button" className="link-btn" onClick={() => onPick({ ...selected, entry: null, meaning: null, word: null, words: words.length })}>
                ‹ All the words in this group
              </button>
            </p>
          )}
          <ul className="cc-wordlist">
            {words.map((w) => (
              <li key={`${w.entry}-${w.meaning}`}>
                <PlayWord compact text={w.speak || w.lemma} label={w.lemma} />{" "}
                <button type="button" className="link-btn" onClick={() => pickWord(w)} title="See only this word, with this meaning">
                  <span className="cc-lemma" lang={language === "greek" ? "el" : "he"}>
                    {w.lemma}
                  </span>{" "}
                  {w.glosses.slice(0, 3).join(", ")}
                </button>
                <span className="muted">
                  {" "}
                  {w.strongs.map((n, i) => (
                    <span key={n}>
                      {i > 0 && ", "}
                      {onStrongs ? (
                        <button type="button" className="link-btn cc-strongs-btn" onClick={() => onStrongs(n)} title="See all the meanings of this word and its definition">
                          {n}
                        </button>
                      ) : (
                        n
                      )}
                    </span>
                  ))}
                  {w.translit ? ` · ${w.translit}` : ""}
                  {w.ln ? ` · Louw-Nida ${w.ln}` : ""} · {w.verses.toLocaleString("en-US")} verse{w.verses === 1 ? "" : "s"}
                </span>
                {w.definition && <div className="muted cc-def">{w.definition}</div>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
