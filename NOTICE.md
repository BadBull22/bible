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
| Meanings of the Hebrew and Greek words, and their groups (Concordance > Meaning; `resources/semantic_domains.json`, made by `scripts/build_semantic_domains.mts`): UBS Dictionary of Biblical Hebrew (adapted from the Semantic Dictionary of Biblical Hebrew, © United Bible Societies 2000-2023) and UBS Dictionary of the Greek New Testament (adapted from the Semantic Dictionary of Biblical Greek, © United Bible Societies 2018-2023, which is adapted from Louw and Nida, *Greek-English Lexicon of the New Testament: Based on Semantic Domains*, © United Bible Societies 1988, 1989). Trimmed and repacked for the app, which is allowed by the licence; the repacked data file is shared under the same licence | `ubsicap/ubs-open-license`, folder `dictionaries` (English JSON) | CC BY-SA 4.0 ([licence](https://creativecommons.org/licenses/by-sa/4.0/)) |
| Plain-English descriptions, related groups and everyday example words beside a meaning (Concordance > Strong's number and Meaning; `resources/semantic_sil.json`, made by `scripts/build_semantic_sil.mts`): SIL Semantic Domains, version 4, © SIL Global (semdom.org), adapted: each group of the UBS dictionaries is paired with the SIL domain that goes with it (Greek through the Louw-Nida numbers; Hebrew by a hand-made table, `scripts/data/hebrew_sil_map.txt`), and only those domains are kept. The repacked data file is shared under the same licence | `https://semdom.org/data/semdom.json` (copy in `scripts/data/semdom-v4.json`) | CC BY-SA 4.0 ([licence](https://creativecommons.org/licenses/by-sa/4.0/)) |
| Poppins Regular font (the "Gospel" wordmark on the opening screen) | The Poppins Project Authors, via `google/fonts` | SIL Open Font License 1.1 |
| Lora, Poppins SemiBold and Bold, Dancing Script and Nunito fonts (the phone app's picture studio and Daily Scroll) | Their Project Authors, via `google/fonts` | SIL Open Font License 1.1 |

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

The Content Factory puts its short videos into an MP4 file with **Mediabunny** (Vanilagy,
https://mediabunny.dev, licence MPL-2.0), used unmodified. Its soft background music is composed by the
app itself, from fixed musical rules, as it is needed: no recording is used.

The Content Factory's optional "Free recordings" (downloaded only when the reader asks, each saved with its credit): piano
recordings from the Open Goldberg Variations by Kimiko Ishizaka (CC0, https://archive.org/details/The_Open_Goldberg_Variations-11823),
and carols and hymns by the US Army Band and the US Navy Band (works of the US government, public domain, Wikimedia Commons).
Photographs found online from the Content Factory come from Wikimedia Commons with a public domain, CC0, CC BY or CC BY-SA licence and
are shown with their credit. The seasonal verse lists are Scripture references only. Songs a reader puts in their own music folder are
theirs; those in a "Southern Cross Music" folder are credited to that artist.

The 331 nature photographs offered as backgrounds (both apps; one download, about 36 MB, the release `backgrounds-v2`) are all CC0 (public domain dedication) on Wikimedia Commons. Each is listed with its title, photographer and Commons page in the pack's own `backgrounds.json`, which the apps keep.

The 55 Christian pictures offered as backgrounds (an optional download of about 12 MB, the release `backgrounds-christian-v1`; crosses, prayer, worship, stained glass, the Bible, communion and Christmas) are photographs from Unsplash, used under the Unsplash License (free to use, including commercially, without asking permission or giving credit). Each is listed with its title, photographer's name (from the file name Unsplash gave it) and its Unsplash page, `https://unsplash.com/photos/<code>`, in the pack's own `backgrounds.json`, which the app keeps. They were chosen by hand; none is sold or offered as a stand-alone download. If Unsplash or a photographer asks for any to be taken out, they are removed from the pack.

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

### Stories and children's pages added in version 3.1.2 (built in)

Thirty-six more Bible stories, each with its children's page, are built into the app from version 3.1.2, with their pictures (on the phone, in the optional story pictures and children's pictures downloads). The Tissot and Doré paintings and engravings are in the public domain. The Sweet Publishing illustrations are licensed CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/) and are shown with their credit under the picture; a picture too large for the app is shown at a smaller file size and otherwise unchanged. The outline to colour in that goes with a children's picture is a drawing made from that picture (its black pen lines only) and is shared under the same licence, with the same credit.

| Page | Picture | Artist | Licence | Source |
|---|---|---|---|---|
| The Boy Jesus in the Temple (story) | On Return from Jerusalem, It is Noticed that Jesus is Lost | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_On_Return_from_Jerusalem,_It_is_Noticed_that_Jesus_is_Lost_-_James_Tissot.jpg) |
| The Crucifixion of Jesus (story) | The Death of Jesus | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Death_of_Jesus_(La_mort_de_J%C3%A9sus%29_-_James_Tissot.jpg) |
| The Last Supper (story) | The Communion of the Apostles | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Communion_of_the_Apostles_(La_communion_des_ap%C3%B4tres%29_-_James_Tissot.jpg) |
| Blind Bartimaeus (story) | The Two Blind Men at Jericho | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Two_Blind_Men_at_Jericho_(Les_deux_aveugles_%C3%A0_Jericho%29_-_James_Tissot.jpg) |
| Cain and Abel (story) | Caïn entraîne Abel | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Ca%C3%AFn_entra%C3%AEne_Abel_(Genesis_4_8%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst..jpg) |
| Elijah and the Gentle Whisper (story) | Élie dans la grotte | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:%C3%89lie_dans_la_grotte_(1_Kings_19_9%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_Charles_Hoffbauer_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Elijah Fed by Ravens (story) | Les corbeaux apportent du pain à Élie | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Les_corbeaux_apportent_du_pain_%C3%A0_%C3%89lie_(1_Kings_17_6%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_Charles_Hoffbauer_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Elijah Taken Up in a Fiery Chariot (story) | Élie mont au ciel | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:%C3%89lie_mont_au_ciel_(2_Kings_2_11%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_Auguste-Fran%C3%A7ois_Gorguet_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Elisha and the Widow's Oil (story) | 2 Kings 4, picture 4 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Second_Book_of_Kings_Chapter_4-4_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Esther Becomes Queen (story) | Mardochée | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Mardoch%C3%A9e_(Esther_2_5%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_Michel_Simonidy_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Jacob's Dream at Bethel (story) | Le songe de Jacob | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:050.3_402_Le_songe_de_Jacob_(Genesis_28_12%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Jairus' Daughter (story) | The Daughter of Jairus | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Daughter_of_Jairus_(La_fille_de_Z%C3%A4ire%29_-_James_Tissot_-_overall.jpg) |
| Jesus Blesses the Children (story) | Suffer the Little Children to Come unto Me | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_Suffer_the_Little_Children_to_Come_unto_Me_(Laisser_venir_%C3%A0_moi_les_petits_enfants%29_-_James_Tissot.jpg) |
| Jesus Washes the Disciples' Feet (story) | The Washing of the Feet | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Washing_of_the_Feet_(Le_lavement_des_pieds%29_-_James_Tissot.jpg) |
| Joshua and the Sun Standing Still (story) | Josué arrète le soleil | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Josu%C3%A9_arr%C3%A8te_le_soleil_(Joshua_10_12%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Nebuchadnezzar's Dream (story) | Daniel et les savants | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Daniel_et_les_savants_(Daniel_2_36%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_Michel_Simonidy_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Rahab and the Spies of Jericho (story) | La courtisane de Jéricho et les espions | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:La_courtisane_de_J%C3%A9richo_et_les_espions_(Joshua_2_12%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Samson and Delilah (story) | Samson et Dalila | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Samson_et_Dalila_(Judges_16_6%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_Michel_Simonidy_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Solomon Asks for Wisdom (story) | Jugement de Salomon | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:300.3_402_Jugement_de_Salomon_(1_Kings_3_27%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_Michel_Simonidy_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| The Fiery Furnace (story) | Dans la fournaise | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Dans_la_fournaise_(Daniel_3_23-24%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_Michel_Simonidy_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| The First Passover (story) | Les signes sur la porte | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Les_signes_sur_la_porte_(Exodus_12_22%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| The Golden Calf (story) | Moses Breaks the Tables of the Law | Gustave Doré | Public domain | [source](https://commons.wikimedia.org/wiki/File:041A.Moses_Breaks_the_Tables_of_the_Law.jpg) |
| The Handwriting on the Wall (story) | Mané, Thécel, Pharès | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Man%C3%A9,_Th%C3%A9cel,_Phar%C3%A8s_(Daniel_5_5%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_Michel_Simonidy_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| The Lost Sheep and the Lost Coin (story) | The Lost Drachma | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Lost_Drachma_(La_drachme_perdue%29_-_James_Tissot_-_overall.jpg) |
| The Ten Commandments at Sinai (story) | La nuée sur le mont Sinaï | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:La_nu%C3%A9e_sur_le_mont_Sina%C3%AF_(Exodus_20_18%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| The Ten Plagues of Egypt (story) | L'eau changée en sang | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:L%27eau_chang%C3%A9e_en_sang_(Exodus_7_20%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| The Tower of Babel (story) | La tour de Babel | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:La_tour_de_Babel_(Genesis_11_4%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst..jpg) |
| Spies Sent into Canaan (story) | Les raisins de Chanaan | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Les_raisins_de_Chanaan_(Numbers_13_24%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| The Visit of the Wise Men (story) | The Adoration of the Magi | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Adoration_of_the_Magi_(L%27adoration_des_mages%29_-_James_Tissot_-_overall.jpg) |
| The Widow's Offering (story) | The Widow's Mite | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Widow%27s_Mite_(Le_denier_de_la_veuve%29_-_James_Tissot.jpg) |
| Blind Bartimaeus (children) | Mark, chapter 10, picture 19 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_Mark_Chapter_10-19_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Cain and Abel (children) | Genesis, chapter 4, picture 4 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Book_of_Genesis_Chapter_4-4_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Elijah and the Gentle Whisper (children) | Elijah Is Nourished by an Angel | Gustave Doré | Public domain | [source](https://commons.wikimedia.org/wiki/File:091.Elijah_Is_Nourished_by_an_Angel.jpg) |
| Elijah Fed by Ravens (children) | 1 Kings 17, picture 1 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:First_Book_of_Kings_Chapter_17-1_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Elijah Taken Up in a Fiery Chariot (children) | 2 Kings 2, picture 8 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Second_Book_of_Kings_Chapter_2-8_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Elisha and the Widow's Oil (children) | 2 Kings 4, picture 1 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Second_Book_of_Kings_Chapter_4-1_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Esther Becomes Queen (children) | Esther, chapter 2, picture 2 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Book_of_Esther_Chapter_2-2_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Jacob and Esau's Birthright (children) | Genesis, chapter 25, picture 10 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Book_of_Genesis_Chapter_25-10_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Jacob's Dream at Bethel (children) | Genesis, chapter 28, picture 3 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Book_of_Genesis_Chapter_28-3_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Jairus' Daughter (children) | Luke, chapter 8, picture 37 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_Luke_Chapter_8-37_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Jesus Blesses the Children (children) | Luke, chapter 18, picture 1 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_Luke_Chapter_18-1_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Jesus Washes the Disciples' Feet (children) | John, chapter 13, picture 1 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_John_Chapter_13-1_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Joshua and the Sun Standing Still (children) | Joshua, chapter 10, picture 4 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Book_of_Joshua_Chapter_10-4_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Naaman Healed of Leprosy (children) | 2 Kings 5, picture 10 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Second_Book_of_Kings_Chapter_5-10_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Nebuchadnezzar's Dream (children) | Daniel, chapter 2, picture 6 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Book_of_Daniel_Chapter_2-6_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Paul and Silas in Prison (children) | Acts, chapter 16, picture 15 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Acts_of_the_Apostles_Chapter_16-15_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Rahab and the Spies of Jericho (children) | Joshua, chapter 2, picture 9 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Book_of_Joshua_Chapter_2-9_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Samson and Delilah (children) | Judges, chapter 16, picture 3 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Book_of_Judges_Chapter_16-3_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Solomon Asks for Wisdom (children) | 1 Kings 3, picture 3 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:First_Book_of_Kings_Chapter_3-3_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Spies Sent into Canaan (children) | Numbers, chapter 13, picture 5 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Book_of_Numbers_Chapter_13-5_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Boy Jesus in the Temple (children) | Luke, chapter 2, picture 17 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_Luke_Chapter_2-17_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Crucifixion of Jesus (children) | Matthew, chapter 27, picture 8 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_Matthew_Chapter_27-8_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Fiery Furnace (children) | Daniel, chapter 3, picture 9 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Book_of_Daniel_Chapter_3-9_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The First Passover (children) | Exodus, chapter 12, picture 2 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Book_of_Exodus_Chapter_12-2_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Golden Calf (children) | Moses Breaks the Tables of the Law | Gustave Doré | Public domain | [source](https://commons.wikimedia.org/wiki/File:041A.Moses_Breaks_the_Tables_of_the_Law.jpg) |
| The Handwriting on the Wall (children) | Daniel, chapter 5, picture 4 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Book_of_Daniel_Chapter_5-4_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Last Supper (children) | Luke, chapter 22, picture 13 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_Luke_Chapter_22-13_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Lost Sheep and the Lost Coin (children) | Luke, chapter 15, picture 6 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_Luke_Chapter_15-6_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Parable of the Talents (children) | Luke, chapter 19, picture 5 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_Luke_Chapter_19-5_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Ten Commandments at Sinai (children) | Exodus, chapter 20, picture 12 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Book_of_Exodus_Chapter_20-12_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Ten Lepers (children) | Luke, chapter 17, picture 4 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_Luke_Chapter_17-4_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Ten Plagues of Egypt (children) | Exodus, chapter 9, picture 1 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Book_of_Exodus_Chapter_9-1_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Tower of Babel (children) | Genesis, chapter 11, picture 4 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Book_of_Genesis_Chapter_11-4_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Valley of Dry Bones (children) | Ezekiel, chapter 37, picture 3 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Book_of_Ezekiel_Chapter_37-3_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Visit of the Wise Men (children) | Matthew, chapter 2, picture 7 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_Matthew_Chapter_2-7_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Widow's Offering (children) | Mark, chapter 12, picture 8 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_Mark_Chapter_12-8_(Bible_Illustrations_by_Sweet_Media%29.jpg) |

### Pictures with additional stories (the fetched file)

Stories, "Verses for..." pages and children's pages added after a version of the app was made reach the phone as one small file (the "Fetch additional stories" button), and the file can carry each page's picture. Each picture is shown with its credit, licence and a link to its Commons page. The Tissot paintings are public domain and the Sweet Publishing illustrations are licensed CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/); the Sweet pictures are shown unchanged. The outline to colour in that goes with a children's picture is a drawing made from that picture (its black pen lines only) and is shared under the same CC BY-SA 3.0 licence, with the same credit.

| Page | Picture | Artist | Licence | Source |
|---|---|---|---|---|
| The Woman Who Touched Jesus' Cloak (story) | The Woman with an Issue of Blood | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Woman_with_an_Issue_of_Blood_(L%27h%C3%A9moro%C3%AFsse%29_-_James_Tissot.jpg) |
| Jesus Heals the Centurion's Servant (story) | Lord, I Am Not Worthy | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_Lord,_I_Am_Not_Worthy_(Domine_Non_Sum_Dignus%29_-_James_Tissot_-_overall.jpg) |
| Jesus Heals a Man Born Blind (story) | The Blind Man Washes in the Pool of Siloam | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Blind_Man_Washes_in_the_Pool_of_Siloam_(Le_aveugle-n%C3%A9_se_lave_%C3%A0_la_piscine_de_Silo%C3%AB%29_-_James_Tissot.jpg) |
| Jesus Heals a Paralytic (story) | The Palsied Man Let Down through the Roof | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Palsied_Man_Let_Down_through_the_Roof_(Le_paralytique_descendu_du_toit%29_-_James_Tissot_-_overall.jpg) |
| Mary Anoints Jesus (story) | The Ointment of the Magdalene | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Ointment_of_the_Magdalene_(Le_parfum_de_Madeleine%29_-_James_Tissot.jpg) |
| Paul's Conversion on the Damascus Road (story) | Acts, chapter 9, picture 2 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Acts_of_the_Apostles_Chapter_9-2_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Peter Denies Jesus (story) | The Third Denial of Peter. Jesus' Look of Reproach | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Third_Denial_of_Peter._Jesus%27_Look_of_Reproach_-_James_Tissot.jpg) |
| The Ascension of Jesus (story) | The Ascension | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Ascension_(L%27Ascension%29_-_James_Tissot.jpg) |
| Water into Wine at Cana (story) | The Marriage at Cana | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Marriage_at_Cana_(Les_noces_de_Cana%29_-_James_Tissot_-_overall.jpg) |
| Crossing the Jordan River (story) | L'arche traverse le Jourdain | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:L%27arche_traverse_le_Jourdain_(Joshua_3_17%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Deborah the Prophetess and Judge (story) | Débora sous son palmier | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:D%C3%A9bora_sous_son_palmier_(Judges_4_4%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Elijah and the Prophets of Baal on Mount Carmel (story) | Le feu d'en haut vient incendier l'autel | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:Le_feu_d%27en_haut_vient_incendier_l%27autel_(1_Kings_18_38%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_Charles_Hoffbauer_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Esther Saves Her People (story) | Esther Accuses Haman | Gustave Doré | Public domain | [source](https://commons.wikimedia.org/wiki/File:117.Esther_Accuses_Haman.jpg) |
| Ezra Reads the Law to the People (story) | Ezra Reads the Law to the People | Gustave Doré | Public domain | [source](https://commons.wikimedia.org/wiki/File:109.Ezra_Reads_the_Law_to_the_People.jpg) |
| Gideon and His 300 Soldiers (story) | Gédéon choisit les trois cents | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:G%C3%A9d%C3%A9on_choisit_les_trois_cents_(Judges_7_6%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Jacob Wrestles with God (story) | La lutte de l'Ange avec Jacob | James Tissot (published 1904) | Public domain artwork; scans by Phillip Medhurst (CC BY-SA) | [source](https://commons.wikimedia.org/wiki/File:053.3_402_La_lutte_de_l%27Ange_avec_Jacob_(Genesis_32_24%29_%E2%80%A2_invenit_James_Tissot_%E2%80%A2_pinxit_James_Tissot_%E2%80%A2_excudit_Maurice_de_Brunoff_apud_Philip_de_Vere_%E2%80%A2_praesentat_Phillip_Medhurst.jpg) |
| Jesus Prays in Gethsemane (story) | You Could Not Watch One Hour With Me | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_You_Could_Not_Watch_One_Hour_With_Me_(Vous_n%27avez_pu_veiller_une_heure_avec_moi%29_-_James_Tissot.jpg) |
| The Birth of Isaac (story) | Hagar and Ishmael in the Wilderness | Gustave Doré | Public domain | [source](https://commons.wikimedia.org/wiki/File:015.Hagar_and_Ishmael_in_the_Wilderness.jpg) |
| The Miraculous Catch of Fish (story) | The Miraculous Draught of Fishes | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Miraculous_Draught_of_Fishes_(La_p%C3%AAche_miraculeuse%29_-_James_Tissot_-_overall.jpg) |
| The Sermon on the Mount (story) | The Sermon of the Beatitudes | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Sermon_of_the_Beatitudes_(La_sermon_des_b%C3%A9atitudes%29_-_James_Tissot.jpg) |
| The Transfiguration (story) | The Transfiguration | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Transfiguration_(La_transfiguration%29_-_James_Tissot_-_overall.jpg) |
| The Triumphal Entry (story) | The Procession in the Streets of Jerusalem | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Procession_in_the_Streets_of_Jerusalem_(Le_cort%C3%A8ge_dans_les_rues_de_J%C3%A9rusalem%29_-_James_Tissot.jpg) |
| The Woman Caught in Adultery (story) | The Adulterous Woman Alone with Jesus | James Tissot | Public domain | [source](https://commons.wikimedia.org/wiki/File:Brooklyn_Museum_-_The_Adulterous_Woman_Alone_with_Jesus_(La_femme_adult%C3%A8re_seule_avec_J%C3%A9sus%29_-_James_Tissot.jpg) |
| The Woman Who Touched the Cloak (children) | Gospel of Luke, chapter 8, picture 33 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_Luke_Chapter_8-33_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| The Soldier and His Servant (children) | Gospel of Luke, chapter 7, picture 2 | Jim Padgett, Sweet Publishing | CC BY-SA 3.0 | [source](https://commons.wikimedia.org/wiki/File:Gospel_of_Luke_Chapter_7-2_(Bible_Illustrations_by_Sweet_Media%29.jpg) |
| Elisha and the Floating Axe Head (story) | Elisha makes the axe swim (The story of the Bible from Genesis to Revelation, 1873) | Unknown author | Public domain | [source](https://commons.wikimedia.org/wiki/File:Elisha_makes_the_axe_swim.jpg) |

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
