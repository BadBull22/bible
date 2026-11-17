// A group of meanings in its tree, drawn left to right: the groups above it, the groups beside it (press one to go to it), and the words inside it on the right.
// Dot size is the number of verses. The groups are from the UBS dictionaries (CC BY-SA 4.0); the card is from SIL Semantic Domains (CC BY-SA 4.0).

import { useEffect, useMemo, useState } from "react";
import { api, type MeaningWord, type SilCard } from "../api";
import { breadcrumb, treeColumns, type DomainNode } from "../semantic";
import { SilCardView } from "./SilCardView";
import type { Language, MeaningSel } from "./MeaningPicker";

interface Props {
  language: Language;
  code: string;
  name: string;
  /** a group was pressed: go to it */
  onPick: (sel: MeaningSel) => void;
}

const COL = 190;
const ROW = 21;
const PAD_T = 18;
const PAD_L = 10;
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

export function MeaningTree({ language, code, name, onPick }: Props) {
  const [nodes, setNodes] = useState<DomainNode[] | null>(null);
  const [words, setWords] = useState<MeaningWord[] | null>(null);
  const [card, setCard] = useState<SilCard | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

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
    api.semanticWords(language, code).then((w) => live && setWords(w)).catch(() => live && setWords([]));
    api.semanticGroupCard(language, code).then((c) => live && setCard(c)).catch(() => live && setCard(null));
    return () => {
      live = false;
    };
  }, [language, code]);

  const picture = useMemo(() => {
    if (!nodes) return null;
    const cols = treeColumns(nodes, code);
    const top = [...(words ?? [])].sort((a, b) => b.verses - a.verses).slice(0, 14);
    const columns = [
      ...cols.map((c) => ({ key: c.selected, nodes: c.nodes.map((n) => ({ id: n.code, text: n.name, verses: n.verses, group: n })), selected: c.selected, others: c.others })),
      { key: "words", nodes: top.map((w, i) => ({ id: `${w.entry}:${w.meaning}:${i}`, text: `${w.lemma} · ${w.glosses.slice(0, 2).join(", ")}`, verses: w.verses, group: null as DomainNode | null })), selected: "", others: 0 },
    ];
    const rows = Math.max(1, ...columns.map((c) => c.nodes.length));
    const height = PAD_T + rows * ROW + 8;
    const width = PAD_L * 2 + columns.length * COL;
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
    return { columns, at, links, width, height, radius, heads };
  }, [nodes, words, code]);

  if (error) return <p className="status-error">{error}</p>;
  if (!picture || !nodes) return <p className="muted">Loading the tree…</p>;

  const pickGroup = (g: DomainNode) =>
    onPick({ language, code: g.code, name: g.name, path: breadcrumb(nodes, g.code).map((n) => n.name).join(" > "), entry: null, meaning: null, word: null, words: g.words });

  return (
    <section className="meaning-tree" aria-label={`Where ${name} sits in the tree of meanings`}>
      <h4>Where “{name}” sits</h4>
      <div className="tree-scroll">
        <svg viewBox={`0 0 ${picture.width} ${picture.height}`} width={picture.width} height={picture.height} role="group" aria-label="The tree of meanings">
          {picture.heads.map((h, ci) => (
            <text key={ci} className="tree-head" x={PAD_L + ci * COL + 8} y={10}>
              {h}
            </text>
          ))}
          {picture.links.map((l, i) => (
            <path key={i} d={l.d} className="tree-link" />
          ))}
          {picture.columns.map((c, ci) => (
            <g key={ci}>
              {c.nodes.map((n) => {
                const [x, y] = picture.at.get(`${ci}:${n.id}`)!;
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
      {card !== undefined && <SilCardView card={card} />}
    </section>
  );
}
