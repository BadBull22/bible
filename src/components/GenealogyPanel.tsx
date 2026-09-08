import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, { Core } from "cytoscape";
import { api, LineagePerson, PersonSummary, parseCitation } from "../api";

interface Props {
  onClose: () => void;
  onJump: (book: string, chapter: number, verse: number) => void;
}

export function GenealogyPanel({ onClose, onJump }: Props) {
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [personId, setPersonId] = useState<string>("");
  const [lineage, setLineage] = useState<LineagePerson[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    api.listGenealogyPeople().then((p) => {
      setPeople(p);
      const david = p.find((x) => x.name === "David");
      setPersonId(david?.id ?? p[0]?.id ?? "");
    });
  }, []);

  useEffect(() => {
    if (!personId) return;
    setLoading(true);
    api
      .getLineage(personId)
      .then(setLineage)
      .finally(() => setLoading(false));
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
    if (cyRef.current) cyRef.current.destroy();
    const cy = cytoscape({
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
    cy.on("tap", "node", (evt) => {
      const id = evt.target.id();
      const p = lineage.find((l) => l.id === id);
      if (p) {
        const ref = parseCitation(p.citation);
        if (ref) onJump(ref.book, ref.chapter, ref.verse);
      }
    });
    cyRef.current = cy;
    return () => cy.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements]);

  return (
    <aside className="side-panel wide">
      <div className="side-panel-header">
        <h3>Genealogy</h3>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="search-controls">
        <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <p className="search-hint" style={{ marginTop: 0 }}>
        Traced from Genesis, Ruth, and Matthew 1. Click a node to jump to its citing verse.
      </p>
      <div ref={containerRef} className="cy-graph" style={{ height: 300 }} />
      {loading && <p>Loading…</p>}
      {!loading && lineage.length > 0 && (
        <ul className="xref-list">
          {lineage.map((p) => {
            const ref = parseCitation(p.citation);
            return (
              <li key={p.id}>
                <div className="xref-item-head">
                  <button className="link-btn" onClick={() => ref && onJump(ref.book, ref.chapter, ref.verse)}>
                    {p.name}
                    {p.alt_names.length > 0 && <span style={{ color: "var(--text-faint)", fontWeight: 400 }}> ({p.alt_names.join(", ")})</span>}
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
