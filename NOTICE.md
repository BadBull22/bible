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
| Interlinear word data with grammar: Translators Amalgamated Hebrew OT (TAHOT) and Greek NT (TAGNT) (in the desktop app; and in the phone app's optional "Original words" download) | STEPBible.org, Tyndale House, Cambridge (`STEPBible/STEPBible-Data`) | CC BY 4.0 — "Data created by www.STEPBible.org based on work at Tyndale House Cambridge" |
| Grammar-code explanations (TEHMC, TEGMC) | STEPBible.org (`STEPBible/STEPBible-Data`) | CC BY 4.0 |
| Easton's Bible Dictionary (1897), Smith's Bible Dictionary (1884), Nave's Topical Bible (1896), Torrey's New Topical Textbook (1897) | CrossWire Bible Society SWORD modules `Easton`, `Smith`, `Nave`, `Torrey` | Public domain |
| Theographic Bible Metadata (people, places, events) | `robertrouse/theographic-bible-metadata`, via Free Use Bible API | CC BY-SA 4.0 |
| Coastline, river and lake basemap (Map panel) | Natural Earth (`naturalearthdata.com`), 1:50m cultural/physical vectors | Public domain |
| Ancient-to-modern place name links (Map panel "Modern names" mode) | OpenBible.info Bible-Geocoding-Data | CC BY 4.0 |
| Kingdom/nation outlines, Divided Monarchy period (Map panel) | Hand-drawn for this app from its own bundled place coordinates; schematic, not a scholarly reconstruction | Original work |
| Bible maps tab (Map panel): The twelve tribes of Israel; The kingdoms of Saul, David and Solomon; The kingdoms of Israel and Judah; The ministry of Jesus; Christ in Judea; Paul's journeys; The places in Corinthians | Biblica Open Bible Maps, copyright Biblica, Inc. (open.bible). "The original work by Biblica, Inc. is available for free at www.biblica.com and open.bible." Shown at a smaller file size, otherwise unchanged. "Biblica" is a trademark of Biblica, Inc. | CC BY-SA 4.0 |
| Bible maps tab: "The modern world and the Bible lands" (Rand McNally, 1910) | Project Gutenberg, via Wikimedia Commons | Public domain |
| Bible maps tab: the plan of Jerusalem from A. L. Rawson's "Map of Palestine and all Bible lands" (H. H. Lloyd & Co., 1873) | Scan by the Norman B. Leventhal Map Center at the Boston Public Library, via Wikimedia Commons | Public domain |
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

### Bible story pictures (built in)

Each Bible story page in Browse carries one picture, built into the app (the collections above can still be downloaded in full).
Every file is the unaltered picture as Wikimedia Commons serves it (a 1280 px rendition); each links to its Commons page with the full
source details. James Tissot and Gustave Doré died before 1925: the paintings and engravings are in the public domain. The scans of
Tissot's Old Testament paintings by Phillip Medhurst and the Sweet Publishing illustrations are licensed CC BY-SA 3.0
(https://creativecommons.org/licenses/by-sa/3.0/) and are shown unchanged, with their credit, under the picture.

| Story | Picture | Artist | Licence | Source |
|---|---|---|---|---|
| David and Goliath | David lance sa fronde | James Tissot | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:David_lance_sa_fronde_(1_Samuel_17_49%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_Louis_de_Parys_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Jesus Calms the Storm | Jesus Calming the Tempest | Gustave Doré | Public domain | [source](https://commons.wikimedia.org/wiki/File:JesusCalmingtheTempestDore.jpg) |
| The Prodigal Son | The Return of the Prodigal Son | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Return_of_the_Prodigal_Son_(Le_retour_de_l%27enfant_prodigue%29_-_James_Tissot.jpg) |
| Daniel in the Lions' Den | Daniel dans la fosse au lions | James Tissot | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Daniel_dans_la_fosse_au_lions_(Daniel_6_16%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_Michel_Simonidy_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| The Creation | The Creation of Light | Gustave Doré | Public domain | [source](https://commons.wikimedia.org/wiki/File:001.The_Creation_of_Light.jpg) |
| Noah and the Flood | Le sacrifice de l'arc-en-ciel | James Tissot | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Le_sacrifice_de_l%27arc-en-ciel_(Genesis_8_20%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst..jpg) |
| Moses in the Basket | Moïse exposé parmi les roseaux | James Tissot | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Mo%C3%AFse_expos%C3%A9_parmi_les_roseaux_(Exodus_2_3%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Crossing the Red Sea | Les eaux s'entr'ouvrent | James Tissot | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Les_eaux_s%27entr%27ouvrent_(Exodus_14_22%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| The Fall of Jericho | Les trompettes de Jéricho | James Tissot | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Les_trompettes_de_J%C3%A9richo_(Joshua_6_13%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Jonah and the Great Fish | Jonah Is Spewed Forth by the Whale | Gustave Doré | Public domain | [source](https://commons.wikimedia.org/wiki/File:137.Jonah_Is_Spewed_Forth_by_the_Whale.jpg) |
| The Birth of Jesus | The Birth of Our Lord Jesus Christ | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Birth_of_Our_Lord_Jesus_Christ_(La_nativit%C3%A9_de_Notre-Seigneur_J%C3%A9sus-Christ%29_-_James_Tissot_-_overall.jpg) |
| Jesus Feeds the Five Thousand | Jesus Feeding the Multitude | Gustave Doré | Public domain | [source](https://commons.wikimedia.org/wiki/File:JesusFeedingMultitude.jpg) |
| The Good Samaritan | The Good Samaritan | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Good_Samaritan_(Le_bon_samaritain%29_-_James_Tissot.jpg) |
| Zacchaeus Meets Jesus | Illustration for Luke 19 · picture 3 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_Luke_Chapter_19-3_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Empty Tomb | Mary Magdalene Questions the Angels in the Tomb | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_Mary_Magdalene_Questions_the_Angels_in_the_Tomb_(Madeleine_dans_le_tombeau_interroge_les_anges%29_-_James_Tissot.jpg) |
| The Day of Pentecost | Illustration for Acts 2 · picture 2 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Acts_of_the_Apostles_Chapter_2-2_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Woman at the Well | The Woman of Samaria at the Well | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Woman_of_Samaria_at_the_Well_(La_Samaritaine_%C3%A0_la_fontaine%29_-_James_Tissot_-_overall.jpg) |
| The Baptism of Jesus | Baptism of Jesus by Tissot | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Baptism_of_Jesus_by_Tissot.jpg) |
| The Temptation of Jesus | James Tissot Jesus Ministered to by Angels | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:James_Tissot_Jesus_Ministered_to_by_Angels.jpg) |
| The Parable of the Sower | The Sower | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Sower_(Le_semeur%29_-_James_Tissot_-_overall.jpg) |
| Jesus Walks on the Water | Saint Peter Walks on the Sea | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_Saint_Peter_Walks_on_the_Sea_(Saint_Pierre_marche_sur_la_mer%29_-_James_Tissot_-_overall.jpg) |
| The Raising of Lazarus | The Resurrection of Lazarus | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Resurrection_of_Lazarus_(La_r%C3%A9surrection_de_Lazare%29_-_James_Tissot.jpg) |
| The Road to Emmaus | The Pilgrims of Emmaus on the Road | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Pilgrims_of_Emmaus_on_the_Road_(Les_p%C3%A8lerins_d%27Emma%C3%BCs_en_chemin%29_-_James_Tissot.jpg) |
| Nicodemus Visits Jesus | Illustration for John 3 · picture 2 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_John_Chapter_3-2_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Adam and Eve in the Garden | Adam et Éve chassés du Paradis terrestre | James Tissot | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Adam_et_%C3%89ve_chass%C3%A9s_du_Paradis_terrestre_(Genesis_3_24%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst..jpg) |
| The Call of Abraham | La caravane d'Abram | James Tissot | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:La_caravane_d%27Abram_(Genesis_12_6%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst..jpg) |
| Abraham and Isaac | Isaac porte le bois pour son sacrifice | James Tissot | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:042.3_402_Isaac_porte_le_bois_pour_son_sacrifice_(Genesis_22_6%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Joseph and His Brothers | Joseph raconte ses songes | James Tissot | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:058_403_Joseph_raconte_ses_songes_(Genesis_37_8%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_et_alia_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| The Burning Bush | Moïse adore le buisson ardent | James Tissot | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Mo%C3%AFse_adore_le_buisson_ardent_(Exodus_3_5%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Ruth and Naomi | Ruth glanant | James Tissot | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Ruth_glanant_(Ruth_2_7%29%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_Auguste-Fran%C3%A7ois_Gorguet_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Samuel Hears God | La voix du Seigneur | James Tissot | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:La_voix_du_Seigneur_(1_Samuel_3_4%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_Michel_Simonidy_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |

The children's pictures (colour and colouring-in outline, in `src/browse/pictures/kids`) are original artwork drawn for this app.

### Pictures with additional stories (the fetched file)

Stories, "Verses for..." pages and children's pages added after a version of the app was made reach the phone as one small file (the "Fetch additional stories" button), and the file can carry each page's picture. Each picture is shown with its credit, licence and a link to its Commons page. The Tissot paintings are public domain and the Sweet Publishing illustrations are licensed CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/); the Sweet pictures are shown unchanged. The outline to colour in that goes with a children's picture is a drawing made from that picture (its black pen lines only) and is shared under the same CC BY-SA 3.0 licence, with the same credit.

| Page | Picture | Artist | Licence | Source |
|---|---|---|---|---|
| The Woman Who Touched Jesus' Cloak (story) | The Woman with an Issue of Blood | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Woman_with_an_Issue_of_Blood_(L%27h%C3%A9moro%C3%AFsse%29_-_James_Tissot.jpg) |
| Jesus Heals the Centurion's Servant (story) | Lord, I Am Not Worthy | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_Lord,_I_Am_Not_Worthy_(Domine_Non_Sum_Dignus%29_-_James_Tissot_-_overall.jpg) |
| The Woman Who Touched the Cloak (children) | Gospel of Luke, chapter 8, picture 33 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_Luke_Chapter_8-33_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Soldier and His Servant (children) | Gospel of Luke, chapter 7, picture 2 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_Luke_Chapter_7-2_(Bible_Illustrations_by_Sweet_Media%29.jpg) |

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
