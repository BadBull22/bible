# Bible Concordance

Offline-first Bible study and concordance desktop app: Tauri 2 + Rust backend, React/TypeScript frontend.

- Multi-version reading (BSB, KJV, ASV, YLT, WEB, plus Hebrew WLC and Greek TR) with parallel comparison
- Strong's-number word study from any tagged word, with exact occurrence counts
- Keyword, word-frequency and local semantic (meaning-based) search
- Interactive cross-reference graph, curated genealogies, and a "Firsts & Milestones" index
- Seven public-domain / CC commentaries offline (Matthew Henry, JFB, Clarke, Gill, Calvin, Keil & Delitzsch,
  Tyndale Open Study Notes) with full-text search, plus a per-chapter people, places and events index
- Optional **online** comparison against NIV/NKJV (api.bible) and ESV (api.esv.org) with the user's own keys
- 1 Enoch (Charles & Oesterley, 1917) in a clearly labelled non-canonical section

## Running

```
npm install
npm run tauri dev      # or double-click dev.bat
npm run tauri build    # produces NSIS .exe and WiX .msi installers
```

Keyboard: `←`/`→` turn chapters, `Ctrl+K` focuses search, `Esc` closes the side panel. Typing a reference such as
`John 3:16` or `gen 1` into the search box navigates directly.

## Read first

[HANDOVER.md](HANDOVER.md) documents the architecture, the data pipeline, machine-specific setup (the database,
embedding model and Cargo target directory live outside git) and a list of hard-won gotchas. [NOTICE.md](NOTICE.md)
lists the licence/attribution for every bundled text.
