import { useMemo, useState } from "react";
import { AiStory, AiThread, AiWordInsight } from "../offlineAi";
import { GuideContext, linkMaterial, passageOf, storyMaterial, threadsOf, storiesOf, wordMaterial, wordsOf } from "../guideData";
import { Material, Ref } from "../sermon";
import { AddTo, AssistantItems, CardList, FromPassage, GuideSection, useLoaded } from "./GuideParts";
import { SermonWords } from "./SermonWords";

// Steps 3 to 5: what the sermon is built from. Each shows a few suggestions from the app's own
// data, with where each is from, and one button to add it. Added things go to the right point
// by themselves (or to the point chosen in "Add to").

const wordCache = new Map<string, AiWordInsight[]>();
export const threadCache = new Map<string, AiThread[]>();
const storyCache = new Map<string, AiStory[]>();

export const keyOf = (r: Ref | null) => (r ? `${r.book}|${r.chapter}|${r.verse}|${r.verseEnd}` : null);

const ofKinds = (ctx: GuideContext, kinds: string[]) => ctx.gathered.filter((m) => kinds.includes(m.kind));

function Loading({ what, loading, error }: { what: string; loading: boolean; error: string | null }) {
  if (error) return <p className="status-error">{what} couldn't be found ({error}).</p>;
  return loading ? <p className="muted">Looking for {what}…</p> : null;
}

/** Step 3: what it meant (commentary, background), the words behind it, and the dictionaries. */
export function GuideUnderstand({ ctx }: { ctx: GuideContext }) {
  const ref = passageOf(ctx);
  const [lookup, setLookup] = useState(false);
  const words = useLoaded(keyOf(ref), () => wordsOf(ref!), wordCache);
  const topic = ctx.topics[0] ?? "";

  if (lookup && ref) return <SermonWords request={{ ref }} versionCode={ctx.versionCode} chosen={ctx.chosen} onToggle={ctx.toggle} onBack={() => setLookup(false)} />;

  return (
    <div className="sg-step">
      <AddTo ctx={ctx} />
      <FromPassage ctx={ctx} />
      <GuideSection title="What the commentators say" hint="What the passage meant to the people who first heard it. Each writer's view is their own; their name stays with it.">
        <CardList items={ofKinds(ctx, ["commentary", "background"])} ctx={ctx} limit={5} kind empty="No commentary was found for this passage." />
      </GuideSection>

      <GuideSection
        title="The Hebrew and Greek behind the words"
        hint="A few of the passage's words whose original says more than the English shows. Press + to put its meaning in your Explain section."
        action={
          ref && (
            <button className="text-btn" onClick={() => setLookup(true)}>
              Look up a word…
            </button>
          )
        }
      >
        {ref ? (
          <>
            <Loading what="the original words" loading={words.loading} error={words.error} />
            <CardList items={(words.data ?? []).map((c) => wordMaterial(c, ref, topic))} ctx={ctx} limit={5} empty={words.loading ? undefined : "No notable words were found in this passage."} />
          </>
        ) : (
          <p className="muted sg-empty">Choose a passage to see its Hebrew and Greek words.</p>
        )}
      </GuideSection>

      <GuideSection title="Dictionaries and topics" hint="What the Bible dictionaries and topical Bibles say about its people, places and ideas.">
        <CardList items={ofKinds(ctx, ["article", "people"])} ctx={ctx} limit={4} kind empty="Nothing was found in the dictionaries." />
      </GuideSection>
      <AssistantItems ctx={ctx} keys={/^assistant:(word:|structure:|\d+$)/} />
    </div>
  );
}

/** Step 4: the Bible explaining itself: cross-references, and more Scripture to read with it. */
export function GuideConnect({ ctx }: { ctx: GuideContext }) {
  const ref = passageOf(ctx);
  const threads = useLoaded(keyOf(ref), () => threadsOf(ref!), threadCache);
  const topic = ctx.topics[0] ?? "";
  const list = threads.data ?? [];
  const cross = list.filter((t) => t.kind === "cross");
  const more = list.filter((t) => t.kind !== "cross");

  const threadView = (th: AiThread, open: boolean) => {
    const mats = th.links.slice(0, 12).map((l) => linkMaterial(l, th, topic));
    return (
      <details key={`${th.kind}:${th.title}`} className="sg-thread" open={open}>
        <summary>
          <strong>{th.title}</strong> <span className="muted">· {th.source}</span>
        </summary>
        <CardList items={mats} ctx={ctx} limit={4} />
      </details>
    );
  };

  return (
    <div className="sg-step">
      <AddTo ctx={ctx} />
      <FromPassage ctx={ctx} />
      <GuideSection title="Cross-references" hint="Other verses that the Bible itself ties to your passage. They go into the Scripture of the point they belong to.">
        {!ref && <p className="muted sg-empty">Choose a passage to see its cross-references.</p>}
        {ref && <Loading what="the cross-references" loading={threads.loading} error={threads.error} />}
        {cross.map((t, i) => threadView(t, i === 0))}
        {!threads.loading && ref && cross.length === 0 && <CardList items={ofKinds(ctx, ["xref"])} ctx={ctx} limit={5} empty="No cross-references were found." />}
      </GuideSection>
      <GuideSection title="More Scripture to read with it" hint="Where the same Hebrew or Greek word is used, what the topical Bibles list under this subject, and the people and places in it.">
        {more.map((t) => threadView(t, false))}
        <CardList items={ofKinds(ctx, ["verse"])} ctx={ctx} limit={4} empty={more.length ? undefined : "No more verses were found."} />
      </GuideSection>
      <AssistantItems ctx={ctx} keys={/^assistant:thread:/} />
    </div>
  );
}

/** Step 5: stories and what others preached, and a picture, music or a link. */
export function GuideStories({ ctx }: { ctx: GuideContext }) {
  const ref = passageOf(ctx);
  const subjects = useMemo(() => ctx.topics.filter((t) => !ctx.guide.passage || t.toLowerCase() !== ctx.query.toLowerCase()).slice(0, 3), [ctx.topics, ctx.guide.passage, ctx.query]);
  const stories = useLoaded(ref ? `${keyOf(ref)}|${subjects.join(",")}` : null, () => storiesOf(ref!, subjects), storyCache);
  const topic = ctx.topics[0] ?? "";
  const mats: Material[] = (stories.data ?? []).map((s) => storyMaterial(s, ref!, topic));
  const told = mats.filter((m) => m.kind === "illustration");
  const preached = mats.filter((m) => m.kind !== "illustration");
  const media = ctx.items.filter((i) => i.type === "media");

  return (
    <div className="sg-step">
      <AddTo ctx={ctx} />
      <FromPassage ctx={ctx} />
      <GuideSection title="Stories and sayings" hint="Short stories and quotations from Moody and Spurgeon, with their source. Use them to make a point real.">
        {ref && <Loading what="stories" loading={stories.loading} error={stories.error} />}
        <CardList items={[...told, ...ofKinds(ctx, ["illustration", "quote"])].filter((m, i, a) => a.findIndex((x) => x.key === m.key) === i)} ctx={ctx} limit={5} empty={stories.loading ? undefined : "No stories were found for this."} />
      </GuideSection>

      <GuideSection title="What others preached on it" hint="Charles Simeon's outlines and Charles Spurgeon's sermons on this passage. To learn from, not to copy.">
        <CardList items={preached} ctx={ctx} limit={4} kind empty={stories.loading ? undefined : "No old sermons were found on this passage."} />
      </GuideSection>

      <GuideSection title="Pictures, music and links" hint="Add a photo, a picture of your own, a YouTube video, a song or any web link. It goes with the point you choose, and shows on your slides and in Preach.">
        <div className="sg-media-btns">
          <button className="pill-btn" onClick={() => ctx.pickMedia(ctx.target)}>
            + Add a picture, photo, video, song or link
          </button>
        </div>
        {media.length > 0 && (
          <ul className="sg-added">
            {media.map((i) => (i.type === "media" ? <li key={i.id}>{i.media.title}</li> : null))}
          </ul>
        )}
      </GuideSection>
      <AssistantItems ctx={ctx} keys={/^assistant:(story|questions):/} />
    </div>
  );
}
