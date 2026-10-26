import { useEffect, useMemo, useState } from "react";
import { GuideContext, loadParts, partRef } from "../guideData";
import { gatherable, upcoming } from "../lectionary";
import { parseRef, Ref, refLabel } from "../sermon";

const EXAMPLES = ["John 3", "Romans 8:28-39", "Psalm 23", "forgiveness", "faith in God", "the prodigal son"];

const label = (r: Ref) => (r.verseEnd >= 200 ? `${r.book} ${r.chapter}` : refLabel(r));

/** Step 1: what the sermon is about. A passage is cut into its natural parts to choose the points
 * from; a subject shows the key passages on it, to choose one (or to preach in points with none). */
export function GuidePassage({ ctx }: { ctx: GuideContext }) {
  const g = ctx.guide;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sundays = useMemo(() => upcoming(new Date(), 8).filter((a) => a.sunday).slice(0, 2), []);

  async function choose(ref: Ref, alsoGather: boolean) {
    setError(null);
    setLoading(true);
    ctx.setGuide({ passage: ref, noPassage: false, picks: [] });
    if (alsoGather) ctx.gather(label(ref));
    try {
      ctx.setGuide({ picks: await loadParts(ref) });
    } catch (e) {
      setError(`The passage couldn't be cut into parts (${e}). You can still go on.`);
    } finally {
      setLoading(false);
    }
  }

  function start(q: string) {
    const query = q.trim();
    if (!query) return;
    ctx.setFields({ query });
    const ref = parseRef(query.split(";")[0] ?? "", ctx.books);
    ctx.gather(query);
    if (ref) void choose(ref, false);
    else ctx.setGuide({ passage: null, picks: [], noPassage: false });
  }

  // a sermon opened with a passage but no parts yet (an older one): cut them now
  useEffect(() => {
    if (g.passage && g.picks.length === 0 && !loading && !error) void choose(g.passage, false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const keyPassages = ctx.gathered.filter((m) => m.kind === "passage" && m.ref);
  const on = g.picks.filter((p) => p.on).length;

  return (
    <div className="sg-step">
      <section className="sg-card">
        <h3>What is your sermon about?</h3>
        <p className="sg-hint">Type a passage (John 3, Romans 8:28-39) or a subject (forgiveness, hope). Press Find, and the app gathers what it has on it.</p>
        <form
          className="sf-ask"
          onSubmit={(e) => {
            e.preventDefault();
            start(ctx.query);
          }}
        >
          <input value={ctx.query} onChange={(e) => ctx.setFields({ query: e.target.value })} placeholder="A passage or a subject" aria-label="What the sermon is about" autoFocus={!g.passage} />
          <button className="pill-btn" type="submit" disabled={!!ctx.busy || !ctx.query.trim()}>
            {ctx.busy ? "Looking…" : "Find"}
          </button>
        </form>
        {ctx.busy && <p className="muted sf-busy">{ctx.busy}</p>}
        {!g.passage && !ctx.busy && keyPassages.length === 0 && (
          <p className="sermon-examples">
            Try:{" "}
            {EXAMPLES.map((x) => (
              <button key={x} className="note-tag" onClick={() => start(x)}>
                {x}
              </button>
            ))}
          </p>
        )}
        {sundays.length > 0 && !g.passage && keyPassages.length === 0 && (
          <div className="sg-sundays">
            <span className="muted">Or start from a coming Sunday's readings:</span>
            {sundays.map((a) => (
              <div key={a.date.toISOString()} className="sg-sunday">
                <strong>{a.date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</strong> {a.day.title.replace(/:.*$/, "")}
                {a.day.readings.map((r) => (
                  <button key={r} className="note-tag" onClick={() => start(gatherable(r))}>
                    {r}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      {error && <p className="status-error">{error}</p>}

      {g.passage && (
        <section className="sg-card">
          <div className="sg-section-head">
            <h3>Your passage: {label(g.passage)}</h3>
            <button
              className="text-btn"
              onClick={() => {
                ctx.setGuide({ passage: null, picks: [] });
              }}
            >
              Change it
            </button>
          </div>
          <p className="sg-hint">
            The passage is cut where its thought changes. <strong>Each part you keep becomes one point of your sermon.</strong> Untick any part you won't preach.
          </p>
          {loading && <p className="muted">Cutting the passage into its parts…</p>}
          {g.picks.length > 0 && (
            <>
              <div className="sg-picks-bar">
                <span className="muted">
                  {on} of {g.picks.length} parts kept
                </span>
                <button className="text-btn" onClick={() => ctx.setGuide({ picks: g.picks.map((p) => ({ ...p, on: true })) })}>
                  Keep all
                </button>
                <button className="text-btn" onClick={() => ctx.setGuide({ picks: g.picks.map((p) => ({ ...p, on: false })) })}>
                  Keep none
                </button>
              </div>
              <ol className="sg-picks">
                {g.picks.map((p, i) => (
                  <li key={`${p.v1}-${p.v2}`} className={p.on ? "on" : undefined}>
                    <label>
                      <input type="checkbox" checked={p.on} onChange={() => ctx.setGuide({ picks: g.picks.map((x, n) => (n === i ? { ...x, on: !x.on } : x)) })} />
                      <span className="sg-pick-ref">{refLabel(partRef(g.passage!, p))}</span>
                    </label>
                    <span className="sg-pick-text">{p.text}…</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </section>
      )}

      {!g.passage && !ctx.busy && keyPassages.length > 0 && (
        <section className="sg-card">
          <h3>Key passages on “{ctx.topics[0] ?? ctx.query}”</h3>
          <p className="sg-hint">
            Choose the passage to preach from; its parts become your points. Or preach the subject in points with no single passage.
          </p>
          <ul className="sg-list">
            {keyPassages.slice(0, 6).map((m) => (
              <li key={m.key} className="sg-item">
                <div className="sg-item-main">
                  <strong>{m.title}</strong>
                  <div className="sf-text">{m.text.replace(/\s+/g, " ")}</div>
                </div>
                <button className="pill-btn" onClick={() => void choose(m.ref!, true)}>
                  Use this passage
                </button>
              </li>
            ))}
          </ul>
          <button
            className="outline-btn"
            onClick={() => {
              ctx.setGuide({ noPassage: true, passage: null, picks: [] });
            }}
          >
            {g.noPassage ? "✓ " : ""}Preach the subject in points, with no single passage
          </button>
        </section>
      )}
    </div>
  );
}
