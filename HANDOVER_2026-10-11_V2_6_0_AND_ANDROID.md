# Handover — 2026-10-11: desktop 2.6.0 (built, not released) and the Android app (0.2.0)

Read this first. The older handovers still hold for everything they cover:
`HANDOVER_2026-10-08_V2_5_0_SERMON_BUILDER.md`, `HANDOVER_2026-10-07_V2_4_2.md`,
`HANDOVER_2026-10-06_V2_4_0.md` (release process, sections 3 and 5), `HANDOVER.md`.

## 1. Where things stand

| Thing | State |
|---|---|
| Desktop **2.5.0** | The live release (GitHub `v2.5.0`, the website's Windows download, what installed copies update to). |
| Desktop **2.6.0** | Committed (`3a2d943`), installer built in `installer\` (gitignored), installed and being tested by the owner. **Not published**: no GitHub release, website still offers 2.5.0. Publish only when the owner says so (process: 2.4.0 handover, sections 3 and 5). |
| Android **0.2.0** | In `mobile/`, committed with this handover. Signed APK built; the owner installed 0.1.0 on their own phone and reported it "works fully". Published as GitHub release `android-v0.2.0` and linked from the website (see section 5 for whether that step completed). |

Nobody has confirmed the desktop in-app update (2.5.0 → a newer version) on an installed copy.

## 2. Desktop 2.6.0 — what changed (read aloud, bookmarks in books)

- **`src/readHighlight.ts`** (new): sentence splitting aware of abbreviations and initials,
  finding sentences in the page (DOM), tinting the one being spoken with the CSS Custom
  Highlight API (`::highlight(reading)`), `keepInView`, and `watchForManualScroll`.
- **`src/readAloud.ts`**: items carry a `tag` ("group#sentence"; a group is a verse `v16/3`
  or a book paragraph `sectionId|para`), `skipGroup`, and the events `READ_STATE_EVENT`,
  `LISTEN_FROM_EVENT`, `BOOKMARK_HERE_EVENT`. A listen request may be plain text or tagged
  items with a label.
- **`src/App.tsx`**: long verses are read sentence by sentence; sleep timer (15/30/60 minutes
  or "end of this chapter"); Space pauses, ← → skip a sentence; reader state is broadcast to
  the page.
- **`src/components/BookPanel.tsx`**: sentences are taken from the page and tagged; the
  sentence is tinted and its paragraph marked; the page follows until the reader scrolls
  ("Back to where it's reading"); a speaker and a bookmark button beside the paragraph under
  the mouse; "Continue listening" from where it stopped (localStorage `book:listening`); the
  reader's own bookmarks, listed at the top of Contents.
- **`src/components/ChapterView.tsx`**: the sentence tint inside long verses, follow-scroll
  with the same "Back" button, a verse highlight that is visible in dark mode.
- **`src/components/SelectionMenu.tsx`**: right-click a paragraph or verse → "Listen from
  here" (and "Bookmark this place" in a book), with or without a selection.
- **Backend**: `book_bookmarks` table in `userdata.db` (by position: section index and
  paragraph, so they survive reinstalling a book), commands in `study_commands.rs`, included
  in the JSON backup. My Study → Bookmarks lists them under "In your books".

Not done / known limits: right-click "Listen from here" on a verse is not offered in
side-by-side view (the ⋯ menu does it); book bookmarks are in the JSON backup but not in the
Markdown export; word-by-word highlighting and highlights/notes inside books were left out
on purpose.

## 3. The Android app (`mobile/`)

A small offline companion, a project of its own: it changes nothing in the desktop app.
`mobile/README.md` has the layout and the commands. Version 0.2.0, identifier
`com.ghostclaw.bibleconcordance`, Android 7+ (minSdk 24).

**What it has:** reading (swipe or buttons to turn chapters, a book/chapter picker); one
search box (a reference opens the passage; anything else is searched by exact words, word
forms and subject, with topical headings and dictionary articles offered); tap a verse for
bookmark, five highlight colours, a note, cross-references (the 12 most agreed-on), compare
across the five translations, listen from here (the phone's own voice, on into the next
chapter), share, copy; My Study (bookmarks, highlights, notes); reading plans (the desktop's
four); Easton's and Smith's Bible dictionaries; backup and restore; recent searches; a verse
for the day; text size and theme. BSB, KJV, ASV, WEB, YLT.

**How it is built**

- **The search is the desktop's.** `mobile/src-tauri/src/lib.rs` compiles
  `src-tauri/src/sermon.rs` from the desktop source with `#[path]`. That file refers to
  `crate::db::DbState` and `crate::study::StudyState`, so the phone crate has small modules
  of those names. Changing `sermon.rs` changes both apps; its own unit tests need the desktop
  databases, so the phone's tests are run with `cargo test --test phone` only.
- **The database** is `mobile/src-tauri/resources/phone.db.gz` (20 MB; gitignored), built by
  `python mobile/data/build_phone_db.py` from `bible.db` and `study.db`. It is compiled into
  the app with `include_bytes!` and unpacked into the app's data folder on first run of each
  version (on Android bundled files sit inside the APK where SQLite cannot open them).
- **State is opened after the window.** On Android the page asks for the chapter before
  `setup` has finished, so the state (`Core`) is managed empty, filled on a thread, and every
  command waits for it. All commands are `#[tauri::command(async)]` for that reason.
- **`mobile/src-tauri/plugins/phone`** is a local Tauri plugin with a Kotlin half
  (`android/src/main/java/PhonePlugin.kt`): the share sheet, text-to-speech (`speak` answers
  when the utterance ends, so the page reads verse by verse without events), and saving /
  opening a file through Android's document picker. Android's WebView has none of these.
- **Back button**: `onBackButtonPress` from `@tauri-apps/api/app`; each open sheet or
  non-Read tab is a history entry (`useBack` in `App.tsx`). Without the handler Android
  closes the app on Back.
- **No `window.confirm`**: it shows nothing inside the app's WebView. Use the `ask` sheet.
- **The backup** is the desktop's My Study format (`bible-concordance-study/1`). The phone
  ignores sermons and book bookmarks, maps the desktop's bright highlight colours to the
  nearest of its five, and keeps a desktop note's tags and verse range untouched.

**Building** — `pwsh -File mobile\scripts\android.ps1` (debug), `-Release` (signed),
`-Targets x86_64` (emulator), `-Install` (to a device seen by adb).

- The script **mirrors the source to local disk** (`%LOCALAPPDATA%\bible-concordance-build\
  mobile-mirror`) and builds there: `tauri android init` refuses the network share's path.
  The generated Android project (`gen/android`) lives only in the mirror; the script adds the
  release signing set-up to it each time it is regenerated.
- **Avast re-signs HTTPS**, so Gradle's downloads fail with Java's own trust list. The script
  builds a Java trust list from Java's plus Windows' certificates
  (`...\bible-concordance-build\java-trust.jks`) and points Java at it. Checking stays on.
- Needs Android Studio (SDK, its bundled Java), the **NDK** (installed by hand into
  `<sdk>\ndk\27.2.12479018`; the SDK had none), and the Rust Android targets.
- **Signing key**: `C:\Users\ErichT\.tauri\bible-concordance-android.jks`, password in the
  `.properties` file beside it. Outside the repository; never commit either. Android only
  installs an update signed with the same key, so **both files must be backed up**. Signer
  certificate SHA-256: `6211364ae9b71f89d9f39b457e47cc97b2ee41bb81f994f03f0907f242076f3a`.

**Testing without a phone** — the emulator `Medium_Phone_API_36.1` exists on this PC. Run it
headless (`emulator -avd Medium_Phone_API_36.1 -no-window -no-audio -no-snapshot-save`),
install a debug `x86_64` build, then drive the real screens through the WebView's debugger:
`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` and a small Node script
over the DevTools protocol. Headless screenshots come out blank, so read the DOM (or
`uiautomator dump` for system dialogs). In Git Bash set `MSYS_NO_PATHCONV=1` before `adb
shell` commands with `/sdcard/...` paths. An install made in a session started without
saving the snapshot is gone after the emulator restarts.

**The owner's phone** shows up over USB as storage ("Erich Phone") but adb has not seen it:
USB debugging was never confirmed on. Installs so far were done by copying the APK across.

## 4. Decisions and open items

- **Afrikaans is not bundled.** The 1933/1953 Afrikaans Bible (`Afr1953`) is copyrighted by
  the Bible Society of South Africa, with distribution permission given to CrossWire only. It
  stays a Library download on the desktop. Putting it in the phone app needs the Bible
  Society's permission (offered to draft the request; not asked for yet).
- **No Play Store** for now (owner's decision); the APK is offered from the website.
- The APK carries the app for 64-bit and 32-bit ARM, each with the database inside, hence
  52 MB. A 64-bit-only build would be about half.
- Not built: automatic sync between phone and PC (needs a server; the backup file does the
  job), commentaries / Library / Strong's on the phone (kept out to stay small).
- Offered to the owner earlier, not requested: a "shelf" for books kept in other apps,
  e-Sword/MySword importers, globalchristians.org as a Library source, Strong's tags in
  tagged Library Bibles, pictures in added books.
- Old pushed commit `ac15e08` still contains the owner's real e-mail address; rewriting it
  needs a force-push the owner has not asked for.

## 5. Publishing done on 2026-10-11

- GitHub release **`android-v0.2.0`** on `BadBull22/bible`, asset
  `BibleConcordance_Android_0.2.0.apk` (SHA-256
  `babe20cf05a333ceb5bacaf17304c7d81b1fcdaf14bc3b010711efde36ea2f43`). It is **not** marked
  "latest": the desktop updater reads `releases/latest/download/latest.json`, which must keep
  pointing at the newest *desktop* release. Create every Android release with
  `--latest=false`.
- Website (`X:\Code\openui\Website\GhostClaw`, `app/public/bible.html`): an "Android phone"
  section with what the phone app is, what it leaves out, and how to install it; its
  `HANDOVER_BIBLE_PAGE.md` says how to update it for the next Android version.

## 6. Rules that still apply

- Commit as `BadBull22 <BadBull22@users.noreply.github.com>`, never the real e-mail; stage by
  explicit path, never `git add -A` (`check/` holds copyrighted PDFs); never commit
  installers, databases or keys.
- Commit, push, publish a release or push the website only when the owner asks.
- Only legitimate content: nothing copyrighted is bundled, DRM is not removed.
- The Apocrypha is always marked as outside the canon. Doctrinal answers: Scripture first,
  then the Pentecostal reading, then other views.
- The sermon builder gathers and lays out; it never writes the sermon.
