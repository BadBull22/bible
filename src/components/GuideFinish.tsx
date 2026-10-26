import { useEffect } from "react";
import { GuideContext, linkMaterial, passageOf, threadsOf } from "../guideData";
import { isScripture, newId, readingMinutes, SermonItem, stripMarks, testamentBalance, wordsWritten } from "../sermon";
import { partsOf } from "../sermonLayout";
import { ROLES } from "../sermonTemplates";
import { CardList, GuideSection, useLoaded } from "./GuideParts";
import { keyOf, threadCache } from "./GuideResearch";
import { SermonOutline } from "./SermonOutline";

type Block = Extract<SermonItem, { type: "block" }>;

const sectionOf = (items: SermonItem[], role: string) => partsOf(items).find((p) => p.head?.type === "block" && p.head.role === role)?.head as Block | undefined;

/** Step 6: how the sermon ends: restating the big idea, the call to respond, a prayer. */
export function GuideClose({ ctx }: { ctx: GuideContext }) {
  const ref = passageOf(ctx);
  const threads = useLoaded(keyOf(ref), () => threadsOf(ref!), threadCache);
  const conclusion = sectionOf(ctx.items, "conclusion");
  const response = sectionOf(ctx.items, "response");
  const prayer = sectionOf(ctx.items, "prayer");
  const topic = ctx.topics[0] ?? "";

  // what is added here goes to the conclusion
  useEffect(() => {
    if (conclusion) ctx.setTarget(conclusion.id);
    return () => ctx.setTarget(null);
  }, [conclusion?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const closing = (threads.data ?? [])
    .filter((t) => t.kind === "cross")
    .flatMap((t) => t.links.slice(0, 4).map((l) => linkMaterial(l, t, topic)))
    .filter((m) => !ctx.chosen.has(m.key))
    .slice(0, 5);

  function add(role: "conclusion" | "response" | "prayer") {
    const b: Block = { id: newId(), type: "block", role, label: ROLES[role].label, prompt: ROLES[role].prompt, text: "", level: 1 };
    ctx.change((items) => [...items, b]);
  }
  function drop(b: Block | undefined) {
    if (b) ctx.change((items) => items.filter((i) => i.id !== b.id));
  }
  const toggle = (role: "conclusion" | "response" | "prayer", b: Block | undefined) => (b ? drop(b) : add(role));

  return (
    <div className="sg-step">
      <section className="sg-card">
        <h3>How will it end?</h3>
        <p className="sg-hint">A good ending does three things: it brings the sermon to one thought, it tells people what to do about it, and it takes them to God in prayer.</p>
        <label className="check">
          <input type="checkbox" checked={!!conclusion} onChange={() => toggle("conclusion", conclusion)} /> A conclusion: gather it into one closing thought
        </label>
        <label className="check">
          <input type="checkbox" checked={!!response} onChange={() => toggle("response", response)} /> A call to respond: what will you invite people to do?
        </label>
        <label className="check">
          <input type="checkbox" checked={!!prayer} onChange={() => toggle("prayer", prayer)} /> A closing prayer
        </label>
        {ctx.bigIdea.trim() ? (
          <p className="sg-reminder">
            Your big idea: <strong>{ctx.bigIdea}</strong>
            <br />
            <span className="muted">Say it again in your conclusion, in the same words.</span>
          </p>
        ) : (
          <p className="sg-hint">
            You haven't written the big idea yet. Go back to step 2 to say it in one sentence, so your conclusion can come back to it.
          </p>
        )}
      </section>

      <GuideSection title="A closing verse" hint="A verse to end on, from those tied to your passage. It goes into your conclusion.">
        {conclusion ? <CardList items={closing} ctx={ctx} limit={5} empty={threads.loading ? "Looking…" : "No verses to suggest. You can search for one in the full builder."} /> : <p className="muted">Switch the conclusion on above to add a closing verse.</p>}
      </GuideSection>
    </div>
  );
}

const COACH: Record<string, string> = {
  intro: "Open with a question, a story, or a need everyone in the room feels. Aim for one or two minutes, then say where you are going.",
  point: "Read the Scripture. Say what it meant. Show it with a story or a picture. Then ask: what should change this week?",
  conclusion: "Bring it all to one thought, and say your big idea once more.",
  response: "Invite people to do something: pray, decide, forgive, serve. Be specific.",
  prayer: "Close in prayer, in your own words.",
  context: "Who wrote this, to whom, and why? What was happening at the time?",
};

/** Step 7: the preacher writes, one part at a time, with what was collected beside the page. */
export function GuideWrite({ ctx }: { ctx: GuideContext }) {
  const parts = partsOf(ctx.items).filter((p) => p.head);
  if (parts.length === 0) return <p className="muted sg-empty">There is nothing to write in yet. Choose a passage and a shape in steps 1 and 2.</p>;
  const idx = Math.min(Math.max(0, ctx.guide.part), parts.length - 1);
  const p = parts[idx];
  const h = p.head!;
  const label = h.type === "heading" ? stripMarks(h.text) || `Point ${idx}` : h.type === "block" ? h.label : "";
  const role = h.type === "block" ? h.role : "point";
  const written = (n: number) => ctx.items.slice(parts[n].start, parts[n].end).some((i) => (i.type === "block" || i.type === "note") && i.text.trim());
  const go = (n: number) => ctx.setGuide({ part: Math.min(Math.max(0, n), parts.length - 1) });

  return (
    <div className="sg-step">
      <nav className="sg-partnav" aria-label="Parts of the sermon">
        {parts.map((q, n) => {
          const t = q.head!;
          const l = t.type === "heading" ? stripMarks(t.text) || `Point ${n}` : t.type === "block" ? t.label : "";
          return (
            <button key={t.id} className={"sf-chip" + (n === idx ? " on" : "")} onClick={() => go(n)}>
              {written(n) ? "✓ " : ""}
              {l}
            </button>
          );
        })}
      </nav>
      <section className="sg-card">
        <h3>
          {label} <span className="muted">· part {idx + 1} of {parts.length}</span>
        </h3>
        <p className="sg-hint">{COACH[role] ?? COACH.point}</p>
        {ctx.bigIdea.trim() && (
          <p className="sg-reminder">
            Big idea: <strong>{ctx.bigIdea}</strong>
          </p>
        )}
        <SermonOutline
          items={ctx.items}
          outline={false}
          target={ctx.target}
          onTarget={ctx.setTarget}
          onChange={ctx.change}
          onText={ctx.onText}
          onLabel={ctx.onLabel}
          onMedia={ctx.onMedia}
          onMark={ctx.onMark}
          renderMaterial={ctx.renderMaterial}
          onPickMedia={ctx.pickMedia}
          only={h.id}
          expand
        />
        <div className="sg-pager">
          <button className="outline-btn" onClick={() => go(idx - 1)} disabled={idx === 0}>
            ‹ Previous part
          </button>
          <span className="muted">
            {wordsWritten(ctx.items)} words written
          </span>
          <button className="pill-btn" onClick={() => go(idx + 1)} disabled={idx >= parts.length - 1}>
            Next part ›
          </button>
        </div>
      </section>
    </div>
  );
}

function Check({ ok, children, action }: { ok: boolean | null; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <li className={ok === null ? "info" : ok ? "ok" : "todo"}>
      <span className="sg-mark" aria-hidden>
        {ok === null ? "i" : ok ? "✓" : "!"}
      </span>
      <span className="sg-check-text">{children}</span>
      {action}
    </li>
  );
}

/** Step 8: a last look, then where to go: read it and fix small things, print, slides, preach, save. */
export function GuideFinish({ ctx }: { ctx: GuideContext }) {
  const parts = partsOf(ctx.items).filter((p) => p.head);
  const balance = testamentBalance(ctx.items, ctx.books);
  const minutes = readingMinutes(ctx.items) + Math.round(wordsWritten(ctx.items) / 130);
  const points = parts.filter((p) => p.kind === "point");
  const slice = (i: number) => ctx.items.slice(parts[i].start, parts[i].end);
  const hasScripture = (i: number) => slice(i).some((x) => x.type === "material" && isScripture(x.material));
  const hasWords = (i: number) => slice(i).some((x) => (x.type === "block" || x.type === "note") && x.text.trim());
  const emptySections = ctx.items.filter((i) => i.type === "block" && !i.text.trim()).length;
  const writeAt = (i: number) => ctx.setGuide({ step: 6, part: i });
  const empty = ctx.items.length === 0;

  return (
    <div className="sg-step">
      <section className="sg-card">
        <h3>Almost there</h3>
        <label className="sg-wide-label">
          <span className="muted">Title of the sermon</span>
          <input className="sg-wide" value={ctx.title} onChange={(e) => ctx.setFields({ title: e.target.value })} placeholder="e.g. Born again" />
        </label>
        <ul className="sg-checks">
          <Check ok={!!ctx.title.trim()}>{ctx.title.trim() ? "It has a title." : "Give it a title, then save it."}</Check>
          <Check ok={!!ctx.bigIdea.trim()} action={!ctx.bigIdea.trim() && <button className="link-btn" onClick={() => ctx.setGuide({ step: 1 })}>Write it</button>}>
            {ctx.bigIdea.trim() ? "The big idea is in one sentence." : "The big idea isn't written yet."}
          </Check>
          {points.map((p) => {
            const i = parts.indexOf(p);
            const h = p.head!;
            const t = h.type === "heading" ? stripMarks(h.text) : "";
            const sc = hasScripture(i);
            const w = hasWords(i);
            return (
              <Check key={h.id} ok={sc && w} action={!(sc && w) && <button className="link-btn" onClick={() => writeAt(i)}>Write it</button>}>
                <strong>{t || "A point"}</strong>: {sc ? "has Scripture" : "no Scripture yet"}, {w ? "your own words are in" : "nothing written yet"}.
              </Check>
            );
          })}
          <Check ok={emptySections === 0 ? true : null}>{emptySections === 0 ? "Every section has something in it." : `${emptySections} section${emptySections === 1 ? " is" : "s are"} still empty. That is fine if you will say it without notes.`}</Check>
          <Check ok={balance.ot > 0 && balance.nt > 0 ? true : null}>
            {balance.ot > 0 && balance.nt > 0 ? "Scripture from both Testaments." : `All the Scripture is from the ${balance.ot === 0 ? "New" : "Old"} Testament. Consider a verse from the other.`}
          </Check>
          <Check ok={ctx.targetMinutes <= 0 || minutes <= ctx.targetMinutes ? true : null}>
            About {minutes} minute{minutes === 1 ? "" : "s"}
            {ctx.targetMinutes > 0 ? ` of your ${ctx.targetMinutes}` : ""}.
          </Check>
        </ul>
      </section>

      <section className="sg-card">
        <h3>What now?</h3>
        <p className="sg-hint">You can come back to any step. Nothing here locks the sermon.</p>
        <div className="sg-final-btns">
          <button className="pill-btn" onClick={() => ctx.goTab("review")} disabled={empty}>
            Read it and fix small things
          </button>
          <button className="outline-btn" onClick={() => ctx.goTab("print")} disabled={empty}>
            Print &amp; handouts
          </button>
          <button className="outline-btn" onClick={() => ctx.goTab("slides")} disabled={empty}>
            Slides
          </button>
          <button className="outline-btn" onClick={ctx.preach} disabled={empty}>
            Preach it
          </button>
          <button className="outline-btn" onClick={ctx.save} disabled={empty && !ctx.title.trim()}>
            {ctx.saved ? "Saved ✓" : "Save to My sermons"}
          </button>
        </div>
        <p className="muted sg-hint">
          Want every tool at once? <button className="link-btn" onClick={ctx.useFullBuilder}>Switch to the full builder</button>. Your sermon comes with you.
        </p>
      </section>
    </div>
  );
}
