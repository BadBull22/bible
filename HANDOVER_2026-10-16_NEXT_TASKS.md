# Handover — 2026-10-16 — next tasks (for the agent on the other PC)

Read `HANDOVER.md`, then `HANDOVER_2026-10-15_V2_7_0.md`, which covers the whole sermon builder and its 2026-10-16 redesign. This file is the owner's list of what to do next, with enough detail to start.

## 0. Before you start

- **The working tree is shared.** `V:\Code\bible` is on the owner's Synology drive, which both PCs use. Nothing since 2.6.1 is committed: all of 2.7.0 (sermon builder, Library index, Spurgeon, lectionary, media, slides) is uncommitted in this folder. **Don't work on both PCs at the same time.**
- **Commit 2.7.0 first.** Once the owner has approved the 2.7.0 installer (built 2026-10-16 into `installer\`), commit it by explicit paths before starting anything here. The file list is in `HANDOVER_2026-10-15_V2_7_0.md` §7. Add these, which are newer than that list:
  - `src/sermonLayout.ts`, `src/sermonMedia.ts`
  - `src/components/SermonFind.tsx`, `SermonOutline.tsx`, `MediaPicker.tsx`, `SlidesEditor.tsx`
  - `src-tauri/src/sermon_media.rs`
  - `scripts/test_sermon_layout.mts`
  - this file
- **Check `src-tauri/tauri.conf.json`** has no `additionalBrowserArgs` line before any commit or build. That line is the temporary WebView debug port used for testing.
- **Remind the owner to turn off the antivirus shields** before any Rust compile or installer build.
- **Commit and publish only when the owner asks.** Build the installer first and put it on the Synology drive (`V:\Code\bible\installer\`) for the owner to try. Their OneDrive is not shared between the PCs.
- **No AI in the app.** The sermon builder finds, arranges and prompts; the preacher writes every word. Keep it that way in everything below.
- **Tests:**
  - `cargo test --no-default-features --lib` from `src-tauri\`, with the cargo target dir on local disk (see `HANDOVER.md`)
  - `npx tsc --noEmit`
  - `npx vite build`
  - `node scripts/test_sermon_layout.mts` (Node 24 runs the TypeScript directly)
- **Testing in the running app:** add the debug-port line to `tauri.conf.json` while testing, drive the WebView over CDP on port 9222, and **remove the line** afterwards. **Don't drive the app over CDP while the owner is using it.** That happened once: their own sermon was open.

## 1. Read e-Sword modules (the biggest gap with e-Sword)

e-Sword's strength is a huge free library of user-made modules. Its module files are SQLite databases, so we can read the ones the user already has.

- **Extensions:**
  - `.bblx` Bible
  - `.cmtx` commentary
  - `.dctx` dictionary
  - `.topx` topics
  - `.lexx` lexicon
  - `.devx` devotional
  - `.refx` reference books
  - older formats: `.bbli`, `.cmti`, `.dcti`, `.topi`
- **Tables, as recalled.** Verify on real sample files first, and write the importer from what they actually contain.
  - Bible: `Bible(Book, Chapter, Verse, Scripture)`
  - Commentary: `VerseCommentary` / `ChapterCommentary` / `BookCommentary` with `Book, ChapterBegin, VerseBegin, ChapterEnd, VerseEnd, Comments`
  - Dictionary: `Dictionary(Topic, Definition)`
  - Topics: `Topics(Topic, Comments)`
  - Most also have a `Details` table (title, abbreviation, description).
  - Text is RTF, or RTF-like. Convert it to the app's text and turn verse references into the app's ⟦Book|ch|v|v_end|label⟧ markers (`library/refs.rs`).
  - e-Sword book numbers run 1–66.
- **Where it plugs in:** the Library already imports SWORD zips, EPUB and PDF (`library/mod.rs`: `import_check` / `import_install`, Library → "Add from file"). Add e-Sword files as another format into the same `lib_*` tables:
  - Bibles go to `lib_verses`
  - commentaries go to `lib_comm`
  - dictionaries, topics and lexicons go to `lib_dict` (lexicons keyed by Strong's: set `lib_dict.strongs`)
  - devotionals go to `lib_dict` with module kind `devotional`
  - books (`.refx`) go to `lib_book`

  From there, imported modules automatically appear in the commentary, dictionary and books panels, in the sermon builder's "In your Library", and in the verse reference index (`lib_refs`).
- **Licence (the owner's earlier decision still stands):** e-Sword modules are **never included** with the app, downloaded by it, or passed on. Many modules shared online are unauthorised copies of copyrighted Bibles and books. This task is only about opening files the user already has on their own computer, like "Add from file" for EPUB and PDF.
  - Commercial e-Sword modules are encrypted. Detect that, and explain plainly that they can't be opened.
  - When importing, show a short notice: "Only add modules you have the right to use. Many modules shared online are copies of copyrighted Bibles and books made without permission."
- Allow choosing several files at once, and a whole folder, since e-Sword users keep everything in one folder.
- **MySword too** (the owner asked, 2026-10-16). MySword, e-Sword's Android cousin, also keeps its modules as SQLite files: `.bbl.mybible` Bibles, `.cmt.mybible` commentaries, `.dct.mybible` dictionaries, `.bok.mybible` books, `.devot.mybible` devotionals. Its tables are close to e-Sword's (for Bibles, `Bible(Book, Chapter, Verse, Scripture)`), with the text in GBF/HTML-like markup rather than RTF. Verify on samples. Same licence rules as above.
- **The owner's understanding, so the import does it:** a Bible they own or download as an e-Sword or MySword file goes into the translation list (read, compare, search). A book goes into Books. A commentary goes into the Commentary panel. A dictionary or lexicon goes into Dictionary and Word Study. A devotional goes into Books, opening on today's date. All of it also feeds "In your Library" and the verse reference index. Bibles bought in e-Sword's store are encrypted and can't be opened: say so plainly.

## 2. Sync between PC and phone through a folder the user already has

Today the only link is the backup file (`userdata.rs` export/import, which works in both apps).

- **Settings → "Keep in step through a folder":** the user chooses a folder (OneDrive, Google Drive, Dropbox or the Synology drive). The app writes its notes, highlights, bookmarks, reading-plan progress, sermons, templates and basket there as a sync file. When it starts, and every few minutes, it merges the other device's file. There is no account and no server of ours.
- **Merging:** per record, the newer `updated_at` wins. Deletions are kept as tombstones (a deleted id and when it was deleted), so a deleted note doesn't come back. Sermon media files (`sermon-media\`, content-hashed names) can be copied to `<folder>\media\` and are never in conflict.
- **Android:** the folder is chosen with the system file picker (SAF), which works with Google Drive and OneDrive folders. Look at what `mobile/` already does for backups.
- Show when it last synced and from which device. On a conflict it can't merge (the same sermon edited on both since the last sync), keep both copies and say so.

## 3. More free modern translations, easy to find

The Library already browses eBible.org (about 1,500 Bibles). Make the free modern English ones obvious instead of lost in the full list:
- a short "Recommended free translations" list at the top of Library → Bibles, and the same on Android
- for example: World English Bible (WEB), Berean Standard Bible (already built in), Literal Standard Version (LSV), Open English Bible, Free Bible Version, and the NET Bible free edition (its notes are locked)
- check each one's licence in its `.conf` before listing it, with one-click install

NIV, ESV, NASB and NLT are licensed, so they can't be bundled. They stay online through the user's own api.bible key, as now.

## 4. A proper sermon tracker, and search across past sermons

The owner saw Logos's sermon manager and wants the same accuracy.

- **One sermon can be preached many times.** Add a new table, `sermon_preachings(id, sermon_id, date, venue, audience, notes, length_min)`. When a sermon is marked "Preached", record a preaching (date defaults to today). Show the history on the sermon: "Preached 3 times: 12 Jan 2025 South Point (evening), …".
- **Accurate "used before":** today it reads `sermons.preached_on` and the body JSON (`sermon_usage`). Base it on `sermon_preachings`, so it says when and where something was preached, not only that it was in a sermon.
- **Search bar in My sermons**, with filters:
  - **Words:** an FTS5 table over title, series, topics, big idea and the preacher's own text.
  - **Scripture:** "Romans 8" finds sermons whose passages overlap. Store each sermon's passages as rows in `sermon_refs(sermon_id, book, chapter, verse, verse_end)` on save, and query by overlap like `library::mentions_of` does.
  - **Date range, series, venue, stage.**
  - **Sorting:** newest, oldest, most preached.
- **Results:** title, dates preached, passages, and the first line of the big idea. Click to open.
- Include `sermon_preachings` in the backup and the sync (task 2), and migrate old sermons: one preaching from `preached_on` if the stage is "preached".

## 5. Hebrew and Greek word definitions, simple to add to a sermon

The data is all in the app already:
- Strong's dictionaries (`api.strongsLookup`)
- the verse's words with their Strong's numbers (`api.getVerseWithStrongs`)
- English-to-original search (`api.originalWordLookup`)
- downloaded lexicons (`api.libraryLexiconEntries`, e.g. the Intermediate Greek–English lexicon)

The Word Study panel (`components/WordStudyPanel.tsx`) and the Interlinear panel show how they're used.

What to add:
- **Click a word, add its meaning.** In the builder, any Scripture item (left list, Read view, Study view, and the sermon on the right) can show its words. Clicking an English word shows a small card: original word, transliteration, Strong's number, short definition, how often it's used, and fuller entries from any downloaded lexicon. One button, **"Add to the sermon"**, adds a Word item. The automatic placement already sends `word` items to the point's Explain section (`sermonLayout.rolesFor`).
- **A "Look up a word" box** in the left panel ("love", "agape", "G26") with the same card.
- Keep it to one or two clicks. The owner's words: "needs to be simple to add".

## 6. An editable preview of the finished sermon (between Prepare and Print)

Today the document is only editable in Prepare. Print & handouts is read-only, so a small fix means going back.

- Add a **"Review"** tab between Prepare and Print & handouts. It shows the sermon as it will print, but every part the preacher wrote is editable in place: title, big idea, purpose, headings, section text and notes. Typing there changes the sermon itself (the same items Prepare edits).
- Gathered material (Scripture, commentary) stays as printed. Allow removing an item, and optionally trimming a quotation, by keeping an edited copy of the text on that item rather than changing the source.
- **How:** `sermonBlocks` (`src/sermon.ts`) builds the document. Give each `SheetBlock` an optional `src: { id, field }` naming the item and field it came from. The Rust `SheetBlock` ignores unknown fields; check that serde doesn't reject it. The Review page renders blocks with editable text where `src` is set and writes changes back through the same `edit` / `editLabel` functions as Prepare.
- Also allow these quick edits on Print & handouts itself, or at least an obvious "Edit" button there that jumps to the same place in Review.

## 7. Slides: make changing the background and adding pictures obvious, and fix Scripture slides

The background control exists ("Background: Plain navy / A photo…" in the bar at the top of the Slides page), and "+ Add a slide… → Picture" adds a picture slide. But the bar **scrolls out of view**: in the owner's screenshot, scrolled down, there was no sign of either. So:

- **Make the bar sticky** at the top of the Slides page. Turn "+ Add a slide" into visible buttons: Words, Song, Scripture, Picture, Video or link.
- **Under the selected slide's editor**, add:
  - "Background: Same as all · Plain · Choose a photo…" (a per-slide background, with "use for all slides")
  - "Add a picture to this slide" (a picture beside or under the words, not only full picture slides)

  `slides.rs` already embeds pictures (`picture()`), backgrounds (`background()`) and links. A per-slide background just needs `Slide.background` set per slide instead of copied to all in `SermonBuilder.saveSlides`.
- **Scripture slides overflow.** Long passages are split at about 450 characters (`slidesOf` in `src/sermonOutputs.ts`), which is too much for a slide, and the thumbnails cut the text off.
  - Split at 3–4 verses or about 280 characters, at verse boundaries.
  - Make the preview shrink text to fit, as PowerPoint's `normAutofit` does.
  - Offer "verse numbers on/off".
- **BSB text has a space after opening quotes** ("“ Rabbi", "‘ You"). Close it up in slides (and in Preach) with `/([“‘])\s+/g → "$1"`.
- Still undecided by the owner:
  - **Present mode:** a second-screen show with a presenter view (current and next slide, notes, clock) instead of only PowerPoint.
  - Whether videos should be **embedded** in the PowerPoint (bigger file, plays offline) or **linked** (current).

  Ask before building either.

## 8. The Android app gets the same downloads and imports

The owner wants the phone app to have the same ability to download and import. Today Android only downloads extra Bibles from eBible.org (`mobile/src-tauri/src/bibles.rs`, into `my-bibles.db`). It has no Library (commentaries, dictionaries, books, devotionals) and imports no files. An earlier note kept commentaries and the Library off the phone to keep the APK small, but downloads don't grow the APK, so that reason doesn't apply here.

- **Share the parsing code between the apps** instead of copying it. Make a small Rust crate in the repo (e.g. `crates/modules/`) holding:
  - the SWORD module readers (from `src-tauri/src/library/sword.rs`, `markup.rs`, `refs.rs`)
  - the e-Sword and MySword readers (task 1)
  - the RTF/GBF-to-text conversion

  Both `src-tauri` and `mobile/src-tauri` depend on it. Keep it free of Tauri.
- **Step 1 — Bibles from a file:** on Android, an "Add a Bible from a file" button next to the eBible downloads (Translations screen, `mobile/src/Translations.tsx`). It uses the system file picker, reads the bytes and imports e-Sword/MySword Bibles (and SWORD zips) into `my-bibles.db`, so they're read and compared like the eBible ones.
- **Step 2 — a Library on the phone:** browse and download CrossWire modules (commentaries, dictionaries, books, devotionals) as the desktop does (`library_catalog` / `library_install`), and import e-Sword/MySword ones. That needs phone screens to read them:
  - a commentary on the chapter being read
  - a dictionary entry
  - a book reader
  - today's devotional

  Keep them simple and in the app's own style.
- Downloaded and imported modules stay on the phone, in the app's data folder, and survive app updates (the same as `my-bibles.db`).
- Licences as on the desktop: only modules marked free to redistribute are offered for download, files the user adds are their own, and encrypted ones are refused with an explanation.
- With task 2 (folder sync), consider whether imported modules should be copied between the devices. Default to no: modules can be large, and the user can import on each device.

## 9. Order suggested

7 (quick, the owner noticed it) → 6 → 5 → 4 → 1 with MySword → 8 (Android, step 1 then step 2) → 3 → 2 (the biggest). Build the installer after each group the owner wants to try, and ask before publishing.
