import { useEffect } from "react";
import { GuideContext, partRef } from "../guideData";
import { newId, refLabel, SermonItem, stripMarks } from "../sermon";
import { movePart, partsOf } from "../sermonLayout";
import { promptOf, templateByKey } from "../sermonTemplates";

// The shapes offered first (a full list is in the Full builder).
const PASSAGE_SHAPES = ["expository", "bigidea", "narrative", "points"];
const TOPIC_SHAPES = ["points", "bigidea", "problem", "narrative"];

/** A point's name as the templates first give it ("Point 2", "Part 1: Faith"), not the preacher's own. */
const isDefaultTitle = (t: string) => /^(Point|Part|Step|Section) \d+/i.test(t.trim());

const pointHeads = (items: SermonItem[]) =>
  partsOf(items)
    .filter((p) => p.kind === "point" && p.head)
    .map((p) => p.head as Extract<SermonItem, { type: "heading" }>);

/** Gives the points their names: the preacher's own where they had them, else the verses a point holds. */
function nameThePoints(items: SermonItem[], keep: string[]): SermonItem[] {
  const parts = partsOf(items).filter((p) => p.kind === "point" && p.head);
  const rename = new Map<string, string>();
  parts.forEach((p, i) => {
    const h = p.head as Extract<SermonItem, { type: "heading" }>;
    if (keep[i] && !isDefaultTitle(keep[i])) {
      rename.set(h.id, keep[i]);
      return;
    }
    const sec = items.slice(p.start, p.end).find((x) => x.type === "material" && x.material.kind === "section" && x.material.ref);
    if (sec && sec.type === "material" && sec.material.ref) rename.set(h.id, refLabel(sec.material.ref));
  });
  return items.map((i) => (i.type === "heading" && rename.has(i.id) ? { ...i, text: rename.get(i.id)! } : i));
}

/** Step 2: how the sermon will unfold. Choosing a shape lays the sermon out at once; the points
 * can then be named, moved, added and taken out here, and the big idea written. */
export function GuideStory({ ctx }: { ctx: GuideContext }) {
  const g = ctx.guide;
  const wanted = g.passage ? Math.max(1, g.picks.filter((p) => p.on).length) : Math.max(1, ctx.points);
  const structured = ctx.items.some((i) => i.type === "heading" || i.type === "block");
  const heads = pointHeads(ctx.items);
  const shapes = g.passage ? PASSAGE_SHAPES : TOPIC_SHAPES;
  const recommended = shapes[0];

  function apply(shape: string, count = wanted) {
    const keep = pointHeads(ctx.items).map((h) => stripMarks(h.text));
    ctx.build(shape, count);
    ctx.change((items) => nameThePoints(items, keep));
  }

  // the first time here: lay the sermon out (and again if the parts kept were changed)
  useEffect(() => {
    if (!g.passage && !g.noPassage) return;
    if (!structured || (g.passage && heads.length !== wanted && templateByKey(ctx.shape, []).point)) apply(structured ? ctx.shape : recommended);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** A new point after the last, with the sections the shape gives a point. */
  function addPoint() {
    const def = templateByKey(ctx.shape, []);
    const n = heads.length + 1;
    const point: SermonItem[] = [{ id: newId(), type: "heading", text: `Point ${n}` }];
    for (const s of def.point?.parts ?? [{ role: "explain" as const, label: "Explain" }]) {
      point.push({ id: newId(), type: "block", role: s.role, label: s.label, prompt: promptOf(s), text: "", level: 2 });
    }
    ctx.change((items) => {
      const parts = partsOf(items).filter((p) => p.kind === "point");
      const at = parts.length ? parts[parts.length - 1].end : (partsOf(items).find((p) => p.head?.type === "block" && p.head.role === "conclusion")?.start ?? items.length);
      return [...items.slice(0, at), ...point, ...items.slice(at)];
    });
  }

  function removePoint(id: string) {
    ctx.change((items) => {
      const p = partsOf(items).find((x) => x.head?.id === id);
      return p ? [...items.slice(0, p.start), ...items.slice(p.end)] : items;
    });
  }

  function move(i: number, by: -1 | 1) {
    const here = heads[i];
    const other = heads[i + by];
    if (!here || !other) return;
    ctx.change((items) => (by < 0 ? movePart(items, here.id, other.id) : movePart(items, other.id, here.id)));
  }

  if (!g.passage && !g.noPassage) return <p className="muted sg-empty">Choose a passage or a subject in step 1 first.</p>;

  return (
    <div className="sg-step">
      <section className="sg-card">
        <h3>How will you tell it?</h3>
        <p className="sg-hint">Pick a shape. Each one sets out the parts of the sermon for you, with a question to answer in each. You can change your mind; what you write is kept.</p>
        <div className="sb-template-cards">
          {shapes.map((k) => {
            const t = templateByKey(k, []);
            return (
              <button key={k} className={"sb-template-card" + (ctx.shape === k && structured ? " on" : "")} onClick={() => apply(k)}>
                <strong>
                  {t.name}
                  {k === recommended ? " — suggested" : ""}
                </strong>
                <span>{t.about}</span>
              </button>
            );
          })}
        </div>
      </section>

      {structured && (
        <section className="sg-card">
          <h3>Your points</h3>
          <p className="sg-hint">Name each point as you would say it to the people. Move them with the arrows.</p>
          <ol className="sg-points">
            {heads.map((h, i) => (
              <li key={h.id}>
                <span className="sg-n">{i + 1}</span>
                <input value={h.text} onChange={(e) => ctx.onText(h.id, e.target.value)} aria-label={`Point ${i + 1}`} />
                <button className="text-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                  ▲
                </button>
                <button className="text-btn" onClick={() => move(i, 1)} disabled={i === heads.length - 1} aria-label="Move down">
                  ▼
                </button>
                <button className="text-btn danger" onClick={() => removePoint(h.id)} disabled={heads.length <= 1} aria-label="Take this point out">
                  ✕
                </button>
              </li>
            ))}
          </ol>
          <button className="outline-btn" onClick={addPoint}>
            + Add a point
          </button>
        </section>
      )}

      <section className="sg-card">
        <h3>The big idea</h3>
        <p className="sg-hint">Say what the whole sermon is about in one sentence, as you would tell a child. You can leave this until the end.</p>
        <input
          className="sg-wide"
          value={ctx.bigIdea}
          onChange={(e) => ctx.setFields({ bigIdea: e.target.value })}
          placeholder="e.g. God's love does not wait for us to deserve it."
          aria-label="The big idea"
        />
        <input className="sg-wide" value={ctx.purpose} onChange={(e) => ctx.setFields({ purpose: e.target.value })} placeholder="What should they know, feel and do? (optional)" aria-label="Purpose" />
        {g.passage && structured && (
          <p className="muted sg-hint">
            Your passage: {refLabel({ ...g.passage })}. The Scripture for each point is already in place from the parts you kept
            {g.picks.filter((p) => p.on).length ? ` (${g.picks.filter((p) => p.on).map((p) => refLabel(partRef(g.passage!, p))).join("; ")})` : ""}.
          </p>
        )}
      </section>
    </div>
  );
}

