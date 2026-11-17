// "In everyday English": the SIL Semantic Domains entry that goes with a group of meanings: a plain description, the groups it is related to and the words
// people use for it. SIL Global, CC BY-SA 4.0.

import { useState } from "react";
import type { SilCard } from "../api";

export function SilCardView({ card }: { card: SilCard | null }) {
  const [more, setMore] = useState(false);
  if (!card) {
    return (
      <div className="sil-card">
        <h4>In everyday English</h4>
        <p className="muted">There is no matching group in the SIL list for this meaning.</p>
      </div>
    );
  }
  const long = card.description.length > 300;
  const text = long && !more ? card.description.slice(0, 297).replace(/\s+\S*$/, "") + "…" : card.description;
  return (
    <div className="sil-card">
      <h4>
        In everyday English <span className="muted">· SIL Semantic Domains {card.code}</span>
      </h4>
      <div className="sil-crumbs">
        {card.path.map((p) => (
          <span key={p}>{p}</span>
        ))}
        <strong>{card.name}</strong>
      </div>
      <p>
        {text}{" "}
        {long && (
          <button type="button" className="link-btn" onClick={() => setMore(!more)}>
            {more ? "Less" : "More"}
          </button>
        )}
      </p>
      {card.related.length > 0 && (
        <>
          <h5>Related groups</h5>
          <div className="sil-chips">
            {card.related.map((r) => (
              <span key={r.code} className="rel">
                {r.name}
              </span>
            ))}
          </div>
        </>
      )}
      {card.words.length > 0 && (
        <>
          <h5>Words people use for it</h5>
          <div className="sil-chips">
            {card.words.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
        </>
      )}
      {!card.by_louw_nida && <p className="sil-note">Matched to the SIL list by its meaning.</p>}
      <p className="muted sil-credit">SIL Global, SIL Semantic Domains, CC BY-SA 4.0.</p>
    </div>
  );
}
