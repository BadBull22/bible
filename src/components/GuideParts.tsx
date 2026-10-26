import { ReactNode, useEffect, useState } from "react";
import { GuideContext, homeOf, passageOf } from "../guideData";
import { GROUPS, Material, refLabel, stripMarks } from "../sermon";
import { partsOf } from "../sermonLayout";
import { plainText } from "./RichText";

const KIND_LABEL = (k: string) => GROUPS.find((g) => g.kind === k)?.label.replace(/s$/, "") ?? k;

const clean = (m: Material) => plainText(m.text).replace(/⟪\d+⟫/g, "").replace(/\s+/g, " ").trim();

/** A suggestion: its title, where it is from, a taste of it (all of it on a click) and one
 * button to put it in the sermon (or take it out again). */
export function GuideCard({ m, ctx, kind }: { m: Material; ctx: GuideContext; kind?: boolean }) {
  const [open, setOpen] = useState(false);
  const on = ctx.chosen.has(m.key);
  const text = clean(m);
  return (
    <li className={"sg-item" + (on ? " on" : "")}>
      <button className="sf-add" onClick={() => ctx.toggle(m, homeOf(ctx, m))} aria-pressed={on} title={on ? "Take it out of the sermon" : "Add it to the sermon"}>
        {on ? "✓" : "+"}
      </button>
      <div className="sg-item-main">
        <button className="sf-title" onClick={() => setOpen(!open)} aria-expanded={open}>
          {kind && <span className="basket-kind">{KIND_LABEL(m.kind)}</span>} {m.title}
        </button>
        <span className="sf-meta">
          {m.source && <span className="sf-source">{m.source}</span>}
          {ctx.usedNote(m)}
        </span>
        <div className={"sf-text" + (open ? " open" : "")}>{text}</div>
        {m.ref && (
          <button className="link-btn sg-read" onClick={() => ctx.onJump(m.ref!.book, m.ref!.chapter, m.ref!.verse)} title="Open it in the Bible (your sermon is kept)">
            Read it in the Bible
          </button>
        )}
      </div>
    </li>
  );
}

/** A list of suggestions, a few at first and the rest on a click. */
export function CardList({ items, ctx, limit = 5, kind, empty }: { items: Material[]; ctx: GuideContext; limit?: number; kind?: boolean; empty?: string }) {
  const [all, setAll] = useState(false);
  if (items.length === 0) return empty ? <p className="muted sg-empty">{empty}</p> : null;
  const shown = all ? items : items.slice(0, limit);
  return (
    <>
      <ul className="sg-list">
        {shown.map((m) => (
          <GuideCard key={m.key} m={m} ctx={ctx} kind={kind} />
        ))}
      </ul>
      {items.length > limit && (
        <button className="text-btn" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show ${items.length - limit} more`}
        </button>
      )}
    </>
  );
}

/** A heading for a block of suggestions, with its plain-language hint. */
export function GuideSection({ title, hint, children, action }: { title: string; hint?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="sg-section">
      <div className="sg-section-head">
        <h4>{title}</h4>
        {action}
      </div>
      {hint && <p className="sg-hint">{hint}</p>}
      {children}
    </section>
  );
}

/** The parts of the sermon, to say where something goes: its points, and Introduction, Conclusion... */
export function sermonParts(ctx: GuideContext): { id: string; label: string; kind: "point" | "section" }[] {
  return partsOf(ctx.items)
    .filter((p) => p.head)
    .map((p) => {
      const h = p.head!;
      const label = h.type === "heading" ? stripMarks(h.text) || "A point" : h.type === "block" ? h.label : "";
      return { id: h.id, label, kind: p.kind === "point" ? ("point" as const) : ("section" as const) };
    });
}

/** "Add to: each into its place / Point 1 / Point 2 ...": where the next things added go. */
export function AddTo({ ctx }: { ctx: GuideContext }) {
  const parts = sermonParts(ctx);
  if (parts.length === 0) return null;
  return (
    <label className="sg-addto">
      <span className="muted">Add to</span>
      <select value={ctx.target ?? ""} onChange={(e) => ctx.setTarget(e.target.value || null)} aria-label="Where what you add goes">
        <option value="">Each into its place (automatic)</option>
        {parts.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** What the Offline Assistant brought and the preacher kept for this step. The assistant is hidden
 * until unlocked, so this is empty (and shows nothing) unless it was used. `keys` picks the finds
 * that belong to the step by their key. */
export function AssistantItems({ ctx, keys }: { ctx: GuideContext; keys: RegExp }) {
  const items = ctx.gathered.filter((m) => m.kind === "assistant" && keys.test(m.key));
  if (items.length === 0) return null;
  return (
    <GuideSection title="From the Offline Assistant" hint="What the assistant brought, with where each is from. Check each against the passage before you use it.">
      <CardList items={items} ctx={ctx} limit={5} />
    </GuideSection>
  );
}

/** A sermon on a subject has no main passage: the words, cross-references and stories are about the
 * first key passage found, and this says so. */
export function FromPassage({ ctx }: { ctx: GuideContext }) {
  const ref = passageOf(ctx);
  if (ctx.guide.passage || !ref) return null;
  return (
    <p className="sg-hint">
      The words, cross-references and stories here are about <strong>{refLabel(ref)}</strong>, the first key passage on your subject.
    </p>
  );
}

/** Loads something once per key (kept in `cache`, so going back and forth costs nothing) and
 * says what state it is in. */
export function useLoaded<T>(key: string | null, load: () => Promise<T>, cache: Map<string, T>): { data: T | null; loading: boolean; error: string | null } {
  const [, tick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const cached = key ? (cache.get(key) ?? null) : null;
  useEffect(() => {
    if (!key || cache.has(key)) return;
    let live = true;
    setError(null);
    load()
      .then((d) => {
        cache.set(key, d);
        if (live) tick((n) => n + 1);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { data: cached, loading: !!key && !cached && !error, error };
}
