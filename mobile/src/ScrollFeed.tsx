// The Daily Scroll (Extras > Daily Scroll): a full-screen, swipe-up feed of the day's 20 cards, each on a photo (or a colour when no pictures are downloaded):
// a verse, a "Verses for..." passage, a Bible story, who wrote a book, a verse to remember. Share opens the picture studio on the card, Save bookmarks the
// verse, Open goes to the passage, story or author. "Show me more" adds ten. How the cards are chosen is dailyScroll.ts; nothing about the reader is kept
// except which cards were shown (so they do not come round again for 50 days), and that stays on the phone.

import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, phone, type BackgroundPack } from "./api";
import { parseRef } from "../../src/browse/browseLogic";
import { CHILDREN, STORIES, TOPICS } from "../../src/browse/data";
import { BIBLE_AUTHORS } from "../../src/bibleAuthors";
import { PASSAGES } from "./votd";
import verseCardsOne from "../data/daily_scroll_verse_cards.json";
import verseCardsTwo from "../data/daily_scroll_verse_cards_batch2.json";
import firstsFile from "../../src-tauri/resources/firsts.json";
import { buildDeck, buildPool, dayNumber, hashOf, kindLabel, remember, trimWords, type Card, type History, type Sources } from "./dailyScroll";
import { LOOKS, quickPicture } from "./VersePicture";

/** What the picture studio is opened with from a card. */
export interface ScrollShare {
  book: string;
  chapter: number;
  first: number;
  last: number;
  text: string;
  free?: { label: string; text: string };
  start: { pack: BackgroundPack; id: string } | null;
}

/** Where Open goes. */
export type ScrollOpen =
  | { to: "passage"; book: string; chapter: number; verse: number }
  | { to: "story" | "topic" | "children"; id: string }
  | { to: "author"; name: string };

interface Props {
  version: string;
  /** out of sight (while a passage or story opened from a card is read) but still there, at the same card */
  hidden?: boolean;
  onClose: () => void;
  onShare: (s: ScrollShare) => void;
  onOpen: (o: ScrollOpen) => void;
  say: (message: string) => void;
  fail: (e: unknown) => void;
}

const KEY = "pocket:scroll";
const OFFER_KEY = "pocket:scroll-offer";

interface Saved {
  history: History;
  /** how many "Show me more" were pressed on which day */
  more: Record<string, number>;
}

const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* the scroll still works; it just cannot remember what it showed */
    }
  },
};

function load(): Saved {
  try {
    const s = JSON.parse(store.get(KEY) ?? "null") as Saved | null;
    if (s && typeof s.history === "object" && s.history) return { history: s.history, more: s.more ?? {} };
  } catch {
    /* start fresh */
  }
  return { history: {}, more: {} };
}

function sources(): Sources {
  const cards = [...verseCardsOne.cards, ...verseCardsTwo.cards] as { id: string; ref: string }[];
  return {
    verseCards: cards.map((c) => ({ id: c.id, ref: c.ref })),
    daily: PASSAGES,
    topics: TOPICS.map((t) => ({ id: t.id, title: t.title, items: t.items.map((i) => ({ ref: i.ref, note: i.note })) })),
    stories: STORIES.map((s) => ({ id: s.id, title: s.title, summary: s.summary })),
    authors: BIBLE_AUTHORS.map((a) => ({ name: a.name, note: a.note, books: a.books })),
    children: CHILDREN.map((c) => ({ id: c.id, title: c.title, memory: c.memory })),
    facts: (firstsFile as { entries: { id: string; category: string; question: string; answer: string; citations: string[] }[] }).entries,
  };
}

interface Photos {
  pack: BackgroundPack;
  ids: string[];
}

/** One card's photo: a few candidates are tried and the first portrait one is used (a portrait photo fills a portrait screen), else the tallest. */
async function pickPhoto(card: Card, photos: Photos[]): Promise<{ url: string; pack: BackgroundPack; id: string } | null> {
  if (photos.length === 0) return null;
  const h = hashOf(card.id);
  const set = photos[h % photos.length];
  let best: { url: string; id: string; ratio: number } | null = null;
  for (let k = 0; k < 3; k++) {
    const id = set.ids[(h + k * 7919) % set.ids.length];
    try {
      const [b64] = await api.backgroundImage(id, set.pack);
      const url = `data:image/jpeg;base64,${b64}`;
      const ratio = await new Promise<number>((resolve) => {
        const im = new Image();
        im.onload = () => resolve(im.naturalHeight / Math.max(1, im.naturalWidth));
        im.onerror = () => resolve(0);
        im.src = url;
      });
      if (ratio > 0 && (!best || ratio > best.ratio)) best = { url, id, ratio };
      if (ratio >= 1.1) break;
    } catch {
      /* try the next */
    }
  }
  return best ? { url: best.url, pack: set.pack, id: best.id } : null;
}

function CardView({ card, version, photos, root, onShare, onOpen, say, fail }: { card: Card; version: string; photos: Photos[]; root: React.RefObject<HTMLDivElement | null> } & Pick<Props, "onShare" | "onOpen" | "say" | "fail">) {
  const el = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [words, setWords] = useState<string | null>(null);
  const [shownIn, setShownIn] = useState(version);
  const [photo, setPhoto] = useState<{ url: string; pack: BackgroundPack; id: string } | null>(null);
  const ref = card.ref ? parseRef(card.ref) : null;
  const look = LOOKS[hashOf(card.id) % LOOKS.length];

  // a card is "near" when it is within a screen or so of the one on view: only then does it hold a photo
  useEffect(() => {
    if (!el.current) return;
    const o = new IntersectionObserver((e) => setNear(e[0].isIntersecting), { root: root.current, rootMargin: "100% 0px" });
    o.observe(el.current);
    return () => o.disconnect();
  }, [root]);

  useEffect(() => {
    if (!ref || words !== null) return;
    let live = true;
    (async () => {
      let text = await api.passage(version, ref.book, ref.chapter, ref.verse, ref.verseEnd > ref.verse ? ref.verseEnd : null);
      let inVersion = version;
      if (!text.trim() && version !== "BSB") {
        text = await api.passage("BSB", ref.book, ref.chapter, ref.verse, ref.verseEnd > ref.verse ? ref.verseEnd : null);
        inVersion = "BSB";
      }
      if (live) {
        setWords(text.trim());
        setShownIn(inVersion);
      }
    })().catch(() => live && setWords(""));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id, version]);

  useEffect(() => {
    if (!near) {
      setPhoto(null);
      return;
    }
    if (photo || photos.length === 0) return;
    let live = true;
    void pickPhoto(card, photos).then((p) => live && setPhoto(p));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, photos]);

  const bigText = card.ref ? (words ? trimWords(words, 420) : words) : card.text;
  const long = (bigText?.length ?? 0) > 230;
  // Quick share and Save make the picture at once with the reader's saved choices; Edit opens the studio
  const [busy, setBusy] = useState(false);
  const label = ref ? `${card.ref} · ${shownIn}` : card.kind === "fact" ? (card.note ?? card.title ?? "") : (card.title ?? "");
  const make = () => quickPicture({ text: bigText ?? "", label, photoUrl: photo?.url ?? null, lookIndex: hashOf(card.id) });
  async function quick(action: "share" | "save") {
    setBusy(true);
    try {
      const p = await make();
      if (action === "share") await phone.shareImages([p.data], [p.name], p.mime, p.caption);
      else say(`Saved in ${(await phone.saveToGallery([p.data], [p.name], p.mime)).where}`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  const edit = () => {
    if (ref) onShare({ book: ref.book, chapter: ref.chapter, first: ref.verse, last: ref.verseEnd, text: bigText ?? "", start: photo ? { pack: photo.pack, id: photo.id } : null });
    else onShare({ book: "", chapter: 0, first: 0, last: 0, text: card.text ?? "", free: { label: card.kind === "fact" ? (card.note ?? card.title ?? "") : (card.title ?? ""), text: card.text ?? "" }, start: photo ? { pack: photo.pack, id: photo.id } : null });
  };
  const open = () => {
    if (card.kind === "story" && card.open) onOpen({ to: "story", id: card.open });
    else if (card.kind === "author" && card.open) onOpen({ to: "author", name: card.open });
    else if (card.kind === "topic" && card.open) onOpen({ to: "topic", id: card.open });
    else if (card.kind === "memory" && card.open) onOpen({ to: "children", id: card.open });
    else if (card.kind === "fact") {
      const r = card.open ? parseRef(card.open) : null;
      if (r) onOpen({ to: "passage", book: r.book, chapter: r.chapter, verse: r.verse });
    }
    else if (ref) onOpen({ to: "passage", book: ref.book, chapter: ref.chapter, verse: ref.verse });
  };
  const hasWords = !!bigText;

  return (
    <section
      ref={el}
      className={"scroll-card" + (photo ? " photo" : "")}
      style={photo ? { backgroundImage: `url(${photo.url})` } : { background: `linear-gradient(160deg, ${look.colors.join(", ")})`, color: look.ink }}
      aria-label={card.title ?? card.ref ?? "Card"}
    >
      {photo && <div className="scroll-shade" aria-hidden />}
      <div className="scroll-body">
        <p className="scroll-kind">{kindLabel(card)}</p>
        {!card.ref && card.title && <h2 className="scroll-title">{card.title}</h2>}
        {hasWords ? <p className={"scroll-words" + (long ? " long" : "")}>{card.ref ? `“${bigText}”` : bigText}</p> : card.ref ? <p className="scroll-words faint">…</p> : null}
        {card.ref && (
          <p className="scroll-ref">
            {card.ref} · {shownIn}
          </p>
        )}
        {card.note && <p className="scroll-note">{card.note}</p>}
      </div>
      <div className="scroll-actions">
        <button className="scroll-open" onClick={open} hidden={card.kind === "fact" && !card.open}>
          {card.kind === "story" ? "Read the story ›" : card.kind === "author" ? "About the writer ›" : card.kind === "topic" ? "More on this ›" : card.kind === "memory" ? "The children's page ›" : "Read it in the Bible ›"}
        </button>
        <div>
          <button onClick={() => void quick("share")} disabled={busy || !hasWords}>
            Quick share
          </button>
          <button onClick={() => void quick("save")} disabled={busy || !hasWords}>
            Save
          </button>
          <button onClick={edit} disabled={!hasWords}>
            Edit
          </button>
        </div>
      </div>
    </section>
  );
}

export function DailyScroll({ version, hidden, onClose, onShare, onOpen, say, fail }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const today = useMemo(() => dayNumber(), []);
  const pool = useMemo(() => buildPool(sources()), []);
  const saved = useRef<Saved>(load());
  const [more, setMore] = useState(saved.current.more[String(today)] ?? 0);
  const deck = useMemo(() => buildDeck(pool, saved.current.history, today, more), [pool, today, more]);
  const [at, setAt] = useState(0);
  const [photos, setPhotos] = useState<Photos[]>([]);
  const [offer, setOffer] = useState<{ size_mb: number; count: number } | null>(null);
  const [getting, setGetting] = useState<number | null>(null);

  // what was shown today is remembered, so the same cards do not come back for 50 days (and reopening shows the same 20)
  useEffect(() => {
    const history = remember(saved.current.history, today, deck);
    store.set(KEY, JSON.stringify({ history, more: { [String(today)]: more } } satisfies Saved));
  }, [deck, today, more]);

  const loadPhotos = async () => {
    const found: Photos[] = [];
    for (const pack of ["christian", "nature"] as BackgroundPack[]) {
      try {
        const s = await api.backgroundsStatus(pack);
        if (s.count > 0) {
          const ids = (await api.backgroundsIds(pack)).map(([id]) => id);
          if (ids.length > 0) found.push({ pack, ids });
        } else if (pack === "christian") setOffer({ size_mb: s.size_mb || 12, count: s.latest || 55 });
      } catch {
        /* no pictures: colours */
      }
    }
    setPhotos(found);
    if (found.length > 0) setOffer(null);
  };
  useEffect(() => {
    void loadPhotos();
    const un = listen<number>("backgrounds-progress-christian", (e) => setGetting(e.payload));
    return () => void un.then((f) => f());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [declined, setDeclined] = useState(store.get(OFFER_KEY) === "no");
  async function getPictures() {
    setGetting(0);
    try {
      await api.backgroundsInstall("christian");
      await loadPhotos();
    } catch (e) {
      fail(e);
    } finally {
      setGetting(null);
    }
  }

  // where the feed was when it was last seen: the phone may reset a hidden list to its top, so it is put back when the scroll is shown again
  const keep = useRef(0);
  const onScroll = () => {
    const r = root.current;
    if (!r || hidden) return;
    keep.current = r.scrollTop;
    setAt(Math.round(r.scrollTop / Math.max(1, r.clientHeight)));
  };
  useEffect(() => {
    if (!hidden && root.current && Math.abs(root.current.scrollTop - keep.current) > 2) root.current.scrollTo({ top: keep.current, behavior: "instant" });
  }, [hidden]);
  const showMore = () => {
    // the new cards are put where the end card was, so the first of them comes into view in its place (the feed does not follow the end card down)
    setMore((m) => m + 1);
  };

  return (
    <div className={"scroll-overlay" + (hidden ? " away" : "")} role="dialog" aria-hidden={hidden} aria-label="Daily Scroll">
      <div className="scroll-top">
        <button className="scroll-close" onClick={onClose} aria-label="Close the Daily Scroll">
          ✕
        </button>
        <span className="scroll-count">{Math.min(at + 1, deck.length)} of {deck.length}</span>
      </div>
      {offer && !declined && photos.length === 0 && (
        <div className="scroll-offer">
          <p>Put each card on a photo? {offer.count} Christian pictures, about {offer.size_mb} MB, once.</p>
          {getting == null ? (
            <>
              <button className="primary" onClick={() => void getPictures()}>
                Get the pictures
              </button>
              <button
                onClick={() => {
                  store.set(OFFER_KEY, "no");
                  setDeclined(true);
                }}
              >
                Not now
              </button>
            </>
          ) : (
            <p>Downloading… {getting}%</p>
          )}
        </div>
      )}
      <div className="scroll-feed" ref={root} onScroll={onScroll}>
        {deck.map((c) => (
          <CardView key={c.id} card={c} version={version} photos={photos} root={root} onShare={onShare} onOpen={onOpen} say={say} fail={fail} />
        ))}
        <section key={`end-${more}`} className="scroll-card scroll-end">
          <div className="scroll-body">
            <p className="scroll-kind">That's all for now</p>
            <p className="scroll-words">{deck.length} cards today. A new set comes tomorrow.</p>
          </div>
          <div className="scroll-actions">
            <button className="primary" onClick={showMore}>
              Show me more
            </button>
            <button onClick={onClose}>Done</button>
          </div>
        </section>
      </div>
    </div>
  );
}

/** The Extras row, above Bible stories. */
export function DailyScrollEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <button className="more-row" onClick={onOpen}>
      <span className="more-row-title">Daily Scroll</span>
      <small>20 a day</small>
      <span className="dl-chev" aria-hidden>
        ›
      </span>
    </button>
  );
}
