// A group of meanings in its tree, drawn left to right: the groups above it, the groups beside it (press one to go to it), and the words inside it on the right.
// Dot size is the number of verses. The words are listed with their Strong's number, meaning and number of verses; press a word to see all its meanings, or press its
// speaker to hear it said. The groups are from the UBS dictionaries (CC BY-SA 4.0); the card is from SIL Semantic Domains (CC BY-SA 4.0).

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type MeaningWord, type SilCard } from "../api";
import { breadcrumb, treeColumns, type DomainNode } from "../semantic";
import { SilCardView } from "./SilCardView";
import { languageOf, useOriginalSpeech } from "../speakWord";
import type { Language, MeaningSel } from "./MeaningPicker";

interface Props {
  language: Language;
  code: string;
  name: string;
  /** a group was pressed: go to it */
  onPick: (sel: MeaningSel) => void;
  /** a word was pressed: open its Strong's number with all its meanings */
  onWord?: (strongs: string) => void;
}

const COL = 170;
const ROW = 21;
const PAD_T = 18;
const PAD_L = 10;
/** the column of words is wider: a speaker, the word, its Strong's number, its meaning and its verses */
const WORD_COL = 340;
/** how many words are drawn before "Show all" */
const WORD_LIMIT = 40;
const trees = new Map<Language, Promise<DomainNode[]>>();
const tree = (l: Language): Promise<DomainNode[]> => {
  let p = trees.get(l);
  if (!p) {
    p = api.semanticTree(l);
    p.catch(() => trees.delete(l));
    trees.set(l, p);
  }
  return p;
};

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + "…" : t);

export function MeaningTree({ language, code, name, onPick, onWord }: Props) {
  const [nodes, setNodes] = useState<DomainNode[] | null>(null);
  const [words, setWords] = useState<MeaningWord[] | null>(null);
  const [card, setCard] = useState<SilCard | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const speech = useOriginalSpeech();
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    tree(language).then((t) => live && setNodes(t)).catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [language]);

  useEffect(() => {
    let live = true;
    setWords(null);
    setCard(undefined);
    setShowAll(false);
    api.semanticWords(language, code).then((w) => live && setWords(w)).catch(() => live && setWords([]));
    api.semanticGroupCard(language, code).then((c) => live && setCard(c)).catch(() => live && setCard(null));
    return () => {
      live = false;
    };
  }, [language, code]);

  const picture = useMemo(() => {
    if (!nodes) return null;
    const cols = treeColumns(nodes, code);
    const sorted = [...(words ?? [])].sort((a, b) => b.verses - a.verses);
    const top = showAll ? sorted : sorted.slice(0, WORD_LIMIT);
    const columns = [
      ...cols.map((c) => ({ key: c.selected, nodes: c.nodes.map((n) => ({ id: n.code, text: n.name, verses: n.verses, group: n as DomainNode | null, word: null as MeaningWord | null })), selected: c.selected, others: c.others })),
      { key: "words", nodes: top.map((w, i) => ({ id: `${w.entry}:${w.meaning}:${i}`, text: w.lemma, verses: w.verses, group: null as DomainNode | null, word: w as MeaningWord | null })), selected: "", others: 0 },
    ];
    const rows = Math.max(1, ...columns.map((c) => c.nodes.length));
    const height = PAD_T + rows * ROW + 8;
    const width = PAD_L * 2 + (columns.length - 1) * COL + WORD_COL;
    const maxV = Math.max(1, ...columns.flatMap((c) => c.nodes.map((n) => n.verses)));
    const radius = (v: number) => 3 + 6 * Math.sqrt(v / maxV);
    const at = new Map<string, [number, number]>();
    columns.forEach((c, ci) => {
      const off = PAD_T + ((rows - c.nodes.length) * ROW) / 2;
      c.nodes.forEach((n, ri) => at.set(`${ci}:${n.id}`, [PAD_L + ci * COL + 8, off + ri * ROW + ROW / 2]));
    });
    const links: { d: string }[] = [];
    for (let ci = 0; ci < columns.length - 1; ci++) {
      const from = at.get(`${ci}:${columns[ci].selected}`);
      if (!from) continue;
      for (const n of columns[ci + 1].nodes) {
        const to = at.get(`${ci + 1}:${n.id}`)!;
        const mx = (from[0] + to[0]) / 2 + 20;
        links.push({ d: `M${from[0] + 8},${from[1]} C${mx},${from[1]} ${mx},${to[1]} ${to[0] - 8},${to[1]}` });
      }
    }
    const heads: string[] = [...cols.map((_, i) => (i === 0 ? "Group" : i === cols.length - 1 ? "Same level" : "Group")), "Words in the group"];
    return { columns, at, links, width, height, radius, heads, shown: top.length, total: sorted.length };
  }, [nodes, words, code, showAll]);

  // the words are the point: when the tree is wider than the panel, show its right-hand end (the groups to the left are a scroll away)
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [picture?.width, code, words]);

  if (error) return <p className="status-error">{error}</p>;
  if (!picture || !nodes) return <p className="muted">Loading the tree…</p>;

  const pickGroup = (g: DomainNode) =>
    onPick({ language, code: g.code, name: g.name, path: breadcrumb(nodes, g.code).map((n) => n.name).join(" > "), entry: null, meaning: null, word: null, words: g.words });

  /** one word of the group: its dot, a speaker to hear it, the word, its Strong's number, its meaning and its verses; pressing it opens its meanings */
  const wordRow = (id: string, w: MeaningWord, x: number, y: number, r: number) => {
    const strongs = w.strongs[0];
    const say = w.speak || w.lemma;
    const lang = languageOf(say);
    const canSay = !!lang;
    const state = speech.busy === id ? "busy" : speech.playing === id ? "playing" : "idle";
    const open = strongs && onWord ? () => onWord(strongs) : undefined;
    const gloss = w.glosses.slice(0, 2).join(", ");
    const more = w.strongs.length > 1 ? ` +${w.strongs.length - 1}` : "";
    const detail = [strongs ? w.strongs.join(", ") : null, w.translit, gloss, `${w.verses} verse${w.verses === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
    return (
      <g key={id} className={"tree-node word" + (open ? " pressable" : "")}>
        <circle cx={x} cy={y} r={r} />
        <g
          className={"tree-play " + state}
          role="button"
          tabIndex={canSay ? 0 : undefined}
          aria-label={`Hear ${w.lemma}`}
          aria-disabled={!canSay}
          onClick={(e) => {
            e.stopPropagation();
            if (canSay) void speech.play(id, say);
          }}
          onKeyDown={(e) => {
            if (canSay && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              e.stopPropagation();
              void speech.play(id, say);
            }
          }}
        >
          <circle cx={x + 24} cy={y} r={8} />
          {state === "busy" ? (
            <text x={x + 24} y={y + 3.5} textAnchor="middle" className="tree-play-glyph">…</text>
          ) : state === "playing" ? (
            <path d={`M${x + 21},${y - 3.5}h2v7h-2zM${x + 25},${y - 3.5}h2v7h-2z`} className="tree-play-glyph" />
          ) : (
            <path d={`M${x + 21.5},${y - 4}L${x + 27.5},${y}L${x + 21.5},${y + 4}z`} className="tree-play-glyph" />
          )}
          <title>{canSay ? `Hear ${w.lemma}` : "This word cannot be played"}</title>
        </g>
        <g
          className="tree-wordtext"
          tabIndex={open ? 0 : undefined}
          role={open ? "button" : undefined}
          aria-label={open ? `${w.lemma}, ${strongs}, ${gloss}: see all its meanings` : undefined}
          onClick={open}
          onKeyDown={(e) => {
            if (open && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              open();
            }
          }}
          style={open ? { cursor: "pointer" } : undefined}
        >
          <rect x={x + 38} y={y - ROW / 2} width={WORD_COL - 44} height={ROW} className="tree-hit" />
          <text x={x + 42} y={y + 4} className="tree-lemma" style={{ direction: "ltr", unicodeBidi: "isolate" }}>
            {clip(w.lemma, 12)}
          </text>
          <text x={x + 118} y={y + 4} className="tree-strongs">
            {strongs ? clip(strongs + more, 9) : ""}
          </text>
          <text x={x + 172} y={y + 4}>{clip(gloss, 20)}</text>
          <text x={x + WORD_COL - 14} y={y + 4} textAnchor="end" className="tree-count">
            {w.verses}
          </text>
          <title>{detail}</title>
        </g>
      </g>
    );
  };

  return (
    <section className="meaning-tree" aria-label={`Where ${name} sits in the tree of meanings`}>
      <h4>Where “{name}” sits</h4>
      <div className="tree-scroll" ref={scroller}>
        <svg viewBox={`0 0 ${picture.width} ${picture.height}`} width={picture.width} height={picture.height} role="group" aria-label="The tree of meanings">
          {picture.heads.map((h, ci) => (
            <text key={ci} className="tree-head" x={PAD_L + ci * COL + 8} y={10}>
              {h}
            </text>
          ))}
          {picture.total > 0 && (
            <>
              <text className="tree-head" x={PAD_L + (picture.columns.length - 1) * COL + 8 + 118} y={10}>Strong's</text>
              <text className="tree-head" x={PAD_L + (picture.columns.length - 1) * COL + 8 + 172} y={10}>Meaning</text>
              <text className="tree-head" x={PAD_L + (picture.columns.length - 1) * COL + 8 + WORD_COL - 14} y={10} textAnchor="end">Verses</text>
            </>
          )}
          {picture.links.map((l, i) => (
            <path key={i} d={l.d} className="tree-link" />
          ))}
          {picture.columns.map((c, ci) => (
            <g key={ci}>
              {c.nodes.map((n) => {
                const [x, y] = picture.at.get(`${ci}:${n.id}`)!;
                if (n.word) return wordRow(n.id, n.word, x, y, picture.radius(n.verses));
                const on = n.id === c.selected;
                const press = n.group && !on ? () => pickGroup(n.group!) : undefined;
                return (
                  <g
                    key={n.id}
                    className={"tree-node" + (on ? " on" : "") + (n.group ? "" : " word")}
                    tabIndex={press ? 0 : undefined}
                    role={press ? "button" : undefined}
                    aria-label={press ? `${n.text}: go to this group` : undefined}
                    onClick={press}
                    onKeyDown={(e) => {
                      if (press && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        press();
                      }
                    }}
                    style={press ? { cursor: "pointer" } : undefined}
                  >
                    <circle cx={x} cy={y} r={picture.radius(n.verses)} />
                    <text x={x + 14} y={y + 4} style={n.group ? undefined : { direction: "ltr", unicodeBidi: "isolate" }}>
                      {clip(n.text, 26)}
                    </text>
                    <title>{`${n.text}${n.verses ? ` · ${n.verses} verses` : ""}`}</title>
                  </g>
                );
              })}
              {c.others > 0 && (
                <text className="tree-more" x={PAD_L + ci * COL + 8} y={picture.height - 6}>
                  + {c.others} other groups
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>
      {words === null && <p className="muted">Loading the words…</p>}
      {words !== null && picture.total > 0 && (
        <p className="muted tree-wordnote">
          {picture.shown < picture.total ? `The ${picture.shown} words used in the most verses of ${picture.total}. ` : `${picture.total} word${picture.total === 1 ? "" : "s"}. `}
          {picture.total > WORD_LIMIT && (
            <button type="button" className="link-btn" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer" : `Show all ${picture.total}`}
            </button>
          )}{" "}
          The last number is the verses it is used in. Press a word to see all its meanings, or its speaker to hear it (Greek the classical way, Hebrew the modern way).
        </p>
      )}
      {speech.error && <p className="status-error" role="alert">{speech.error}</p>}
      {card !== undefined && <SilCardView card={card} />}
    </section>
  );
}
