# GUIDE: adding Bible stories, "Verses for..." pages and children's pages (with pictures) to the phone app
Working guide, kept next to the content it describes (`extra-pages/`). Written 2026-11-11 from the first real batch (two stories + two children's pages with pictures).
Whoever does this work should read this file first (and `extra-pages/README.md` for what goes where), then the newest phone handover (`HANDOVER_2026-11-11_TWO_EXTRA_STORIES.md`, last section) for the state of the current batch.

## 0. The rules that decide everything (the owner's, in his order of importance)
1. **Nothing goes out without the owner's word.** Writing, building and testing locally is fine. Uploading the file (publishing the `extra-pages` release), pushing commits, and installing on his phone are each separate decisions: ask every time. His phone holds real data and his real app (`com.ghostclaw.bibleconcordance`): never uninstall it or install over it; test installers are the side-by-side app "Bible v3 Test".
2. **The owner reads and approves every page's words.** Show him the full text (paste it in the chat in a readable form) and wait for "fine" or his changes. A page counts as approved only after that. (The builder refuses `draft` pages, so a test file for his phone may be built with the pages marked approved BEFORE he has read them; if you do that, say so plainly in your report, and do not publish until he has said the words are fine.)
3. **Scripture first, then the Pentecostal reading, then other views** wherever a page touches doctrine (see section 4). The gifts of the Spirit are for today: never write a cessationist view. Say "Resurrection Sunday" / "Passover", never "Easter", in anything a reader sees.
4. **Never credit who or what wrote the pages**: no "written by", no "generated", no tool or model names, no co-author lines, anywhere a reader can see or in tracked files or commits. Reader-facing text reads as the app's own.
5. **Every sentence is original.** Pages hold Scripture REFERENCES only; the app shows the verse words from the reader's Bible. Never paste or closely follow a Bible's wording (a test refuses any run of 8 words copied from the BSB, KJV, ASV, WEB or YLT). No copyrighted song lyrics, no copyrighted pictures.
6. **Stories the owner keeps for testing are never bundled.** Pages that live only in a batch folder reach phones only through the fetched file: never copy them into `src/browse/data/`, never add their pictures to `src/browse/pictures/` or to the picture packs (those packs are pinned to a fingerprint inside the app).

## 1. How a page reaches the phone
- **Where each kind lives** (see `extra-pages/README.md`): phone-only additions go in `extra-pages/phone/`; pages for BOTH apps, shipped with the next version of each, go in `src/browse/data/` (the phone app compiles the same files); desktop-only additions (later; how the desktop receives them is not decided yet) go in `extra-pages/desktop/`. Never mix them.
- **Built-in pages** live in `src/browse/data/stories.json`, `topics.json`, `children.json` (+ `keywords.json`) and ship inside every app version. Adding to them needs a new app version (Store/Play). Do that only if the owner asks.
- **Additional pages** (the normal way now) are made WITHOUT an app version: a batch folder is turned by `scripts/build_extra_pages.mts` into ONE file, `extra-pages.json`, which the owner uploads as the GitHub release `extra-pages` of `BadBull22/bible` (not marked Latest). On the phone, the button **"Fetch additional stories"** (bottom of Bible stories, Verses for..., For children) downloads it, checks it, keeps it, and adds the pages after the built-in ones. Phones with the 3.0.0 app (from the v3test9 build on, and the Play build made from it) have the button; older apps do not.
- **THE FILE IS CUMULATIVE.** A fetch REPLACES the phone's earlier additional pages with exactly what the file holds. So every build must contain ALL additional pages ever published (old ones plus new ones), never just the new ones. Always start a new batch from a COPY of the newest batch folder (section 2).
- A page whose id already exists in the app keeps the built-in page (the extra one is ignored). A page that fails the phone's own check (not approved, bad reference, missing part) is left out and the others still show.
- Pictures travel INSIDE the file (base64): a story's painting (`pictures`), and a children's page's picture with an optional outline to colour in (`child_pictures`). No download pack is needed for them.

## 2. Folder layout and the commands
The batch folders are in git, under `extra-pages/phone/`; the BUILT files are not (`installer/` is git-ignored).
```
extra-pages\phone\batch-<date>-<name>\          one folder = one COMPLETE (cumulative) set of additional pages
    stories.json      {"format":1,"tags":[],"pages":[...]}      (new tags may be listed in "tags": they are added to the built-in list)
    topics.json       {"format":1,"tags":[],"pages":[...]}      (optional)
    children.json     {"format":1,"pages":[...]}                (optional)
    keywords.json     {"stories":{"<id>":["word",...]},"topics":{...}}   (hidden search words, new pages only)
    pictures\         <story-id>.jpg  + credits.json           (story paintings)
    child-pictures\   <child-id>.jpg, <child-id>-outline.png (optional) + credits.json   (children's pictures)
installer\packs\test-extra-pages.json         the built file (a test copy)
installer\packs\ready-to-upload\extra-pages.json   the same file under the name GitHub must have
```
Steps:
1. `copy` the newest batch folder to a new `batch-<date>-<name>` folder; add or change pages in the copy.
2. Check the words and links against the app's own rules (this is also run by the builder):
   `set BROWSE_EXTRA=X:\Code\bible\extra-pages\phone\batch-...` then `node --no-warnings scripts\test_browse.mts` (all new pages are checked as if they were already in the app).
3. Build: `node --no-warnings scripts/build_extra_pages.mts extra-pages/phone/batch-... --out installer/packs/test-extra-pages.json` (add `--revision "<label>"` if wanted). It runs the step-2 rules, the pictures' checks and the phone's own check, and writes nothing if anything fails.
4. Copy the result to `installer\packs\ready-to-upload\extra-pages.json` (the file MUST be called `extra-pages.json`). Note the sha-256 it prints.
5. Test (section 8), show the owner the text (section 9), then publish only on his word (section 10).

## 3. The three kinds of page: fields, limits (all checked by the tests) and templates
References are always the app's own spelling and ONE chapter: `"1 Samuel 17:32-40"`, `"Psalms 23:1-6"` (the app says **Psalms**, never "Psalm"/"Ps"), `"John 3:16"`. Never a range across chapters. The test rewrites each reference and refuses it if it differs. Names: `Song of Solomon`, `1 Samuel`, etc. (the app's own book names).
`id`: lower-case letters, digits, hyphens; unique across built-in AND batch pages; **permanent** (links and saved places use it; never rename after publishing). `title`: at most 60 characters, unique across all pages. Typographic conventions of the existing pages: curly double quotes “ ” for speech, straight apostrophes ' , Jesus as "he/him" in lower case, LORD in capitals for the divine name, a plain space-hyphen-free style (no dashes for effect).

### 3.1 A Bible story (`stories.json`)
| Field | Rule |
|---|---|
| `id`, `title` | see above |
| `also` | other names people search by: 0 to 6 names, short |
| `testament` | `"OT"` or `"NT"`, must match the book of the FIRST passage |
| `age` | `"all"` |
| `summary` | the story in plain words, **40 to 170 words**, your own sentences, past or present tense kept consistent (the existing stories use the present tense) |
| `look_closer` | optional, one thing to notice, at most 60 words, with verse numbers |
| `lessons` | optional, 1 to 5 sentences of 8 to 50 words each ("what the story teaches"), each ending with its verse reference in brackets |
| `context` | optional `{ref,label}`: one passage to read first |
| `passages` | 1 to 8 of `{ref,label}`, in order; each at most 60 verses; every verse must exist in the BSB (a hard rule); a verse missing in the KJV is only a note, but prefer ranges both Bibles have |
| `whole` | optional: what "Read the whole story" opens; ONE chapter that contains every passage; leave it out if the story crosses chapters |
| `parallels`, `also_read` | optional lists of references (BSB must have them) |
| `people`, `places` | optional ids from People & Places; each must exist AND be cited by a verse in one of the story's chapters (section 5) |
| `tags` | 1 to 6, only from the tag list (built-in tags plus any new ones you list in the file's `"tags"`); built-in list: courage, faith, fear, forgiveness, grace, family, kings, miracles, parables, prayer, trust, hope, healing, prophets, creation, obedience, leaders, friendship, temptation, salvation, covenant, deliverance, mercy, angels, baptism, church, generosity, love, provision, resurrection, spirit, worship, scripture |
| `related` | optional story ids (built-in or in the batch) |
| `topics` | optional topic ids |
| `child_page` | the id of its children's page, or `null`; the children's page must point back (`story` = this story's id) |
| `doctrine` | `"plain"` or `"needs_review"` (section 4); `needs_review` needs `doctrine_note` (1 to 90 words) |
| `review` | `{"status":"approved","rev":1,"date":"YYYY-MM-DD"}` (section 0, rule 2) |

### 3.2 "Verses for ..." (`topics.json`)
`title` must start "Verses for" or "Verses on". `intro`: 1 to 60 words (two sentences). `items`: **8 to 12** of `{ref,note}` (no repeated reference; each ref in the BSB, and preferably the KJV; `note` 1 to 32 words, one plain sentence saying what the passage says; an item may carry its own `doctrine:"needs_review"` + `doctrine_note`). `dictionary`: the word the "More on this subject" button searches in Nave's and Torrey's (must find an entry). Optional `see_also` (topic ids), `stories` (story ids), `also`, `tags` (1 to 6 from the topic tag list: emotions, peace, comfort, family, faith, hope, healing, forgiveness, trust, prayer, needs, fear, grief, guidance, wisdom, strength, joy, thanks, patience, temptation, love, worship, heaven, loneliness, doubt, weariness). Pages on healing, prayer, guidance, the Lord's return, the Holy Spirit and similar are flagged `needs_review`.
Hidden search words are needed for a topic or story to be found by what people type: add them to `keywords.json` (1 to 20 short words or phrases each, never an address).

### 3.3 A children's page (`children.json`)
| Field | Rule |
|---|---|
| `age` | `"3-5"`, `"6-8"` or `"9-12"` |
| `story` | the id of the grown-up story it goes with (that story's `child_page` must be this page's id), or null |
| `read_from` | "read the real story together": one chapter, every verse in the BSB (at most 200 verses) |
| `retelling` | the story in short paragraphs, **60 to 220 words**; average sentence at most **12 words** for 3-5 and 6-8, **16** for 9-12 (the test splits at . ! ? and closing quotes) |
| `message` | "the big idea", 6 to 35 words, 1 to 3 sentences, same sentence-length limit |
| `memory` | `{ref, blanks_hint}`: ONE verse that exists in the BSB (and should exist in KJV, WEB, ASV); `blanks_hint` = up to 4 words from that verse the app may blank |
| `questions` | **exactly 3** of `{q,a}`; `a` is a note for the helper; question 3 is open ("There is no wrong answer. ...") and points to Jesus/prayer |
| `try_this` | optional activity, 1 to 30 words |
| `words` | the word-search words: 3 to **6 (3-5), 8 (6-8), 10 (9-12)** words of 3 to 10 capital letters A-Z, **each must appear inside the retelling** (case-insensitive substring) |
| `doctrine`, `review` | as above |
Voice for children: concrete, warm, Jesus as "he"; "Jesus' friends" for the youngest (disciples is fine at 9-12); no frightening detail; skip anything delicate (for the woman with the bleeding: "sick for twelve years"); the retelling follows the Bible story in order, in your own words; the big idea is what the child can carry away; the memory verse is short and fits the story (it may come from another book, e.g. Psalms).

### 3.4 Empty skeletons to copy
```json
{"id":"","title":"","also":[],"testament":"NT","age":"all","summary":"","look_closer":"","lessons":[],"context":{"ref":"","label":""},"passages":[{"ref":"","label":""}],"whole":"","parallels":[],"also_read":[],"people":[],"places":[],"tags":[],"related":[],"topics":[],"child_page":null,"doctrine":"plain","review":{"status":"draft","rev":1,"date":""}}
{"id":"","title":"Verses for ","also":[],"intro":"","items":[{"ref":"","note":""}],"dictionary":"","see_also":[],"stories":[],"tags":[],"doctrine":"plain","review":{"status":"draft","rev":1,"date":""}}
{"id":"","title":"","age":"6-8","story":"","read_from":"","retelling":[""],"message":"","memory":{"ref":"","blanks_hint":[]},"questions":[{"q":"","a":""},{"q":"","a":""},{"q":"","a":""}],"try_this":"","words":[],"doctrine":"plain","review":{"status":"draft","rev":1,"date":""}}
```
Worked examples of every kind: the built-in pages in `src/browse/data/*.json`; the two written on 2026-11-11 in `extra-pages\phone\batch-2026-11-11-two-stories\` (`stories.json`, `children.json`); more in `research/browse-plan/browse_plan.md` section 4.

## 4. Writing rules and the doctrinal lens
- **Original words, from the Bible text only.** Read the passages (BSB; also KJV for the numbering) before writing. A story summary retells; it never quotes a long run. Quote at most a few words. The 8-word test is strict: "just say the word and my servant will" (8 words) was caught in the BSB and the WEB; change a word in the middle ("Only say the word, and my servant will get well").
- **Accuracy over cleverness.** Say only what the text says. Do not add details the Bible does not give. Name the parallel accounts in `parallels`.
- **Doctrine.** If the page touches a point Christians understand differently (creation days, the flood, Pentecost/the Spirit, healing, the Lord's return, the Lord's Supper, baptism, predestination, the fall...) set `doctrine:"needs_review"` and write a neutral `doctrine_note` (at most 90 words) that says Christians differ and takes no side ("This page says only what the text says"); the owner may add his own box (`church_teaching`, hidden unless filled). When a page must lean, the owner's order is: what Scripture states (with the verses), then the Pentecostal / blood-bought / born-again / pre-tribulation reading labelled as that reading, then other views briefly and respectfully. Positions he has already given (do not re-ask): salvation is a free gift bought by Christ's blood but a reborn person is a new creation who must keep walking in it; women may lead and pastor; the Trinity is one God in three persons, a mystery; **the gifts of the Spirit (tongues, prophecy, healing, miracles) are for today (never write that they ended)**; tithing and giving from the heart (2 Corinthians 9:7); the fear of the Lord as reverence. Healing stories are written plainly: Jesus healed, and faith matters.
- **Delicate subjects**: no graphic detail (suicide, violence, bleeding, sexual matters); keep children's pages gentle.
- **Words the owner dislikes or requires**: never "Easter" (say Resurrection Sunday / Passover); say "pastors, ministers and priests" when naming clergy; no mention of who or what wrote the page.
- **Check the places and names**: a Roman officer is a centurion; a Jewish "ruler of the synagogue" is Jairus; keep Bible names as the BSB spells them.

## 5. Linking pages, and finding people and place ids
- `story.child_page` = the child's id AND `child.story` = the story's id (both directions are tested). `related`/`topics`/`see_also`/`stories` ids must exist (built-in or in the batch).
- **People and places** (optional): ids come from the People & Places data (`src-tauri/resources/commentaries.db`, tables `entities(kind,id,name,...)` and `entity_refs(kind,entity_id,book,chapter,verse,end_verse)`). Find by the VERSES that cite them, never by name alone (three different men are called Darius). Example (Node 24, `node:sqlite`):
```js
const D = require("node:sqlite");
const db = new D.DatabaseSync("X:/Code/bible/src-tauri/resources/commentaries.db", { readOnly: true });
// who/what is cited in Mark 5:25-34?
console.log(db.prepare("select e.kind, e.id, e.name from entity_refs r join entities e on e.kind = r.kind and e.id = r.entity_id where r.book = 'Mark' and r.chapter = 5 and r.verse between 21 and 43 and e.kind in ('person','place')").all());
```
  Only ids cited by a verse in one of the story's passage or parallel CHAPTERS are accepted. Leave the field empty rather than force one (the lake is not cited at Mark 4:35-41, so that story has no map button).
- Hidden search words: `keywords.json` as in 3.2; for stories include the other names, key words a reader may type ("issue of blood", "just say the word", "capernaum"); avoid anything delicate you would not put on the page.

## 6. Pictures
**Stories** get one painting or engraving (public domain, or CC BY / CC BY-SA, with a credit). **Children's pages** get one colour picture and an outline to colour in. Never use a picture whose licence you have not read; never a copyrighted modern picture (the "BMaps" images are copyright: not allowed).
- **Where to look:** the owner's picture library index `src-tauri/resources/pictures.json` (3,251 entries: `id`, `c` = collection, `title`, `refs` = [book, chapter, verse, end] , `credit`, `url`, `page`). Collections: `dore` (Gustave Doré engravings, black and white, public domain), `tissot-nt` (James Tissot's Life of Christ, public domain), `tissot-ot` (Tissot's Old Testament, public domain artwork, scans by Phillip Medhurst under CC BY-SA), `sweet` (Sweet Publishing colour illustrations by Jim Padgett, CC BY-SA 3.0, numbered by chapter: `sweet-<book>-<chapter 3 digits>-<picture number>`). The downloaded files are at `%APPDATA%\com.local.bibleconcordance\pictures\<collection>\<id>.jpg` (on the main PC about 2,155 Sweet, 228 Tissot NT, plus Doré and Tissot OT; any file missing can be fetched from its `url` on Wikimedia Commons: be polite, one request every 10 seconds, a plain User-Agent without personal details).
- **Finding candidates:** list entries whose `refs` match the chapter (Node one-liner over `pictures.json`), then LOOK at the actual images (open the jpg and view it) before choosing; Sweet numbers do not follow verse order closely (Luke 8 picture 33 turned out to be the woman and Jesus although the earlier note said Sweet had nothing for her). Check the real pixel size: the Tissot NT scans on Commons are only 512 px wide (the index says 1280, which is wrong for those); Doré and Tissot OT are 1280 px; Sweet 1280 x 940.
- **Story painting:** prefer Tissot/Doré for the grown-up page. Put `<story-id>.jpg` in `pictures\` and its entry in `pictures\credits.json`. At most 600 KB (JPEG, starts FF D8 FF).
- **Children's picture:** prefer Sweet (colourful, child-friendly). Copy the file unchanged to `child-pictures\<child-id>.jpg`. Pick the scene that fits the retelling and is gentle.
- **Credit entry** (`credits.json`, one object per page id; all six fields required, plain text; `licence` must contain "public domain" or "CC BY"):
```json
{"<id>": {"title":"Gospel of Luke, chapter 8, picture 33","artist":"Jim Padgett, Sweet Publishing","credit":"Biblical illustrations by Jim Padgett, courtesy of Sweet Publishing, Ft. Worth, TX, and Gospel Light, Ventura, CA","licence":"CC BY-SA 3.0","licence_url":"https://creativecommons.org/licenses/by-sa/3.0/","page":"https://commons.wikimedia.org/wiki/File:...","collection":"Sweet Publishing — Bible illustrations","id":"sweet-luke-008-33"}}
```
  Copy `credit`, `page` and `url` from the picture's own entry in `pictures.json`; for Tissot: `"credit":"James Tissot; Brooklyn Museum"`, licence "Public domain", `licence_url` `https://creativecommons.org/publicdomain/mark/1.0/`. The phone shows the credit under the picture with a "Source" link to `page`, and writes it into the shared text.
- **Outline to colour in:** make a black-on-white PNG from the colour picture with `extra-pages\tools\make_outline.py <in.jpg> <out.png>` (OpenCV adaptive threshold on the pen lines, the picture's frame whitened, specks removed, 1-bit PNG about 15 to 30 KB). It works well on Sweet's pen-and-wash style; look at the result (faces can be rough); name it `<child-id>-outline.png` beside the jpg. At most 300 KB. Each children's picture may have one.
- **Licence duty for CC BY-SA:** keep the credit, name the licence, link the source, and say when you changed the picture. **The outline is an adaptation of the picture**: strictly it needs "Outline made from this picture" in its credit and must itself be shared under CC BY-SA. (As built in v3test11 the caption does not yet say "outline made from"; tell the owner and, if he agrees, add a short sentence to the caption shown while the outline is displayed, in `KidFigure`, `mobile/src/Pictures.tsx`.) Resizing or recompressing a JPEG is also a change: say "Shown at a smaller file size" (the story caption already does).
- **Budget:** the whole file may be at most **6 MB** (`MAX_BYTES` in `mobile/src-tauri/src/extra_pages.rs`), at most 1,000 pages and 40 pictures per list. A Sweet picture is about 150 KB (base64 ~200 KB) + 16 KB outline; a Tissot painting 70 to 100 KB. So a file with pictures holds roughly 15 to 20 fully illustrated stories before it needs shrinking: resize Sweet pictures to about 1000 px wide at JPEG quality 82 (about 70 KB), or, if the owner agrees, raise `MAX_BYTES` (an app change and a new installer).

## 7. Reader-facing look (so you know what the owner will see)
Story page: title, "Also called", the painting with its credit, summary, "Look closer", "What the story teaches", the passages (each opens the Bible text), "Read the whole story", other Gospels, "Also read", people and places, "Go further" (button to the children's page, related stories), Share. Children's page: title, age, picture + credit + "Outline to colour in" button, retelling, "The big idea", "Read the real story together", "Memory verse" (BSB text opens), "Talk about it" (three questions, "Show the answer"), "Try this", a button to the grown-up page, Share. The word search and fill-in-the-blank sheets exist on the computer app only; the phone does not make them.

## 8. Testing (do all of these before showing the owner a build)
1. `node --no-warnings scripts/test_browse.mts` with `BROWSE_EXTRA` set (section 2), then the builder.
2. `cd mobile && npx tsc --noEmit -p .` and `npx tsc --noEmit` in the repo root; node tests `for f in mobile/scripts/test_*.mts; do node --no-warnings $f; done`.
3. `cd mobile/src-tauri && set CARGO_HOME=%USERPROFILE%\.cargo && cargo test --lib extra_pages` (foreground, debug build; the whole-crate `cargo test --lib` shows 5 failures in `sermon`/`people_qa` on this PC because `mobile/src-tauri/resources/bible.db` and `study.db` are 0-byte placeholders: not your change).
4. Phone-sized browser check with the harness `E:\tmp\pp` (local test tooling outside the repository: puppeteer-core with Edge): `npx vite build --outDir E:/tmp/vite-check --emptyOutDir` in `mobile`, `npx vite preview --outDir E:/tmp/vite-check --port 4173`, then `node kid_extra.mjs` (children's pages with their own pictures, outline switch, credit, Share, story page, links) and `node share_extra.mjs`. The harness stubs the phone's native calls and reads the real `test-extra-pages.json`.
5. **Emulator** (`Medium_Phone_API_36.1`, adb `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`): it boots a SNAPSHOT of an older state, so re-install the APK after every restart; start it with `emulator -avd Medium_Phone_API_36.1 -no-snapshot-save -no-audio` (no `-gpu swiftshader_indirect`: blank screenshots). To test the FETCH without publishing: build a TEST apk for x86_64 only with the address compiled in, `set BC_EXTRA_PAGES_URL=http://10.0.2.2:8765/extra-pages.json` then `mobile\scripts\android.ps1 -Release -Play -TestApk -SideBySide -Targets "x86_64" -VersionCode <n> -Suffix "-localtest" -OutDir E:\tmp\emu-build` (never into `installer\`, never given to the owner), serve `extra-pages.json` with a small Node `http.createServer` on port 8765 with a `Content-Length` and WITHOUT `Connection: close`, install the apk, and press the button (Extras > Bible stories > scroll to the end). Check the new stories at the end of the list, the story's picture, the children's page picture, the credit, and the outline button. Screenshots: use `adb exec-out screencap`; taps by coordinates (screenshots shown at 900 px wide are 1080 px real: multiply by 1.2).
6. **This PC's antivirus (Avast) is running and spoils some tests:** Rust says "UnknownIssuer" for https; the emulator can get a large local file a few bytes short when the server closes the connection at once (hence the keep-alive server); local Rust tests with bodies over about 200 KB can stall and reset. Do not chase these as app bugs. A real fetch from GitHub cannot be tested from this PC; the first real test is the owner's phone after publishing.
7. Build the installer only when the owner asks or says so: `$env:CARGO_HOME="%USERPROFILE%\.cargo"; & X:\Code\bible\mobile\scripts\android.ps1 -Release -Play -TestApk -SideBySide -Targets "aarch64","x86_64" -VersionCode <n> -Suffix "-<name>-sidebyside"`; after it, check the apk (package `.v3test`, versionCode, signature, no `10.0.2.2`/`BC_EXTRA` test address inside, the real `releases/download/extra-pages/extra-pages.json` address present). A new batch of PAGES needs NO new installer (only the uploaded file changes); code changes do.

## 9. Showing the owner the work (what he asked for)
Paste each page's text in full, in reading order, with headings (title, age, passages, memory verse, questions with answers, activity, word-search words; for stories the summary, look closer, lessons, passages). Say which sentences you are unsure about and why. Make the changes he asks for, re-run the checks, rebuild the file, and tell him the new sha-256 and size. Only then does the page count as approved. He reviews the words, not JSON.

## 10. Publishing (ONLY on the owner's word, each time)
- First time: `gh release create extra-pages "X:\Code\bible\installer\packs\ready-to-upload\extra-pages.json" --repo BadBull22/bible --title "Additional stories" --notes "Additional Bible stories, verse pages and children's pages for the phone app." --latest=false`
- Later: `gh release upload extra-pages "<same file>" --repo BadBull22/bible --clobber` (replaces the file; every phone gets the new pages the next time its reader presses the button).
- NEVER mark this or any pack release "Latest"; never delete the pack releases (`story-pictures-v1`, `kids-pictures-v1`, `original-words-v1`, `search-upgrade...`). The repo stays public: publishing the file makes the pages public to anyone, though only phones with the new app can use them.
- After uploading: `curl -sIL https://github.com/BadBull22/bible/releases/download/extra-pages/extra-pages.json` should end in 200 with the right size; then the owner presses "Fetch additional stories" on his phone. Without the file the button says "There are no additional stories yet."
- Record in `PHONE_UPGRADE_TODO.md` section 9 and the newest handover what was published (date, sha-256, page ids).

## 11. Things that go wrong
- "not approved": the page's `review.status` is `draft`. "the phone would leave out ...": see the reason; the phone is stricter about shape than the writing test.
- Duplicate `id` or `title` (also against the built-in pages); a tag that is not in the list; a passage verse missing in the KJV (numbering differs: pick another range); a passage crossing chapters; `whole` not containing every passage; `testament` not matching the first passage.
- 8-word runs copied from a Bible (also in questions and answers): rephrase.
- A word-search word that is not inside the retelling; more words than the age band allows.
- Sentences too long for the age band (the average, not each sentence).
- A memory verse that is more than one verse or is missing in the BSB.
- People/places ids not cited in the story's chapters.
- A picture over 600 KB, an outline over 300 KB, a credit with an empty field, a licence that is not public domain / CC BY / CC BY-SA.
- The file over 6 MB. The phone shows "That file is larger than this app takes."
- Forgetting that the file is cumulative: publishing only the new pages would remove the earlier ones from every phone at its next fetch.
- Editing `src/browse/data` by accident: the extra stories must stay out of it.

## 12. Where things are
- Writing rules and the test: `scripts/test_browse.mts`; types: `src/browse/types.ts`; the plan and examples: `research/browse-plan/browse_plan.md`; the file builder: `scripts/build_extra_pages.mts`; the phone's own check: `mobile/src/extraValidate.ts`; the fetch: `mobile/src-tauri/src/extra_pages.rs`, `mobile/src/extraPages.ts`; pictures on the phone: `mobile/src/Pictures.tsx`, `mobile/src-tauri/src/picture_packs.rs`; share text: `mobile/src/shareText.ts`.
- The outline maker: `extra-pages\tools\make_outline.py`. The current batch: `extra-pages\phone\batch-2026-11-11-two-stories\`.
- Earlier private drafts and review sheets (not in git): `research/browse-drafts/`; an older sample batch: `research/extra-pages-sample/`.

## 13. Checklist for a new batch
[ ] Read this guide and the newest handover. [ ] Copy the newest batch folder (it is cumulative). [ ] Read the Bible passages. [ ] Write the pages (original words, limits, doctrine flags, owner's wording rules). [ ] Link story <-> children's page, related, topics. [ ] People/places ids only if cited. [ ] Hidden search words. [ ] Pick and LOOK at pictures; credits.json; outlines for children's pictures. [ ] `test_browse.mts` with `BROWSE_EXTRA`, then the builder. [ ] tsc, node tests, cargo test extra_pages, browser run. [ ] Emulator fetch test (test apk, keep-alive server). [ ] Paste the full text to the owner; apply his changes; rebuild. [ ] Copy to `ready-to-upload\extra-pages.json`; note sha-256. [ ] Ask before publishing; after it: record it. [ ] Back up the batch folder and update the handover and memory.
