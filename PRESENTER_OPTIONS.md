# Showing the sermon slides in the app: options (exploration, 2026-10-26)

**Status:** exploration only. Nothing here is built. It answers: *could the app show the slides with the usability and polish of
ProPresenter, as a future alternative?* — and what that would honestly take.

Facts about ProPresenter below come from Renewed Vision's own pages as read on 2026-10-26 (version 22 is current; subscription pricing
at that time was $29 a month or $289 a year per seat, with a 14-day trial). Check them again before relying on them. Facts about the app
come from its own code.

## 1. The short answer

- **For the sermon part of a service** (title, points, Scripture, pictures, a video clip, a song's words): the app is already most of the
  way there. It has a second-screen show, a presenter view and clip playback. A *sermon-first presenter* is a realistic, modest project.
- **For a whole church production** (worship lyrics libraries, several screens and cameras, live-stream key/fill, stage displays, hardware
  outputs, volunteers who know it): that is ProPresenter's ground, it is years of work, and it is the wrong thing to chase.
- **The church uses a Mac.** The app is built and tested for Windows (and the phone). Anything meant for the church's own machine first needs
  a Mac build (§5). This is the biggest single obstacle and it is not a coding one.
- **Recommendation:** let the two coexist. Keep exporting to ProPresenter (done, this session). Build the in-app presenter as a
  *sermon-first* tool, add a network output/remote layer that opens doors ProPresenter's own limits close (a preacher's tablet, a phone
  clicker, an OBS overlay), and test it in the church **alongside** ProPresenter before anyone depends on it.

## 1b. The goal, as the owner clarified it (2026-10-26): a pastor's laptop mode

> If the pastor wants to use a laptop, this should be able to replace ProPresenter for him — **but not always**; the church will likely
> keep using ProPresenter. He would have his laptop **on stage** instead of being controlled from the back, run his sermon, and **click
> the slides and links himself**. It should be easy, and **look and feel familiar** to ProPresenter, so he does not have to think about
> what is going on: he just needs some information and visual guides. **The projector or second screen is the one everyone sees.** The
> church streams and records its services to Facebook.

That is a *small, sharp* goal, and it is the one option the app is already closest to. It is **option A below** (a sermon-first
presenter) with the Mac question (§4C) and the stream question (§1c) answered. It does **not** need the song library, hardware outputs or
NDI. Name it **"Present from this laptop"**.

**What the pastor sees on the laptop (the operator screen)** — in ProPresenter's own words and layout so it is familiar:
- a **slide grid**: every slide as a thumbnail, **grouped by point** with a coloured group label (ProPresenter's groups); the slide that is
  **live** has a red outline, the **next** one an amber one;
- a large **live preview** of what the room sees, and **next** beside it, so he never wonders;
- his **notes** for the slide, the **clock**, and a **timer** (count up, or count down to a time he sets);
- **Clear / Black** buttons (ProPresenter's "clear" row), a clear on/off for the slide; **space or arrow keys, a mouse click, or a
  presentation clicker** move on; a click on any thumbnail jumps to it;
- **a link slide shows a big "Play" or "Open"** button: a video or song from the sermon's files plays on the screen; a web video
  (YouTube) plays on the screen; a web page opens in his browser, as the owner asked ("click the slides and links himself").
- a single **"Screen" picker**: which display is the projector, with a "test" that shows a pattern, and a warning if only one screen is found.
- a **safety net**: one key re-shows the current slide, the show **returns to the same slide if the app is restarted**, and **Save as
  PowerPoint** stays available as the fallback.

**What the room sees (the projector):** only the slide, full screen, black around it, no pointer — exactly as `ShowScreen` does today.

**What exists, what is new** (from §2, §3): the second-screen window, presenter view, next slide, notes, clock, timer, blackout and clip
playback exist. New: the **grouped slide grid** (the single bottom strip becomes a grid, with group labels and the live/next outlines),
**fade transitions**, a proper **clear vs black**, a **link action button**, **start from this slide**, a **screen test**, **remember
the slide** after a restart, and the polish to make it look like ProPresenter's show screen. **Effort: a few weeks, low technical risk.**
To make it *look familiar*, a few **screenshots of what the pastor and the operator see at the church** would let me copy the layout rather
than guess it from memory.

## 1c. Two practical things that decide whether it can be used at the church

> **Answered (2026-10-26, later): the pastor's laptop is Windows, and the laptop does not need to do any live streaming.** So the Mac
> build (§4C) is **not needed for this goal**, and the stream question below is **out of scope** for the laptop mode: it only drives the
> projector or second screen. The text below is kept for the record; it still applies if the church ever wants the laptop's slides *on* the stream.

1. **The stream.** If the pastor's laptop feeds the projector *instead of* ProPresenter, **the Facebook stream stops seeing the slides**
   unless the stream takes its picture from the same feed. The church needs to say how the stream gets the slides today: a capture
   card on the projector feed, ProPresenter's own output into streaming software (OBS) on the iMac, or something else. Whatever it is, the
   laptop's output has to go **into the same place** (e.g. the projector cable passes through the same capture/mixer). The browser
   output page in §4B can feed OBS over the network *if* the church uses OBS; **do not assume it**.
2. **The laptop and the church's computer.** The pastor's **laptop** may be a Windows machine or a Mac. The app runs on Windows today. A
   Mac laptop needs the Mac build of §4C. **Which is it?** The church's Mac is a large all-in-one iMac (a 32-inch is not an Apple iMac
   size: the owner probably means a 24-inch or 27-inch iMac or an external Apple display). To find the facts at the church: *Apple menu >
   About This Mac* shows the model, year, chip (Apple silicon or Intel) and macOS; *ProPresenter menu > About ProPresenter* shows its version.

## 1d. What "familiar" looks like: ProPresenter's own screen (from four screenshots the owner supplied)

Read from the pictures (a Mac window of the Show view, the same with the media bin open, the Windows version on a large all-in-one, and a
close-up of a song with the preview panel). **What the pastor already knows how to read:**

| In ProPresenter | What it is |
|---|---|
| **Slide grid**, four or five thumbnails across, big and legible | the centre of the screen; the thing he clicks |
| A **coloured strip under every thumbnail** with the **slide number** and, on a group's first slide, the **group name**: blue *Verse*, red *Chorus*, purple *Bridge*, yellow *Blank* | how he finds his place without reading the slide |
| A small **orange letter badge** (A, C, S, B…) on a group's first slide | the group's shortcut key |
| The slide that is **live** has an **orange outline** | "this is what the room sees" |
| A **preview panel on the right** showing the audience screen, with a **screen picker** ("Screen 1"/"Center Screen") above and **Audience and Stage lights** (red or green) | confidence that the right thing is up |
| **Clear buttons** down the preview's edge (slides, media, messages, props, audio) and **Clear All / Clear to Logo** | one click to blank the room |
| A **video transport**: progress bar, **play/pause, back 15 s, forward 15 s**, time elapsed and left | how a clip is controlled |
| **Tabs** for audio, timers, props, messages, looks under it | not needed by a pastor |
| A **toolbar** of big labelled icons (Show, Edit, Bible, Media, Live, Audience, Stage…), a **library and playlist** at the left, a **media bin** at the bottom | the operator's world; **hidden or reduced** for the pastor |
| A **size slider and three view buttons** (grid, text, list) at the bottom of the grid | thumbnail size and how slides are listed |
| A dark theme throughout | |

**The pastor's version (Windows, one sermon, no library):**
- **Centre:** the slide grid for *his* sermon: coloured strip with number and group name (Title, each point, Scripture, Picture, Video, Song,
  Link), the orange letter badge, the orange outline on the live slide, a size slider and the three view buttons.
- **Right:** the audience preview with the screen picker and a status light, **Clear All** and **Black**, the **video transport** when a clip is
  live, then his **notes** for the live slide, the **clock** and the **timer** (instead of ProPresenter's audio/props tabs).
- **Top:** the sermon's title, a **Present** / **Stop** button, and a small "Screen" status; **no library, no media bin, no theme editor**.
- **Colours** (to confirm with the owner): Title yellow, point green, Scripture blue, picture or video purple, song red, link orange, blank grey.
- **Keys** as ProPresenter: arrow keys and space step; the group letter jumps to that group; a **presentation clicker** (Page Up / Page Down)
  works too. Click any thumbnail to put it live.
- **Rehearsal mode:** the same screen on one monitor with a "pretend projector" window, so the pastor can practise at home without a second screen.

## 1e. Status: the first version is built (2026-10-26)

"Present from this laptop" exists: the **Present** button on the Slides tab now opens the ProPresenter-style screen of §1d.
- **Grid** with the coloured strip (number, group name on the group's first slide, the kind on the others), the orange letter badge on each
  group's first slide, the orange **live** outline and a dashed **next**; a size slider and grid/list views. `src/presentGroups.ts` (with
  `scripts/test_present_groups.mts`) does the grouping: a title, a point or a song starts a group; letters skip B, N and P (black, next, back).
- **Right panel:** the audience preview with a screen picker and a **Test screen** button (a pattern on the projector that clears itself),
  Back / Next, the **clip controls**, the notes, the next slide, keys help. **Top bar:** the title, an Audience light (green: on the projector;
  amber: rehearsal; red: black), the clock, a timer that counts up or **counts down** from minutes you set, **Clear all (black)**, and
  **End the show**, which asks twice so it cannot be hit by accident.
- **Keys and mouse** (the owner asked for both): arrows, Space, Page Down / Up (a presentation clicker), Backspace, Home, End; **Enter** plays or
  pauses a link and otherwise goes on; **B**, **full stop** or **Esc** blacks the screen; **a letter on a group** jumps to it. Click any thumbnail to
  put it live; the Next and Back buttons; double-click a link slide to put it live and play it. Clicking the projector screen also advances.
- **Links play on the projector** (the owner's request): a kept video or music file; a video or music file at a web address; a **YouTube**,
  **Vimeo** or **Facebook** video (needs the internet); any other web page, shown in a frame (some sites refuse to be framed and stay blank:
  the panel says so). A link that is not a web address (a file on the laptop) opens on the laptop, not for the room. Play, pause and stop
  work for files, YouTube and Vimeo; a **progress bar and back/forward 15 seconds** work for files.
- **Rehearsal:** with one screen nothing covers the laptop; the preview is the room, with buttons to **find the screen** or **show full screen here**.
- **A fade** between slides, and the place is **remembered**: starting the show again offers to go back to where it stopped.
- **Not built yet:** a lower-third layer, a live "show this verse" box, a service order, transitions other than the fade, and **themes** (§9).
- **Verified** in the dev app with real key presses and clicks on a throwaway sermon: every key above, the clicks, the list view, the size
  slider, the clip buttons, the end-and-resume flow, and — in the projector window itself — the slide, black, the test pattern, a YouTube frame and a
  web-page frame. A second screen was present on the test PC, so the one-screen **rehearsal** path was not run. **Not tried:** a real projector in a
  room, a real clicker, a long video, the pastor's laptop. That is the next test.

## 2. What the app already has (`SlideShow.tsx`, `lan.rs`)

| Have | Where |
|---|---|
| Full-screen slide window on another screen, chosen and remembered; with one screen the slides cover it | `openShowWindow`, `show_window_open` |
| A presenter view: this slide, the next, the preacher's notes, a clock, a timer, every slide along the bottom to jump to | `Presenter` |
| Black the screen (B), advance by key or click, keys sent back from the output window | `ShowScreen` |
| Video and music clips from the sermon's own files, and YouTube, started and paused from the presenter view | `clipOf`, `Clip` |
| Slides made from the sermon, reorderable by mouse with the sermon following, per-slide backgrounds, a picture beside the words | `SlidesEditor`, `slideOrder.ts` |
| A private-network HTTP/UDP server with pairing and a token, used to sync the phone | `lan.rs` (`std::net`, port 47810) |
| Save as PowerPoint; **now** save as a ProPresenter bundle | `slides.rs`, `propresenter.rs` |

## 3. What ProPresenter has that matters, and where the app stands

Ranked by how much it matters for **a sermon**, not for a worship band.

| ProPresenter feature | Matters for a sermon? | App today | Effort to match |
|---|---|---|---|
| Reliable second-screen output, blackout, clear | Essential | Have | — |
| Next-slide preview, notes, clock, timer for the speaker | Essential | Have | — |
| Smooth slide transitions (fade/dissolve), simple builds | High | None (a cut) | Small |
| Layers: slide over background media; message/lower-third over everything; clear each layer | High | Slide + clip only | Medium |
| Scripture on screen as a lower third or full slide, any translation, quick lookup mid-service | High | Scripture slides from the sermon only | Medium (the app has the Bible; a live "show this verse now" box is natural) |
| A stage (confidence) display for the speaker on a second device | High | The presenter view on the same computer | Medium — see option B |
| Remote control from a phone/tablet | High | None | Medium — see option B |
| Timers and countdowns shown on the output | Medium | Timer on the presenter view only | Small |
| Playlists / a service order (welcome, songs, sermon, offering) | Medium | One sermon at a time | Medium |
| Media bin, with video/audio/image library and thumbnails | Medium | Per-sermon media only | Medium |
| Song library: lyrics, arrangements, CCLI reporting, chords | High for a worship team, low for the sermon | Slides can hold song words by hand | **Large** — the core of ProPresenter's value |
| Multiple outputs (up to 8), edge blending, per-screen looks | Only for big venues | One output screen | Large; rarely needed |
| NDI, Syphon, SDI key/fill, Blackmagic, live camera inputs | Only for broadcast/stream | None | **Very large / not sensible** |
| Macros, MIDI/DMX, timecode follow | Rare | None | Large; skip |
| Cloud sync of shows across machines | Medium | Folder sync and Wi-Fi sync exist | Small to extend |
| Text animation, animated sticker library (ProContent) | Low | None | Skip |
| HLS streaming video, Planning Center, Amazing/ProDisplay integrations | Low | None | Skip |

## 4. Options

### A. A sermon-first presenter (grow the current Present mode)
Make what exists feel like a finished product, and keep it scoped to the preaching.
- **Add:** fade transitions; a "clear" and a "blackout" that are separate; a proper layer model (background media, slide text, a
  lower-third layer for Scripture/names, a message layer); a live "show this verse" box; a service-order playlist with a few item types
  (slides, a video, a song, a blank); timers on the output; per-slide transition and a hold time.
- **Effort:** a few weeks of focused work, mostly in `SlideShow.tsx`, a small data model, and tests. Low technical risk: all of it is
  web-page rendering the app already does.
- **Gain:** a presenter the owner can use for the sermon without ProPresenter, on Windows today.
- **Limit:** one output screen, no hardware outputs.

### B. A network layer: output, stage and remote as web pages (recommended next step after A)
The app already runs a private-network server for the phone. Extend it to serve three small pages from the computer running the show:
1. **/remote** — a phone clicker: next, back, blackout, jump to a slide, see the next slide and notes. (The phone is already paired.)
2. **/stage** — a speaker's confidence screen for a tablet or second computer: the current slide, the next, notes, clock, timer, live.
3. **/output** — the slide as a plain web page. Open it full screen on any other computer, TV browser or tablet as **another screen**, or
   add it to **OBS as a browser source** (with a transparent background for lower thirds) to overlay the live stream.
- **Why it matters:** this is how a small church gets stage display, remote control and stream overlays *without* NDI or capture cards,
  and it is something the app can do well because it already owns the show state and the network code.
- **Effort:** medium (a WebSocket or server-sent-events channel from the show state, three pages, pairing, tests on a real Wi-Fi network).
- **Risks:** Wi-Fi reliability on a Sunday; keep the on-computer output as the primary and treat the network pages as extras; keep the
  existing rule that only private-network addresses may connect, plus the pairing token.

### C. Build the app for macOS (a prerequisite for the church's own computer)
The framework (Tauri) supports macOS, and the web interface is the same. Not done yet:
- **A Mac to build on**, or a **GitHub Actions macOS runner** (free for public repositories) so builds do not need one in the office.
- **Apple Developer account** (about $99 a year) to sign and notarise, otherwise macOS warns or blocks the app.
- **Mac-specific checks:** the multi-monitor code, file paths (the app uses Windows folders such as Documents), the media folder, the
  system fonts, video codecs in WebKit, and the antivirus-free build is easier there.
- **Not for this option:** the phone sync, voice and offline features are Windows-built today and would need to be switched off or
  ported on the Mac build.
- **Effort:** small to medium for a "sermon builder + presenter only" Mac edition; larger if every feature must come along.

### D. Worship and song features (only if the goal is a true replacement)
A song library with lyrics, arrangements, copyright reporting (CCLI), chords, a service planner and team schedule integration. This is
what a church band lives in. **Large and open-ended; not recommended** unless the owner decides replacing ProPresenter outright is the goal.

### E. Broadcast and hardware outputs (NDI, key/fill, camera inputs, several outputs)
Needs native NDI and capture-card SDKs, licences, a lot of device testing and a Mac/Windows split. **Not recommended.** Option B's
browser output covers the common stream-overlay need.

### F. Interoperate instead of replace
- **Export to ProPresenter** (built this session; §6).
- **Import from ProPresenter:** read a `.pro` or `.probundle` file back into sermon slides, so a presentation the church built can be
  used here too. The reverse-engineered schema makes it possible; it is a small project once export is proven. Useful as a bridge, and a
  way to find out whether the format is understood correctly.
- **Effort:** small to medium. **Risk:** low.

## 5. Things that decide the outcome (not code)

1. **Reliability is the product.** A show tool that fails during the sermon is worse than none. Whatever is built needs a plain fallback
   (the app already saves PowerPoint; keep that), crash recovery that returns to the same slide, and real-service rehearsal.
2. **The church's machine and people.** The church runs a Mac and volunteers who know ProPresenter. A replacement has to be *easier*,
   not just cheaper, and it must run on their hardware (§4C).
3. **Licences.** Bible translations shown on screen, song lyrics (CCLI), and fonts all carry terms. The BSB used in the app is the
   owner's existing choice; anything else shown on a projector needs its terms checked.
4. **Support.** If the owner builds it, the owner supports it on a Sunday morning.
5. **Cost.** ProPresenter's subscription is real money per seat per year, which is the honest reason to explore this at all; weigh it
   against the build and support time.

## 6. What was built alongside this report: export to ProPresenter

`propresenter.rs`, the "Save for ProPresenter" button on the Slides tab. It writes a `.probundle`: one native ProPresenter presentation
and the pictures, videos and music, in one zip, to import with File > Import (or drag into a playlist).
- Each title, point, Scripture and words slide is a text slide (navy, white, shrinks to fit), a group per point, a group per song with a
  slide per verse.
- A picture, video or piece of music is a **media cue** with the file inside the bundle, named relative to it so it resolves on a Mac.
- The preacher's notes go into the slide's notes. A **web link** cannot be an action in ProPresenter's file format, so it becomes a
  slide with the address shown and in the notes.
- It was verified against the community's reverse-engineered schema (it decodes with nothing unrecognised, the groups point at real
  slides, and every media file named is in the zip). **It could not be opened in ProPresenter here** — nobody on this side has it — so
  the church's Mac is the real test. The PowerPoint export is the fallback: ProPresenter 21.2 and later import `.pptx` as editable slides
  without PowerPoint installed.

## 7. A suggested path (updated for the pastor's-laptop goal, §1b)

1. **Now:** the church tries the exported bundle and the PowerPoint, and reports what is wrong in ProPresenter. (Ask: which version and
   whether media came across.) Also gather the facts in §1c and **screenshots** of the operator's and the pastor's ProPresenter screens.
2. **Next: "Present from this laptop" (option A, scoped by §1b).** The grouped slide grid with live and next outlines, notes, clock and
   timer, clear and black, link buttons, a screen picker and test, fade transitions, return to the same slide after a restart. This is
   the whole of the owner's stated goal; it works on the Windows laptop the app already runs on.
3. **If the pastor's laptop is a Mac, or the church wants it on their machines:** option C, a GitHub Actions macOS build of a
   sermon-only edition (the Apple developer account and signing included).
4. **If the stream needs the slides from the laptop:** settle §1c, and only then consider option B's browser output page for OBS.
5. **Later, only if wanted:** B's phone remote (a clicker) and a stage page for a tablet.
6. **Trial:** the pastor uses it at a small service **with ProPresenter still running at the back**, for a season. Decide on the evidence.
7. **Do not start** D or E (worship library, hardware, NDI).

## 8. Questions for the owner (some answered 2026-10-26)

Answered: the aim is **a laptop option for the pastor, not a replacement** (the church will likely keep ProPresenter); he clicks his own
slides and links on stage; it must feel familiar; the audience sees the projector or second screen only; the church **streams and records
to Facebook**; the church's computer is **a large all-in-one iMac** (model unknown); the ProPresenter **version is not known and may be old**.

Still to find out:
- ~~The pastor's laptop~~ **Windows** (answered). ~~The stream~~ **not the laptop's job** (answered).
- **Which ProPresenter version** (ProPresenter menu > About) and **which iMac** (Apple menu > About This Mac)?
- Are there **screenshots** of what the pastor and the operator see? (They let the layout be copied exactly.)
- Does the pastor **use a clicker** (presentation remote) or the laptop keys, and is a **second small screen or a tablet** wanted on stage?
- Should a **web link** (a YouTube video) **play on the projector** or open in his browser to share-screen? (Playing on the screen needs
  internet at the church and a stable connection.)
- Who runs the screen on Sundays, and are they happy for the pastor to take over the slides for the sermon?

## 9. Graphics packs and "themes" (the owner's three free church packs, 2026-10-26)

The owner supplied three zips made for ProPresenter (Church Motion Graphics "Paint Sweeps": Still, Premium and Motion). **They are not theme
files.** There is nothing ProPresenter-specific to import; they are ordinary media that ProPresenter users drop into its media bin and build
looks from:

| Pack | What is in it | Usable in the app today |
|---|---|---|
| Still (13 MB) | 20 JPG **backgrounds** (1920×1080); about 40 **title graphics** as PNG with transparency and white text ("Welcome", "Offering", "Message"…); 3 transparent **layers**; 3 JPG titles; Spanish titles; a PDF guide | **Backgrounds: yes** (Slides tab, "Background for all slides", "A photo…"). Titles and layers: only as a full-slide picture, which hides the words |
| Motion (845 MB) | 13 looping **MP4 backgrounds** (1080p, about 17 to 39 MB each), a 394 MB **countdown timer** video with music, a PDF guide | **As a video slide: yes.** As a **looping background: not yet** (backgrounds take pictures only) |
| Premium (212 MB) | **Photoshop (.psd) templates** of 90 to 105 MB (slide templates, lower thirds, social graphics) with JPG previews | The **JPG previews** only; the Photoshop files cannot be used |

**What it would take to use them as themes** (small to medium, none of it built):
1. **Looping video backgrounds** — let a slide's or the whole show's background be an MP4 played muted on a loop behind the words, in the show window,
   the preview and the thumbnails (first frame). The show window already plays video.
2. **An overlay layer** — a transparent PNG (a title graphic or a paint-sweep layer) drawn *over* the background and *under* the words; per slide
   or for all slides.
3. **A "look"** = background (picture or loop) + optional overlay + the words' colour; saved with the sermon or as a named theme.
4. **Add a pack by pointing at a folder** (nothing bundled in the app): the app lists its stills and loops as choices. Large videos stay where
   they are and are not copied into the sermon.
5. **ProPresenter export:** a looping background would be a background media cue in the bundle (the same guess as the title photo, see the
   ProPresenter handover §2); an overlay would be a picture element or a second media cue.
- **Licences:** these are "free for churches" packs; the terms (in the packs' own pages) govern copying them. They are not in the repository.
- **Weight:** a 40 MB loop per theme is fine on a laptop; a long countdown video (394 MB) is a slide to play, not a background.

## 10. Agreed next steps, pending the owner's test of the first installer (2026-10-26)

The owner said they like **all** of these and agree to all of them, pending their test of the first installer (fixes from that test come first):
1. **Themes** from the church's graphics packs (looping video backgrounds, a picture over the background, a theme picker, add a pack from a folder).
2. **A live "show this verse" box** — the pastor does this often, so it matters. **The owner's addition:** because the app has many Bible versions,
   the pastor **chooses a default Bible up front** (before the show starts, remembered), and the box then **searches that Bible** for what he types.
   Design notes: parse a typed reference ("John 3:16", "Romans 8:28-30", "1 Cor 13"); show the verse text as a Scripture slide on the projector
   at once, labelled with the reference and the Bible's abbreviation; Enter to show, a key to clear back to the slide he was on; a quick switch of
   Bible for one verse; a recent-verses list; the verse is not added to the sermon unless he chooses to keep it. Uses the app's own search and
   Bible texts (no internet needed).
3. **A countdown on the screen** (a built-in "service starts in 5:00" slide, driven by the timer).
4. **Clear versus Black** as separate buttons.
5. **Smaller things:** clip volume, a lower-third for a name or verse reference, a service order, backgrounds in the ProPresenter export.

## 11. Revised plan: three presentations on a Sunday, songs, and live adding (2026-10-26, after the owner's first test)

**The owner's test of the first installer:** it worked; the one thing not noticed was **resuming where the show stopped** (it started at slide 1).
The behaviour is as designed (the place is remembered on every move; starting again shows a blue offer bar "Last time you stopped at slide N. Go
there"; it is not offered when the show stopped on slide 1, or when started with "From this slide"). The bar is small, so **make it a big
"Continue from slide N" button**, and consider an option to resume automatically.

**New requirements (the owner):**
1. **Three kinds of presentation on a Sunday:** **Notices** (shown before the service; the same for several weeks, so reused), **Music** (words of the
   songs the worship team sings, verse by verse; also YouTube songs that already have words, which work today as link slides) and the **Sermon**
   (built already). Each is **saved separately from any sermon**, and the presenter can **load more than one and switch between them**.
2. **Songs:** choose a few, or add songs **as the spirit leads**, look up the words, **display them live and change them**; songs are **saved once
   searched** and reused most weekends **in different formats** (orders). Words only, verse by verse, for the worship team.
3. A **"add music, link or video" button in the slides screen.** Read as: in the **live Presenter screen** (the editor already has + Song and
   + Video or link in its "Add a slide" row). To confirm with the owner.

**Design (nothing built):**
- **Presentation kinds.** A presentation = title, kind (`sermon` | `notices` | `music`), slides, background. Notices and Music are not sermons: they have
  no outline, passages or series. Cheapest route: **store them like sermons** (the existing save, list, folder sync and Wi-Fi sync all work) with a
  `kind` in the saved body, and a **launcher** with three big buttons, Notices, Music and Sermon, each listing its saved ones (New, Open, Present). The
  list queries need the kind visible without parsing every body, so a small backend addition (a kind column, or a naming rule) is needed. All three
  share the Slides screen, with starting templates (a notices template uses the title graphics from the church's packs, see §9).
- **The Service set in the presenter** (ProPresenter's playlist): the presenter takes a list of presentations (up to three: Notices, Music, Sermon) and
  shows **tabs to switch**; each keeps its own live slide; the projector shows the active one. A set can be saved as "Sunday".
- **Song library.** A song = title, author, CCLI number (if known), **sections** (Verse 1, Chorus, Bridge…) with their words. A music presentation lists
  songs with an **arrangement** each (an order of sections, e.g. V1, C, V2, C, B, C). Presenting a song gives a group per section, with a key each
  (V, C, B…), like the sermon's group letters. Songs are saved once and reused; arrangements are per use.
- **Where lyrics come from (the licensing point):** there is **no legal free source for modern worship lyrics**; they are copyrighted and displaying them
  needs the church's own **CCLI licence** (the church's responsibility). Proper routes: (a) paste or type; (b) **import SongSelect downloads** (text,
  ChordPro or .usr) if the church has SongSelect, splitting sections automatically; (c) **public-domain hymns** found by title or first line (a bundled or
  public source; to choose); (d) YouTube links that already show the words. **Not** scraping lyric websites (unreliable, breaks their terms). To confirm:
  does the church have a CCLI licence or SongSelect login?
- **Live "+ Add" in the Presenter:** a verse (the **live verse box**, default Bible chosen up front, §10), a song from the library (type a title; its
  sections appear as slides to step through), a video or link, a picture. It inserts after the current slide; it is kept in this show only unless the
  presenter chooses to keep it.
- **Resume:** a large "Continue from slide N" button.

**Order (to confirm with the owner):**
1. Next installer: the test's fixes; the big resume button; **presentation kinds, the launcher and saving**; the **Service tabs** in the presenter; the **+ Add**
   button and the **live verse box**.
2. Then: the **song library** (paste, SongSelect import, public-domain hymns, arrangements) and live song search.
3. Then: **themes** (§9), the on-screen countdown, Clear versus Black, and the smaller items (§10).

**Effort (rough):** presentation kinds + launcher + service tabs: medium (1 to 2 weeks); live add and verse box: small to medium; song library with import:
medium; themes: medium. All frontend-heavy; the kind and any song store need a small Rust and sync addition.
