# Handover — 2026-10-23 — a test installer is with the owner for a live session; where everything stands

Read this first. It says where things are **right now**. The detail of the work itself (the step-by-step sermon builder, moving slides,
how it was tested, the gotchas) is in `HANDOVER_2026-10-22_GUIDED_BUILDER.md`; this file does not repeat it.

## 0. Start here

- **The owner is installing a TEST build and will run a live session with it.** Nothing more is needed from the code until they report.
  The first job next time is to **ask how it went** (§2) and write down what they say.
- **Nothing is committed, nothing is published.** HEAD is `74d3850` (the same as the remote's `master`); the latest GitHub release is
  still **v2.9.4** (desktop and Android). Everything new sits in the working tree (§4).
- **Clean at the end of this session:** no dev app or build running, no debug port open, no debug-port line in
  `src-tauri/tauri.conf.json` (its only change from the last commit is the version, 2.9.4 → 2.9.5).
- **Checked again just before writing this:** `npx tsc --noEmit` clean; `node scripts/test_sermon_layout.mts` and
  `node scripts/test_slide_order.mts` pass; the working tree has the same 28 changed or new paths (not counting the phone's files and
  the lock files) as the day before.
- **Standing rules from the owner (still apply):** remind them to turn off the antivirus shields before any Rust or Tauri compile and
  wait for their yes; build locally, show them, publish only after their OK; one installer for everyone; test on throwaway data and
  never touch their own sermon (if it slips, undo it and say so).

## 1. The test installer

| | |
|---|---|
| File | `V:\Code\bible\installer\test\BibleConcordance_2.9.5_TEST_2026-10-23_x64-setup.exe` (the shared drive, so both of the owner's PCs reach it) |
| Size | 378,035,674 bytes |
| SHA-256 | `c8816f62a57ce266136192b409e32c274875ced4a2c568b055368b6effdcd541` (the copy was compared with the build output) |
| Built | 2026-10-23 about 13:38, from the working tree as it stood, after the owner turned the antivirus shields off |
| Version it reports | 2.9.5 (newer than the latest release 2.9.4, so it will not offer to update) |
| What it is | **Unsigned**, NSIS only (no MSI), updater files off. A test build, not a release: no `latest.json`, nothing uploaded |
| What is in it | The step-by-step sermon builder (the new default) with the Full builder tick box; dragging slides with the mouse; the sermon following the slides; "Make the sermon match the slides"; Undo at the top of Slides; saving a sermon before leaving it; the earlier 2.9.5 items that were already in the tree |
| Checked | The file exists and the copy matches; the debug-port line is not in the app (searched the binary); the new screens' text is in the bundled web files |
| Older file | `installer\test\BibleConcordance_2.9.5_TEST_x64-setup.exe` (21 October) is out of date: it lacks all of the above |
| Kept out of git | `installer/` is git-ignored |

**How it was built** (about 8½ minutes; the Rust output goes to `C:\Users\admin\AppData\Local\bible-concordance-build\cargo-target`):
`npm run tauri build -- --bundles nsis --config <a small JSON file containing {"bundle":{"createUpdaterArtifacts":false}}>`.
The config goes in a file because quotes in the command were not safe through npm on Windows. The updater signing key's password cannot be
typed in this shell, which is why a test build skips signing. The bundle is at
`...\cargo-target\release\bundle\nsis\Bible Concordance_2.9.5_x64-setup.exe` before it is copied.

**What the owner was told to expect:** Windows may warn about an unknown publisher (More info → Run anyway); it installs over the current
copy and keeps their sermons; it calls itself 2.9.5; no updates are offered.

## 2. What to ask after the live session

Their words matter more than my checks. Ask, and record the answers in this file or the next handover:

1. **Dragging a slide by hand.** It took three rounds to get here (HTML5 drag did not work at all on Windows; the first mouse version was
   hit and miss; the third has the slides move aside live and the move stays). It has only ever been tested with scripted mouse input.
   Does it feel right? If not, the likely knobs are: the 5 px start distance, how the slot follows the copy, the auto-scroll zone and
   delay, the size of the highlight.
2. **Making a sermon the step-by-step way**, then moving slides: does the sermon follow? Did "Make the sermon match the slides" or the
   Undo at the top ever behave in a way they did not expect?
3. **Leaving a sermon straight after a move**, then reopening it: was the new order kept?
4. **Preach** (the full-screen pulpit view) and **Print / PowerPoint** for a sermon built step by step. These were never tried beyond opening
   the tab. Is the printed sermon and the PowerPoint right?
5. **The owner's dev-app test on 2026-10-22** (before the shutdown) — they said they did one. What did they find? It was not recorded.
6. Anything else that felt slow, confusing or wrong.

## 3. What to do with the answers

- **Fixes:** change the source, run `npx tsc --noEmit` and the two test scripts, and build a new test installer the same way (remind about
  the antivirus first). Name it with the new date so it cannot be mistaken for an old one.
- **Outline dragging:** `SermonOutline.tsx` drags points and items with the browser's own drag and drop, which very likely does not work on
  Windows (same cause as the slides' first failure). Not checked by hand. Offer to fix it with the same mouse approach, or by setting
  `"dragDropEnabled": false` on the window in `tauri.conf.json` (a search found nothing in `src` or `src-tauri/src` that uses Tauri's
  file-drop events; it would need a rebuild).
- **If the owner is happy and asks for a release (2.9.5):** do it in this order, and stop for their OK before the upload.
  1. **Commit** (§4), only when asked.
  2. **Build properly**: shields off first; the same build as above but with updater files on for both bundles (NSIS and MSI), or build
     without them and sign each bundle by hand with `npx tauri signer sign -f <key> -p "" <bundle>` (the key is at
     `~\.tauri\bible-concordance-updater.key`, outside the repo; never commit it).
  3. **Collect** with `scripts\release.ps1 -SkipBuild` (it checks the three version numbers agree, copies the bundles and `.sig` files into
     `installer\`, writes `latest.json`, and prints the `gh release create` command; it never publishes by itself). Verify each signature
     against the local file and again against the file downloaded back from GitHub.
  4. **Review before publishing:** show the owner the installer; publish only after their OK. Release notes in plain words:
     "Step by step sermon builder", "Full builder", "drag slides to reorder; the sermon follows", and nothing about how anything is made.
  5. **Website:** follow "Updating for a new version" in `HANDOVER_WEBSITE.md` (the versions are typed by hand; the Windows pages and the
     home page's Windows card). The Android pages stay at 2.9.4: none of this was built for the phone.

## 4. What is in the working tree (for the commit, when asked)

Stage by explicit path, scan the diff for emails and keys, use the BadBull22 identity.

- **New:** `src/guideData.ts`, `src/slideOrder.ts`, `src/components/{SermonGuide,GuidePassage,GuideStory,GuideResearch,GuideFinish,GuideParts}.tsx`,
  `scripts/test_slide_order.mts`, and the handovers `HANDOVER_2026-10-22_GUIDED_BUILDER.md` and this one.
- **Edited by this work:** `src/components/{SermonBuilder,SlidesEditor,SermonOutline,HelpPanel}.tsx`, `src/{sermon,sermonLayout,sermonOutputs}.ts`,
  `src/App.css`, `scripts/test_sermon_layout.mts`, `HANDOVER.md`.
- **Already in the tree before this work (the 2.9.5 items):** the version bumps (`package.json`, `package-lock.json`, `src-tauri/Cargo.toml`,
  `src-tauri/tauri.conf.json`, the phone's `mobile/` versions), `src-tauri/src/offline_ai.rs`, `src/App.tsx`,
  `src/components/{OfflineAiPanel,SermonBuild}.tsx`, and part of `src/App.css` and `src/components/HelpPanel.tsx`. Use `git add -p` on those two
  shared files, or commit everything together and say so in the message.
- The 2.9.5 version is already set everywhere (`package.json`, `tauri.conf.json`, `Cargo.toml`); `release.ps1` stops if they disagree.

## 5. Smaller things not done (none urgent)

- A topical sermon's points start as "Point 1, 2, 3" with no Scripture (the Finish step flags it); offering a key passage per point in step 2
  would help.
- Step 7's checklist counts any typed text; "17 sections are still empty" in Finish may read as alarming.
- The guide's own changes show a plain "Undo" (only slide changes are labelled).
- Slides edited and saved before slides remembered their sermon item have no link, so dragging them moves only the slides; "Make them
  from the sermon again" (loses their edits) links them. Matching them back by kind and title was considered and left out.
- The "My sermons (n)" count on the tab can be stale after a sermon is deleted from outside the page; it refreshes on the next save.
- No phone version of any of this.

## 6. Where the owner's own sermon stands

"Healing - Your faith has healed you" (saved id 6) was last on screen on the Slides tab, with the owner's own edited slides and the
sermon and slides in the same order. A test move made on it by mistake on 2026-10-22 was undone and checked against the order printed
beforehand. The sermons saved for tests that day were deleted: the database holds the owner's six.
