import { useEffect, useMemo, useRef, useState } from "react";
import { api, BookInfo, SavedSermon, SermonStage, SermonUsage, Version } from "../api";
import {
  gather,
  isScripture,
  Material,
  newId,
  parseRef,
  passagesUsed,
  readingMinutes,
  SermonBody,
  sermonBlocks,
  SermonItem,
  SermonMeta,
  stripMarks,
  suggestFromOther,
  testamentBalance,
  wordsWritten,
} from "../sermon";
import { answerKey, groupGuide, listenerOutline, SlideSpec, slidesOf } from "../sermonOutputs";
import { buildDraft, Role, ROLES, TemplateDef, templateByKey, templateFromItems, TEMPLATES } from "../sermonTemplates";
import { plainText } from "./RichText";
import { PreachMode } from "./PreachMode";
import { SermonFind } from "./SermonFind";
import { MediaPicker } from "./MediaPicker";
import { MediaRef, pngOf, PngPicture } from "../sermonMedia";
import { placeFor, placeMaterial, rolesFor } from "../sermonLayout";
import { SermonOutline } from "./SermonOutline";
import { SermonPlanner, STAGES } from "./SermonPlanner";
import { SheetOutput } from "./SheetOutput";
import { SlidesEditor } from "./SlidesEditor";
import { ChevronLeftIcon } from "./icons";

interface Props {
  versionCode: string;
  versions: Version[];
  books: BookInfo[];
  chapterCounts: Record<string, number>;
  onJump: (book: string, chapter: number, verse: number) => void;
  onClose: () => void;
}

type Tab = "prepare" | "print" | "slides" | "saved";
type Printout = "sermon" | "outline" | "blanks" | "group";

interface Work {
  id: number;
  title: string;
  series: string;
  preachedOn: string;
  venue: string;
  stage: SermonStage;
  query: string;
  topics: string[];
  /** the template's key */
  shape: string;
  points: number;
  bigIdea: string;
  purpose: string;
  targetMinutes: number;
  blankLines: number;
  showLabels: boolean;
  showPrompts: boolean;
  gathered: Material[];
  items: SermonItem[];
  /** the slides as the preacher changed them (null: made from the sermon) */
  slides: SlideSpec[] | null;
  /** a photo behind every slide (a kept file) */
  slideBackground: string | null;
  tab: Tab;
}

const EMPTY: Work = {
  id: 0,
  title: "",
  series: "",
  preachedOn: "",
  venue: "",
  stage: "draft",
  query: "",
  topics: [],
  shape: "points",
  points: 3,
  bigIdea: "",
  purpose: "",
  targetMinutes: 30,
  blankLines: 4,
  showLabels: true,
  showPrompts: false,
  gathered: [],
  items: [],
  slides: null,
  slideBackground: null,
  tab: "prepare",
};

// The sermon being worked on is kept on this computer as it changes, so it survives leaving
// the builder, closing the app or a crash; a saved sermon is also saved as it changes.
const LOCAL_KEY = "sermon:work";
let draft: Work | null = null;

function restore(): Work {
  if (draft) return draft;
  try {
    const w = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "null") as Partial<Work> | null;
    if (w && typeof w === "object" && Array.isArray(w.items)) {
      const tab = (["prepare", "print", "slides", "saved"] as Tab[]).includes(w.tab as Tab) ? (w.tab as Tab) : "prepare";
      return { ...EMPTY, ...w, tab };
    }
  } catch {
    /* nothing kept, or unreadable */
  }
  return EMPTY;
}

const ADDABLE: Role[] = ["intro", "context", "scripture", "explain", "illustrate", "apply", "transition", "story", "conclusion", "response", "prayer"];
// the templates offered first; the rest are under "More templates"
const MAIN_TEMPLATES = ["points", "expository", "bigidea", "free"];

function bodyOf(w: Work): SermonBody {
  return {
    shape: w.shape,
    blankLines: w.blankLines,
    items: w.items,
    gathered: w.gathered,
    bigIdea: w.bigIdea,
    purpose: w.purpose,
    points: w.points,
    targetMinutes: w.targetMinutes,
    showLabels: w.showLabels,
    showPrompts: w.showPrompts,
    slides: w.slides,
    slideBackground: w.slideBackground,
  };
}

/** What is saved of a sermon, to tell whether it changed since it was last saved. */
const savedForm = (w: Work) => JSON.stringify([w.title, w.series, w.preachedOn, w.venue, w.stage, w.topics, bodyOf(w)]);

/** Gathers Scripture, commentary and more on a subject or a passage beside the sermon being
 * written: what is found on the left, the sermon -- laid out in a template, every section
 * with the question it answers -- on the right. Then a document, handouts, slides and a
 * full-screen view to preach from. It writes none of the sermon: the preaching is the
 * preacher's. */
export function SermonBuilder({ versionCode, versions, books, chapterCounts, onJump, onClose }: Props) {
  const [work, setWork] = useState<Work>(restore);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedSermon[]>([]);
  const [usage, setUsage] = useState<SermonUsage[]>([]);
  const [custom, setCustom] = useState<{ id: number; def: TemplateDef }[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [outline, setOutline] = useState(false);
  const [preaching, setPreaching] = useState(false);
  const [details, setDetails] = useState(false);
  const [printout, setPrintout] = useState<Printout>("sermon");
  const [handoutLines, setHandoutLines] = useState(3);
  const [withKey, setWithKey] = useState(true);
  const [page, setPage] = useState<"a4" | "a5">("a4");
  const [large, setLarge] = useState(false);
  const [templateName, setTemplateName] = useState<string | null>(null);
  // where the next thing added goes: after this row (null: at the end)
  const [target, setTarget] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  // the picture / video / link chooser, and where what it adds goes
  const [picker, setPicker] = useState<{ after: string | null } | null>(null);
  // the sermon's pictures as PNGs, for the printed and Word documents
  const [pictures, setPictures] = useState<Map<string, PngPicture>>(new Map());
  const run = useRef(0);
  const workRef = useRef(work);
  const undoStack = useRef<Work[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const lastSaved = useRef<string | null>(work.id ? savedForm(work) : null);

  workRef.current = work;
  useEffect(() => {
    draft = work;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(work));
      } catch {
        /* storage full or blocked: the sermon is still kept while the app is open */
      }
    }, 700);
    return () => window.clearTimeout(t);
  }, [work]);

  const set = (patch: Partial<Work>) => setWork((w) => ({ ...w, ...patch }));
  /** A change to the sermon's structure that Undo can take back. */
  const change = (f: (w: Work) => Work) => {
    undoStack.current.push(workRef.current);
    if (undoStack.current.length > 60) undoStack.current.shift();
    setUndoCount(undoStack.current.length);
    setWork(f);
  };
  function undo() {
    const prev = undoStack.current.pop();
    setUndoCount(undoStack.current.length);
    if (prev) setWork({ ...prev, tab: workRef.current.tab });
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey && !el?.closest("input, textarea, select")) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const loadSaved = () => {
    api.sermonList().then(setSaved).catch(() => undefined);
    api.sermonUsage().then(setUsage).catch(() => undefined);
  };
  const loadTemplates = () =>
    api
      .sermonTemplates()
      .then((list) =>
        setCustom(
          list.flatMap((t) => {
            try {
              return [{ id: t.id, def: { ...(JSON.parse(t.body) as TemplateDef), key: `custom:${t.name}`, name: t.name, custom: true } }];
            } catch {
              return [];
            }
          }),
        ),
      )
      .catch(() => undefined);
  useEffect(() => {
    loadSaved();
    loadTemplates();
  }, []);

  // a saved sermon is saved again a moment after each change
  useEffect(() => {
    if (!work.id || !work.title.trim()) return;
    const now = savedForm(work);
    if (now === lastSaved.current) return;
    const t = window.setTimeout(() => void save(true), 2500);
    return () => window.clearTimeout(t);
  }, [work]); // eslint-disable-line react-hooks/exhaustive-deps

  // the pictures in the sermon, ready for the document
  const pictureFiles = work.items.flatMap((i) => (i.type === "media" && i.media.kind === "image" && i.media.file ? [i.media.file] : [])).join("|");
  useEffect(() => {
    let live = true;
    const files = pictureFiles ? pictureFiles.split("|") : [];
    Promise.all(files.map((f) => pngOf(f).then((png) => [f, png] as const).catch(() => null))).then((got) => {
      if (live) setPictures(new Map(got.filter((x): x is readonly [string, PngPicture] => !!x)));
    });
    return () => {
      live = false;
    };
  }, [pictureFiles]);

  const customDefs = custom.map((c) => c.def);
  const template = templateByKey(work.shape, customDefs);
  const structured = work.items.some((i) => i.type === "heading" || i.type === "block");
  const chosen = useMemo(() => new Set(work.items.flatMap((i) => (i.type === "material" ? [i.material.key] : []))), [work.items]);
  const balance = useMemo(() => testamentBalance(work.items, books), [work.items, books]);
  const suggestion = useMemo(() => suggestFromOther(work.items, work.gathered, books), [work.items, work.gathered, books]);
  const minutes = useMemo(() => readingMinutes(work.items), [work.items]);
  const written = useMemo(() => wordsWritten(work.items), [work.items]);
  const meta: SermonMeta = {
    title: work.title,
    series: work.series,
    preachedOn: work.preachedOn,
    topics: work.query,
    blankLines: work.blankLines,
    bigIdea: work.bigIdea,
    purpose: work.purpose,
    venue: work.venue,
    showLabels: work.showLabels,
    showPrompts: work.showPrompts,
  };
  const blocks = useMemo(() => sermonBlocks(meta, work.items, versions, pictures), [work, versions, pictures]); // eslint-disable-line react-hooks/exhaustive-deps
  const preachBlocks = useMemo(() => sermonBlocks({ ...meta, blankLines: 0, showPrompts: false, forScreen: true }, work.items, versions, pictures), [work, versions, pictures]); // eslint-disable-line react-hooks/exhaustive-deps
  const printBlocks = useMemo(() => {
    if (printout === "outline") return listenerOutline(meta, work.items, false, handoutLines);
    if (printout === "blanks") return [...listenerOutline(meta, work.items, true, handoutLines), ...(withKey ? answerKey(meta, work.items) : [])];
    if (printout === "group") return groupGuide(meta, work.items);
    return blocks;
  }, [printout, handoutLines, withKey, work, blocks]); // eslint-disable-line react-hooks/exhaustive-deps
  const autoSlides = useMemo(() => slidesOf(meta, work.items, versionCode), [work, versionCode]); // eslint-disable-line react-hooks/exhaustive-deps
  const slides = work.slides ?? autoSlides;
  const [savingSlides, setSavingSlides] = useState(false);

  /** Other sermons that used this material (or, for Scripture, this passage). */
  const usedIn = (m: Material) =>
    usage.filter(
      (u) =>
        u.id !== work.id &&
        (u.keys.includes(m.key) ||
          (isScripture(m) &&
            u.passages
              .split("; ")
              .some((p) => p === m.title || (m.ref && p.startsWith(`${m.ref.book} ${m.ref.chapter}`) && !p.includes(":"))))),
    );
  const usedNote = (m: Material) => {
    const u = usedIn(m);
    if (!u.length) return null;
    const first = u[0];
    const when = first.preached_on ? ` on ${new Date(`${first.preached_on}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}` : "";
    return (
      <span className="used-before" title={u.map((x) => `${x.title}${x.preached_on ? ` (${x.preached_on})` : ""}`).join("\n")}>
        used in “{first.title}”{when}
        {u.length > 1 ? ` +${u.length - 1}` : ""}
      </span>
    );
  };

  function flash(msg: string) {
    setStatus(msg);
    window.setTimeout(() => setStatus((s) => (s === msg ? null : s)), 4000);
  }

  async function runGather(query: string) {
    const q = query.trim();
    if (!q) return;
    const id = ++run.current;
    setError(null);
    setBusy("Starting…");
    try {
      const g = await gather(q, versionCode, books, (s) => id === run.current && setBusy(`${s}…`));
      if (id !== run.current) return;
      const passageFirst = g.topics.length > 0 && g.topics.every((t) => parseRef(t, books));
      setWork((w) => {
        // keep what is already in the sermon; add the new finds to what was found before
        const known = new Set(w.gathered.map((m) => m.key));
        const title = w.title || g.topics.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(" and ");
        // a passage is preached through: the expository template, unless one was chosen
        const shape = passageFirst && !w.items.length && w.shape === "points" ? "expository" : w.shape;
        return { ...w, query: q, shape, topics: [...new Set([...w.topics, ...g.topics])], gathered: [...w.gathered, ...g.materials.filter((m) => !known.has(m.key))], title };
      });
      if (g.materials.length === 0) setError("Nothing was found for that. Try other words, a shorter phrase, or a passage like John 3.");
    } catch (e) {
      if (id === run.current) setError(String(e));
    } finally {
      if (id === run.current) setBusy(null);
    }
  }

  /** Adds material where the preacher is working (after the row last clicked), or takes it
   * out again. */
  function toggle(m: Material) {
    if (chosen.has(m.key)) {
      change((w) => ({ ...w, items: w.items.filter((i) => !(i.type === "material" && i.material.key === m.key)) }));
      return;
    }
    const row: SermonItem = { id: newId(), type: "material", material: m };
    change((w) => {
      // into the section that takes it: the one being worked in, or the next point's
      const at = placeMaterial(w.items, m, target);
      const items = [...w.items.slice(0, at), row, ...w.items.slice(at)];
      // something added while studying a passage is kept with what was found
      return { ...w, items, gathered: w.gathered.some((g) => g.key === m.key) ? w.gathered : [...w.gathered, m] };
    });
  }

  /** Puts pictures, videos, music, files or links in the sermon: after `after` (or where
   * the preacher is working, or at the end). */
  function addMedia(media: MediaRef[], after: string | null) {
    const rows: SermonItem[] = media.map((m) => ({ id: newId(), type: "media", media: m }));
    const focus = after ?? target;
    change((w) => {
      const at = rows.length ? placeFor(w.items, rolesFor(media[0].kind), focus) : w.items.length;
      return { ...w, items: [...w.items.slice(0, at), ...rows, ...w.items.slice(at)] };
    });
    setPicker(null);
  }
  const editMedia = (id: string, patch: Partial<MediaRef>) => setWork((w) => ({ ...w, items: w.items.map((i) => (i.id === id && i.type === "media" ? { ...i, media: { ...i.media, ...patch } } : i)) }));

  const targetLabel = (() => {
    const t = target ? work.items.find((i) => i.id === target) : null;
    if (!structured) return "to the sermon";
    if (!t) return "each into its place";
    if (t.type === "block") return `into “${t.label}”`;
    if (t.type === "heading") return `into “${stripMarks(t.text) || "the point"}”`;
    return "each into its place";
  })();

  /** Lays the sermon's material out in a template; what the preacher already wrote is kept
   * (in the section of the same name, or at the end). */
  function buildNow(shape = work.shape, points = work.points) {
    change((w) => {
      const t = templateByKey(shape, customDefs);
      const picked = w.items.flatMap((i) => (i.type === "material" ? [i.material] : []));
      const fresh = buildDraft(t, points, picked, w.topics);
      const writing = w.items.filter((i): i is Extract<SermonItem, { type: "block" | "note" }> => (i.type === "block" || i.type === "note") && !!i.text.trim());
      const used = new Set<string>();
      const items = fresh.map((i) => {
        if (i.type !== "block") return i;
        const same = writing.find((x) => x.type === "block" && x.label === i.label && !used.has(x.id));
        if (!same) return i;
        used.add(same.id);
        return { ...i, text: same.text };
      });
      const leftover = writing.filter((x) => !used.has(x.id));
      if (leftover.length) items.push({ id: newId(), type: "heading", text: "Your earlier writing" }, ...leftover.map((x) => ({ ...x, id: newId() })));
      return { ...w, shape, points, items };
    });
    setTarget(null);
  }

  const edit = (id: string, text: string) => setWork((w) => ({ ...w, items: w.items.map((i) => (i.id === id && (i.type === "heading" || i.type === "note" || i.type === "block") ? { ...i, text } : i)) }));
  const editLabel = (id: string, label: string) => setWork((w) => ({ ...w, items: w.items.map((i) => (i.id === id && i.type === "block" ? { ...i, label } : i)) }));
  const insertAfter = (index: number, item: SermonItem) => {
    change((w) => {
      const items = [...w.items];
      items.splice(index + 1, 0, item);
      return { ...w, items };
    });
    setTarget(item.id);
  };
  const sectionAfter = (index: number, role: Role) => {
    const inPoint = work.items.slice(0, index + 1).some((i) => i.type === "heading");
    insertAfter(index, { id: newId(), type: "block", role, label: ROLES[role].label, prompt: ROLES[role].prompt, text: "", level: inPoint ? 2 : 1 });
  };

  /** Wraps the selected words of a section in marks (**bold**, *italic*, [[blank]]), or
   * starts the selected lines with "- " for bullets. */
  function mark(id: string, kind: "bold" | "italic" | "blank" | "bullet") {
    const el = document.querySelector<HTMLTextAreaElement>(`textarea[data-id="${id}"]`);
    const item = work.items.find((i) => i.id === id);
    if (!el || !item || item.type === "material" || item.type === "media") return;
    const text = item.text;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    let next: string;
    if (kind === "bullet") {
      const start = text.lastIndexOf("\n", a - 1) + 1;
      const lines = text.slice(start, b).split("\n").map((l) => (l.startsWith("- ") ? l : `- ${l}`));
      next = text.slice(0, start) + lines.join("\n") + text.slice(b);
    } else {
      const [o, c] = kind === "bold" ? ["**", "**"] : kind === "italic" ? ["*", "*"] : ["[[", "]]"];
      const sel = text.slice(a, b) || (kind === "blank" ? "word" : "text");
      next = text.slice(0, a) + o + sel + c + text.slice(b);
    }
    edit(id, next);
    window.setTimeout(() => el.focus(), 0);
  }

  async function save(quiet = false) {
    const w = workRef.current;
    const title = w.title.trim() || w.topics[0] || "Untitled sermon";
    setError(null);
    setSaveState("saving");
    try {
      const id = await api.sermonSave({
        id: w.id,
        title,
        series: w.series,
        preached_on: w.preachedOn,
        topics: w.topics.join("; ") || w.query,
        passages: passagesUsed(w.items),
        body: JSON.stringify(bodyOf(w)),
        updated_at: "",
        stage: w.stage,
        venue: w.venue,
      });
      lastSaved.current = savedForm({ ...w, id, title });
      setWork((x) => ({ ...x, id, title: x.title.trim() ? x.title : title }));
      setSaveState("saved");
      if (!quiet) flash("Sermon saved. From now on it saves itself as you work.");
      loadSaved();
    } catch (e) {
      setSaveState("idle");
      setError(String(e));
    }
  }

  async function openSaved(id: number) {
    setError(null);
    try {
      const s = await api.sermonGet(id);
      if (!s) return;
      const b = JSON.parse(s.body || "{}") as Partial<SermonBody>;
      const items = b.items ?? [];
      const w: Work = {
        ...EMPTY,
        id: s.id,
        title: s.title,
        series: s.series,
        preachedOn: s.preached_on,
        venue: s.venue,
        stage: s.stage,
        query: s.topics,
        topics: s.topics
          .split(";")
          .map((t) => t.trim())
          .filter(Boolean),
        shape: b.shape ?? "points",
        points: b.points ?? 3,
        bigIdea: b.bigIdea ?? "",
        purpose: b.purpose ?? "",
        targetMinutes: b.targetMinutes ?? 30,
        blankLines: b.blankLines ?? 4,
        showLabels: b.showLabels ?? true,
        showPrompts: b.showPrompts ?? false,
        gathered: b.gathered ?? [],
        items,
        slides: b.slides ?? null,
        slideBackground: b.slideBackground ?? null,
        tab: "prepare",
      };
      lastSaved.current = savedForm(w);
      undoStack.current = [];
      setUndoCount(0);
      setTarget(null);
      setSaveState("saved");
      setWork(w);
    } catch (e) {
      setError(`That sermon couldn't be opened: ${e}`);
    }
  }

  function startNew() {
    run.current++;
    setBusy(null);
    setError(null);
    setTarget(null);
    undoStack.current.push(workRef.current);
    setUndoCount(undoStack.current.length);
    lastSaved.current = null;
    setSaveState("idle");
    setWork(EMPTY);
  }

  async function saveTemplate() {
    const name = (templateName ?? "").trim();
    if (!name) return;
    try {
      const def = templateFromItems(name, work.items);
      await api.sermonTemplateSave(name, JSON.stringify(def));
      setTemplateName(null);
      await loadTemplates();
      set({ shape: `custom:${name}` });
      flash(`Saved as your template “${name}”.`);
    } catch (e) {
      setError(String(e));
    }
  }

  async function deleteTemplate(key: string) {
    const c = custom.find((x) => x.def.key === key);
    if (!c) return;
    await api.sermonTemplateDelete(c.id).catch((e) => setError(String(e)));
    if (work.shape === key) set({ shape: "points" });
    loadTemplates();
  }

  async function saveSlides() {
    setSavingSlides(true);
    try {
      // a kept file a slide opens: its full path on this computer
      const ready = await Promise.all(
        slides.map(async (s) => ({
          ...s,
          background: work.slideBackground ?? undefined,
          link: s.link?.startsWith("media:") ? await api.sermonMediaPath(s.link.slice(6)).catch(() => undefined) : s.link,
        })),
      );
      flash(`Saved to ${await api.saveSermonSlides(work.title.trim() || "Sermon", ready)}`);
    } catch (e) {
      setError(`Couldn't save the slides: ${e}`);
    } finally {
      setSavingSlides(false);
    }
  }

  const preview = (m: Material) => {
    const text = plainText(m.text).replace(/⟪\d+⟫/g, "");
    const isOpen = open.has(m.key);
    const long = text.length > 220;
    return (
      <>
        <span className="sermon-text">{isOpen || !long ? text : `${text.slice(0, 200).trimEnd()}…`}</span>
        {long && (
          <button
            className="link-btn sermon-more"
            onClick={() =>
              setOpen((s) => {
                const n = new Set(s);
                if (n.has(m.key)) n.delete(m.key);
                else n.add(m.key);
                return n;
              })
            }
          >
            {isOpen ? "Show less" : "Show all"}
          </button>
        )}
      </>
    );
  };

  const seriesNames = [...new Set(saved.map((s) => s.series).filter(Boolean))];
  const nav = work.items.filter((i) => i.type === "heading" || (i.type === "block" && i.level === 1));
  const total = minutes + Math.round(written / 130);
  const TABS: { key: Tab; label: string }[] = [
    { key: "prepare", label: "Prepare" },
    { key: "print", label: "Print & handouts" },
    { key: "slides", label: "Slides" },
    { key: "saved", label: `My sermons${saved.length ? ` (${saved.length})` : ""}` },
  ];
  const others = TEMPLATES.filter((t) => !MAIN_TEMPLATES.includes(t.key));

  // ---------------------------------------------------------------- the sermon (right side)
  const templateChooser = (
    <div className="sb-templates">
      <p>
        <strong>How should it be laid out?</strong>{" "}
        <span className="muted">
          Choose a template: each part gets its question to answer, and what you add is put in place. You can change it later.
        </span>
      </p>
      <div className="sb-template-cards">
        {MAIN_TEMPLATES.map((k) => {
          const t = templateByKey(k, customDefs);
          return (
            <button key={k} className={"sb-template-card" + (work.shape === k ? " on" : "")} onClick={() => buildNow(k)}>
              <strong>{t.name}</strong>
              <span>{t.about}</span>
            </button>
          );
        })}
      </div>
      <label className="sb-more-templates">
        <span className="muted">More templates</span>
        <select value="" onChange={(e) => e.target.value && buildNow(e.target.value)}>
          <option value="">Choose…</option>
          {others.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
          {customDefs.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name} (yours)
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  const sermonSide = (
    <section className="sb-sermon" aria-label="Your sermon">
      <div className="sb-sermon-top">
        <div className="sermon-idea">
          <label>
            <span className="muted">The big idea — the sermon in one sentence</span>
            <input value={work.bigIdea} onChange={(e) => set({ bigIdea: e.target.value })} placeholder="e.g. God's love does not wait for us to deserve it." />
          </label>
          <label>
            <span className="muted">Purpose — what should they know, feel and do?</span>
            <input value={work.purpose} onChange={(e) => set({ purpose: e.target.value })} placeholder="Know… Feel… Do…" />
          </label>
        </div>
        {structured && (
          <div className="sb-sermon-bar">
            <label className="sb-inline">
              <span className="muted">Template</span>
              <select value={work.shape} onChange={(e) => buildNow(e.target.value)} title="Lay the sermon out again in another template (what you wrote is kept)">
                {TEMPLATES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
                {customDefs.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name} (yours)
                  </option>
                ))}
              </select>
            </label>
            {template.point && (
              <label className="sb-inline">
                <span className="muted">{template.point.label.replace(" {n}", "")}s</span>
                <select value={work.points} onChange={(e) => buildNow(work.shape, Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="sb-facts" title="Scripture read aloud plus what you've written, at an unhurried pace">
              {written} words · about <strong className={total > work.targetMinutes && work.targetMinutes > 0 ? "over-time" : undefined}>{total}</strong> of {work.targetMinutes} min
            </span>
            <span className="view-toggle">
              <button className={!outline ? "note-tag on" : "note-tag"} onClick={() => setOutline(false)}>
                Full
              </button>
              <button className={outline ? "note-tag on" : "note-tag"} onClick={() => setOutline(true)}>
                Outline
              </button>
            </span>
          </div>
        )}
        {structured && nav.length > 2 && (
          <nav className="sb-nav" aria-label="Sections">
            {nav.map((i) => (
              <button key={i.id} className="sf-chip" onClick={() => document.getElementById(`row-${i.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" })}>
                {i.type === "heading" ? stripMarks(i.text) : i.type === "block" ? i.label : ""}
              </button>
            ))}
          </nav>
        )}
      </div>
      <div className="sb-sermon-scroll">
        {!structured && templateChooser}
        {!structured && work.items.length > 0 && <h4 className="section-label">Added so far — they'll be put in place when you choose a template</h4>}
        {suggestion && (
          <p className="sermon-suggest">
            All the Scripture is from the {balance.ot === 0 ? "New" : "Old"} Testament. From the {balance.ot === 0 ? "Old" : "New"} Testament: <strong>{suggestion.title}</strong> — “
            {plainText(suggestion.text).slice(0, 120)}
            {suggestion.text.length > 120 ? "…" : ""}”{" "}
            <button className="link-btn" onClick={() => toggle(suggestion)}>
              Add it
            </button>
          </p>
        )}
        <SermonOutline
          items={work.items}
          outline={outline}
          target={target}
          onTarget={setTarget}
          onChange={(f) => change((w) => ({ ...w, items: f(w.items) }))}
          onText={edit}
          onLabel={editLabel}
          onMedia={editMedia}
          onMark={mark}
          renderMaterial={preview}
          onPickMedia={(slot) => setPicker({ after: slot })}
        />
        {work.items.length > 0 && (
          <div className="note-editor-actions">
            <select
              className="add-section sb-add"
              value=""
              aria-label="Add to the end of the sermon"
              onChange={(e) => {
                const v = e.target.value;
                e.target.value = "";
                if (v === "point") insertAfter(work.items.length - 1, { id: newId(), type: "heading", text: "New point" });
                else if (v === "note") insertAfter(work.items.length - 1, { id: newId(), type: "note", text: "" });
                else if (v === "media") setPicker({ after: null });
                else if (v) sectionAfter(work.items.length - 1, v as Role);
              }}
            >
              <option value="">Add to the end ▾</option>
              <option value="point">A new point</option>
              <option value="note">A note</option>
              <option value="media">A picture, video, music or link</option>
              <optgroup label="A section">
                {ADDABLE.map((r) => (
                  <option key={r} value={r}>
                    {ROLES[r].label}
                  </option>
                ))}
              </optgroup>
            </select>
            {structured &&
              (templateName === null ? (
                <button className="text-btn" onClick={() => setTemplateName("")} title="Save this layout of sections to start other sermons from">
                  Save as my template
                </button>
              ) : (
                <span className="template-save">
                  <input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Template name" autoFocus onKeyDown={(e) => e.key === "Enter" && saveTemplate()} />
                  <button className="pill-btn" onClick={saveTemplate} disabled={!templateName.trim()}>
                    Save
                  </button>
                  <button className="text-btn" onClick={() => setTemplateName(null)}>
                    Cancel
                  </button>
                </span>
              ))}
            {template.custom && (
              <button className="text-btn danger" onClick={() => deleteTemplate(template.key)} title="Delete this template of yours (sermons made with it are kept)">
                Delete template “{template.name}”
              </button>
            )}
          </div>
        )}
        {structured && (
          <p className="search-hint">
            Press <strong>+</strong> on the left and it goes into its place — Scripture to Scripture, commentary to Explain, stories to Illustrate — or click a section
            first to put it there. Drag a point by its handle, or anything in it to another section. In your writing: **bold**, *italic*, “- ” for a bullet, [[words]] to leave
            blank on the fill-in handout.
          </p>
        )}
      </div>
    </section>
  );

  // ---------------------------------------------------------------- the page
  return (
    <article className={"sermon-builder sb" + (work.tab === "prepare" ? " sb-preparing" : "")}>
      <header className="sb-head">
        <input className="sb-title" value={work.title} onChange={(e) => set({ title: e.target.value })} placeholder="Sermon title" aria-label="Sermon title" />
        <input type="date" value={work.preachedOn} onChange={(e) => set({ preachedOn: e.target.value })} aria-label="Date to preach it" title="Date to preach it" />
        <button className="text-btn" onClick={() => setDetails((d) => !d)} aria-expanded={details}>
          {details ? "Fewer details" : "More details"}
        </button>
        <span className="sb-save">
          {work.id ? (
            <span className="muted">{saveState === "saving" ? "Saving…" : "Saved"}</span>
          ) : (
            <button className="pill-btn" onClick={() => save()} disabled={work.items.length === 0 && work.gathered.length === 0 && !work.title.trim()} title="Save it to My sermons; after that it saves itself as you work">
              Save
            </button>
          )}
        </span>
        <button className="text-btn" onClick={undo} disabled={undoCount === 0} title="Undo the last change (Ctrl+Z)">
          ↶ Undo
        </button>
        <button className="outline-btn" onClick={() => setPreaching(true)} disabled={work.items.length === 0} title="Full screen, large text, with a clock — to preach from">
          Preach
        </button>
        <button className="text-btn" onClick={startNew} title="Start a new sermon (Undo brings this one back)">
          New
        </button>
        <button className="text-btn sb-back" onClick={onClose} title="Back to the Bible (your work here is kept)">
          <ChevronLeftIcon size={14} /> Bible
        </button>
      </header>
      {details && (
        <div className="sermon-meta sb-details">
          <label>
            <span className="muted">Series</span>
            <input value={work.series} onChange={(e) => set({ series: e.target.value })} placeholder="(none)" list="sermon-series" />
            <datalist id="sermon-series">
              {seriesNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </label>
          <label>
            <span className="muted">Where</span>
            <input value={work.venue} onChange={(e) => set({ venue: e.target.value })} placeholder="(optional)" />
          </label>
          <label>
            <span className="muted">Stage</span>
            <select value={work.stage} onChange={(e) => set({ stage: e.target.value as SermonStage })}>
              {STAGES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="muted">Length (minutes)</span>
            <input type="number" min={0} max={120} value={work.targetMinutes} onChange={(e) => set({ targetMinutes: Number(e.target.value) || 0 })} />
          </label>
        </div>
      )}
      <nav className="mode-toggle sb-tabs" role="tablist" aria-label="Sermon builder">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={work.tab === t.key} className={work.tab === t.key ? "active" : ""} onClick={() => set({ tab: t.key })}>
            {t.label}
          </button>
        ))}
        {status && <span className="study-status sb-status">{status}</span>}
      </nav>
      {error && (
        <p className="status-error">
          {error}{" "}
          <button className="link-btn" onClick={() => setError(null)}>
            Dismiss
          </button>
        </p>
      )}

      {work.tab === "prepare" && (
        <div className="sb-prep">
          <section className="sb-find" aria-label="Find material">
            <SermonFind
              query={work.query}
              onQuery={(q) => set({ query: q })}
              onGather={runGather}
              busy={busy}
              gathered={work.gathered}
              topics={work.topics}
              chosen={chosen}
              onToggle={toggle}
              usedNote={usedNote}
              target={targetLabel}
              onTargetEnd={() => setTarget(null)}
              books={books}
              versionCode={versionCode}
              onJump={onJump}
            />
          </section>
          {sermonSide}
        </div>
      )}

      {work.tab === "print" && (
        <div className="sb-page">
          <div className="mode-toggle" role="tablist" aria-label="What to print">
            {(
              [
                ["sermon", "The sermon"],
                ["outline", "Listener's outline"],
                ["blanks", "Fill in the blanks"],
                ["group", "Small-group guide"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={printout === k} className={printout === k ? "active" : ""} onClick={() => setPrintout(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="sermon-shape">
            {printout === "sermon" && (
              <>
                <label>
                  <span className="muted">Blank lines for handwriting</span>
                  <select value={work.blankLines} onChange={(e) => set({ blankLines: Number(e.target.value) })}>
                    {[0, 2, 4, 6, 8, 12].map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? "None" : n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" checked={work.showLabels} onChange={(e) => set({ showLabels: e.target.checked })} /> Section names
                </label>
                <label className="check">
                  <input type="checkbox" checked={work.showPrompts} onChange={(e) => set({ showPrompts: e.target.checked })} /> Questions of empty sections
                </label>
              </>
            )}
            {(printout === "outline" || printout === "blanks") && (
              <label>
                <span className="muted">Lines under each point</span>
                <select value={handoutLines} onChange={(e) => setHandoutLines(Number(e.target.value))}>
                  {[0, 2, 3, 4, 6].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? "None" : n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {printout === "blanks" && (
              <label className="check">
                <input type="checkbox" checked={withKey} onChange={(e) => setWithKey(e.target.checked)} /> Answers at the end
              </label>
            )}
            <label>
              <span className="muted">Paper</span>
              <select value={page} onChange={(e) => setPage(e.target.value as "a4" | "a5")}>
                <option value="a4">A4</option>
                <option value="a5">A5 (half page)</option>
              </select>
            </label>
            <label className="check">
              <input type="checkbox" checked={large} onChange={(e) => setLarge(e.target.checked)} /> Large print
            </label>
          </div>
          {printout === "blanks" && <p className="search-hint">Words you mark with [ _ ] in the big idea, a point's title or the first line of an Apply section are left blank.</p>}
          {printout === "group" && <p className="search-hint">Questions to observe, understand, apply and pray, with your passages, big idea and points put in.</p>}
          {work.items.length === 0 ? (
            <p className="muted">Add something to the sermon first.</p>
          ) : (
            <SheetOutput
              blocks={printBlocks}
              title={`${work.title.trim() || "Sermon"}${printout === "sermon" ? "" : printout === "group" ? " — group guide" : " — notes"}`}
              building={false}
              printOptions={{ page, large }}
            />
          )}
        </div>
      )}

      {work.tab === "slides" && (
        <div className="sb-page sb-slides">
          <SlidesEditor
            slides={slides}
            edited={work.slides !== null}
            background={work.slideBackground}
            onChange={(s) => change((w) => ({ ...w, slides: s }))}
            onBackground={(f) => change((w) => ({ ...w, slideBackground: f }))}
            onSave={saveSlides}
            saving={savingSlides}
          />
          <p className="search-hint">
            Saved as a PowerPoint file in Documents\Bible Concordance — it opens in PowerPoint, ProPresenter, Keynote, Google Slides and LibreOffice.
          </p>
        </div>
      )}

      {work.tab === "saved" && (
        <div className="sb-page">
          <SermonPlanner
            saved={saved}
            books={books}
            chapterCounts={chapterCounts}
            currentId={work.id}
            onOpen={openSaved}
            onChanged={loadSaved}
            onPrepare={async (id, topics) => {
              await openSaved(id);
              void runGather(topics);
            }}
          />
        </div>
      )}

      {picker && <MediaPicker onAdd={(m) => addMedia(m, picker.after)} onClose={() => setPicker(null)} />}
      {preaching && <PreachMode blocks={preachBlocks} targetMinutes={work.targetMinutes} onClose={() => setPreaching(false)} />}
    </article>
  );
}

