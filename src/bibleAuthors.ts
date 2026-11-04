// The people who wrote the Bible, for the Authors page (the "Authors" tile on the opening screen).
//
// This is written for the app, not taken from a dataset: the bundled data has no authorship field.
// It follows the long-standing traditional attributions, and says for each writer whether the
// text itself names them, whether it is tradition, or whether the writer is not named at all.
// Counts of "the authors of the Bible" vary a little (it depends on how the books with no named
// writer are credited); this list has 40, the usual round figure.
//
// Book names are spelled exactly as the app's own book list spells them (they are used to open the book).

export type AuthorBasis = "named" | "tradition" | "unknown";

export const BASIS_LABEL: Record<AuthorBasis, string> = {
  named: "Named in the text",
  tradition: "Credited by tradition",
  unknown: "Writer not named",
};

export interface BibleAuthor {
  name: string;
  testament: "Old Testament" | "New Testament";
  /** one or two plain sentences about who they were */
  note: string;
  /** what they wrote, in the order the app lists the books */
  books: string[];
  /** which part of a book, or how sure the attribution is */
  detail?: string;
  basis: AuthorBasis;
}

export const BIBLE_AUTHORS: BibleAuthor[] = [
  // ---------------------------------------------------------------- Old Testament: law and history
  {
    name: "Moses",
    testament: "Old Testament",
    note: "Born a Hebrew and raised in Pharaoh's household, he was called at the burning bush to bring Israel out of Egypt. He received the Law at Sinai and led the people for forty years in the wilderness.",
    books: ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy"],
    detail:
      "Also Psalm 90. The five books do not name their writer, but Scripture says Moses wrote the law down (Exodus 24:4; Deuteronomy 31:9) and Jesus spoke of what “Moses wrote” (John 5:46). The account of his death at the end of Deuteronomy was added by another hand.",
    basis: "tradition",
  },
  {
    name: "Joshua",
    testament: "Old Testament",
    note: "Moses' assistant, and one of the two spies who trusted God. He led Israel across the Jordan into the promised land.",
    books: ["Joshua"],
    detail: "Joshua 24:26 says he wrote down the covenant in the Book of the Law of God.",
    basis: "tradition",
  },
  {
    name: "Samuel",
    testament: "Old Testament",
    note: "Prophet and last of the judges. He anointed Saul, and then David, as Israel's first kings.",
    books: ["Judges", "Ruth", "1 Samuel", "2 Samuel"],
    detail:
      "Jewish tradition credits Samuel with Judges, Ruth and the first part of 1 Samuel. The record was carried on by the prophets Nathan and Gad (1 Chronicles 29:29), who are traditionally credited with the rest of 1 Samuel and with 2 Samuel.",
    basis: "tradition",
  },
  {
    name: "Ezra",
    testament: "Old Testament",
    note: "A priest and scribe who led a company of exiles home from Babylon and taught them the law of God (Ezra 7).",
    books: ["1 Chronicles", "2 Chronicles", "Ezra"],
    detail: "Jewish tradition credits him with Ezra and with 1 and 2 Chronicles (a single book in the Hebrew Bible).",
    basis: "tradition",
  },
  {
    name: "Nehemiah",
    testament: "Old Testament",
    note: "Cupbearer to the Persian king, who came back to Jerusalem and rebuilt its walls in fifty-two days (Nehemiah 6:15).",
    books: ["Nehemiah"],
    detail: "The book opens “The words of Nehemiah” and much of it is in his own voice.",
    basis: "named",
  },
  {
    name: "Mordecai",
    testament: "Old Testament",
    note: "Esther's cousin, who raised her and rose to be second only to the king of Persia.",
    books: ["Esther"],
    detail: "The book does not name its writer. Esther 9:20 says Mordecai wrote down these events, and he is the traditional view.",
    basis: "tradition",
  },
  // ---------------------------------------------------------------- Old Testament: psalms and wisdom
  {
    name: "The writer of Job",
    testament: "Old Testament",
    note: "The book is about Job, “blameless and upright”, who lost everything and still held on to God (Job 1:1; 42:5).",
    books: ["Job"],
    detail: "The book does not name its writer. Tradition suggests Job himself, Moses or Elihu, and many place the story in the age of the patriarchs.",
    basis: "unknown",
  },
  {
    name: "David",
    testament: "Old Testament",
    note: "Shepherd, giant-killer and Israel's greatest king, “a man after God's own heart” (1 Samuel 13:14; Acts 13:22), and “the sweet psalmist of Israel” (2 Samuel 23:1).",
    books: ["Psalms"],
    detail:
      "About 73 of the 150 psalms carry his name in their titles. The New Testament credits him with more, such as Psalm 2 (Acts 4:25) and Psalm 95 (Hebrews 4:7).",
    basis: "named",
  },
  {
    name: "Asaph",
    testament: "Old Testament",
    note: "A Levite and musician whom David set over the worship before the ark (1 Chronicles 16:4–5).",
    books: ["Psalms"],
    detail: "Psalms 50 and 73–83.",
    basis: "named",
  },
  {
    name: "The sons of Korah",
    testament: "Old Testament",
    note: "A family of Levites who served as singers and gatekeepers in the house of God. They are a family, not one person.",
    books: ["Psalms"],
    detail: "Psalms 42, 44–49, 84, 85, 87 and 88.",
    basis: "named",
  },
  {
    name: "Heman the Ezrahite",
    testament: "Old Testament",
    note: "A wise man of the days of Solomon (1 Kings 4:31).",
    books: ["Psalms"],
    detail: "Psalm 88, which he shares with the sons of Korah.",
    basis: "named",
  },
  {
    name: "Ethan the Ezrahite",
    testament: "Old Testament",
    note: "Another wise man of the time of Solomon (1 Kings 4:31).",
    books: ["Psalms"],
    detail: "Psalm 89.",
    basis: "named",
  },
  {
    name: "Solomon",
    testament: "Old Testament",
    note: "David's son and king of Israel, known for the wisdom God gave him (1 Kings 3:12) and for building the first temple.",
    books: ["Proverbs", "Ecclesiastes", "Song of Solomon"],
    detail:
      "Also Psalms 72 and 127. Proverbs and the Song name him. Ecclesiastes is by “the Teacher, son of David, king in Jerusalem”, whom tradition takes to be Solomon. Hezekiah's men copied out Proverbs 25–29 (Proverbs 25:1).",
    basis: "named",
  },
  {
    name: "Agur",
    testament: "Old Testament",
    note: "Agur son of Jakeh, of whom nothing more is known.",
    books: ["Proverbs"],
    detail: "Proverbs 30, “the words of Agur”.",
    basis: "named",
  },
  {
    name: "Lemuel",
    testament: "Old Testament",
    note: "A king whose mother taught him a message, which is written down for us. Nothing more is known of him.",
    books: ["Proverbs"],
    detail: "Proverbs 31:1–9.",
    basis: "named",
  },
  // ---------------------------------------------------------------- Old Testament: prophets
  {
    name: "Isaiah",
    testament: "Old Testament",
    note: "Prophet in Jerusalem under four kings of Judah (Isaiah 1:1). He foretold the virgin-born Immanuel and the suffering Servant (Isaiah 7:14; 53).",
    books: ["Isaiah"],
    basis: "named",
  },
  {
    name: "Jeremiah",
    testament: "Old Testament",
    note: "Called as a young man to warn Judah before Babylon destroyed Jerusalem. He is often called the weeping prophet.",
    books: ["1 Kings", "2 Kings", "Jeremiah", "Lamentations"],
    detail: "Jewish tradition also credits him with 1 and 2 Kings. His secretary Baruch wrote down his words (Jeremiah 36:4).",
    basis: "named",
  },
  {
    name: "Ezekiel",
    testament: "Old Testament",
    note: "A priest taken to Babylon with the exiles, who saw the glory of God by the Kebar River and a valley of dry bones raised to life (Ezekiel 1; 37).",
    books: ["Ezekiel"],
    basis: "named",
  },
  {
    name: "Daniel",
    testament: "Old Testament",
    note: "Taken to Babylon as a young man, he served in the courts of Babylon and Persia and was given visions of the kingdoms to come.",
    books: ["Daniel"],
    basis: "named",
  },
  {
    name: "Hosea",
    testament: "Old Testament",
    note: "Prophet to the northern kingdom, told to marry Gomer as a picture of God's faithful love for an unfaithful people.",
    books: ["Hosea"],
    basis: "named",
  },
  {
    name: "Joel",
    testament: "Old Testament",
    note: "Prophet to Judah, who wrote of a plague of locusts and of the day God would pour out His Spirit on all flesh (Joel 2:28). Peter quoted it at Pentecost (Acts 2:16–21).",
    books: ["Joel"],
    basis: "named",
  },
  {
    name: "Amos",
    testament: "Old Testament",
    note: "A shepherd and fig-grower from Tekoa whom God sent to speak against injustice in the northern kingdom (Amos 1:1; 7:14–15).",
    books: ["Amos"],
    basis: "named",
  },
  {
    name: "Obadiah",
    testament: "Old Testament",
    note: "He wrote the shortest book of the Old Testament, a warning to Edom.",
    books: ["Obadiah"],
    basis: "named",
  },
  {
    name: "Jonah",
    testament: "Old Testament",
    note: "Sent to Nineveh, he first ran the other way and was swallowed by a great fish. Jesus pointed to his three days in the fish as a sign (Matthew 12:39–40).",
    books: ["Jonah"],
    detail: "The book tells his story without saying he wrote it; Jonah is the traditional writer.",
    basis: "tradition",
  },
  {
    name: "Micah",
    testament: "Old Testament",
    note: "A prophet from Moresheth in Judah, in the days of Isaiah, who named Bethlehem as the birthplace of the coming ruler (Micah 5:2).",
    books: ["Micah"],
    basis: "named",
  },
  {
    name: "Nahum",
    testament: "Old Testament",
    note: "He foretold the fall of Nineveh, the capital of Assyria.",
    books: ["Nahum"],
    basis: "named",
  },
  {
    name: "Habakkuk",
    testament: "Old Testament",
    note: "He brought his questions about injustice to God, and was answered: “the righteous shall live by his faith” (Habakkuk 2:4).",
    books: ["Habakkuk"],
    basis: "named",
  },
  {
    name: "Zephaniah",
    testament: "Old Testament",
    note: "Prophet in Judah in the days of King Josiah (Zephaniah 1:1), who warned of the day of the Lord.",
    books: ["Zephaniah"],
    basis: "named",
  },
  {
    name: "Haggai",
    testament: "Old Testament",
    note: "He urged the exiles who had come home to Jerusalem to finish rebuilding the temple.",
    books: ["Haggai"],
    basis: "named",
  },
  {
    name: "Zechariah",
    testament: "Old Testament",
    note: "Prophet to the returned exiles, with eight night visions and the promise of a king coming on a donkey (Zechariah 9:9).",
    books: ["Zechariah"],
    basis: "named",
  },
  {
    name: "Malachi",
    testament: "Old Testament",
    note: "The last prophet of the Old Testament. He called the people back to the LORD and promised a messenger to prepare His way (Malachi 3:1).",
    books: ["Malachi"],
    basis: "named",
  },
  // ---------------------------------------------------------------- New Testament
  {
    name: "Matthew",
    testament: "New Testament",
    note: "A tax collector whom Jesus called to follow Him, and one of the Twelve (Matthew 9:9; 10:3). His Gospel shows Jesus as the promised Messiah and King.",
    books: ["Matthew"],
    detail: "The Gospel does not name its writer; the early church credited Matthew.",
    basis: "tradition",
  },
  {
    name: "Mark",
    testament: "New Testament",
    note: "John Mark, who travelled with Paul and Barnabas and later with Peter (Acts 12:25; 1 Peter 5:13).",
    books: ["Mark"],
    detail: "The Gospel does not name its writer. Early Christian writers say it records Peter's preaching.",
    basis: "tradition",
  },
  {
    name: "Luke",
    testament: "New Testament",
    note: "A doctor and travelling companion of Paul (Colossians 4:14; 2 Timothy 4:11). He wrote his Gospel after careful research (Luke 1:1–4), and Acts as its sequel.",
    books: ["Luke", "Acts"],
    detail: "Neither book names its writer; the early church credited Luke.",
    basis: "tradition",
  },
  {
    name: "John",
    testament: "New Testament",
    note: "A fisherman and one of the Twelve, called “the disciple whom Jesus loved”. He saw the risen Christ and, as an old man on the island of Patmos, the visions of Revelation.",
    books: ["John", "1 John", "2 John", "3 John", "Revelation"],
    detail: "Revelation names John as its writer (Revelation 1:1, 4, 9). The Gospel and the three letters do not name him, and are traditionally his.",
    basis: "tradition",
  },
  {
    name: "Paul",
    testament: "New Testament",
    note: "Once Saul, a Pharisee who persecuted the church until Jesus met him on the road to Damascus (Acts 9). He became the apostle to the Gentiles and planted churches across the Roman world.",
    books: [
      "Romans",
      "1 Corinthians",
      "2 Corinthians",
      "Galatians",
      "Ephesians",
      "Philippians",
      "Colossians",
      "1 Thessalonians",
      "2 Thessalonians",
      "1 Timothy",
      "2 Timothy",
      "Titus",
      "Philemon",
    ],
    detail: "Thirteen letters carry his name. Some scholars question a few of them; the church has long received all thirteen as Paul's.",
    basis: "named",
  },
  {
    name: "The writer of Hebrews",
    testament: "New Testament",
    note: "The letter shows Jesus as the great High Priest and the fulfilment of the old covenant.",
    books: ["Hebrews"],
    detail: "The letter does not name its writer. Paul, Barnabas, Apollos and others have been suggested; the early teacher Origen said that only God knows who wrote it.",
    basis: "unknown",
  },
  {
    name: "James",
    testament: "New Testament",
    note: "The brother of Jesus (Galatians 1:19). He did not believe at first (John 7:5), but became a leader of the church in Jerusalem (Acts 15:13).",
    books: ["James"],
    detail: "The letter names “James” (James 1:1); the early church understood him to be the Lord's brother.",
    basis: "named",
  },
  {
    name: "Peter",
    testament: "New Testament",
    note: "A fisherman from Galilee and one of the Twelve, who preached on the day of Pentecost (Acts 2). He wrote to scattered Christians facing suffering.",
    books: ["1 Peter", "2 Peter"],
    detail: "Both letters name him (1 Peter 1:1; 2 Peter 1:1). Some scholars question 2 Peter; the church has long received it as his.",
    basis: "named",
  },
  {
    name: "Jude",
    testament: "New Testament",
    note: "A brother of James, and so of Jesus too (Jude 1; Matthew 13:55). He wrote urging believers to contend for the faith.",
    books: ["Jude"],
    basis: "named",
  },
];
