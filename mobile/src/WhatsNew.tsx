import { useEffect, useState } from "react";

// What's new in version 3 (the phone's first big update): a small banner that comes up once, the first time the new version is opened on a phone that
// already had the app (a fresh install has nothing "new" to be told about), and that can be read again from More > About. The notes are plain
// sentences for people who are not developers.

export const WHATS_NEW_VERSION = "3.2.1";

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
  { title: "Find a Bible in your language", text: "More > Bible translations now begins with a search: type a language or a name (Afrikaans, Greek, Luther) and the Bibles that fit come first. It now also lists the Bibles of CrossWire's libraries, so hundreds more can be downloaded, an Afrikaans Bible among them. Library > Get more has a Bibles choice that opens the same list." },
  { title: "Search inside any Bible you add", text: "When you read a Bible you downloaded or added from a file, the search looks for your words in that Bible itself. If nothing is found there, it shows the verses from the BSB and says so." },
  { title: "Listen from a verse with the screen off", text: "Tap a verse, then Listen from here: the reading now keeps going with the screen off and goes on into the next chapters, with Pause, Previous and Next on the lock screen, just like the Listen button." },
  { title: "More in the Library", text: "Library > Get more now also lists the works of Wycliffe, the NET Bible and CrossWire's Attic, and you can choose any language instead of English only." },
  { title: "What a Hebrew or Greek word means", text: "Tap a verse, then Word study, then a word: its page now has Overview, Meanings, Where used and Library. Meanings shows every meaning the word has as a ring sized by how often each is used, with the one used in your verse chosen, what it is called in everyday English, example verses with the word marked, and the other words that share the meaning (tap one to open it). The phone's Back button steps back through the words you opened one from another." },
  { title: "Colouring pages to print", text: "On a children's page, Outline to colour in shows the drawing as an outline, and Print or share the outline opens your phone's share list: choose Print for a printer, or send it by WhatsApp or e-mail to print elsewhere." },
  { title: "36 more Bible stories, each with a children's page", text: "The app now comes with 67 Bible stories and 56 children's pages: Cain and Abel, the Ten Plagues, Samson, Esther, Elijah, the Fiery Furnace, the Last Supper, the Crucifixion and many more, each with a painting and, for the children's page, an outline to colour in. The Story pictures and Children's pictures downloads (More > Downloads) bring the pictures; download them again to get the new ones." },
  { title: "Stories in order, and the ones you have read", text: "Bible stories are now in two sections, Old Testament and New Testament, closed until you open one, with the stories in the order of the Bible. A tick and a quieter colour show the stories and children's pages you have opened, and each section says how many you have read. Searching still shows every match in one list. The list of what you have read goes into your backup." },
  { title: "Daily Scroll", text: "Extras > Daily Scroll: twenty cards a day, one idea on each, on a photo: a verse, a Bible story, who wrote a book, a Bible fact. Swipe up for the next card. Quick share sends the card as a picture, Save keeps it in your pictures, and Edit opens the picture studio. A new set comes each day, and Show me more adds ten." },
  { title: "Picture studio", text: "More > Make a picture, and Edit on any card, make a picture of a verse or your own words: portrait or square, five fonts, your own photo or ours behind the words, your logo wherever you drag it, and a set of several pictures at once." },
  { title: "How are you today?", text: "Extras > How are you today? Tap what is closest (anxious, tired, thankful…) and read a verse for it, with the story behind it one tap away. Pray about it, or learn the verse by heart, from the same screen." },
  { title: "Prayer list", text: "Extras > Prayer list keeps what you are praying about and, when God answers, how. It stays on your phone and goes into your backup." },
  { title: "Memory verses", text: "Learn Scripture by heart: add a verse (from Extras > Memory verses, a verse's menu, or How are you today?) and it comes back after a day, three days, a week and on, with part of the words hidden each time." },
  { title: "Listen with the screen off", text: "On the Read screen, the Listen button (beside About and Study notes) keeps reading, chapter after chapter, with the screen off, and gives you Pause, Previous and Next chapter on the lock screen. Chapters heard to the end count as read." },
  { title: "A different notification each day", text: "Choose a time in Extras (above Reading plans) and the phone tells you something different each day: the verse for the day, your Daily Scroll, a memory verse to practise, a prayer to remember. The same place can add the verse for the day to your home screen as a widget." },
  { title: "Commentaries on a verse", text: "Tap a verse, then Commentaries, to read what the commentaries you have installed say about it. All notes on the chapter are one tap further." },
  { title: "Other links", text: "More > Downloads > Other links lists the websites where e-Sword, MySword and MyBible files can be found, each opening in your browser. What is already on your phone now sits in one closed Installed row, so what you can still download comes first." },
  { title: "Themes", text: "Pick a theme for two colours behind every page and its own Gospel wordmark. In More > Appearance > Theme and colours the list shows each theme at once, so you can judge it before you decide." },
  { title: "Share a page", text: "Every Bible story, Verses for… page and children's page has a Share button at the bottom: it sends the page, set out as it is here with the Scripture words, and the picture too when you have downloaded the pictures, by WhatsApp, e-mail or anything else your phone offers." },
  { title: "More stories", text: "\"Fetch additional stories\" at the bottom of each list brings any new stories, Verses for… pages and children's pages added since this version of the app, with no update needed." },
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
        <strong>What's new in this version</strong>
        <button className="remove" onClick={close} aria-label="Close">
          ×
        </button>
      </div>
      {mode === "banner" ? (
        <>
          <p>What every Hebrew and Greek word means, with a ring of its meanings and example verses; a Daily Scroll of verse cards, your own verse pictures, a prayer list and memory verses, Listen with the screen off, and 36 more Bible stories with children's pages.</p>
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
