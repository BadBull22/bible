# Handover — 2026-10-13: Android app 0.3.0, and 0.3.2 with its own update check

**0.3.0 is released** (section 5). Sections 1 and 3 are kept as the record of how it was
built. Background: the Android app's own
handover is `HANDOVER_2026-10-11_V2_6_0_AND_ANDROID.md` (section 3: how the app is built, the
mirror to local disk, Avast and Java, the NDK, the signing key). Desktop 2.6.1 and the website
are in `HANDOVER_2026-10-13_V2_6_1.md` and `HANDOVER_WEBSITE.md`.

## 1. Where things stand

| Thing | State |
|---|---|
| Code for 0.3.0 | Committed and pushed. Version 0.3.0 in `mobile/package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `Cargo.lock`, `tauri.conf.json`. |
| Tests (this PC) | `npx tsc --noEmit` clean; `cargo test --test phone` 8 passed; `cargo test --lib bibles` 3 passed; the two internet tests (`-- --ignored`) passed: a real eBible.org download (German Luther 1912) and the nature backgrounds from GitHub. |
| Tried by the owner | In the desktop window (`npm run tauri dev` in `mobile/`): the screens. **Not** tried on a phone: share/save picture, voices, the reminder (they need Android). |
| Nature backgrounds | Published: GitHub release **`backgrounds-v1`** (not latest), `nature-backgrounds-v1.zip`, 7.7 MB, SHA-256 `86917e58634e3f109f0f9fca1e010b81e51b1fd92ed940d1823a41f459aaef77` (pinned in `src-tauri/src/backgrounds.rs`). 100 CC0 photos, approved by the owner. |
| APK | Built and signed on the PC with the Android tools, tested by the owner on their phone ("all the new features work"), released as `android-v0.3.0`. |
| Website | Offers 0.3.0 (section 5). |

## 2. What's new in 0.3.0 (the owner asked for items 1–10 of the comparison with YouVersion, ESV and BibleProject)

1. **Appearance** (More): theme Same as phone / Light / **Sepia** / Dark; text colour
   Standard / Strongest / Warm / Blue-black; contrast Standard / High; font Classic / Modern.
   The stylesheet no longer has `prefers-color-scheme` blocks: `appearance.ts` always sets
   `data-theme` to light, dark or sepia.
2. **Daily reminder** (Plans): `tauri-plugin-notification`, `Schedule.interval({hour, minute})`,
   id 4101, asks for the notification permission (Android 13+). Rescheduled when the time or
   the plans change; the text names the plan being read.
3. **Reading streak** (Plans): days in a row, best run, days read, chapters of 1,189 read.
   A chapter counts when its end is on screen after 15 s, or it was listened to the end.
   `reading_log` table; in the backup as `reading` (the desktop app ignores it).
4. **Verse pictures** (tap a verse ▸ Verse picture): Colours (6 gradients) or Nature
   (100 photos, a one-time 8 MB download, a grid and a Random button); Save or Share as PNG.
   Kotlin: `shareImage` (FileProvider `${applicationId}.phone.files`, declared in the plugin's
   manifest, `res/xml/phone_file_paths.xml`), `saveImage` (document picker).
5. **Read aloud**: the phone's English voices (`voices` in Kotlin, chosen voice passed to
   `speak`), a Slow speed, a sleep timer in the bar (15/30/60 min, end of chapter).
6. **Word study**: BSB and KJV words with Strong's numbers, the dictionary entry, counts, every
   verse using the word (`strongs_words`, `strongs_dict`, `strongs_counts` in the phone DB).
7. **Study notes**: Tyndale Open Study Notes per verse and per chapter, book introductions
   ("About <book>"), attributed (CC BY-SA 4.0). Matthew Henry was too large (13 MB).
8. **Side by side**: a second translation under each verse.
9. **More translations** (More ▸ More translations): eBible.org's catalogue (redistributable,
   1,200+), downloaded into `my-bibles.db`; read, compare, side by side; search uses the BSB.
   Uses `ureq` (rustls) and `zip` in Rust.
10. **Tags** on bookmarks and notes, a tag filter in My Study; bookmark tags in the backup.

Also: the phone database grew from 21.6 to **27.9 MB** (gz), so the APK will be about
**65 MB** (two ABIs each carry it). Dropping 32-bit ARM would roughly halve it — offered to
the owner, not decided.

## 3. To build and release 0.3.0 on the PC with the Android tools and key

1. `git pull`
2. **Turn the antivirus shields off** for the build (it reacts to cargo's build scripts).
3. Rebuild the phone database — it is not in git and changed in 0.3.0:
   `python mobile\data\build_phone_db.py`
   Expect about: `tagged verses 62187, strong's entries 14197, commentary notes 15161,
   book introductions 65` and `phone.db.gz 27.9 MB`. (It reads the desktop's `bible.db`,
   `study.db` and `commentaries.db` from `src-tauri\resources`.)
4. `cd mobile; npm install` (new: `@tauri-apps/plugin-notification`).
5. `cd src-tauri; cargo test --test phone` (8 pass), optionally
   `cargo test --test phone -- --ignored` (the two downloads; needs the internet). `cd ..\..`
6. `pwsh -File mobile\scripts\android.ps1 -Release` → `installer\BibleConcordance_Android_0.3.0.apk`.
   If the generated Android project in the mirror is old and the build complains about the
   notification plugin, delete the mirror's `src-tauri\gen\android` so the script regenerates it.
7. Check the APK asks for what it needs: `aapt dump permissions <apk>` (in the SDK's
   build-tools) should list `android.permission.INTERNET` and `POST_NOTIFICATIONS`.
8. **Test on the phone** (install over 0.2.1, so the old bookmarks/notes are kept):
   - the old bookmarks, highlights, notes still there; More ▸ Save a backup works;
   - More ▸ Appearance: Sepia, Dark, High contrast, Modern font;
   - tap a verse: Word study (tap a word, "Every verse"), Study notes, Verse picture —
     Colours, then Nature ▸ Get nature backgrounds (8 MB), Random, **Share** to WhatsApp and
     **Save** to Pictures;
   - More ▸ Read aloud: pick a voice, Try this voice; listen from a verse, set the sleep timer;
   - Plans ▸ Daily reminder at a minute from now — the notification arrives (allow it when
     asked); read a chapter to the end and see the streak;
   - "Side by side…" under the heading; "About <book>", "Study notes";
   - More ▸ More translations: download a small one (e.g. a New Testament), read it, compare,
     remove it;
   - tag a bookmark and a note, filter by the tag in My Study.
9. Publish, with `--latest=false` (the Windows updater reads `releases/latest`):
   `gh release create android-v0.3.0 installer\BibleConcordance_Android_0.3.0.apk --title "Bible Concordance for Android 0.3.0 (Beta)" --notes-file <notes.md> --latest=false`
   Then confirm `gh release list` still shows the desktop `v2.6.1` as Latest.
10. Website (`docs/android/index.html`, see `HANDOVER_WEBSITE.md`): version line, download
    link, size, file name in install step 2, SHA-256 (`sha256sum` of the APK); add the new
    features to "What's inside" (Appearance, reminder, streak, verse pictures, voices and
    sleep timer, word study, study notes, side by side, more translations, tags); and the
    Android card's meta line on `docs/index.html`. Commit and push.

## 4. Things to know

- **The Android code wasn't compiled here.** `PhonePlugin.kt` gained `voices`, `shareImage`,
  `saveImage` and a voice choice in `speak`; the manifest gained the FileProvider. If Gradle
  reports a Kotlin error there, that's the place.
- On a computer the phone-only commands answer "This only works on a phone": the reminder is
  hidden there (`canRemind` checks for Android).
- The backgrounds' zip URL and SHA-256 are in `backgrounds.rs`. A new set means a new release
  (`backgrounds-v2`), a new URL and hash in the code, and a new app version.
- The nature photos were chosen by eye from contact sheets; `data/backgrounds.json` lists
  each one's Commons page, author and licence (all CC0). Only one real lion and two sheep
  photos were good enough; the owner accepted the set.
- Desktop backups stay compatible: the desktop ignores the phone's `reading` field and bookmark
  tags (its own bookmarks have none).

## 5. Released on 2026-10-13

- **APK**: `BibleConcordance_Android_0.3.0.apk`, 69 MB, SHA-256
  `95145d415e09be07f54f682d4a2bcbf4b4b71c2b805500196968a59bf0cae18d`, same signing
  certificate as before. GitHub release `android-v0.3.0` (not latest; `releases/latest` is
  still the desktop `v2.6.1`).
- **Two fixes were needed to build it** (commit `de2924c`):
  - the plugin's manifest declared `androidx.core.content.FileProvider`, which the Tauri app
    template already declares, and a provider class may be declared only once, so the
    manifest merge failed. The plugin now has its own subclass, `PhoneFileProvider`.
  - `android.ps1` only ran `npm install` in the mirror when `node_modules` was missing, so
    the new notification package was absent. It now reinstalls when `package-lock.json`
    changes (it records the lock file's hash in `node_modules\.installed-for`).
- **Checked on the emulator**: a fresh install starts and reads; `voices` lists the English
  voices; word study and study notes return data; `share_image` opens the share sheet. The
  rest was tested by the owner on their phone.
- **Downloads cannot be tested on the build PC.** Avast re-signs HTTPS there (github.com and
  ebible.org included), and the app, using rustls with the public root certificates, rightly
  refuses it: `backgrounds_install`, the eBible catalogue and the two `--ignored` tests all
  fail on that PC, in the emulator too. They pass on the other PC and work on the owner's
  phone. This is not a bug; do not "fix" it by trusting the system's certificate list.
- **Website**: `docs/android/index.html` (version, link, size, file name, SHA-256, a new
  "What's inside" and "What it leaves out") and `docs/index.html` (the Android card and the
  "Which one is for me?" table, which the owner called important: it now lists word study,
  study notes, more Bibles, side by side, themes, verse pictures, the reminder and streak,
  and says where the two apps differ rather than only ticks and dashes).

## 6. 0.3.2 — the app looks for its own updates (2026-10-13)

The owner asked for the phone app to check for a new version once a day, like the Windows
app, and chose installing from inside the app.

- **How it works.** `docs/android/latest.json` on the website names the newest version: its
  number, the APK's address (must be under this repository's `releases/download/`), its
  SHA-256 and size, and a line of notes. `mobile/src-tauri/src/update.rs` reads it, downloads
  the APK and keeps it only if the hash matches; the phone plugin's `installUpdate` hands it
  to Android's installer through the plugin's file provider. Android asks the reader, and
  installs only a file signed with the app's own key. `src/Updates.tsx` is the banner
  ("Version X is ready — Later / Install") and More ▸ Updates (the version, a switch, Check now).
- **When.** At most once a day, when the app is opened (localStorage `pocket:update-checked`),
  if the switch is on (default on). No answer, or no connection, is silent. Nothing about the
  reader is sent. An app outside the Play Store cannot install silently or check while closed.
- **The first time**, Android wants the reader to allow this app to install apps
  (`REQUEST_INSTALL_PACKAGES`): the plugin opens that setting and the banner explains; the
  reader comes back and taps Install again (the download is kept, not repeated).
- **0.3.1 was withdrawn.** It downloaded into `app.path().cache_dir()`, which on Android is
  not `Context.cacheDir`, so `installUpdate` refused the file. Now the plugin names the folder
  (`updatesDir`) and `tauri_plugin_phone::updates_dir` is what the app uses. The 0.3.1 release
  and tag were deleted (it had been public for a few minutes and linked from nowhere).
- **Tested end to end on the emulator** (antivirus off for the session, so HTTPS worked): a
  release-signed test build labelled 0.3.1 offered 0.3.2 on opening, downloaded it, sent the
  reader to "Allow from this source", then on the second tap Android asked "Do you want to
  update this app?", installed it, and the app reopened as 0.3.2 saying "You have the newest
  version." Release builds cannot be driven through the WebView debugger; `uiautomator dump`
  and `input tap` were used instead.
- **Released**: `android-v0.3.2` (not latest), `BibleConcordance_Android_0.3.2.apk`, 69 MB,
  SHA-256 `7cd0c4cac29a206d98d5cc2f62bbf77bdce85ee9cf909a14f5a84a3697301d80`.
- **For every later phone release**: after `gh release create android-vX.Y.Z ... --latest=false`,
  edit `docs/android/latest.json` (version, url, sha256, size in bytes, notes) and push. That
  push is what makes installed copies offer it, so do it last, when the release's file is up.
  Copies of 0.3.0 and older have no checker and must be updated by hand once.
- **A test build** like the one used here: set the version one lower with
  `mobile` version files, build with `-Release -Targets aarch64,armv7,x86_64` (one APK for
  phone and emulator), then set the version back. It is kept as
  `installer\BibleConcordance_Android_0.3.1_update-test.apk` for the owner to try on a phone.

