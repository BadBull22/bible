# Handover — 2026-10-26 — export to ProPresenter, and the in-app presenter options

Read this first for ProPresenter. It builds on `HANDOVER_2026-10-23_LIVE_TEST.md` (the test installer, the live session, how to release)
and `HANDOVER_2026-10-22_GUIDED_BUILDER.md` (the sermon builder and slides). **Nothing here is committed, built into an installer or
published**, and the new button is **not** in yesterday's test installer.

## 0. Start here

- **Asked for:** (1) slides prepared in the sermon editor must import into ProPresenter, with links, photos and so on, fully usable;
  (2) in parallel, explore options for showing the slides in the app with ProPresenter-like usability — exploration only.
- **Done:** a native ProPresenter export (`Save for ProPresenter` on the Slides tab), and the options report `PRESENTER_OPTIONS.md`.
- **Not done, and cannot be here:** opening the export **in ProPresenter**. The owner has none on any PC; **the church has it on a Mac**
  (version not known: the owner says it may be old; version 22, a subscription product, is out). The format is the community's
  reverse-engineered one, so **the church's Mac is the real test**. A test pack is ready for them (§3).
- **First things next time:** get the church's answers to the checklist in the test pack's `READ ME FIRST.txt`; fix what they report; then
  decide whether to build a new test installer so the owner can use the button from the app (needs the antivirus shields off first).

## 1. What was built

| | |
|---|---|
| `src-tauri/src/propresenter.rs` (new) | Writes a `.probundle`: a zip with one `.pro` (Protocol Buffers `rv.data.Presentation`, hand-encoded by a small writer) and the media flat at the root. Command `save_sermon_propresenter` → `{path, warnings}`; file `<title> - ProPresenter.probundle` in Documents\Bible Concordance |
| `slides.rs` | The `Slide` model gained `notes` (the preacher's slide notes) |
| `lib.rs`, `src/api.ts`, `SermonBuilder.tsx` (`saveProPresenter`), `SlidesEditor.tsx` | Command registration, API call, and the **Save for ProPresenter** button beside Save as PowerPoint. Warnings are shown in the "Saved" message |
| `scripts/check_probundle.py` (new) | Decodes a bundle against the real schema and checks it hangs together (setup notes at the top) |
| `PRESENTER_OPTIONS.md` (new) | The exploration: what the app has, what ProPresenter has, options A–F, what decides the outcome, a suggested path, questions for the owner |
| `installer/test/ProPresenter test pack/` | `Born again - ProPresenter.probundle`, `Born again - slides.pptx` (the same slides as PowerPoint, the fallback) and `READ ME FIRST.txt` for the church. Git-ignored (`installer/`) |

### What each slide becomes in ProPresenter
- **title / point / Scripture / words:** one text slide (navy, white, centred, shrink-to-fit), the words as Apple CocoaRTF with every non-ASCII
  character as `\uN?`. A group for the title, each point and each song; Scripture, picture and link slides join the point before them.
- **song:** a slide per verse (blank line between verses), one group.
- **image, video, music:** a **media cue** (an empty slide action plus a foreground media action) whose file is inside the zip and named
  relative to it: `URL.absolute_string` = the file name, `platform` = macOS, `local` = `ROOT_CURRENT_RESOURCE` + the name (the combination
  the bundle notes say resolves on a Mac). A file used twice is stored once.
- **a slide's own background photo:** a media action on the **background** layer (an educated guess; see §2).
- **a picture beside the words:** ProPresenter has no side-by-side without a template, so it becomes its own picture cue after the slide.
- **notes:** the slide's notes. **A web link** cannot be an action (the schema has none), so it is a slide with the address shown and in the notes.
- **warnings:** a missing file, a kind of file that can't go in, or a `.wmv`/`.avi`/`.wma` (a Mac may not play it) are reported, not silently dropped.

## 2. How sure are we: what is verified and what is a guess

- **Verified here:** the Rust tests (wire format, RTF, ids, bundle contents, the groups and cues linkage, media resolution, warnings); and
  `check_probundle.py` against the **real `.proto` files** compiled in Python: the sample and the full test pack decode with **no field the
  schema does not know**, the groups list the cues in order once each, ids are well formed and all different, every media file is in the zip.
- **Not verified, needs ProPresenter:** that it **imports at all**; that the text looks right; the **background-layer photo** on the title
  slide; that **video plays**; that **notes** show; that groups and names appear. The upstream notes themselves say the proto definitions are
  incomplete and that round-tripping real files fails, so a from-scratch file stays "unverified" until opened in the real program.
- **Choices that are guesses (the first places to look if it fails):**
  1. `ApplicationInfo` claims ProPresenter 7.16 on macOS 14 (an older claim is the safe one; newer versions read older files).
  2. A text element's path is a four-corner rectangle in the unit square with shape type 1; fill, stroke and shadow are omitted.
  3. The background photo is a media action with `layer_type` 0; foreground is 1.
  4. No `arrangements` (valid per the notes); `Cue.isEnabled` and `Action.isEnabled` are true.
  5. Overall: the community specs were written by one developer; no Renewed Vision documentation exists.
- **ProPresenter versions:** `.pro` and `.probundle` import is in the 7.x line and later (the 21 and 22 notes mention fixes for them, none a
  format change). Version 21.2+ also has a native **PowerPoint importer** (editable slides, no PowerPoint needed; 22 adds "with or without
  backgrounds"). Older versions need PowerPoint installed to import `.pptx`. So the bundle is the version-proof route; the `.pptx` is the second.

## 3. The test pack and what to do with the answers

`V:\Code\bible\installer\test\ProPresenter test pack\` (shared drive, reachable from both PCs): the bundle, the PowerPoint, and
`READ ME FIRST.txt` with the checklist (imports? version and Mac? colours and size? long passage shrinks? title photo? photo and video?
notes? groups? editable?). Built from the owner's own photo and a generic 10 MB clip from Downloads; every kind of slide appears once.

When the answers come back:
- **Import fails or the program complains:** note the exact message and version, try the `.pptx`, then adjust the guesses in §2 one at a
  time with `check_probundle.py` and the tests. A real ProPresenter-made `.pro` of a tiny sermon (one slide, one photo, one video), taken
  from the church, is the best possible reference: decode it with the same schema and copy what it does.
- **Imports but looks wrong:** change `text_element` (bounds, font, margins) and `rtf()`; rebuild the test pack with
  `SLIDES_OUT=<folder> SLIDES_PICTURE=<jpg> SLIDES_CLIP=<mp4> cargo test --lib propresenter::tests::sample -- --ignored --nocapture`.
- **Works:** say so here, then consider the reverse (import a `.pro` back into sermon slides: `PRESENTER_OPTIONS.md` §4F).

## 4. The exploration (`PRESENTER_OPTIONS.md`) in one paragraph

The app already has a second-screen show, a presenter view (next slide, notes, clock, timer), blackout, video, music and YouTube clips, and
a private-network server (used for the phone). Matching ProPresenter for **a sermon** is modest; matching it for **a whole church
production** (song libraries, hardware outputs, NDI, many screens) is years and not recommended. The biggest obstacle is not code: the
church uses a **Mac** and the app is built for Windows. Recommended path: coexist; test the export; then a network layer (phone remote, a
stage display for a tablet, an output page usable as an OBS overlay), then presenter polish (transitions, layers, a live verse box, a
service order), a GitHub Actions **macOS build** of a sermon-only edition, and a trial **alongside** ProPresenter. Questions for the owner
are at the end of the report.

## 5. State of the tree and what to commit (only when asked)

- **New:** `src-tauri/src/propresenter.rs`, `scripts/check_probundle.py`, `PRESENTER_OPTIONS.md`, this handover.
- **Edited by this work:** `src-tauri/src/{slides,lib}.rs`, `src/api.ts`, `src/components/{SermonBuilder,SlidesEditor}.tsx`, `HANDOVER.md`.
- Everything else already uncommitted (the sermon builder, slides, the 2.9.5 items) is listed in `HANDOVER_2026-10-23_LIVE_TEST.md` §4.
- `cargo test --lib -- slides:: propresenter::` passes (10 tests, 3 ignored samples); `cargo check` is clean for the new file; `npx tsc --noEmit` is clean.
- Not run: the full app, nor a new installer. The antivirus was off for this session's compile only; it should be back on.

## 5b. The owner's clarified goal (later the same day): "Present from this laptop"

The owner said: if the pastor wants to use a **laptop** this should be able to replace ProPresenter **for him, not always** (the church will
likely keep ProPresenter); the laptop is **on stage**, the pastor **clicks his own slides and links**, it must be **easy and look and feel
familiar** to ProPresenter, with the **projector or second screen** as the only thing the room sees. The church **streams and records to
Facebook**. The church's computer is a large all-in-one **iMac** (model unknown); the ProPresenter version is unknown and may be old.
This is `PRESENTER_OPTIONS.md` §1b (the design: grouped slide grid with live and next outlines, notes, clock, timer, clear and black, link
buttons, screen picker and test, fades, resume after restart) and §1c (the two practical blockers). **Nothing of it is built.**
**Answered next:** the pastor's laptop is **Windows** (so no Mac build is needed for this goal) and the laptop **does not do any live
streaming**. The owner supplied **four ProPresenter screenshots** (Mac and Windows Show views); `PRESENTER_OPTIONS.md` §1d reads them and
sets out the pastor's version of the screen: the slide grid with the coloured strip, number and group name under each thumbnail, orange
letter badges and orange live outline; a right-hand preview with a screen picker, Clear All and Black, a video transport, notes, clock and
timer; no library or media bin. **Still open:** the ProPresenter version and iMac model (do not matter now); clicker or keys; whether
web videos should play on the projector (the app already plays YouTube in the show window; it needs the church's internet) or open in a
browser. **Do not start building until the owner says so.**

## 5c. Built later the same day: "Present from this laptop" (first version) and the graphics-pack findings

The owner said **yes, build the first version**; web links should **play on the projector** (the web video, or the downloaded video, whatever
it points to); mouse **and** keyboard; they would likely use the keyboard. `PRESENTER_OPTIONS.md` §1d–§1e and §9 describe it in full.
- **Files:** `src/components/SlideShow.tsx` (rewritten: `Presenter`, `ShowScreen`, `ClipPlayer`; the projector window and its events are
  kept), `src/presentGroups.ts` (new, pure) with `scripts/test_present_groups.mts`, the `.pr-*` and `.show-*` styles in `src/App.css`
  (the old `.presenter-*` rules are gone), `SermonBuilder.tsx` (passes `title` and `resumeKey`), `SlidesEditor.tsx` (the Present tooltip).
  **No Rust changed for this** (the security policy is `csp: null`, so web pages and players load in a frame).
- **What it does:** see §1e of the report: ProPresenter-style grid with coloured strips, letter badges and the orange live outline; preview
  with screen picker and Test screen; clip controls (play, pause, stop, 15-second jumps for files); notes, clock, count-up or count-down
  timer; Clear all (black); End the show asks twice; keys (arrows, Space, Page Up/Down for a clicker, Enter, B, full stop, Esc, letters,
  Home/End); remembers its place; one-screen rehearsal; a fade.
- **Links:** `clipOf` in `SlideShow.tsx` decides: kept file, a video or music file at a web address, YouTube, Vimeo, Facebook, otherwise a page in a frame.
- **Verified** with real key presses and clicks, and in the projector window itself, on a throwaway sermon (see the report). **Bug found and
  fixed by that test:** the presenter could leave a projector window open behind it (React opens it twice in the development build, and a
  shared "still open" flag attached both). It now uses a flag of each run, as the old code did.
- **Not verified:** a real projector and clicker, long videos, the **one-screen rehearsal** path (the test PC has a second screen), and the pastor's laptop.
- **A new test installer was built for the owner** to try this: `installer/test/BibleConcordance_2.9.5_TEST_2026-10-26_x64-setup.exe`
  (378,084,504 bytes, sha256 `b5115b869ef73d512b09a5da11827745029e4b941c3d7be1f11412ec3317ff80`; built 2026-10-26 about 11:35; see `HANDOVER_2026-10-23_LIVE_TEST.md` §1 for how; the antivirus was off for it). Unsigned, not a release. The older `…2026-10-23…` installer lacks the presenter and the ProPresenter button.
- **The graphics packs** are plain media, not theme files; `PRESENTER_OPTIONS.md` §9 says what is usable and what a "theme" would need
  (looping video backgrounds, an overlay layer, a look, add-a-pack-by-folder). **Not built.** The packs are in the owner's Downloads and were
  inspected in a scratch folder only.
- **Next, if the owner wants:** try it on the pastor's laptop and a real projector; then themes (video backgrounds first), a live verse box, a
  service order, and the church's answers to the ProPresenter test pack (§3).

## 6. Things learned
- `cargo test` takes **one** name filter; use `-- slides:: propresenter::` for two.
- The newer Python protobuf (upb) does not expose unknown fields: the checker walks the wire bytes against the descriptors instead.
- The community notes disagree in places with the `.proto` (a field number for `URL.platform`: the `.proto` says 3, one note says 5);
  **the `.proto` was followed.** The proto repository's file list needs every file downloaded, not only the ones a message imports directly.
- A Python script run from bash on Windows wrote `\r` into a file list; strip it before using the names.
- Long inline Python or heredocs in the bash tool can fail to parse; write files with the file tool and run them.
- Test helper: `cdp.mjs` in the scratch folder now picks a window by looking at its page (`connect("main")` or `connect("show", n)`; a slide
  screen's body has the class `show-body`), because the app can have several windows open. Edits that hot-reload the page send it back to the
  home screen: reopen the builder before the next test step.
- A background build started as `( ... ) &` inside the bash tool was killed when that tool call ended once; start long builds as a tracked
  background command (`run_in_background`) and read the log file for `BUILD_EXIT`.

## 5d. Agreed next steps (after the owner's test of the first installer)
The owner agreed to every item in `PRESENTER_OPTIONS.md` §10, pending their test: themes; a live **"show this verse"** box with a **default Bible chosen
up front** (the owner's addition: the box searches that Bible); a countdown on the screen; separate Clear and Black; and the smaller items. **Fixes from
the owner's test come first.** The owner will test the installer and report back.

## 5e. After the owner's first test: three presentations, songs, live adding (planned, not built)
The owner tried the first installer: **it worked**; resume was not noticed (see `PRESENTER_OPTIONS.md` §11: the bar is small; make it a big "Continue"
button). New requirements: separate saved **Notices, Music and Sermon** presentations that can be loaded together and switched between; a **song
library** (words saved once, reused in different orders, verse by verse, searched and shown live); and an **add music/link/video button** (read as
live adding in the Presenter). The plan, the lyrics-licensing position (no legal free source for modern worship lyrics: paste, import SongSelect files,
public-domain hymns, YouTube links; the church's CCLI licence is theirs) and the order are in §11. **Open questions for the owner:** is "live + Add"
what they meant; does the church have a CCLI licence or SongSelect; is the order right. **Do not build until they confirm.**

## 5f. Built in dev (not in an installer; the owner wants none until everything is in) -- 2026-10-26
Run with `npm run tauri dev`. Verified with real mouse and key events on throwaway data (deleted afterwards; the owner's own sermons untouched):
- **Study menu, Sunday service** (`ServiceHome.tsx`): Notices, Music and Sermon each with their own saved list and New; tick one of each; **Present the service**.
- **Notices and Music** (`DeckBuilder.tsx`, tables `decks` and `songs` in userdata.rs, commands in `decks.rs`): the same slides page as the sermon, saved on their own, auto-saving once named. Not yet in the sync between computers (sync.rs) -- to add.
- **Song library** (`SongLibrary.tsx`, `songs.ts`, test `scripts/test_songs.mts`): paste words once (a line "Verse 1" / "Chorus" starts a part; a heading alone sings it again); pick the order for today and lines per slide; a song's slides are one group, each part a strip (slides carry `song` and `section`). Also in the ProPresenter export (one group per song, cues named for the parts).
- **Presenter**: tabs per part (keys 1 to 3), each keeping its place; **+ Add** (`LiveAdd.tsx`): verse (default Bible kept, `VerseFinder.tsx`), song, music/video/link or file, picture, after the slide showing, optionally shown at once; for this show only. The big **Continue from slide N** button; the place is no longer overwritten while the offer is showing (probable cause of the owner's "started from the beginning").
- **Slides page**: "+ Music, video or link" opens on the link tab; "+ Song" opens the library; "+ Scripture" finds a verse by reference.
- Lyrics: no legal free source for modern worship lyrics; CCLI licence is the church's; paste, text files, (to do) import the church's ProPresenter song files, public-domain hymns. See the owner's guide in the chat of 2026-10-26.
**To do next:** import songs from ProPresenter `.pro` files; public-domain hymns; sync of decks and songs; themes (§9 of PRESENTER_OPTIONS.md); countdown, Clear vs Black.

## 5g. Online lyrics look-up (added after the owner found words easily by searching)
The owner pointed out that the words are easy to find, so the first position ("no source") was too strong. Built: `lyrics.rs` (commands `lyrics_search`, `lyrics_get`) uses **lyrics.ovh**, a free keyless service: type a title in the song editor, **Look up the words**, choose the right version from the list, the words fill in. Nothing is fetched until asked; needs the internet. The words are copyrighted by their writers: the church shows them under its own CCLI licence (the editor says so), and the text can have errors, so it is shown for checking before it is saved. The service is unofficial and can disappear or miss newer songs (then paste, or use the "Search the web instead" button). `songs.ts parseSong` now treats an unheaded part that comes round again (word for word, or starting with the same line) as the chorus and numbers the rest as verses, with names a heading may say so they survive being typed back in. Tests: `cargo test --lib -- lyrics::`, `scripts/test_songs.mts`. Verified in the dev app with real clicks on "Good Good Father"; the test song and deck were deleted afterwards. The owner's own saved songs (Amazing Grace, Raise a Hallelujah) were left alone.

## 5h. Owner's feedback on the song dialog and the empty page (done)
- An empty slides page now shows a **"No slides yet" block with an arrow pointing up** to the add buttons, with a line for what to use (Song for music, Words and Picture for notices).
- The song dialog is now a **list builder** ("Choose the songs"): saved songs on the left each with **+ Add**; **Today's list** on the right in the order sung (move up and down, take off, change the order of the parts of any one song); **Put these N songs on the slides**. A song looked up or added goes on the list straight away. In the presenter's "+ Add" the same list can be **shown now** or added after the slide.
- The music deck itself is the saved list ("Songs, Sunday morning"): open it later to change it; songs stay in the library for next time.

## 5i. Songs as separate titled groups, moving backgrounds, and the rest of the agreed list (dev only)
Verified with real clicks and keys in the dev app on throwaway data (deleted afterwards, including two test files copied into `sermon-media`); `cargo test --lib` 104 passed; the five `scripts/test_*.mts` pass.
- **Songs are separate.** Each song put on the slides gets (by default) a **title slide**, and all its slides are one **group** named for the song (`presentGroups.ts`; the same song twice is two groups). A music deck **stops at the end of a song** (the screen goes black, "End of the song"; Next again starts the next song). The presenter has a **song list down the left** (search, A to Z or in order, click to start a song, "+ More songs"), and a heading over each song in the grid. In the editor a "♪ song" label shows where each begins. A song is added after the end of the song selected, never into its middle.
- **Song lists**: the song dialog ("Choose the songs") has a sort (A to Z, newest) and **Saved lists…**: a selection with its order, a name and a date, kept as a `songlist` row in `decks` and opened again later.
- **Moving backgrounds and themes** (`ThemePicker.tsx`, `themes.rs`, `countdown.ts`): "Moving backgrounds and themes…" in the slides bar. Choose a folder (the packs, unzipped), the pictures and looping videos in it are listed; **Use as the background** (picture or video) and **Put over the background** (a PNG with see-through parts, under the words). Only the chosen file is copied into the app (streamed, named by its hash). A video background loops muted behind the words on the screen, the preview and (first frame) the thumbnails. Per deck: `DeckBody.overlay`, sermon `slideOverlay`. **PowerPoint leaves a moving background out; the ProPresenter bundle keeps the background; the overlay is not in either export yet.**
- **Countdown slide** ("+ Countdown"): "5" minutes, "1:30", or "at 10:30"; starts when it comes on the screen. Exports as a text slide with its words (no clock).
- **Clear and Black are two buttons** (Esc clears the words, B or . blacks); **volume** for clips; **lower third** (a line over the foot of the screen).
- **Not built:** reordering the parts of the service (the tabs are Notices, Music, Sermon in that order), a recent-verses list, syncing decks, songs and lists between computers, the ProPresenter song import, the overlay in the exports.

## 5j. Owner's feedback: scrolling, a look for one slide, the songs down the left of the music page (done)
- Notices and Music pages did not scroll (they lacked the `sb-page` box the sermon page uses): fixed; the Sunday service page scrolls too.
- A slide can have **its own moving background and picture over it** ("Moving background or theme…" in the slide's look row; `SlideSpec.overlay`, `""` for none, absent for the one for all slides). "Same as all" clears both; "Use for all slides" copies both.
- The **music page has the saved songs down the left from the start** (`SongSidebar` in `SongLibrary.tsx`): search, A to Z or newest, **+ Add** puts a song (with its title slide, lines per slide as set) on the end of the slides, Words to see or change, + New song (look up or paste), Arrange a list… (the list builder with saved lists).

## 5k. Headings and layers are told from backgrounds (done); **REMOVE the test port before any build**
`themes.rs` now gives each file a `role`: a PNG with a see-through channel, or anything in a folder called titles, layers, lower thirds, overlays or logos, is an **overlay** (a heading or layer); the rest are backgrounds (videos always). The picker has tabs **Backgrounds**, **Moving**, **Headings and layers** (headings are drawn over the background now chosen), and a heading is chosen for one slide ("Use as this slide's heading") or for every slide. Tests: `cargo test --lib -- themes::` (5 cases).
**Note:** the dev app was left running with the debug-port line (`additionalBrowserArgs` in `src-tauri/tauri.conf.json`) so it would not be closed again (changing that file restarts the dev app). **Delete that line before building an installer or committing.**

## 5l. A notices library down the left of the notices page, like the songs (done)
`NoticeLibrary.tsx` (+ `decks.rs`: kind `notice`, a `position` column, `deck_order_cmd`; test `notices_in_the_library_keep_the_order_they_are_given`): the saved notices (Welcome 1, 2 and 3, Bible study, Birthdays, Giving...) are listed down the left from the start, in the order the preacher sets (up and down arrows, kept), with search and A to Z; **+ Add** puts one (a notice is one slide or a few) on the end of today's notices; **Edit** changes its name and its slides (heading and words, add, move, remove); **+ New notice**; **Keep in my notices** under a slide keeps a slide as a notice; an empty library offers **Start me off with some examples** (nothing is added unasked). Checked with real clicks; the notices made by the check were deleted afterwards (the owner had none).

## 5m. Owner: "I don't see an option to add the cursive headings" (done)
The headings were only reachable through "Moving background or theme…", whose label turned into "Change the moving background…" once a slide had a loop. Each slide's look box now has three labelled rows: **This slide's background** (Same as all, Plain, A photo…, **A moving background…**), **Heading over the background** (**A cursive heading…**, opens the picker on Headings and layers; Take it off; a tick **Leave out the written heading**, `SlideSpec.noHeading`, for text, heading and title slides), and **Picture beside the words (a logo, say)**. The top bar chip reads "Moving backgrounds and layers…". Checked with real clicks (unnamed deck, copied test file deleted).

## 5n. Crowded slides: auto-spacing and drag-to-place; look pickers close once a file is chosen (done)
`src/slideLayout.ts` (pure; `scripts/test_slide_layout.mts`) and `SlidesEditor.tsx`: a slide with **its own heading graphic** (the cursive "Advent") and words and/or a picture beside them is **spaced automatically**: the graphic's solid part is found from its see-through channel (`useBBox`, a 192x108 canvas read), the heading goes on top (as large as fits, never enlarged), the words and the picture under it side by side, each words box fits its own text (`useFit`, off for the whole slide when parts are boxed). **By hand:** each part has a label (Heading, Words, Picture) to drag and a corner square to resize, in the large preview (`EditablePreview`); letting go keeps the places in `SlideSpec.layout` (percent of the slide); **Auto-space this slide** clears them. The strips, the presenter's grid, the preview and the projector all use the same plan. A deck-wide layer (a paint sweep, covering most of the slide) is a decoration: not spaced round. Not in the PowerPoint or ProPresenter exports (they ignore `layout`).
The photo, heading and background windows (`MediaPicker`, `ThemePicker`) close once a file is chosen.
Fixed on the way: a CSS rule kept the boxed parts in flow (the box offsets were added to their normal places); a draft layout of `null` was read as "no layout" and snapped a dragged part back after letting go.
**Saving:** the notices and music pages save themselves one second after a change once named; the sermon after its first Save; the saved notices and songs lists on their own Save buttons.

## 5o. The Sunday service page for hundreds of saved items (done)
Each card's list (`ServiceHome.tsx`) no longer stops at 12: it **scrolls inside its card**, is **sorted newest first** by the date shown (a sermon's preached date, else when it was last changed), with a **search** and a sort (Newest first, Oldest first, A to Z) once a list has more than one. Checked with 40 throwaway notices decks (deleted afterwards); the sermons were only read.

## 5p. "Name it and it saves itself" looked greyed out and saved nothing (fixed)
Autosave only began once a name had been typed into the small title box, and nothing said so. A new notices or music page now **names itself** ("Notices, 26 October 2026"; editable), saves one second after the **first change**, and says so: "Not saved yet: it saves as soon as you change something" / "Saving in a moment…" / "✓ Saved at 14:43"; the Save button is always available. Opening a page and going back without a change saves nothing (no empty decks). Checked with real clicks; the decks made were deleted.
