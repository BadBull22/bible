import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { Core } from "cytoscape";
import { api, LineagePerson, PersonSummary, parseCitation } from "../api";
import { CloseIcon } from "./icons";

interface Props {
  onClose: () => void;
  onJump: (book: string, chapter: number, verse: number) => void;
}

export function GenealogyPanel({ onClose, onJump }: Props) {
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [personId, setPersonId] = useState<string>("");
  const [lineage, setLineage] = useState<LineagePerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onJumpRef = useRef(onJump);
  onJumpRef.current = onJump;

  useEffect(() => {
    api
      .listGenealogyPeople()
      .then((p) => {
        setPeople(p);
        const david = p.find((x) => x.name === "David");
        setPersonId(david?.id ?? p[0]?.id ?? "");
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!personId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getLineage(personId)
      .then((l) => !cancelled && setLineage(l))
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [personId]);

  const elements = useMemo(() => {
    // lineage[0] is the selected person, lineage[last] is the oldest ancestor (Adam);
    // build edges child -> parent so the tree reads top (Adam) to bottom (selected).
    const nodes = lineage.map((p, i) => ({
      data: { id: p.id, label: p.name },
      classes: i === 0 ? "center" : undefined,
    }));
    const edges = lineage.slice(0, -1).map((p, i) => ({
      data: { id: `${lineage[i + 1].id}->${p.id}`, source: lineage[i + 1].id, target: p.id },
    }));
    return [...nodes, ...edges];
  }, [lineage]);

  useEffect(() => {
    if (!containerRef.current || elements.length === 0) return;
    const cy: Core = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#9c5b3c",
            label: "data(label)",
            "font-size": 10,
            color: "#e9e7e0",
            "text-outline-width": 2,
            "text-outline-color": "#1c2440",
            width: 20,
            height: 20,
          },
        },
        { selector: "node.center", style: { "background-color": "#c8963e", width: 32, height: 32, "font-size": 12 } },
        { selector: "edge", style: { width: 2, "line-color": "#7c786f", "target-arrow-shape": "triangle", "target-arrow-color": "#7c786f", "curve-style": "bezier" } },
      ],
      layout: { name: "breadthfirst", directed: true, spacingFactor: 1.1, padding: 20 } as cytoscape.LayoutOptions,
      minZoom: 0.3,
      maxZoom: 2,
    });
    const byId = new Map(lineage.map((l) => [l.id, l]));
    cy.on("tap", "node", (evt) => {
      const p = byId.get(evt.target.id());
      const ref = p && parseCitation(p.citation);
      if (ref) onJumpRef.current(ref.book, ref.chapter, ref.verse);
    });
    // the effect cleanup owns teardown; no manual destroy needed before re-creating
    return () => cy.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements]);

  const generations = lineage.length > 0 ? lineage.length - 1 : 0;

  return (
    <aside className="side-panel wide">
      <div className="side-panel-header">
        <h3>Genealogy</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="search-controls">
        <select value={personId} onChange={(e) => setPersonId(e.target.value)} aria-label="Person">
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <p className="search-hint" style={{ marginTop: 0 }}>
        Traced from Genesis, Ruth, and Matthew 1. Click a node or a name to jump to its citing verse.
        {generations > 0 && (
          <>
            {" "}
            {generations} generation{generations === 1 ? "" : "s"} back to {lineage[lineage.length - 1].name}.
          </>
        )}
      </p>
      <div ref={containerRef} className="cy-graph" style={{ height: 300 }} role="img" aria-label="Family tree" />
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="status-error">Couldn't load genealogy: {error}</p>}
      {!loading && lineage.length > 0 && (
        <ul className="xref-list">
          {lineage.map((p) => {
            const ref = parseCitation(p.citation);
            return (
              <li key={p.id}>
                <div className="xref-item-head">
                  <button className="link-btn" onClick={() => ref && onJump(ref.book, ref.chapter, ref.verse)}>
                    {p.name}
                    {p.alt_names.length > 0 && <span className="alt-names"> ({p.alt_names.join(", ")})</span>}
                  </button>
                  <span className="votes">{p.citation}</span>
                </div>
                {p.note && <div className="snippet">{p.note}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
