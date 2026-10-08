# Bible Concordance — Handover

Saved here (not in Claude's per-machine memory) because this project lives on `V:\Code\bible`,
a network share, and the next session may run from a different PC. Read this file first when
resuming.

## What this is

An offline-first Bible study/concordance desktop app (Tauri + Rust backend, React/TS frontend).
Multi-version reading and comparison, Strong's-number word study, keyword + word-frequency +
semantic/topical search, a visual cross-reference graph, curated genealogies and "firsts"
index, optional live NIV/NKJV lookup via the user's own api.bible key, and printable views.

Full original plan (data sources, phasing, architecture rationale) is at:
a local Claude plan file on the PC this was built on — copy its
contents here if you need it from a different machine, since that path is local to that PC.

## Current status: Phases 1-16 done — v2.5.0 released 2026-10-08 (sermon builder; Library, Pictures, side by side, Hebrew & Greek search, range notes + tags, error log, in-app updates, voice as a download)

> **Start here next session:** `HANDOVER_2026-10-08_V2_5_0_SERMON_BUILDER.md` (v2.5.0: the sermon builder, its search, scanned e-book import), then `HANDOVER_2026-10-07_V2_4_2.md` (what changed in 2.4.2), then `HANDOVER_2026-10-06_V2_4_0.md` — what's in 2.4.0, how to
> ship the next version (`scripts/release.ps1`, the updater signing key that must never be
> lost or committed), the real email still in the old pushed commit `ac15e08`, and the open
> ideas. A Mac build and a phone app are deferred (user's decision, 2026-10-06).

**Phase 1 (core reader) — done:**
- Data pipeline (`data-pipeline/`) sources and builds `src-tauri/resources/bible.db`: BSB, KJV,
  ASV, YLT, WEB (all Strong's-tagged except YLT) + Hebrew WLC + Greek TR, Strong's Hebrew/Greek
  dictionaries, ~433k OpenBible.info/TSK cross-references. 186k+ verses, 2.27M word-level
  Strong's links. Row counts cross-checked against published concordance figures (e.g. KJV
  31,102 verses exactly; "gold" = 417 occurrences in KJV, matching Strong's Concordance).
- Rust backend (`src-tauri/src/`): chapter reading, parallel version comparison, Strong's
  lookup + exact occurrence counts, keyword search (FTS5), cross-reference lookup.
- React frontend (`src/`): reading pane with clickable Strong's-tagged words, parallel compare,
  search panel, word-study panel, cross-reference panel.

**Phase 2 (added this session) — done:**
- **Semantic/topical search**: local embedding model (all-MiniLM-L6-v2 via `candle`, bundled in
  `src-tauri/resources/model/`, no internet/Python needed at runtime). All 31,086 BSB verses are
  pre-embedded into a `verse_embeddings` `vec0` table (via `sqlite-vec`) inside `bible.db`
  itself — this is already done, not a TODO. Query embedding happens live in Rust.
- **Cross-reference spidergram**: interactive force-directed graph (Cytoscape + cola layout),
  color-coded by testament, gold edges flag OT↔NT links (prophecy/fulfillment). Double-click a
  node to expand its own links.
- **Genealogies**: hand-verified against our own bundled KJV text (not memory) — Adam→David via
  Genesis 5/11 + Ruth 4, extended David→Jesus via Matthew 1. Data in
  `src-tauri/resources/genealogies.json`, rendered as a family tree.
- **Firsts & Milestones**: curated, source-cited answers to "what was the first…" questions,
  explicitly flagging genuine ambiguity (e.g. first sin vs. first murder) rather than picking
  one silently. Data in `src-tauri/resources/firsts.json`.
- **Settings + live online lookup**: a Settings panel where a user pastes their own api.bible
  key (stored in the OS app-config dir, never in source/bundle). Unlocks live NIV + NKJV in the
  Parallel Compare view (fetched on demand, not cached offline — required by api.bible's
  licensing for copyrighted text; ESV is *not* available via that platform, only NIV/NKJV).
- **Printable views** via `@media print` CSS + a Print button.
- **Navigation history / Back button** and clearer always-visible verse action icons (added
  after live user testing feedback).

**Phase 3 (added in a later session) — done:**
- **Splash screen**: `src/components/SplashScreen.tsx` shows `public/splashscreen.jpg` (a
  marble/gold "EPT — Bible Research Study" image the user supplied) for ~3s on launch, edges
  faded to black via a CSS radial mask, then fades into the main app. *(Superseded in
  Phase 13 by a launch video; the image was deleted in Phase 14c.)*
- **Accent color**: the app's interactive accent was gold/amber (`--gold-*` in `App.css`); per
  user request it's now a blue palette (`--accent-*`). The cross-reference graph's OT/NT/current
  -verse legend colors were deliberately left alone (a semantic 3-way code, not a stray accent).
- **Side panels stay open on jump**: `App.tsx`'s `jumpTo` (used by cross-refs, search,
  genealogy, firsts) no longer closes the panel or resets scroll to verse 1 — it sets
  `targetVerse`, and `ChapterView.tsx` scrolls that verse to the top of the reading pane and
  gives it a brief highlight flash (`.verse-row--target` in `App.css`). Sidebar-driven `goTo`
  navigation still closes the panel (unchanged, different interaction).
- **Cross-reference list shows verse text**, not just the bare reference, fetched per-item via
  `get_verse_with_strongs` against BSB (or `ENOCH1` for Enoch targets) in `CrossRefGraph.tsx`.
- **Firsts & Milestones expanded** into four tabs (`firsts.rs`'s `FirstsEntry.category`):
  the original "Firsts" plus **Facts** (structural/numeric facts computed directly from the
  bundled KJV text — see gotcha below), **Promises** (direct, quoted first-person promises from
  God), and **Warfare** (passages explicitly about spiritual warfare). All wording was pulled
  from the bundled KJV via direct DB queries before writing, not from memory.
- **Book of Enoch** added as a new, clearly non-canonical section: version code `ENOCH1`, book
  `Enoch` with `testament = 'Apocrypha'`, 108 chapters / 1,059 verses, sourced from Project
  Gutenberg #77935 (R.H. Charles & W.O.E. Oesterley's 1917 translation, public domain). This is
  specifically **1 Enoch** (the Ethiopic Enoch) — not 2 Enoch (the Slavonic "Secrets of Enoch")
  or 3 Enoch (the later Hebrew Enoch), which are separate works and are not bundled. Confirmed
  directly from the translators' own introduction in the Gutenberg text, not assumed. Sits in
  its own Sidebar section below OT/NT with a canonicity disclaimer; reading it auto-switches
  `versionCode` to `ENOCH1` and hides the version dropdown (only one translation exists) —
  `navigate()` in `App.tsx` handles the switch both ways. `ChapterView.tsx` shows a collapsible
  key explaining the translator's own critical-apparatus bracket marks (⌜⌝, 〚〛, ‹›, etc.) rather
  than silently stripping them. Two curated, real cross-references were added to the
  `cross_references` table (both directions): Jude 1:14-15 → Enoch 1:9 (direct quotation) and
  Jude 1:6 / 2 Peter 2:4 → Enoch 6:1 (the Watchers narrative, scholarly-recognized allusion, not
  a quotation). The cross-ref graph colors Enoch nodes violet with a legend note. Enoch verses
  are also in `verses_fts` so keyword search covers it like any other version.
- **Installer build works**: `npm run tauri build` succeeds (release compile + NSIS `.exe` +
  WiX `.msi`), output lands in `src-tauri/target/release/bundle/{nsis,msi}/` (actually under
  the redirected local cargo `target-dir`, see gotcha #2 — not literally `src-tauri/target`).
  Installers were copied to `installer/` at the project root for easy access (this folder is
  gitignored, not committed — see "Git status" below). App version was bumped from `0.1.0` to
  `1.2.0` in all three places it's declared (`package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml`) before this build — keep those three in sync on future version bumps.
  Unsigned, so Windows SmartScreen warns on first run — expected, not a bug.

**Phase 4 (code/UI review pass, 2026-09-09) — done:**
- **Bug fixes**: `Back` bypassed the Enoch version auto-switch (returning from Enoch left the
  reader on `ENOCH1` showing an empty chapter) — every book change now goes through
  `applyLocation()` in `App.tsx`. Chapter loads carry a request token so a slow response can't
  overwrite a newer one, and a failed load shows the error instead of stale text. Dark mode:
  the word-count summary box was navy-on-navy. `FirstsPanel` double-fetched on mount and
  rendered a `<p>` inside a `<ul>`. `ParallelPanel` listed `ENOCH1` against Bible verses (and
  every Bible version against Enoch verses) as "not available" rows.
- **Navigation**: Previous/Next chapter buttons at the end of each chapter (cross book
  boundaries, never cross into/out of the Apocrypha section) plus `←`/`→` keys; `Ctrl+K`
  focuses search; `Esc` closes the panel. Typing a reference into the top search box
  (`John 3:16`, `gen 1`, `1 sam 17`, `Jude 3`) navigates directly via `parseReference()` in
  `api.ts` (unambiguous-prefix book matching); anything else still runs a topic search. The
  sidebar scrolls the active book into view and can be hidden with the ☰ button. The previous
  chapter stays visible (dimmed) while the next loads instead of flashing "Loading…".
- **Appearance**: Unicode glyph icons (⌕ 🖶 ⛓ ⇄ ✕) replaced with inline SVGs in
  `src/components/icons.tsx` (the glyphs rendered inconsistently on Windows). Cross-reference
  legend is now swatches instead of a paragraph. Buttons/status text use CSS classes
  (`.outline-btn`, `.status-ok/.status-error`, `.section-label`) instead of inline styles.
  Hebrew (WLC) renders right-to-left with `lang`/`dir` set; Greek/Hebrew get a larger size.
  Keyboard focus rings via `:focus-visible`; tagged words are keyboard-reachable
  (`role=button`, `tabIndex`).
- **Word study**: a word carrying several Strong's numbers (Hebrew prefixes) now offers all of
  them as tabs instead of silently opening only the first.
- **Bundle**: `CrossRefGraph` and `GenealogyPanel` are `React.lazy`-loaded, so cytoscape
  (~435KB) is only fetched when a graph panel opens; initial JS went from ~750KB to ~225KB.
- **Reader renders the real verse text**: previously, any Strong's-tagged translation was
  rendered from the word tokens alone, which strip all punctuation and quotation marks (and,
  for WEB, skipped whole words). `src/verseSegments.ts` now reconciles the tokens against the
  full text (boundary-checked, order-tolerant matching, validated at ~100% of non-empty
  tokens across BSB/KJV/WEB/ASV/TR) so punctuation is shown and tagged words stay clickable.
  A display-only `tidyPunctuation()` also removes the pipeline's stray space after opening
  quotes (`“ Let there be light,”`).
- **WEB data bug fixed**: 2,069 WEB verses (all red-letter passages) had raw USFM attribute
  text in `verses.text` (`For|strong="G1063" God|strong="G2316" …`) and were missing those
  words from `strongs_links`. Cause: `usfm_extract.py` only matched `\w …\w*`, not USFM's
  nested `\+w …\+w*` form used inside `\wj` (words of Jesus). The regexes now accept both.
  `bible.db` was repaired in place (WEB rows deleted and reloaded with the fixed parser, then
  `INSERT INTO verses_fts(verses_fts) VALUES('rebuild')`), on a local-disk copy per gotcha #1,
  verified with `PRAGMA integrity_check`, then copied back. WEB now has 677,687 Strong's links
  (was 639,567). A pre-patch backup was left at
  `%LOCALAPPDATA%\bible-concordance-build\bible-prepatch-backup.db` on the PC
  used for this session. A full pipeline rebuild would produce the same result.
- **Rust**: the duplicated Strong's word-grouping in `commands.rs` is one helper
  (`words_for_verse`); `get_verse_with_strongs` is a single query; `settings.rs` takes `&Path`.
- Smoke-tested by launching `tauri dev` with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and driving the WebView2
  window over CDP with a small dependency-free Node script (screenshots + clicks) — a handy
  way to test this app headlessly on Windows without Playwright.

**Phase 5 (offline commentaries + people/places, ESV online, 2026-09-09) — done:**
- **Backup first**: commit `a10d47c` plus a full copy (repo bundle, `bible.db`, model, JSON
  resources, installers — 701MB) at `X:\Code\bible-backups\2026-09-09_before-commentaries\`.
- **Seven commentaries bundled offline** from the Free Use Bible API (bible.helloao.org, AO
  Lab; all public domain except Tyndale Open Study Notes, CC BY-SA 4.0): Matthew Henry,
  Jamieson-Fausset-Brown, Adam Clarke, John Gill, Calvin, Keil & Delitzsch (OT), Tyndale.
  `data-pipeline/build_commentaries.py` downloads ~7,300 chapter JSONs + ~4,800 entity
  records (cached under `%LOCALAPPDATA%\bible-concordance-build\helloao-cache\`, so reruns
  are cheap), builds `commentaries.db` on local disk (gotcha #1), integrity-checks it and
  copies it to `src-tauri/resources/commentaries.db` (gitignored, bundled via
  `tauri.conf.json`). Section text is zlib-compressed (`flate2` on the Rust side) with a
  contentless FTS5 index for full-text search. A handful of chapters 404 at the source
  (e.g. JFB Mark 15, K&D Numbers 17) and are simply absent. Python 3.13+ needs
  `VERIFY_X509_STRICT` cleared for helloao's certificate chain — handled in the script.
- **Theographic Bible Metadata** (CC BY-SA 4.0) bundled in the same DB: 3,067 people, 1,274
  places (with coordinates), 450 events, each with description, dates, relations
  (father/mother/children/spouse, locations, participants) and every verse reference.
- **Rust**: `src-tauri/src/commentaries.rs` (+ commands `list_commentaries`,
  `get_commentary_chapter`, `search_commentaries`, `chapter_entities`, `get_entity`,
  `search_entities`). The DB is optional: if `commentaries.db` is missing the app still runs
  and those commands return a clear error. Note that `tauri-build` refuses to compile while a
  resource listed in `tauri.conf.json` doesn't exist, so run the pipeline (or drop the entry)
  before `cargo check` on a fresh machine.
- **UI**: a third verse action (book icon) opens the **Commentary** panel for that verse; the
  panel follows the reader's current chapter, remembers the last-used commentary, highlights
  and scrolls to the section covering the verse, shows book/chapter introductions collapsibly,
  and every section heading jumps to its passage. A **People & Places** top-bar button opens
  the per-chapter entity panel (People / Places / Events tabs with verse chips, profile view
  with relations and all references, and a whole-Bible name search). Search gained a
  **Commentaries** mode (FTS over all seven; a hit opens the reader at that verse with the
  commentary beside it).
- **ESV online provider**: `online.rs` now has a `Provider` enum (api.bible / api.esv.org).
  Settings has a second key field for a Crossway ESV API key; ESV shows in Compare tagged
  `online · api.esv.org` with Crossway's required attribution. Untested against a live key in
  this session (none available) — the request format follows Crossway's v3 passage/text docs.
  YouVersion Platform was evaluated and deliberately not added: it needs app registration and
  per-version licence acceptance, and duplicates NIV which api.bible already provides.

- **Resizable layout**: `src/components/ResizeHandle.tsx` adds a 6px drag strip after the
  sidebar and before any side panel (pointer-capture drag, double-click or Home/Enter to
  reset, ←/→ keys nudge). Widths persist in `localStorage` (`layout:sidebar`,
  `layout:panel`) and are clamped both by the viewport (CSS `min(..., 40vw/60vw)`) and by a
  per-render cap that keeps the reading pane ≥ ~340px. A user-set panel width applies to
  every panel via the `--panel-width` custom property on `.app-body`; the chapter grid in the
  sidebar auto-fills columns from the available width.

**Phase 6 (Map panel + opening search screen, 2026-09-10) — done:**
- **Map panel** (`src/components/MapPanel.tsx`, lazy-loaded like the graph panels since it
  pulls in Leaflet): a fully offline interactive map, opened via a new top-bar **Map** button.
  - **Basemap**: Natural Earth 1:50m coastlines/countries, rivers, lakes, and a curated set of
    seas — clipped to a lon/lat box wide enough to cover every bundled place's real coordinates
    (Spain/Tarshish to India/Ophir, not just the Levant core; see the comment above `MIN_LON` in
    `build_map_data.py` if a future place ever plots with no basemap under it) and bundled as
    small JSON under `public/map/` (~650KB total, public domain, no attribution needed).
  - **Places**: all 1,252 geocoded Theographic places already in `commentaries.db`, plotted via
    a new `map_places` Rust command (`commentaries.rs`/`commands.rs`) that returns the whole
    table at once (the panel isn't chapter-scoped like People & Places). Places sharing an exact
    fallback coordinate (74 different Jerusalem sites collapse to one point in the source data)
    are fanned out in a sunflower-spiral jitter so they're individually clickable — pure zoom
    doesn't help there since the underlying points are bit-for-bit identical.
  - **Ancient/Modern toggle**: `data-pipeline/build_map_data.py` links bundled place names to
    OpenBible.info's Bible-Geocoding-Data (CC BY 4.0) by normalized-name matching, keeping only
    confidently-scored identifications (186 places matched, e.g. Zoan→Tanis, Ararat→Urartu).
    Modern mode repositions/relabels matched markers to their real modern coordinates, restyles
    the basemap as a plain political map with country borders/labels, and fades markers with no
    confident modern identification rather than hiding them.
  - **Historical-era timeline**: a slider (starts at "No overlay") over five hand-drawn,
    schematic kingdom/empire outlines — Conquest & Judges, Divided Monarchy, Assyrian Empire,
    Babylonian & Persian Empire, Roman/NT — built in `data-pipeline/build_territories.py` from
    this app's own place coordinates as anchor points (there's no free ready-made GIS dataset
    for ancient Near Eastern political boundaries). Explicitly labeled schematic/approximate in
    the UI, not presented as a scholarly reconstruction. The fill layer lives in its own Leaflet
    pane stacked below the marker pane (`territoryPane`, z-index 350) and is non-interactive —
    without that, every timeline drag re-inserts fresh polygons *after* the already-placed
    markers, which silently made them unclickable (draw/hit-test order follows insertion time,
    not logical layer grouping — see the comment at `map.createPane` in `MapPanel.tsx`).
  - **Cross-panel focus**: `App.tsx` lifts `focusedPlaceId` so picking a place in People &
    Places and then opening the Map (or vice versa) lands on the same place already selected.
  - Eden has no coordinates in Theographic (location is genuinely disputed) but is plotted
    anyway at the most commonly cited traditional site (Tigris-Euphrates confluence near
    Al-Qurnah, Iraq), labeled "(estimated)" everywhere it appears — see
    `COORDINATE_OVERRIDES` in `build_commentaries.py`, applied automatically on every rebuild.
- **Opening search screen** (`src/components/HomeScreen.tsx`): the app now opens on a centered
  "What wonder of God do you want to find today?" prompt instead of straight into Genesis 1
  (which also means it no longer fetches Genesis 1 just to hide it — `App.tsx`'s chapter-load
  effect is gated on a new `homeActive` state). Typing a reference shows a direct "Go to..."
  button; typing a theme runs the same topic search as elsewhere. Landing anywhere — a result,
  an example chip, or even just using the ordinary top-bar search instead — retires the screen
  for the rest of the session (centralized in `applyLocation()`, not duplicated per entry
  point). The reference-parsing logic itself was extracted into a shared `resolveReference()` in
  `api.ts` so the top bar and the new screen can't drift apart.
- Version bumped `1.3.0` -> `1.4.0` in the three usual places (`package.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`) plus `package-lock.json` (via
  `npm install`, no dependency changes -- just resyncs the lockfile's version fields).

**Phase 7 (search accuracy + Adams' Synchronological Chart timeline, 2026-09-14) — done:**

- **Topic search was missing verses that literally contain the phrase.** Reported case: "greater
  things" never surfaced John 14:12. Two separate faults. (a) The Exact-phrase tab never ran —
  see gotcha #16; the FTS backend was correct all along and returns exactly John 1:50 and John
  14:12 for that phrase. (b) Topic search ranked John 14:12 at **#110 of 31,086** while the panel
  showed 30 results. Neither index was broken: FTS5 is in sync with `verses`, and all 31,086
  embedding rowids map exactly onto the BSB verse-id set.
- **`semantic_search` is now hybrid** (`commands.rs`): exact-phrase FTS hits are pinned on top,
  then the dense ranking and an all-words FTS match are fused by Reciprocal Rank Fusion (k=60).
  Measured before → after: greater things #110 → **#2**, love your enemies #17 → **#1**, be still
  and know #7 → **#1**, a thorn in the flesh #15 → **#1**. Paraphrase queries are untouched *by
  construction* — "prodigal" appears zero times in the BSB, so both lexical tiers come back empty
  and the output is byte-identical to the old dense ranking (verified on the top 20). See gotcha
  #17 for the OR-tier trap. `TOPIC_LIMIT` also went 30 → 50.
- **New Timeline panel** (`src/components/TimelinePanel.tsx`, lazy-loaded like the Map/graph
  panels because its facsimile view pulls in Leaflet), built in Adams' own visual grammar: one
  horizontal axis with black century pillars and red decade lines, a lifespan ribbon per person,
  450 event pins that jump to the verse recording them, and era bands read from
  `public/map/territories.geojson` — the *same* file the Map panel reads, so the two can never
  drift (numeric `start`/`end` were added to its `eras` block, parsed from the labels already
  shown; no new chronology is asserted). Selecting a ribbon shows the synchronism the original
  chart exists to teach: **Adam knew Methuselah 243 years, Methuselah knew Noah 600, Shem knew
  Abraham 151**, plus every dated event inside that lifetime.
- **Genealogy → Timeline**: every name in the Genealogy panel gained "See on the timeline →",
  which opens the Timeline with that person selected and scrolled into view. Undated people
  resolve too (they'd otherwise select nothing — 25 of the 60 have no year scripture can fix).
- **`genealogies.json` gained curated `theographicId`, `ageAtHeirBirth` and `lifespan`** with a
  citation for each, sourced by querying the bundled BSB and cross-checking KJV rather than from
  memory (the same bar Phase 4's "Facts" tab set). This is what links the curated line to
  Theographic's dates — and it must stay curated, see gotcha #18.
- **Dates resolve in a fixed order of trust**: a `dateOverride` wins, else Theographic's years;
  then a ribbon's *length* prefers the lifespan scripture states over the dataset's arithmetic,
  which is what makes Abraham 175 (Genesis 25:7) rather than the dataset's inclusive-counted 176.
  Result: 35 people placed on the axis, 25 honestly undated; 21 scripture-dated, 13 dataset-dated,
  1 corrected. Unknown years render with Adams' own `?` rather than a guess.
- **Adams' chart itself is bundled as a pan/zoom facsimile**: `build_chart_tiles.py` slices the
  50,195 × 5,347 scan into 1,504 tiles (~25MB, z=0..7) served to a Leaflet `CRS.Simple` layer.
  The chart's own Ussher caveat is carried into the UI from `chart.json`.
- **Credits**: the chart was added to `NOTICE.md` *and* to `BUNDLED_SOURCES` in `SettingsPanel.tsx`
  (Settings → About → "Bundled sources & licences"). Four entries that had drifted out of the
  in-app list — Natural Earth, OpenBible geocoding, the hand-drawn kingdom outlines — were added
  back at the same time. Keep those two lists in step.
- **Timeline facsimile fills the panel, with a windowed full-screen toggle.** It first shipped
  at a fixed 460px with dead space beneath; the facsimile view now makes the panel a flex
  column so the Leaflet viewer claims whatever height is left, and a "Full screen" button
  covers the app window (Esc collapses it — captured *before* App's global Esc handler, which
  would otherwise close the panel outright). Leaflet caches container size, so the toggle also
  calls `invalidateSize()`. Confirmed on screen by the user.
- **Farewell splash on exit**: pressing the window's close button now shows John 3:16 for three
  seconds and then quits. The close is intercepted in Rust (`lib.rs` `on_window_event` →
  `prevent_close`), which emits `app-close-requested`; `ClosingSplash.tsx` shows the verse and
  calls the new `exit_app` command. The verse is read from the bundled BSB at startup rather
  than hardcoded, so there is no second copy of scripture in the source to drift. Pressing close
  a second time skips the splash, and a 6-second Rust watchdog quits regardless — see gotcha #22
  for why that watchdog is load-bearing and for the emit bug it caught.
- **Version bumped `1.4.0` -> `1.5.0`** in the three usual places plus `package-lock.json`, and
  both bundles built and copied to `installer/` (~341MB NSIS, ~384MB MSI — about +24MB over
  1.4.0, which is the chart tiles; a +218MB jump would have meant the raw scan leaked in).
- **Verified**: `cargo check`, `tsc --noEmit` (app + vite config) and `npm run build` all clean;
  `dist/` is 29MB with the 1,504 tiles present and the 218MB scan correctly excluded. The
  Adams facsimile and the Synchronology view were confirmed rendering in the running app by the
  user. The farewell splash was verified by measurement, not by eye: send the window a real
  `WM_CLOSE` via PowerShell `(Get-Process bible-concordance).CloseMainWindow()` and time
  `WaitForExit` — ~3,400ms means the verse showed and exit followed, ~6,000ms means only the
  watchdog fired, and under 1,000ms means the close was never intercepted. That timing harness
  is the cheapest way to re-test this path without a human watching the screen.

**Not built yet:** local import of
user-owned NIV/ESV/NKJV modules (e-Sword/MySword), semantic/keyword search over Enoch's
text is FTS-only (no embeddings — the `verse_embeddings` vec0 table was only ever built for BSB).
From Phase 7: Adams' **book spans** (`JUDGES 271`, `1st SAMUEL 115` printed along his axis) are
deliberately absent — deriving them from event references was tried and fails, e.g. 1 Chronicles
comes out as −3873..−3678 because its chapter-1 genealogies reference Adam-era events; Adams'
figures are editorial and would need curating by hand. Adams' dozens of **nation streams** are
also absent: only the five schematic Map-panel eras exist to drive bands. Also still missing:
roughly **40 dated people have no ribbon** — the Timeline draws only the 60 curated genealogy
names, while `entities` holds ~75 dated people (Job, Rachel, Joseph son of Jacob, Samson, Hagar,
Ishmael, Esau, the twelve sons all have years sitting unused). That is the cheapest high-value
follow-up: a backend-only change to feed the extra ribbons in. The Timeline also has no "you are
here" marker while reading, and does not drive the Map panel's era slider. **The hybrid search
ranking has still never been confirmed by eye in the running app** — it is measured and
build-verified only.

**Phase 8 (Prophecies tab + a close-splash saga that ends in a working, simple fix, 2026-09-15
— done, v1.5.0):**

- **New "Prophecies" tab in Firsts & Milestones** (`src/components/FirstsPanel.tsx`,
  `src-tauri/resources/firsts.json`): 42 Messianic prophecy -> fulfilment pairs across five
  sections (Ancestry, Birth, Life, Death, Reign), rendered as a Foretold/Fulfilled split card
  with both sides clickable. Selection and grouping are credited to *FULFILLED*, a Tableau
  Public visualisation by "thecfelix" and Kevin Flerlage
  (`public.tableau.com/app/profile/thecfelix/viz/.../Fulfilled`) — the references and section
  groupings came from opening their `.twbx` workbook's `.hyper` data extracts directly with the
  `tableauhyperapi` Python package (61 rows recovered, deduped to 42 distinct prophecies). Their
  bundled verse text was NIV and was **not** used, per this project's no-copyrighted-text rule
  (see NOTICE.md) — every verse is rendered from the bundled public-domain translations instead.
  Credited in both `NOTICE.md` and the in-app "Bundled sources & licences" list in Settings.
  Several of their pairings were corrected rather than imported verbatim, each with the reason
  recorded in the entry's `note` field: Psalm 22:1 (forsaken) had been mis-paired to 22:18 (the
  casting of lots); Isaiah 53:9 (buried with the rich) to 53:12 (crucified with criminals); and
  "numbered with the transgressors" is commonly cited as **Mark 15:28**, which does not exist in
  this app's BSB (the critical text it follows omits that verse) -- repointed to Mark 15:27 /
  Luke 22:37. `firsts.rs`'s `FirstsEntry` gained `fulfillment: Vec<String>` and
  `section: Option<String>`, both defaulted so older-shaped entries deserialize unchanged.
- **The farewell splash (added in Phase 7) turned out to be genuinely broken by an `AppHandle`
  vs `Window` emit-target bug, was "fixed" through several increasingly complex redesigns that
  were each independently measured unreliable, and the actual root cause was never any of the
  redesigns at all -- it was the test harness.** Full account, because the failure pattern (flaky
  at a low, code-independent rate) is exactly the kind of thing worth not re-diagnosing from
  scratch:
  1. Phase 7 shipped Rust `prevent_close()` + `Window::emit()` + JS `listen()`. First-ever
     measurement: worked (verse showed, ~3469ms). Next three: failed, ~6020-6037ms (a 6s
     Rust-side watchdog quitting instead). Traced with `eprintln!` marks on both sides: the
     event was emitted (`Ok(())`) but never reached the frontend's `listen()` handler.
  2. Switched to `Window::emit` -> `AppHandle::emit` (the documented fix for that exact
     Tauri gap). Measured clean once (3464ms) -- but that positive result later turned out to
     be confounded (see below).
  3. Rewrote to a frontend-owned design (`getCurrentWindow().onCloseRequested()`, no Rust
     interception at all, `core:window:allow-destroy` added to `capabilities/default.json`).
     Failed 3 straight runs at ~40ms (the "close fell through untrapped" signature) -- which
     led to discovering a real, unrelated, and worth-keeping bug: **vite's dependency-optimiser
     cache was failing with `EPERM` on this project's SMB share**
     (`node_modules/.vite/deps` -> a temp dir rename, same class of problem as gotchas #1/#2),
     which silently killed the ENTIRE frontend (no panic, nothing in the Rust log -- Rust runs
     on unaffected) while leaving every symptom of "the close handler doesn't work." Fixed for
     good in `vite.config.ts` by moving `cacheDir` off the share, mirroring the cargo
     target-dir and DB-build-dir treatment. This fix is real and should stay regardless of
     anything else in this list.
  4. With EPERM fixed, retested the frontend-owned design: still flaky (2 successes measured
     against 15 failures across five different code shapes -- a StrictMode-safe rewrite, the
     hook sequenced after another `invoke()` call via `.finally()`, a plain `setTimeout` delay,
     and an unrelated second `invoke()` call added purely to see if extra IPC traffic helped).
     Each hypothesis was plausible, each was tested 2-3x, each failed identically to the others.
     One measurement (in step 2, and again later) was invalidated after the fact: editing
     `src-tauri` files while `tauri dev`'s watcher had an app already running silently
     restarts the binary mid-test, so a `CloseMainWindow()` sent moments later targets a
     stale, already-dead PID -- don't touch `src-tauri` while a launched instance is being
     timed, even for an "unrelated" cleanup edit.
  5. Tried a structurally different mechanism: Rust drives delivery directly via
     `WebviewWindow::eval()` (raw WebView2 script execution) calling a plain global JS function
     (`window.__triggerFarewellSplash`, assigned with zero Tauri API calls, so nothing on the
     JS side could race). This failed **consistently** (3/3 runs hit the Rust-side 6s
     watchdog) rather than intermittently -- a different, more diagnosable signature. Root-caused
     with `eprintln!` on the Rust side (`eval()` reported `Ok(())`, dispatch genuinely
     succeeded) and a file-based ping on the JS side, writing outside any IPC/stdout path that
     had already been implicated: **the JS effect that assigns `window.__triggerFarewellSplash`
     did not run until 16-20 seconds after process start**, not milliseconds, confirmed by
     polling the ping file every few seconds through a 25-second window.
  6. That is the actual root cause, and it retroactively explains every step above: every test
     script in this saga used a **fixed 12-second settle time** before sending
     `CloseMainWindow()`. In this specific dev session -- dozens of consecutive
     `cargo build`/`npm run tauri dev` cycles in a row, on an SMB-backed project directory,
     via `npm run dev`'s vite transform pipeline -- the webview was intermittently taking
     15-20+ seconds just to finish loading and start running React, an artifact of extreme,
     self-inflicted session load, not a defect in Tauri, WebView2, or any of the six designs
     tried. The two prior "successes" were not caused by their code differences at all: one
     happened to run several `curl` probes (adding real seconds of delay) before closing, the
     other explicitly used a 30-second settle -- both simply waited long enough by accident.
  7. **Resolution:** reverted all the way back to the simple, idiomatic design from step 3
     (`getCurrentWindow().onCloseRequested()`, no Rust interception, no watchdog, no `eval()`)
     and retested against the **actual compiled release binary** launched directly (no vite, no
     dev server, no `tauri dev` overhead) rather than through `npm run tauri dev`. Three
     consecutive runs: 3460ms, 3462ms, 3453ms -- tight, clean, and exactly the expected 3000ms
     verse + 400ms fade + overhead signature every time. The feature was correct for most of
     this saga; only the dev-mode test methodology was ever actually broken.
  - **Takeaways for next time:** (a) when a Tauri close/window-event handler looks
    intermittently broken in `npm run tauri dev` specifically, suspect the dev server and the
    settle time in the test before suspecting the handler -- prefer testing against the
    compiled release binary directly, which starts in ~2s with no vite/HMR path at all; (b) a
    silently dead frontend (EPERM dep-cache failure, or any other cause) looks IDENTICAL to a
    broken event handler from the Rust side -- the Rust log stays clean either way, so "the
    Rust side is fine" proves nothing about the JS side; (c) `Window::emit()` not reaching a
    webview's `listen()` while `AppHandle::emit()` does is real and documented Tauri behaviour,
    worth keeping in mind for any future Rust-to-frontend event; (d) don't edit `src-tauri`
    while a `tauri dev`-launched instance is mid-test, it silently restarts and invalidates
    the timing.
  - The re-test harness (`CloseMainWindow()` + `WaitForExit()` timing, described in Phase 7's
    entry above) is still the right tool, but point it at the release binary, and give a dev-mode
    instance 20-30s to settle before trusting a negative result.
- **Version bumped `1.4.0` -> `1.5.0`** stayed as-is from Phase 7 (already at 1.5.0 when this
  phase started); both installers rebuilt from the final, reverted close-handling code and
  copied to `installer/` (NSIS 340,868,609 bytes; MSI 383,516,672 bytes), replacing two earlier
  1.5.0 builds made mid-saga that shipped a design later proven unreliable in dev-mode testing
  (never confirmed broken in a release build, but superseded before being trusted either way).
- **Verified**: `cargo check` and `tsc --noEmit` clean throughout; the release build's actual
  close behaviour confirmed by direct measurement (3/3 clean runs, see above) rather than by
  eye -- nobody has watched this specific build's window on screen, only timed it.

**Phase 9 (version-only rebuild, 2026-09-15 — done, v1.5.1):** No code changes. Bumped
`1.5.0` -> `1.5.1` in the three usual places (`package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`) plus `package-lock.json` via `npm install`, then `npm run tauri build`.
Both bundles copied to `installer/` and byte-verified against their build source (NSIS
340,868,336 bytes; MSI 383,467,520 bytes). This is the exact source confirmed working at the
end of Phase 8 (the close-splash fix, the Prophecies tab) -- nothing functional differs from
the 1.5.0 build, only the version string. **The installer files themselves are deliberately
NOT committed to git** -- both are 300+MB, well over GitHub's 100MB hard per-file limit for a
normal push (this was confirmed and flagged to the user before proceeding, rather than
attempting a push that would fail after a long upload); `installer/` stays gitignored, same
convention as the `.db` files. `git-lfs` happens to be installed on this machine but the repo
itself has never been configured to use it -- if committing installers through git is ever
wanted, that setup (and checking GitHub LFS's free-tier storage/bandwidth quota) needs to
happen first, deliberately, not as a side effect of "add the installer file" being read too
literally.

**Phase 10 (Gospel wordmark + opening-screen stats, 2026-09-22 — done, v2.0.0):**

- **"Gospel" wordmark** on the opening screen (`HomeScreen.tsx`), replacing the old
  "What wonder of God do you want to find today?" tagline -- styled after Google's own
  homepage: a colorful wordmark with nothing else, directly above the search box.
  Per-letter colors follow Google's *actual* positional pattern for their 6-letter name
  (blue/red/yellow/blue/green/red), applied identically to this word's 6 letters, not an
  arbitrary reuse of "Google colors". Font is Poppins **Regular** (not bold -- the first
  pass used ExtraBold and was corrected on request, to sit closer to Google's own
  wordmark weight), downloaded from `google/fonts` (SIL OFL 1.1, verified genuine and
  bundled locally at `public/fonts/`, offline-first like everything else here -- Google's
  actual logo font, Product Sans, is proprietary and was never an option). Credited in
  both `NOTICE.md` and the in-app Settings source list.
- **"Inside this Bible" stat tiles** below the search box: a new Rust command
  `home_stats()` (`commands.rs`, `HomeStats` in `models.rs`) computes all six numbers
  live against the bundled databases -- books, chapters, verses (KJV), cross-references,
  translations, and Strong's/entity counts held in reserve -- the same pattern
  `chapter_counts()` already uses, so these can never go stale independent of the data
  pipeline. Every number was hand-verified against the actual bundled DB before shipping
  (66 books / 1,189 chapters / 31,102 verses / 432,955 cross-references / 7
  translations). **Authors (~40) is the one tile not backed by the database** -- there is
  no authorship field anywhere in the schema, biblical authorship being a matter of
  tradition/scholarship rather than something machine-countable -- shown as a footnoted
  traditional estimate per explicit user sign-off, not silently presented as computed.
- **Only 3 of the 6 tiles are clickable**, each jumping into the reader and opening the
  relevant panel to demonstrate the stat live, rather than a plain "here's a number":
  Books -> Genesis 1 (start reading); Cross-references -> Genesis 1:1 (68 outgoing
  cross-refs, the richest opening verse of any book, verified not guessed) with the
  graph panel open; Translations -> John 3:16 with the Parallel Compare panel open, all
  7 translations visible at once. Chapters/Verses/Authors stay plain, undecorated
  figures -- each would either duplicate the Books tile's destination or point at a
  feature that doesn't exist, so they were deliberately left non-interactive rather than
  padded with a button that goes nowhere. Wired through a new `startFromHomeWithPanel`
  helper in `App.tsx` (navigate + `setPanel` in one call), alongside the existing
  `startFromHome`.
- A live HTML mockup was built and iterated with the user before implementation (bold ->
  regular weight; "recommend what each would expand to" -> the interactive/static split
  above), republished in place across two rounds rather than treated as disposable.
- **Verified**: `cargo check` and `tsc --noEmit` clean; `npm run build` confirms
  `dist/fonts/Poppins-Regular.ttf` lands correctly (and that the old ExtraBold file is
  gone, not just unreferenced); every `home_stats` SQL query re-run standalone against
  the real bundled DB and confirmed to produce the exact numbers shipped; a dev-mode
  launch confirmed no panic and correct bundle wiring. **Not confirmed by eye** -- nobody
  has looked at the rendered opening screen in the actual running window.
- **Version bumped `1.5.1` -> `2.0.0`** (major, given the accumulated scope since 1.x --
  hybrid search, Timeline + Adams facsimile, Prophecies tab, and now this) in the three
  usual places plus `package-lock.json`; both bundles built and copied to `installer/`
  (NSIS 340,938,782 bytes; MSI 383,680,512 bytes, byte-verified against build source).
  Same not-committed-to-git treatment as every prior installer, per Phase 9's reasoning.
- **A `check/` folder appeared in the project root this session** (untracked, still
  present): three PDFs (ESV, NIV, Amplified Bible) the user downloaded hoping they might
  be usable despite earlier copyright trouble with those same translations. Confirmed
  still fully copyrighted -- the ESV PDF carries Crossway's own copyright notice
  verbatim (capped, attribution-gated quoting only, not a redistribution license); NIV
  and Amplified lack notices entirely, which is a worse sign, not a better one (absence
  of a notice isn't evidence of public domain -- copyright is automatic). Nothing was
  added to the app or the data pipeline; the user was told to delete the folder
  themselves, not deleted by this session.

**Phase 11 (Home button, a real closing-splash bug fix, search history, 2026-09-22 —
done, v2.0.1):**

- **New "Home" button** in the top bar (`App.tsx`, `HomeIcon` in `icons.tsx`), right
  before "Back": returns to the opening Gospel screen. Deliberately does not touch
  `history` -- home isn't a reading location, so it doesn't consume a Back step or
  become reachable by pressing Back afterward. Disabled when already on the home
  screen, same pattern as Back being disabled with no history. `book`/`chapter`/
  `verses` state stays intact underneath while home is showing, so navigating away
  from home again picks up cleanly.
- **Real bug fixed in the farewell splash** (the Phase 7/8 feature): the user watched
  it happen and reported the splash "appears and then disappears, then about half a
  second later the app closes." Root cause, found immediately from the CSS rather than
  needing another diagnostic saga: the splash's exit step faded `.splash-screen`'s
  *opacity* to 0, but that overlay sits on top of the still-mounted reading view --
  fading it to transparent doesn't hide it, it reveals the app underneath for the
  whole 400ms transition, which is exactly the "appears then disappears" (the splash
  fading away to expose the reader view) followed by a dead gap before the window
  actually closed. Fixed by removing the fade-out entirely (`ClosingSplash.tsx`): the
  splash now stays fully opaque for the whole visible duration, then calls `onDone`
  immediately, no transition to wait out. The unrelated arrival `SplashScreen.tsx`
  keeps its own fade-out unchanged -- there, revealing the app underneath *is* the
  intended effect. Measured on the compiled release binary (not dev mode, per gotcha
  #23's lesson), 3 runs: 3179/3184/3173ms, tight and consistent, down from the old
  ~3400ms-visible-plus-~500ms-reveal-gap and with no more flicker.
- **Search history**: new `searchHistory.ts` -- last 10 distinct searches, newest
  first, deduplicated case-insensitively, persisted via `localStorage` (same
  established pattern as the sidebar/panel-width preferences in `App.tsx`, so it
  survives app restarts). Shared between the opening screen's search box and the
  top-bar quick search (`runQuickSearch` in `App.tsx`) rather than two separate
  histories, since a term typed in one is just as worth having in the other. Shown on
  the opening screen as clickable "Recent:" chips above the existing "Try:" examples,
  same click-to-insert behavior. Only records on an actual commit -- a resolved
  reference or a clicked result (`goAndRemember` in `HomeScreen.tsx`) -- not every
  debounced keystroke, so it doesn't fill with half-typed fragments. The opening
  screen's stat-tile demo jumps (Books/Cross-references/Translations) deliberately do
  NOT record to history -- those are canned jumps the user didn't type, not searches.
- **Verified**: `tsc --noEmit` clean (no Rust changed this phase); a dev-mode launch
  confirmed no panic and correct wiring for all three pieces; the closing-splash
  timing was measured against the compiled release binary as above. Home button and
  search-history chips have not been clicked by a human yet, only compiled and
  wired-checked.
- **Version bumped `2.0.0` -> `2.0.1`** (patch -- three focused fixes, not new feature
  scope) in the three usual places plus `package-lock.json`; both bundles built and
  copied to `installer/` (NSIS 340,945,538 bytes; MSI 383,631,360 bytes), byte-verified
  against build source. Same not-committed-to-git treatment as every prior installer.

**Incident (2026-09-22, same session as Phase 11): the user's real email was exposed in 6
public commits, caused by this session, found on request and remediated -- read this
before making ANY commit in this repo.** No version bump, no code change; a git-history
fix only.

- **What happened**: the system context available in this environment hands over the
  user's real email "for authorship/attribution", and every commit from `1bdd8ea`
  (v1.4.0) through `121ef61` (v2.0.1) -- 6 commits across this and earlier sessions --
  used it verbatim as the git author/committer email. The repo is **public**. Worse,
  `1bdd8ea` also carried the user's real full name (not just the email) as both
  author and committer. This directly contradicted an established, deliberate
  convention already visible in this repo's own history: every commit before
  `1bdd8ea` used GitHub's privacy-preserving `BadBull22@users.noreply.github.com`, and
  there is literally a commit titled "Scrub machine-specific paths and LAN details for
  public repo" (`e3422be`) predating any of this. That commit was a clear signal that
  should have been matched, not overridden with a different default.
- **What was checked and found clean**: the exposure was metadata-only. A full-history
  search (`git grep` across every commit, not just HEAD) found the email/name **nowhere
  in file contents** -- only in commit author/committer fields. `.env` (the local
  api.bible key) was confirmed never committed, in any commit, ever. No API-key-shaped
  strings, no Windows paths/usernames, no LAN/IP details in any tracked file. Settings-
  panel-entered keys (ESV/NIV) are written to the OS app-config directory by
  `settings.rs`, never touch the repo.
- **What was done**: `git filter-branch --env-filter` (git-filter-repo isn't installed
  on this machine) rewrote GIT_AUTHOR_EMAIL/GIT_COMMITTER_EMAIL from the real personal
  address to the noreply address across all commits, and GIT_AUTHOR_NAME/
  GIT_COMMITTER_NAME from the real name to "BadBull22" for the one commit that had it. Verified before
  pushing: the 5 commits predating the exposure (`59e022a` through `e3422be`) kept
  their **exact original hashes** (proving nothing about them changed); the 6 affected
  commits got new hashes reflecting only the metadata fix (`1bdd8ea`->`b966d0a`,
  `cf2f590`->`fe62d3c`, `6675a62`->`25d3033`, `1642361`->`35a8f7f`,
  `94e6c6b`->`92987a7`, `121ef61`->`e446ef7`). filter-branch's local backup refs
  (`refs/original/*`) were deleted and the reflog expired + `gc --prune=now` run
  locally, so the old commit objects aren't sitting around on this machine either.
  Force-pushed with `--force-with-lease` (not a blind `--force`) so the push would have
  failed safely had the remote moved unexpectedly. Confirmed via `gh api
  repos/BadBull22/bible/commits` (GitHub's live API, not local cache) that the served
  history is fully clean.
- **What is NOT fully resolved, and won't be by anything runnable from here**: the OLD
  `121ef61` commit (with the real email) is still directly fetchable from GitHub by its
  exact SHA (`gh api repos/BadBull22/bible/commits/121ef61...` still returns it), even
  though it is unreachable from any branch/tag and doesn't appear in the commit list,
  clone, or history view. This is normal GitHub behavior after a force-push -- orphaned
  commits aren't purged from their storage instantly, only garbage-collected on their
  own schedule. The practical exposure is narrow (nothing links to that SHA anymore, so
  finding it requires already having it), but it is not zero. **If this needs to be
  fully closed, the user has to file a request with GitHub support themselves** (only
  the account owner can) to purge cached/orphaned commit data -- this was surfaced to
  the user, not yet actioned as of this note.
- **Follow-up (2026-09-26): the user's NAME is not a secret -- only email and contact
  details are.** A pre-commit scan of the v2.1.0 changes found that this incident write-up
  (commit `29cc956`) spelled out the user's full name in `HANDOVER.md`. The name was removed
  from the working file, and the user was asked whether to purge it from history with a
  force-push. **The user said no purge is needed:** the app's own About section credits
  them by name ("Made by ... as a personal Bible study tool", `SettingsPanel.tsx`, which is
  public), so a name mention is fine. **What must never appear in this repo is their email
  address and contact details** (the email itself was never in any file's contents -- only
  in the since-rewritten commit metadata). The scrub was therefore harmless but not
  required; the commit-author identity still stays `BadBull22` noreply, as the user chose.
  Keep running the pre-commit scan for email/phone/contact details, API-key shapes and
  machine paths over everything about to be committed, including HANDOVER.md itself.- **The fix going forward**: every commit command in this project must use
  `-c user.name="BadBull22" -c user.email="BadBull22@users.noreply.github.com"` --
  **never** the real email, regardless of what any session's ambient context suggests
  for "attribution" purposes. See gotcha #24.

**Phase 12 (offline "Ask a question" search, 2026-09-25 — done, still v2.0.1, no
installer built this phase):**

- **What it is**: a 5th Search-panel tab ("Ask a question", now the default tab) that
  answers real questions -- "how many times is X mentioned [in the OT/NT/a book]",
  "how many prophecies were fulfilled in Christ's birth, life, and resurrection", "how
  old was Joseph when he died" -- rather than just returning a verse list. Explicitly
  **not** a generative/local-LLM feature (the user was offered that option and rejected
  it, worried about hallucinated facts undermining this app's whole verification
  discipline). Three layers, tried in order, first hit wins:
  1. **`qa_parser.rs`** (new, no I/O) -- a strict regex grammar recognizes only
     "how many time(s) is/does/did/was/were/has/do X mentioned/used/appears/occurs/
     found [in the Old/New Testament | in \<book\>]"-shaped questions and hands off to
     an **extended `word_frequency`** (`commands.rs`/`models.rs` gained
     `FrequencyScope` -- `Testament{testament}` | `Book{book}` -- reusing the
     `(?N IS NULL OR col=?N)` SQL idiom `home_stats` already established) for an exact,
     deterministic count. Everything else -- including "how many times did Jesus
     appear after His resurrection", which contains the literal words "how many
     times" -- must fall through untouched; a false match here would show a
     confidently wrong number for a question that wasn't actually asked. Two real bugs
     were caught by its own unit tests before shipping (both from a naive
     non-greedy-capture-then-open-tail regex design): a trailing qualifying clause
     ("...mentioned in Genesis **before the flood**") was wrongly accepted as a book
     name, and an active-voice phrasing ("does the Bible **mention** faith") matched
     almost nothing because the capture collapsed to one character. Fixed by splitting
     into two phases -- `strip_scope_suffix` (peels a recognized, **word-count-capped**
     scope clause off the very end first) then simple head/verb templates anchored to
     end-of-string on what's left -- rather than trying to patch one big regex.
  2. **Curated knowledge base + semantic match** -- `qa.rs` (new) + `resources/qa.json`
     (new, 21 hand-verified seed entries spanning all four confidence levels --
     `stated`/`computed`/`traditional`/`unattested`, never presented with uniform false
     certainty; e.g. Joseph's age at death is honestly answered "not stated," not
     guessed). `computed_from` entries (books/verses/chapters/cross-references/
     translations/Strong's counts, prophecy count) splice a **live** number into a
     literal `{{n}}` token in the answer at query time (`resolve_computed` in
     `commands.rs`) so these can never drift stale, same reasoning as the Home
     screen's stat tiles. `src-tauri/src/bin/index_qa.rs` (new, mirrors
     `index_embeddings.rs`) embeds every `qa.json` question+`alt_phrasing` **and**
     every existing Firsts/Prophecies question (84 of them, already curated -- this is
     what makes "how many prophecies were fulfilled" work on day one, reusing the
     existing 42-entry prophecy tracker) into `resources/qa_index.json` (157 rows
     total) with the same bundled MiniLM model, no SQLite involved. At runtime, an
     exact case/whitespace-insensitive text match is tried first (free), then cosine
     similarity (plain dot product -- vectors are already L2-normalized) against the
     combined index, threshold `ASK_SIMILARITY_THRESHOLD = 0.45` (picked as a
     conservative starting point, then empirically checked -- see Verified below).
     Firsts-sourced prophecy hits get their answer prose **synthesized** from
     `citations`+`fulfillment` (`build_curated_entry_from_firsts`), since those 42
     entries intentionally ship with an empty `answer` string (the Facts tab renders
     them as a two-column foretold/fulfilled card instead) -- surfacing that blank
     string directly would have been a real, silent bug.
  3. **Fallback** -- reuses `semantic_search`'s body (extracted into
     `semantic_search_query`) and `commentaries::search`, sharing the **one** query
     embedding already computed for step 2 rather than re-embedding, labeled "No
     direct answer on file -- here's what's most relevant" (or, if even that's empty,
     says so plainly) rather than ever guessing silently.
  - All three layers are orchestrated by `ask_question_query` in `commands.rs`
    (plain function, not `#[tauri::command]` itself -- see Verified below for why),
    with a thin `ask_question` Tauri-command wrapper around it.
  - **Frontend**: `SearchPanel.tsx` gained the "ask" mode/tab (now default), reusing
    the existing `hits`/`totalCount` state for `Computed` answers and `hits`/
    `commentaryHits` for `Fallback`, with new markup only for `Curated` answers (a
    confidence badge, prose, a citation-button row -- `AskRefRow`, mirroring
    `FirstsPanel.tsx`'s `RefRow` -- and a "matched by meaning" note when the match
    was semantic rather than exact). The existing mode-switch effect that already
    clears stale results on tab change was extended to also clear the new
    `askAnswer` state, since that exact class of bug (stale results under a new
    tab's heading) was already found and fixed once in this file previously.
  - **Verified**: `cargo test` (18 tests: 17 `qa_parser` unit tests including both
    regressions above, plus one smoke test below) and `cargo check`/`tsc --noEmit` all
    clean. This machine's Bash tool has a broken `$PATH` (raw untranslated Windows
    `PATH`, so `cargo`/`grep`/etc. all 127) -- PowerShell was used for every command
    this phase; re-verify Bash before trusting it in a future session rather than
    assuming this was fixed. No browser-automation tool was available to click through
    the actual UI, so instead of skipping verification, a `#[cfg(test)]` smoke test
    (`ask_question_smoke_tests` in `commands.rs`, run via
    `cargo test --release --quiet ask_question_smoke -- --nocapture`) drives
    `ask_question_query` directly against the real bundled `bible.db`/model/
    `qa.json`/`qa_index.json`/`firsts.json` with all 5 of the user's own example
    questions (typos included) plus a books-count question, a genuine paraphrase with
    **zero shared keywords** ("how long did jesus stay on earth before he went up to
    heaven" for the 40-days entry), and a wholly unrelated control question. All 10
    behaved correctly: the word-count example hit layer 1 exactly (372 for "love" in
    the whole Bible); the typo'd second example correctly fell all the way through to
    a labeled fallback instead of a false match; the resurrection-appearances question
    hit its curated entry by exact text; the 40-days/prophecy-count/Joseph's-age
    questions all hit their curated entries by semantic match at 0.96/0.99/0.99
    similarity; the zero-keyword-overlap paraphrase still found the 40-days entry at
    0.84; and the unrelated control question ("what is the meaning of life") correctly
    fell to a labeled fallback with thematically loose but honest results. This is
    real evidence the 0.45 threshold has comfortable margin, not just a guess -- but it
    is still evidence from one seed set on one embedding model, not a tuned/final
    value; revisit if real usage turns up a bad match. **The UI itself (the new tab,
    the badge, the citation buttons) has not been clicked by a human** -- only
    compiled, type-checked, and exercised through this backend-only harness.
  - **Making `ask_question_query` testable cost a real design decision, worth knowing
    for next time**: the first instinct was a standalone `src/bin/` probe binary (like
    `index_qa.rs`), which needs the functions/types it calls to be `pub` and reachable
    from an *external* crate. Marking `commands`/`models` `pub mod` for that alone
    would have leaked nearly this whole app's command surface into the crate's public
    API and triggered E0446 ("private type in public interface") cascading through
    every other command whose return type touches a still-private module
    (`commentaries`, `genealogy`, `settings`, ...) -- a much bigger blast radius than
    intended for what was meant to be a throwaway debug tool. The actual fix: a
    `#[cfg(test)] mod` **inside** `commands.rs` gets full same-crate access to every
    private item with no visibility changes at all, since Rust test modules compile as
    part of the crate itself, not as a separate external crate the way both
    `src/bin/*.rs` and `tests/*.rs` do. `qa`/`firsts` *did* need to become `pub mod`
    (for `index_qa.rs`, a real bin target, not a throwaway) -- safe there specifically
    because neither module's public types reference any *other* still-private module,
    so no cascade.
  - **Not done, deliberately left for the user to request**: no version bump, no
    installer built. `qa.json`'s 21 entries are a broad starter set per the approved
    plan, not a final list -- the user is welcome to hand over specific questions to
    add.

**Phase 12 continued, same day, based on live user testing (2026-09-25/26 --
still v2.0.1, no installer built):** the user actually ran the app and immediately
found two real problems this backend-only smoke test couldn't have caught, plus asked
for 12 more curated questions and a new sourcing rule. All fixed/added in this pass:

- **The real bug: the Home screen ("Gospel" box) wasn't wired to `ask_question` at
  all.** The user typed questions into the *Home screen's* main search box (the one
  styled after Google) and just got a plain verse list with no summary -- because
  `ask_question` had only been wired into the separate `SearchPanel.tsx` side panel's
  new "Ask a question" tab, which the user never opened. This was a placement call made
  during planning (the approved plan named `SearchPanel.tsx` specifically) that turned
  out to be wrong once a real person used the app the way they naturally would. Fixed
  by wiring `HomeScreen.tsx`'s existing debounced search effect to call
  `api.askQuestion` instead of `api.semanticSearch`, handling all three `AskAnswer`
  shapes the same way `SearchPanel.tsx` does. The two call sites' shared markup (the
  confidence badge, curated prose, citation buttons, computed-count summary line,
  fallback heading) was pulled out into a new `src/components/AskAnswerView.tsx` rather
  than duplicated a second time. **Lesson for next time a feature has an obvious
  "default" entry point in the UI (a home screen, a primary search box): check that the
  feature is actually reachable from there before calling it done, not just from
  whatever tab/panel the plan happened to name.**
- **A second real regex bug, found only because a human typed a sentence differently
  than any of the unit tests did**: "how many time is the word gold **is** used" (a
  natural copula before the trailing verb) got parsed as word `"gold is"`, not
  `"gold"`. Same root-cause family as the two bugs already fixed pre-launch (a
  non-greedy phrase capture stopping at the first place a required literal can be
  found, not necessarily the right place) -- fixed by adding an optional `(?:is |was
  )?` immediately before T1's trailing verb group, with a regression test using the
  user's exact typed sentence. This makes three separate real bugs this parser has had
  caught by *sentence shapes nobody had tried yet* rather than by reasoning about the
  regex in the abstract -- treat any future report of a wrong word-count extraction as
  plausible on sight, and add the literal failing sentence as a test case before fixing
  anything.
- **A real semantic-match false positive, found by deliberately testing existing "Try:"
  example chips through the new pipeline**: "the prodigal son" matched a curated
  Messianic-prophecy entry ("Messiah would be declared the Son of God") at similarity
  0.478 -- comfortably over the original `ASK_SIMILARITY_THRESHOLD = 0.45`, on nothing
  more than the shared word "son." True positives found so far all scored 0.84-0.99,
  so the threshold was raised to **0.6**, which has real margin on both sides of that
  gap (confirmed by re-running the same smoke-test sweep after the change -- the false
  positive disappeared, nothing genuine broke). Still an empirically-checked value from
  one seed set, not a permanently tuned one.
- **A second false positive, found only after the next content batch below was added**:
  "what is the old covenant?" matched the **new**-covenant entry at 0.90 similarity --
  well above any reasonable threshold, because "old covenant" and "new covenant" share
  almost every word except one antonym, which sentence embeddings are notoriously weak
  at distinguishing. Raising the threshold further wasn't an option (0.90 sits above
  several genuine true positives). The real fix was content, not a threshold: a
  dedicated `what_is_the_old_covenant` entry was added so the index has a correct
  target to match against; the query now matches its own entry exactly (0.90 stops
  being the winning score once a closer match exists). **General lesson: a semantic
  false positive between two of *this app's own* curated entries can't be fixed by
  threshold-tuning alone if both entries are legitimately similar in wording --
  distinguish them with a dedicated entry instead, and always re-run the full
  false-positive sweep after adding new content, not just after adding new logic.**
- **New confidence tier: `commentary_opinion`**, added to `QaConfidence`
  (`qa.rs`/`api.ts`/`AskAnswerView.tsx`'s badge styling) per an explicit new user rule:
  *"where there are no direct scripture also look at the commentaries for views on the
  subject and mention that this is taken from commentaries... any opinions have to be
  noted as opinions."* Distinct from `traditional` (a harmonization/scholarly
  consensus): this tier is for an answer that leans on a *named* bundled commentary's
  interpretation, and the answer text must name both the commentary and the verse it's
  commenting on -- never blend an unattributed commentary paraphrase into
  `stated`/`traditional` prose. Used for the one entry in this batch that actually
  needed it (`god_speaks_audibly` quotes Matthew Henry's commentary on Exodus 20:1 by
  name, attributed inline); every other new entry below turned out to be directly
  answerable from scripture itself once actually researched, so `stated`/`traditional`/
  `unattested` covered them without needing the new tier -- it exists now as real,
  tested infrastructure for the harder questions still to come.
- **12 new curated `qa.json` entries** (21 -> 23 total, since one requested question
  --the wilderness-years one-- already existed and just got the user's literal phrasing
  added as an `alt_phrasing`), each verified against real bundled text before writing
  (scripture directly, or the actual bundled Matthew Henry/JFB commentary text read via
  a temporary research probe test, not from memory): how many times the Israelites
  rebelled (`israelites_rebellion_count` -- Numbers 14:22 literally says "these ten
  times"), Jonah's three days and three nights in the fish (`jonah_in_the_fish`), an
  honest no-total-given answer for Old Testament miracle counts
  (`old_testament_miracles_count`, same discipline as the existing Jesus-miracles
  entry), God speaking audibly (`god_speaks_audibly`, the one `commentary_opinion`
  entry), Old Testament prophet counts (`old_testament_prophets_count`, clearly
  labeling the Talmudic 48+7 tradition as Jewish tradition, not scripture, alongside
  the firmer fact of 17 prophetic books), a "Who was Moses?" biography
  (`who_was_moses`), the purpose of salvation (`purpose_of_salvation`), how to be saved
  (`how_to_be_saved`), what eternal life is and how to get it (`what_is_eternal_life`,
  `how_to_get_eternal_life`), the Ten Commandments listed in full
  (`ten_commandments_list`), and the new *and* old covenants
  (`what_is_the_new_covenant`, `what_is_the_old_covenant`). All soteriology-adjacent
  entries (salvation/eternal life) were deliberately kept to the New Testament's own
  most-repeated, cross-tradition-shared statements (Ephesians 2:8-10, Romans 10:9-13,
  John 3:16, John 17:3, Romans 6:23) rather than wading into genuinely disputed
  doctrine (baptism's role, perseverance, etc.); each of those entries' `note` field
  says so explicitly and points to the Commentaries tab for denominationally varied
  fuller treatment, rather than this app picking a side.
- **A judgment call, not fixed, worth knowing about**: "what is the meaning of life"
  (a deliberately vague, unrelated control question in the smoke test) now matches the
  new `what_is_eternal_life` entry at 0.68 similarity, where it previously fell to
  Fallback. Left as-is: in a Bible app specifically, redirecting that question to
  scripture's own definition of eternal life is a defensible reading, not obviously
  wrong, and the existing "matched by meaning, not your exact wording... closest
  curated question was X" disclosure means the user always sees exactly what actually
  matched rather than being told this silently. Revisit if it turns out to feel wrong
  in practice.
- **Re-verified with the same backend-only smoke-test harness** (still no
  browser-automation tool available): `cargo test` now runs **19 tests** (18
  `qa_parser` + this one smoke test covering all of the above plus a deliberate
  false-positive sweep of near-neighbor questions -- "who was Aaron?", "what is
  grace?", "what is baptism?", "how do you pray?" -- confirming they still correctly
  fall to Fallback rather than getting swept into an unrelated curated entry). `cargo
  check` and `tsc --noEmit` both clean. `index_qa` re-run twice (202 embedded rows
  now, up from 157). The Tauri dev server crashed once mid-session with `os error 32`
  (file in use) while loading `model.safetensors` -- a transient Windows file-lock race
  from several rapid successive saves triggering the dev watcher's rebuild-and-relaunch
  faster than the outgoing process instance released its handle, not a real bug;
  restarting `npm run tauri dev` cleared it immediately. **The actual UI still hasn't
  been clicked through by a human as of this note** -- the user was mid-testing when
  this round of fixes went in; next step is them re-testing against the restarted dev
  instance.

**Phase 12, third round, same overall feature (2026-09-26 -- still v2.0.1, no
installer built): user supplied `public/FAQ.txt`, a 100-question Bible/Christianity
FAQ (questions + answers + scripture references), asking it be checked against the
bundled data and incorporated.** `qa.json` grew from 34 to 133 entries (the count was
stated as "23 to 122" in an earlier version of this note -- that was a miscount, the
file has 133 entries with unique ids); `qa_index.json` from 202 to 494 embedded rows.

- **The document was AI-generated** (its own footer says so: "AI responses may
  include mistakes") **and checking it, not just importing it, turned up real
  errors**, exactly validating why the user asked for it to be checked rather than
  copied in directly:
  - Question 12 ("Is God male or a genderless spirit?") cited Luke 24:39 as support --
    that verse is Jesus proving to the disciples He isn't a ghost after the
    resurrection, entirely unrelated to God's gender. Dropped; kept John 4:24 ("God
    is spirit") and Matthew 6:9, which actually support the answer.
  - Question 2 (the Trinity) cited "Peter 1:2," not a real citation format (missing
    which epistle) -- corrected to 1 Peter 1:2, the verse that actually fits the
    Trinitarian formula being cited (grace and peace from Father, Son, and Spirit).
  - Question 96 (therapist/psychiatrist) cited "Protestants 11:14" -- **not a real
    book of the Bible** (probably a garbled autocomplete of "Proverbs 11:14," which
    fits the "seek godly counsel" point the answer was making) -- corrected, and the
    correction is noted openly in that entry's own `note` field rather than silently
    fixed and forgotten.
  - Question 38 (pets in heaven) cited Revelation 19:11 (Christ returning on a white
    horse) for "animal life in the New Earth" -- unrelated; replaced with Isaiah
    65:25, which actually describes animal life in restored creation.
- **A much bigger issue than citation typos: a large fraction of these 100 questions
  touch genuinely, sincerely disputed Christian doctrine, and the source FAQ answered
  nearly all of them in one confident voice with no indication that serious,
  Bible-believing Christians disagree.** Most seriously: the entire "Prophecy and End
  Times" category (Rapture, Antichrist, Mark of the Beast, Tribulation, Millennium,
  Armageddon, Great White Throne) was written entirely from a **dispensational
  premillennialist** framework -- the specific eschatology popularized by the Scofield
  Reference Bible and "Left Behind"-style evangelicalism -- stated as if it were the
  Bible's own plain, uncontested teaching. It is one major framework among several
  (amillennialism, historic premillennialism, postmillennialism, preterism) held
  across huge swaths of the global church, including most historic Catholic, Orthodox,
  and Reformed/Lutheran theology. Presenting it unqualified as *the* answer would have
  meant this app taking an unrequested denominational stance on the user's behalf.
  Every one of those entries was rewritten before being added: reclassified from
  `stated`/flat assertion down to `confidence: "traditional"`, named explicitly as one
  interpretive framework, and given a one-line pointer to what the major alternative
  readings hold. The same treatment was applied to: eternal security/"once saved
  always saved" (Calvinist vs. Arminian -- both positions' key texts are cited),
  baptism's role in salvation, predestination, purgatory, transubstantiation, women as
  pastors/elders, and whether Jehovah's Witnesses/Mormons count as Christian --
  **every one of these now presents the range of serious Christian positions and the
  texts each side actually cites, rather than asserting a single answer.** A smaller
  set of genuinely fact-adjacent-but-speculative claims were also walked back from
  the FAQ's flat assertions to honestly hedged ones: the identification of Isaiah 14's
  "Lucifer" and Ezekiel 28's oracle with Satan (a long-standing *interpretive
  tradition*, not a passage that names Satan -- both are addressed to human kings in
  their immediate context), Job's Behemoth/Leviathan as literal dinosaurs (one YEC
  apologetic reading among several -- many scholars read them as a hippo/crocodile or
  poetic chaos-imagery), and the "no genetic risk" reasoning for Cain marrying a
  sister/close relative (a modern apologetic argument, not a scriptural claim).
  Questions never directly named in scripture at all (masturbation, gambling, tattoos)
  were marked `unattested`/`traditional` rather than `stated`, with the answer
  explicit that this is an *application* of adjacent principles, not a direct verse.
  **This is the single largest editorial pass this feature has had, and it reflects
  real judgment calls, not mechanical fact-checking -- if the user wants a different
  framing on any of these (e.g. they hold a specific eschatological or denominational
  position they *do* want this app to state as settled), that's a easy, welcome
  correction to make on a per-entry basis, not a redesign.**
- **One duplicate avoided, not created**: FAQ Question 26 ("What must I do to be
  saved?") is the same question as the already-existing `how_to_be_saved` entry from
  the prior round -- added as an `alt_phrasing` there instead of a second entry (and
  confirmed by the verification sweep below: it now matches `how_to_be_saved` at 0.98
  similarity rather than creating a competing answer).
- **Verified with the same backend-only harness**: content written and validated in
  three batches (JSON re-parsed and `ask_question_smoke` re-run after each, so a
  syntax error in a late batch couldn't silently invalidate earlier work), then a
  dedicated false-positive sweep specifically targeting the highest-collision-risk
  content -- the tightly-clustered end-times block (Rapture/Antichrist/Tribulation/
  Millennium/Armageddon all share heavy vocabulary) and the salvation block
  (salvation/baptism/predestination/lost-salvation all share "saved") -- deliberately
  asking each one's question in isolation to confirm it resolves to *its own* entry,
  not a neighbor's. **Every single one resolved correctly**, with strong similarity
  margins (0.66-0.99); no new false positives were found in this round, unlike the
  "prodigal son" and old/new-covenant collisions found in the prior round. `cargo
  test` still passes (same 19 tests -- this was a content-only change, no new logic).
  `index_qa` re-run once more (494 embedded rows, up from 202). **The UI itself is
  still unclicked by a human as of this note.**

**Phase 12, fourth round (2026-09-26 -- still v2.0.1, no installer built): the user
set the house doctrinal lens, and the answers were rewritten to it.** After reviewing
the list of FAQ answers that had been reworded, the user said: *"it is not about
offending one or another group but rather about being true to the scriptures... i stand
close to the viewpoint of pentecostal, blood bought, reborn, rapture believing
christian faith and the app should present this viewpoint more prominently... but
based on scripture alone... scripture first then pentecostal belief or interpretation
then the rest."* This reverses the round-three approach for those entries (which had
presented the range of views with the dispensational/eschatological positions
labeled as one view among several). **This is now a standing editorial rule for the
whole Q&A feature -- see the "doctrinal lens" memory and follow it for every new entry:
(1) what scripture itself states, with verses; (2) the Pentecostal / blood-bought /
born-again / rapture-believing reading, labeled as that reading; (3) other views (Catholic,
Reformed, amillennial, cessationist...) kept briefly, never deleted.**

- **New confidence tier `doctrinal_view`** (`qa.rs` `QaConfidence::DoctrinalView`,
  `api.ts`, `AskAnswerView.tsx` badge text "Scripture first, then the Pentecostal /
  evangelical reading", `App.css` warm badge). It exists so the Pentecostal reading is
  honestly *labeled as a reading* rather than shown under a "Stated in scripture" or
  "Traditional / scholarly consensus" badge (the latter would have been inaccurate for
  it). The earlier standing rule -- opinions are noted as opinions -- is unchanged;
  what changed is whose view leads. `.curated-answer-text` also gained
  `white-space: pre-line` so the three parts ("Scripture: ... / Pentecostal / evangelical
  understanding: ... / Other views: ...") show as separate paragraphs.
- **32 entries rewritten** (31 spliced from a scratch file by id, plus a small
  alt-phrasing edit): the whole end-times block now leads with the pre-tribulation,
  premillennial reading (`faq_rapture`, `faq_christians_in_tribulation`,
  `faq_end_times_signs`, `faq_antichrist`, `faq_mark_of_beast`, `faq_tribulation`,
  `faq_millennial_kingdom`, `faq_armageddon`, `faq_great_white_throne` -- which now also
  covers the Judgment Seat of Christ as a separate judgment); plus
  `faq_tongues_required` (now presents Spirit baptism with tongues as initial evidence
  vs. the ministry gift of 1 Cor 12, and carries the alt phrasings "what is the baptism
  in the holy spirit" so that question has an answer), `faq_god_still_heals_today`
  (divine healing continues today; cessationism as the other view; scripture's own
  honest counter-examples -- Paul's thorn, Timothy, Trophimus -- kept), 
  `faq_christian_demon_possession` (oppression, not possession), `faq_alcohol` (total
  abstinence as the Pentecostal/holiness teaching, with the honest scripture point that
  it condemns drunkenness rather than every drink), `faq_tithe_10_percent` (the tithe as
  the baseline; Abraham pre-Law, Jesus in Matt 23:23), `faq_tattoos`,
  `faq_homosexuality` (the scripture stated plainly, with the gospel hope of 1 Cor 6:11;
  the revisionist reading now one short "other views" sentence), `faq_divorce_permitted`,
  `faq_hell_real_literal` (eternal conscious punishment; annihilationism as other view),
  `faq_purgatory` / `faq_transubstantiation` / `faq_protestant_catholic_differences` /
  `faq_church_ordinances` / `faq_apocrypha_excluded` (scripture, then the evangelical
  view with the blood of Christ emphasized, then Catholic teaching -- retained, not
  removed), `faq_jw_mormons_christian`, `faq_bible_evolution` (special creation),
  `faq_satan_origin_fall` (Isaiah 14 / Ezekiel 28 as also describing Satan's fall,
  with the in-context note that they address human kings kept as scripture's own
  context), `faq_baptism_required_for_salvation`, `faq_predestination`,
  `faq_can_lose_salvation`, `faq_women_pastors_elders`, and the earlier
  `how_to_be_saved`, which now carries the born-again (John 3), redemption-by-the-blood
  (1 Pet 1:18-19, Eph 1:7) and Spirit-baptism emphasis and answers "how do you become
  born again".
- **RESOLVED afterwards -- the user answered all three questions below (see the next
  bullet block, "Fifth round"); the paragraph that follows records what was originally
  flagged and is kept only for the history.** **Where Pentecostals are themselves
  divided -- originally not resolved by the assistant, flagged to the user to decide:** eternal vs. conditional security
  (`faq_can_lose_salvation` states both), whether women may be pastors/elders
  (`faq_women_pastors_elders`; the Assemblies of God ordains women, others reserve the
  office for men), and Trinitarian vs. Oneness (`faq_trinity` was left as the
  historic Trinitarian formulation, unchanged; Oneness Pentecostals reject it -- the
  baptism entry names Oneness only as a group holding baptism is necessary). The
  earth-age and Genesis-days entries were also left as the two-view answers they
  already were, because Pentecostal churches don't share one position on them. The
  memory rule says: never assert a denomination's official position that isn't certain;
  "many Pentecostal churches" is the hedge.
- **Quotation caveat found while doing this, NOT yet fixed:** many curated answers
  (most of the entries from before this round) quote verse wording that is NIV/ESV-
  flavored, not the bundled BSB (public domain) or KJV. The new/rewritten entries lean
  on BSB wording and paraphrase, but the older ones weren't converted. Given the user's
  earlier concern about ESV/NIV copyright, a follow-up pass that replaces those quotes
  with BSB text pulled from `bible.db` is worth doing; offered to the user, not started.
- **Verified with the same backend-only harness:** `qa.json` parses (133 entries, unique
  ids, every `confidence` value a known variant); `index_qa` re-run (499 rows);
  `cargo test` 19 passing; `tsc --noEmit` clean; and a fresh sweep confirmed "what is the
  baptism in the holy spirit" and "is speaking in tongues the evidence of the holy
  spirit" resolve to the tongues entry (not water baptism), the rapture/tribulation
  cluster still resolves to distinct entries, "what does it mean to be born again"
  reaches `how_to_be_saved`, and "what is the judgment seat of christ" reaches the
  Great White Throne entry after its alt phrasings were added. Two natural questions
  still have no dedicated entry and fall to the labeled fallback -- "is the blood of
  Jesus enough to save me" (a "blood-bought" entry would be a natural addition) -- and
  are offered to the user. **The UI has still not been clicked through by a human.**

**Phase 12, fifth round (2026-09-26 -- still v2.0.1, no installer built): the user
answered the three open questions, and the blood-of-Jesus entry was added.** In the
user's words, in summary (the durable version is in the "doctrinal lens" memory):
- **Security: conditional.** Salvation is a free gift bought by the death and blood of
  Christ, but "not a get out of jail free card" -- a reborn person is a new creation who
  strives to live a new life, and one who returns to the old ways and keeps living as
  before (lukewarm, Rev 3:15-16: "better you are hot or cold") is at risk. Not "without
  a changed heart and trying to live a new life." `faq_can_lose_salvation` was rewritten
  to lead with this (scripture: 2 Cor 5:17, Titus 2:11-12, Rom 6:1-2, Heb 10:26,
  John 15:1-6, Matt 7:21, Heb 12:14, Rev 3:15-16, 2 Pet 2:20-22, balanced by 1 John 1:9 /
  2:1 forgiveness for the believer who stumbles and John 10:27-29 / Rom 8:38-39 on
  Christ's keeping), with eternal security now under "other views."
- **Women: yes**, as elders, pastors and leaders. `faq_women_pastors_elders` now leads
  with the scripture's women in leadership (Miriam, Deborah, Huldah, Anna, Mary
  Magdalene, Philip's daughters, Phoebe, Priscilla, Euodia/Syntyche, Joel 2 / Acts 2,
  Gal 3:28), notes headship in the home (Eph 5:23, 1 Cor 11:3) and the strong wife
  (Prov 31, 14:1) -- the user's point that headship in the home and calling in the church
  are separate questions -- reads 1 Tim 2:12 / 3:2 / 1 Cor 14:34-35 as addressing
  specific first-century situations, and moves the complementarian reading to "other
  views." Junia (Rom 16:7) was deliberately left out of the scripture list: whether she is
  "among the apostles" or merely "known to them" is itself disputed.
- **Trinity: yes -- three in one.** `faq_trinity` was rewritten (scripture first:
  Deut 6:4, Isa 45:5, Matt 28:19 "name" singular, Matt 3:16-17 all three at the baptism,
  John 14:16-17, John 1:1, Acts 5:3-4). The user's clock-gears picture is kept. **One
  deliberate addition the user did not ask for:** the entry adds that the picture falls
  short in one respect -- scripture presents Father, Son and Spirit as each fully God
  (Col 2:9, Acts 5:3-4) and shows all three at once, so they are three persons in one
  God rather than one person "known by three roles" (which is the Oneness position,
  now listed under "other views"). The user described it as "three different roles";
  that phrase was rendered as "three persons with different roles and functions," and
  the user was told, so it can be reverted if they disagree.
- **Trinity, second pass (same day):** the user asked that the entry say the concept is
  a mystery our minds cannot fully grasp ("the three is one and the one is three"), that
  the three are one and the same being and so know each other's mind exactly, and that
  the one God takes up three roles in three persons (Father, Son, Holy Spirit) -- which
  matches the "three persons" wording already used. `faq_trinity` now cites the unity of
  mind (John 10:30, 14:9-11, 16:13-15; 1 Cor 2:10-11) and God being beyond our full
  understanding (Isa 55:8-9; Rom 11:33-34). I raised Mark 13:32 ("nor the Son" does not
  know the day or hour) as the obvious objection to "all know each other's mind exactly",
  and first answered it with the kenosis reading (Phil 2:7). **The user corrected that:**
  the Son does know -- it was *withheld from us*, "it is meant for us not to know," and
  "Jesus spoke a lot in parables" (Acts 1:7; Matt 13:10-17, 34-35). That is now the lead
  reading in the entry (an old view -- Augustine held it), with the kenosis reading kept
  only as one sentence under "other views." `faq_cant_predict_return_date` still just
  quotes Matt 24:36 / Mark 13:32 as scripture with no gloss; add the same clarification
  there if the user wants it.
- **New entry `blood_of_jesus`** ("What does the blood of Jesus do?", with alt phrasings
  including "is the blood of jesus enough to save me", "what does blood bought mean"):
  the blood bought us (Acts 20:28, 1 Cor 6:20, 1 Pet 1:18-19, Rev 5:9), washed away sin
  (1 John 1:7, Eph 1:7, Rev 7:14), is God's appointed payment (Heb 9:22, Lev 17:11,
  Ex 12:13), justifies and gives access (Rom 5:9, Col 1:20, Heb 10:19), and overcomes the
  accuser (Rev 12:11); the Pentecostal paragraph ties it to the new life ("bought with a
  price, so we belong to Him") and to Heb 10:26-29, matching the user's "not a free
  pass" position. The entry count is now **134**; `qa_index.json` is **509** rows.
- **Two related entries changed for consistency**, not asked for by the user:
  `faq_why_christians_still_sin` (new birth as a real change, striving with the Spirit's
  power, stumbling-and-repenting vs. returning to the old ways) and
  `faq_suicide_and_heaven` (it had leaned on the eternal-security proof texts; now
  scripture-first -- the Bible records suicides and never calls it the unforgivable sin;
  God alone sees the heart -- and it ends with a short "please tell someone" care line
  for a reader who may be at risk).
- **Verified (backend-only harness, UI still unclicked):** 134 entries parse with unique
  ids; `index_qa` re-run; the ten new probe questions resolve to the right entries
  ("what does blood bought mean" / "is the blood of jesus enough to save me" ->
  `blood_of_jesus`; "is salvation a get out of jail free card" and "can a christian sin
  and still go to heaven" -> `faq_can_lose_salvation` at 0.60/0.66, just above the 0.6
  threshold); `cargo test` 19 passing; `cargo check` and `tsc --noEmit` clean.
- **Still open:** the older quoted verse wording (NIV/ESV-flavored) has not been
  converted to BSB. And **the user is working on a new splash screen** -- do not touch
  the splash/closing-splash components (`SplashScreen.tsx`, `ClosingSplash.tsx`) without
  checking first, and remember `tauri dev` auto-rebuilds on every save.

**Phase 13 (video launch splash, 2026-09-26 -- still v2.0.1, no installer built): the
user added `public/Video Project 1.mp4` (5 s, 1920x1080, H.264, ~8 MB) to replace the
opening splash image and asked that it run for its full length when the app opens.**
`SplashScreen.tsx` now plays that video instead of showing `splashscreen.jpg`; the
farewell `ClosingSplash.tsx` is untouched.
- **Behavior:** the video plays to its natural end (the `ended` event -- there is no fixed
  timer and no skip), then the existing 400 ms fade reveals the app. It is **always played
  muted**: the file carries an audio track (video editors add a silent one) but the user
  said the splash should just be a video with no sound. Muting also means WebView2's
  autoplay policy can never block it. Shown with `object-fit: contain` on the black ground,
  so a non-16:9 window letterboxes instead of cropping the clip.
- **Two deliberate robustness choices, both because this could not be watched from here:**
  (1) the clip's `moov` index is at the END of the file (not a "fast-start" MP4), which
  needs byte-range support to play from a normal URL, so the component fetches the file
  whole and plays it from a blob URL -- independent of whether Tauri's embedded-asset
  server answers range requests; (2) fail-safes so a bad video can never strand the user on
  black: an error or a rejected `play()` finishes the splash at once, no `playing` event
  within 6 s finishes it, and once playing, no `ended` within duration + 2.5 s finishes it.
- **Fixed a latent bug in the same component:** the old splash's timers were an effect
  keyed on the `onDone` prop, and `App.tsx` passes a fresh inline function every render, so
  any App re-render during the splash restarted the timers and lengthened it. `onDone` is
  now read through a ref and the effects run once. (Not visible with a 2.6 s image, but it
  would have restarted a video mid-play.)
- **Filename note:** the file keeps the user's own name, `Video Project 1.mp4`, referenced
  via `encodeURI`; Tauri percent-decodes asset paths (`protocol/tauri.rs`), so the space is
  fine. Re-exporting a new clip over the same name in `public/` replaces the splash. The
  old `public/splashscreen.jpg` was left unused, and `public/FAQ.txt` shipped although
  nothing reads it -- both dealt with in Phase 14c (deleted / moved to
  `data-pipeline/qa_sources/`).
- **First test: "there was no video playback" -- root cause found, and it was NOT the
  video or the component; it was the Vite dev server.** The failsafes had turned a broken
  video into a silent skip, so diagnostic `console.warn` logging was added (Vite forwards
  it to the terminal). The log showed: `canPlayType H.264+AAC: "probably"` (the codec is
  fine), `fetch 200 video/mp4 8379200` (the file was found and its headers arrived) -- and
  then no body, until the 6 s "never started playing" failsafe fired. Isolating it:
  the file reads from the `X:` project drive in 0.08 s in PowerShell, and a bare Node
  server streams it from `X:` in 0.2 s, but the Vite dev server took **~37 s (0.2 MB/s)**
  (a bigger `UV_THREADPOOL_SIZE` helped only partly). Cause: `vite.config.ts` polls every
  watched file every 300 ms (SMB can't deliver change notifications), and the watched tree
  included `public/chart` (1,505 map tiles) plus its 1,528-file copy in `dist/` -- roughly
  10,000 `stat()` calls a second over the share, starving every real read on the same
  connection. **Fix: `watch.ignored` now also excludes `dist/`, `installer/`, `check/` and
  `public/chart/`** (none change during development). After the change the same 8 MB
  download from the dev server takes **0.05 s**. This is a dev-server-only problem: an
  installed app serves the video from memory. **General lesson: a "slow static file" from
  the dev server on this SMB drive means the watcher, not the file** -- and it also makes
  every dev page load and HMR update faster.
- **The splash now shows why it failed:** if the video can't play, it prints "The launch
  video could not be played (<reason>)." on the black splash for 4 s and then opens the app
  (`.splash-failure`), because the console is invisible in an installed build. Never shown
  when the video plays. The diagnostic `[splash]` `console.warn` lines were left in at
  first; since Phase 14c only early endings are logged, and only in dev builds.
- **Installer for the user to test the installed path:** built with `npm run tauri build`
  at version 2.0.1 (no bump was requested); the copies in `installer/` carry a
  `-videotest` suffix so the existing 22 Sept `2.0.1` installers (built before
  Ask-a-question) are not overwritten. Because the version is unchanged, use the `.exe`
  (NSIS); the `.msi` may refuse a same-version install. **The user installed it and
  confirmed: "video played perfectly on the splash opener."** The installed (embedded-asset)
  path therefore works, and the earlier failure really was only the dev server.
- **Version bumped `2.0.1` -> `2.1.0`** (a minor bump: Ask-a-question, the Pentecostal-lens
  answer set and the video splash are new feature scope) in the four usual places --
  `package.json`, `package-lock.json` (via `npm version 2.1.0 --no-git-tag-version`),
  `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` -- plus `Cargo.lock` (refreshed by
  `cargo check`). **No 2.1.0 installer has been built yet**: the only installer from this
  code is the `2.0.1-videotest` pair in `installer/` (untracked, gitignored); build a
  proper `2.1.0` one with `npm run tauri build` when wanted and copy it into `installer/`.
- **`check/` is now in `.gitignore`.** That folder holds the user's downloaded ESV/NIV/
  Amplified PDFs (kept only for the earlier licensing check) and was sitting untracked in
  the working tree; it is copyrighted and must never be pushed to this public repo. Stage
  files by name -- never `git add -A` -- in this repo.
- **Verified:** `tsc --noEmit` clean; `npm run build` copies the video into `dist/`
  (7.99 MB) while still excluding the 218 MB Adams chart scan; dev-server download
  timing as above. **Playback itself has still not been seen by a human.** Watch for: it
  starts promptly, plays all 5 s with no sound, and the app appears right after it ends.
  The installer grows by about 8 MB.

**Phase 14 (study-tool gap-filling after a competitive review, 2026-09-26 -- code still at
v2.1.0, not yet version-bumped, committed or built into an installer):** the user asked for
a comparison against Logos, Accordance, e-Sword, theWord, Blue Letter Bible, STEP Bible,
Olive Tree and YouVersion, then approved **all** the recommended features and fixes except
audio Bible reading ("hold off on the bible reading part (audio)"). Built:

- **Personal study data** -- notes, highlights (5 colours), bookmarks and reading-plan
  progress, in a new writable `userdata.db` in the per-user app data folder
  (`%APPDATA%\com.local.bibleconcordance\`, beside settings.json -- never the install folder,
  so it survives reinstalls). Backend `userdata.rs` + `study_commands.rs`; each verse has a
  new "⋯" menu (Interlinear, Topics, Bookmark, Add/Edit note, Copy verse, highlight swatches)
  and shows bookmark/note markers inline; notes are edited in place under the verse. New
  top-bar **My Study** panel (`StudyPanel.tsx`): tabs for notes/highlights/bookmarks (with
  filter) and reading plans; **Export** writes `Documents\Bible Concordance\Bible study
  notes <date>.md` (readable) + `.json` (backup) and reveals it in Explorer; **Import backup**
  merges a .json back (never deletes; a note is only overwritten by a *newer* copy).
  Highlight colours are validated server-side (they become CSS class names).
- **Reading plans** (`readingPlans.ts`): Bible in a year, NT in 90 days, Gospels in 30
  days, Psalms & Proverbs in a month -- generated from the bundled chapter list, so only
  progress is stored. **Home screen** now shows a **verse of the day** (`dailyVerse.ts`, 160
  well-known verses, all checked to exist in the BSB; text read live from bible.db) and
  **today's reading** for each active plan.
- **Copy/export**: copy verse (with reference + translation), copy chapter, copy a curated
  answer or dictionary entry.
- **Reading comfort** (Settings): text size, line spacing, page width (localStorage, applied
  as CSS vars `--reader-scale` / `--reader-line-height` / `data-reading-width`), plus **Focus
  mode** (top-bar button or F11; full screen, no sidebar/panels; Esc leaves) -- needed the new
  capability `core:window:allow-set-fullscreen`.
- **Interlinear with grammar** (`InterlinearPanel.tsx`, `study.rs`): every word of a verse
  in Hebrew/Greek with transliteration, English gloss, dictionary form + meaning, Strong's
  (links to Word Study) and a plain-English parsing ("Verb Aorist Active Indicative 3rd
  Singular"; hover for the full breakdown). Greek has a Critical text / Textus Receptus /
  Show all switch (TAGNT marks each word's editions), Hebrew lays out right-to-left and
  flags ketiv/qere. Data: **STEPBible TAHOT/TAGNT + TEHMC/TEGMC, CC BY 4.0** (attribution is
  in Settings > About, the credits list and NOTICE.md -- required by the licence).
- **Second Greek NT reading text: THGNT** (Tyndale House Greek New Testament 2017, CC BY-SA
  4.0), added to bible.db as version `THGNT` with Strong's links, assembled from TAGNT's
  "Tyn" edition marks. **Deliberately not SBLGNT** (its own EULA, not an open licence) and
  **not NA28** (commercially licensed). 7,932 verses vs the TR's 7,957 -- the 25 missing are
  verses the critical editions omit (e.g. Matt 17:21), not missing data.
- **Bible dictionaries & topical indexes** (`DictionaryPanel.tsx`): Easton's (3,963 entries),
  Smith's (4,639), Nave's Topical (5,322), Torrey's Topical (628) -- all public domain, from
  CrossWire SWORD modules, parsed by a small reader of our own (`data-pipeline/
  sword_lexdict.py`: RawLD/RawLD4/zLD; Smith's/Torrey's are Latin-1, the others UTF-8).
  Bodies are stored as plain text with `⟦Book|ch|v|v_end|label⟧` reference markers (never
  HTML) rendered as links by `RichText.tsx`. 147,319 verse->entry links power **"Topics &
  dictionary for this verse"** (e.g. 19 Nave's/Torrey's/Easton's topics cite John 3:16).
- **Ask a question now answers who/what questions from the dictionaries** (new
  `AskAnswer::Dictionary` / `kind: "dictionary"`): "who was Aaron?", "what is grace?",
  "what does selah mean?", "what does the Bible say about prayer?" get the entry, badged
  "From Easton's Bible Dictionary (1897) -- a reference work, not scripture". Precedence
  rules, all in `ask_question_query`: exact curated match first; then a dictionary entry for
  the question's exact subject beats a merely *similar* curated answer (semantic score below
  `ASK_DICTIONARY_OVERRIDE = 0.8` -- "prayer" had matched "Can our prayers change God's
  mind?"); **but never over a `doctrinal_view` (house-lens) curated answer**. Plain "what is
  baptism?" now reaches the water-baptism entry (new alt phrasings) instead of the tongues
  entry.
- **Commentary balance**: added **John Wesley's Explanatory Notes (1754-65)** -- 16,710
  notes, Wesleyan-Arminian, matching the user's conditional-security/holiness view and the
  tradition Pentecostalism grew from -- and the **Scofield Reference Notes (1917)** -- 3,207
  notes, dispensational/pre-tribulation, matching the end-times lens. Both public domain,
  SWORD zCom modules read by `sword_commentary.py` (versification checked slot-for-slot:
  OT 24,115, NT 8,246). Nine commentaries total now. Pentecostal-authored commentaries are
  post-1929 and still under copyright, so none were bundled.
- **BSB quotations**: `data-pipeline/audit_qa_quotes.py` checked all 189 quotations in
  qa.json against the BSB text of the verse each cites; 100 were NIV/ESV-style wording and
  were replaced with BSB wording (automatic word alignment + 31 hand-checked overrides in
  the script's `OVERRIDES`, verified against bible.db), then 7 sentences re-worded around
  their new quotes. A re-run reports 0 non-BSB quotations. **Run it after adding any curated
  entry.** (It rewrote qa.json with Python's json formatting, hence a large diff.)

**New data-pipeline scripts** (sources download to `%LOCALAPPDATA%\bible-concordance-build\
study-src`, nothing large is committed): `build_study.py` -> `resources/study.db` (80 MB,
**gitignored** like bible.db); `add_thgnt.py` -> adds THGNT to bible.db; 
`add_sword_commentaries.py` -> adds Wesley + Scofield to commentaries.db; helpers
`refs.py` (reference parsing: OSIS/STEP/free-text book names, carried-forward chapter
lists), `sword_lexdict.py`, `sword_commentary.py`; `audit_qa_quotes.py`. All three builders
work on a **local-disk copy and copy back only after `PRAGMA integrity_check` = ok**
(gotcha #1); originals were backed up once to `bible.db.before-thgnt` /
`commentaries.db.before-sword` in the same build folder. **On a fresh clone, run
build_study.py, add_thgnt.py and add_sword_commentaries.py after the usual database build.**

**Gotchas found this phase:** (1) STEPBible writes some Greek accents in the Greek Extended
block (U+1F71 alpha-with-oxia) where standard text uses the canonically equivalent tonos
(U+03AC) -- identical on screen, unequal in comparisons. build_study.py NFC-normalizes all
Greek (not Hebrew, where NFC can reorder points). A unit test caught it. (2) STEP's default
branch isn't `master` -- use the GitHub API's `download_url`. (3) Re-running add_thgnt.py
leaves ~2 MB of free pages in bible.db each time; not vacuumed on purpose (VACUUM could
renumber rowids the vec0/FTS tables depend on).

**Verified (backend + build only):** 25 Rust unit tests pass (5 new study tests: John 3:16
grammar/editions, Hebrew morpheme expansion, crasis words, dictionary search/topics,
snippet markers; 1 new userdata test: full bookmark/highlight/note/plan round trip through
export -> fresh db -> import, colour validation, empty-note deletion); the Ask smoke test
routes every question as intended (listed above); `cargo check` and `tsc --noEmit` clean;
the dev app launches with no errors and creates userdata.db. **None of the new screens
have been clicked through by a human yet.**

**Phase 14b (same day, after the user's first look):**

- **Help & user guide** (`HelpPanel.tsx`, Settings -> "Help & user guide"): searchable,
  one collapsible section per feature. **Keep it up to date when adding features.**
- **Highlight colours**: 11 now -- the 5 soft ones plus 6 bright (`lemon`, `lime`, `sky`,
  `rose`, `red`, `violet`), shown as two rows in the ⋯ menu. The list lives in *two* places
  that must match: `HIGHLIGHT_COLORS` in `userdata.rs` (server-side validation; they become
  CSS class names) and `api.ts`.
- **Jump-to-verse flash**: the target verse glows light blue for ~3 s
  (`.verse-row--target`, `verse-target-flash` keyframes).
- **The app starts maximized** (`"maximized": true` in tauri.conf.json). The user said
  "always start fullscreen"; true full screen (no title bar/taskbar) is what Focus mode/F11
  does, and starting in it would hide the window controls, so maximized was chosen.
- **Study sheet builder** (`StudySheetPanel.tsx`, `studySheet.ts`, Rust `sheet.rs`): from a
  verse's ⋯ -> "Prepare study sheet…" or the chapter title's "Study sheet" button. Pick the
  verse range, 1-3 translations, N strongest cross references (with their text, via the new
  `passage_text` command), key Hebrew/Greek words (content words from the interlinear,
  deduped by Strong's, max 15), the reader's notes/highlights, Nave's/Torrey's topics, any
  commentaries (labelled as opinion), blank lines. The sheet is one flat `SheetBlock[]` list
  (title/subtitle/heading/subheading/para/quote/lines) that drives all four outputs: the
  preview and **Print/PDF** (an inline-styled copy is appended to `<body>` as
  `#sheet-print-root`; `body.printing-sheet` print rules hide everything else; removed on
  `afterprint`), **Copy** (`copyRich`: ClipboardItem with text/html + text/plain, so Word
  keeps headings/bold), **Plain text**, and **Save as Word** (`save_study_sheet` -> docx-rs
  0.4 with `default-features = false` so no `image` crate; writes
  `Documents\Bible Concordance\<title>.docx`, adds " (2)" rather than overwrite, reveals it).
  Option choices persist in localStorage (`studySheet:prefs`). Verified: unit test builds a
  real .docx and checks no-overwrite; a sample opened in Word via COM (11 paragraphs, Segoe
  UI title at 18 pt). `cargo test sheet::tests::sample -- --ignored` with
  `SHEET_SAMPLE_DIR` set writes one to inspect.
- **Copy buttons** everywhere text is worth taking elsewhere: each commentary section, each
  cross reference (full range text) plus "copy all", each My Study item (verse + note).
  Shared `components/CopyButton.tsx` (text may be a lazy async function).

**Phase 14c (same day; the user tested 14/14b and found everything working):**

- **Red-letter text** (words of Jesus): `data-pipeline/build_red_letter.py` ->
  `src/redLetter.json` (200 KB, committed; loaded lazily by `src/redLetter.ts` as its own
  chunk). Only the KJV (`<q who="Jesus">`, 2,035 spans, each inside one verse) and WEB
  (`\wj`) sources mark His words; the script transfers the marking to the other texts:
  ASV/YLT from KJV and BSB from WEB by difflib word alignment (reworded stretches of very
  different length are left unmapped); the BSB is then fitted to its own quotation marks
  (`snap_to_quotes`: narration outside “…” is never red; if Jesus is the only speaker
  quoted in the WEB verse every quote is His; with several speakers each quote goes by its
  aligned words; someone else repeating His words gets only the inner ‘…’ red); TR from
  the KJV's `src` Greek-position attributes, THGNT aligned to TR (accents stripped).
  Stored as **word-index ranges**, not character offsets, because `tidyPunctuation`
  changes character positions before display; a "word" is a maximal letter/digit run in
  both Python (`[^\W_]+`) and TS (`[\p{L}\p{N}]+`). Rendering: `splitRed` splits the
  segments from `segmentVerse` into `.wj` spans without breaking Strong's click targets;
  the colour is pure CSS (`:root[data-red-letter="on"] .wj`), toggled in Settings ->
  Reading comfort ("Words of Jesus", default on, `ReadingPrefs.redLetter`). Study sheets
  carry it too (`SheetRun.red` -> inline colour in HTML, `B0261C` in the .docx).
  **Reviewed by eye** against tricky verses (Matt 26:25, Acts 9:5, John 8:11, 21:17,
  7:36, 8:22, Mark 5:9, Luke 9:55-56...); the script prints the BSB verses that differ
  most from the WEB for review. **Re-run after rebuilding bible.db.**
- **Study basket** ("collect basket"): table `basket` in userdata.db (not in the backup --
  it's a scratch area), commands `basket_list/add/update/remove/clear/reorder`
  (+ unit test). Frontend `src/basket.ts` (add helpers, `useBasket` hook kept current by a
  `basket-changed` window event, `basketSheet` -> SheetBlock[]), `BasketButton.tsx`
  ("Basket" beside Copy on commentary sections, cross refs, dictionary entries, Ask
  answers, My Study items; "Add to study basket" in the verse ⋯ menu), `BasketPanel.tsx`
  (reorder, edit, own text, empty; "Make study sheet" view). Top-bar **Basket** button with
  a count badge. Verse items store `{book, chapter, verseStart, verseEnd, version}` in
  `meta`, so the sheet re-reads the text (with red letters). The print/copy/Word half of
  the study sheet is now the shared `SheetOutput.tsx`.
- **Clean-ups:** `public/FAQ.txt` moved to `data-pipeline/qa_sources/` (no longer shipped);
  unused `public/splashscreen.jpg` deleted; the splash's diagnostic logging now only
  reports early endings, and only in dev builds.

**Phase 14d (same day): read aloud with a natural Kokoro voice.** The user asked for it
using the Kokoro sidecar from their own desktop assistant
(`X:\Code\openui\ghost-claw-v6\kokoro-sidecar`: FastAPI + kokoro-onnx, PyInstaller onefile,
model downloaded on first use). Reused its design; rebuilt it as `voice-sidecar/` because
measuring it showed two one-off delays worth removing:

1. **~65 s to start**: a PyInstaller *onefile* exe unpacks itself to %TEMP% on every
   launch (the model itself loads in <1 s). -> built **--onedir** instead
   (`resources/voice/voice-sidecar/`); the app spawns it itself (no shell plugin, no
   `externalBin`), so a folder is fine. Now ~1.5 s from local disk.
2. **~16 s before the first word of every run**: phonemizer copies `espeak-ng.dll` into a
   new temp folder per wrapper instance and loads each copy -- and the antivirus scans
   every freshly copied DLL (~4 s each; the original loads in 0.00 s). `server.py`
   replaces `EspeakAPI.__init__` to load the DLL once, in place (safe: the server is one
   process with one espeak instance, synthesis under a lock), and does a warm-up synthesis
   before printing `ready <port>`.

Model choice, measured on the dev PC (Ryzen 9 9950X): **fp16** (169 MB) speaks John 3:16
in ~1 s, same as fp32 (310 MB); int8 (88 MB) took 4.6 s -- slower on CPU. Voices trimmed
to the 28 English ones (`make_voices.py`, 14 MB); espeak data trimmed to English (-16 MB).
**`resources/voice/` = 274 MB, gitignored; rebuild with `voice-sidecar\build.ps1`**
(Python 3.12 venv + downloads on local disk, then copies in). Samples of the three model
sizes were written to `Documents\Bible Concordance\voice samples` for the user.

Sidecar protocol: `voice-sidecar.exe --model … --voices … --parent-pid <app pid>`; binds
127.0.0.1 on an OS-chosen port and prints `ready <port>`; `POST /speak {text, voice, speed}`
-> WAV; `GET /health`, `/voices`. It waits on the parent's process handle and exits when
the app dies (crash/kill included); `exit_app` also kills it. Rust `voice.rs`: started on
first use (not at launch -- ~0.5 GB RAM), `voice_status` / `voice_start` / `voice_speak`
(returns raw bytes via `tauri::ipc::Response` -> ArrayBuffer), spawned with
CREATE_NO_WINDOW. Frontend `readAloud.ts` (`ReadAloud` class: verse-by-verse, prefetches
the next two verses, chapter announcement first, falls back to the Web Speech API if the
voice folder is missing or fails), `ReadAloudBar.tsx` (sticky at the bottom of the reading
pane), `.verse-row--reading` highlight, "Listen" by the chapter title and "Listen from
here" in the ⋯ menu, Settings -> Read aloud (voice, speed, "Try this voice"). Default voice
`af_sarah` (the one the user picked in Ghost Claw). English versions only. Navigating away
or changing translation stops reading; "Carry on to the next chapter" (default on)
turns the page itself and continues.

**Follow-up after the user's first test:** (1) **Right-click on selected text** now opens
the app's own menu (`SelectionMenu.tsx`, a window-level `contextmenu` listener that only
takes over when there is a selection outside text boxes): *Listen to selection*, Copy, Add
to study basket, Search. A selection inside the chapter is split at verse rows
(`.verse-row[data-verse]`, verse numbers/markers/buttons stripped from the cloned range) so
it is read verse by verse with highlighting; anything else (commentary, Word Study,
dictionary) is read as prose, split into ~350-character sentence chunks (`chunkText`).
Selection reading never carries on to the next chapter (`readMode` in App). (2) The player
is now a **floating** panel (`position: fixed`, bottom centre by default), draggable by a
grip, position remembered in localStorage (`readAloud:barPos`), double-click the grip to
reset, clamped on window resize.

**v2.2.0 release round (2026-09-26):** 🔊 **Listen** buttons on commentary sections, Word
Study entries, dictionary entries and Ask answers (`ListenButton.tsx` dispatches a
`read-aloud-request` window event -> App's `listenSelection`); in production builds the
browser's own right-click menu (Back/Refresh/Print/Inspect) is suppressed when nothing is
selected (text boxes keep Cut/Copy/Paste; dev builds keep Inspect). `voice.rs` gained an
ignored end-to-end test (`cargo test voice -- --ignored --nocapture`): starts the real
sidecar from `resources/voice`, speaks a verse, checks the WAV -- 6.2 s to ready from the
network share, 0.4 s per verse. Version 2.2.0 in package.json/package-lock, Cargo.toml,
tauri.conf.json; commit `cb2b197` pushed; `npm run tauri build` -> both bundles copied to
`installer/` and SHA-256-verified against the build output: **NSIS 567,102,494 bytes
(541 MB), MSI 641,868,933 bytes (612 MB)** -- +207 MB / +237 MB over 2.1.0, from study.db
(interlinear + dictionaries, 80 MB) and the read-aloud voice (274 MB uncompressed; the fp16
model barely compresses).

The Ghost Claw findings from building this were written up for that project in
`X:\Code\openui\ghost-claw-v6\KOKORO_DELAYS_FINDINGS_2026-09-26.md` (one-file startup,
espeak DLL copies, duplicate sidecars after a start timeout, calibration restarting Kokoro)
and, at the user's request, **applied there** (uncommitted in that repo, for the user to
review): one-folder sidecar in `src-tauri/resources/kokoro-sidecar/`, espeak fix + warm-up,
no duplicate spawns, idempotent `kokoro_start`. Measured: ready 8-14 s from the share (was
~65 s), first reply 0.5 s (was ~17 s).

**Phase 15 (2026-10-05): Library (CrossWire SWORD modules) + Bible pictures.** After a
second competitive review the user chose: install-your-own free modules and downloadable
Bible art, "allow the user to choose and download what they want".

*Library* -- Rust `library/` (`sword.rs` format reader, `markup.rs` OSIS/ThML/GBF/TEI ->
app text with ⟦..⟧ links, `refs.rs` reference parser = port of data-pipeline/refs.py,
`canons.json` = the 18 SWORD versifications exported from pysword by
`data-pipeline/export_canons.py`), `library_commands.rs`, writable `library.db` in the
per-user data folder (modules + lib_verses/lib_comm/lib_dict/lib_book, each with an
external-content FTS5 table; removal issues FTS 'delete' rows first). Catalogue
`crosswire.org/ftpmirror/pub/sword/raw/mods.d.tar.gz` cached a week; modules
`.../packages/rawzip/<Name>.zip`, unpacked to a temp folder, converted, deleted. Installed
Bibles/commentaries/dictionaries are merged into the EXISTING commands (list_versions,
get_chapter*, get_parallel_verse, search_keyword, passage_text, *_commentar*, *_dictionar*)
-- a version code not in bible.db is looked up in the library; commentary/dictionary codes
are prefixed `lib:`; library dictionary entry ids start at 1,000,000,000 (`LIB_ID_BASE`).
Books (RawGenBook) and devotionals (lexicons with Feature=DailyDevotion, keys "MM.DD") are
read in `BookPanel.tsx`; the store is `LibraryPanel.tsx` (Study menu -> Library).
Measured: the real catalogue = 427 modules, 397 installable (126 English), 17 marked
built-in (KJV/ASV/YLT/BSB/WEB/TR/WLC + the commentaries/dictionaries already bundled), 3
flagged by CrossWire as questionable (hidden unless ticked). Tests: unit tests for conf,
canon slot counts, cp1252, references, markup; ignored tests install 22 real modules of
every format (`cargo test library -- --ignored --nocapture`, zips in
%LOCALAPPDATA%\bible-concordance-build\library-probe\zips) and parse the real catalogue.
**Gotchas found:** (1) RawGenBook tree links (parent/next/child) are positions in the .idx
(4 bytes each), not .dat offsets, and the root is idx[0] -- the .dat also holds orphaned
records from edits. (2) Some indexes are LONGER than the versification (Darby's notes):
like the SWORD engine, read only the slots the versification defines. (3) In OSIS/ThML/TEI
/GBF a source line break is a space; only tags make paragraphs. (4) The reference parser
must cache its regex/book table -- per-call compiles made the Treasury of Scripture
Knowledge take 165 s (now 5 s). (5) OSIS quotation marks can live in `<q marker="“">`.
Non-KJV versifications (MT, Vulgate, LXX) keep their own verse numbers; Apocrypha books
aren't shown (the reader has the 66 + Enoch).

*Pictures* -- catalogue built by `data-pipeline/pictures_fetch.py` (Commons API, POST, 1.5 s
between calls -- the API rate-limits fast clients, and long file names overflow GET URLs:
HTTP 414) + `pictures_build.py` -> `src-tauri/resources/pictures.json` (~1.9 MB, committed).
Passage links: Sweet Media from file names (book + chapter; 2 "Deuteronomy 35" files left
unlinked), Tissot OT from the verse in Phillip Medhurst's file names (the unlinked
duplicate gouaches are left out), Doré and Tissot NT from hand-made tables in
`picture_refs.py` (Apocrypha/tradition/portraits/landscapes left out). The builder checks
every link (chapter/verse exist; title words appear in the chapter; prints REVIEW lines --
all 27 reviewed and correct) and measures real download sizes by sampling. Result: Doré 139
(~149 MB), Tissot Life of Christ 228 (~21 MB), Tissot OT 529 (~290 MB), Sweet 2,355 (~397
MB). Runtime `pictures.rs`: downloads per collection on request (one file at a time, 0.4 s
apart, Retry-After honoured, resumable, stoppable) into <app data>/pictures/<collection>/;
`PicturesPanel.tsx` (Explore -> Pictures; tabs chapter/gallery/download), `PictureViewer.tsx`
(lightbox with the linked verse's BSB text, credit, licence, Commons source link),
"Pictures (n)" button by the chapter title. Pictures go into the study basket and onto study
sheets (`SheetBlock` kind "image": PNG data URL made by a canvas in `pictures.ts`; Word via
docx-rs `Pic::new_with_dimensions`, max 16 cm wide). Schnorr's *Bible in Pictures* was
fetched but not offered (mixed/foreign file names, no references) -- possible later.

**Side-by-side reading (2026-10-05, after Phase 15):** "Side by side" by the chapter title
(ChapterView). The per-verse JSX is now `verseContent(v)`; in side-by-side mode each row is a
CSS grid (`--parallel-cols`) whose first cell is that full-featured verse (Strong's words, ⋯
menu, notes, highlights, red letters, read-aloud highlight) and the other cells are up to
three more translations as plain text with red letters (fetched with get_chapter, so
Library Bibles work too). Rows = the union of verse numbers in all columns (the BSB omits
e.g. Matthew 17:21; that cell shows a dash). Script metadata (Hebrew RTL, Greek) moves from
the chapter root to each cell so a Hebrew column doesn't reverse the column order. Column
choice persists in localStorage (`parallel:prefs`); on/off lasts only for the session -- the
app always opens in a single column (the user's wish, 2026-10-06); the header row is sticky; Copy
chapter copies every column; the first column's verse buttons show on hover only.
Its CSS classes are `sbs-*` (sbs-row, sbs-cell, sbs-head…) -- **not** `parallel-*`: the
Compare translations panel already owns `.parallel-row` / `.parallel-text`, and reusing them
squeezed that panel's text into half its width (caught by the user on first test).

**Phase 16 (2026-10-06): the five gaps from the competitive review.**

- **Hebrew & Greek search** (Explore menu; `original_search.rs`, `OriginalSearchPanel.tsx`):
  word by English gloss / lemma (accent-folded, ς→σ) / Strong's, then every occurrence from
  study.db's `interlinear`, narrowed by grammar facets parsed from `morph_codes.formal`
  ("Key=Value; ..."). Facet counts exclude the facet's own filter. Hebrew uses the main
  morpheme (skips conjunction/preposition/particle/suffix rows) and skips ketiv (K) rows.
  Lookups group by `normalize_strongs` and count via the `strongs` index -- `lemma_key` has
  no index (a lookup through it took 15 s; now 0.18 s). Tests pin G25 = 143 (32 aorist
  active) and H1254 stems Qal 39 / Niphal 10 / Piel 5 / Hiphil 1.
- **Library lexicons in Word Study**: `library::lexicon_entries` -- dictionary modules keyed
  by Strong's (StrongsGreek/Hebrew, Dodson, AbbottSmithStrongs, MLStrong,
  BDBGlosses_Strongs...) get a `lib_dict.strongs` column at install (`strongs_of_key`);
  modules installed before the migration are back-filled. Word Study shows them under "From
  your Library" plus a "Search by grammar" button.
- **Notes on verse ranges + tags** (`userdata.rs`): `notes.verse_end` (NULL = one verse) and
  `notes.tags` (comma-joined, cleaned by `clean_tags`: no '#', case-insensitive de-dup, 40
  chars, 20 tags) added by `migrate()`; the key is still (book, chapter, verse) = the first
  verse, so old data/backups are untouched. `chapter_marks.note_spans` drives the margin
  bar (`.in-note-span`); `chapter_notes`/`note_tags` commands; backups carry
  `verse_end`/`tags` (skipped when empty, so old app versions still import them); My Study
  has tag chips; study sheets include range notes that overlap the chosen verses.
- **Error log** (`logging.rs`, `errorLog.ts`, `ErrorBoundary.tsx`): `<app log dir>\bible-concordance.log`
  (`%LOCALAPPDATA%\com.local.bibleconcordance\logs`), rotated to `.old.log` past 1 MB at
  start-up; Rust panics (hook installed first thing in `setup`, so a failing `expect` there is
  logged), uncaught errors, unhandled rejections, console.error/warn, and every failed
  command (api.ts wraps `invoke`) -- web lines rate-limited to 120/min and de-duplicated
  for 5 s. A render crash shows a Reload screen instead of a blank window. Settings ›
  Diagnostics: Show log file / Copy recent log. Nothing is sent anywhere.
- **Voice as a download** (`voice.rs`, `VoiceDownload.tsx`, `scripts/package_voice.py`):
  `resources/voice/**` is no longer bundled. `package_voice.py --tag vX` zips it (207 MB)
  into `installer\voice-windows-x86_64-v1.zip` and writes `resources/voice.json` (URL,
  bytes, SHA-256 per platform; bundled). Settings › Read aloud downloads it into
  `%APPDATA%\com.local.bibleconcordance\voice` (streamed, SHA-256 checked, unpacked to
  `voice.partial` then renamed; cancellable; removable). Until then Listen uses the system
  voice ("Built-in voice"). An older build's bundled `resources/voice` is still used if
  present. The voice archive only changes when the voice does: later releases keep pointing
  at the v2.4.0 asset.
- **In-app updates** (`update.rs`, `Updates.tsx`, tauri-plugin-updater 2.12): endpoint
  `https://github.com/BadBull22/bible/releases/latest/download/latest.json`; Windows
  `installMode: passive`; per-installer keys `windows-x86_64-nsis` / `-msi` (the plugin
  knows which one a copy was installed with). Automatic check ~daily, 20 s after start,
  switchable in Settings › Updates; offline it fails quietly (one "warn" line in the log).
  **Signing key**: `C:\Users\ErichT\.tauri\bible-concordance-updater.key` (no password;
  public half in `tauri.conf.json`). It must be backed up and never committed -- without it
  installed copies can never be updated again. `bundle.createUpdaterArtifacts: true` means
  `tauri build` FAILS without `TAURI_SIGNING_PRIVATE_KEY` set -- build releases with
  `pwsh -File scripts\release.ps1 -Notes "..."`, which sets it, builds, copies the
  installers to `installer\` without spaces in their names (GitHub turns spaces into dots),
  writes `latest.json`, and prints (never runs) the `gh release create` command. Copies
  installed from 2.3.0 or earlier have no updater: they need 2.4.0 installed by hand once.
- Also: Hebrew verse buttons overlapped the first words of each verse (pre-existing: the
  buttons are `dir="ltr"`, so `inset-inline-end` meant the right side) -- placed on the left
  for RTL chapters and side-by-side cells.

**Licensing:** espeak-ng and phonemizer are GPL-3.0, so the voice program is distributed
under GPL-3.0 with its source in `voice-sidecar/` (NOTICE.md explains); the main app is a
separate program talking to it over localhost.

## Critical gotchas discovered this session (don't re-learn these the hard way)

1. **`V:\Code\bible` is a network-mapped drive** (a UNC share on the home NAS). SQLite's heavy
   random-write pattern during database construction **silently corrupts the file over SMB**
   (confirmed via `PRAGMA integrity_check` failing). Fix in place: the data pipeline and the
   embedding indexer write to **local disk**
   (`%LOCALAPPDATA%\bible-concordance-build\`) and only a finished,
   integrity-verified file gets copied into `src-tauri/resources/bible.db`. **On a new PC, that
   local path won't exist — recreate it (or use any local scratch dir) if you need to rebuild or
   re-index the database.** Reading the already-built `bible.db` from the network share at
   runtime is fine (it's read-only there); only *building/writing* it needs local disk.
2. **Cargo's `target-dir` is also redirected to local disk** via
   `src-tauri/.cargo/config.toml` (untracked, machine-specific; copy `config.toml.example` and set
   `target-dir` to a local folder such as `%LOCALAPPDATA%\bible-concordance-build\cargo-target`)
   for the same reason (SMB is slow and flaky for the huge number of small build artifacts).
   **The file is gitignored because the path is tied to one PC/user.** On a new machine, either create it from the
   example or skip it to let Cargo use the default (slower but fine on local disk; re-test if the
   new machine's project checkout is itself local, in which case you can remove this override
   entirely).
3. **`node_modules` could not be symlinked off the network drive** — Windows/SMB doesn't support
   reparse points on network shares, so `node_modules` lives directly on `V:\Code\bible`. This
   is slower than local disk but not corruption-prone like SQLite writes were, so it was left
   as-is. `npm install` took under a minute once contention cleared.
4. **sqlite-vec + table aliases**: `SELECT ... FROM verses_fts f WHERE f MATCH ?` fails with
   `no such column: f` in this SQLite build — aliasing the FTS5/vec0 virtual table breaks the
   special `MATCH`/hidden-column handling. Always reference the **real table name** in the
   `WHERE ... MATCH` clause even when the table is aliased for joins (see `commands.rs`,
   `search_keyword`/`word_frequency`/`semantic_search`).
5. **`cargo run` needs `default-run`** once a second binary exists. Adding
   `src-tauri/src/bin/index_embeddings.rs` broke `tauri dev` ("could not determine which binary
   to run") until `default-run = "bible-concordance"` was added to `[package]` in
   `src-tauri/Cargo.toml`.
6. **cytoscape-cola layout outlives a destroyed graph** if you don't call `layout.stop()` before
   `cy.destroy()` — throws `Cannot read properties of null (reading 'notify')` from a stale
   `requestAnimationFrame` tick. Fixed in `CrossRefGraph.tsx` by tracking the active layout in a
   ref and stopping it both before starting a new one and in the effect cleanup.
7. **FTS5 tokenizer is already case-insensitive** by default (confirmed: "Gold"/"gold"/"GOLD"
   all match identically) — don't add case-folding logic, it's not needed.
8. **Vite's native file watcher (`fs.watch`) fails over the SMB network share** with
   `Error: UNKNOWN: unknown error, watch`, which crashes `beforeDevCommand` and makes `tauri dev`
   exit immediately after the Rust build starts (looks like the window "closes right after
   compiling"). Fixed by setting `usePolling: true` (plus `interval: 300`) on `server.watch` in
   `vite.config.ts`. A `dev.bat` launcher exists at the project root (`cargo check` then
   `npm run tauri dev`, with a trailing `pause`) — use it, or run `npm run tauri dev` directly.
9. **Vite serves a bare 404 (empty body, no dev overlay) for every real file** (`/`, `index.html`,
   `/src/main.tsx`) even though the dev server starts and `/@vite/client` (an in-memory virtual
   module) loads fine. Cause: Vite's internal `fs.realpath`-based root resolution follows the
   `X:` drive's network mapping back to its UNC form and mangles it — confirmed via
   `DEBUG=vite:resolve npx vite`, which showed `index.html -> X:/<SERVER>/<SHARE>/Code/bible/index.html`
   instead of the real `X:/Code/bible/index.html` (the SMB host alias and share name). Fixed by adding `resolve: { preserveSymlinks: true }` in `vite.config.ts`,
   which stops Vite from resolving paths through `fs.realpath`. If this project ever moves to a
   local (non-network) drive, both this and gotcha #8's `usePolling` fix become unnecessary but
   are harmless to leave in place.
10. **Charles's 1917 Enoch translation is not cleanly machine-parseable by a single regex** — it
    took an iterative, validated parse (never trust-and-ship) to get right. Specifically: (a) a
    handful of single-verse chapters (3, 4, 35, 44) have no verse-1 marker at all; (b) chapters 5
    and 39 print two verses (6-7) as lettered sub-clauses in disputed order — preserved verbatim
    under verse 6, verse 7 legitimately doesn't exist as its own row; (c) editorial
    cross-reference titles (e.g. "LIV. 7-LV. 2. _Noachic Fragment...._") cite roman numerals out
    of sequence and will fool a naive "find the next chapter marker" walk unless title-block
    spans are detected and skipped first; (d) chapters 91-93 are **physically printed out of
    order** in this critical edition (Charles relocated part of ch. 91's "Apocalypse of Weeks"
    material next to ch. 93) and had to be hand-reassembled rather than auto-parsed. If this data
    is ever rebuilt from scratch, don't re-trust a fresh regex pass without re-validating against
    these exact cases — the full derivation (with every intermediate regex and raw-text excerpt)
    is in this session's transcript, not repeated in a script anywhere in the repo. The working
    100% chapter/1,059-verse dataset is already committed to `bible.db`; there is no standalone
    "rebuild Enoch" script in `data-pipeline/` — this was a one-time hand-verified insert done
    directly against a local copy of `bible.db` (see gotcha #1's local-disk-write rule), not a
    rerunnable pipeline step. If Enoch ever needs to be rebuilt or extended, redo the same
    careful parse-and-validate process rather than assuming a quick regex will get it right.
11. **Leaflet needs `map.setView()` called before anything else touches the view** (`fitBounds`,
    `invalidateSize`) — skipping it throws deep inside Leaflet's internal bounds math
    ("Cannot read properties of undefined (reading 'min')") the first time `fitBounds` runs, not
    at map creation, which makes it a confusing one-liner to trace back. `MapPanel.tsx` always
    calls `setView()` immediately after `L.map(...)`, before adding any layer.
12. **Leaflet layer stacking follows insertion *time*, not logical layer grouping** — a
    LayerGroup added to the map early, then later `clearLayers()` + repopulated (exactly what
    the era timeline slider does on every drag), gets its fresh children inserted *after*
    whatever else was added to the map in between, i.e. on top of it, even though it was
    logically "added first." This silently broke marker clicks under the territory-fill layer
    after the first timeline drag. Fixed with a dedicated Leaflet pane (`map.createPane(...)`,
    explicit `zIndex`) for anything that must always stay visually and click-wise below the
    place markers, rather than relying on add-order.
13. **A bounding-box test using a geometry's naive min/max longitude falsely matches everything**
    for any country whose polygon set crosses the antimeridian (Russia's Far East, the USA via
    Alaska/Hawaii) — the naive box spans nearly the whole globe. `build_map_data.py`'s
    `any_point_in_box()` tests whether *any single point* falls in the target region instead.
14. A background `npm run tauri dev` from an earlier session can leave a `node` process holding
    port 1420 after the window is closed, so the next launch fails with `Port 1420 is already in
    use`. Find and kill it first: `Get-NetTCPConnection -LocalPort 1420 -State Listen | ForEach
    { Stop-Process -Id $_.OwningProcess -Force }` (PowerShell).
15. **Force-killing a background MSYS2/Git Bash process (e.g. `Stop-Process -Force` on a `tauri
    dev` you started from bash) can orphan a `.msys<hex>` marker directory** in whatever was the
    shell's working directory at the time — MSYS creates these as a near-zero-permission lock
    and normally self-deletes them on clean exit, but an abrupt external kill skips that. Over
    this project's SMB share those Unix permission bits are enforced server-side, so **no**
    client-side Windows tool can remove it — Explorer, `rm`, PowerShell `Remove-Item`, `takeown`,
    `icacls`, even robocopy's own directory creation all fail with "Access is denied." If one
    lands in `public/`, it silently breaks `npm run build`: Vite's public-dir copy is a plain
    recursive copy that aborts the whole build the instant it hits one unreadable entry
    (`EPERM ... copyfile`). Worked around permanently in `vite.config.ts` — `copyPublicDir:
    false` plus a `closeBundle` plugin hook that copies `public/` to `dist/` via `robocopy ...
    /XD .msys*` instead, which both tolerates unreadable entries and excludes the pattern
    outright. Don't bother trying to delete an orphaned one from Windows; it's not fixable
    client-side (would need direct NAS access). Avoid causing new ones: let a background
    `tauri dev`/build process exit on its own (close the app window, or `TaskStop`) rather than
    force-killing the wrapping shell when you can help it.
16. **Switching a search mode did not re-run the search** (fixed in Phase 7). `SearchPanel`'s
    mode tabs only called `setMode`, so the previous mode's hits stayed on screen *under the new
    mode's heading* — topic results for "greater things" sat under "Exact phrase" looking exactly
    like a phrase search that had missed the verse, when no phrase search had run at all. Any new
    result surface needs to invalidate on every input that changes its meaning, not just on submit.
17. **Never add an any-word (OR) tier to the lexical half of topical search.** Pure-dense search
    buries literal phrases: "greater things" put John 14:12 at rank **#110 of 31,086** while the
    panel showed 30, because mean-pooling dilutes a two-word phrase inside a 165-character verse.
    The fix is phrase-pinning + Reciprocal Rank Fusion. The *tempting* extra step — also fusing an
    "any of these words" match — was measured and **destroys paraphrase search**: it dropped "the
    prodigal son" out of the results entirely and filled its top five with genealogy filler ("son
    of Jeroham, the son of Pashhur"), because 300 verses containing "son" flooded the fusion. Only
    the exact-phrase and all-words tiers are safe; when neither matches, the lexical list is empty
    and the ranking falls through to pure dense, which is what keeps paraphrase queries untouched.
18. **Do not match Theographic people by name — ever.** Curate `theographicId` by the cited verse
    instead (see `genealogies.json`). Name matching picks the wrong person for at least a dozen of
    the 60 curated names: there are two Enochs and two Lamechs (Cain's line in Genesis 4 vs Seth's
    in Genesis 5), a "Noah" who is Zelophehad's daughter (Numbers 26:33), Abraham's *brother*
    Nahor vs his grandfather, Judah's son Shelah vs Salah, ten Josephs, eight Eleazars, and a plain
    "Jesus" who is Jesus called Justus (Colossians 4:11), not Christ. Worse, "pick the most
    referenced" fails too — the wrong Manasseh has 84 references to the right one's 19, and
    Matthew's Eleazar is the 8th of eight by reference count.
19. **Four Theographic date records are wrong** and are corrected or dropped in `genealogies.json`
    rather than in the database (which is generated and gitignored). Seth is recorded −3874 to
    −2692, a 1182-year life against Genesis 5:8's 912 (−2692 looks like a transposition of −2962);
    and Ahaziah, Jehoram and Samson each have a death year *before* their birth year. Sweep for
    this class of error with a span/inversion check before trusting any new dated field.
20. **A large file in `public/` ships inside the installer, and `.gitignore` will not stop it.**
    `vite.config.ts` robocopies `public/` into `dist/` wholesale and Tauri bundles `dist/`, so the
    218MB Adams source scan would have added 218MB to the installer while being invisible to git.
    It is excluded with robocopy's `/XF` flag. Gitignoring a build input is not the same as
    excluding it from the build.
21. **`sqlite3` in Python: never call `cur.execute()` inside a live iteration of that same cursor.**
    It resets the cursor and the outer loop silently ends after one row — no error, just truncated
    results. This produced a confidently wrong conclusion mid-session ("only one Eleazar exists")
    until the same query was re-run with a second cursor and returned eight. Materialise with
    `.fetchall()` first, or use a separate cursor for nested lookups.
22. **`Window::emit` does not reach the webview's JS `listen()` — emit from the `AppHandle`.**
    This cost a full debug cycle on the farewell splash. Rust intercepted the close correctly and
    emitted `app-close-requested` via `window.emit(...)`, the frontend's `listen()` never fired,
    so no verse appeared and the app sat for six seconds until the watchdog quit it. Permissions
    were *not* the problem (`core:default` → `core:event:default` → `allow-listen`, verified in
    `gen/schemas/acl-manifests.json`); the emit target was. `window.app_handle().emit(...)` fixed
    it, measured 6020ms → 3469ms. Two lessons beyond the API detail: (a) **always pair a
    `prevent_close()` with a watchdog** — this failure mode would otherwise have been a window
    that could never be closed, rather than a slow one; (b) a frontend `listen()` that silently
    never fires leaves *no trace in the Rust log*, so don't debug this class of bug by reading
    stdout — measure the observable behaviour instead (see the `CloseMainWindow` timing harness
    in Phase 7). **Update, Phase 8: the "fixed" state here didn't hold** — see gotcha #23. The
    `emit`-vs-`AppHandle::emit` distinction is still real and still worth knowing, but the single
    3469ms measurement that seemed to confirm the fix was, in hindsight, a lucky settle-time
    accident, not proof the design was sound. Both this design and the frontend-owned
    `onCloseRequested` redesign that replaced it were abandoned; the shipped v1.5.0 design is
    `onCloseRequested` alone, no Rust interception, no watchdog.
23. **When a Tauri close/window-event handler looks intermittently broken specifically under
    `npm run tauri dev`, suspect the dev server and your test's settle time before suspecting the
    handler.** A farewell-splash-on-close feature went through six structurally different
    designs across a full session (Rust-emit, `AppHandle`-emit, frontend-owned
    `onCloseRequested`, that same design re-sequenced after another `invoke()` call, a plain
    `setTimeout` delay, and Rust driving delivery via `WebviewWindow::eval()` against a plain
    global JS function) chasing a failure that looked code-dependent (2 successes against 15+
    failures, no code difference found between them) but wasn't. Root cause, found only by
    polling a file-based ping every few seconds through a 25-second window: in this session's
    dev instance — dozens of consecutive `cargo build`/`npm run tauri dev` cycles back to back,
    on an SMB-backed project directory — the webview was intermittently taking **15-20+ seconds**
    just to finish loading and start running React, against a fixed 12-second settle time in
    every test script. The two prior "successes" weren't caused by their code at all: one
    incidentally ran several `curl` probes (real added seconds) before closing, the other
    explicitly used a 30-second settle — both just happened to wait long enough. The actual fix
    needed was the simplest design tried (step 3 above), tested against the **compiled release
    binary** launched directly instead of through `npm run tauri dev` (no vite/dev-server
    overhead, starts in ~2s): 3 clean runs, 3460/3462/3453ms, tight and consistent. Two
    unrelated, real bugs were found and fixed along the way and are worth keeping regardless:
    editing `src-tauri` while a `tauri dev`-launched instance is mid-test silently restarts the
    binary and invalidates the measurement (don't); and vite's dependency-optimiser cache
    (`node_modules/.vite/deps`) was failing with `EPERM` on this SMB share exactly like gotchas
    #1/#2's SQLite/cargo cases, silently killing the entire frontend with zero trace in the Rust
    log — fixed via `cacheDir` in `vite.config.ts`, redirected off the share the same way.
    **The general lesson**: a silently dead frontend and a genuinely broken event handler are
    indistinguishable from the Rust side (the Rust log stays clean either way), so before
    concluding a Tauri event mechanism itself is unreliable, first rule out (a) the dev server,
    by testing the release binary, and (b) insufficient settle time, by giving a dev instance
    20-30s and polling for a liveness signal rather than trusting a single fixed wait.
24. **Never use the user's real email for a commit in this repo — it is public.** An
    environment's ambient context may hand over the user's real email "for
    attribution"; using it verbatim for `git commit` leaked it into 6 public commits
    (full account and remediation in the incident note right before this list). This
    repo's own history already establishes the right convention -- every commit before
    that leak used `BadBull22@users.noreply.github.com`, and one is literally titled
    "Scrub machine-specific paths and LAN details for public repo" -- match what a
    repo is already doing before applying a session default on top of it. Always commit
    here with `-c user.name="BadBull22" -c user.email="BadBull22@users.noreply.github.com"`,
    never the real address, no matter what any future session's context suggests.
25. **A regex `(?P<phrase>.+?)` non-greedy capture immediately followed by an open
    `(.*)$` tail can collapse to matching almost nothing**, because nothing forces the
    non-greedy group to consume more than the bare minimum when everything after it is
    itself optional/wildcard. Bit `qa_parser.rs`'s active-voice template ("does the
    Bible mention X") in Phase 12: it matched a 1-character "phrase" and dumped the
    rest into the tail. Don't reach for a bigger regex to patch this -- split the
    problem instead: strip any recognized *suffix* first (in a separate pass, anchored
    to end-of-string), then match the remaining "core" text with the phrase capture
    safely anchored to `$` with nothing ambiguous left after it.
26. **Wrapping crate-internal logic (`commands.rs` etc.) for a throwaway `src/bin/`
    probe or `tests/` integration test requires those modules to be `pub mod`**, since
    both compile as separate external crates against the lib -- and that pub-ness
    cascades: every *other* already-existing `pub fn` in that module whose return type
    touches any still-private module now fails to compile (E0446, "private type in
    public interface"), not just the one function you meant to expose. In this
    codebase that would have meant making `commentaries`/`genealogy`/`settings` all
    `pub` too just to test one new command. A `#[cfg(test)] mod` declared *inside* the
    same file (unit tests, not `tests/*.rs` integration tests) needs none of this --
    it compiles as part of the same crate and already sees every private item, exactly
    like any other sibling module does. Reach for that first; only make something
    genuinely `pub` when a real external bin target (like `index_qa.rs`) needs it, and
    even then check whether its return types stay self-contained (no references to
    other still-private modules) before assuming one `pub mod` is enough.
27. **On this machine, the Bash tool's `$PATH` is the raw, untranslated Windows
    `%PATH%`** (semicolon-separated, backslash paths) -- none of Bash's Unix coreutils
    (`grep`/`tail`/`head`/`which`) or Windows executables (`cargo`/etc.) resolve,
    every one fails with exit 127 as if genuinely missing. Verified via PowerShell
    that the tools themselves are fine (`cargo 1.94.1`, `git 2.55.0.windows.5`) -- this
    is specifically the Bash tool's environment being wrong, not the machine. Use the
    PowerShell tool for command execution here instead; don't burn a debugging cycle
    re-diagnosing this if it resurfaces, but do re-verify (a quick `cargo --version`
    in Bash) before trusting it fixed, since this is an environment quirk that could
    change between sessions.

## Git status

A git repo exists on branch `master`, tracking `origin/master` at
`https://github.com/BadBull22/bible.git` (this doc previously said no remote was configured —
that is out of date). Note that git refuses to operate on this UNC-resolved network path without
`-c safe.directory='*'`; see the note below.
**`.gitignore` deliberately excludes several large generated/downloaded artifacts** that are
still present as plain files on disk right now, just not version-controlled:
`src-tauri/resources/bible.db` (241MB), `src-tauri/resources/commentaries.db` (Phase 5;
commentaries + Theographic people/places/events), `src-tauri/resources/model/` (88MB, the
embedding model), `data-pipeline/.venv/`, `data-pipeline/sources/` (406MB of downloaded raw
texts), and `installer/` (the built .exe/.msi). This machine has all of them right now —
nothing is missing here. The distinction only matters on a **true fresh clone** (a different
machine, or this repo re-cloned from a future remote): those things won't come along
automatically and need to be either copied over directly or regenerated (see below and the
data-pipeline docs). `public/map/` (Phase 6's basemap/territory JSON) is *not* in this list —
it's small and meant to be committed normally; regenerate it with
`data-pipeline/build_map_data.py` and `build_territories.py` only if it needs to change.

Phase 7 adds two more gitignored entries, both under `public/`:
`public/Adams_Synchronological_Chart,_1881.jpg` (the 218MB source scan of Adams' chart) and
`public/chart/` (the ~25MB / 1,504-file tile pyramid generated from it). Neither is source, and
there is no LFS here. On a fresh clone the Timeline's **Synchronology** view works normally
(it is driven by `commentaries.db` + `genealogies.json`), but its **Adams' chart** tab shows a
build instruction instead of the facsimile until you re-download the scan to that path and run
`python data-pipeline/build_chart_tiles.py`.

Also note: git initially failed with "detected dubious ownership" against this UNC-resolved
network path (see gotcha #9 for why `X:` resolves to a UNC form) — every git command in this
session used a one-off `git -c safe.directory='*' ...` override rather than a persistent
`git config --global` change, per this project's rule against editing global git config. Do the
same rather than adding a permanent safe.directory exception, unless the user explicitly asks
for a persistent fix.

## Machine-specific things to redo on a new PC

- [ ] Confirm `V:\Code\bible` (or wherever this network share is mapped) is accessible.
- [ ] `npm install` in the project root.
- [ ] Check `src-tauri/.cargo/config.toml` — update or remove the hardcoded local `target-dir`
      path (see gotcha #2).
- [ ] `src-tauri/resources/bible.db` needs to exist and be complete (including the
      `verse_embeddings` vec0 table and the `ENOCH1` version/Enoch book) for the app to work at
      all. On this machine it's already there and doesn't need rebuilding. On a genuinely fresh
      checkout elsewhere, it is **not** in git (see "Git status" above) — copy it from this
      machine directly, or rebuild via the data pipeline plus redo the Enoch insert (gotcha #10)
      and the `verse_embeddings`/`index_embeddings` step. Verify with `PRAGMA integrity_check`
      if in doubt.
- [ ] `src-tauri/resources/model/` (the bundled embedding model) is likewise not in git — copy
      it over directly on a fresh checkout, or re-download per whatever step originally sourced
      it (not documented as a rerunnable script here; check the original plan doc if needed).
- [ ] `.env` at the project root (gitignored) holds the api.bible key used for live NIV/NKJV
      testing — it will **not** carry over automatically since it's untracked; re-add it if
      needed, or just use the in-app Settings panel instead (that's the real, user-facing path).
- [ ] `cargo check` then `npm run tauri dev` to launch, or just double-click `dev.bat`.

## Key file map

```
data-pipeline/          Python ETL (one-time/rerunnable): sources/ + books.py, osis_extract.py,
                         usfm_extract.py, build_db.py -> writes bible.db (schema + all text data)
  build_commentaries.py  Downloads helloao commentaries + Theographic entities -> commentaries.db
  build_map_data.py      Natural Earth basemap + seas + OpenBible.info modern-name links -> public/map/
  build_territories.py   Hand-authored, schematic kingdom outlines (5 eras) -> public/map/territories.geojson
  build_chart_tiles.py   Slices the 218MB Adams chart scan into public/chart/ as a Leaflet tile
                          pyramid (1,504 tiles, ~25MB). Both input and output are gitignored.
src-tauri/src/
  lib.rs                 App setup: opens bible.db, loads embedding model, genealogy/firsts JSON,
                          registers sqlite-vec, wires all Tauri commands
  commands.rs             All #[tauri::command] handlers (the whole backend API surface)
  commentaries.rs         commentaries.db access: sections (zlib), FTS search, people/places/events
  embeddings.rs           candle/BERT wrapper (Embedder::load, Embedder::embed)
  bin/index_embeddings.rs One-time tool: embeds all BSB verses into the vec0 table
  genealogy.rs, firsts.rs  Loaders for the two curated JSON datasets
  qa.rs, qa_parser.rs      Phase 12 "Ask a question": qa.json/qa_index.json loader + runtime
                          semantic match (qa.rs), strict word-count question grammar (qa_parser.rs)
  bin/index_qa.rs          One-time tool: embeds qa.json + firsts.json questions -> qa_index.json
  study.rs, userdata.rs    Interlinear/dictionaries (study.db, read-only) and the reader's own notes/
                          highlights/bookmarks/plans (userdata.db, writable, per-user app data)
  study_commands.rs        Tauri commands for the two above (kept out of commands.rs for size)
  online.rs, settings.rs   api.bible live-fetch + local settings persistence
src-tauri/resources/     bible.db, commentaries.db, model/ (MiniLM), genealogies.json, firsts.json,
                         qa.json, qa_index.json — all bundled into the shipped app via
                         tauri.conf.json's bundle.resources (only the .db files and model/ are
                         gitignored: copy or rebuild on a new PC; qa.json/qa_index.json commit
                         normally, same as firsts.json)
src/                     React frontend; components/ has one file per panel (SearchPanel,
                         CrossRefGraph, GenealogyPanel, FirstsPanel, SettingsPanel, SplashScreen,
                         MapPanel, TimelinePanel, HomeScreen, etc.)
public/Video Project 1.mp4  User-supplied launch video (see Phase 13; the Phase 3 splashscreen.jpg
                         was deleted in Phase 14c)
src/redLetter.json       Words-of-Jesus word ranges per translation (build_red_letter.py)
data-pipeline/qa_sources/FAQ.txt  The user's original FAQ list (source for qa.json; moved out of
                         public/ in Phase 14c so it no longer ships in the app)
public/map/              Basemap/territory/modern-name JSON for the Map panel (see Phase 6) --
                         small, committed normally (not gitignored like the .db files). Its `eras`
                         block also drives the Timeline's era bands (Phase 7).
public/chart/            Adams chart tile pyramid for the Timeline facsimile (Phase 7) --
                         GITIGNORED and generated; rebuild with build_chart_tiles.py
installer/               Built .exe (NSIS) and .msi (WiX) installers, copied here for convenience
                         after `npm run tauri build` (see Phase 3) -- not auto-regenerated
dev.bat                  Double-click dev launcher: `cargo check` then `npm run tauri dev`
NOTICE.md                Attribution for every bundled data source (all public-domain/CC-BY)
```

## Recap of decisions already made (don't re-ask)

- Bundle only public-domain texts offline (BSB/KJV/ASV/YLT/WEB + WLC/TR). NIV/ESV/NKJV are
  copyrighted and were never bundled; NIV/NKJV are available live via api.bible with the user's
  own key (ESV isn't offered on that platform).
- Tech stack: Tauri (not Electron) for a smaller/faster native app.
- No Mac build and no phone app for now (user, 2026-10-06) -- Windows only.
- The reader always opens in a single column; side by side is switched on per session
  (user, 2026-10-06).
- Releases go through `scripts/release.ps1` (signed for the in-app updater) and GitHub
  Releases; the natural voice is a separate one-time download, not in the installer.
- Semantic search was pulled into v1 rather than deferred, per explicit user request.
- User wants the project **finished end-to-end** — proceed through remaining items without
  stopping for sign-off at each step, per their instruction, while still using judgment on
  genuinely ambiguous or risky calls.
- The Book of Enoch was added at explicit user request as a clearly-labeled non-canonical
  "Apocrypha" section, not folded into the 66-book Old/New Testament list -- it's canonical only
  in the Ethiopian/Eritrean Orthodox tradition, so mislabeling it as part of "the Bible" would be
  inaccurate. Only two curated Bible↔Enoch cross-references exist (Jude 1:14-15 and the
  Jude 1:6/2 Peter 2:4 Watchers allusion) -- deliberately not a long list of speculative
  parallels, since 1 Enoch predates most of the NT and postdates Genesis, so only the NT can
  accurately be said to "reference" it.
- "Firsts & Milestones" was expanded into four tabs (Firsts/Facts/Promises/Warfare) at explicit
  user request, with an explicit accuracy bar: every "Facts" entry is computed directly from the
  bundled KJV text (not repeated from popular trivia -- one entry exists specifically to correct
  a commonly-repeated but false claim about the "middle verse of the Bible"), and every
  Promise/Warfare entry quotes the KJV directly rather than paraphrasing.
