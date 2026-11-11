// "Other links" (More): the websites where people share e-Sword, MySword and MyBible files. The app only opens them in the phone's browser; it never
// downloads from them. This is a COPY of the computer app's list (src/components/LibraryPanel.tsx: COMMUNITY and MYSWORD) with the same names and the same
// words, kept as data so that taking one site out is a one-line change. If one list changes, change the other (mobile/scripts/test_library_sites.mts
// compares them). The phone opens https addresses only, so BibleSupport's address is its https one (it answers: checked 2026-11-11).

export interface Site {
  name: string;
  url: string;
  about: string;
}

/** Said above the list, in plain words. */
export const SITES_NOTE =
  "These websites are separate from Bible Concordance and have no connection with it. Nothing from them is included in the app, and the app never downloads from them. Check each file's rights before you download it, then add it with Add from a file in the Library.";

export const SITES: Site[] = [
  {
    name: "BibleSupport",
    url: "https://www.biblesupport.com/e-sword-downloads/",
    about: "The largest: thousands of e-Sword and MySword modules, by category. Downloading needs a free account there. Each module says whether it is public domain or copyrighted.",
  },
  {
    name: "eswordlibrary.com",
    url: "https://www.eswordlibrary.com/",
    about: "e-Sword modules by kind; downloads without an account.",
  },
  {
    name: "bible.org",
    url: "https://bible.org/article/e-sword%C2%AE-modules-bibleorg",
    about: "bible.org's own studies and articles (Keathley and others) as e-Sword modules, shared by their publisher.",
  },
  {
    // The MyBible-format files the app can add. A separate website with no connection to this app: it also offers modern translations that are still in
    // copyright, which is why the note above the list tells the reader to check each file's rights. Delete this entry to take the link out.
    name: "PH4.org",
    url: "https://www.ph4.org/b4_1.php?l=en",
    about: "Bibles, commentaries, dictionaries and devotionals in the MyBible format (and others), by language; no account. A separate website, not part of this app.",
  },
];

/** MySword's own downloads, by kind: straight from its website, no account. [label, the end of the address] */
export const MYSWORD: [string, string][] = [
  ["Bibles", "bibles"],
  ["Commentaries", "commentaries"],
  ["Dictionaries", "dictionaries"],
  ["Books", "books"],
  ["Devotionals", "devotionals"],
];

export const MYSWORD_ABOUT = "MySword's own downloads, straight from its website, no account.";

export const mySwordUrl = (path: string) => `https://www.mysword.info/download-mysword/${path}`;
