# Handover — 2026-10-26 — the Sunday service: notices, music and sermon, songs, themes, and the new presenter

**Read this first.** It is the complete account of everything built on 2026-10-26 after the 2.9.5 test installer of 2026-10-23, written so that
a different session on a different PC can **build the next installer** from the working tree and know exactly what is in it, what has been
checked, and what has not. It builds on `HANDOVER_2026-10-26_PROPRESENTER.md` (the ProPresenter export and the first presenter; its §5d–§5p are the
running log of this same day, in order) and `PRESENTER_OPTIONS.md` (the options report). Older handovers: `HANDOVER_2026-10-23_LIVE_TEST.md`
(how the test installer was built and how to go on to a release), `HANDOVER_2026-10-22_GUIDED_BUILDER.md` (the step-by-step sermon builder, moving slides).

## 0. Start here

- **UPDATE (2026-10-26, evening): all of this is now released as 2.9.5** (commit `dcdfe8a`, GitHub release `v2.9.5`; see section 10 at the end). The rest of this bullet describes the state before that.
- **State:** everything below is in the **working tree on `V:\Code\bible`, uncommitted, unbuilt, unpublished.** HEAD is `74d3850` ("Website: Android
  download is now 2.9.4"); the latest release is **2.9.4**. Versions in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` are
  already **2.9.5** (see §6 for the version question).
- **The owner will have a new installer made from this tree** (they said so on 2026-10-26: "i will have a new installer file made upstairs").
  Nothing has been installed from this work: the owner tried it in the **dev app** (`npm run tauri dev`) only. The newest installer on disk,
  `installer\test\BibleConcordance_2.9.5_TEST_2026-10-26_x64-setup.exe`, has only the **first** presenter and the ProPresenter button; it has **none** of
  what is described here.
- **Clean at the end of this session:** the debug-port line (`additionalBrowserArgs` in `src-tauri/tauri.conf.json`) is **out** (checked: 0 matches).
  The dev app may still be running on the owner's PC; close it before building (a second cargo build collides on the target folder).
- **Checks run just before writing this:** `npx tsc --noEmit` clean; the six `scripts/test_*.mts` pass (songs, countdown, present groups, slide order,
  sermon layout, slide layout); `cargo test --lib` **106 passed, 14 ignored, 0 failed**.
- **Standing rules from the owner (all still apply):**
  1. **Antivirus:** remind the owner to switch their shields off before **any** Rust or Tauri compile, and wait for their yes. (It bites: the dev app crashed
     once on "unable to open database file ... bible.db" while a shield was scanning; a second start worked.)
  2. **Build locally, show the owner, publish only after their OK.** Never publish, commit or push unasked.
  3. **Test UI with real mouse and key events, on throwaway data, never the owner's own sermon.** If it slips, undo it and say so.
  4. **One installer for everyone.**
  5. The owner is not technical: plain words, say what changed and what to click, be honest about what was not tried.
- **Do not leave the dev debug port in a build.** See §5.

## 1. What the owner asked for, in order, and where it stands

| # | Ask | State |
|---|---|---|
| 1 | Slides from the sermon editor usable in **ProPresenter** (links, photos); explore an in-app alternative | Export built earlier (`HANDOVER_2026-10-26_PROPRESENTER.md`). **Never opened in ProPresenter** (no copy on any PC; the church has it on a Mac) |
| 2 | **Present from this laptop** (Windows, no live streaming): second screen/projector, mouse and keys, links and videos play on the screen | Built; tested with a second screen. Real projector, clicker and the pastor's laptop **not** tried |
| 3 | **Three presentations on a Sunday: Notices, Music, Sermon**, each saved apart, reusable, switchable | Built (§2.1) |
| 4 | **Songs**: words verse by verse, saved once, reused in different orders, **looked up**, shown live | Built (§2.3); lookup is an unofficial free service (§7) |
| 5 | **Add a verse/song/music/link/video/picture while presenting**; a **default Bible** chosen once | Built (`+ Add` in the presenter) |
| 6 | Each **song its own titled item**; next song chosen from a list; song sung twice = two items | Built (§2.3) |
| 7 | **Themes**: looping video backgrounds, headings over the background, from the church's free packs (folders) | Built (§2.5) |
| 8 | Countdown, Clear vs Black, volume, lower third | Built (§2.4) |
| 9 | **Notices library** like the songs list (Welcome 1/2/3, Bible study, Birthdays, Giving), editable, reorderable | Built (§2.2) |
| 10 | **Crowded slides**: auto-space, then drag parts by hand | Built (§2.6) |
| 11 | Scroll and sort for hundreds of saved items; newest first | Built (§2.7) |
| 12 | Saving that is obvious ("Name it and it saves itself" looked broken) | Fixed (§2.8) |
| – | **Resume** where the show stopped | Fixed: a big "Continue from slide N" button; the place is no longer overwritten while the offer shows |

## 2. What was built

### 2.1 The Sunday service page (Study menu → **Sunday service**)
`src/components/ServiceHome.tsx`, `src/service.ts`, `src/App.tsx` (menu item and the `@service` pane).
- Three cards: **Notices**, **Music**, **Sermon**. Each lists its saved items (a scrolling list, newest first, search, sort), **+ New**, a radio to tick the one in this
  Sunday's service, and open. The ticked ones are remembered in `localStorage` key `bc-service`. **▶ Present the service** opens the presenter with one tab per ticked part.
- A sermon is opened through `SermonBuilder`'s new `openId` prop (`0` = new, `n` = that saved sermon).
- **Notices and Music** are `DeckBuilder.tsx`: the same slides page as the sermon's (`SlidesEditor`), saved on their own. A new one **names itself**
  ("Notices, 26 October 2026"), saves one second after the first change and shows "✓ Saved at 14:43"; opening and leaving without a change saves nothing.
  Other slides, undo (typing coalesced), Save as PowerPoint, Save for ProPresenter, Present.

### 2.2 The notices library (left of the Notices page)
`src/components/NoticeLibrary.tsx`. A library of reusable notices (each one slide or a few), **in the order the preacher sets** (▲▼, kept), search,
A to Z, **+ Add** puts one on the end of today's notices, **Edit** (name, slides with heading and words, add/move/remove), **+ New notice**,
**Keep in my notices** under any slide, and an empty library offers **Start me off with some examples** (Welcome 1–3, Bible study, Birthdays,
Giving and tithing, Other notices; nothing is added unasked).

### 2.3 Songs
`src/songs.ts` (pure; `scripts/test_songs.mts`), `src/components/SongLibrary.tsx`, `src-tauri/src/lyrics.rs`, `src-tauri/src/decks.rs` (the `songs` table).
- **Song** = title, writer, CCLI number, **sections** (Verse 1, Chorus...) and an **arrangement** (indexes into the sections). Words are typed or pasted: a line
  "Verse 1"/"Chorus"/"Bridge" starts a part, a blank line ends one, a heading on its own again sings that part again. Words copied from the web with no headings:
  a part that comes round again (same words, or the same first line) is the **Chorus** (then Refrain, Bridge, Tag), the rest Verse 1, 2... (names a heading may say,
  so they survive being typed back).
- **Look up the words** (song editor, or "Look up “…” online" when a search finds nothing): `lyrics_search` / `lyrics_get` call **lyrics.ovh** (free, no key,
  unofficial) from Rust, only when asked; the words land in the editor to be checked, never saved unseen. "Search the web instead…" opens the browser. A text file can be opened.
  The editor says the words are the church's to show under its own **CCLI** licence.
- **Music page (left panel, always there):** the saved songs, search, A to Z / Newest, **+ Add** (appends the song with its title slide; lines per slide and the
  title-slide tick are in the panel), Words, + New song, **Arrange a list…**.
- **Arrange a list / "Choose the songs"** (`SongPicker`): saved songs on the left with **+ Add**, **Today's list** on the right in order (▲▼, take off, change the
  order of the parts of any one song), lines per slide, a title slide for each song, and **Saved lists…**: a selection saved **with a name and a date** and opened later.
- **Slides for a song:** `songSlides()` — an optional **title slide** (`kind:"point"`, `section:"Title"`, body = writer), then a slide per chunk of a section
  (`kind:"song"`, `song`, `section`). `presentGroups.ts`: all of a library song's slides are **one group** named for the song; a title slide starts the group, so the
  same song twice is two groups. A song is added **after the end of the song selected**, never into the middle.
- **ProPresenter export** (`propresenter.rs`): one group per song, cues named for the parts.
- **Presenter, music deck:** a **song list down the left** (search, In order / A to Z, click to start a song, "+ More songs"), a heading over each song in the grid, and
  **the end of a song stops there** (the screen goes black, "End of the song: press Next, or choose the next song"; Next again starts the next song).

### 2.4 The presenter ("Present from this laptop") — `src/components/SlideShow.tsx`
Operator window + a second **projector window** (`show-<time>`, Tauri window from `show_window_open`), talking by events (`show:state`, `show:ready`, `show:key`, `show:ended`,
`show:blocked`, `show:time`). With one screen it is a rehearsal (the preview is the room) unless forced.
- Takes `decks: PresenterDeck[]` (Notices / Music / Sermon): **tabs** (keys **1–9**), each keeps its own place; grid or list; colours and group letters; clock and timer.
- **Resume:** per part; a big "Continue from slide N" / "Start at slide 1" bar. Starting "From this slide" skips it. (The cause of "it started from the beginning": the
  place was overwritten with slide 1 before the offer was answered; now it is not written while the offer shows.)
- **+ Add** (`LiveAdd.tsx`): **A Bible verse** (`VerseFinder.tsx`; the Bible chosen last is kept as the default, `bc-default-bible`), **A song** (the list builder, "Show now"),
  **Music, video or link** and **A picture** (`MediaAdder.tsx`: paste a web address or choose files). Goes in **after the slide showing** (after the end of the song, for a song);
  for **this show only**; "Show it now" puts it on the screen.
- **Clear** (Esc: words off, background stays) and **Black** (B or full stop) are separate; the next slide brings the words back. **Volume** for clips (files, YouTube, Vimeo).
  **Lower third**: a line over the foot of the screen. **Countdown slide** (below). Keys: arrows, Space, PageUp/Down, Backspace, Home/End, Enter (play/pause a link), B or . black,
  Esc clear, group letters (not B, N, P), 1–9 parts.
- **Countdown slide** (`+ Countdown`, `src/countdown.ts`): "5" minutes, "1:30" a length, "at 10:30" a time of day; starts when it comes on the screen. Exports as a text slide.

### 2.5 Themes: moving backgrounds, headings, layers — `ThemePicker.tsx`, `themes.rs`
- Slides bar: **Moving backgrounds and layers…** (all slides). Each slide's look box: **A photo…**, **A moving background…**, **A cursive heading…**, **Picture beside the words (a logo, say)**,
  **Same as all**, **Plain**, **Use for all slides**; a tick **Leave out the written heading** (`noHeading`) for a slide whose heading is a graphic.
- The picker reads a **folder** (the unzipped packs; remembered in `bc-theme-folders`, nothing bundled in the app, nothing copied until a file is chosen). `theme_list` gives each
  file a **role**: a PNG with a see-through channel (read from its header), or anything in a folder named titles/layers/lower thirds/overlays/logos, is an **overlay**
  (a heading or layer); the rest, and every video, are backgrounds. Tabs: **Backgrounds / Moving / Headings and layers** (headings are drawn over the background now chosen).
  Choosing a file copies it into the app (`theme_use` → `sermon_media::import_file`, streamed, named by its hash) and **closes the window**.
- A video background loops muted behind the words on the screen, the preview, and (first frame) the thumbnails. An overlay is under the words.
  Data: `SlideSpec.background` may be a video; `SlideSpec.overlay` (`""` none, absent = the deck's); deck-wide `DeckBody.overlay` / `SermonBody.slideOverlay`.
- **Exports:** PowerPoint leaves a **moving background** out (`stillBackground()` in `service.ts`); the ProPresenter bundle keeps the background. **No overlay, layout or
  noHeading in either export.**

### 2.6 Crowded slides: auto-space, then drag — `src/slideLayout.ts`, `SlidesEditor.tsx`
A slide with **its own heading graphic** plus words and/or a picture is spaced automatically: the graphic's solid part is found from its alpha channel (`useBBox`, a 192×108
canvas), the heading goes on top (as large as fits, never enlarged), words and picture under it side by side; each words box fits its own text. A deck-wide layer covering
more than 70 % of the slide is a decoration and is left alone. **By hand:** the big preview shows a label on each part (Heading, Words, Picture) to drag and a corner square to
resize; the places are kept in `SlideSpec.layout` (percent of the slide); **Auto-space this slide** clears them. Every view (strip, grid, preview, projector) uses the same plan.

### 2.7 The service page for hundreds of items
Lists scroll inside their cards (max 52 vh), are **newest first** by the date shown (a sermon's preached date, else when last changed), with search and a sort once there is more than one.

### 2.8 Saving, in one place
Notices/Music pages: automatic, one second after a change (named from the start); the saved notices and songs libraries save on their own buttons and on every add/reorder/delete;
the sermon after its first Save (unchanged).

## 3. Data model (for whoever touches it next)

**Database** (`userdata.db`, in `%APPDATA%\com.local.bibleconcordance`; the dev app and the installed app **share it**, so the songs now in it — Amazing Grace, Gratitute, Raise a
Hallelujah — are the owner's own):
- `decks (id, kind, title, body, position, created_at, updated_at)`; `kind` ∈ `notices` | `music` | `songlist` | `notice` (a notice in the library). `position` was **added by
  migration** (`ALTER TABLE decks ADD COLUMN position`) and orders only `notice` rows (`deck_order_cmd`); the other kinds list newest first.
  Bodies: a deck/notice `{slides, background, overlay}`; a song list `{date, perSlide, titles, songs:[{id, order[]}]}`.
- `songs (id, title, author, ccli, words, body, ...)`; `body` = `{sections:[{label,text}], arrangement:[...]}`; `words` is the plain text for search; saving a song with the same title
  and writer updates it (kept once).
- Sermons are unchanged (`sermons`), apart from `SermonBody.slideOverlay` inside the JSON.
- **Not in sync.** `sync.rs` (folder sync and Wi-Fi sync with the phone) knows nothing about `decks` or `songs`: they exist on this computer only (§7).

**Slide fields added** (`SlideSpec` in `src/sermonOutputs.ts`, `Slide` in `src-tauri/src/slides.rs` for the exports): `notes`, `song`, `section`, `overlay`, `noHeading`, `layout`
(plus `SlideKind "countdown"`). `slides.rs`/`propresenter.rs` ignore the ones they don't use (serde, no deny-unknown-fields).

**Tauri commands added:** `deck_list_cmd`, `deck_get_cmd`, `deck_save_cmd`, `deck_order_cmd`, `deck_delete_cmd`, `song_search_cmd`, `song_get_cmd`, `song_save_cmd`, `song_delete_cmd`,
`lyrics_search`, `lyrics_get`, `theme_list`, `theme_thumb`, `theme_use`, `save_sermon_propresenter` (earlier), all in `lib.rs`. The capability file already allows `dialog:allow-open` (the folder chooser).

**`localStorage` keys:** `bc-service`, `bc-default-bible`, `bc-theme-folders`, `bc-present:<key>` (the place in each part), `bc-present-view`, `bc-slides-screen`.

**New/changed files** (all uncommitted): Rust `decks.rs`, `lyrics.rs`, `themes.rs`, `propresenter.rs`; changed `userdata.rs`, `sermon_media.rs`, `slides.rs`, `lib.rs`. Frontend new: `DeckBuilder`, `ServiceHome`,
`SongLibrary`, `NoticeLibrary`, `ThemePicker`, `LiveAdd`, `VerseFinder`, `MediaAdder` (components); `service.ts`, `songs.ts`, `countdown.ts`, `slideLayout.ts`, `presentGroups.ts`, `slideOrder.ts`;
changed `SlideShow`, `SlidesEditor`, `SermonBuilder`, `MediaPicker`, `App.tsx`, `App.css`, `api.ts`, `sermon.ts`, `sermonOutputs.ts`. Tests: `scripts/test_*.mts` (6) and the Rust tests (decks, lyrics, themes, propresenter, slides).
(The tree also holds the earlier step-by-step builder files, `Guide*.tsx`, `SermonGuide.tsx`, `guideData.ts`, and `mobile/` version bumps and `offline_ai.rs` changes from earlier sessions: not part of this work.)

## 4. How it was tested here, and how to test again

- **Dev app:** `npm run tauri dev` (needs the antivirus off the first time). **A debug port** was used to drive it with real mouse and key events: a temporary
  `"additionalBrowserArgs": "--remote-debugging-port=9222 --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"` inside the window object of `src-tauri/tauri.conf.json`.
  **Changing that file restarts the dev app and closes the owner's window** — toggle it rarely, and **delete it before any build** (§5). The helper (`cdp.mjs`: connect to the page by
  its debug port, `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`, `Runtime.evaluate`; the projector window is the page whose body has class `show-body`) lived in the
  session's scratch folder and is **not in the repo**; it is about 60 lines.
- **What the checks proved (all with real clicks, drags, keys, on throwaway data that was deleted afterwards):** the service page and tabs; a song looked up online, split, saved and
  listed; songs as titled groups, the end-of-song stop, the left song list (search, sort), Clear/Black, lower third, the countdown counting, saved lists with a name and date;
  the moving background playing on the projector with a picture over it; headings sorted from backgrounds and chosen per slide; the picker windows closing on choosing; auto-spacing
  with no overlaps, dragging and resizing parts, Auto-space restoring; the notices library (examples, search, reorder kept, add, edit, keep a slide); scrolling and sorting 40 items;
  a new page naming itself and saving.
- **Test data hygiene:** throwaway decks were titled "ZZ …" and deleted; files copied into `sermon-media` were deleted **by their exact content-hash names** (never a wildcard). The
  media folder also holds files from the owner's own use: do not tidy it.
- **Gotchas:** (1) long inline Python or shell with nested quotes and heredocs failed to parse: write scripts with the file tool, run them; (2) the harness's safety check refuses
  `rm` on a variable path — use literal paths or `"${VAR:?}/${f:?}"`; (3) React StrictMode runs effects twice in dev (the projector-window effect guards with a per-run flag);
  (4) a CSS rule `.slide-preview > *:not(...)` with higher specificity once kept boxed parts in flow; (5) hot reload sends the dev app back to the home screen mid-test; (6) `cargo test` takes
  one name filter, or `--lib -- a:: b::`.

## 5. Building the installer — a checklist for the next session

1. **Ask the owner to switch the antivirus shields off and wait for yes.** Close the dev app (and any other cargo).
2. `git status` should show the changes in §3. **Confirm the debug port is not in the config:** `grep -c additionalBrowserArgs src-tauri/tauri.conf.json` must print `0`.
3. **Version.** Everything says 2.9.5 (the owner's 21, 23 and 26 Oct test installers were all "2.9.5"). A few new comments say "since 2.9.6" (`userdata.rs`, `sermon.ts`). Either bump the
   three files to **2.9.6** (and `Cargo.lock` follows) or change those comments. This is a decision for the owner if it is to be released; for another test installer, 2.9.5 is fine.
4. `npx tsc --noEmit`; the six `node --experimental-strip-types scripts/test_*.mts`; `cd src-tauri && cargo test --lib` (expect 106 passed).
5. **Test installer** (unsigned, NSIS only, about 8½ minutes; Rust output goes to `C:\Users\admin\AppData\Local\bible-concordance-build\cargo-target`):
   `npm run tauri build -- --bundles nsis --config <a file containing {"bundle":{"createUpdaterArtifacts":false}}>` (the config goes in a file because quotes are not safe through npm on Windows).
   Run it as a **tracked background command** and read its log for the exit status; a subshell `( … ) &` build can look dead while still compiling. Do **not** start a second build while one runs
   (it collides on `dist`). The result is `...\cargo-target\release\bundle\nsis\Bible Concordance_<version>_x64-setup.exe`.
6. Copy it to `installer\test\BibleConcordance_<version>_TEST_<date>_x64-setup.exe` (git-ignored; the shared drive, so both of the owner's PCs reach it), compare size and **SHA-256** with the build output,
   and check: the new screens' words are in the bundled web files (for example "Sunday service", "Start me off with some examples", "Auto-space this slide"), and **the binary contains no `remote-debugging-port`**.
7. **A real release** (signed, on GitHub and bible4me.org) needs the updater signing key and `scripts/release.ps1`, and the owner's OK: see `HANDOVER_2026-10-23_LIVE_TEST.md` §5 and
   `HANDOVER_2026-10-06_V2_4_0.md`. The Android side is separate (`mobile/`, nothing here touches it; `docs/android/latest.json` is its own step). **Do not commit, push or publish unasked.**

### What the owner should try after installing (a short list to hand them)
1. Study → **Sunday service**. Make **Notices**: press "Start me off with some examples", + Add a few, drag a part of a slide, add a cursive heading from the pack folder.
2. **Music**: look a song up (a title, "Look up the words", choose the version, check the words, Save), + Add two songs, Present: use the list on the left, press Next at the end of a song.
3. In the presenter: **+ Add** a verse (check the Bible chosen), **Clear** and **Black**, the lower third, a **countdown** slide.
4. Tick one of each on the service page and **Present the service**: keys 1, 2, 3 switch parts; close the presenter and open it again to see "Continue from slide N".
5. Try it on the **real projector** and the **pastor's laptop**, with his clicker if he has one.

## 6. Open decisions and questions for the owner
- **CCLI:** does the church have a licence or a SongSelect login? (Showing words on screen needs the church's own licence; the app says so but cannot check it.) Asked; not answered.
- **Version number** for the next build (§5.3), and whether this is a test installer again or a release.
- **Which next:** (a) **import the church's songs from ProPresenter** (`.pro` files; I know the format from the export work — a reader would split the text slides into verses), (b) **sync** notices, songs, lists and
  sets between computers and the phone (§7), (c) put headings, layout and overlays into the exports, (d) reorder the parts of the service.

## 7. Known gaps, risks and not-yet-built
- **Sync:** `decks` and `songs` are **not** in `sync.rs`. Two computers will have different libraries. The phone app does not see any of it. This is the biggest gap before wider use.
- **Lyrics lookup** is `api.lyrics.ovh`: free, unofficial, unmetered, can vanish or miss newer songs; the words need checking. Nothing is fetched until asked. Paste and "Search the web instead" remain.
- **ProPresenter:** the bundle is verified against the real schema only; **never opened in ProPresenter**. Heading graphics, layouts, overlays and countdowns do not go into it (a countdown is a text slide). The test pack
  for the church is in `installer\test\ProPresenter test pack\` (git-ignored); the church's answers are still awaited.
- **Not tried:** a real projector, a clicker, one-screen rehearsal on a machine with a single screen, the pack's 394 MB countdown video, hundreds of real items (only 40 throwaway ones), playing a Facebook/Vimeo embed.
- **Performance:** each slide thumbnail with a moving background holds a video element (first frame only); a deck of many such slides has not been stress-tested.
- **Layout is per slide** and ignored by PowerPoint and ProPresenter exports. A heading graphic spaced round assumes the picture is slide-sized (the packs' are).
- **Service part order** is fixed (Notices, Music, Sermon); the same deck cannot be used twice in one service.
- **Left over from before:** outline dragging in the sermon builder (HTML5 drag, probably broken on Windows); the one-screen rehearsal path.
- **Public files:** nothing in this work needs mentioning in public files or the website. No packs, test pictures or lyrics are in the repo (the packs live in the owner's Downloads and a scratch folder).

## 8. The owner's preferences, as seen this session
- Wants to see things in the dev window and test them himself; watches closely. **Do not restart or close his dev app without saying so.**
- Likes: a visible "start here" when a page is empty (an arrow pointing up); lists on the left with search and sort that are **there from the start**; closing a window once a choice is made;
  everything reusable and saved by name and date; the sermon, notices and music "doing basically the same thing".
- Does not want: a feature that looks greyed out and does nothing; a long continuous slide show where songs run together; installers until "everything is in" (he now wants one made).
- Plain, short answers with what to click; he reads screenshots he sends, so describe by what is on screen.

## 9. The Top 100 worship songs list (added 2026-10-27, owner's request; in the working tree, typechecked, not yet seen on screen)
- **Asked for:** "a small database of the song lyrics for the current top 100 songs" (PraiseCharts list, updated 23 October 2026), "already loaded before I produce an installer". **What was built instead, and why:** the words of these songs are copyrighted and are **not** bundled in the app, the installer or the public repo (an installer goes to everyone who downloads it; the church's CCLI licence covers the church's own use, not shipping a lyrics collection). The list itself (title, artist, keys: `src/worshipTop100.ts`, 100 entries) ships in the app, and the words are loaded **once per computer** with the lookup that already exists.
- **Music page, left panel → "Worship Top 100 (2026)…"** (`WorshipTop100Dialog` in `SongLibrary.tsx`): the 100 songs with rank, artist and keys, a filter (Not kept yet / All / Kept), a search, "N of 100 kept". **Look up and check** opens the song editor with the title and first artist filled in and runs the existing lyrics lookup; `bestHit()` takes the result with the same title (and artist) automatically, otherwise the preacher picks from the usual "Which one?" list. The words land in the editor for checking; **nothing is saved unseen**. Save keeps the song in the library, the row shows "✓ Kept", and (tick box, on by default) the next song not yet kept opens. A song already in the library is recognised by its title ("(Live)" and the like are ignored).
- **Songs to a file / Songs from a file…** (same panel): every saved song (words included) in one `.json` file (`makeSongsFile`/`readSongsFile`, format `bible-concordance-songs` v1) to copy to the church's computer; loading it adds the songs (same title and writer = updated, not doubled). Frontend only (a Blob download and a file input); **the download must be tried in the real app** (WebView2 may ask where to save or put it in Downloads).
- **Tests:** `node --experimental-strip-types scripts/test_top100.mts` (the list is 100 long, title cleaning, matching, the file round trip); `npx tsc --noEmit` clean; the other five scripts still pass. **Not run:** the dialog on screen, a real lookup, the file download (needs the dev app, so a Rust compile and the owner's antivirus off). No Rust changed for this.
- The lookup service (lyrics.ovh) is unofficial and is the same one as before; some modern songs may not be found (then paste the words, or open a SongSelect text file with "Open a text file…").

### 9b. "Update the list" and colours (added the same day; tried in the dev app with real clicks)
- Keys are gone from the list (owner: "just song and artist"). **Update the list** (Top 100 window) calls the Rust command `chart_top_songs` (`lyrics.rs`), which reads PraiseCharts' own list feed `https://www.praisecharts.com/api/v3/elastic/song-list/top-100-worship-songs-of-<year>` (the address the chart page itself uses; robots.txt does not disallow it; one request, only when the button is pressed; this year, last year if there is none yet). Only titles and artists are read. The result is merged with the kept list (`mergeChart`, stored in `localStorage` `bc-top-list`).
- **Colours:** green = kept (has words), orange + "New" = not on the list before the last update (stays until the marks are cleared or the song is kept), plain = no words yet, grey "off the chart" = dropped (shown only if its words are kept). Filters: Without words yet / All / Kept / New on the chart. "Update the list (N new)" shows the count.
- **Tried in the dev app:** the dialog (100 rows), Update (live chart read: "nothing new" on the 26 October list), a stored list made older (2 new, 1 off the chart, a New row in orange), Look up and check on a real song (title and artist filled, the right version taken automatically, 12 parts, no list to choose from), Songs to a file (a valid file with the saved songs; the download went to Downloads), Songs from a file (a throwaway song loaded, loaded again = still one, deleted). `cargo test --lib lyrics::` 4 passed; `scripts/test_top100.mts` passes; `tsc` clean.
- **CCLI:** looked at. ccli.com/top-100 is a script-built page with no list in its text, SongSelect needs a login, and the only data address on the page is for their Rehearse app (login). **Not readable**, so nothing was built for it. If the church has a SongSelect login, "Open a text file…" reads what it downloads.
- **Left in the tree for the owner's dev session:** the test-port line `additionalBrowserArgs` in `src-tauri/tauri.conf.json` is **still there** (the owner was using the dev app, and removing it restarts the app). **Remove it, and stop the dev app, before building an installer** (`grep -c additionalBrowserArgs src-tauri/tauri.conf.json` must print 0).


### 9c. Fix: dragging to select text in a window and letting go outside it closed the window (owner: the song editor closed back to the list)
The dark background of a window counts a click when the mouse is let go on it, even if the press was inside the window. New `src/backdrop.ts` (`backdrop(onClose)`) closes only when the press AND the release were on the background; used by all nine such windows (song editor, Top 100, song picker, notice editor, live add, media picker, theme picker, the two in SlidesEditor). Checked with real mouse input: select in the words box, let go on the background: stays open and the selection stays; a real click on the background closes it.

### 9d. Fix: words that came with no blank lines stayed one part (owner screenshot: "What A Beautiful Name", "1 part")
`breakUp()` in `src/songs.ts`, used by `parseSong` for any block with no heading and more than 10 lines: it finds the run of two or more lines that comes round again (the chorus), cuts the song at each place it is sung, and cuts what is between into parts of about four lines (a short end joins the part before). No repeat: parts of four lines. A short block, a headed block, and words that already have blank lines are left alone. Test: `scripts/test_songs.mts` (made-up lines). Checked on real look-ups (shape only): that song went from 1 part to 12; songs that already had blank lines are unchanged. It is a best guess (a bridge can come out long): the words box is for correcting it.

### 9e. Safety net for markers and names a look-up leaves in the words (owner screenshot: "Verse 3 / CHORUS(2)", "Chorus 3 / CHORUS(1):")
In `src/songs.ts`: a heading may carry its number in brackets ("CHORUS(2)", "Chorus (1):"); a direction line ("(x2)", "x 2", "repeat 3 times") is dropped, not kept as words; a heading in the middle of a block (words that lost their gaps) starts a part of its own (`WORD_HEADING`, not the one-letter names); and a second part with the same name but other words gets the next free number (the first keeps the plain name, so "Chorus" alone still means it). Same words under the same name are still one part sung again. Test: `scripts/test_songs.mts` (made-up lines). Real look-ups (shape only): "How Great Is Our God" had 8 marker lines, none left; the other six songs checked are unchanged. Songs already saved before this keep what they had: look the song up again (or fix the words box by hand).

### 9f. Song slides: the words large, the song and part small in a corner (owner)
`Words()` in `SlidesEditor.tsx`: a `song` slide draws `.slide-lyrics` (2.3em) and a small `.slide-corner` caption at the top right ("Song · Verse 1"); only the title slide names the song in large type. `noHeading` on a song slide leaves the caption off (a tick "Leave out the song name in the corner"). PowerPoint (`slides.rs`, kind `song`): large centred words (up to 44 pt) and a 14 pt caption at the top right. Checked in the dev app: 10 of 10 lyric slides had the corner caption and none the old heading.

### 9g. PowerPoint saves had no backgrounds for moving backgrounds or layers (owner)
Photos were kept, but a **moving background** (video) was dropped and the **overlay** (heading graphic or layer) never went in. Now: `src/stills.ts` `stillFor()` takes a still frame from a video background (a quarter of the way in, up to 1 s; 1280x720 JPEG, kept in the media folder, once per file) and that is the slide's background in the PowerPoint; `Slide` in `slides.rs` gained `overlay` (drawn full-slide over the dim layer, under the words) and `noHeading` (title, point, text and song captions are left off). Used by `DeckBuilder.forExport` and `SermonBuilder.saveSlides` (the ProPresenter bundle still keeps the video, and ignores the overlay). Test: `cargo test --lib slides::` (new case). Checked in the dev app: a real video background became a JPEG background on two slides, the layer on the first, no written heading where left off; the test file and the JPEG were deleted.

### 9h. A music or video link slide showed its title and "Play" over the playing clip (owner)
`SlideShow.tsx`: the words of a slide with a clip are taken off (`bare`) in the projector screen and in the operator preview while the clip is playing or paused (`clip !== "stopped"`); they come back when it stops. Checked with real clicks: before play 1 title and 1 "Play"; while playing and while paused none.

## 10. Released as 2.9.5 (2026-10-26, evening)
- **Checks before the build:** `tsc` clean, the seven `scripts/test_*.mts` pass, `cargo test --lib` 108 passed (14 ignored). A walk through the dev app (Home, a reference, a search, every Study, Reference and Explore menu item, the Sunday service page, every sermon-builder tab) gave **0 page errors**.
- **Build:** `npm run tauri build -- --config <a file with {"bundle":{"createUpdaterArtifacts":false}}>` (setup `.exe` and `.msi`), both signed by hand (`npx tauri signer sign -f %USERPROFILE%\.tauri\bible-concordance-updater.key -p ""`), then `scripts\release.ps1 -SkipBuild -Notes "..."` (collects the files into `installer\` and writes `latest.json`). Both signatures were verified (Ed25519 over the BLAKE2b-512 hash) against the local files and again against the files downloaded back from GitHub; the live `latest.json` says 2.9.5 and carries the same two signatures. Sizes: setup 378,148,680 bytes, msi 439,824,384.
- **Commit and release:** `dcdfe8a` "2.9.5: Slideshow Builder, step by step, adding backgrounds" (71 files, as BadBull22; scanned: no email, key or test-port line); release `v2.9.5` marked Latest, notes "Slideshow Builder, step by step, adding backgrounds." (the owner's wording). Website: `docs/index.html` and `docs/windows/index.html` Windows lines name 2.9.5; the Android lines stay 2.9.4.
- **Still open from section 7:** sync of notices, songs and lists between computers and the phone; the ProPresenter export has never been opened in ProPresenter; the CCLI licence question; the sermon outline's dragging on Windows; nothing here exists on Android. **CCLI's chart could not be read** (a script-built page, and SongSelect needs a login), so the Top 100 list updates from PraiseCharts only.
- **Not tried by anyone:** a real projector and clicker; a saved PowerPoint opened in PowerPoint; a YouTube link in the presenter (a local video was tried).
