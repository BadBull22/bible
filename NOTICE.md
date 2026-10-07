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
| Cross-references involving the Apocrypha (2,990 links, each naming its source) | Reference notes of the Swedish Bible of 1917 (CrossWire module `Swe1917`), the World English Bible, whose Apocrypha notes follow the Revised Version of 1895 (eBible.org `engwebu2025eb`), and the Menge-Bibel of 1939 (CrossWire `GerMenge`); extracted by `data-pipeline/build_apocrypha_xrefs.py` | Public domain |
| Matthew Henry, Jamieson-Fausset-Brown, Adam Clarke, John Gill, Calvin, Keil & Delitzsch commentaries | Free Use Bible API (bible.helloao.org, AO Lab) | Public domain (CC PDM 1.0) |
| Tyndale Open Study Notes | Free Use Bible API (bible.helloao.org, AO Lab) | CC BY-SA 4.0 |
| John Wesley's Explanatory Notes on the Bible (1754–65); Scofield Reference Notes (1917 edition) | CrossWire Bible Society SWORD modules `Wesley`, `Scofield` | Public domain |
| Tyndale House Greek New Testament (THGNT, 2017) — second Greek NT reading text | Tyndale House, Cambridge; assembled from STEPBible TAGNT edition markings | CC BY-SA 4.0 |
| Interlinear word data with grammar: Translators Amalgamated Hebrew OT (TAHOT) and Greek NT (TAGNT) | STEPBible.org, Tyndale House, Cambridge (`STEPBible/STEPBible-Data`) | CC BY 4.0 — "Data created by www.STEPBible.org based on work at Tyndale House Cambridge" |
| Grammar-code explanations (TEHMC, TEGMC) | STEPBible.org (`STEPBible/STEPBible-Data`) | CC BY 4.0 |
| Easton's Bible Dictionary (1897), Smith's Bible Dictionary (1884), Nave's Topical Bible (1896), Torrey's New Topical Textbook (1897) | CrossWire Bible Society SWORD modules `Easton`, `Smith`, `Nave`, `Torrey` | Public domain |
| Theographic Bible Metadata (people, places, events) | `robertrouse/theographic-bible-metadata`, via Free Use Bible API | CC BY-SA 4.0 |
| Coastline, river and lake basemap (Map panel) | Natural Earth (`naturalearthdata.com`), 1:50m cultural/physical vectors | Public domain |
| Ancient-to-modern place name links (Map panel "Modern names" mode) | OpenBible.info Bible-Geocoding-Data | CC BY 4.0 |
| Kingdom/nation outlines, Divided Monarchy period (Map panel) | Hand-drawn for this app from its own bundled place coordinates; schematic, not a scholarly reconstruction | Original work |
| Adams' Synchronological Chart or Map of History, facsimile in the Timeline panel | Sebastian C. Adams, 1871 (third edition, revised to 1876); scan via Wikimedia Commons | Public domain (author died 1898) |
| Messianic prophecy/fulfilment reference pairs and their five-section grouping (Prophecies tab) | Selection compiled from *FULFILLED*, a Tableau Public visualisation by "thecfelix" with Kevin Flerlage | Scripture references are facts, not copyrightable; the **selection and grouping** are credited to those authors. Their bundled verse text (NIV) was **not** used — this app renders the verses from its own public-domain translations instead. Pairings were corrected and re-verified against the bundled BSB. |
| all-MiniLM-L6-v2 sentence-embedding model (topic search) | sentence-transformers | Apache 2.0 |
| Poppins Regular font (the "Gospel" wordmark on the opening screen) | The Poppins Project Authors, via `google/fonts` | SIL Open Font License 1.1 |

Word-level Strong's-number tagging for BSB/KJV/ASV/WEB comes from the OSIS/USFM markup
included in the above sources. Curated genealogies and "Firsts & Milestones" entries were
compiled for this app from the bundled KJV text. Curated "Ask a question" answers quote
scripture from the bundled Berean Standard Bible (public domain).

The reader's own notes, highlights, bookmarks and reading-plan progress are stored only on
their own computer (`userdata.db` in the app's data folder) and are never sent anywhere.

## Online-only translations (optional, user's own key)

| Translation | Provider | Terms |
|---|---|---|
| NIV, NKJV | api.bible (American Bible Society) | Publisher copyright; displayed live only, never cached |
| ESV | api.esv.org (Crossway) | © 2001 Crossway; non-commercial use; displayed with "(ESV)" attribution |

## Software

Built with Tauri, Rust, React, SQLite (FTS5, sqlite-vec), candle and Cytoscape, all under
permissive open-source licences (MIT / Apache 2.0).

### Library (downloaded on request)

The Library screen downloads modules from the **CrossWire Bible Society**'s free SWORD
repository (crosswire.org) only when the user chooses them; nothing from it is bundled. Each
module carries its own licence, shown in the Library before installing — most are public
domain; some are copyrighted works whose publishers have permitted CrossWire to distribute
them free of charge (e.g. the 1933/1953 Afrikaans Bybel, © Bible Society of South Africa).
The verse-numbering tables used to read them come from the SWORD engine via the pysword
package (MIT).

The Library can also browse other free SWORD repositories, again downloading only what the
user chooses: **eBible.org** (Bibles in many languages), the **NET Bible** free edition from
bible.org (© Biblical Studies Press), **Wycliffe Bible Translators**' minority-language
Bibles, and CrossWire's Attic and Beta collections. Each item's licence is shown before
installing.

### The user's own books ("Add from file")

A user can add an EPUB e-book, a PDF book or a SWORD module they already have. These files
are never bundled, uploaded or shared; they are converted to text and kept only on that
user's computer. The app does not remove copy protection: copy-protected or
password-protected files are refused. Users are responsible for having the right to use
the files they add.

### Bible pictures (downloaded on request)

Downloaded from Wikimedia Commons only when the user chooses a collection; each picture keeps
a link to its Commons page with full source details.

| Collection | Licence |
|---|---|
| Gustave Doré, Bible engravings (1866) | Public domain |
| James Tissot, *The Life of Our Lord Jesus Christ* (1886–94), Brooklyn Museum | Public domain |
| James Tissot, Old Testament (1896–1902), scans of the 1904 edition by Phillip Medhurst | Artwork public domain; scans CC BY-SA |
| Bible illustrations by Jim Padgett, courtesy of Sweet Publishing, Ft. Worth, TX, and Gospel Light, Ventura, CA (1984) | CC BY-SA 3.0 |

### Read-aloud voice

Read aloud runs in a **separate program** shipped beside the app (`resources/voice/`), which
the app starts and talks to over a local connection (127.0.0.1 only; nothing leaves the
computer). It contains:

| Component | Source | Licence |
|---|---|---|
| Kokoro-82M text-to-speech model (fp16 ONNX export) and voices | hexgrad/Kokoro-82M; ONNX files from `thewh1teagle/kokoro-onnx` | Apache 2.0 |
| kokoro-onnx | `thewh1teagle/kokoro-onnx` | MIT |
| ONNX Runtime | Microsoft | MIT |
| NumPy, Python 3.12 runtime | numpy.org, python.org | BSD-3-Clause, PSF |
| espeak-ng (pronunciation) | `espeak-ng/espeak-ng`, via `espeakng-loader` | **GPL-3.0** |
| phonemizer | `bootphon/phonemizer` | **GPL-3.0** |

Because espeak-ng and phonemizer are GPL-3.0, the voice program as a whole is distributed under
the **GPL-3.0**. Its complete source is in this repository (`voice-sidecar/`: `server.py`,
`make_voices.py`, `build.ps1`, `requirements.txt`), and the unmodified sources of espeak-ng and
phonemizer are available from the projects above. The rest of Bible Concordance is a separate
program that only exchanges text and audio with it, and is not affected by that licence.
