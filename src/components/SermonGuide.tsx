import { useEffect, useState } from "react";
import { GuideContext, partRef, partText, sectionMaterial, STEPS } from "../guideData";
import { isScripture, Material, parseRef, stripMarks } from "../sermon";
import { partsOf } from "../sermonLayout";
import { GuideClose, GuideFinish, GuideWrite } from "./GuideFinish";
import { GuidePassage } from "./GuidePassage";
import { GuideConnect, GuideStories, GuideUnderstand } from "./GuideResearch";
import { GuideStory } from "./GuideStory";

const STORY_KINDS = ["illustration", "quote", "outline", "sermon"];
const WORD_KINDS = ["commentary", "background", "word", "article", "people", "mention", "note"];

/** What each part of the sermon holds so far, in a line: so the preacher sees it grow. */
function SoFar({ ctx }: { ctx: GuideContext }) {
  const parts = partsOf(ctx.items).filter((p) => p.head);
  if (parts.length === 0) return <p className="muted sg-hint">Your sermon will appear here as you build it.</p>;
  return (
    <ol className="sg-sofar">
      {parts.map((p) => {
        const h = p.head!;
        const label = h.type === "heading" ? stripMarks(h.text) || "A point" : h.type === "block" ? h.label : "";
        const mats = ctx.items.slice(p.start, p.end).flatMap((i) => (i.type === "material" ? [i.material] : []));
        const count = (f: (m: Material) => boolean) => mats.filter(f).length;
        const bits = [
          [count((m) => isScripture(m)), "Scripture"],
          [count((m) => WORD_KINDS.includes(m.kind)), "to understand it"],
          [count((m) => STORY_KINDS.includes(m.kind)), "stories"],
          [ctx.items.slice(p.start, p.end).filter((i) => i.type === "media").length, "pictures or links"],
        ].filter(([n]) => (n as number) > 0);
        const written = ctx.items.slice(p.start, p.end).some((i) => (i.type === "block" || i.type === "note") && i.text.trim());
        return (
          <li key={h.id} className={ctx.target === h.id ? "target" : undefined}>
            <strong>{label}</strong>
            <span className="muted">
              {bits.length ? bits.map(([n, w]) => `${n} ${w}`).join(" · ") : "nothing yet"}
              {written ? " · written ✓" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The step-by-step sermon builder: eight steps, each with its reason in plain words, a few
 * suggestions from the app's own data, and Back and Next. Nothing is required; every step can be
 * skipped, and the sermon underneath is the same one the Full builder shows. */
export function SermonGuide({ ctx }: { ctx: GuideContext }) {
  const g = ctx.guide;
  const step = Math.min(Math.max(0, g.step), STEPS.length - 1);
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const structured = ctx.items.some((i) => i.type === "heading" || i.type === "block");
  const ready = !!g.passage || g.noPassage;

  // a sermon made in the Full builder has its structure: say what it is about, so the steps can help
  useEffect(() => {
    if (g.passage || g.noPassage || !structured) return;
    const ref = parseRef(ctx.topics[0] ?? ctx.query.split(";")[0] ?? "", ctx.books);
    ctx.setGuide(ref ? { passage: ref } : { noPassage: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // leaving the first step: the parts kept become the sermon's Scripture, one per point
  async function commitParts(): Promise<boolean> {
    if (g.noPassage) return true;
    if (!g.passage) return false;
    const on = g.picks.filter((p) => p.on);
    if (g.picks.length && on.length === 0) {
      setNote("Keep at least one part of the passage; each part becomes a point.");
      return false;
    }
    if (g.picks.length === 0) return true;
    setWorking(true);
    try {
      const topic = ctx.topics[0] ?? "";
      const wanted = new Set<string>();
      const add: Material[] = [];
      for (const p of on) {
        const r = partRef(g.passage, p);
        const m = sectionMaterial(r, await partText(ctx.versionCode, r), ctx.versionCode, topic);
        wanted.add(m.key);
        if (!ctx.chosen.has(m.key)) add.push(m);
      }
      // parts that were kept before and are not now, in this passage's chapter
      const drop = ctx.items.flatMap((i) =>
        i.type === "material" && i.material.kind === "section" && i.material.ref && i.material.ref.book === g.passage!.book && i.material.ref.chapter === g.passage!.chapter && !wanted.has(i.material.key)
          ? [i.material.key]
          : [],
      );
      ctx.setSections(add, drop);
      return true;
    } finally {
      setWorking(false);
    }
  }

  async function go(to: number) {
    setNote(null);
    if (to === step || to < 0 || to >= STEPS.length) return;
    if (to > 0 && !ready) {
      setNote("Choose a passage or a subject first.");
      return;
    }
    if (step === 0 && to > 0 && !(await commitParts())) return;
    ctx.setGuide({ step: to, reached: Math.max(g.reached, to) });
    document.querySelector(".sg-main")?.scrollTo({ top: 0 });
  }

  const S = STEPS[step];
  const body =
    step === 0 ? (
      <GuidePassage ctx={ctx} />
    ) : step === 1 ? (
      <GuideStory ctx={ctx} />
    ) : step === 2 ? (
      <GuideUnderstand ctx={ctx} />
    ) : step === 3 ? (
      <GuideConnect ctx={ctx} />
    ) : step === 4 ? (
      <GuideStories ctx={ctx} />
    ) : step === 5 ? (
      <GuideClose ctx={ctx} />
    ) : step === 6 ? (
      <GuideWrite ctx={ctx} />
    ) : (
      <GuideFinish ctx={ctx} />
    );

  return (
    <div className="sg">
      <nav className="sg-stepper" aria-label="Steps">
        {STEPS.map((s, i) => (
          <button key={s.key} className={"sg-chip" + (i === step ? " on" : "") + (i < g.reached && i !== step ? " done" : "")} onClick={() => void go(i)} aria-current={i === step ? "step" : undefined} title={s.why}>
            <span className="sg-chip-n">{i < g.reached && i !== step ? "✓" : i + 1}</span> {s.title}
          </button>
        ))}
      </nav>

      <div className="sg-layout">
        <div className="sg-main">
          <header className="sg-head">
            <span className="muted">
              Step {step + 1} of {STEPS.length}
            </span>
            <h2>{S.title}</h2>
            <p className="sg-why">{S.why}</p>
          </header>
          {note && <p className="status-error">{note}</p>}
          {body}
        </div>
        <aside className="sg-aside" aria-label="Your sermon so far">
          <h4>Your sermon so far</h4>
          <SoFar ctx={ctx} />
          {ctx.items.length > 0 && <p className="muted sg-hint">Add what you find with <strong>+</strong>. It goes to the right point.</p>}
        </aside>
      </div>

      <footer className="sg-foot">
        <button className="outline-btn" onClick={() => void go(step - 1)} disabled={step === 0 || working}>
          ‹ Back
        </button>
        <span />
        {step < STEPS.length - 1 ? (
          <button className="pill-btn" onClick={() => void go(step + 1)} disabled={working || (step === 0 && !ready)}>
            {working ? "One moment…" : `Next: ${STEPS[step + 1].title} ›`}
          </button>
        ) : (
          <span />
        )}
      </footer>
    </div>
  );
}
