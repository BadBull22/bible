# Handover — 2026-10-22 — the step-by-step sermon builder, and moving slides (the sermon follows)

Read this first for the sermon builder and the slides. Everything below is **written, type-checks, passes its tests and has been
walked through in the dev app, but is not committed, not built into an installer and not published.**

## 0. Start here

- **Where it stands:** two pieces of work are in the working tree, both for the owner's own sermon preaching:
  1. a **step-by-step sermon builder** (the new default), beside the old builder (now "Full builder");
  2. **slides that can be dragged with the mouse**, with the sermon changing the same way, a button to make the sermon match the
     slides, an Undo at the top of the Slides page, and a fix so the last change is never lost when leaving a sermon.
- **Cleaned up at the end of the session:** the dev app was stopped and the temporary debug-port line was removed from
  `src-tauri/tauri.conf.json` (`git diff src-tauri/tauri.conf.json` shows only the 2.9.4 → 2.9.5 version change). The test scripts used
  were scratch files outside the repo (see §6 for the recipe).
- **First things next time, in this order:**
  1. Ask the owner how **dragging a slide by hand** feels. It took three rounds (§3.2) and was only ever tested with scripted real
     mouse input, never by a person's hand after the last rebuild.
  2. The sermon **outline** (`SermonOutline.tsx`) almost certainly cannot drag points on Windows (§5.1). Offer to fix it.
  3. **Commit** only when the owner says so (§5.3), then build and let the owner review before anything is published.
- **Standing rules from the owner:** remind them to turn off the antivirus shields before any Rust or Tauri compile; build locally,
  show the result, publish only after their OK; one installer for everyone; nothing here depends on any optional download.

## 1. Where things stand

| | State |
|---|---|
| Step-by-step builder (8 steps) | Done, tested in the dev app (passage route and subject route), dark and light, narrow window |
| Moving slides with the mouse | Done, rebuilt three times after the owner's feedback; real-mouse tested; **not tried by hand since the last rebuild** |
| Sermon follows the slides | Done: moves, "Make the sermon match the slides", saved to the database (checked by reading it back) |
| Undo at the top of Slides | Done, with a label ("↶ Undo: moved a point and its slides") |
| Autosave on the way out | Fixed (a change made within 2.5 s of leaving a sermon was lost; found by testing) |
| Help text | Updated (two ways to build; the Slides paragraph) |
| `npx tsc --noEmit` | Clean |
| `node scripts/test_sermon_layout.mts` | Passes |
| `node scripts/test_slide_order.mts` | Passes (85 single moves on two sermons, 300 random shuffles, and more) |
| Committed / published | **No** |
| Built | **A local, unsigned TEST installer only (2026-10-23, for the owner to install and try a live session):** `installer/test/BibleConcordance_2.9.5_TEST_2026-10-23_x64-setup.exe`, 378,035,674 bytes, sha256 `c8816f62a57ce266136192b409e32c274875ced4a2c568b055368b6effdcd541`. Built from the working tree as it stood (2.9.5: the step-by-step builder, slide dragging, "match", Undo, the save-on-leaving fix, and the earlier 2.9.5 items). NSIS only, `createUpdaterArtifacts` off, no debug-port line in it (checked in the binary). `installer/` is git-ignored. The older `…_2.9.5_TEST_x64-setup.exe` (21 Oct) is superseded. Not a release: no signing, no MSI, no `latest.json`, nothing uploaded. |
| Version in the tree | 2.9.5 (the version bump and the 2.9.5 panel and scroll fixes were already in the tree, uncommitted, before this work) |

## 2. The step-by-step sermon builder

### What the owner asked for
Two ways to build a sermon: **Step by step** (choose the topic; the app guides through scripture, storyline, cross-references,
dictionaries, more Scripture, pictures, links, music and the ending) and the normal **Full builder**. Their choices: collect first and
write afterwards (editing after a complete draft); include commentary; the standard search data works without any optional download;
step by step is the default with a tick box for the other; at most 8 steps. The owner later said they **like the way it presents**
("it was pretty easy" to make a sermon).

### The eight steps

| # | Step | What it does |
|---|---|---|
| 1 | Passage | A passage or a subject. A passage is cut into its natural parts; each part kept becomes a point. A subject lists key passages, or "preach the subject in points" (no single passage). The next two Sundays' readings are offered. |
| 2 | Storyline | Pick a shape (expository, big idea, narrative, points; problem→answer for a subject). Name and reorder the points; write the big idea and purpose. |
| 3 | Understand it | Commentary and background, Hebrew and Greek words, dictionaries and people; "Look up a word". |
| 4 | Connect | Cross-references (each goes to the point it is tied to), more Scripture to read with it. |
| 5 | Stories & more | Stories, Simeon's outlines, Spurgeon's sermons, and "+ Add a picture, photo, video, song or link". |
| 6 | Close | Conclusion, call to respond, prayer; a closing verse. |
| 7 | Write it | One point at a time, with what was collected beside the writing space. |
| 8 | Finish | A checklist (title, big idea, each point, Testament balance, minutes), then Review, Print, Slides, Preach, Save, or switch to the full builder. |

Every step has a one-line reason in plain words, can be skipped, and "Your sermon so far" on the right grows as things are added.
It is the same sermon underneath, so switching modes loses nothing.

### Rules worth knowing
- A new sermon starts in **guide** mode unless the owner last ticked "Full builder" (`localStorage sermon:mode`).
- A saved sermon with content but no mode (everything saved before this) opens in the **full builder**; an empty one opens step by step.
- Cross-references go to the point of the verse they are tied to ("…, from verse 3" in their source line, read by `homeOf`);
  everything else goes to the point being worked on, or into its place by kind and verse (`pointOfRef` / `placeMaterial`, which also
  improves the full builder: commentary on John 3:5 goes into the point on 3:1–7).
- Story keys include the source line, because some of Simeon's outlines have no title of their own.
- On a subject with no main passage, the words, cross-references and stories are about the first key passage found, and the screen says so.

### Files
- `src/guideData.ts` — the step list, the `GuideState` saved with the sermon, the `GuideContext` the steps share, and the functions that turn found data into sermon material.
- `src/components/SermonGuide.tsx` — the shell (stepper, header, "so far" panel, Back and Next); builds the kept parts when step 1 is left.
- `GuidePassage.tsx` (1), `GuideStory.tsx` (2), `GuideResearch.tsx` (3 to 5), `GuideFinish.tsx` (6 to 8), `GuideParts.tsx` (shared cards, lists, "Add to").
- `SermonOutline.tsx` — optional `only` and `expand`, used by step 7. `sermon.ts` — `SermonBody` has optional `mode` and `guide` (older sermons load unchanged).
- `SermonBuilder.tsx` — `Work.mode` and `Work.guide`, the header tick box, `setSections`, `toggle(m, home)`, `guideContext`.
- `App.css` — the `.sg-*` styles at the end (theme variables only, so dark and light both work).

## 3. Slides: move them with the mouse, and the sermon follows

### 3.1 What the owner asked for
"The slides don't follow my train of thought, so I want to drag a slide up or down in the list, and the sermon must be adjusted in the
same way so the slide and the sermon match." Later: a button to make the sermon match the slides, and an Undo at the top.

### 3.2 How it went (so the next person does not repeat it)
1. **First version used HTML5 drag and drop** (`draggable`, `onDrag*`). It tested fine with synthetic events and **did not work at all in
   the owner's window**: on Windows, Tauri's own file-drop handling swallows the webview's HTML5 drag events (`dragDropEnabled`, default
   true; Tauri's docs say it must be off for HTML5 drag and drop). Lesson: **test with real mouse input, not synthetic events.**
2. **Second version followed the mouse directly** (pointer events on the window). The owner: "still very poor", slide 2 would not drag
   (the big idea had been pinned), the list jumped, drops felt hit and miss.
3. **Third version** (current): live reflow, then it stays. The owner: "dragging looks better, it just doesn't slot in and drops back".
   That was a **real bug** in how the sermon was changed (§3.4), not only the interface.

### 3.3 What it does now
- **Press a slide and move 5 px**: a copy of the slide, held where it was grabbed, follows the pointer. The other slides slide aside
  (CSS `--aside`, a short transition) to open the slot it would land in, the carried slides wait in it outlined. The slot is the legal
  slot nearest to where the copy is. Let go: it stays there and is highlighted for a second. **The list on screen while carrying is
  exactly the list afterwards** (10 of 10 real-mouse drags matched).
- **Escape cancels.** A button let go unseen (outside the window), a lost window focus or `pointercancel` also end the carry with no drop.
- **The list scrolls by itself** only when the pointer is pushed further towards an end than where it was picked up (after 200 ms,
  slowly at first). A slide picked up near an edge does not run away. The chosen slide is kept in view (not while carrying).
- **Units:** a **point's slide** moves the whole point with everything under it (and the slides of that); it can only land between
  points; a Conclusion stays last. A **passage's slides** (a long one runs over several) or a **picture's** move as one unit into the
  point where dropped. The big idea and slides the preacher added are free-moving "own" slides (moving one makes the slides "your own";
  it changes nothing in the sermon). **Only the title slide is fixed.**
- **▲ Earlier / ▼ Later** (below the slide being edited) do the same thing, one step at a time.
- **Make the sermon match the slides:** a bar above the list appears only when the sermon is in a different order from the slides, with
  the button. It puts the points in the slides' order, then each passage or picture in the point whose slides it follows; what the
  slides don't show stays with its point; what is already right isn't touched.
- **Undo at the top of the Slides page** (the sticky bar) says what it will take back and takes slides and sermon back together. The
  header Undo and Ctrl+Z use the same history (`change(f, label?)`; `undoStack` holds `{ w, label }`). Only slide changes are labelled so
  far; the guide's changes show a plain "Undo".
- **Saving:** a saved sermon is saved again after a move in 0.3 s (`quick`); other edits keep the 2.5 s wait. Checked by reading the
  saved sermon back from the database. **Found and fixed:** a change made within 2.5 s of leaving the sermon (New, opening another,
  closing the builder) never reached the database, for every kind of edit. `saveNow()` now runs before `startNew`, before
  `openSaved`, when the builder closes and on `beforeunload`; and `save` only writes the id and title back into the sermon on screen if
  it is still the same one (`workRef.current.id === w.id`), because a save made on the way out used to be able to hand the old
  sermon's id to the new one. A sermon that has never been saved is kept only as a local draft until Save is pressed, as before.

### 3.4 How it works (the idea)
- **`SlideSpec.from`** (`sermonOutputs.ts`) is the id of the sermon item a slide was made from (a heading, a passage, a picture or link),
  set by `slidesOf`; `pinned` marks the title slide only (`fixed()` in `slideOrder.ts`; older saved slides also had the big idea marked
  pinned: that is ignored). Extra fields on a slide are harmless to the PowerPoint export (the Rust side ignores unknown fields).
- **`src/slideOrder.ts`** (new, pure, runs under Node): `unitOf` (what moves with a slide), `dropGap` (where a drop really lands, or
  null), `stepGap` (the Earlier/Later steps), `moveSlides` (the list after a move), `moveInSermon` (the sermon after the same move),
  `syncSermon` and `sermonFollows` (the "match" button), and `slotFor` (below).
- **Why it used to drop back:** a point keeps *Scripture, then its own sections, then pictures*. A picture or video dropped above a
  passage in the same point went into its usual Illustrate section, which is after the passage, so the slides made again from the
  sermon put it back. **`slotFor`** now puts an item exactly where the slide order says: straight after the item its slide follows;
  straight under a heading, at the start of the section that takes it only if that section starts before the point's first slide, else
  straight after the heading; at the very top, before the first thing the slides show. In `SermonBuilder` the move is one `change`;
  slides that follow the sermon are made again from it (`slides: null`), and the landing place is found in the made-again list.
- **`SlidesEditor.tsx`:** `press()` takes a snapshot at the start of a carry (where every slide is, the legal slots, how far each would
  move aside for each slot) and then only does arithmetic on pointer moves; the carried copy is positioned with `style.transform` (no
  re-render per move); state changes only when the chosen slot changes. `SermonBuilder.tsx` builds the `SlideOrder` object (`slideOrder`).

## 4. Tests

**Automated (run from `V:\Code\bible`):**
- `npx tsc --noEmit`
- `node scripts/test_sermon_layout.mts` — placement in the sermon (including `pointOfRef`).
- `node scripts/test_slide_order.mts` — `allMoves` tries **every** single move of two sermons (a three-point one, and one shaped like the
  owner's: sections before the first point, words, an article, a story, a video; 85 moves) and requires the slides made again from the
  moved sermon to equal the dropped order, both ways; Earlier/Later; the fixed title; chunks; own slides; the big idea; "match" after
  every scenario; 300 seeded random shuffles of the slides. Node cannot load modules that reach the Tauri layer (`sermon.ts`,
  `sermonOutputs.ts`), so the test makes its slides with a small copy of the rule, and `slideOrder.ts` imports `sermonLayout.ts` with the
  `.ts` extension (the project allows it).

**In the dev app, with real mouse input** (Chrome DevTools Protocol `Input.dispatchMouseEvent`: press, move, release), always on a
**throwaway sermon**: a click chooses; a carry shows the copy and the slots opening; Escape cancels; a fast flick; a button let go
unseen; the big idea carried; a slide picked up at the bottom edge (the list does not move; pushed on, it scrolls); a point carried
up and down a long list; a passage carried into another point; a video carried above its passage (the old bug); 10 of 10 drags
where the list while carrying equalled the list after letting go; Undo; "make match"; and saving: saved a throwaway, dragged, read it
back with the `sermon_get` command, reopened it from My sermons, and deleted it with `sermon_delete`.

**Not tried:** a person's hand on the third version; a real Preach run from step 8; the content of Print and the PowerPoint for a sermon
built step by step (only that the tabs open); the installed build; the phone (this is desktop only).

## 5. Open items and next steps

1. **Ask how dragging feels by hand.** If it is still off, the things most likely to need tuning: the 5 px start distance, how strongly the
   slot follows the copy (it uses the grabbed slide's top), the auto-scroll zone (50 px) and delay, the size of the highlight.
2. **The sermon outline probably cannot drag on Windows (§3.2).** `SermonOutline.tsx` drags points and items with HTML5 drag and drop.
   Not checked by hand. Either use the same mouse approach, or set `"dragDropEnabled": false` on the window in `tauri.conf.json`
   (nothing in `src` or `src-tauri/src` uses Tauri's file-drop events; that was checked by search; it would need a rebuild).
3. **Commit** (only when asked). Stage by explicit path, scan the diff for emails and keys, use the BadBull22 identity.
   - New files: `src/guideData.ts`, `src/slideOrder.ts`, `src/components/{SermonGuide,GuidePassage,GuideStory,GuideResearch,GuideFinish,GuideParts}.tsx`, `scripts/test_slide_order.mts`, this handover.
   - Edited by this work: `src/components/{SermonBuilder,SlidesEditor,SermonOutline,HelpPanel}.tsx`, `src/{sermon,sermonLayout,sermonOutputs}.ts`, `src/App.css`, `scripts/test_sermon_layout.mts`, `HANDOVER.md`.
   - **Already in the tree before this work (the 2.9.5 items, keep separate or say so in the message):** the version bumps (`package*.json`, `Cargo.toml`, `tauri.conf.json`, the phone's), `src-tauri/src/offline_ai.rs`, `src/App.tsx`, `src/components/{OfflineAiPanel,SermonBuild}.tsx`, and part of `App.css` and `HelpPanel.tsx`. Use `git add -p` for those two shared files, or commit everything together and say so.
4. **Build and review:** remind the owner to turn off the antivirus shields first; build locally; show it; publish only after their OK. The
   release notes should describe "Step by step sermon builder", "Full builder" and "drag slides to reorder; the sermon follows", and
   nothing else about how any of it is made.
5. **Smaller ideas, none built:**
   - A topical sermon's points start as "Point 1, 2, 3" with no Scripture (Finish flags it); offering a key passage per point in step 2 would help.
   - Step 7's checklist counts any typed text, including a note on the Scripture; "17 sections are still empty" in Finish may read as alarming.
   - Label the guide's own changes for the Undo button ("moved a point", "added a story").
   - Slides edited and saved before the `from` field existed (earlier on 2026-10-22) have no link to the sermon, so dragging them moves only
     the slides; "Make them from the sermon again" (loses their edits) links them. Matching them back by kind and title was considered and left out.
   - The "My sermons (n)" count on the tab can be stale after a sermon is deleted from outside the page; it refreshes on the next save.
   - No Android version of any of this.

## 6. Things learned (gotchas)

- **Testing recipe.** Add `"additionalBrowserArgs": "--remote-debugging-port=9222 --remote-allow-origins=*"` to the window in
  `src-tauri/tauri.conf.json`, run `npm run tauri dev` (log to `%TEMP%\bible_dev.log`), and drive the page over port 9222 with a small
  WebSocket client (`Runtime.evaluate` to read and click; `Input.dispatchMouseEvent` for real mouse input; `Page.captureScreenshot`).
  The app's own commands can be called from the page: `window.__TAURI_INTERNALS__.invoke("sermon_list")`. **Remove the line afterwards**
  and stop the dev app first (editing the config while it runs restarts it). A throwaway sermon: Study → Sermon builder → New, type
  "John 3", Find, Next; never press Save unless the test deletes its own row afterwards. **Never test on the owner's own sermon.**
- **Hot reload can bite a running test:** editing a file while a script runs can make the page reload mid-test and give a misleading result.
- **Undo restores the whole `Work`** (it keeps the current tab). It is also how to put back anything a test did.
- **The shell:** long inline Python or `\n` escapes in bash heredocs got mangled; write scripts with the file tool and run them.
- **React keys:** a duplicate-key warning in the console meant two stories with the same key (fixed by including the source line).
- **Dark mode:** do not hard-code text colours on `--accent-100`; it is dark in dark mode (that bit the first `.sg-why` banner).
- A **sermon item has a fixed internal order** (Scripture, own sections, pictures); anything that moves items must check the *regenerated*
  slides equal what the user dropped, which is what `allMoves` does.

## 7. Where the owner's own sermon stands

"Healing - Your faith has healed you" (saved id 6) was on screen at the end. Its slides are the owner's own edited slides (with `from`
links), and its sermon and slides were in the same order when last checked. One test move made on it by mistake was undone and the list
checked against the order printed beforehand. The four test sermons saved during the session were deleted; the database holds the owner's six.
