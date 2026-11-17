# Story Studio (private tool, never part of the apps)

**Start it:** double-click `Start Story Studio.bat` (it needs Node, which this project already uses). The page opens at http://localhost:4177. Close the black window to stop it. It runs on this computer only, writes only inside this project, and NEVER uploads or publishes anything.

**How the work is shared (so nothing is done twice)**
1. **You choose** on the "What to write" board: tick "I want this" on the stories you want next.
2. **The words are written** in the chat and saves each story as a draft in `extra-pages/drafts/<id>.json` (git-ignored: unapproved words stay private).
3. **You read** each draft in the Studio ("Drafts"): the story, the lessons and the Bible verses under each passage as the reader will see them. Edit anything in the boxes, or ask for changes.
4. **The Studio checks** ("Check the words"): the app's own rules in plain words (length, Bible references, no copied Bible wording, people and places, tags).
5. **You approve** ("I have read every word: Approve"). Only your button records approval and the date; editing a page takes the approval back.
6. **Make the file** collects every story already added plus everything you approved, runs the builder and puts `extra-pages.json` in `installer\packs\ready-to-upload\`. Publishing is a separate step: say "publish the new stories" when you are happy.

**Draft file format:** `{ "page": { ...a story as in src/browse/data/stories.json... }, "keywords": ["hidden search word", ...], "wanted": 12 }` (`wanted` is the board number, optional). Rules for writing the words: `extra-pages/GUIDE_ADDING_STORIES_AND_PAGES.md`.

**Pictures:** the draft editor has a Picture box (the paintings already downloaded on this computer for the story's chapters; credit and licence are added for you).

**Not built yet (next):** children's pages (with picture and outline), a size warning for the file's limits (6 MB, 40 pictures), and a publish button with a confirmation phrase. The board list is `wanted.txt` (one line per story; edit it to add more).
