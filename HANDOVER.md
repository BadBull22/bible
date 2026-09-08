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

## Current status: Phases 1-3 done and working (v1.2.0)

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

**Not built yet:** commentaries (Matthew Henry/JFB/Barnes via SWORD modules), local import of
user-owned NIV/ESV/NKJV modules (e-Sword/MySword), bundle code-splitting (currently one ~730KB
JS chunk — works fine, just a size-warning, not urgent), semantic/keyword search over Enoch's
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
src-tauri/src/
  lib.rs                 App setup: opens bible.db, loads embedding model, genealogy/firsts JSON,
                          registers sqlite-vec, wires all Tauri commands
  commands.rs             All #[tauri::command] handlers (the whole backend API surface)
  embeddings.rs           candle/BERT wrapper (Embedder::load, Embedder::embed)
  bin/index_embeddings.rs One-time tool: embeds all BSB verses into the vec0 table
  genealogy.rs, firsts.rs  Loaders for the two curated JSON datasets
  online.rs, settings.rs   api.bible live-fetch + local settings persistence
src-tauri/resources/     bible.db, model/ (MiniLM), genealogies.json, firsts.json — all bundled
                         into the shipped app via tauri.conf.json's bundle.resources
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
