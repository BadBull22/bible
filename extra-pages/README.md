# extra-pages: Bible stories, "Verses for..." pages and children's pages added between app versions

This folder holds pages that are written and checked here but are NOT part of the app's built-in pages. Read `GUIDE_ADDING_STORIES_AND_PAGES.md` (next to this file) before writing any page: it has every field, limit, writing rule, picture rule, test and the publishing steps.

## What goes where

| Kind of addition | Where it lives | How it reaches readers |
|---|---|---|
| **Phone only**, added between app versions | `extra-pages/phone/batch-<date>-<name>/` | The newest batch folder is built into ONE file, `extra-pages.json`, which is uploaded as the GitHub release `extra-pages` (not marked Latest). The phone app's **Fetch additional stories** button downloads it and adds the pages after the built-in ones. |
| **Both apps**, shipped with the next version of each | `src/browse/data/stories.json`, `topics.json`, `children.json`, `keywords.json` (pictures in `src/browse/pictures/`) | Inside every build. The phone app compiles the same files from source, so a page added there appears in BOTH apps. |
| **Desktop only**, to be made later | `extra-pages/desktop/batch-<date>-<name>/` (same file formats and rules) | Not decided yet (see `desktop/README.md`). Never put desktop-only pages in `src/browse/data/` (that would put them on the phone too) or in `extra-pages/phone/`. |

The built file (`extra-pages.json`) is NOT kept in git: it is made from a batch folder with one command and uploaded to the release. Installers are not kept in git either.

## Phone batches are cumulative
A fetch REPLACES the phone's earlier additional pages with exactly what the file holds. So the file must always contain ALL additional pages ever published. Start every new batch as a copy of the newest batch folder, add the new pages to the copy, and build from it. Older batch folders stay as history; the newest one is the current published set.

## The commands (from the repository root)
```
node --no-warnings scripts/build_extra_pages.mts extra-pages/phone/batch-<date>-<name> --out installer/packs/test-extra-pages.json
```
The builder checks every page with the same rules the built-in pages pass (`scripts/test_browse.mts`), checks the pictures and credits, applies the phone's own check, and writes nothing if anything fails. Copy the result to `installer/packs/ready-to-upload/extra-pages.json` (the release file must be called `extra-pages.json`). Uploading it is the owner's decision each time (steps in the guide).

## Batches so far
| Batch | Contents | Published |
|---|---|---|
| `phone/batch-2026-11-11-two-stories` | 2 stories (The Woman Who Touched Jesus' Cloak; Jesus Heals the Centurion's Servant) and 2 children's pages (The Woman Who Touched the Cloak; The Soldier and His Servant), each with its picture, and an outline to colour in for the two children's pages. Built file: 674 KB, sha-256 `d805a1f30ce1ff381d6f92a03f4a10ba6746226bf77109b97f2c7259d30e9c4c` (revision label `2026-11-11 14:30`). | Yes: GitHub release `extra-pages`, 2026-11-11 |

## Pictures and credits
Each picture has its credit in the batch's `credits.json` (`pictures/` for stories, `child-pictures/` for children's pages); the credits are also listed in the repository's `NOTICE.md`. The Tissot paintings are public domain; the Sweet Publishing illustrations (Jim Padgett) are CC BY-SA 3.0, used unchanged, and the outline made from one is an adaptation under the same licence (`tools/make_outline.py` makes it).
