# Handover — 2026-10-27 — the phone's Word Study: original words one by one, several numbers, and your lexicons

**Read this first.** It is everything needed to **build, test on the phone, and release** this change from the PC that has the Android tools and
signing key. The code is finished and checked as far as this PC (no Android tools) allows; **what remains is the on-phone test, one file to upload to
GitHub, and the build** (§4). It sits beside `HANDOVER_2026-10-26_SUNDAY_SERVICE.md` (the desktop's work of the same days; the tree holds both,
uncommitted).

## 0. Start here

- **Asked for (the owner, 2026-10-27):** the phone's Greek and Hebrew word study felt thin next to the desktop: English words come bundled as phrases, where the
  desktop defines every original word with its meanings and grammar. "What do we need to add to get it similar?" → steps **1, 2 and 3, with 3 an optional download**.
- **Done, in the tree (uncommitted, unbuilt, unpublished):**
  1. **A word with two numbers now shows both.** On the phone, "shall not perish" (G3361 G622) opened only its first number. It now opens an entry with a **tab per number**.
  2. **Your lexicons show in Word Study.** The phone's Library could already install lexicons keyed by Strong's number (BDB, Abbott-Smith, Dodson…); Word Study never asked
     for them. A **"From your Library"** section now lists their entries for the word (the first one open), or says how to install one, with a button to the Library.
  3. **Original words (optional download, 12 MB).** Every word of the Hebrew OT and Greek NT, one by one, as cards: the word as written, how to say it, the English meaning here,
     its Strong's number (tap for the entry), its dictionary form and meaning, and the **grammar in plain words** ("Verb Aorist Active Indicative 3rd Singular"). A Greek-text choice
     (Critical text / Textus Receptus (KJV) / Show all). It is **not in the APK**: a one-time download from GitHub, like the Advanced search upgrade. Under More there is a
     block to get it or remove it.
- **State of the checks:** see §6. In short: Rust tests pass including one against the **real** pack; the phone's TypeScript compiles and its production web build works;
  the screens were exercised with real mouse clicks in a phone-sized browser against **real data behind a mocked backend** (23 checks, light and dark). **Not yet seen on an
  Android phone** and **the download has not been run** (the file is not on GitHub yet).
- **This PC could not build the APK:** no NDK, no Rust Android targets, no `bible-concordance-android.jks`. The owner's phone was connected and visible to `adb` here
  (installed app: `com.ghostclaw.bibleconcordance` **2.9.4**, versionCode 2009004), but nothing was installed on it. **Nothing on the phone was changed.**
- **Standing rules (all apply):** turn the antivirus shields off before any Rust/Android build and wait for the owner's yes; build locally, show the owner, publish only after their OK;
  test on throwaway data and never touch the owner's own notes or sermons; never commit/push/publish unasked.

## 1. What was built, where

| | |
|---|---|
| `mobile/data/build_original_pack.py` (new) | Makes the download from the desktop's `src-tauri/resources/study.db` (never changed): `installer/packs/original-words-v1.zip`, one SQLite file `original.db` (tables `words`, `lemmas`, `morph_codes`, `meta`). 447,398 words (305,638 Hebrew, 141,746 Greek). Prints the **size and SHA-256** for the Rust constants |
| `installer/packs/original-words-v1.zip` (built; git-ignored) | **12,211,282 bytes (12 MB)**, SHA-256 `8c0281d5f82ec30f6ff1a98ef87c77ff2b0d18a46a2342c50f8833a078bdd275`. 37.5 MB unpacked. On the shared drive, so the other PC can reach it |
| `mobile/src-tauri/src/original_pack.rs` (new) | URL, SHA-256, size; `installed`, `install` (via `packs::install`), `remove`, `open` (read-only SQLite, per request); `verse_words` (the words of a verse in reading order, with the grammar **spelled out** by the same expansion the desktop uses: Greek codes one by one, a crasis carries two; Hebrew prefix/word/suffix joined with "/"); `credit`. 5 tests (4 on a fixture, 1 `#[ignore]` on the real pack) |
| `mobile/src-tauri/src/library.rs` | `lexicon_entries(strongs)`: the installed dictionaries' entries whose `lib_dict.strongs` is that number. 1 test |
| `mobile/src-tauri/src/lib.rs` | Commands `original_status`, `original_install` (emits `original-pack-progress`), `original_remove`, `original_words(book, chapter, verse)` → `[words, credit]`, `library_lexicon(strongs)` |
| `mobile/src/api.ts` | `OriginalWord`, `MorphPart`; `originalStatus/Install/Remove/Words`, `libraryLexicon` |
| `mobile/src/OriginalWords.tsx` (new) | `useOriginalPack()` (like `useSearchUpgrade`), `OriginalOffer` (the card with the download button and progress), `OriginalSettings` (More), `OriginalWords` (the cards and the Greek-text choice) |
| `mobile/src/WordStudy.tsx` (rewritten) | Two tabs **Original words | English words** (original first once downloaded, else English with the offer); the English chips pass **all** a word's numbers; `Entry` has a tab per number and a **From your Library** section (`Lexicons`) |
| `mobile/src/App.tsx`, `styles.css` | The pack hook shared by Word Study and More; `onLibrary` from a verse closes the sheet and opens the Library; the credit line; the styles (`.seg`, `.ow*`, `.lexicons`, fonts for polytonic Greek and Hebrew) |

**Design choices worth knowing**
- **Optional download, not bundled:** +12 MB to the app would be duplicated per CPU build (the APK carries a copy of the database for each), so a download keeps the APK at its current size.
- **Per request, the database is opened read-only** (a quick thing, 38 MB, no cache); the pack's `words` table is `WITHOUT ROWID` with a per-verse `seq`, so it needs no index.
- **Greek editions:** each word carries a bit mask of the editions that have it (the desktop's order: NA28, NA27, Tyn, SBL, WH, Treg, TR, Byz). The default shows the **critical text** (Tyn); the choice appears only
  when a verse differs (John 3:13: 17 words critical, 22 in the Textus Receptus).
- **Fonts:** `.ow-orig[lang="grc"]` and `[lang="he"]` list Noto Serif / Noto Serif Hebrew first (Android's own), then Cambria and Times New Roman: the grave accent (U+1F70 "ὰ") was drawn detached in the test browser's reading font without this. **Check it on the phone.**
- **The credit** (STEPBible, CC BY 4.0) is stored in the pack's `meta` table and shown under the cards; More's credits line names it too.
- **Test override:** `BC_ORIGINAL_PACK_URL` (an environment variable read **when the app is compiled**, `option_env!`) points the download somewhere else, for a test build. A release build made without it uses GitHub.

## 2. Files changed or added (all uncommitted)

New: `mobile/data/build_original_pack.py`, `mobile/src-tauri/src/original_pack.rs`, `mobile/src/OriginalWords.tsx`. Changed: `mobile/src-tauri/src/lib.rs`, `mobile/src-tauri/src/library.rs`,
`mobile/src/App.tsx`, `mobile/src/WordStudy.tsx`, `mobile/src/api.ts`, `mobile/src/styles.css`, `mobile/README.md`, `NOTICE.md`. (`mobile/src-tauri/resources/` shows as untracked: it holds `phone.db.gz`, as before.)
`mobile/dist/` was rebuilt by `npm run build` (git-ignored). The temporary browser test bench (`mobile/_harness/`) was **deleted**.

## 3. How the app uses it (what the owner will see)
1. Tap a verse → **Words**. With the pack not downloaded: the two tabs show "English words" first; tapping **Original words** shows the offer ("See every Greek or Hebrew word… A one-time 12 MB download") with **Get the original words (12 MB)** and a progress bar.
2. Once downloaded (or after the next start) **Original words** is the default tab: John 3:16's 25 critical-text Greek words as cards; **tap a card** for the Strong's entry (with the Library lexicons below it). Genesis 1:1 shows its 7 Hebrew words, read from the right, with the prefix and the noun both named in the grammar.
3. **English words** is the old list; a chip with two numbers now opens an entry with a tab for each.
4. **More → Original words (offline)** shows Downloaded/Remove, or Get it.

## 4. What is left, in order (on the PC with the Android tools and the key)

**Before anything: antivirus shields off, owner's yes.** The phone needs "USB debugging" allowed for that PC (the prompt on the phone). Version: `mobile/package.json` and `tauri.conf.json` are **2.9.5**; the installed app is 2.9.4, so a 2.9.5 build installs over it (same signing key) and keeps its data.

### 4a. Test on the phone *before* publishing the download (a local server)
```
cd V:\Code\bible\installer\packs
python -m http.server 8123 --bind 127.0.0.1          # leave running
"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" reverse tcp:8123 tcp:8123
cd V:\Code\bible
$env:BC_ORIGINAL_PACK_URL = "http://127.0.0.1:8123/original-words-v1.zip"
pwsh -File mobile\scripts\android.ps1 -Release -Install
```
(`-Release` signs with the owner's key so it installs over their app; `-Install` runs `adb install -r`.) The native download is plain TCP, not Android's Java network stack, so the `http://` test address should work; if
Android refuses it, publish the file first (4b) and test against GitHub instead. After the test, **unset** the variable (`Remove-Item Env:BC_ORIGINAL_PACK_URL`) and **rebuild** before any release.

On the phone, check:
1. A verse → Words → **Original words**: the offer appears; **Get** shows the progress and then the cards. Read John 3:16, John 3:13 (the Greek-text buttons), Genesis 1:1 (right to left).
2. **The accents:** γὰρ, θεὸς, τὸν must show the grave accent attached to its vowel (a missing font would draw it apart); Hebrew vowel marks above and below the letters.
3. **Tap a card**: the entry opens; tap "Comes from G…" links; **a word with two numbers** (English words → "shall not perish") shows two tabs.
4. **Lexicons:** More → Library → get more → install **Dodson** and **Abbott-Smith** (Greek) and **BDB** (Hebrew) if CrossWire offers them; the entries for a word then show under **From your Library**. *This was tested only against a stand-in that returns two entries; whether each real module fills `lib_dict.strongs` (the Library's `migrate` sets it for modules marked as Greek/Hebrew definitions) is the thing to confirm.*
5. More → **Original words** shows Downloaded; **Remove** frees the 38 MB; the offer comes back.
6. Time the download and the first tap on the phone; check nothing slows the verse sheet.

### 4b. Publish the download (the owner's OK first)
The app expects: `https://github.com/BadBull22/bible/releases/download/original-pack-v1/original-words-v1.zip`. With the GitHub CLI:
```
gh release create original-pack-v1 installer\packs\original-words-v1.zip --repo BadBull22/bible --title "Original words pack v1" --notes "The Greek and Hebrew words of every verse, one by one, for the phone app's optional Original words download (STEPBible data, CC BY 4.0)."
```
Then check the URL downloads and `Get-FileHash` equals `8c0281d5…cd6cc3`. **If the zip is ever rebuilt** (`python mobile\data\build_original_pack.py`) the SHA changes: put the new one in `original_pack.rs` (`SHA256`, and `SIZE_MB`),
and `cargo test --lib original_pack -- --ignored` (run in `mobile/src-tauri`) proves the file and the constant agree. A changed pack that existing phones should take needs a new name (`original-pack-v2`), a new URL and SHA.

### 4c. The release build
Without `BC_ORIGINAL_PACK_URL`: `pwsh -File mobile\scripts\android.ps1 -Release`. Then check the APK does not carry the test address: unzip `lib/arm64-v8a/*.so` and search it for `127.0.0.1:8123` (must be absent) and for `original-pack-v1` (must be present).
Release steps for the phone (the website's `docs/android/latest.json`, the GitHub release, the version) are in `HANDOVER_2026-10-13_ANDROID_0_3_0.md` §5–6 and `HANDOVER_2026-10-16_V2_9_0.md`; do them only with the owner's OK.

## 5. Why the phone was thin, and what is *not* done (the owner's questions, answered)
- **The English-phrase tagging** (`strongs_words`, BSB and KJV only) groups English words ("He gave", "shall not perish", "In the beginning"); that is how the data is tagged, and it stays as the **English words** tab.
- **Not done:** grammar search ("every verb in the aorist…"), word-by-word under the reading text, tagging for other translations, reading the entry aloud (the desktop has it), a one-tap offer to install lexicons from a word's entry (it says how and links to the Library), tapping a Hebrew **prefix** separately (it shows as part of its word, named in the grammar line).
- **If the owner would rather have it built in:** the pack could be bundled into the APK (about +12 MB, perhaps twice that for the two CPU builds). Not recommended unless offline-from-first-install matters more than size.

## 6. What was checked, and how
- **Rust (`mobile/src-tauri`, `cargo test --lib`):** 37 passed. The 4 fixture tests (reading order, grammar in words, Hebrew prefix/noun split, empty verse and credit, nothing opened before download), the **real-pack test** (`--include-ignored`: SHA-256 matches the constant; Genesis 1:1 gives H7225 H1254 H430 H853 H8064 H853 H776, all Hebrew with a lemma and grammar; John 3:16's critical text starts "Thus" and ἠγάπησεν is an aorist; 447,000+ words; the credit names STEPBible), and the lexicon lookup test.
  **3 other tests fail there** (`sermon::tests::every_story_passage_exists`, `every_core_passage_exists`, `finds_what_a_preacher_expects`): they are the **desktop's** sermon tests, compiled into the phone crate through `#[path]`, and they need the desktop's databases (`lib.rs` says so). `sermon.rs` was not touched. They are not caused by this work.
- **TypeScript:** `npx tsc --noEmit` clean; `npm run build` (tsc and vite) built; the new text is in the bundle.
- **The screens, in a browser sized like a phone (412×915), real mouse events:** a throwaway test bench (deleted) rendered `WordStudy` with the phone's own `styles.css` and a **mocked backend answering from the real data** (the real pack's words and grammar for John 3:16, John 3:13 and Genesis 1:1; the phone database's English tagging and Strong's entries; two made-up lexicon entries for G25).
  23 checks passed: English first when not downloaded; a two-number chip gives two tabs and each opens its own entry; the lexicon hint and its Library button; the offer with its size; the progress bar; the cards after the download; the grammar in words; the credit; the entry from a card with two lexicons (the first open) and a verse link inside one; the Greek-text choice (17 / 22 / all, with editions listed under "Show all"); Hebrew set right to left with the prefix and the noun named; light and dark. The accent fix above came out of this.
- **Not checked:** Android WebView rendering and fonts; the real download over the network and the unpack on the phone; the real lexicon modules; battery/time on the phone.

## 7. Gotchas
- This PC (the shared drive's `V:`): `adb` is at `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe` (not on PATH). The phone showed "unauthorized" until the owner allowed debugging.
- `android.ps1` mirrors `mobile\` and `crates\` to local disk and builds there: a **change of the environment variable between builds** is picked up by Cargo (it tracks `option_env!`), but if in doubt delete the mirror's `target` for the `bible-pocket` crate.
- The pack's `book` names equal the phone database's (all 66 matched), so no mapping is needed.
- Windows console printing of Greek/Hebrew in Python needs UTF-8 (`PYTHONIOENCODING=utf-8`) if you print words; the build script prints only numbers.
- The phone app's version is **2.9.5** in `mobile/package.json`, `mobile/src-tauri/tauri.conf.json` and its `Cargo.toml`/lock (already bumped, uncommitted).

## 8. Progress on 2026-10-27 afternoon (this PC, X:\Code\bible, phone connected and authorised)
- **Phone TEST build installed on the owner's phone** (`adb install -r`, kept its data): `installer\BibleConcordance_Android_2.9.5.apk` (79,456,188 bytes), versionCode 2009005, signed with the owner's key, built with `BC_ORIGINAL_PACK_URL=http://127.0.0.1:8123/original-words-v1.zip`. **This APK is a test build: it carries the local test address and must NOT be released.** The app starts and no crash is in the log. The owner is to run the §4a checklist on the phone.
- **For the download to work on the phone** two things must be running on this PC while the owner tests: the pack server (`python -m http.server 8123 --bind 127.0.0.1` in `installer\packs`) and `adb reverse tcp:8123 tcp:8123` (needs the USB cable). Stop the server afterwards.
- **After the owner's OK:** §4b (publish `original-pack-v1`), then rebuild **without** the variable (`pwsh -File mobile\scripts\android.ps1 -Release`), check the APK (§4c), and release the phone as 2.9.5 (website `docs/android/latest.json` and pages, `--latest=false`).
- Still uncommitted: all the phone work above (the last commit is the desktop 2.9.5 release).

## 9. The desktop Settings screen made compact (owner: "endless scrolling, minimise descriptions, a help button with collapsible options")
`SettingsPanel.tsx` is now nine collapsible groups (closed, one line each): Help & guides, Look & reading (appearance and reading comfort together), Read aloud, Name your highlights, Online translations, Keep in step with other devices, Updates, If something goes wrong, About. Each group's explanations (the `search-hint` paragraphs, also those inside the sync, voice and update parts) are hidden until the small **?** on the group is pressed. **Help & guides** holds the User guide and Getting started buttons and small collapsible tips (keyboard shortcuts, going to a passage, hard-to-read text, hearing a chapter, where keys are kept). Which groups are open is remembered (`localStorage` `bc-settings-open`); "Show me" from Getting started opens the keys group. Checked in the dev app with real clicks: nine groups, no scrolling when closed, the explanations hidden then shown, the open groups kept after a reload, both key fields present, 0 page errors. Not in a release yet (the 2.9.5 release was made before this). The phone's More screen was not changed.

## 10. RELEASED as 2.9.6 (2026-10-27, afternoon): what changed, and how it was checked
**Read this section first; it supersedes §0 and §4 where they say "not released".** The owner tried the test build on the phone, asked for a tidier More screen (explanations on request) and a tidier desktop Settings screen, then asked for both apps to be released.

**What changed (versions moved from 2.9.5 to 2.9.6 in every package, Cargo and Tauri file; the computer app and the phone are in step)**
- *Phone, Word Study:* the Greek and Hebrew words one by one (optional 12 MB download, More → Original words), a tab for each number of a word, and the entries of the lexicons installed in the Library (§1).
- *Phone, More screen:* only headings and options; a heading that has an explanation shows a small "i" and tapping it shows or hides that section's explanations (`toggleExplanations` in `mobile/src/App.tsx`; CSS `.more .hint…`, `h2.has-info`). Hints that say how things stand (progress, "Downloaded", the paired computer, the sync folder, installed translations) carry the class `keep`/`status` and stay visible.
- *Computer, Settings:* nine collapsible groups, explanations behind a "?" on each group, a "Help & guides" group with small tips (§9).
- *The word pack:* GitHub release `original-pack-v1` (12,211,282 bytes, SHA-256 `8c0281d5…bdd275`); the downloaded file was checked against that fingerprint.

**Published**
| | |
|---|---|
| Commit `12d00e9` | the 2.9.6 work (28 files; as BadBull22; scanned: no email, key or test-port line; the untracked `mobile/src-tauri/resources/` holding `phone.db.gz` and an empty `bible.db` was NOT staged) |
| Release `original-pack-v1` | the pack (not marked Latest) |
| Release `android-v2.9.6` (not Latest) | `BibleConcordance_Android_2.9.6.apk`, 79,456,700 bytes, SHA-256 `3fbbe955…ec21`, versionCode 2009006, signed with the owner's key (certificate `6211364a…6f3a`, the same as 2.9.4, so it installs over the old app and keeps its data). **Checked: the APK carries `original-pack-v1` and does NOT carry the test address `127.0.0.1:8123`** (searched in both `.so` files) |
| Release `v2.9.6` (Latest) | signed setup `.exe` (378,152,593 bytes) and `.msi` (439,869,440), `latest.json`; notes "A tidier Settings screen: groups you open when you need them, with explanations on request." Both signatures verified against the local files and again against the files downloaded from GitHub |
| Commit `8141a65` and the next website commit | the website's Android and Windows pages and `docs/android/latest.json` |

**How it was checked**
- Computer: `tsc` clean, the seven `scripts/test_*.mts` pass, `cargo test --lib` 108 passed (14 ignored). The Settings screen was driven in the dev app with real clicks (nine groups, no scrolling when closed, explanations hidden then shown, open groups remembered, both key fields present, 0 page errors). A walk through the main screens on 2026-10-26 gave 0 page errors.
- Phone: `tsc` clean; `cargo test --lib` in `mobile/src-tauri` 37 passed and the **3 desktop sermon tests fail there as before** (they need the desktop's databases; not caused by this work); the real-pack test (`--ignored`) passes. A signed test build with `BC_ORIGINAL_PACK_URL` pointing at a local server was installed on the owner's phone (the app started, no crash in the log) and the owner tried it; the release build was then made **without** the variable.
- Release files: signatures verified (Ed25519 over the BLAKE2b-512 hash); the live Android page's link, listed SHA-256 and `latest.json` were compared with the file the link gives.
- **Not seen by me:** the phone's screens (the owner looked); a saved PowerPoint opened in PowerPoint; the real projector.

**Gotchas met this time**
- A GitHub download can answer `503 Maximum threads for service reached` (a 496-byte reply): retry later; it is not the upload.
- Two commands in a row failed once with "the auto mode classifier gave no verdict" (a transient check failure): the command had NOT run; check with `git log` and run it again.
- The Android build needs the pack server only for a test build: `python -m http.server 8123 --bind 127.0.0.1` in `installer\packs`, `adb reverse tcp:8123 tcp:8123`, `BC_ORIGINAL_PACK_URL` set when compiling; all three were stopped and removed afterwards.

**Still open:** the real lexicon modules were not tried (only a stand-in): the owner can install Dodson, Abbott-Smith or BDB from the Library and look at "From your Library"; grammar search, word-by-word under the reading text and other items in §5; sync of notices and songs; nothing of the Sunday-service work exists on the phone.
