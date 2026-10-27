# Bible Concordance for Android

A small, offline companion to the desktop app: the Bible, one search box, bookmarks and
highlights. It is a project of its own in this folder and changes nothing in the desktop app.

## What it does

- **Read** a chapter; swipe sideways (or use the buttons) for the next or previous one;
  tap the heading to pick a book and chapter.
- **One search box.** A reference ("John 3:16", "1 cor 13", "ps 23") opens the passage.
  Anything else is searched for: the exact words, every form of the words, and the
  subject — the same search the desktop sermon builder uses (`src-tauri/src/sermon.rs` is
  compiled into this app from the desktop source), so "gifts of the Spirit" returns the
  passages, not just verses containing the words. Results can be kept to a testament or
  to the book being read. Matching headings from Nave's and Torrey's topical Bibles are
  offered as topics.
- **Tap a verse** to bookmark it, highlight it (five colours), write a note on it, see its
  cross-references, compare it across the translations, share or copy it, or listen from
  there (the phone's own voice; it carries on into the next chapter).
- **My Study** lists the bookmarks, highlights and notes. **Backup** (under More) saves them,
  with the reading plans, to a file in the desktop app's My Study backup format, and restores
  one from either app without deleting anything.
- **Bible dictionary**: Easton's and Smith's, from the search results or under More; the
  references in an article are links.
- **Reading plans** (the desktop app's four), recent searches, and a verse for the day.
- Five public-domain translations (BSB, KJV, ASV, WEB, YLT), with the words of Jesus in red
  (it can be switched off), text size, light and dark.

Since 0.3.0:

- **Appearance** (More): theme Same as phone / Light / Sepia / Dark, text colour, contrast
  (High darkens the greys), font Classic (serif) or Modern (sans). `src/appearance.ts`.
- **Daily reminder** (Plans): a notification every day at a chosen time, through the official
  notification plugin (`src/reminder.ts`; scheduling works only on the phone).
- **Reading streak** (Plans): days in a row, best run, days read, chapters of the Bible read.
  A chapter counts when its end is reached after 15 s, or when it was listened to the end
  (`reading_log` in `my-study.db`; in the backup as `reading`, which the desktop ignores).
- **Verse pictures** (tap a verse): the verse on one of six colour gradients or on a nature
  photo, shared or saved as a PNG (`src/VersePicture.tsx`; `shareImage`/`saveImage` in the
  plugin, with a FileProvider in its manifest). The 100 nature photos (CC0, Wikimedia
  Commons) are a one-time download from the GitHub release `backgrounds-v1`
  (`src-tauri/src/backgrounds.rs`, checked by SHA-256; made by `data/backgrounds_candidates.py`
  and `data/build_backgrounds.py` from `data/backgrounds.json`).
- **Read aloud**: choose among the phone's English voices, a Slow speed, a sleep timer.
- **Word study** (tap a verse, then Words): the English words with their Strong's numbers (BSB and KJV; a word that stands
  for more than one Hebrew or Greek word shows a tab for each), the Hebrew/Greek entry, how often it is used, every verse
  using it, and **the entries of the lexicons installed from the Library** (BDB, Abbott-Smith, Dodson...) for the word
  (`src/WordStudy.tsx`, `src-tauri/src/study_extra.rs`, `library::lexicon_entries`).
- **Original words** (since 2.9.5, an optional 12 MB download, More): every word of the Hebrew Old Testament and the Greek New
  Testament, one by one, as the computer app's interlinear shows them: as written, how to say it, what it means here, its
  Strong's number, dictionary form and grammar in plain words; a Greek-text choice (critical text, Textus Receptus, all). STEPBible's
  data (CC BY 4.0). The pack is made by `data/build_original_pack.py` into `installer/packs/original-words-v1.zip` and downloaded
  once from the GitHub release `original-pack-v1`, checked by SHA-256 (`src-tauri/src/original_pack.rs`, `src/OriginalWords.tsx`).
  See `HANDOVER_2026-10-27_PHONE_ORIGINAL_WORDS.md`.
- **Study notes**: the Tyndale Open Study Notes (CC BY-SA 4.0, attributed) on a verse or a
  whole chapter, and each book's introduction ("About <book>", "Study notes" under the heading).
- **Side by side**: a second translation under each verse.
- **More translations** (More): any Bible eBible.org marks as free to redistribute (1,200+,
  hundreds of languages), downloaded once into `my-bibles.db` (`src-tauri/src/bibles.rs`,
  `src/Translations.tsx`). They are read, compared and shown side by side; search uses the
  built-in English.
- **Tags** on bookmarks and notes, with a filter in My Study (the desktop's note tags).
- `src-tauri/plugins/phone` is the small Android (Kotlin) part: the share sheet, the phone's
  voice, and saving or opening a file the reader chooses.

No account, no adverts. The internet is used only when the reader downloads a translation or
the nature backgrounds.

## Layout

| Path | What |
|---|---|
| `data/build_phone_db.py` | builds `src-tauri/resources/phone.db.gz` (28 MB since 0.3.0) from the desktop app's `bible.db`, `study.db` and `commentaries.db` |
| `data/backgrounds_candidates.py`, `data/build_backgrounds.py`, `data/backgrounds.json` | the nature photos for verse pictures (see above) |
| `src-tauri/` | the Rust side: `search.rs` (reading, search), `userdata.rs` (bookmarks, highlights), `lib.rs` (commands; unpacks the database on first run) |
| `src/` | the screens (React): `App.tsx`, `refs.ts` (reading a typed reference), `styles.css` |
| `scripts/android.ps1` | builds the APK (mirrors the source to local disk first; see the script) |

## Working on it

```powershell
python mobile\data\build_phone_db.py          # once, and whenever the desktop databases change
cd mobile; npm install
npm run tauri dev                             # runs as a small desktop window, for quick checks
cd src-tauri; cargo test --test phone         # the database, search and marks
pwsh -File mobile\scripts\android.ps1         # a debug APK in installer\
pwsh -File mobile\scripts\android.ps1 -Install  # ...and install it on the phone plugged in
```

The database and the generated Android project are not committed (see `.gitignore`); the
app's signing key must never be.
