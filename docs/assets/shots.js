/* ONE list of every screenshot. To add one: put the .jpg in assets/shots/ and add a line here.
   The home page strip, the Screenshots page and the lightbox all read this list.
   dev: "win" | "phone".  topic: read | study | stories | daily | pictures | present */
window.SHOTS = [
  /* ---- phone (version 3.1.2, 540 x 960) ---- */
  { dev: "phone", topic: "daily",    f: "p-daily-scroll",    t: "Daily Scroll",                        c: "Twenty cards a day: a verse, a Bible story or a Bible fact on a photo. Share it, save it, or open it in the picture studio." },
  { dev: "phone", topic: "stories",  f: "p-stories",         t: "Bible stories, Old and New Testament", c: "Two short lists in the order of the Bible, with a tick on the stories you have read." },
  { dev: "phone", topic: "stories",  f: "p-story-painting",  t: "A story with its painting",           c: "Cain and Abel, with a painting by James Tissot and the picture's credit." },
  { dev: "phone", topic: "stories",  f: "p-children",        t: "A page for children",                 c: "A simple retelling, a memory verse, three questions and something to try." },
  { dev: "phone", topic: "stories",  f: "p-outline",         t: "An outline to colour in",             c: "Switch the children's picture to an outline, print it and colour it." },
  { dev: "phone", topic: "daily",    f: "p-how-are-you",     t: "How are you today?",                  c: "Tap how you feel (anxious, tired, thankful...) and read a verse for it, with the story behind it one tap away." },
  { dev: "phone", topic: "daily",    f: "p-feelings",        t: "Sixteen ways to say how you are",     c: "From anxious to thankful: one tap takes you to a verse." },
  { dev: "phone", topic: "daily",    f: "p-prayer-list",     t: "Prayer list",                         c: "Keep what you are praying about, and how God answered." },
  { dev: "phone", topic: "read",     f: "p-listen",          t: "Listen with the screen off",          c: "The Bible read aloud chapter after chapter, with Pause, Previous and Next on the lock screen." },
  { dev: "phone", topic: "read",     f: "p-ask",             t: "Ask a question",                      c: "\"Why did Jesus weep?\" answered with the Bible's own words first, every passage a tap away." },
  { dev: "phone", topic: "read",     f: "p-themes",          t: "Themes",                            c: "The list shows each theme's colours, with a live preview of its Gospel wordmark." },
  { dev: "phone", topic: "read",     f: "p-dark",            t: "Dark mode",                           c: "The same Search page in dark mode." },
  { dev: "phone", topic: "study",    f: "p-word",            t: "Word study",                          c: "Tap a word for its Greek or Hebrew, with its meaning and every use." },
  { dev: "phone", topic: "stories",  f: "p-maps",            t: "Bible maps",                          c: "Paul's journeys, to zoom and drag, with the passages it goes with. Nine maps in all." },
  { dev: "phone", topic: "pictures", f: "p-make-picture",    t: "Make a verse picture",                c: "A verse on a photo: fonts, colours, your logo, portrait or square." },
  { dev: "phone", topic: "daily",    f: "p-extras",          t: "Everything in one place",             c: "Daily Scroll, stories, verse pages, children's pages, maps, prayer list and memory verses." },

  /* ---- Windows (1400 wide) ---- */
  { dev: "win", topic: "stories",  f: "w-stories",         t: "Bible stories, Old and New Testament", c: "Stories in Bible order in an Old and a New Testament section, with a tick on the ones you have read (here 4 of 38)." },
  { dev: "win", topic: "stories",  f: "w-story-painting",  t: "A story with its painting",            c: "A short retelling, the passages to read in your own Bible, and a painting with its credit." },
  { dev: "win", topic: "stories",  f: "w-children",        t: "A children's page with its picture",   c: "Read together, learn the memory verse, talk about it, and print the picture to colour." },
  { dev: "win", topic: "study",    f: "w-concordance",     t: "Concordance by meaning",               c: "Search by meaning, not only by word: love, affection and compassion, counted book by book." },
  { dev: "win", topic: "study",    f: "w-meanings",        t: "The ring of meanings",                 c: "How a Greek word (here G863, forgive) is used: each sense as part of a ring, from \"to pardon\" to \"to let go\"." },
  { dev: "win", topic: "study",    f: "w-meaning-detail",  t: "Meaning in everyday English",          c: "One meaning in plain English, the words people use for it, where it is found in the Bible, and examples." },
  { dev: "win", topic: "study",    f: "w-meaning-tree",    t: "Where a meaning sits",                 c: "A word's place in the family of meanings (here Love, Affection, Compassion), with a plain-English description." },
  { dev: "win", topic: "study",    f: "w-original-words",  t: "The words behind a word",              c: "\"Forgive\" appears 66 times in 58 verses: the Hebrew and Greek words behind it, and where it is used." },
  { dev: "win", topic: "read",     f: "w-ask",             t: "Ask a question",                       c: "\"What does the Bible say about worry?\": verses on anxiety above an answer that quotes the Bible." },
  { dev: "win", topic: "read",     f: "w-theme",           t: "Themes",                               c: "The opening screen in the Miracles theme. There is a look for each season of the church year." },
  { dev: "win", topic: "study",    f: "w-interlinear",     t: "Greek interlinear",                    c: "John 3 beside the Greek: each word with its Strong's number, meaning and grammar." },
  { dev: "win", topic: "study",    f: "w-commentary",      t: "Commentaries",                         c: "A commentary beside the chapter (here John Wesley's notes). Choose among seven." },
  { dev: "win", topic: "study",    f: "w-crossref",        t: "Cross-reference web",                  c: "Click a verse to follow a link, double-click to branch out further." },
  { dev: "win", topic: "stories",  f: "w-maps",            t: "Bible maps",                           c: "Nine ready-made maps, from the twelve tribes to Paul's journeys." },
  { dev: "win", topic: "study",    f: "w-map",             t: "The map of the biblical world",        c: "Built in and working offline: ancient or modern names, kingdoms by era, and a search." },
  { dev: "win", topic: "present",  f: "w-sermon",          t: "Sermon builder",                       c: "Scripture, commentary and background gathered on the left, the sermon taking shape on the right." },
  { dev: "win", topic: "present",  f: "w-slides",          t: "Slides from your sermon",              c: "Present with a presenter view, or save as PowerPoint or ProPresenter." },
  { dev: "win", topic: "present",  f: "w-service",         t: "Sunday service",                       c: "Notices, music and sermon made apart, with buttons to print the bulletin and present." },
  { dev: "win", topic: "pictures", f: "w-factory",         t: "Content Factory",                      c: "A verse picture of Psalm 23 with the tool bar beside it." },
  { dev: "win", topic: "pictures", f: "w-picture-set",     t: "A set of seven verse pictures",        c: "Each with a different look, ready to post." },
  { dev: "win", topic: "read",     f: "w-library",         t: "The free library",                     c: "Recommended free translations and hundreds of free books, commentaries and dictionaries." }
];
window.TOPICS = [["all", "All"], ["read", "Read and ask"], ["study", "Study"], ["stories", "Stories and children"], ["daily", "Daily life"], ["pictures", "Pictures"], ["present", "Preach and present"]];
window.shotSrc = function (s) { return "assets/shots/" + s.f + ".jpg"; };
