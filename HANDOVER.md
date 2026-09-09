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

## Current status: Phases 1-5 done and working (v1.3.0)

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

**Not built yet:** local import of
user-owned NIV/ESV/NKJV modules (e-Sword/MySword), semantic/keyword search over Enoch's
text is FTS-only (no embeddings — the `verse_embeddings` vec0 table was only ever built for BSB).

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
   **This absolute path is tied to this PC/user.** On a new machine, either update that path or
   delete the file to let Cargo use the default (slower but fine on local disk; re-test if the
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
   instead of the real `X:/Code/bible/index.html` (`PRIVATE`/`OTHER` being this share's SMB host
   alias/share name). Fixed by adding `resolve: { preserveSymlinks: true }` in `vite.config.ts`,
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

## Git status

A git repo now exists (root commit `3085677`, branch `master`, remote: none configured yet).
**`.gitignore` deliberately excludes several large generated/downloaded artifacts** that are
still present as plain files on disk right now, just not version-controlled:
`src-tauri/resources/bible.db` (241MB), `src-tauri/resources/model/` (88MB, the embedding
model), `data-pipeline/.venv/`, `data-pipeline/sources/` (406MB of downloaded raw texts), and
`installer/` (the built .exe/.msi). This machine has all of them right now — nothing is
missing here. The distinction only matters on a **true fresh clone** (a different machine, or
this repo re-cloned from a future remote): those five things won't come along automatically and
need to be either copied over directly or regenerated (see below and the data-pipeline docs).

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
                         etc.)
public/splashscreen.jpg  User-supplied launch-screen image (see Phase 3)
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
