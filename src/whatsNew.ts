// What changed in each version, shown once in a "What's new" window after an update (and from Settings > About).
// Add the newest version first. Plain sentences: this is read by people who are not developers.

export interface WhatsNewEntry {
  version: string;
  items: string[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
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
