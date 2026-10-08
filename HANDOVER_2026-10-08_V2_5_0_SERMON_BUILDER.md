# Handover — for 2026-10-08: v2.5.0 (sermon builder), built but not committed

**Start here.** v2.4.2 is the released version (GitHub and website). Everything below was
built on 2026-10-07 after that release and is **uncommitted, unreleased, and only partly
tried by the user**. The plan for the next session is: review this, test in the dev app,
then commit and build the 2.5.0 installer.

The release process, signing key and git rules are unchanged:
`HANDOVER_2026-10-06_V2_4_0.md` sections 3 and 5. What 2.4.2 contains:
`HANDOVER_2026-10-07_V2_4_2.md`.

## 1. State of things

- **Version** is already bumped to **2.5.0** in `package.json`, `package-lock.json` (lines 3
  and 9), `src-tauri/Cargo.toml`, `Cargo.lock` and `src-tauri/tauri.conf.json`.
- **Uncommitted files** (stage by explicit path, never `git add -A`):
  - modified: the five version files, `src-tauri/src/{lib.rs, userdata.rs, study_commands.rs}`,
    `src-tauri/src/library/epub.rs`, `src/{App.tsx, App.css, api.ts}`,
    `src/components/{HelpPanel.tsx, StudyPanel.tsx}`
  - new: `src-tauri/src/sermon.rs`, `src/sermon.ts`, `src/components/SermonBuilder.tsx`, and
    this file
- **Checks:** `npx tsc --noEmit` and `npx vite build` pass; `cargo test --lib` 53 passed,
  11 ignored.
- **What the user has seen:** the first version of the sermon builder in the dev app. They
  found the search too thin (see section 3). The improved search, and the scanned-book
  importer changes, were built afterwards and **have not been seen on screen by anyone**.
- The dev app may still be running; closing it is fine.

## 2. The sermon builder (Study → Sermon builder)

The user's brief: type what the sermon is about, the app gathers material, you tick what to
keep, arrange it, and get a document. **No AI: "you are the preacher"** — it finds and lays
out, and writes nothing. Scripture first, commentary always named as its author's view.

It opens in the main reading area (`readingBook === "@sermon"` in `App.tsx`, the same slot a
Library book uses). Work in progress survives leaving the builder to look at the Bible (a
module-level `draft` in `SermonBuilder.tsx`), but only for the session; Save keeps it.

**Tabs**

1. **Gather.** One box: a topic, several separated by `;`, a named passage ("sermon on the
   mount"), a reference ("Romans 8") or a sentence. Results in groups with tick boxes: key
   passages, supporting verses, cross-references, commentary, dictionary and topical
   articles, word studies, your own notes, from your books. "Gather more" adds to the list.
2. **Arrange.** A shape (points / through a passage / problem → God's answer → response /
   no headings) lays the ticked items out under headings, Scripture first (`arrange()` in
   `sermon.ts`). Drag or ▲▼ to reorder, edit headings, add notes and headings. A bar shows
   Old/New Testament counts, suggests a passage from the other Testament when all are from
   one, and estimates minutes to read the material aloud (130 words a minute).
3. **Document.** `sermonBlocks()` builds the same `SheetBlock` list the study sheets use, so
   Print / Copy / Save as Word / preview come from the existing `SheetOutput`. Optional blank
   lines under each heading.
4. **My sermons.** Saved in `userdata.db` table `sermons` (title, series, preached_on,
   topics, passages, body JSON). Grouped by series, with the passages a series has covered.
   Included in My Study → Export / Import (`Backup.sermons`; older backups still import).

**Files:** `src/sermon.ts` (gathering, arranging, document), `src/components/SermonBuilder.tsx`
(screen), `src-tauri/src/sermon.rs` (Scripture search), `userdata.rs` + `study_commands.rs`
(saving: `sermon_list/get/save/delete`).

## 3. The Scripture search behind it (`sermon.rs`, command `sermon_verses`)

The user's complaint on the first version: "healing" and "your faith has healed you" gave
little that matched, and "gifts of the spirit" gave only a few of the gifts. Causes, measured:
the app's keyword search treats everything typed as one exact phrase, never matched other
word forms, and the topical lookup needed the heading to equal the topic.

The builder now has its own search. Every hit records **why** it was found, and the screen
shows it:

| why | what | applies to |
|---|---|---|
| `phrase` | the exact words typed, in any bundled translation (so KJV wording works) | anything |
| `words` | every main word, in any form (`stem()`: healing → heal*), plus a few Bible synonyms (`ALSO`) | anything |
| `some` | most of the words, for sentences where no verse has them all | anything |
| `topical` | every verse Nave's and Torrey's list under a fitting heading (`dict_refs`), with modern-word aliases (`TOPICAL_HEADINGS`) | where they have a heading |
| `core` | a hand-written list of central passages (`CORE`) | **27 subjects only** |
| `meaning` | search by meaning, added by `sermon.ts` on top | anything |

- **The 27 core subjects:** healing, gifts of the Spirit, baptism in the Holy Spirit, the
  Holy Spirit, faith, salvation, born again, forgiveness, sin, repentance, grace, love,
  prayer, resurrection, the cross, the blood of Jesus, second coming / rapture, water
  baptism, spiritual warfare, worship, giving, fear and anxiety, holiness, marriage, hope,
  peace, joy. A test checks every passage exists in the text. **The choice of passages is
  Claude's, from memory of the standard ones; the user was told to say where a list is wrong
  or thin.** A narrower subject replaces the broader ones inside it ("gifts of the Spirit"
  doesn't also bring the general Holy Spirit list).
- A single verse inside a longer passage is folded into the passage, which takes over its
  reasons (Mark 5:25–34 leads for "your faith has healed you").
- Tested results: "your faith has healed you" → the six passages with those words lead, 171
  in all; "gifts of the spirit" → 66, including 1 Cor 12:1–11, 12:27–31, 13, 14, Rom 12:6–8,
  Eph 4:11–13, 1 Pet 4:10–11. `cargo test sermon_probe -- --ignored --nocapture` prints what
  comes back for several topics.
- The 10 strongest become key passages; up to 70 more are supporting verses.
- Named passages ("sermon on the mount", "lord's prayer"…) are a separate table, `NAMED` in
  `sermon.ts`.

**Still to judge on screen:** whether the ranking feels right for subjects outside the 27,
the commentary excerpt length (about a paragraph around the subject), and how the Word
document reads.

## 4. Scanned e-books (`library/epub.rs` `scan_sections`)

Background: the user asked what commentary exists on Revelation. Seven built-in commentaries
cover it; only Scofield reads it from the pre-tribulation position, briefly. Public-domain
dispensational works are openly downloadable from the Internet Archive as EPUB: Larkin (The
Book of Revelation; Dispensational Truth), Ironside, Gaebelein, Seiss (3 vols), William
Kelly, Blackstone (Jesus Is Coming), Pember. Not open: Walvoord, Newell. Copyright status is
Claude's understanding (all pre-1929), not checked legally.

The Internet Archive's EPUBs are automatic scans, one file per printed page, with no
chapters. The importer now recognises them (30+ pages, almost none titled) and:

- removes the running header and page number at the top of each page, including misread
  numbers;
- takes chapter titles from the right-hand page headers, keeping only titles that three or
  more pages agree on, and labels a chapter with its most common reading;
- drops the Internet Archive's notice lines;
- adds a warning to the check screen that it is a scanned book.

Tested on four real files: Ironside comes out with real chapters, Seiss by lecture, Larkin by
his three divisions, Gaebelein still in parts by length (its headers only repeat the book's
name). Typos remain, boundaries can be a page off, pictures (Larkin's charts) are still
dropped, and files with no title take the file's name. Offered and not done: keeping
pictures in added books.

Test files: `%LOCALAPPDATA%\bible-concordance-build\library-probe\rev`. To print what the
importer makes of them:
`$env:BC_EPUB_DIR="bible-concordance-build/library-probe/rev"; cargo test real_epubs -- --ignored --nocapture`

## 5. For tomorrow

1. `npm run tauri dev` and try the sermon builder with the improved search: the user's two
   examples, a few subjects outside the 27, a sentence, and several topics with `;`.
2. Arrange, add notes, look at the Document tab, Save as Word, Save and reopen a sermon.
3. Add one scanned EPUB (rename the file to the book's title first) and check its chapters.
4. Fix what the review turns up.
5. Commit and push (BadBull22 noreply; scan the staged diff), then
   `pwsh -File scripts\release.ps1 -Notes "…"`, install and smoke test, publish with the
   printed `gh release create v2.5.0 …`, and update the website page.

## 6. Other things discussed, not started

- **Android app:** feasible with Tauri 2; needs a phone layout, a smaller data set, a
  replacement for the voice program, and a Play developer account. Planning only.
- **globalchristians.org** as a built-in Library source (about 95 EPUBs, CC BY-NC-SA).
- **Afrikaans dictionary:** left out; the free ones cover too little Bible vocabulary.
- **Keeping Strong's tags** in the 39 Library Bibles that carry them.
