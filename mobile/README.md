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
- `src-tauri/plugins/phone` is the small Android (Kotlin) part: the share sheet, the phone's
  voice, and saving or opening a file the reader chooses.

No account, no network access, no adverts.

## Layout

| Path | What |
|---|---|
| `data/build_phone_db.py` | builds `src-tauri/resources/phone.db.gz` (16 MB) from the desktop app's `bible.db` and `study.db` |
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
