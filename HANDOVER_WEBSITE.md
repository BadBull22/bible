# Website handover — bible4me.org

The app's public website. It is served by **GitHub Pages** from the `docs/` folder on
`master` of this repository, with the custom domain **bible4me.org** (the owner bought it at
Cloudflare on 2026-10-13). It replaced `www.ghost-claw.com/bible.html`, a page borrowed from
an unrelated project, which must not link here or be linked from here.

## Files

| Path | What |
|---|---|
| `docs/index.html` | Home: hero, a Windows / Android choice, a "which one is for me?" comparison, Free, really, thank-you note |
| `docs/windows/index.html` | Windows download, the free extras after installing, updating, features |
| `docs/android/index.html` | Android (Beta) download, install steps, updating, file check, features, what it leaves out |
| `docs/assets/site.css` | Shared styles (the app's palette; the fixed photo behind a frosted column; Android in green) |
| `docs/assets/` | `icon.png`, `favicon-32.png`, `hero-bg.jpg`, `south-point-church.png` (the church logo, trimmed, 760 px wide) |
| `docs/assets/originals/` | full-size originals the web images were made from (the church logo, 8000 px) — not linked from the pages |
| `docs/CNAME` | `bible4me.org` — GitHub Pages reads the custom domain from it; don't delete |
| `docs/.nojekyll` | serve the files as they are |

The home page ends with the owner's thank-you to **Pastor Mike & South Point Church** (the
church that inspired the app), with the church's logo, under the Matthew 10:8 verse
(`.inspiration` in `site.css`). Keep it; the wording is the owner's.

Plain HTML and CSS, no build step. Every page carries the same header (logo, Windows,
Android); the current page's button has `aria-current="page"`. Links between pages are
relative (`../android/`), so the site also works at `badbull22.github.io/bible/`.

## Updating for a new version

The versions are typed by hand; nothing reads "the latest release".

- **Windows** (after the GitHub release `vX.Y.Z` exists):
  - `docs/windows/index.html`: the `version-line`, both download `href`s (tag and file name:
    `releases/download/vX.Y.Z/BibleConcordance_X.Y.Z_x64-setup.exe` and
    `..._x64_en-US.msi`), and the sizes in `file-meta`.
  - `docs/index.html`: the Windows card's `meta` line.
- **Android** (after the release `android-vX.Y.Z`, created with `--latest=false`):
  - `docs/android/index.html`: the `version-line`, the download `href`, the size, the file
    name in install step 2, and the SHA-256 under "Checking the file".
  - `docs/index.html`: the Android card's `meta` line.
  - `docs/android/latest.json`: the file the phone app (0.3.2 and later) reads to learn of a
    new version — `version`, `url`, `sha256`, `size` (bytes), `notes`. Change it **last**,
    once the release's APK is downloadable: pushing it is what makes installed copies offer
    the update. It is not linked from any page; don't remove it.
- Keep the **Beta** marks (badge, heading line, note) until the owner says they can go.
- Commit and push to `master`; Pages republishes in a minute or two.
- Don't link the updater's files (`.sig`, `latest.json`) or the voice zip from the site.

## Domain and DNS (Cloudflare)

- GitHub: repository Settings → Pages → source `master` / `docs`, custom domain
  `bible4me.org`, Enforce HTTPS once the certificate is issued.
- Cloudflare DNS for `bible4me.org`:
  - four `A` records for `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`,
    `185.199.111.153`;
  - a `CNAME` for `www` pointing to `badbull22.github.io`;
  - all set to **DNS only (grey cloud)**, not proxied, so that GitHub can issue the HTTPS
    certificate.
- Recommended: verify the domain under GitHub account Settings → Pages, so no one else can
  claim it on GitHub.
- The domain renews yearly at Cloudflare; keep auto-renew on.
