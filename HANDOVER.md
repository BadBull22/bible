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

## Current status: Phases 1-7 done (v1.4.0; Phase 7 is not yet runtime-tested)

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
  faded to black via a CSS radial mask, then fades into the main app.
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
    in Phase 7).

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
  online.rs, settings.rs   api.bible live-fetch + local settings persistence
src-tauri/resources/     bible.db, commentaries.db, model/ (MiniLM), genealogies.json, firsts.json
                         — all bundled into the shipped app via tauri.conf.json's bundle.resources
                         (both .db files and model/ are gitignored: copy or rebuild on a new PC)
src/                     React frontend; components/ has one file per panel (SearchPanel,
                         CrossRefGraph, GenealogyPanel, FirstsPanel, SettingsPanel, SplashScreen,
                         MapPanel, TimelinePanel, HomeScreen, etc.)
public/splashscreen.jpg  User-supplied launch-screen image (see Phase 3)
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
