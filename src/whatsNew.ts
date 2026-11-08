// What changed in each version, shown once in a "What's new" window after an update (and from Settings > About).
// Add the newest version first. Plain sentences: this is read by people who are not developers.

export interface WhatsNewEntry {
  version: string;
  items: string[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: "2.10.0",
    items: [
      "Bibles you add to the Library that carry Strong's numbers (the KJV from CrossWire, MyBible files whose names end in a plus, and others) now show them: click a word for its Hebrew or Greek. The Translation list says “· Strong's” beside them.",
      "Sunday service > Print the bulletin: an order of service with the notices, the songs' titles and the message, to print, save as a PDF or Word document, or copy.",
      "Presenter > Phone remote: use your phone on the same Wi-Fi as the clicker, with Next, Back, Black, the next slide and your notes. It is off until you switch it on.",
      "Settings > Appearance: the opening screen can wear a themed Gospel wordmark with small decorations and a verse of the season (24 themes: the church year from Advent to Trinity Sunday, Passover, Communion, Harvest, Mother's Day, Father's Day and more, plus Healing, Miracles, Sea of Galilee, Warm paper and Night reading). Near a season the app can switch to its theme and ask whether to keep it. You can also choose your interface font and your Bible reading font.",
      "Map > Bible maps: nine ready-made maps (the twelve tribes, the kingdoms, the ministry of Jesus, Paul's journeys and more) to zoom and drag, each with the passages it goes with. The drawn map is now the “Interactive map” tab, and an atlas you add from a download still has its own tab.",
    ],
  },
  {
    version: "2.9.9",
    items: [
      "The app opens on the Bible you chose last time, and the opening screen has a “Continue reading” button that takes you back to where you were.",
      "Click the “Authors” figure on the opening screen to see the 40 people who wrote the Bible, with a note on each and the books they wrote. “Chapters” now takes you to the start of the New Testament, as “Books” takes you to Genesis.",
      "The verse of the day is shown in your chosen Bible.",
      "A reading streak: a chapter counts as read when you reach its end, and the opening screen shows your days in a row and how many chapters you have read.",
      "Your notes, highlights, bookmarks, plans and sermons are now backed up automatically once a week, into your Documents folder (Settings > Back up your notes lets you change the folder, back up now, or switch it off).",
      "Settings > About has a link to the bible4me.org website, a button to rate the app on the Microsoft Store, and one to tell a friend. The credits and licences for everything in the app are now on the website too (linked from Settings, at the end of the list of sources).",
      "Library > Add from file lists websites where you can find Bibles and modules to add yourself, and now includes PH4.org (MyBible format). They are separate from the app, which never downloads from them.",
      "Read aloud: the natural voice is started in the background once after each update, so the first Listen is not slow, and if it ever fails the app uses the Windows voice only for a minute before trying the natural voice again.",
      "If the window ever fails to open because another program is in the way (a graphics overlay such as RivaTuner, or an antivirus), the app now says so and what to try.",
    ],
  },
];

/** The notes for a version, if there are any. */
export function whatsNewFor(version: string): WhatsNewEntry | null {
  return WHATS_NEW.find((e) => e.version === version) ?? null;
}
