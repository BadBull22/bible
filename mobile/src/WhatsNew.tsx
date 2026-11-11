import { useEffect, useState } from "react";

// What's new in version 3 (the phone's first big update): a small banner that comes up once, the first time the new version is opened on a phone that
// already had the app (a fresh install has nothing "new" to be told about), and that can be read again from More > About. The notes are plain
// sentences for people who are not developers.

export const WHATS_NEW_VERSION = "3.0.0";

const SEEN_KEY = "pocket:whats-new-seen";
const SAVED_KEY = "pocket:state"; // the app's saved settings: there from the second start of any install

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a convenience only */
  }
};

// Decided once, as the app starts (before anything is saved): an install that already had its settings meets the notes once; a brand-new one never does.
const SHOW_NOW = read(SEEN_KEY) !== WHATS_NEW_VERSION && read(SAVED_KEY) !== null;
if (read(SEEN_KEY) !== WHATS_NEW_VERSION) write(SEEN_KEY, WHATS_NEW_VERSION);

/** The notes, the newest first: a short title and one or two plain sentences. */
export const WHATS_NEW: { title: string; text: string }[] = [
  { title: "Themes", text: "Pick a theme for two colours behind every page and its own Gospel wordmark. In More > Appearance > Theme and colours the list shows each theme at once, so you can judge it before you decide." },
  { title: "Extras", text: "The Plans tab is now Extras: 31 Bible stories, Verses for… pages, pages for children and the Bible maps, the Authors of the Bible and the dictionary, with the reading and the plans below. The scripture inside a story is tappable." },
  { title: "Back to where you were", text: "After following a Bible link from a story, a map or a search result, a Back bar (and the phone's Back button) takes you to the same place again." },
  { title: "A clean Search page", text: "The Gospel wordmark, your search box, Continue reading and your recent searches. The house button clears a search." },
  { title: "Ask", text: "More questions have a written answer that quotes the Bible first and shows where Christians differ. Questions about people and places are answered from the Bible's own lists, and a misspelt word is put right." },
  { title: "Downloads together", text: "More now holds the settings only: Advanced search, Original words, the Bible story and children's pictures and your Bibles are all in one Downloads list, one button each." },
  { title: "Strong's numbers", text: "A Bible you add from a file that carries Strong's numbers keeps them: tap a word for its Hebrew or Greek." },
  { title: "Share a verse", text: "A picture of the verse for today can carry up to three verses. With sync on, your reading streak is shared with the computer app." },
];

/** The banner: a headline and two buttons, which opens out into everything that is new. `mode` null: not shown. */
export function useWhatsNew() {
  const [mode, setMode] = useState<"banner" | "all" | null>(null);
  useEffect(() => {
    if (!SHOW_NOW) return;
    const t = window.setTimeout(() => setMode((m) => m ?? "banner"), 1400); // after the app has drawn itself
    return () => window.clearTimeout(t);
  }, []);
  return { mode, showAll: () => setMode("all"), close: () => setMode(null) };
}

export function WhatsNewBanner({ mode, showAll, close }: { mode: "banner" | "all" | null; showAll: () => void; close: () => void }) {
  if (!mode) return null;
  return (
    <aside className={mode === "all" ? "whatsnew all" : "whatsnew"} role="status" aria-label="What's new">
      <div className="whatsnew-head">
        <strong>What's new in version 3</strong>
        <button className="remove" onClick={close} aria-label="Close">
          ×
        </button>
      </div>
      {mode === "banner" ? (
        <>
          <p>Themes you can preview, Bible stories and maps, better answers in Ask, optional pictures and a tidier More.</p>
          <div className="actions">
            <button onClick={showAll}>See everything new</button>
            <button className="primary" onClick={close}>
              Got it
            </button>
          </div>
        </>
      ) : (
        <>
          <ul className="whatsnew-list">
            {WHATS_NEW.map((n) => (
              <li key={n.title}>
                <strong>{n.title}.</strong> {n.text}
              </li>
            ))}
          </ul>
          <div className="actions">
            <button className="primary" onClick={close}>
              Got it
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
