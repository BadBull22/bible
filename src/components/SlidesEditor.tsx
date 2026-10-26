import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SlideKind, SlideSpec } from "../sermonOutputs";
import type { SlideOrder } from "../slideOrder";
import { groupsOf } from "../presentGroups";
import { leftText, startText } from "../countdown";
import { type BBox, type Box, canHavePicture, clampBox, DECORATION_AREA, hasWords, overlayPlacement, planOf, type SlideLayout, solidPart } from "../slideLayout";
import { kindOfName, mediaUrl, MediaRef } from "../sermonMedia";
import type { BookInfo, Version } from "../api";
import { MediaPicker } from "./MediaPicker";
import { SongPickerDialog } from "./SongLibrary";
import { ThemePicker } from "./ThemePicker";
import { VerseFinder } from "./VerseFinder";
import { CloseIcon } from "./icons";
import { backdrop } from "../backdrop";

interface Props {
  /** the slides as shown: the preacher's own, or made from the sermon */
  slides: SlideSpec[];
  /** the preacher has changed them (otherwise they follow the sermon) */
  edited: boolean;
  background: string | null;
  /** a see-through picture over the background and under the words (a title graphic, a paint sweep) */
  overlay?: string | null;
  onOverlay?: (file: string | null) => void;
  onChange: (slides: SlideSpec[] | null) => void;
  onBackground: (file: string | null) => void;
  /** verse numbers on Scripture slides (a sermon's slides) */
  verseNumbers?: boolean;
  onVerseNumbers?: (on: boolean) => void;
  /** these are the notices' or the music's slides, not a sermon's: nothing here follows a sermon */
  deck?: "notices" | "music";
  /** keep the slide selected as a notice in the library (the notices page) */
  onKeepSlide?: (slide: SlideSpec) => void;
  /** the Bibles and books, to find a verse for a Scripture slide by its reference */
  versions?: Version[];
  books?: BookInfo[];
  versionCode?: string;
  /** save as PowerPoint; `embed`: put the video and music files inside it */
  onSave: (embed: boolean) => void;
  saving: boolean;
  /** save for ProPresenter: a bundle with the slides, pictures, videos and music */
  onSaveProPresenter: () => void;
  /** start the slide show from this slide */
  onPresent: (from: number) => void;
  /** moving slides about, with the sermon moving the same way (slideOrder.ts) */
  order: SlideOrder;
  /** Undo, with what it would take back */
  undo: { can: boolean; label: string | null; run: () => void };
}

/** File types PowerPoint can play from inside the file (the rest can only be linked). */
const EMBEDDABLE = /\.(mp4|m4v|mov|wmv|avi|mp3|m4a|wav|wma)$/i;

/** The slide kinds there is a button for, in the order a preacher reaches for them. */
const ADD: { kind: SlideKind; label: string }[] = [
  { kind: "text", label: "Words" },
  { kind: "song", label: "Song" },
  { kind: "scripture", label: "Scripture" },
  { kind: "image", label: "Picture" },
  { kind: "link", label: "Music, video or link" },
  { kind: "point", label: "Heading" },
  { kind: "countdown", label: "Countdown" },
];

/** Kinds that can have a picture beside their words. */
const BESIDE: SlideKind[] = ["title", "point", "scripture", "text", "song"];

const KINDS: { kind: SlideKind; label: string }[] = [
  { kind: "point", label: "Heading" },
  { kind: "text", label: "Words" },
  { kind: "song", label: "Song words" },
  { kind: "scripture", label: "Scripture" },
  { kind: "image", label: "Picture" },
  { kind: "link", label: "Video, music or link" },
  { kind: "title", label: "Title" },
  { kind: "countdown", label: "Countdown" },
];

function useMedia(file: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (file) mediaUrl(file).then((u) => live && setUrl(u)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [file]);
  return url;
}

/** The background a slide will have: its own, or the one for all slides. */
const backgroundOf = (s: SlideSpec, all: string | null) => (s.background === undefined ? all : s.background || null);

/** Makes the words fit the slide, as PowerPoint's "shrink text on overflow" does: the
 * preview's text is made smaller step by step until nothing spills over. */
function useFit(deps: unknown[], on = true) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // (a slide whose parts are placed in boxes fits each box's words, not the whole slide)
    if (!on) {
      el.style.fontSize = "";
      return;
    }
    const fit = () => {
      el.style.fontSize = "";
      const base = parseFloat(getComputedStyle(el).fontSize) || 13;
      let size = base;
      for (let i = 0; i < 14 && el.scrollHeight > el.clientHeight + 1 && size > base * 0.35; i++) {
        size *= 0.9;
        el.style.fontSize = `${size}px`;
      }
    };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/** The time now, kept up to date every moment while `on` (for a countdown). */
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

const bboxCache = new Map<string, BBox | null>();

/** The solid part of a heading graphic (undefined until it has been looked at, null if there is nothing in it): the picture is drawn
 * small and its see-through channel read. */
function useBBox(url: string | null): BBox | null | undefined {
  const [bb, setBb] = useState<BBox | null | undefined>(() => (url ? bboxCache.get(url) : null));
  useEffect(() => {
    if (!url) return setBb(null);
    if (bboxCache.has(url)) return setBb(bboxCache.get(url));
    let live = true;
    setBb(undefined);
    const img = new Image();
    img.onload = () => {
      let found: BBox | null = null;
      try {
        const W = 192;
        const H = 108;
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(img, 0, 0, W, H);
          const px = ctx.getImageData(0, 0, W, H).data;
          const alpha = new Uint8Array(W * H);
          for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];
          found = solidPart(alpha, W);
        }
      } catch {
        found = null;
      }
      bboxCache.set(url, found);
      if (live) setBb(found);
    };
    img.onerror = () => live && setBb(null);
    img.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return bb;
}

/** What goes where on a slide: its words, its picture beside them and its own heading graphic, with their places. */
function useSlidePlan(s: SlideSpec, overlay: string | null | undefined, layoutOverride?: SlideLayout | null) {
  const ownOverlay = s.overlay === undefined ? null : s.overlay || null;
  const over = useMedia(s.overlay === undefined ? overlay : s.overlay || null);
  const side = useMedia(s.kind !== "image" && s.kind !== "link" ? s.picture : null);
  // only a slide's own heading graphic is spaced round; one for every slide (a paint sweep) is left as it is
  const solid = useBBox(ownOverlay ? over : null);
  const heading = solid && (solid.x1 - solid.x0) * (solid.y1 - solid.y0) < DECORATION_AREA ? solid : null;
  // (a place being dragged, if any, over the places kept on the slide)
  const layout = layoutOverride ?? s.layout;
  const plan = planOf(s, { words: hasWords(s), picture: canHavePicture(s) && !!side, heading }, layout);
  return { plan, over, side, heading };
}

const boxStyle = (b: Box): React.CSSProperties => ({ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%` });

/** The words of a heading, words, song, Scripture or title slide. */
function Words({ s }: { s: SlideSpec }) {
  if (s.kind === "scripture")
    return (
      <>
        <span className="slide-body">“{s.body}”</span>
        <span className="slide-ref">{s.title}</span>
      </>
    );
  // a song's words are the slide: large, with the song and its part small in a corner (the title slide names the song)
  if (s.kind === "song")
    return (
      <>
        <span className="slide-body slide-lyrics">{s.body}</span>
        {!s.noHeading && <span className="slide-corner">{s.title}</span>}
      </>
    );
  if (s.kind === "text")
    return (
      <>
        {!s.noHeading && <span className="slide-ref">{s.title}</span>}
        <span className="slide-body">{s.body}</span>
      </>
    );
  return (
    <>
      {!(s.noHeading && (s.kind === "point" || s.kind === "title")) && <span className="slide-title">{s.title}</span>}
      {s.body && <span className="slide-sub">{s.body}</span>}
    </>
  );
}

/** A slide drawn small, as it will look: words on navy, or on the darkened photo (or a moving background), with a
 * picture beside them if one was added. `overlay`: a see-through picture over the background and under the words (a slide's
 * own heading graphic is spaced round: the heading on top, the words and the picture under it, or where the preacher put
 * them, `layout`); `bare`: the words taken off (Clear); `live`: a moving background plays (a small one shows its first
 * picture); `countTo`: the moment a countdown slide reaches zero (none: it shows its length). */
export function Preview({ s, background, overlay, bare, live, countTo, layout }: { s: SlideSpec; background: string | null; overlay?: string | null; bare?: boolean; live?: boolean; countTo?: number | null; layout?: SlideLayout | null }) {
  const bgFile = backgroundOf(s, background);
  const moving = !!bgFile && kindOfName(bgFile) === "video";
  const bg = useMedia(bgFile);
  const { plan, over, side, heading } = useSlidePlan(s, overlay, layout);
  const pic = useMedia(s.kind === "image" ? s.image : null);
  const boxed = plan.boxed && ["title", "point", "text", "scripture", "song"].includes(s.kind);
  const fit = useFit([s.title, s.body, s.kind, side, bare, boxed], !boxed);
  const fitWords = useFit([s.title, s.body, s.kind, bare, plan.words?.w, plan.words?.h]);
  const now = useNow(s.kind === "countdown" && !!live && countTo != null);
  const place = boxed && plan.overlay && heading ? overlayPlacement(plan.overlay, heading) : null;
  const words = (
    <div className={`slide-preview k-${s.kind}` + (side && !boxed ? " with-picture" : "")} ref={fit} style={bg && !moving ? { backgroundImage: `linear-gradient(rgba(0,0,0,.52), rgba(0,0,0,.52)), url(${bg})` } : undefined}>
      {bg && moving && (
        <>
          <video className="slide-layer slide-bgvideo" src={live ? bg : `${bg}#t=0.1`} autoPlay={!!live} loop muted playsInline preload={live ? "auto" : "metadata"} />
          <span className="slide-layer slide-dim" />
        </>
      )}
      {over && <img className="slide-layer slide-overlay" src={over} alt="" draggable={false} style={place ? { inset: "auto", left: `${place.left}%`, top: `${place.top}%`, width: `${place.width}%`, height: `${place.height}%` } : undefined} />}
      {!bare && boxed && plan.words && (
        <div className="slide-box slide-words" ref={fitWords} style={boxStyle(plan.words)}>
          <Words s={s} />
        </div>
      )}
      {!bare && boxed && plan.picture && side && <img className="slide-box slide-pic" src={side} alt="" draggable={false} style={boxStyle(plan.picture)} />}
      {!bare &&
        !boxed &&
        (s.kind === "image" ? (
          <>
            {pic ? <img src={pic} alt="" draggable={false} /> : <span className="slide-missing">(choose a picture)</span>}
            <span className="slide-caption">{s.title}</span>
          </>
        ) : s.kind === "countdown" ? (
          <>
            <span className="slide-title">{s.title}</span>
            <span className="slide-count">{live && countTo != null ? leftText(countTo - now) : startText(s.body)}</span>
          </>
        ) : s.kind === "link" ? (
          <>
            <span className="slide-title">{s.title}</span>
            {s.body && <span className="slide-link">{s.body}</span>}
          </>
        ) : (
          <Words s={s} />
        ))}
      {!bare && !boxed && side && <img className="slide-beside" src={side} alt="" draggable={false} />}
    </div>
  );
  return words;
}

const PART_LABEL = { overlay: "Heading", words: "Words", picture: "Picture" } as const;

/** The slide being edited, large, with a label on each part (the heading graphic, the words, the picture beside them) to drag
 * it where you want it, and a square on its corner to make it larger or smaller. Letting go keeps the places on the slide. */
function EditablePreview({ s, background, overlay, onLayout }: { s: SlideSpec; background: string | null; overlay: string | null | undefined; onLayout: (l: SlideLayout) => void }) {
  const [draft, setDraft] = useState<SlideLayout | null>(null);
  const { plan } = useSlidePlan(s, overlay, draft);
  const wrap = useRef<HTMLDivElement>(null);
  const latest = useRef<SlideLayout | null>(null);
  // the slide changed (another one chosen, or the places kept): nothing is half-dragged
  useEffect(() => setDraft(null), [s]);

  const begin = (e: React.PointerEvent, key: keyof typeof PART_LABEL, mode: "move" | "size") => {
    const el = wrap.current;
    const box0 = plan[key];
    if (!el || !box0 || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const r = el.getBoundingClientRect();
    const from = { x: e.clientX, y: e.clientY };
    const base: SlideLayout = {};
    for (const k of Object.keys(PART_LABEL) as (keyof typeof PART_LABEL)[]) if (plan[k]) base[k] = plan[k]!;
    const ratio = box0.h / Math.max(box0.w, 1);
    const move = (ev: PointerEvent) => {
      const dx = ((ev.clientX - from.x) / r.width) * 100;
      const dy = ((ev.clientY - from.y) / r.height) * 100;
      let box: Box;
      if (mode === "move") box = clampBox({ ...box0, x: box0.x + dx, y: box0.y + dy });
      else if (key === "overlay") box = clampBox({ ...box0, w: box0.w + dx, h: (box0.w + dx) * ratio });
      else box = clampBox({ ...box0, w: box0.w + dx, h: box0.h + dy });
      latest.current = { ...base, [key]: box };
      setDraft(latest.current);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (latest.current) onLayout(latest.current);
      latest.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <div className="layout-wrap" ref={wrap}>
      <Preview s={s} background={background} overlay={overlay} layout={draft} />
      <div className="layout-handles">
        {(Object.keys(PART_LABEL) as (keyof typeof PART_LABEL)[]).map(
          (k) =>
            plan[k] && (
              <div key={k} className={"layout-handle " + k} style={boxStyle(plan[k]!)}>
                <span className="layout-tag" onPointerDown={(e) => begin(e, k, "move")} onMouseDown={(e) => e.preventDefault()} title={`Drag to move the ${PART_LABEL[k].toLowerCase()}`}>
                  ✥ {PART_LABEL[k]}
                </span>
                <i className="layout-grip" onPointerDown={(e) => begin(e, k, "size")} onMouseDown={(e) => e.preventDefault()} title="Drag to make it larger or smaller" />
              </div>
            ),
        )}
      </div>
    </div>
  );
}

/** The sermon's slides: as they follow from the sermon, or changed, reordered and added to
 * by the preacher -- words, song words, pictures, video and music links -- on navy or on a
 * photo. Saved as PowerPoint. */
export function SlidesEditor({ slides, edited, background, overlay, onOverlay, onChange, onBackground, verseNumbers, onVerseNumbers, deck, onKeepSlide, versions, books, versionCode, onSave, onSaveProPresenter, saving, onPresent, order, undo }: Props) {
  const [selected, setSelected] = useState(0);
  // a song from the library, or a verse found by its reference, to put on the slides
  const [songs, setSongs] = useState(false);
  // the look picker: for all the slides or for the one selected, opening on backgrounds, moving ones, or the headings
  const [themes, setThemes] = useState<null | { mode: "all" | "slide"; tab: "background" | "video" | "overlay" }>(null);
  const [verse, setVerse] = useState(false);
  // the video and music files on the slides: asked each time whether they go inside the
  // PowerPoint or are linked
  const [askClips, setAskClips] = useState(false);
  const clipFiles = slides.filter((s) => s.kind === "link" && s.link?.startsWith("media:") && ["video", "audio"].includes(kindOfName(s.link)));
  const save = () => (clipFiles.length ? setAskClips(true) : onSave(false));
  const [picker, setPicker] = useState<null | { for: "background" | "slide-background" | "picture" | "beside" | "media"; at: number }>(null);
  const cur = slides[Math.min(selected, slides.length - 1)];

  const update = (i: number, patch: Partial<SlideSpec>) => onChange(slides.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  // Dragging a slide with the mouse. Press on it, move a little, and it is picked up: a copy of it follows
  // the pointer exactly as it was grabbed, and the other slides slide aside, live, to open the slot it
  // would land in (always the legal slot nearest to where the copy is), so the list on screen is the list
  // you will get. Let go and it stays there, highlighted. (The browser's own drag and drop does not work in
  // this window on Windows, so the mouse is followed directly.)
  const stripRef = useRef<HTMLOListElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const grab = useRef({ x: 0, y: 0, w: 0, h: 0 }); // where on the slide it was taken, and its size
  const carrying = useRef(false);
  const justDragged = useRef(false); // the click that ends a drag is not a choice of slide
  const [drag, setDrag] = useState<number | null>(null); // the slide carried
  const [aside, setAside] = useState<number[] | null>(null); // how far each slide is moved aside, in px along the list
  const [landed, setLanded] = useState<number | null>(null); // where it went, for a moment
  const dragUnit = drag === null ? null : order.unit(drag);
  /** moves slide i's slides to the gap: the sermon moves with them */
  const go = (i: number, gap: number | null) => {
    if (gap === null) return;
    const at = order.move(i, gap);
    if (at === null) return;
    setSelected(at);
    setLanded(at);
    window.setTimeout(() => setLanded((l) => (l === at ? null : l)), 1100);
  };
  const press = (e: React.PointerEvent, i: number) => {
    const strip = stripRef.current;
    const unit = order.unit(i);
    if (e.button !== 0 || !strip || !unit) return;
    const [a, b] = unit;
    const row = getComputedStyle(strip).flexDirection === "row";
    const n = slides.length;
    // where every slide is now, along the list, in the list's own coordinates (they do not change when it scrolls)
    const rects = ([...strip.children] as HTMLElement[]).map((li) => li.getBoundingClientRect());
    const start = strip.getBoundingClientRect();
    const scroll0 = row ? strip.scrollLeft : strip.scrollTop;
    const tops = rects.map((r) => (row ? r.left - start.left : r.top - start.top) + scroll0);
    const sizes = rects.map((r) => (row ? r.width : r.height));
    const space = n > 1 ? Math.max(0, tops[1] - tops[0] - sizes[0]) : 0;
    const before = (g: number) => (g < n ? tops[g] : tops[n - 1] + sizes[n - 1] + space) - tops[0];
    const span = before(b) - before(a); // the room the carried slides take, with the space after them
    const own = tops[i] - tops[a]; // how far down its group the grabbed slide is
    /** where the grabbed slide would be if dropped into gap g */
    const slotAt = (g: number) => tops[0] + (g <= a ? before(g) : before(g) - span) + own;
    // the slots it could go into: where a drop would change something
    const legal: number[] = [];
    for (let g = 0; g <= n; g++) if (order.gap(i, g) === g) legal.push(g);
    /** how far each slide moves aside when the carried ones go into gap g */
    const asideFor = (g: number) => {
      const carried = Array.from({ length: b - a }, (_, k) => a + k);
      const rest = Array.from({ length: n }, (_, k) => k).filter((k) => k < a || k >= b);
      const at = g > b ? g - (b - a) : g;
      const out = new Array<number>(n).fill(0);
      let y = tops[0];
      for (const k of [...rest.slice(0, at), ...carried, ...rest.slice(at)]) {
        out[k] = y - tops[k];
        y += sizes[k] + space;
      }
      return out;
    };
    const grabbed = (row ? e.clientX - rects[i].left : e.clientY - rects[i].top);
    grab.current = { x: e.clientX - rects[i].left, y: e.clientY - rects[i].top, w: rects[i].width, h: rects[i].height };
    const from = { x: e.clientX, y: e.clientY };
    pointer.current = { ...from };
    let moved = false;
    let gap: number | null = null;
    let shown = -1;
    let dwell = 0;
    // the slot whose place for the grabbed slide is nearest to where the copy is
    const aim = () => {
      const r = strip.getBoundingClientRect();
      const p = (row ? pointer.current.x - r.left : pointer.current.y - r.top) + (row ? strip.scrollLeft : strip.scrollTop);
      let best: number | null = null;
      for (const g of legal) if (best === null || Math.abs(slotAt(g) - (p - grabbed)) < Math.abs(slotAt(best) - (p - grabbed))) best = g;
      gap = best;
      if ((best ?? -1) === shown) return;
      shown = best ?? -1;
      setAside(best === null ? null : asideFor(best));
    };
    // pushed towards an end of the list, the list scrolls (slowly at first), so a slide can be carried a long way.
    // A slide picked up near an end does not scroll the list by itself: the pointer has to go further in.
    const depthAt = (pos: number) => {
      const r = strip.getBoundingClientRect();
      const lo = (row ? r.left : r.top) + 50;
      const hi = (row ? r.right : r.bottom) - 50;
      return pos < lo ? (pos - lo) / 50 : pos > hi ? (pos - hi) / 50 : 0;
    };
    const along = (x: number, y: number) => (row ? x : y);
    const depth0 = depthAt(along(from.x, from.y));
    const scroller = window.setInterval(() => {
      if (!moved) return;
      const depth = depthAt(along(pointer.current.x, pointer.current.y));
      if (depth === 0 || (Math.sign(depth) === Math.sign(depth0) && Math.abs(depth) - Math.abs(depth0) < 0.4)) {
        dwell = 0;
        return;
      }
      dwell += 16;
      if (dwell < 200) return;
      const v = Math.sign(depth) * Math.min(20, 2 + Math.abs(depth) * 10);
      if (row) strip.scrollLeft += v;
      else strip.scrollTop += v;
      aim();
    }, 16);
    const place = () => {
      if (ghostRef.current) ghostRef.current.style.transform = `translate(${pointer.current.x - grab.current.x}px, ${pointer.current.y - grab.current.y}px)`;
    };
    const finish = () => {
      window.clearInterval(scroller);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onCancel);
      strip.removeEventListener("scroll", aim);
      document.body.classList.remove("slides-dragging");
      carrying.current = false;
      setDrag(null);
      setAside(null);
    };
    const onMove = (ev: PointerEvent) => {
      // the button was let go somewhere we were not told about (outside the window): not a drop
      if (moved && (ev.buttons & 1) === 0) return finish();
      pointer.current = { x: ev.clientX, y: ev.clientY };
      if (!moved) {
        if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 5) return;
        moved = true;
        carrying.current = true;
        document.body.classList.add("slides-dragging");
        strip.addEventListener("scroll", aim);
        setDrag(i);
      }
      place();
      aim();
    };
    const onUp = () => {
      const drop = moved ? gap : null;
      finish();
      if (moved) {
        justDragged.current = true;
        window.setTimeout(() => (justDragged.current = false), 0);
        go(i, drop);
      }
    };
    const onCancel = () => finish();
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && finish();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onCancel);
  };
  // the copy of the slide that follows the pointer is put where the pointer is as soon as it exists
  useLayoutEffect(() => {
    if (drag !== null && ghostRef.current) ghostRef.current.style.transform = `translate(${pointer.current.x - grab.current.x}px, ${pointer.current.y - grab.current.y}px)`;
  }, [drag]);

  // the slide chosen stays in view when it changes or the slides do (a move, a button), but never
  // while one is being carried, and not when only the sermon's details changed
  const sig = slides.map((s) => s.from ?? s.title).join("\u0001");
  useEffect(() => {
    const strip = stripRef.current;
    const li = strip?.children[selected] as HTMLElement | undefined;
    if (!strip || !li || carrying.current) return;
    const s = strip.getBoundingClientRect();
    const r = li.getBoundingClientRect();
    if (getComputedStyle(strip).flexDirection === "row") {
      if (r.left < s.left) strip.scrollLeft -= s.left - r.left + 8;
      else if (r.right > s.right) strip.scrollLeft += r.right - s.right + 8;
    } else if (r.top < s.top) strip.scrollTop -= s.top - r.top + 8;
    else if (r.bottom > s.bottom) strip.scrollTop += r.bottom - s.bottom + 8;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, sig]);
  const insert = (at: number, add: SlideSpec[]) => {
    const next = [...slides];
    next.splice(at + 1, 0, ...add);
    onChange(next);
    setSelected(at + 1);
  };
  /** a song goes after the end of the song that is selected, never into the middle of it */
  const insertSong = (at: number, add: SlideSpec[]) => {
    const sel = slides[at];
    if (sel?.song) {
      const { groups, groupOf } = groupsOf(slides);
      const g = groups[groupOf[at]];
      if (g) return insert(g.to - 1, add);
    }
    insert(at, add);
  };
  const remove = (i: number) => {
    onChange(slides.filter((_, n) => n !== i));
    setSelected(Math.max(0, i - 1));
  };
  const addKind = (kind: SlideKind) => {
    if (kind === "image") setPicker({ for: "picture", at: selected });
    else if (kind === "link") setPicker({ for: "media", at: selected });
    else if (kind === "song") setSongs(true);
    else if (kind === "countdown") insert(selected, [{ kind, title: "The service starts in", body: "5" }]);
    else if (kind === "scripture" && versions && books && versionCode) setVerse(true);
    else insert(selected, [{ kind, title: kind === "scripture" ? "Reference" : "New slide", body: "" }]);
  };
  const fromMedia = (m: MediaRef): SlideSpec =>
    m.kind === "image" && m.file
      ? { kind: "image", title: m.title, body: "", image: m.file }
      : { kind: "link", title: m.title, body: m.kind === "video" || m.kind === "audio" ? "▶ Play" : "Open", link: m.url ?? `media:${m.file}` };

  return (
    <div className="slides-editor">
      <div className="slides-bar">
        <span className="sb-inline">
          <span className="muted">Background for all slides</span>
          <button
            className={"sf-chip" + (!background && !overlay ? " on" : "")}
            onClick={() => {
              onBackground(null);
              onOverlay?.(null);
            }}
          >
            Plain navy
          </button>
          <button className={"sf-chip" + (background && kindOfName(background) !== "video" ? " on" : "")} onClick={() => setPicker({ for: "background", at: 0 })}>
            {background && kindOfName(background) !== "video" ? "Change the photo…" : "A photo…"}
          </button>
          <button
            className={"sf-chip" + ((background && kindOfName(background) === "video") || overlay ? " on" : "")}
            onClick={() => setThemes({ mode: "all", tab: "background" })}
            title="A moving background, or a ready-made look from a folder of backgrounds and title graphics, for all the slides"
          >
            {background && kindOfName(background) === "video" ? "Change the moving background…" : "Moving backgrounds and layers…"}
          </button>
        </span>
        {onVerseNumbers && (
          <label className="sb-inline" title="Show the verse numbers in the Scripture on the slides">
            <input type="checkbox" checked={!!verseNumbers} onChange={(e) => onVerseNumbers(e.target.checked)} />
            <span className="muted">Verse numbers</span>
          </label>
        )}
        <span className="muted">
          {deck ? (
            <>Drag a slide up or down to move it. Saved on its own, so you can use it again.</>
          ) : edited ? (
            <>
              Your own slides.{" "}
              <button className="link-btn" onClick={() => onChange(null)} title="Throw away your changes and make the slides from the sermon again">
                Make them from the sermon again
              </button>
            </>
          ) : (
            "Made from your sermon: they change as it does. Edit any slide to make them your own."
          )}
          {!deck && " Drag a slide up or down to move it; the sermon moves the same way."}
        </span>
        <span className="slides-add" role="group" aria-label="Add a slide after the one selected">
          <span className="muted">Add a slide:</span>
          {ADD.map((k) => (
            <button key={k.kind} className="sf-chip" onClick={() => addKind(k.kind)} title={`Add a ${k.label.toLowerCase()} slide after slide ${selected + 1}`}>
              + {k.label}
            </button>
          ))}
        </span>
        <span className="slides-actions">
          <button className="outline-btn" onClick={undo.run} disabled={!undo.can} title="Take back the last change, to the slides or to the sermon (Ctrl+Z)">
            ↶ Undo{undo.can && undo.label ? `: ${undo.label}` : ""}
          </button>
          <button className="pill-btn" onClick={() => onPresent(0)} disabled={slides.length === 0} title="Present from this laptop: the slides on the projector or second screen, and on this screen the slides, the next one, your notes, the clock and the buttons you need">
            ▶ Present
          </button>
          <button className="outline-btn" onClick={() => onPresent(selected)} disabled={slides.length === 0} title={`Start the show at slide ${selected + 1}`}>
            From this slide
          </button>
          <button className="outline-btn" onClick={save} disabled={saving || slides.length === 0}>
            {saving ? "Saving…" : "Save as PowerPoint"}
          </button>
          <button className="outline-btn" onClick={onSaveProPresenter} disabled={saving || slides.length === 0} title="A file to import into ProPresenter (File, Import): the slides as ProPresenter's own, with your pictures, videos and music inside it">
            Save for ProPresenter
          </button>
        </span>
      </div>

      {!order.inStep && (
        <div className="slides-match" role="status">
          <span>The sermon is in a different order from these slides.</span>
          <button className="pill-btn" onClick={order.match} title="Move the points and passages in the sermon into the order of the slides. Undo takes it back.">
            Make the sermon match the slides
          </button>
        </div>
      )}

      {slides.length === 0 && (
        <div className="slides-empty" role="status">
          <span className="slides-empty-arrow" aria-hidden>
            ↑
          </span>
          <strong>No slides yet</strong>
          <p>
            Choose one or more of the options above to add your first slide.
            {deck === "music" ? " Press + Add next to a song in your list on the left to put it on the slides (or look one up), or use + Music, video or link above for a song on YouTube." : deck === "notices" ? " Use + Words for a notice, + Picture for a poster or photo, and + Heading to start a new section." : ""}
          </p>
        </div>
      )}

      <div className="slides-work">
        <ol className={"slides-strip" + (drag !== null ? " carrying" : "")} aria-label="The slides" ref={stripRef}>
          {slides.map((s, i) => (
            <li
              key={i}
              className={
                (i === selected ? "on" : "") +
                (order.unit(i) ? " movable" : "") +
                (dragUnit && drag !== null && i >= dragUnit[0] && i < dragUnit[1] ? " dragging" : "") +
                (landed === i ? " landed" : "")
              }
              style={aside ? ({ "--aside": `${aside[i] ?? 0}px` } as React.CSSProperties) : undefined}
              onPointerDown={(e) => press(e, i)}
              // no text selection or focus grab when a press turns into a carry
              onMouseDown={(e) => order.unit(i) && e.button === 0 && e.preventDefault()}
            >
              {s.song && (i === 0 || slides[i - 1].song !== s.song || s.section === "Title") && <span className="slides-song-label">♪ {s.song}</span>}
              <button
                className="slides-strip-pick"
                onClick={() => !justDragged.current && setSelected(i)}
                aria-label={`Slide ${i + 1}: ${s.title}`}
                title={order.unit(i) ? "Click to choose it; press and drag to move it" : "The title slide stays first"}
              >
                <span className="slides-n">{i + 1}</span>
                <Preview s={s} background={background} overlay={overlay} />
              </button>
            </li>
          ))}
        </ol>

        {cur && (
          <div className="slides-edit">
            <EditablePreview s={cur} background={background} overlay={overlay} onLayout={(layout) => update(selected, { layout })} />
            <p className="layout-hint">
              <span className="muted">Drag the labels on the slide to move the heading, the words or the picture; drag the small square on a corner to make it larger or smaller.</span>{" "}
              <button className="outline-btn" onClick={() => update(selected, { layout: undefined })} disabled={!cur.layout} title="Space the heading, words and picture out again, so none lies on another">
                Auto-space this slide
              </button>
            </p>
            <div className="slides-fields">
              <label className="sb-inline">
                <span className="muted">Kind</span>
                <select value={cur.kind} onChange={(e) => update(selected, { kind: e.target.value as SlideKind })}>
                  {KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="muted">{cur.kind === "countdown" ? "Words above the clock" : cur.kind === "scripture" ? "Reference" : cur.kind === "image" ? "Caption" : cur.kind === "song" ? "Song title" : "Heading"}</span>
                <input value={cur.title} onChange={(e) => update(selected, { title: e.target.value })} />
              </label>
              {cur.kind !== "image" && (
                <label>
                  <span className="muted">{cur.kind === "countdown" ? "Minutes to count down (5), a length (1:30), or a time of day (at 10:30)" : cur.kind === "link" ? "The words to click" : cur.kind === "song" ? "The words (a line each; a blank line between verses)" : "Words"}</span>
                  <textarea value={cur.body} rows={cur.kind === "song" || cur.kind === "scripture" ? 8 : 3} onChange={(e) => update(selected, { body: e.target.value })} />
                </label>
              )}
              {cur.kind === "image" && (
                <button className="outline-btn" onClick={() => setPicker({ for: "picture", at: -1 })}>
                  {cur.image ? "Choose another picture…" : "Choose the picture…"}
                </button>
              )}
              {cur.kind === "link" && (
                <label>
                  <span className="muted">What it opens (a web address)</span>
                  <input
                    value={cur.link?.startsWith("media:") ? "(a file kept with the sermon)" : cur.link ?? ""}
                    disabled={cur.link?.startsWith("media:")}
                    onChange={(e) => update(selected, { link: e.target.value })}
                    placeholder="https://www.youtube.com/watch?v=…"
                  />
                </label>
              )}
              <div className="slides-look">
                <span className="sb-inline">
                  <span className="muted">This slide's background</span>
                  <button
                    className={"sf-chip" + (cur.background === undefined && cur.overlay === undefined ? " on" : "")}
                    onClick={() => update(selected, { background: undefined, overlay: undefined })}
                    title="The background chosen for all slides"
                  >
                    Same as all
                  </button>
                  <button className={"sf-chip" + (cur.background === "" && !cur.overlay ? " on" : "")} onClick={() => update(selected, { background: "", overlay: "" })}>
                    Plain
                  </button>
                  <button className={"sf-chip" + (cur.background && kindOfName(cur.background) !== "video" ? " on" : "")} onClick={() => setPicker({ for: "slide-background", at: selected })}>
                    {cur.background && kindOfName(cur.background) !== "video" ? "Change the photo…" : "A photo…"}
                  </button>
                  <button
                    className={"sf-chip" + (cur.background && kindOfName(cur.background) === "video" ? " on" : "")}
                    onClick={() => setThemes({ mode: "slide", tab: "video" })}
                    title="A looping video behind the words, for this slide only"
                  >
                    {cur.background && kindOfName(cur.background) === "video" ? "Change the moving background…" : "A moving background…"}
                  </button>
                  {(cur.background !== undefined || cur.overlay !== undefined) && (
                    <button
                      className="link-btn"
                      onClick={() => {
                        onBackground(cur.background === undefined ? background : cur.background || null);
                        onOverlay?.(cur.overlay === undefined ? overlay ?? null : cur.overlay || null);
                        onChange(slides.map(({ background: _, overlay: __, ...s }) => s));
                      }}
                      title="Make this slide's look the one for every slide"
                    >
                      Use for all slides
                    </button>
                  )}
                </span>
                <span className="sb-inline">
                  <span className="muted">Heading over the background</span>
                  <button
                    className={"sf-chip" + (cur.overlay === undefined ? (overlay ? " on" : "") : cur.overlay ? " on" : "")}
                    onClick={() => setThemes({ mode: "slide", tab: "overlay" })}
                    title="A cursive heading such as “Baptism”, “Announcements” or “Offering”, or a paint-sweep layer, laid over this slide's background"
                  >
                    {(cur.overlay === undefined ? overlay : cur.overlay) ? "Change the heading…" : "A cursive heading…"}
                  </button>
                  {(cur.overlay === undefined ? overlay : cur.overlay) && (
                    <button className="link-btn" onClick={() => update(selected, { overlay: "" })}>
                      Take it off
                    </button>
                  )}
                  {cur.kind === "song" && (
                    <label className="sb-inline" title="The song and its part are shown small in the top corner of every slide of the song; tick to leave them off this slide">
                      <input type="checkbox" checked={!!cur.noHeading} onChange={(e) => update(selected, { noHeading: e.target.checked || undefined })} />
                      <span className="muted">Leave out the song name in the corner</span>
                    </label>
                  )}
                  {(cur.overlay === undefined ? overlay : cur.overlay) && ["text", "point", "title"].includes(cur.kind) && (
                    <label className="sb-inline" title="The graphic is the heading, so the written one is left off the slide">
                      <input type="checkbox" checked={!!cur.noHeading} onChange={(e) => update(selected, { noHeading: e.target.checked || undefined })} />
                      <span className="muted">Leave out the written heading</span>
                    </label>
                  )}
                </span>
                {BESIDE.includes(cur.kind) && (
                  <span className="sb-inline">
                    <span className="muted">Picture beside the words (a logo, say)</span>
                    <button className="sf-chip" onClick={() => setPicker({ for: "beside", at: selected })}>
                      {cur.picture ? "Change the picture…" : "Add a picture to this slide…"}
                    </button>
                    {cur.picture && (
                      <button className="link-btn" onClick={() => update(selected, { picture: undefined })}>
                        Remove it
                      </button>
                    )}
                  </span>
                )}
              </div>
              <label>
                <span className="muted">Your notes (only you see them, in the presenter view)</span>
                <textarea value={cur.notes ?? ""} rows={2} onChange={(e) => update(selected, { notes: e.target.value || undefined })} />
              </label>
              <div className="slides-row-tools">
                <button className="text-btn" onClick={() => go(selected, order.step(selected, -1))} disabled={order.step(selected, -1) === null} title="Move it up (a point takes its slides with it, and the sermon moves the same way)">
                  ▲ Earlier
                </button>
                <button className="text-btn" onClick={() => go(selected, order.step(selected, 1))} disabled={order.step(selected, 1) === null} title="Move it down (a point takes its slides with it, and the sermon moves the same way)">
                  ▼ Later
                </button>
                <button className="text-btn" onClick={() => insert(selected, [{ ...cur, from: undefined, pinned: undefined }])}>
                  Copy
                </button>
                {onKeepSlide && (
                  <button className="text-btn" onClick={() => onKeepSlide(cur)} title="Keep this slide in your list of notices, to use again on other Sundays">
                    Keep in my notices
                  </button>
                )}
                <button className="text-btn danger" onClick={() => remove(selected)} disabled={slides.length <= 1}>
                  <CloseIcon size={11} /> Delete
                </button>
              </div>
              {cur.kind === "link" && <p className="search-hint">In the slide show, click the words to play it. A web link needs the internet; a file plays from this computer.</p>}
            </div>
          </div>
        )}
      </div>

      {drag !== null && dragUnit && slides[drag] && (
        <div className="slides-carried" ref={ghostRef} style={{ width: grab.current.w }} aria-hidden>
          <Preview s={slides[drag]} background={background} overlay={overlay} />
          {dragUnit[1] - dragUnit[0] > 1 && <span className="slides-carried-n">+ {dragUnit[1] - dragUnit[0] - 1} more with it</span>}
        </div>
      )}

      {askClips && (
        <div className="mp-backdrop" role="dialog" aria-modal="true" aria-label="Videos and music in the PowerPoint" {...backdrop(() => setAskClips(false))}>
          <div className="mp slides-ask" onClick={(e) => e.stopPropagation()}>
            <strong>
              {clipFiles.length === 1 ? "There is a video or music file on the slides." : `There are ${clipFiles.length} video or music files on the slides.`} How should{" "}
              {clipFiles.length === 1 ? "it" : "they"} go into the PowerPoint?
            </strong>
            <div className="slides-ask-choices">
              <button
                className="pill-btn"
                onClick={() => {
                  setAskClips(false);
                  onSave(true);
                }}
              >
                Put {clipFiles.length === 1 ? "it" : "them"} inside the PowerPoint
              </button>
              <span className="muted">Plays on any computer, without the original files. The PowerPoint file is bigger.</span>
              <button
                className="outline-btn"
                onClick={() => {
                  setAskClips(false);
                  onSave(false);
                }}
              >
                Link to {clipFiles.length === 1 ? "it" : "them"}
              </button>
              <span className="muted">A small file, but it plays only on this computer, where the files are kept.</span>
            </div>
            {clipFiles.some((s) => !EMBEDDABLE.test(s.link ?? "")) && (
              <p className="search-hint">
                PowerPoint can't play {[...new Set(clipFiles.filter((s) => !EMBEDDABLE.test(s.link ?? "")).map((s) => "." + (s.link ?? "").split(".").pop()))].join(", ")} files from
                inside, so those stay linked either way.
              </p>
            )}
            <p className="search-hint">Web videos (YouTube and the like) are always links: they need the internet.</p>
            <button className="text-btn" onClick={() => setAskClips(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {themes?.mode === "all" && (
        <ThemePicker
          start={themes.tab}
          background={background}
          overlay={overlay ?? null}
          canOverlay={!!onOverlay}
          onBackground={onBackground}
          onOverlay={(f) => onOverlay?.(f)}
          onClose={() => setThemes(null)}
        />
      )}
      {themes?.mode === "slide" && cur && (
        <ThemePicker
          start={themes.tab}
          forSlide={selected + 1}
          background={backgroundOf(cur, background)}
          overlay={cur.overlay === undefined ? overlay ?? null : cur.overlay || null}
          canOverlay
          onBackground={(f) => update(selected, { background: f ?? "" })}
          onOverlay={(f) => update(selected, { overlay: f ?? "" })}
          onClose={() => setThemes(null)}
        />
      )}
      {songs && (
        <SongPickerDialog
          onClose={() => setSongs(false)}
          onUse={(add) => {
            setSongs(false);
            insertSong(selected, add);
          }}
        />
      )}
      {verse && versions && books && versionCode && (
        <div className="mp-backdrop" role="dialog" aria-modal="true" aria-label="Add a Bible verse" {...backdrop(() => setVerse(false))}>
          <div className="mp live-add" onClick={(e) => e.stopPropagation()}>
            <div className="mp-head">
              <strong>Add a Bible verse</strong>
              <button className="text-btn" onClick={() => setVerse(false)} aria-label="Close">
                <CloseIcon size={14} />
              </button>
            </div>
            <VerseFinder
              versions={versions}
              books={books}
              versionCode={versionCode}
              numbers={verseNumbers ?? true}
              useLabel="Put it on the slides"
              onUse={(add) => {
                setVerse(false);
                insert(selected, add);
              }}
            />
          </div>
        </div>
      )}

      {picker && (
        <MediaPicker
          start={picker.for === "media" ? "link" : undefined}
          only={picker.for === "media" ? undefined : "picture"}
          onClose={() => setPicker(null)}
          onAdd={(media) => {
            const p = picker;
            setPicker(null);
            if (p.for === "background") onBackground(media[0]?.file ?? null);
            else if (p.for === "slide-background") update(p.at, { background: media[0]?.file ?? undefined });
            else if (p.for === "beside") update(p.at, { picture: media[0]?.file ?? undefined });
            else if (p.at === -1) update(selected, { image: media[0]?.file, title: cur?.title && cur.title !== "New slide" ? cur.title : media[0]?.title ?? "" });
            else insert(p.at, media.map(fromMedia));
          }}
        />
      )}
    </div>
  );
}
