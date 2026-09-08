import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { Core, ElementDefinition, Layouts } from "cytoscape";
// @ts-expect-error no type defs published for the cola layout extension itself
import cola from "cytoscape-cola";
import { api, BookInfo, CrossReference } from "../api";

cytoscape.use(cola);

interface Props {
  book: string;
  chapter: number;
  verse: number;
  books: BookInfo[];
  onClose: () => void;
  onJump: (book: string, chapter: number, verse: number) => void;
}

interface NodeRef {
  book: string;
  chapter: number;
  verse: number;
}

function refId(r: NodeRef) {
  return `${r.book} ${r.chapter}:${r.verse}`;
}

export function CrossRefGraph({ book, chapter, verse, books, onClose, onJump }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [loading, setLoading] = useState(true);
  const [topRefs, setTopRefs] = useState<CrossReference[]>([]);
  const [snippets, setSnippets] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<NodeRef | null>(null);
  const expanded = useRef<Set<string>>(new Set());
  const layoutRef = useRef<Layouts | null>(null);

  const testamentOf = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of books) map[b.name] = b.testament;
    return map;
  }, [books]);

  function nodeColor(ref: NodeRef, isCenter: boolean) {
    if (isCenter) return "#c8963e";
    if (ref.book === "Enoch") return "#9b6bd4";
    return testamentOf[ref.book] === "NT" ? "#5c7cba" : "#9c5b3c";
  }

  async function loadInto(cy: Core, center: NodeRef, isRoot: boolean) {
    const id = refId(center);
    if (expanded.current.has(id)) return;
    expanded.current.add(id);

    const refs = await api.crossReferencesFor(center.book, center.chapter, center.verse);
    if (isRoot) {
      const top = refs.slice(0, 12);
      setTopRefs(top);
      setSnippets({});
      for (const r of top) {
        const snippetVersion = r.to_book === "Enoch" ? "ENOCH1" : "BSB";
        api
          .getVerseWithStrongs(snippetVersion, r.to_book, r.to_chapter, r.to_verse_start)
          .then((v) => setSnippets((s) => ({ ...s, [refId({ book: r.to_book, chapter: r.to_chapter, verse: r.to_verse_start })]: v.text })))
          .catch(() => {});
      }
    }

    const newEls: ElementDefinition[] = [];
    if (cy.getElementById(id).empty()) {
      newEls.push({
        data: { id, label: id, ref: center, color: nodeColor(center, isRoot) },
        classes: isRoot ? "center" : undefined,
      });
    }
    for (const r of refs.slice(0, 10)) {
      const target: NodeRef = { book: r.to_book, chapter: r.to_chapter, verse: r.to_verse_start };
      const tid = refId(target);
      if (cy.getElementById(tid).empty() && !newEls.some((e) => e.data.id === tid)) {
        newEls.push({ data: { id: tid, label: tid, ref: target, color: nodeColor(target, false) } });
      }
      const eid = `${id}->${tid}`;
      if (cy.getElementById(eid).empty()) {
        newEls.push({
          data: {
            id: eid,
            source: id,
            target: tid,
            votes: r.votes,
            crossTestament: testamentOf[center.book] !== testamentOf[target.book],
          },
        });
      }
    }
    cy.add(newEls);
    // stop any still-animating previous layout before starting a new one, and before
    // the component might unmount -- cola keeps ticking via requestAnimationFrame and
    // throws if it outlives a destroyed cytoscape instance (observed crash: "Cannot
    // read properties of null (reading 'notify')" from a stale animation frame).
    layoutRef.current?.stop();
    const layout = cy.layout({
      name: "cola",
      // @ts-expect-error cola-specific options aren't in the base cytoscape types
      animate: true,
      maxSimulationTime: 1500,
      nodeSpacing: () => 24,
      fit: true,
      padding: 30,
    });
    layoutRef.current = layout;
    layout.run();
  }

  useEffect(() => {
    if (!containerRef.current) return;
    // fresh graph each time book/chapter/verse changes, so the "already expanded"
    // bookkeeping must reset too -- otherwise revisiting a verse skips reloading it
    // into the new (empty) graph instance.
    expanded.current.clear();
    const cy = cytoscape({
      container: containerRef.current,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            label: "data(label)",
            "font-size": 9,
            color: "#e9e7e0",
            "text-outline-width": 2,
            "text-outline-color": "#1c2440",
            width: 22,
            height: 22,
          },
        },
        { selector: "node.center", style: { width: 34, height: 34, "font-size": 11, "border-width": 3, "border-color": "#fff" } },
        {
          selector: "edge",
          style: {
            width: "mapData(votes, 0, 120, 1, 6)",
            "line-color": "#7c786f",
            "curve-style": "bezier",
            "target-arrow-shape": "none",
            opacity: 0.6,
          },
        },
        { selector: "edge[?crossTestament]", style: { "line-color": "#c8963e", opacity: 0.9 } },
      ],
      minZoom: 0.2,
      maxZoom: 2.5,
    });
    cyRef.current = cy;

    cy.on("tap", "node", (evt) => {
      const ref = evt.target.data("ref") as NodeRef;
      setSelected(ref);
    });
    cy.on("dbltap", "node", (evt) => {
      const ref = evt.target.data("ref") as NodeRef;
      loadInto(cy, ref, false);
    });

    const root: NodeRef = { book, chapter, verse };
    setLoading(true);
    loadInto(cy, root, true).finally(() => setLoading(false));

    return () => {
      layoutRef.current?.stop();
      layoutRef.current = null;
      cy.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapter, verse]);

  return (
    <aside className="side-panel wide">
      <div className="side-panel-header">
        <h3>
          Cross-reference web: {book} {chapter}:{verse}
        </h3>
        <button onClick={onClose}>✕</button>
      </div>
      <p className="search-hint" style={{ marginTop: 0 }}>
        Gold node is the current verse. <span style={{ color: "#5c7cba" }}>Blue</span> nodes are New Testament,{" "}
        <span style={{ color: "#9c5b3c" }}>rust</span> nodes are Old Testament, and{" "}
        <span style={{ color: "#9b6bd4" }}>violet</span> nodes are the Book of Enoch (not part of the Bible's canon,
        but linked where a Bible verse directly quotes or alludes to it). Gold edges cross testaments (often
        prophecy ↔ fulfillment). Double-click a node to expand its own links; single-click to select it.
      </p>
      <div ref={containerRef} className="cy-graph" />
      {loading && <p>Loading…</p>}
      {selected && (
        <div className="graph-selection">
          <strong>
            {selected.book} {selected.chapter}:{selected.verse}
          </strong>
          <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.4rem" }}>
            <button className="pill-btn" onClick={() => onJump(selected.book, selected.chapter, selected.verse)}>
              Read this verse
            </button>
            <button
              onClick={() => cyRef.current && loadInto(cyRef.current, selected, false)}
              style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)" }}
            >
              Expand links
            </button>
          </div>
        </div>
      )}
      {topRefs.length > 0 && (
        <>
          <h4 style={{ fontSize: "0.78rem", textTransform: "uppercase", color: "var(--text-faint)", marginTop: "1.25rem" }}>
            Strongest direct links
          </h4>
          <ul className="xref-list">
            {topRefs.map((r, i) => {
              const snippet = snippets[refId({ book: r.to_book, chapter: r.to_chapter, verse: r.to_verse_start })];
              return (
                <li key={i}>
                  <div className="xref-item-head">
                    <button className="link-btn" onClick={() => onJump(r.to_book, r.to_chapter, r.to_verse_start)}>
                      {r.to_book} {r.to_chapter}:{r.to_verse_start}
                    </button>
                    <span className="votes">{r.votes}</span>
                  </div>
                  {snippet && <span className="snippet">{snippet}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </aside>
  );
}
