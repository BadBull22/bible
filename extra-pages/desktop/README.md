# Desktop-only additional pages (not started)

Nothing is here yet. This folder is where batches of stories, "Verses for..." pages and children's pages meant ONLY for the desktop app will be kept, as `batch-<date>-<name>/` folders in exactly the same formats and under exactly the same rules as the phone batches in `../phone/` (see `../GUIDE_ADDING_STORIES_AND_PAGES.md`).

How the desktop app will receive them is NOT decided. The options, for the owner to choose when the work starts:
1. **Ship them inside the next desktop version** as a desktop-only data file (so they do not reach the phone app). They must not simply be added to `src/browse/data/`, because the phone app compiles those same files.
2. **A fetched file like the phone's.** The desktop app has no "Fetch additional stories" yet; it would need the same download, check and merge code the phone has (`mobile/src-tauri/src/extra_pages.rs`, `mobile/src/extraPages.ts`, `mobile/src/extraValidate.ts`, and `setBrowseExtras` in `src/browse/data.ts`).
3. **Promote them to both apps** (move them into `src/browse/data/`) when they are good for the phone too.

Until then: write desktop-only drafts here, never in `../phone/` and never in `src/browse/data/`.
