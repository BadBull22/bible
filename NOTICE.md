# Bible Concordance — licence, credits & data attribution

**Bible Concordance** was made by **Erich P. Tonsing** as a personal Bible study tool and is
given away **free of charge**. Anyone may install, use, copy and share it at no cost, for
personal, educational, church or ministry use. **It must never be sold, licensed for a fee, or
bundled into anything that is charged for**, and it may not be used to sell the texts it
contains. It is provided "as is", without warranty of any kind: use it at your own risk.

Everything bundled in the app is either **public domain** or released under an **open licence**
that permits redistribution, and is used with that permission. Copyrighted modern translations
(NIV, NKJV, ESV) are **not** bundled; they can only be viewed live, over the internet, with the
user's own key from the publisher's platform, and remain the property of their publishers.

## Bundled texts and datasets

| Data | Source | Licence |
|---|---|---|
| Berean Standard Bible (BSB) | bereanbible.com / `BSB-publishing/bsb2usfm` | Public domain |
| King James Version (1769) | `scrollmapper/bible_databases` | Public domain |
| American Standard Version (1901) | `scrollmapper/bible_databases` | Public domain |
| Young's Literal Translation | `scrollmapper/bible_databases` | Public domain |
| World English Bible | eBible.org | Public domain |
| Westminster Leningrad Codex (Hebrew OT) | `scrollmapper/bible_databases` | Public domain Masoretic text |
| Textus Receptus, Scrivener 1894 (Greek NT) | `scrollmapper/bible_databases` | Public domain |
| 1 Enoch, tr. R.H. Charles & W.O.E. Oesterley (1917) | Project Gutenberg #77935 | Public domain |
| Strong's Hebrew & Greek Dictionaries (1890) | `openscriptures/strongs` | CC BY-SA |
| Cross-reference dataset (TSK-derived) | OpenBible.info, via `scrollmapper/bible_databases` | CC BY 4.0 |
| Matthew Henry, Jamieson-Fausset-Brown, Adam Clarke, John Gill, Calvin, Keil & Delitzsch commentaries | Free Use Bible API (bible.helloao.org, AO Lab) | Public domain (CC PDM 1.0) |
| Tyndale Open Study Notes | Free Use Bible API (bible.helloao.org, AO Lab) | CC BY-SA 4.0 |
| Theographic Bible Metadata (people, places, events) | `robertrouse/theographic-bible-metadata`, via Free Use Bible API | CC BY-SA 4.0 |
| all-MiniLM-L6-v2 sentence-embedding model (topic search) | sentence-transformers | Apache 2.0 |

Word-level Strong's-number tagging for BSB/KJV/ASV/WEB comes from the OSIS/USFM markup
included in the above sources. Curated genealogies and "Firsts & Milestones" entries were
compiled for this app from the bundled KJV text.

## Online-only translations (optional, user's own key)

| Translation | Provider | Terms |
|---|---|---|
| NIV, NKJV | api.bible (American Bible Society) | Publisher copyright; displayed live only, never cached |
| ESV | api.esv.org (Crossway) | © 2001 Crossway; non-commercial use; displayed with "(ESV)" attribution |

## Software

Built with Tauri, Rust, React, SQLite (FTS5, sqlite-vec), candle and Cytoscape, all under
permissive open-source licences (MIT / Apache 2.0).
