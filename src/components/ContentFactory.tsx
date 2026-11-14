// Content Factory: pictures, picture sets and short videos made from the Bible text the app already holds, with the look
// chosen for you (six to pick from), everything adjustable, the person's name in the bottom-left corner, soft music for
// videos, and Save, Copy and the sites to post on. It never posts by itself and needs no account.
// The engine is in src/factory (drawing, looks, music, video); this is only the screen.

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { emit } from "@tauri-apps/api/event";
import { api, BookInfo, Version } from "../api";
import { copyText } from "../clipboard";
import { occasionOn, todayNumber, type OccasionId } from "../themes/themeCalendar";
import { buildCaption, CardText, fileStem, FREE_VERSIONS, loadPassage, parsePassage, Passage, promisePassage, SOUTHERN_CROSS, todayPassage, weekPassages } from "../factory/content";
import { FREE_TRACKS } from "../factory/freeMusic";
import { remember, todayDay, upcomingOccasion, usedKeys, weekPlan, type HistoryEntry } from "../factory/autopilot";
import { giveBack, loadHistory, loadPosts, removePost, savePosts, saveHistory, setStatus, tidy, type Post, type PostStatus } from "../factory/inbox";
import { buildDaily, buildFact, buildMemory, buildSeason, buildStory, buildTopic, type Env } from "../factory/recipes";
import { seasonName } from "../factory/seasonVerses";
import { type Box, canvasToBlob, Ctx2D, drawCard, type DrawReport, PictureBank, renderCard } from "../factory/draw";
import { lookFromPalette, makeLooks, PALETTES, PictureChoice } from "../factory/looks";
import { decodeMusicFile, mixAudio, MOODS, moodForOccasion, MoodId, playBuffer, renderMusic, segmentOf, withLevel, type VoiceClip } from "../factory/music";
import { loadReadPrefs } from "../readAloud";
import { defaultName, DOCKS, footerOf, loadSettings, saveSettings, TOOL_IDS, type Dock, type FactorySettings, type ToolId } from "../factory/store";
import { Card, clamp, Credit, FONTS, LAYOUTS, Look, NO_NAME, type Place, SIZES, SizeId, sizeById } from "../factory/types";
import { Motion, makeAudioFile, makeVideo, Quality, videoSize, videoSupported } from "../factory/video";
import { AdvancedBox, BandPanel, NamesBox, Popover, Segmented, shortSize, SITES, Thumb } from "./FactoryParts";
import { FactoryLibrary } from "./FactoryLibrary";
import { FactoryPhotos } from "./FactoryPhotos";
import { PlaceOverlay, type PlaceTarget } from "./FactoryPlace";
import { FactoryPalette, type PaletteTarget } from "./FactoryPalette";
import { lighten, pictureColours, regionStats, suggestReadable } from "../factory/readable";
import { DockGlyph, Icon, type IconName } from "./FactoryIcons";
import "./factory.css";

interface Props {
  books: BookInfo[];
  versions: Version[];
  chapterCounts: Record<string, number>;
  onClose: () => void;
}

const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const textBytes = (s: string) => new TextEncoder().encode(s);
const uid = () => Math.random().toString(36).slice(2, 10);

/** a nature photo's credit, if its licence asks for one */
function creditFor(licence: string, title: string, author: string): string | undefined {
  if (/cc0|public domain|^pd\b|unsplash license/i.test(licence)) return undefined;
  return `Photo: ${title}${author ? ` by ${author}` : ""} (${licence})`.slice(0, 160);
}

/** twelve looks for a set (two rounds of the six), so even a week of seven verses has no two alike */
const lookPool = (seed: number, opts: Parameters<typeof makeLooks>[1]): Look[] => [...makeLooks(seed, opts), ...makeLooks(seed + 1000, opts)];

const creditText = (card: Card): string | null => (card.look.background.kind === "image" && card.look.background.credit ? card.look.background.credit : null);
const creditOf = (card: Card): Credit | null => {
  const t = creditText(card);
  return t ? { text: t } : null;
};

export function ContentFactory({ books, versions, chapterCounts, onClose }: Props) {
  const [settings, setSettings] = useState(loadSettings);
  const update = useCallback((s: typeof settings) => {
    setSettings(s);
    saveSettings(s);
  }, []);
  const footer = useMemo(() => footerOf(settings), [settings]);
  /** changes some settings without needing the latest copy (for the studio's own preferences, which change while other things happen) */
  const patchSettings = useCallback((patch: Partial<FactorySettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);
  const [askName, setAskName] = useState("");
  const rootRef = useRef<HTMLElement>(null);
  const [rootWidth, setRootWidth] = useState(1200);
  const [savedTick, setSavedTick] = useState(0);

  // what to make
  const [input, setInput] = useState("");
  const [version, setVersion] = useState(settings.version);
  const [cards, setCards] = useState<Card[]>([]);
  const [current, setCurrent] = useState(0);
  const [label, setLabel] = useState("");
  const [lookSeed, setLookSeed] = useState(1);
  const [sizeIds, setSizeIds] = useState<SizeId[]>(settings.sizes);
  const [previewSize, setPreviewSize] = useState<SizeId>(settings.sizes[0] ?? "square");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 9000);
    return () => clearTimeout(t);
  }, [note]);
  const [saved, setSaved] = useState<{ label: string; path: string }[]>([]);
  const [captionOverride, setCaptionOverride] = useState<string | null>(null);
  // in a set of several pictures: do changes go to this picture only, or to all of them
  const [scope, setScope] = useState<"one" | "all">("one");

  // Ready to post: what the factory made, and what it remembers having made
  const [posts, setPosts] = useState<Post[]>(() => tidy(loadPosts(), todayDay()));
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const saveInbox = (next: Post[], hist: HistoryEntry[] = history) => {
    setPosts(next);
    savePosts(next);
    setHistory(hist);
    saveHistory(hist);
  };

  // pictures behind the words (nature photos, the reader's own)
  const bankRef = useRef<PictureBank>(new Map());
  const [rev, setRev] = useState(0);
  const [nature, setNature] = useState<{ id: string; theme: string; title: string; author: string; licence: string }[] | null>(null);
  const [pictures, setPictures] = useState<PictureChoice[]>([]);
  const [natureBusy, setNatureBusy] = useState(false);
  // the Christian pictures: a pack of their own
  const [christian, setChristian] = useState<{ id: string; theme: string; title: string; author: string; licence: string }[] | null>(null);
  const [christianInfo, setChristianInfo] = useState<[number, number]>([55, 12]);
  const [christianBusy, setChristianBusy] = useState(false);
  // how many photos the latest pack holds, and its size
  const [latest, setLatest] = useState<[number, number]>([300, 25]);

  // video and music
  const [canVideo, setCanVideo] = useState<boolean | null>(null);
  const [spc, setSpc] = useState(6);
  const [motion, setMotion] = useState<Motion>("zoom");
  const [quality, setQuality] = useState<Quality>("best");
  const [videoSizeId, setVideoSizeId] = useState<SizeId>("story");
  const [musicMode, setMusicMode] = useState<"maker" | "own" | "none">("maker");
  const occasion = useMemo(() => occasionOn(todayNumber())?.id ?? null, []);
  const [mood, setMood] = useState<MoodId>(moodForOccasion(occasion));
  const [musicSeed, setMusicSeed] = useState(1);
  // the chosen piece of music from the library or a file: its sound, its credit, where in it the video starts
  const [own, setOwn] = useState<{ name: string; buffer: AudioBuffer; credit: string; link: string; id?: string } | null>(null);
  const [startAt, setStartAt] = useState(0);
  // the natural voice reading each picture aloud
  const [voiceOk, setVoiceOk] = useState<boolean | null>(null);
  const [narrate, setNarrate] = useState(false);
  const [readRef, setReadRef] = useState(true);
  const [library, setLibrary] = useState<{ id: string; title: string; artist: string; credit: string; link: string; group: string }[]>([]);
  const [libBusy, setLibBusy] = useState<string | null>(null);
  const [listening, setListening] = useState<null | (() => void)>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const musicCache = useRef<{ key: string; buffer: AudioBuffer } | null>(null);

  const size = sizeById(previewSize);
  const card = cards[current] ?? null;
  const deferredCard = useDeferredValue(card);
  const nothingChosen = sizeIds.length === 0;

  // ---------------------------------------------------------------- start up
  useEffect(() => {
    void videoSupported().then(setCanVideo);
    api.voiceStatus().then((s) => setVoiceOk(s.available)).catch(() => setVoiceOk(false));
    api.factoryLibraryList().then(setLibrary).catch(() => setLibrary([]));
    api.sermonBackgroundsInfo().then(setLatest).catch(() => undefined);
    api.sermonBackgrounds("christian").then(setChristian).catch(() => setChristian([]));
    api.sermonBackgroundsInfo("christian").then(setChristianInfo).catch(() => undefined);
    api
      .sermonBackgrounds()
      .then(async (list) => {
        setNature(list);
        // a few of the nature photos go into the looks offered
        const shuffled = [...list].sort(() => Math.random() - 0.5).slice(0, 4);
        const picks: PictureChoice[] = [];
        for (const b of shuffled) {
          try {
            const buf = await api.sermonBackgroundBytes(b.id, true);
            bankRef.current.set(`nature:${b.id}`, await createImageBitmap(new Blob([buf])));
            picks.push({ key: `nature:${b.id}`, credit: creditFor(b.licence, b.title, b.author) });
          } catch {
            /* a photo that is missing is left out */
          }
        }
        setPictures(picks);
        setRev((r) => r + 1);
      })
      .catch(() => setNature([]));
    return () => abortRef.current?.abort();
  }, []);

  // the pictures of the header and footer bands go into the picture bank under their own keys
  useEffect(() => {
    let live = true;
    const load = (key: string, data: string) => {
      if (!data) {
        bankRef.current.delete(key);
        setRev((r) => r + 1);
        return;
      }
      fetch(data)
        .then((r) => r.blob())
        .then((b) => createImageBitmap(b))
        .then((bmp) => {
          if (!live) return;
          bankRef.current.set(key, bmp);
          setRev((r) => r + 1);
        })
        .catch(() => undefined);
    };
    load("band:header", settings.headerImage);
    load("band:footer", settings.footerImage);
    return () => {
      live = false;
    };
  }, [settings.headerImage, settings.footerImage]);

  const freeVersions = useMemo(() => versions.filter((v) => FREE_VERSIONS.includes(v.code)), [versions]);
  const looks = useMemo(() => makeLooks(lookSeed, { occasion, pictures }), [lookSeed, occasion, pictures]);
  // the first picture drawn in each of the six looks (kept as the same objects until the picture or the looks change)
  const firstCard = deferredCard;
  const lookCards = useMemo(() => (firstCard ? looks.map((l) => ({ ...firstCard, look: l })) : []), [firstCard, looks]);

  // ---------------------------------------------------------------- making
  const make = useCallback(
    async (passages: Passage[], name: string) => {
      setError(null);
      setNote(null);
      setBusy("Getting the words…");
      try {
        const texts: CardText[] = [];
        for (const p of passages) texts.push(...(await loadPassage(p, version)));
        const lks = lookPool(lookSeed, { occasion, pictures });
        const vary = settings.varyLooks && texts.length > 1;
        setCards(texts.map((t, i) => ({ id: uid(), text: t.text, reference: t.reference, version, look: vary ? lks[i % lks.length] : lks[0], fontScale: 1, showReference: true, showVersion: true, postedBy: "" })));
        setScope(vary ? "one" : "all");
        setCurrent(0);
        setLabel(name);
        setCaptionOverride(null);
        setSaved([]);
        setSpc(texts.length === 1 ? 10 : 5);
        update({ ...settings, version });
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e));
      } finally {
        setBusy(null);
      }
    },
    [version, lookSeed, occasion, pictures, settings, update],
  );

  const makeFromInput = () => {
    const p = parsePassage(input, books, chapterCounts);
    if (!p) {
      setError("Type a verse the way you would in the search box, like John 3:16 or Psalm 23:1-3.");
      return;
    }
    void make([p], `${p.book} ${p.chapter}-${p.verseStart}${p.verseEnd > p.verseStart ? `-${p.verseEnd}` : ""}`);
  };

  // ---------------------------------------------------------------- Ready to post
  const suggestion = useMemo(() => {
    const w = upcomingOccasion(todayDay(), 14);
    return w ? { id: w.id as OccasionId, name: seasonName(w.id as OccasionId), soon: w.start > todayDay() } : null;
  }, []);

  const makeEnv = (hist: HistoryEntry[]): Env => ({ books, counts: chapterCounts, version, today: todayDay(), used: usedKeys(hist, todayDay()), seed: Math.floor(Math.random() * 1_000_000), footer });

  /** makes posts one after another, so that what one uses the next does not use again */
  const makePosts = async (jobs: { recipe: string; day: number; occasion?: OccasionId }[], doneNote: string) => {
    setError(null);
    setNote(null);
    let hist = history;
    const made: Post[] = [];
    try {
      let n = 0;
      for (const j of jobs) {
        setBusy(`Making post ${++n} of ${jobs.length}…`);
        const env = makeEnv(hist);
        const p =
          j.recipe === "daily" ? await buildDaily(env, j.day, n)
          : j.recipe === "season" ? await buildSeason(env, j.occasion ?? "advent", j.day)
          : j.recipe === "topic" ? await buildTopic(env, j.day)
          : j.recipe === "story" ? await buildStory(env, j.day)
          : j.recipe === "memory" ? await buildMemory(env, j.day)
          : await buildFact(env, j.day);
        if (p) {
          made.push(p);
          hist = remember(hist, p.keys, todayDay());
        }
      }
      if (made.length === 0) setNote("There was nothing new to make. Everything has been made lately.");
      else {
        saveInbox([...posts, ...made], hist);
        setNote(`${doneNote} ${made.length} ${made.length === 1 ? "post is" : "posts are"} in Ready to post.`);
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  };

  const makeWeek = () => {
    const today = todayDay();
    const plan = weekPlan(settings.recipes, today, !!suggestion);
    void makePosts(plan.map((p) => ({ ...p, occasion: suggestion?.id })), "Your week is made:");
  };

  const makeSeries = (id: OccasionId) => void makePosts([{ recipe: "season", day: todayDay(), occasion: id }], `${seasonName(id)}:`);

  /** the pictures of a post, each in a look made from the post's seed (a look that does not depend on which pictures are loaded): a different one on each, or the same on all */
  const cardsOfPost = (p: Post): Card[] => {
    const lks = lookPool(p.lookSeed, { occasion });
    const vary = settings.varyLooks && p.cards.length > 1;
    return p.cards.map((c, i) => ({ id: `${p.id}-${i}`, text: c.text, reference: c.reference, version: c.version, look: vary ? lks[i % lks.length] : lks[0], fontScale: 1, showReference: true, showVersion: true, postedBy: "" }));
  };

  const openPost = (p: Post) => {
    setError(null);
    setNote(null);
    setCards(cardsOfPost(p));
    setScope(settings.varyLooks && p.cards.length > 1 ? "one" : "all");
    setCurrent(0);
    setLabel(p.title);
    setCaptionOverride(p.caption);
    setSaved([]);
    setSpc(p.cards.length === 1 ? 10 : 5);
    if (p.status === "new") saveInbox(setStatus(posts, p.id, "approved"));
    patchSettings({ libOpen: false });
  };

  const changeStatus = (p: Post, s: PostStatus) => {
    // a skipped post gives back what it used, so it can come round again; one put back to waiting uses it again
    const hist = s === "skipped" ? giveBack(history, p) : s === "new" ? remember(history, p.keys, todayDay()) : history;
    saveInbox(setStatus(posts, p.id, s), hist);
  };

  const dropPost = (p: Post) => saveInbox(removePost(posts, p.id), giveBack(history, p));

  // ---------------------------------------------------------------- changing a card or its look
  const hit = (i: number) => scope === "all" || cards.length < 2 || i === current;
  const patchCards = (patch: Partial<Card>) => setCards((cs) => cs.map((c, i) => (hit(i) ? { ...c, ...patch } : c)));
  const patchLook = (patch: Partial<Look>) => setCards((cs) => cs.map((c, i) => (hit(i) ? { ...c, look: { ...c.look, ...patch } } : c)));
  /** a change to the photo behind the words (darkening, softening) of each picture that is changed: each keeps its own photo */
  const patchBackground = (patch: { darken?: number; blur?: number }) =>
    setCards((cs) => cs.map((c, i) => (hit(i) && c.look.background.kind === "image" ? { ...c, look: { ...c.look, background: { ...c.look.background, ...patch } } } : c)));
  /** a change to the picture on show only (its name, whether it shows the header) */
  const patchThis = (patch: Partial<Card>) => setCards((cs) => cs.map((c, i) => (i === current ? { ...c, ...patch } : c)));

  // ---- placing the words and the logos on the picture (drag on the picture; the pictures it goes to follow "Changes below go to")
  const setTextShift = (shift: { x: number; y: number } | undefined) => setCards((cs) => cs.map((c, i) => (hit(i) ? { ...c, textShift: shift } : c)));
  const setLogoAt = (which: "header" | "footer", place: Place | undefined) =>
    setCards((cs) =>
      cs.map((c, i) => {
        if (!hit(i)) return c;
        const logoAt = { ...c.logoAt, [which]: place };
        if (!logoAt.header && !logoAt.footer) return { ...c, logoAt: undefined };
        return { ...c, logoAt };
      }),
    );
  const setTextAt = (which: "header" | "footer", place: Place | undefined) =>
    setCards((cs) =>
      cs.map((c, i) => {
        if (!hit(i)) return c;
        const textAt = { ...c.textAt, [which]: place };
        if (!textAt.header && !textAt.footer) return { ...c, textAt: undefined };
        return { ...c, textAt };
      }),
    );
  /** the size of the words' letters, from dragging a corner (1 is the size that fits) */
  const setFontScale = (scale: number) => setCards((cs) => cs.map((c, i) => (hit(i) ? { ...c, fontScale: scale } : c)));

  /** what the Header and Footer tools show and do about the logo's and the text's place: the picture's own places, the saved default, and the buttons */
  const placeInfo = (which: "header" | "footer") => {
    if (!card) return undefined;
    const band = which === "header" ? settings.header : settings.footerBand;
    const bandKey = which === "header" ? "header" : "footerBand";
    const ownLogo = card.logoAt?.[which];
    const ownText = card.textAt?.[which];
    const clearOwn = (all: boolean) =>
      setCards((cs) =>
        cs.map((c, i) => {
          if (!all && !hit(i)) return c;
          if (!c.logoAt?.[which] && !c.textAt?.[which]) return c;
          const logoAt = c.logoAt ? { ...c.logoAt, [which]: undefined } : undefined;
          const textAt = c.textAt ? { ...c.textAt, [which]: undefined } : undefined;
          return { ...c, logoAt: logoAt && (logoAt.header || logoAt.footer) ? logoAt : undefined, textAt: textAt && (textAt.header || textAt.footer) ? textAt : undefined };
        }),
      );
    return {
      own: !!(ownLogo || ownText),
      saved: !!(band.logoAt || band.textAt),
      onSaveDefault: () => {
        const logoAt = ownLogo ?? band.logoAt;
        const textAt = ownText ?? band.textAt;
        if (!logoAt && !textAt) return;
        patchSettings({ [bandKey]: { ...band, logoAt, textAt } } as Partial<FactorySettings>);
        // every picture now has it by default, so no picture needs its own copy
        clearOwn(true);
        setNote(`The ${which} is saved as the default: every picture has the logo and the text there now, and so will the next ones.`);
      },
      onUseDefault: () => clearOwn(false),
      onBackToStrip: () => {
        patchSettings({ [bandKey]: { ...band, logoAt: undefined, textAt: undefined } } as Partial<FactorySettings>);
        clearOwn(true);
      },
    };
  };

  // ---- the arrow keys nudge what is chosen on the picture, + and - resize it
  const boxFor = (t: PlaceTarget): Box | null => (t === "text" ? report?.text : t === "header" ? report?.headerLogo : t === "footer" ? report?.footerLogo : t === "headerText" ? report?.headerText : report?.footerText) ?? null;
  const applyPlace = (t: PlaceTarget, place: Place) => (t === "header" || t === "footer" ? setLogoAt(t, place) : setTextAt(t === "headerText" ? "header" : "footer", place));
  const nudge = (t: PlaceTarget, dx: number, dy: number) => {
    const b = boxFor(t);
    if (!b || !card) return;
    if (t === "text") {
      const cur = card.textShift ?? { x: 0, y: 0 };
      const bx = b.x - cur.x * size.w;
      const by = b.y - cur.y * size.h;
      const sx = Math.min((size.w - (bx + b.w)) / size.w, Math.max(-bx / size.w, cur.x + dx));
      const sy = Math.min((size.h - (by + b.h)) / size.h, Math.max(-by / size.h, cur.y + dy));
      setTextShift(Math.abs(sx) < 0.001 && Math.abs(sy) < 0.001 ? undefined : { x: sx, y: sy });
      return;
    }
    const pw = b.w / size.w;
    const ph = b.h / size.h;
    applyPlace(t, { x: clamp((b.x + b.w / 2) / size.w + dx, pw / 2, 1 - pw / 2), y: clamp((b.y + b.h / 2) / size.h + dy, ph / 2, 1 - ph / 2), w: pw });
  };
  const resizeSel = (t: PlaceTarget, factor: number) => {
    const b = boxFor(t);
    if (!b || !card) return;
    if (t === "text") {
      setFontScale(clamp(card.fontScale * factor, 0.4, 3));
      return;
    }
    const pw = clamp((b.w / size.w) * factor, 0.04, 0.9);
    const ph = (pw * size.w * (b.h / b.w)) / size.h;
    applyPlace(t, { x: clamp((b.x + b.w / 2) / size.w, pw / 2, 1 - pw / 2), y: clamp((b.y + b.h / 2) / size.h, ph / 2, 1 - ph / 2), w: pw });
  };

  const setText = (text: string) => setCards((cs) => cs.map((c, i) => (i === current ? { ...c, text } : c)));
  const bg = card?.look.background;

  const useMine = async (file: File) => {
    try {
      const key = `mine:${uid()}`;
      bankRef.current.set(key, await createImageBitmap(file));
      patchLook({ background: { kind: "image", key, darken: 0.4, focusX: 0.5, focusY: 0.5 }, ink: "#ffffff", accent: "#f6dea0", cardColor: "rgba(0,0,0,0.42)" });
      setRev((r) => r + 1);
    } catch {
      setError("That picture could not be opened. Try a JPEG or PNG.");
    }
  };

  /** a Christian picture behind the words (no credit is needed: the Unsplash License) */
  const useChristian = async (b: { id: string; title: string; author: string; licence: string }) => {
    try {
      const key = `christian:${b.id}`;
      if (!bankRef.current.has(key)) bankRef.current.set(key, await createImageBitmap(new Blob([await api.sermonBackgroundBytes(b.id, true, "christian")])));
      patchLook({ background: { kind: "image", key, darken: 0.4, credit: creditFor(b.licence, b.title, b.author), focusX: 0.5, focusY: 0.5 }, ink: "#ffffff", accent: "#f6dea0", cardColor: "rgba(0,0,0,0.42)" });
      setRev((r) => r + 1);
    } catch {
      setError("That picture could not be opened.");
    }
  };

  const getChristian = async () => {
    setChristianBusy(true);
    setError(null);
    try {
      await api.sermonBackgroundsDownload("christian");
      const list = await api.sermonBackgrounds("christian");
      setChristian(list);
      setNote(`${list.length} Christian pictures are ready: choose one in the Photos tool, Christian.`);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setChristianBusy(false);
    }
  };

  const useNature = async (b: { id: string; title: string; author: string; licence: string }) => {
    try {
      const key = `nature:${b.id}`;
      if (!bankRef.current.has(key)) bankRef.current.set(key, await createImageBitmap(new Blob([await api.sermonBackgroundBytes(b.id, true)])));
      patchLook({ background: { kind: "image", key, darken: 0.4, credit: creditFor(b.licence, b.title, b.author), focusX: 0.5, focusY: 0.5 }, ink: "#ffffff", accent: "#f6dea0", cardColor: "rgba(0,0,0,0.42)" });
      setRev((r) => r + 1);
    } catch {
      setError("That photo could not be opened.");
    }
  };

  /** a picture from a Bible painting or an online photo, with the credit its licence asks for */
  const usePicture = async (blob: Blob, credit: string) => {
    try {
      const key = `pic:${uid()}`;
      bankRef.current.set(key, await createImageBitmap(blob));
      patchLook({ background: { kind: "image", key, darken: 0.4, credit: credit || undefined, focusX: 0.5, focusY: 0.5 }, ink: "#ffffff", accent: "#f6dea0", cardColor: "rgba(0,0,0,0.42)" });
      setRev((r) => r + 1);
    } catch {
      setError("That picture could not be opened.");
    }
  };

  /** the chapter of the picture on show, when it is Scripture (to offer the paintings that go with it) */
  const cardChapter = useMemo(() => {
    if (!card?.version) return null;
    const p = parsePassage(card.reference.replace(/^Memory verse: /, ""), books, chapterCounts);
    return p ? { book: p.book, chapter: p.chapter } : null;
  }, [card?.reference, card?.version, books, chapterCounts]);

  /** a different nature photo behind each picture of the set */
  const spreadNature = async () => {
    if (!nature || nature.length === 0) {
      setNote("Get the nature photos first (Photos tool, Nature).");
      return;
    }
    setError(null);
    try {
      const picks = [...nature].sort(() => Math.random() - 0.5).slice(0, Math.min(cards.length, nature.length));
      const used: { key: string; credit?: string }[] = [];
      for (const b of picks) {
        const key = `nature:${b.id}`;
        if (!bankRef.current.has(key)) bankRef.current.set(key, await createImageBitmap(new Blob([await api.sermonBackgroundBytes(b.id, true)])));
        used.push({ key, credit: creditFor(b.licence, b.title, b.author) });
      }
      setCards((cs) =>
        cs.map((c, i) => {
          const u = used[i % used.length];
          return { ...c, look: { ...c.look, background: { kind: "image", key: u.key, darken: 0.4, credit: u.credit, focusX: 0.5, focusY: 0.5 }, ink: "#ffffff", accent: "#f6dea0", cardColor: "rgba(0,0,0,0.42)" } };
        }),
      );
      setRev((r) => r + 1);
    } catch {
      setError("The photos could not be opened.");
    }
  };

  /** a set: the same look on every picture, or a different look on each (and from now on, for the sets made next) */
  const setSetStyle = (v: "same" | "different") => {
    const pool = lookPool(lookSeed, { occasion, pictures });
    patchSettings({ varyLooks: v === "different" });
    setScope(v === "same" ? "all" : "one");
    setCards((cs) => cs.map((c, i) => ({ ...c, look: v === "same" ? cs[Math.min(current, cs.length - 1)].look : pool[i % pool.length] })));
  };

  const getNature = async () => {
    setNatureBusy(true);
    setError(null);
    try {
      await api.sermonBackgroundsDownload();
      const list = await api.sermonBackgrounds();
      setNature(list);
      setNote(`${list.length} nature photos are ready: they appear among the looks.`);
      setLookSeed((s) => s + 1);
      // use the first few straight away
      const picks: PictureChoice[] = [];
      for (const b of [...list].sort(() => Math.random() - 0.5).slice(0, 4)) {
        const buf = await api.sermonBackgroundBytes(b.id, true);
        bankRef.current.set(`nature:${b.id}`, await createImageBitmap(new Blob([buf])));
        picks.push({ key: `nature:${b.id}`, credit: creditFor(b.licence, b.title, b.author) });
      }
      setPictures(picks);
      setRev((r) => r + 1);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setNatureBusy(false);
    }
  };

  // ---------------------------------------------------------------- preview
  const previewRef = useRef<HTMLCanvasElement>(null);
  // where the words and the logos ended up on the picture, for the handles that move them
  const [report, setReport] = useState<DrawReport | null>(null);
  const [sel, setSel] = useState<PlaceTarget | null>(null);
  useEffect(() => {
    const c = previewRef.current;
    if (!c || !deferredCard) return;
    c.width = size.w;
    c.height = size.h;
    drawCard(c.getContext("2d", { willReadFrequently: true }) as Ctx2D, deferredCard, size.w, size.h, {
      footer,
      bank: bankRef.current,
      credit: creditOf(deferredCard),
      report: (r) => setReport((old) => (old && JSON.stringify(old) === JSON.stringify(r) ? old : r)),
    });
  }, [deferredCard, size, footer, rev]);

  // ---------------------------------------------------------------- caption
  const credits = useMemo(() => [...new Set(cards.map((c) => creditOf(c)?.text).filter((t): t is string => !!t))], [cards]);
  const musicCreditLine = musicMode === "own" && own?.credit ? own.credit : null;
  const autoCaption = useMemo(
    () => buildCaption(cards.map((c) => ({ text: c.text, reference: c.reference, version: c.version })), footer, { credits, music: musicCreditLine ? `${musicCreditLine}${own?.link ? ` \u2013 ${own.link}` : ""}` : null }),
    [cards, footer, credits, musicCreditLine, own],
  );
  const caption = captionOverride ?? autoCaption;

  // ---------------------------------------------------------------- save, copy, share
  const toggleSize = (id: SizeId) => {
    const next = sizeIds.includes(id) ? sizeIds.filter((s) => s !== id) : [...sizeIds, id];
    setSizeIds(next);
    update({ ...settings, sizes: next.length ? next : settings.sizes });
    if (next.length && !next.includes(previewSize)) setPreviewSize(next[0]);
    else if (!sizeIds.includes(id)) setPreviewSize(id);
  };

  /** something new is saved: the shelf reads its list again, and the gallery window (if it is open) too */
  const announceSaved = () => {
    setSavedTick((t) => t + 1);
    void emit("factory:saved").catch(() => undefined);
  };
  const openGallery = () => void api.factoryGalleryOpen().catch((e) => setError(String(e)));

  const savePictures = async (forCards: Card[] = cards, forLabel: string = label, forCaption: string = caption, goToPost = true) => {
    if (!forCards.length || nothingChosen) return;
    setError(null);
    setNote(null);
    const stem = fileStem(forLabel || "Pictures");
    const out: { label: string; path: string }[] = [];
    try {
      let n = 0;
      const total = forCards.length * sizeIds.length;
      for (const sid of sizeIds) {
        const sz = sizeById(sid);
        for (let i = 0; i < forCards.length; i++) {
          setBusy(`Saving picture ${++n} of ${total}…`);
          const canvas = renderCard(forCards[i], sz.w, sz.h, { footer, bank: bankRef.current, credit: creditOf(forCards[i]) });
          const name = `${stem}${forCards.length > 1 ? ` ${String(i + 1).padStart(2, "0")} of ${forCards.length}` : ""} - ${shortSize(sz)} ${sz.w}x${sz.h}.png`;
          out.push({ label: name, path: await api.factorySave(await bytesOf(await canvasToBlob(canvas)), "Pictures", name) });
        }
      }
      out.push({ label: `${stem} - caption.txt`, path: await api.factorySave(textBytes(forCaption), "Captions", `${stem} - caption.txt`) });
      setSaved(out);
      announceSaved();
      setNote(`Saved ${total} picture${total === 1 ? "" : "s"} and the caption in Documents\\Bible Concordance\\Content Factory.`);
      if (goToPost) patchSettings({ tool: "post", panelOpen: true });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  };

  /** a post taken from the shelf: its pictures drawn in its look, saved as they are */
  const savePost = (post: Post) => void savePictures(cardsOfPost(post), post.title, post.caption, false);

  const copyPostPicture = async (post: Post, i: number) => {
    setError(null);
    try {
      const c = cardsOfPost(post)[i] ?? cardsOfPost(post)[0];
      const blob = await canvasToBlob(renderCard(c, size.w, size.h, { footer, bank: bankRef.current, credit: creditOf(c) }));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setNote("The picture is copied: paste it into your post.");
    } catch {
      setError("The picture could not be copied. Use Save instead, then add it to your post from the folder.");
    }
  };

  const copyPostCaption = async (post: Post) => {
    setNote((await copyText(post.caption)) ? "The caption is copied: paste it into your post." : null);
  };

  const copyPicture = async () => {
    if (!card) return;
    setError(null);
    try {
      const blob = await canvasToBlob(renderCard(card, size.w, size.h, { footer, bank: bankRef.current, credit: creditOf(card) }));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setNote("The picture is copied: paste it into your post.");
    } catch {
      setError("The picture could not be copied. Use Save instead, then add it to your post from the folder.");
    }
  };

  const copyCaption = async () => {
    setNote((await copyText(caption)) ? "The caption is copied: paste it into your post." : null);
  };

  // ---------------------------------------------------------------- music and video
  const seconds = Math.max(2, cards.length * spc);
  const musicFor = async (secs: number): Promise<AudioBuffer | null> => {
    if (musicMode === "none") return null;
    if (musicMode === "own") return own ? segmentOf(own.buffer, startAt, secs) : null;
    const key = `${mood}:${musicSeed}:${secs}`;
    if (musicCache.current?.key === key) return musicCache.current.buffer;
    const buffer = await renderMusic(mood, secs, musicSeed);
    musicCache.current = { key, buffer };
    return buffer;
  };

  const listen = async () => {
    if (listening) {
      listening();
      setListening(null);
      return;
    }
    setError(null);
    try {
      setBusy("Making the music…");
      const raw = await musicFor(Math.min(30, seconds));
      setBusy(null);
      if (!raw) return;
      const stop = playBuffer(withLevel(raw, settings.musicLevel), () => setListening(null));
      setListening(() => stop);
    } catch (e) {
      setBusy(null);
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  const pickMusicFile = async (file: File) => {
    setError(null);
    try {
      setOwn({ name: file.name, buffer: await decodeMusicFile(await file.arrayBuffer()), credit: "", link: "" });
      setStartAt(0);
      setMusicMode("own");
    } catch {
      setError("That music file could not be opened. MP3, M4A, WAV, OGG and FLAC files work.");
    }
  };

  const pickLibrary = async (id: string) => {
    const t = library.find((x) => x.id === id);
    if (!t) return;
    setError(null);
    setLibBusy("Opening the music…");
    try {
      const buffer = await decodeMusicFile(await api.factoryLibraryRead(id));
      setOwn({ name: t.title, buffer, credit: t.credit, link: t.link, id });
      setStartAt(0);
      setMusicMode("own");
    } catch {
      setError("That music could not be opened. MP3, M4A, WAV, OGG and FLAC files work.");
    } finally {
      setLibBusy(null);
    }
  };

  const getFreeMusic = async () => {
    setError(null);
    try {
      let n = 0;
      for (const t of FREE_TRACKS) {
        setLibBusy(`Getting free recordings… ${++n} of ${FREE_TRACKS.length}`);
        await api.factoryLibraryDownload({ url: t.url, file: t.file, title: t.title, artist: t.artist, credit: t.credit, link: t.link });
      }
      setLibrary(await api.factoryLibraryList());
      setNote("The free recordings are in your music library.");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      api.factoryLibraryList().then(setLibrary).catch(() => undefined);
    } finally {
      setLibBusy(null);
    }
  };

  const saveMusic = async () => {
    setError(null);
    try {
      setBusy("Making the music…");
      const raw = await musicFor(180);
      if (!raw) return;
      const stem = fileStem(`${mode(musicMode, mood, own?.name)} music`);
      const path = await api.factorySave(await bytesOf(await makeAudioFile(withLevel(raw, 1))), "Music", `${stem}.m4a`);
      setSaved((s) => [...s, { label: `${stem}.m4a`, path }]);
      setNote("The music is saved in the Music folder.");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  };

  const makeTheVideo = async () => {
    if (!cards.length) return;
    setError(null);
    setNote(null);
    listening?.();
    setListening(null);
    const ctl = new AbortController();
    abortRef.current = ctl;
    setProgress(0);
    setBusy("Making the video…");
    try {
      // the natural voice reads each picture; a picture shows for as long as its reading takes
      let durations: number[] | undefined;
      const clips: VoiceClip[] = [];
      if (narrate && voiceOk) {
        setProgress(null);
        const prefs = loadReadPrefs();
        durations = [];
        let at = 0;
        for (let i = 0; i < cards.length; i++) {
          if (ctl.signal.aborted) throw new Error("cancelled");
          setBusy(`Reading picture ${i + 1} of ${cards.length} aloud…`);
          const buf = await decodeMusicFile(await api.voiceSpeak(spokenText(cards[i], readRef), prefs.voice, prefs.speed));
          const lead = 0.7;
          const dur = Math.max(spc, lead + buf.duration + 1);
          clips.push({ buffer: buf, at: at + lead });
          durations.push(dur);
          at += dur;
        }
        setBusy("Making the video…");
        setProgress(0);
      }
      const total = durations ? durations.reduce((a, b) => a + b, 0) : seconds;
      const raw = await musicFor(total);
      const leveled = raw ? withLevel(raw, settings.musicLevel) : null;
      const music = clips.length ? await mixAudio({ total, music: leveled, clips }) : leveled;
      const vs = sizeById(videoSizeId);
      const blob = await makeVideo({ size: vs, cards, secondsPerCard: spc, durations, motion, fade: 0.6, quality, footer, bank: bankRef.current, creditFor: creditOf, music, musicCredit: musicCreditLine }, setProgress, ctl.signal);
      const stem = fileStem(label || "Video");
      const name = `${stem} - ${shortSize(vs)} video.mp4`;
      const path = await api.factorySave(await bytesOf(blob), "Videos", name);
      setSaved((s) => [...s, { label: name, path }]);
      announceSaved();
      setNote(`The video is saved (${(blob.size / 1_000_000).toFixed(1)} MB): Documents\\Bible Concordance\\Content Factory\\Videos.`);
      patchSettings({ tool: "post", panelOpen: true });
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      if (msg !== "cancelled") setError(msg);
      else setNote("Stopped.");
    } finally {
      setBusy(null);
      setProgress(null);
      abortRef.current = null;
    }
  };

  const copyFiles = async (paths: string[]) => {
    setError(null);
    try {
      await api.factoryCopyFiles(paths);
      setNote(paths.length === 1 ? "The file is copied: paste it into your message or upload box." : `${paths.length} files are copied: paste them into your message or upload box.`);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  const shareFiles = async (paths: string[]) => {
    setError(null);
    try {
      await api.factoryShare(paths, label || "Bible picture", caption);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e) + " You can still copy the files or show them in the folder.");
    }
  };


  // ---------------------------------------------------------------- the studio's layout
  // the tool bar can sit on any side; a narrow window puts it on top whatever was chosen
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setRootWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dock: Dock = rootWidth < 800 && (settings.dock === "left" || settings.dock === "right") ? "top" : settings.dock;
  const tool: ToolId = settings.tool;
  const panelOpen = settings.panelOpen;
  const pickTool = (id: ToolId) => {
    if (id === tool && panelOpen) patchSettings({ panelOpen: false });
    else patchSettings({ tool: id, panelOpen: true });
  };

  // the picture is shown as large as the space left for it allows
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const hasCard = !!card;
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setArea({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasCard]);
  const fit = Math.min(area.w / size.w, area.h / size.h);
  const shownW = Math.max(0, Math.floor(size.w * fit));
  const shownH = Math.max(0, Math.floor(size.h * fit));

  // posts drawn once, so the small pictures on the shelf are not redrawn every time something else changes
  const postCards = useMemo(() => new Map(posts.map((p) => [p.id, cardsOfPost(p)])), [posts, occasion, settings.varyLooks]); // eslint-disable-line react-hooks/exhaustive-deps
  const cardsOf = (p: Post): Card[] => postCards.get(p.id) ?? cardsOfPost(p);

  // keyboard shortcuts, read through a ref so the listener is attached once
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e) => {
    const t = e.target as HTMLElement | null;
    const typing = !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    if (document.querySelector(".fx-modal")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (!busy) void savePictures();
      return;
    }
    if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      void copyPicture();
      return;
    }
    if (e.altKey && !mod) {
      const n = Number(e.key);
      if (n >= 1 && n <= TOOL_IDS.length) {
        e.preventDefault();
        patchSettings({ tool: TOOL_IDS[n - 1], panelOpen: true });
      } else if (e.key.toLowerCase() === "d") {
        e.preventDefault();
        patchSettings({ dock: DOCKS[(DOCKS.indexOf(settings.dock) + 1) % DOCKS.length] });
      } else if (e.key.toLowerCase() === "l") {
        e.preventDefault();
        patchSettings({ libOpen: !settings.libOpen });
      }
      return;
    }
    // something is chosen on the picture: the arrow keys nudge it (Shift: bigger steps), + and - resize it, Esc lets it go
    if (sel && !typing && !e.altKey && !mod) {
      const step = e.shiftKey ? 0.025 : 0.005;
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (arrows[e.key]) {
        e.preventDefault();
        nudge(sel, arrows[e.key][0], arrows[e.key][1]);
        return;
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        resizeSel(sel, 1.05);
        return;
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        resizeSel(sel, 1 / 1.05);
        return;
      }
      if (e.key === "Escape") {
        setSel(null);
        return;
      }
    }
    if (typing || e.altKey || mod || cards.length < 2) return;
    if (e.key === "ArrowLeft") setCurrent((c) => Math.max(0, c - 1));
    else if (e.key === "ArrowRight") setCurrent((c) => Math.min(cards.length - 1, c + 1));
  };
  useEffect(() => {
    const f = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  const vsz = videoSize(sizeById(videoSizeId), quality);
  const musicLabel = (id: typeof musicMode) => (id === "maker" ? "Soft music, made for you" : id === "own" ? (own ? `Music: ${own.name}` : "Music from my library") : "No music");

  // ---------------------------------------------------------------- the tools
  const needCard = <p className="muted fx-hint fx-span">Make a picture first: type a verse at the top and press Make. Then change it here.</p>;

  /** in a set: do the changes go to this picture or to all of them */
  const scopeBox =
    cards.length > 1 ? (
      <div className="fx-block fx-span fx-setbox">
        <span className="fx-label">Changes below go to</span>
        <Segmented
          label="Which pictures a change goes to"
          value={scope}
          onChange={setScope}
          options={[
            { id: "one", label: `Picture ${current + 1} only` },
            { id: "all", label: `All ${cards.length} pictures` },
          ]}
        />
      </div>
    ) : null;

  /** Darken and soften the photo behind the words, and an automatic setting from the part of the photo under the words. */
  const easyToRead = () => {
    if (!card || bg?.kind !== "image") return;
    const img = bankRef.current.get(bg.key);
    if (!img) return;
    const iw = "naturalWidth" in img ? img.naturalWidth : img.width;
    const ih = "naturalHeight" in img ? img.naturalHeight : img.height;
    const W = size.w;
    const H = size.h;
    const sc = Math.max(W / iw, H / ih);
    const dx = (W - iw * sc) * bg.focusX;
    const dy = (H - ih * sc) * bg.focusY;
    const box = report?.text ?? { x: W * 0.1, y: H * 0.3, w: W * 0.8, h: H * 0.4 };
    // the part of the photo that is under the words, in the photo's own pixels
    const sx = clamp((box.x - dx) / sc, 0, iw - 1);
    const sy = clamp((box.y - dy) / sc, 0, ih - 1);
    const sw = clamp(box.w / sc, 1, iw - sx);
    const sh = clamp(box.h / sc, 1, ih - sy);
    const c = document.createElement("canvas");
    c.width = 48;
    c.height = 48;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, 48, 48);
    const st = regionStats(ctx.getImageData(0, 0, 48, 48).data, 48, 48, { x: 0, y: 0, w: 48, h: 48 });
    const s = suggestReadable(st.mean, st.spread);
    patchBackground({ darken: s.darken, blur: s.blur });
    setNote(`The photo under the words is ${st.mean > 0.6 ? "bright" : st.mean > 0.35 ? "medium" : "dark"}${st.spread > 0.16 ? " and busy" : ""}: darkened ${Math.round(s.darken * 100)}%${s.blur ? `, softened ${Math.round(s.blur * 100)}%` : ""}. Change it with the sliders.`);
  };

  const photoTune =
    bg?.kind === "image" ? (
      <div className="fx-tune">
        <label className="fx-slider">
          <span>
            Darken the photo <em>{Math.round(bg.darken * 100)}%</em>
          </span>
          <input type="range" min={0} max={0.85} step={0.02} value={bg.darken} onChange={(e) => patchBackground({ darken: Number(e.target.value) })} aria-label="Darken the picture" />
        </label>
        <label className="fx-slider">
          <span>
            Soften the photo <em>{Math.round((bg.blur ?? 0) * 100)}%</em>
          </span>
          <input type="range" min={0} max={1} step={0.02} value={bg.blur ?? 0} onChange={(e) => patchBackground({ blur: Number(e.target.value) })} aria-label="Soften the picture" />
        </label>
        <button type="button" className="outline-btn fx-small" onClick={easyToRead} title="Looks at the part of the photo under the words and sets how much to darken and soften it, so the words stand out">
          Make the words easy to read
        </button>
      </div>
    ) : null;
  const darken = photoTune;

  // ---- the colour palette: for the text chosen on the picture
  const [wordsOrRef, setWordsOrRef] = useState<"words" | "reference">("words");
  const paletteTarget: PaletteTarget | null = sel === "text" ? wordsOrRef : sel === "headerText" ? "header" : sel === "footerText" ? "footer" : null;
  const paletteValue = paletteTarget === "words" ? card?.look.ink : paletteTarget === "reference" ? card?.look.accent : paletteTarget === "header" ? settings.header.ink : paletteTarget === "footer" ? settings.footerBand.ink : undefined;
  const pickColour = (c: string | undefined) => {
    if (!card || !paletteTarget) return;
    // "automatic" for the words is the colour the look itself had (white, or the look's own)
    const own = looks.find((l) => l.id === card.look.id);
    if (paletteTarget === "words") patchLook({ ink: c ?? (own?.ink ?? "#ffffff") });
    else if (paletteTarget === "reference") patchLook({ accent: c ?? (own?.accent ?? "#f6dea0") });
    else if (paletteTarget === "header") patchSettings({ header: { ...settings.header, ink: c } });
    else patchSettings({ footerBand: { ...settings.footerBand, ink: c } });
  };
  // colours of the picture itself, for the text to match
  const bgKey = bg?.kind === "image" ? bg.key : "";
  const [pictureCols, setPictureCols] = useState<string[]>([]);
  useEffect(() => {
    if (!card) return;
    const b = card.look.background;
    if (b.kind !== "image") {
      setPictureCols([b.from, b.to, card.look.accent, card.look.ink]);
      return;
    }
    const img = bankRef.current.get(b.key);
    if (!img) return;
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 32, 32);
    const cols = pictureColours(ctx.getImageData(0, 0, 32, 32).data, 32, 32, 5);
    setPictureCols(cols.length ? [lighten(cols[0], 0.6), ...cols] : []);
  }, [bgKey, rev, card?.look.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const textTool = !card ? needCard : (
    <>
      <label className="factory-field fx-span">
        <span>The words{cards.length > 1 ? ` (picture ${current + 1} of ${cards.length})` : ""}</span>
        <textarea value={card.text} onChange={(e) => setText(e.target.value)} rows={5} />
      </label>
      {scopeBox}
      <div className="fx-block fx-span">
        <span className="fx-label">Place</span>
        <span className="fx-pickrow">
          <span className="muted fx-hint">Drag the words on the picture to move them.</span>
          <button type="button" className="link-btn" onClick={() => setTextShift(undefined)} disabled={!card.textShift && !cards.some((c, i) => hit(i) && c.textShift)} title="Put the words back in their usual place">
            Back to the usual place
          </button>
        </span>
      </div>
      <div className="fx-block">
        <span className="fx-label">Show</span>
        <div className="fx-checks">
          <label className="factory-check">
            <input type="checkbox" checked={card.showReference} onChange={(e) => patchCards({ showReference: e.target.checked })} /> The reference
          </label>
          <label className="factory-check">
            <input type="checkbox" checked={card.showVersion} onChange={(e) => patchCards({ showVersion: e.target.checked })} disabled={!card.showReference} /> The version
          </label>
          <label className="factory-check">
            <input type="checkbox" checked={card.look.capitals} onChange={(e) => patchLook({ capitals: e.target.checked })} /> CAPITALS
          </label>
        </div>
      </div>
      <div className="fx-block">
        <span className="fx-label">Where the words sit</span>
        <div className="fx-chipgrid">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" className={card.look.layout === l.id ? "on" : ""} aria-pressed={card.look.layout === l.id} onClick={() => patchLook({ layout: l.id })}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className="fx-block">
        <span className="fx-label">Letters</span>
        <div className="fx-chipgrid">
          {FONTS.map((f) => (
            <button key={f.id} type="button" style={{ fontFamily: f.family }} className={card.look.fontId === f.id ? "on" : ""} aria-pressed={card.look.fontId === f.id} onClick={() => patchLook({ fontId: f.id, bold: f.id === "bold" })}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <label className="fx-slider fx-block">
        <span>
          Size of the words <em>{Math.round(card.fontScale * 100)}%</em>
        </span>
        <input type="range" min={0.4} max={2.5} step={0.05} value={Math.min(2.5, card.fontScale)} onChange={(e) => patchCards({ fontScale: Number(e.target.value) })} aria-label="Size of the words" />
      </label>
    </>
  );

  const lookTool = !card ? needCard : (
    <>
      {cards.length > 1 && (
        <div className="fx-block fx-span fx-setbox">
          <span className="fx-label">The {cards.length} pictures of this set</span>
          <Segmented
            label="Looks in a set"
            value={settings.varyLooks ? "different" : "same"}
            onChange={setSetStyle}
            options={[
              { id: "different", label: "A different look on each", title: "Each picture gets its own colours, or its own photo" },
              { id: "same", label: "The same look on all", title: "One look for the whole set" },
            ]}
          />
        </div>
      )}
      {scopeBox}
      {photoTune && <div className="fx-block fx-span">{photoTune}</div>}
      <div className="fx-block fx-span">
        <div className="factory-looks">
          {lookCards.map((lc) => (
            <Thumb key={lc.look.id} card={lc} size={size} footer={footer} bank={bankRef.current} rev={rev} credit={creditText(lc)} width={130} label={lc.look.label} on={card.look.id === lc.look.id} onClick={() => patchCards({ look: lc.look })} />
          ))}
        </div>
        <button type="button" className="link-btn fx-left" onClick={() => setLookSeed((s) => s + 1)}>
          More looks
        </button>
      </div>
      <div className="fx-block">
        <span className="fx-label">Colours</span>
        <div className="fx-chipgrid">
          {PALETTES.map((p) => (
            <button key={p.id} type="button" onClick={() => patchLook(lookFromPalette(p, card.look.layout, card.look.fontId, p.label, card.look.id))}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );

  const photosTool = !card ? needCard : (
    <>
      {scopeBox}
      {cards.length > 1 && nature && nature.length > 0 && (
        <div className="fx-block fx-span">
          <button type="button" className="outline-btn fx-left" onClick={() => void spreadNature()} title="Put a different nature photo behind each of the pictures of this set">
            A different nature photo on each picture
          </button>
        </div>
      )}
    <div className="fx-span">
      <FactoryPhotos chapter={cardChapter} onPick={usePicture} nature={nature} latest={latest} natureBusy={natureBusy} onGetNature={() => void getNature()} onNature={(b) => void useNature(b)} christian={christian} christianInfo={christianInfo} christianBusy={christianBusy} onGetChristian={() => void getChristian()} onChristian={(b) => void useChristian(b)} onMine={(f) => void useMine(f)} />
    </div>
    </>
  );

  const sizesTool = (
    <div className="fx-block fx-span">
      <p className="muted fx-hint">Where will you post it? Tick every place: Save makes one picture for each.</p>
      <div className="factory-sizes" role="group" aria-label="Picture sizes">
        {SIZES.map((s) => (
          <label key={s.id} className={"factory-size" + (sizeIds.includes(s.id) ? " on" : "")} title={s.note}>
            <input type="checkbox" checked={sizeIds.includes(s.id)} onChange={() => toggleSize(s.id)} />
            <span className={"factory-shape " + s.id} aria-hidden="true" />
            <span>
              <strong>{s.label}</strong>
              <small>
                {s.w} × {s.h}
              </small>
            </span>
          </label>
        ))}
      </div>
      {nothingChosen && <p className="muted">Tick at least one size.</p>}
    </div>
  );

  const headerTool = (
    <>
      <div className="fx-span">
        <BandPanel which="header" settings={settings} onPatch={patchSettings} place={placeInfo("header")} />
      </div>
      {card && (
        <label className="factory-check fx-span">
          <input type="checkbox" checked={!card.hideHeader} onChange={(e) => patchThis({ hideHeader: !e.target.checked })} /> Show the header on this picture
        </label>
      )}
    </>
  );

  const footerTool = (
    <>
      {card && (
        <div className="fx-block fx-span fx-thispic">
          <span className="fx-label">On this picture</span>
          <label className="fx-inline-field">
            <span>Name</span>
            <select value={card.postedBy} onChange={(e) => patchThis({ postedBy: e.target.value })} aria-label="Name on this picture">
              <option value="">{defaultName(settings) ? `${defaultName(settings)} (usual)` : "None (usual)"}</option>
              {settings.names.filter((n) => n !== defaultName(settings)).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
              <option value={NO_NAME}>No name on this one</option>
            </select>
          </label>
          <label className="factory-check">
            <input type="checkbox" checked={!card.hideFooter} onChange={(e) => patchThis({ hideFooter: !e.target.checked })} /> Show them on this picture (logo, banner, church text)
          </label>
        </div>
      )}
      <details className="fx-group fx-span" open={settings.names.length === 0}>
        <summary>
          Your name <small>{defaultName(settings) || "none yet"}</small>
        </summary>
        <NamesBox settings={settings} onPatch={patchSettings} />
      </details>
      <div className="fx-span">
        <BandPanel which="footer" settings={settings} onPatch={patchSettings} place={placeInfo("footer")} />
      </div>
      <div className="fx-span">
        <AdvancedBox settings={settings} onPatch={patchSettings} />
      </div>
    </>
  );

  const videoTool = !card ? needCard : (
    <>
      {canVideo === false && <p className="muted fx-span">This computer cannot make videos in the app (it needs the Windows video codec). Pictures work as usual.</p>}
      <div className="fx-block fx-span">
        <span className="fx-label">The pictures</span>
        <div className="factory-video-grid">
          <label className="factory-field">
            <span>Each shows for</span>
            <select value={spc} onChange={(e) => setSpc(Number(e.target.value))}>
              {[3, 4, 5, 6, 8, 10, 12, 15, 20, 30].map((n) => (
                <option key={n} value={n}>
                  {n} seconds
                </option>
              ))}
            </select>
          </label>
          <label className="factory-field">
            <span>Movement</span>
            <select value={motion} onChange={(e) => setMotion(e.target.value as Motion)}>
              <option value="zoom">Slow zoom</option>
              <option value="drift">Slow drift</option>
              <option value="still">Still</option>
            </select>
          </label>
          <label className="factory-field">
            <span>Shape</span>
            <select value={videoSizeId} onChange={(e) => setVideoSizeId(e.target.value as SizeId)}>
              {SIZES.filter((s) => s.id !== "link").map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="factory-field">
            <span>Quality</span>
            <select value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
              <option value="best">
                Best ({sizeById(videoSizeId).w}×{sizeById(videoSizeId).h})
              </option>
              <option value="small">
                Small for WhatsApp ({videoSize(sizeById(videoSizeId), "small").w}×{videoSize(sizeById(videoSizeId), "small").h})
              </option>
            </select>
          </label>
        </div>
      </div>
      <fieldset className="factory-music fx-block">
        <legend>Voice</legend>
        <label className="factory-check">
          <input type="checkbox" checked={narrate && !!voiceOk} onChange={(e) => setNarrate(e.target.checked)} disabled={!voiceOk} /> Read the words aloud with the natural voice
        </label>
        {narrate && voiceOk && (
          <label className="factory-check">
            <input type="checkbox" checked={readRef} onChange={(e) => setReadRef(e.target.checked)} /> and read the reference
          </label>
        )}
        {voiceOk === false && <p className="muted">The natural voice is not installed: you can download it in Settings, under Read aloud. A video without a voice is just as good: pictures and music.</p>}
        {narrate && voiceOk && <p className="muted">Each picture stays up as long as the reading takes. The music goes quieter while the voice speaks.</p>}
      </fieldset>
      <fieldset className="factory-music fx-block">
        <legend>Music</legend>
        <div className="fx-radios">
          {(["maker", "own", "none"] as const).map((m) => (
            <label key={m} className="factory-check">
              <input type="radio" name="factory-music" checked={musicMode === m} onChange={() => setMusicMode(m)} disabled={m === "own" && !own} /> {musicLabel(m)}
            </label>
          ))}
        </div>
        <label className="factory-field">
          <span>My music library{library.length ? ` (${library.length})` : ""}</span>
          <select value={own?.id ?? ""} onChange={(e) => e.target.value && void pickLibrary(e.target.value)} disabled={library.length === 0 || !!libBusy}>
            <option value="">{library.length ? "Choose a piece of music…" : "Nothing in the library yet"}</option>
            {[...new Set(library.map((t) => t.group))].map((g) => (
              <optgroup key={g} label={g}>
                {library.filter((t) => t.group === g).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                    {t.artist && g !== SOUTHERN_CROSS.name ? `, ${t.artist}` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="factory-chips">
          <label className="outline-btn factory-file">
            A music file from my computer…
            <input type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac" onChange={(e) => e.target.files?.[0] && void pickMusicFile(e.target.files[0])} />
          </label>
          {library.filter((t) => t.group === "Free recordings").length < FREE_TRACKS.length && (
            <button type="button" className="outline-btn" onClick={() => void getFreeMusic()} disabled={!!libBusy} title="Piano and band recordings that are free to use (public domain or CC0), about 30 MB, fetched once. Their credit goes with them.">
              Get free recordings (30 MB)
            </button>
          )}
          <button type="button" className="outline-btn" onClick={() => void api.factoryLibraryFolder().then(() => api.factoryLibraryList().then(setLibrary)).catch((e) => setError(String(e)))} title="Put your own songs in the Southern Cross Music folder and they appear here, credited to the artist">
            Open the music folder
          </button>
        </div>
        {libBusy && <p className="muted factory-busy">{libBusy}</p>}
        {musicMode === "own" && own && (
          <label className="factory-field">
            <span>
              Start {Math.floor(startAt / 60)}:{String(Math.floor(startAt % 60)).padStart(2, "0")} into it{own.credit ? ` · credit: ${own.credit}` : ""}
            </span>
            <input type="range" min={0} max={Math.max(0, Math.floor(own.buffer.duration - 10))} step={1} value={Math.min(startAt, Math.max(0, Math.floor(own.buffer.duration - 10)))} onChange={(e) => setStartAt(Number(e.target.value))} />
          </label>
        )}
        {musicMode === "maker" && (
          <>
            <label className="factory-field">
              <span>Feeling</span>
              <select value={mood} onChange={(e) => setMood(e.target.value as MoodId)}>
                {MOODS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}: {m.blurb}
                  </option>
                ))}
              </select>
            </label>
            <div className="factory-chips">
              <button type="button" className="outline-btn" onClick={() => setMusicSeed((s) => s + 1)}>
                Another version
              </button>
            </div>
          </>
        )}
        {musicMode !== "none" && (
          <>
            <label className="fx-slider">
              <span>
                Music volume <em>{Math.round(settings.musicLevel * 100)}%</em>
              </span>
              <input type="range" min={0.15} max={1} step={0.05} value={settings.musicLevel} onChange={(e) => update({ ...settings, musicLevel: Number(e.target.value) })} aria-label="Music volume" />
            </label>
            <div className="factory-chips">
              <button type="button" className="outline-btn" onClick={() => void listen()} disabled={!!busy && !listening}>
                {listening ? "■ Stop" : "▶ Listen"}
              </button>
              {musicMode === "maker" && (
                <button type="button" className="outline-btn" onClick={() => void saveMusic()} disabled={!!busy} title="Three minutes of this music as an audio file, for the screen before the service or the sound desk">
                  Save 3 minutes of it alone
                </button>
              )}
            </div>
          </>
        )}
      </fieldset>
    </>
  );

  const shareable = (list: { path: string }[]) => list.filter((s) => /\.(png|jpg|mp4)$/i.test(s.path)).map((s) => s.path);
  const postTool =
    !card && saved.length === 0 ? needCard : (
      <>
        {card && (
          <>
            <label className="factory-field fx-span">
              <span>
                The caption to post with it{" "}
                {captionOverride !== null && (
                  <button type="button" className="link-btn" onClick={() => setCaptionOverride(null)}>
                    Start again
                  </button>
                )}
              </span>
              <textarea value={caption} onChange={(e) => setCaptionOverride(e.target.value)} rows={7} />
            </label>
            <div className="fx-span factory-chips">
              <button type="button" className="outline-btn" onClick={() => void copyCaption()}>
                <Icon name="copy" size={15} /> Copy caption
              </button>
              <button type="button" className="outline-btn" onClick={() => void copyPicture()} disabled={!!busy}>
                <Icon name="copy" size={15} /> Copy picture
              </button>
              <button type="button" className="outline-btn" onClick={() => void savePictures()} disabled={!!busy || nothingChosen}>
                <Icon name="save" size={15} /> Save
              </button>
            </div>
            <div className="fx-block fx-span">
              <span className="fx-label">Then post it on</span>
              <div className="factory-chips">
                {SITES.map((s) => (
                  <button key={s.name} type="button" className="fx-idea" onClick={() => void openUrl(s.url)}>
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
        {saved.length > 0 && (
          <div className="fx-block fx-span factory-saved">
            <div className="fx-saved-head">
              <span className="fx-label">
                Saved just now ({shareable(saved).length} {shareable(saved).length === 1 ? "file" : "files"})
              </span>
            </div>
            <div className="factory-chips">
              {shareable(saved).length > 1 && (
                <>
                  <button type="button" className="outline-btn" onClick={() => void shareFiles(shareable(saved))}>
                    Share all…
                  </button>
                  <button type="button" className="outline-btn" onClick={() => void copyFiles(shareable(saved))} title="Copy the files, then paste them into a message or an upload box">
                    Copy all files
                  </button>
                </>
              )}
              <button type="button" className="outline-btn" onClick={openGallery} title="See everything saved, as little pictures, in a window of its own">
                Open the gallery
              </button>
              <button type="button" className="outline-btn" onClick={() => void api.factoryOpenFolder().catch((e) => setError(String(e)))}>
                Open the folder
              </button>
            </div>
            <details open={saved.length <= 4}>
              <summary className="muted">The files</summary>
              <ul>
                {saved.map((s) => (
                  <li key={s.path}>
                    <span title={s.label}>{s.label}</span>
                    <span className="factory-chips">
                      {!s.path.endsWith(".txt") && (
                        <>
                          <button type="button" className="link-btn" onClick={() => void shareFiles([s.path])} title="Open the Windows Share window: WhatsApp, Mail, nearby devices">
                            Share…
                          </button>
                          <button type="button" className="link-btn" onClick={() => void copyFiles([s.path])} title="Copy the file, then paste it into a message or an upload box">
                            Copy
                          </button>
                        </>
                      )}
                      <button type="button" className="link-btn" onClick={() => void api.factoryReveal(s.path).catch((e) => setError(String(e)))}>
                        Show
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
      </>
    );

  const TOOLS: { id: ToolId; label: string; title: string; icon: IconName; hint: string }[] = [
    { id: "text", label: "Text", title: "The words", icon: "text", hint: "The words, the letters, where they sit" },
    { id: "look", label: "Look", title: "Look", icon: "look", hint: "A style for the picture" },
    { id: "photos", label: "Photos", title: "A photo behind the words", icon: "photos", hint: "Nature, paintings, online, your own" },
    { id: "sizes", label: "Sizes", title: "Where will you post it?", icon: "sizes", hint: "Square, tall, wide…" },
    { id: "header", label: "Header", title: "Header", icon: "header", hint: "A logo, banner or words across the top" },
    { id: "footer", label: "Footer", title: "Footer: name, logo and credits", icon: "footer", hint: "Your name, a logo, the photo credit and the website along the bottom" },
    { id: "video", label: "Video", title: "Make a video", icon: "video", hint: "Seconds, movement, voice and music" },
    { id: "post", label: "Post", title: "Caption and posting", icon: "post", hint: "The caption, copy, share, the sites" },
  ];
  const toolBody = { text: textTool, look: lookTool, photos: photosTool, sizes: sizesTool, header: headerTool, footer: footerTool, video: videoTool, post: postTool }[tool];
  const toolInfo = TOOLS.find((t) => t.id === tool)!;
  const toolFoot =
    tool === "photos" && card ? darken
    : tool === "video" && card ? (
      <div className="fx-foot-actions">
        <button type="button" className="pill-btn" onClick={() => void makeTheVideo()} disabled={!!busy || canVideo === false || (musicMode === "own" && !own)}>
          Make the video ({narrate && voiceOk ? "at least " : ""}{Math.round(seconds)} s, {vsz.w}×{vsz.h})
        </button>
        {progress !== null && (
          <>
            <progress value={progress} max={1} aria-label="Making the video" />
            <button type="button" className="outline-btn" onClick={() => abortRef.current?.abort()}>
              Stop
            </button>
          </>
        )}
      </div>
    )
    : null;

  const sizeLabelOf = (id: SizeId) => shortSize(sizeById(id));

  return (
    <article className="factory fx" ref={rootRef} data-dock={dock}>
      <header className="fx-top">
        <h2 title="Make pictures and short videos from the Bible, ready to post. Pick a verse, pick a look, save.">Content Factory</h2>
        <form
          className="fx-make"
          onSubmit={(e) => {
            e.preventDefault();
            makeFromInput();
          }}
        >
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="A verse, like John 3:16 or Psalm 23:1-3" aria-label="A verse to make a picture of" />
          <button type="submit" className="pill-btn" disabled={!input.trim() || !!busy}>
            Make
          </button>
        </form>
        <div className="fx-quick">
          <button type="button" className="fx-btn" disabled={!!busy} onClick={() => void make([todayPassage()], "Verse of the day")}>
            Today's verse
          </button>
          <button type="button" className="fx-btn" disabled={!!busy} onClick={() => void make(weekPassages(), "This week")} title="Seven verses, one for each day, as a set">
            This week (7)
          </button>
          <button type="button" className="fx-btn" disabled={!!busy} onClick={() => void make([promisePassage(Math.floor(Math.random() * 1000))], "A verse")}>
            A verse for me
          </button>
        </div>
        <label className="fx-inline-field fx-version" title="Only versions that are free to share are offered for pictures">
          <span>Bible</span>
          <select value={version} onChange={(e) => setVersion(e.target.value)} aria-label="Bible version">
            {freeVersions.map((v) => (
              <option key={v.code} value={v.code}>
                {v.code}: {v.name}
              </option>
            ))}
          </select>
        </label>
        <span className="fx-spacer" />
        <Popover label="" icon={<Icon name="keyboard" size={18} />} title="Keyboard shortcuts" align="right" className="fx-icononly">
          <div className="fx-menu fx-keys">
            <strong className="fx-menu-title">Keyboard shortcuts</strong>
            <dl>
              <dt>Ctrl + S</dt>
              <dd>Save the pictures</dd>
              <dt>Ctrl + Shift + C</dt>
              <dd>Copy the picture</dd>
              <dt>← →</dt>
              <dd>The picture before or after, in a set</dd>
              <dt>Arrows, + and −</dt>
              <dd>With the words or a logo chosen on the picture: nudge it (Shift: bigger steps), make it bigger or smaller. Esc lets go</dd>
              <dt>Alt + 1 … 8</dt>
              <dd>Text, Look, Photos, Sizes, Header, Footer, Video, Post</dd>
              <dt>Alt + D</dt>
              <dd>Move the tool bar to the next side</dd>
              <dt>Alt + L</dt>
              <dd>Open or shut the shelf of made pictures</dd>
              <dt>Esc</dt>
              <dd>Close the open window</dd>
            </dl>
          </div>
        </Popover>
        <button type="button" className="fx-btn" onClick={openGallery} title="Show the saved pictures and videos in a window of their own, to move to another screen">
          <Icon name="library" size={17} /> Gallery
        </button>
        <button type="button" className="fx-btn icon" onClick={() => void api.factoryOpenFolder().catch((e) => setError(String(e)))} title="Open the folder where pictures and videos are saved" aria-label="Open the folder">
          <Icon name="folder" size={18} />
        </button>
        <button type="button" className="outline-btn" onClick={onClose}>
          Close
        </button>
      </header>

      {!settings.asked && settings.names.length === 0 && (
        <section className="fx-ask" aria-label="Your name">
          <strong>Whose name goes on your pictures?</strong>
          <span className="muted">It goes in the footer bar at the bottom. You can leave it empty.</span>
          <input value={askName} onChange={(e) => setAskName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && askName.trim() && update({ ...settings, names: [askName.trim()], asked: true })} placeholder="e.g. Pastor Sam" aria-label="Your name" maxLength={60} />
          <button type="button" className="pill-btn" onClick={() => update({ ...settings, names: askName.trim() ? [askName.trim()] : [], asked: true })}>
            {askName.trim() ? "Use this name" : "No name"}
          </button>
        </section>
      )}

      <div className={"fx-studio dock-" + dock + (panelOpen ? "" : " shut")}>
        <div className="fx-tools">
          <nav className="fx-rail" aria-label="Tools">
            {TOOLS.map((t, i) => (
              <button key={t.id} type="button" className={"fx-tool" + (tool === t.id && panelOpen ? " on" : "")} onClick={() => pickTool(t.id)} aria-pressed={tool === t.id && panelOpen} title={`${t.hint} (Alt+${i + 1})`}>
                <Icon name={t.icon} size={20} />
                <span>{t.label}</span>
              </button>
            ))}
            <div className="fx-dockpick" role="group" aria-label="Move the tool bar to">
              {DOCKS.map((d) => (
                <button key={d} type="button" className={settings.dock === d ? "on" : ""} aria-pressed={settings.dock === d} onClick={() => patchSettings({ dock: d })} title={`Tool bar on the ${d} (Alt+D moves it on)`}>
                  <DockGlyph side={d} size={15} />
                </button>
              ))}
            </div>
          </nav>
          {panelOpen && (
            <section className="fx-panel" aria-label={toolInfo.title}>
              <header>
                <h3>{toolInfo.title}</h3>
                <button type="button" className="fx-btn icon" onClick={() => patchSettings({ panelOpen: false })} aria-label="Hide this panel" title="Hide this panel: the picture gets all the room">
                  <Icon name={dock === "left" ? "chevronLeft" : dock === "right" ? "chevronRight" : dock === "top" ? "chevronUp" : "chevronDown"} size={18} />
                </button>
              </header>
              <div className="fx-panel-body">{toolBody}</div>
              {toolFoot && <footer className="fx-panel-foot">{toolFoot}</footer>}
            </section>
          )}
        </div>

        <main className="fx-stage">
          {!card && (
            <div className="fx-empty">
              <h3>Make your first picture</h3>
              <p className="muted">Type a verse at the top and press Make, or start with one of these:</p>
              <div className="factory-chips">
                <button type="button" className="pill-btn" disabled={!!busy} onClick={() => void make([todayPassage()], "Verse of the day")}>
                  Today's verse
                </button>
                <button type="button" className="outline-btn" disabled={!!busy} onClick={() => void make(weekPassages(), "This week")}>
                  This week (7 verses)
                </button>
                <button type="button" className="outline-btn" disabled={!!busy} onClick={() => void make([promisePassage(Math.floor(Math.random() * 1000))], "A verse")}>
                  A verse for me
                </button>
              </div>
              <p className="muted">Pictures already made for you wait on the shelf below: “Ready to post”.</p>
            </div>
          )}
          {card && (
            <>
              <div className="fx-stage-bar">
                <div className="factory-preview-tabs" role="tablist" aria-label="Preview size">
                  {sizeIds.map((id) => (
                    <button key={id} type="button" role="tab" aria-selected={previewSize === id} className={previewSize === id ? "on" : ""} onClick={() => setPreviewSize(id)} title={sizeById(id).note}>
                      {sizeLabelOf(id)}
                    </button>
                  ))}
                </div>
                <span className="fx-spacer" />
                {photoTune && (
                  <Popover label="Photo: darken and soften" align="right" title="Darken or soften the photo behind the words so they stand out">
                    <div className="fx-menu fx-tunemenu">{photoTune}</div>
                  </Popover>
                )}
                {cards.length > 1 && (
                  <div className="fx-nav" role="group" aria-label="The pictures in this set">
                    <button type="button" className="fx-btn icon" onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0} aria-label="The picture before" title="The picture before (left arrow)">
                      <Icon name="chevronLeft" size={16} />
                    </button>
                    <span>
                      {current + 1} of {cards.length}
                    </span>
                    <button type="button" className="fx-btn icon" onClick={() => setCurrent((c) => Math.min(cards.length - 1, c + 1))} disabled={current === cards.length - 1} aria-label="The next picture" title="The next picture (right arrow)">
                      <Icon name="chevronRight" size={16} />
                    </button>
                  </div>
                )}
              </div>
              <div className="fx-canvas-row">
              <FactoryPalette target={paletteTarget} value={paletteValue} onPick={pickColour} verse={sel === "text"} onTarget={setWordsOrRef} fromPicture={pictureCols} />
              <div className="fx-canvas-area" ref={areaRef} onPointerDown={(e) => e.target === e.currentTarget && setSel(null)}>
                <div className="fx-stagebox" style={{ width: shownW, height: shownH }}>
                  <canvas ref={previewRef} className="factory-preview" aria-label="The picture" />
                  <PlaceOverlay
                    report={report}
                    size={size}
                    width={shownW}
                    height={shownH}
                    textShift={card.textShift}
                    fontScale={card.fontScale}
                    selected={sel}
                    onSelect={setSel}
                    hint={tool === "text" ? ["text"] : tool === "header" ? ["header", "headerText"] : tool === "footer" ? ["footer", "footerText"] : []}
                    onText={setTextShift}
                    onTextScale={setFontScale}
                    onLogo={setLogoAt}
                    onTextAt={setTextAt}
                  />
                </div>
              </div>
              </div>
              {cards.length > 1 && (
                <div className="factory-strip" aria-label="The pictures in this set">
                  {cards.map((c, i) => (
                    <Thumb key={c.id} card={c} size={size} footer={footer} bank={bankRef.current} rev={rev} credit={creditText(c)} width={size.h > size.w ? 40 : 66} label={String(i + 1)} on={i === current} onClick={() => setCurrent(i)} />
                  ))}
                </div>
              )}
              <div className="fx-actions">
                <button type="button" className="pill-btn" onClick={() => void savePictures()} disabled={!!busy || nothingChosen} title={`Save as PNG files in ${sizeIds.map(sizeLabelOf).join(", ") || "no size"} (Ctrl+S)`}>
                  <Icon name="save" size={16} /> Save{cards.length > 1 ? ` ${cards.length} pictures` : ""}
                  {sizeIds.length > 1 ? ` · ${sizeIds.length} sizes` : ""}
                </button>
                <button type="button" className="outline-btn" onClick={() => void copyPicture()} disabled={!!busy} title="Copy this picture to paste into a post (Ctrl+Shift+C)">
                  <Icon name="copy" size={16} /> Copy picture
                </button>
                <button type="button" className="outline-btn" onClick={() => void makeTheVideo()} disabled={!!busy || canVideo === false || (musicMode === "own" && !own)} title="Make a video with music, using the settings in the Video tool">
                  <Icon name="video" size={16} /> Make video
                </button>
                <button type="button" className="outline-btn" onClick={() => patchSettings({ tool: "post", panelOpen: true })} title="The caption, and the sites to post on">
                  <Icon name="post" size={16} /> Post…
                </button>
                {busy && progress === null && <span className="muted fx-busy">{busy}</span>}
                {progress !== null && (
                  <span className="fx-progress">
                    <progress value={progress} max={1} aria-label="Making the video" />
                    <button type="button" className="link-btn" onClick={() => abortRef.current?.abort()}>
                      Stop
                    </button>
                  </span>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      <FactoryLibrary
        posts={posts}
        size={size}
        footer={footer}
        bank={bankRef.current}
        rev={rev}
        cardsOf={cardsOf}
        busy={!!busy}
        open={settings.libOpen}
        onToggle={(o) => patchSettings({ libOpen: o })}
        view={settings.libView}
        onView={(v) => patchSettings({ libView: v })}
        savedTick={savedTick}
        include={settings.recipes}
        onInclude={(r) => patchSettings({ recipes: r })}
        suggestion={suggestion}
        onMakeWeek={() => {
          patchSettings({ libOpen: true });
          makeWeek();
        }}
        onMakeSeries={(id) => {
          patchSettings({ libOpen: true });
          makeSeries(id);
        }}
        onEdit={openPost}
        onStatus={changeStatus}
        onRemove={dropPost}
        onCopyPicture={(p, i) => void copyPostPicture(p, i)}
        onCopyCaption={(p) => void copyPostCaption(p)}
        onSavePost={savePost}
        onCopyFiles={(ps) => void copyFiles(ps)}
        onShareFiles={(ps) => void shareFiles(ps)}
        onReveal={(path) => void api.factoryReveal(path).catch((e) => setError(String(e)))}
        onOpenFolder={() => void api.factoryOpenFolder().catch((e) => setError(String(e)))}
        onGallery={openGallery}
      />

      {(error || note) && (
        <div className="fx-toasts" aria-live="polite">
          {error && (
            <p className="fx-toast error" role="alert">
              <span>{error}</span>
              <button type="button" className="fx-btn icon" onClick={() => setError(null)} aria-label="Dismiss">
                <Icon name="close" size={14} />
              </button>
            </p>
          )}
          {note && (
            <p className="fx-toast" role="status">
              <span>{note}</span>
              <button type="button" className="fx-btn icon" onClick={() => setNote(null)} aria-label="Dismiss">
                <Icon name="close" size={14} />
              </button>
            </p>
          )}
        </div>
      )}
    </article>
  );
}

/** what the voice says for a picture: the words, then the reference when it is Scripture */
function spokenText(c: Card, withReference: boolean): string {
  const text = c.text.replace(/\s+/g, " ").trim();
  if (!withReference || !c.version || !c.reference) return text;
  return `${text} ${c.reference.replace(/^Memory verse: /, "").replace(/\u2013/g, " to ")}.`;
}

const mode = (m: "maker" | "own" | "none", mood: MoodId, ownName?: string) => (m === "own" ? (ownName ?? "My music").replace(/\.[a-z0-9]+$/i, "") : `Soft ${mood}`);

