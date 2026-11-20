// What changed in each version, shown once in a "What's new" window after an update (and from Settings > About).
// Add the newest version first. Plain sentences: this is read by people who are not developers.

export interface WhatsNewEntry {
  version: string;
  items: string[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: "3.1.4",
    items: [
      "Bible Concordance for Android is now live too, free in Google Play: scan the code above with your phone's camera. Your notes, highlights and reading plans can keep in step with this app over your own Wi-Fi.",
      "One page for every Hebrew or Greek word (it replaces Word Study): press a word's Strong's number anywhere (the Interlinear, a Meaning list, the words behind an English word, a tapped word in the Bible text) and its page opens with Overview, Meanings, Where used, Same meaning and Library. Same meaning lists every word in the group, and Open the whole tree goes to the tree of meanings.",
      "Hear a word: a speaker button beside every Hebrew or Greek word says it with the natural voice, a little slowly. Greek is said the classical way it is taught, Hebrew the modern way, from its vowel marks. The natural voice is in Settings > Read aloud.",
      "Back: the Back button in a side panel's header takes you back through the panels you came from (Interlinear, then a word's page, then its meanings), at the same verse.",
      "Concordance > Meaning: every word of a group is listed (the 40 used in the most verses, then Show all), each with its Strong's number, its meaning and the verses it is used in. Press a word to open its page.",
      "If the Bible you read has no Strong's numbers loaded, the screens now say so and use the BSB for the examples (the BSB and KJV have them). A Bible you add from a file that carries Strong's numbers keeps them, and now works in the word page, the meanings and the words behind an English word.",
    ],
  },
  {
    version: "3.1.3",
    items: [
      "Concordance > Strong's number: a Hebrew or Greek word's meanings drawn as a ring, sized by how many verses use each, with what each meaning is called in everyday English, where in the Bible it is used and some verses with the word marked. Open it from the Interlinear with All meanings, and the meaning used in that verse is chosen.",
      "Concordance > Word: type love, forgive or Christ and see the Hebrew and Greek words behind it; press one to see its meanings.",
      "Concordance > Meaning: a group of meanings shown in its tree, with the groups beside it and the words inside it. Press a neighbouring group to go to it.",
      "A strip from Genesis to Revelation shows where a word, meaning or group is used, instead of the 66 boxes (the numbers are still there under it). Press a bar to read that book's verses.",
      "Plain-English descriptions, related groups and everyday words come from the SIL Semantic Domains list (SIL Global, CC BY-SA 4.0), matched to every Greek group and to most Hebrew groups. A word the UBS dictionaries leave out shows its Strong's definition.",
    ],
  },
  {
    version: "3.1.2",
    items: [
      "Browse: 36 more Bible stories come with the app, each with a children's page and a picture (67 stories and 56 children's pages in all). The children's pages' pictures are paintings with an outline to colour in, for the activity sheet.",
      "Browse > Bible stories and For children: the lists are in sections (Old Testament and New Testament; ages 3 to 5, 6 to 8, 9 to 12), closed until you open one, and the stories are in the order of the Bible.",
      "Browse: the stories and children's pages you have opened show a tick and a quieter colour, each section says how many you have read, and Mark all as unread starts again. A search still shows every match in one list.",
    ],
  },
  {
    version: "3.1.1",
    items: [
      "Concordance > Meaning: search by what words mean, in Hebrew and Greek. Type love, forgive, joy or fear (or open the groups), and see every word with that meaning, how many verses use them in each book, and the verses. Choose one word in a group to see only that word.",
      "Concordance > Strong's number: type G26 or H157 to count the Greek or Hebrew word behind a Strong's number, book by book, and read its verses.",
      "Interlinear: under a word's Strong's number, “Meaning here” shows the meaning the dictionary gives it in that verse and its group. The meanings are from the UBS dictionaries of Biblical Hebrew and of the Greek New Testament (CC BY-SA 4.0).",
      "Presenter > CCLI line: show the song's title, writer and CCLI number small at the foot of its slides, when you switch it on. The same switch puts the line at the foot of the song slides in the PowerPoint and ProPresenter files you save.",
      "Slide show timing (notices and music pages, and the presenter's Auto button): slides can move on by themselves after the number of seconds you choose, start again at the end, and fade (none, short or slow) between slides. A slide can have a time of its own.",
      "Presenter > Phone remote > The pastor's stage view: a page for a tablet or second phone with the slide and the next one large, your notes, the clock, a timer and Back, Black and Next.",
      "Presenter > Follow along: people on the church Wi-Fi can read the words on the screen on their own phones, read only, with a QR code to show. Off until you switch it on.",
      "Music page > OpenSong songs… and An OpenSong folder…: bring your church's songs from OpenSong into your saved songs, with their parts, order, writer and CCLI number.",
      "Songs: words pasted with no headings are now named more closely: Chorus, Pre-Chorus, Bridge, Tag and Verse 1, 2…",
      "Content Factory > Photos > Paintings now opens every Bible painting you have downloaded (James Tissot, Gustave Doré, Sweet Publishing) to put behind the words, not only the ones for the verse on show. Choose a collection or a book, or find a painting by words. The credit line a licence asks for is added to the picture for you.",
    ],
  },
  {
    version: "3.1.0",
    items: [
      "Concordance (Reference menu): type a word and see how many times it is used in every book of the Bible, with the Old and New Testament totals. Tap a book to read its verses with the word marked. “And its forms” counts believe, believes, believed and believing together.",
      "Content Factory (Explore menu): make verse pictures, sets of pictures from several verses (a different look on each) and short videos with music, ready to post. Put your name, a logo or a banner in a header and footer, soften a photo behind the words, and pick text colours that stay easy to read. The pictures and videos are kept in Documents > Bible Concordance > Content Factory.",
      "Content Factory > Photos: a second set of 331 nature photos and a set of 55 Christian pictures can be downloaded if you want them; you can also add your own photos. The app writes the credit line a photo needs on the picture's footer.",
      "Content Factory > On my phone: scan a code and your saved pictures and videos open on your phone over your home Wi-Fi, where you can save them to post. Nothing to install, nothing goes through the internet; it is off until you switch it on.",
      "Settings > Keep in step: you can also put your finished pictures in the shared OneDrive, Google Drive or Dropbox folder, for the phone.",
      "Browse: a “Fetch additional stories” button at the bottom of Bible stories, Verses for… and For children brings in new stories and pages (with their pictures) added since this version of the app, without a new version. They are kept on your computer and work offline.",
      "Settings > Backup and restore: Back up now, Restore latest (it uses the newest backup it finds, and asks you to choose a file only if there is none) and Restore from a file…. My Study's Export and Import buttons are now called Back up and Restore.",
      "Fixed: the questions that guard a deletion (remove a saved song, a notice or a service list, stop a reading plan, remove the natural voice) did not wait for your answer; they now do.",
      "Your backups (My Study > Back up, the weekly automatic backup) now keep the Content Factory's names, logos, header and footer and its Ready to post list, and a backup made on the phone app can be imported.",
    ],
  },
  {
    version: "3.0.0",
    items: [
      "Browse: 31 Bible stories, 22 “Verses for…” pages (for anxiety, fear, hope, joy, love, wisdom, heaven and more) and 20 children's pages to read together, print and colour. Find them from the opening screen and the Explore menu.",
      "Ask: more than 400 questions now have a written answer that quotes the Bible first and says where Christians hold different views, including a short overview of each of the 66 books. Under an answer the app offers the matching stories and “Verses for…” pages.",
      "Settings > About: “Write a review on the Microsoft Store”. After some days of use the app may also ask, once in a while, whether you would leave a review; you can answer “Don't ask again” and it never will.",
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
