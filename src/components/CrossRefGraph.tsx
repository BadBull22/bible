import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { Core, ElementDefinition, Layouts } from "cytoscape";
// @ts-expect-error no type defs published for the cola layout extension itself
import cola from "cytoscape-cola";
import { api, BookInfo, CrossReference } from "../api";
import { CloseIcon } from "./icons";

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

// Semantic 3-way (plus Enoch) colour code for the graph -- deliberately independent
// of the app's accent colour, since these carry meaning (testament), not emphasis.
const COLORS = {
  center: "#c8963e",
  nt: "#5c7cba",
  ot: "#9c5b3c",
  enoch: "#9b6bd4",
  edge: "#7c786f",
};

const ROOT_LIST_LIMIT = 12;
const EXPAND_LIMIT = 10;

function refId(r: NodeRef) {
  return `${r.book} ${r.chapter}:${r.verse}`;
}

export function CrossRefGraph({ book, chapter, verse, books, onClose, onJump }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [topRefs, setTopRefs] = useState<CrossReference[]>([]);
  const [snippets, setSnippets] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<NodeRef | null>(null);
  const expanded = useRef<Set<string>>(new Set());
  // bumped after each expansion so UI derived from `expanded` (a ref) re-renders
  const [, setExpansionCount] = useState(0);
  const layoutRef = useRef<Layouts | null>(null);

  const testamentOf = useMemo(() => {
    const map: Record<string, string> = {};
    for (const b of books) map[b.name] = b.testament;
    return map;
  }, [books]);

  function nodeColor(ref: NodeRef, isCenter: boolean) {
    if (isCenter) return COLORS.center;
    if (ref.book === "Enoch") return COLORS.enoch;
    return testamentOf[ref.book] === "NT" ? COLORS.nt : COLORS.ot;
  }

  async function loadInto(cy: Core, center: NodeRef, isRoot: boolean) {
    const id = refId(center);
    if (expanded.current.has(id)) return;
    expanded.current.add(id);

    const refs = await api.crossReferencesFor(center.book, center.chapter, center.verse);
    if (cy.destroyed()) return;
    if (isRoot) {
      const top = refs.slice(0, ROOT_LIST_LIMIT);
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
    for (const r of refs.slice(0, EXPAND_LIMIT)) {
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
    setExpansionCount((n) => n + 1);
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
    setSelected(null);
    setTopRefs([]);
    setError(null);
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
        { selector: "node:selected", style: { "border-width": 3, "border-color": "#fff" } },
        {
          selector: "edge",
          style: {
            width: "mapData(votes, 0, 120, 1, 6)",
            "line-color": COLORS.edge,
            "curve-style": "bezier",
            "target-arrow-shape": "none",
            opacity: 0.6,
          },
        },
        { selector: "edge[?crossTestament]", style: { "line-color": COLORS.center, opacity: 0.9 } },
      ],
      minZoom: 0.2,
      maxZoom: 2.5,
    });
    cyRef.current = cy;

    cy.on("tap", "node", (evt) => {
      setSelected(evt.target.data("ref") as NodeRef);
    });
    cy.on("dbltap", "node", (evt) => {
      loadInto(cy, evt.target.data("ref") as NodeRef, false).catch((e) => setError(String(e)));
    });

    const root: NodeRef = { book, chapter, verse };
    setLoading(true);
    loadInto(cy, root, true)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));

    return () => {
      layoutRef.current?.stop();
      layoutRef.current = null;
      cy.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, chapter, verse]);

  const noRefs = !loading && !error && topRefs.length === 0;

  return (
    <aside className="side-panel wide">
      <div className="side-panel-header">
        <h3>
          Cross-reference web: {book} {chapter}:{verse}
        </h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="graph-legend" aria-label="Graph legend">
        <span><i className="swatch" style={{ background: COLORS.center }} /> This verse</span>
        <span><i className="swatch" style={{ background: COLORS.ot }} /> Old Testament</span>
        <span><i className="swatch" style={{ background: COLORS.nt }} /> New Testament</span>
        <span><i className="swatch" style={{ background: COLORS.enoch }} /> Enoch (non-canonical)</span>
        <span><i className="swatch swatch-line" style={{ background: COLORS.center }} /> Crosses testaments</span>
      </div>
      <div ref={containerRef} className="cy-graph" role="img" aria-label="Cross-reference graph" />
      <p className="search-hint" style={{ marginTop: 0 }}>
        Click a node to select it, double-click to expand its own links. Gold edges often mark prophecy ↔ fulfilment.
      </p>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="status-error">Couldn't load cross-references: {error}</p>}
      {noRefs && <p className="muted">No cross-references are recorded for this verse.</p>}
      {selected && (
        <div className="graph-selection">
          <strong>
            {selected.book} {selected.chapter}:{selected.verse}
          </strong>
          <div className="btn-row">
            <button className="pill-btn" onClick={() => onJump(selected.book, selected.chapter, selected.verse)}>
              Read this verse
            </button>
            <button
              className="outline-btn"
              disabled={expanded.current.has(refId(selected))}
              onClick={() => cyRef.current && loadInto(cyRef.current, selected, false).catch((e) => setError(String(e)))}
            >
              Expand links
            </button>
          </div>
        </div>
      )}
      {topRefs.length > 0 && (
        <>
          <h4 className="section-label">Strongest direct links</h4>
          <ul className="xref-list">
            {topRefs.map((r) => {
              const key = refId({ book: r.to_book, chapter: r.to_chapter, verse: r.to_verse_start });
              const range = r.to_verse_end > r.to_verse_start ? `–${r.to_verse_end}` : "";
              return (
                <li key={key}>
                  <div className="xref-item-head">
                    <button className="link-btn" onClick={() => onJump(r.to_book, r.to_chapter, r.to_verse_start)}>
                      {r.to_book} {r.to_chapter}:{r.to_verse_start}
                      {range}
                    </button>
                    <span className="votes" title="Community votes for this link (OpenBible.info)">
                      {r.votes} votes
                    </span>
                  </div>
                  {snippets[key] && <span className="snippet">{snippets[key]}</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </aside>
  );
}
