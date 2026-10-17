# Getting Bible Concordance found

What was done on the site itself is listed at the end. Everything else needs one of your own
accounts, so it is set out here ready to use: texts to paste, where to submit them, and what to
watch out for. Do the steps in order; the first two matter most.

## 1. GitHub "About" box (2 minutes)

On https://github.com/BadBull22/bible, click the ⚙ beside **About** (top right):

- **Description:** Free, offline Bible study app for Windows and Android: Strong's word study,
  commentaries, sermon builder, e-Sword/MySword modules, phone sync over home Wi-Fi. No account, no ads.
- **Website:** https://bible4me.org
- **Topics:** bible, bible-study, bible-app, concordance, strongs-concordance, christian,
  offline-first, sermon, e-sword, mysword, sword-project, tauri, android, windows, free-software

## 2. Search engines (15 minutes, once)

**Google Search Console** — this is what gets the site into Google properly.

1. Go to https://search.google.com/search-console and sign in with your Google account.
2. **Add property → Domain** → type `bible4me.org`. Google shows a **TXT record**.
3. Add that TXT record at the company where you bought the domain (its DNS settings), then press
   **Verify** (it can take an hour to be seen).
   - *Easier alternative:* choose **URL prefix** (`https://bible4me.org/`) → **HTML tag**, and send
     the tag to Claude; it goes into the site's pages and you press Verify.
4. **Sitemaps** → submit `https://bible4me.org/sitemap.xml`.
5. **URL inspection** → paste `https://bible4me.org/` → **Request indexing**; do the same for
   `/windows/` and `/android/`.

**Bing Webmaster Tools** — also feeds DuckDuckGo, Yahoo and Ecosia.

1. https://www.bing.com/webmasters → sign in → **Import from Google Search Console** (after step
   above), which brings the site and sitemap across. (Bing was also told about the pages through
   IndexNow already.)

## 3. Software directories (free listings)

Use the texts in section 5. Most ask for screenshots: see section 6.

| Where | How | Notes |
|---|---|---|
| **AlternativeTo** — alternativeto.net | Sign up, **Suggest new application** | List it as an alternative to **e-Sword, theWord, MySword, Logos, Olive Tree, Blue Letter Bible, YouVersion**. People searching "e-Sword alternative" land here. Licence: Free, Open Source. Platforms: Windows, Android. |
| **SourceForge** — sourceforge.net | Sign up, **Import project from GitHub** | Mirrors the releases; SourceForge ranks well in searches for free Windows software. |
| **Softpedia** — softpedia.com | **Submit program** (link at the page bottom) | Category: Home & Hobby → Religion. Give the .exe link from section 7. |
| **MajorGeeks** — majorgeeks.com | **Submit software** (contact form) | Same texts. |
| **Uptodown** — uptodown.com | Developer account, **Upload app** | For the Android APK (and Windows). |
| **Product Hunt** — producthunt.com | Launch a product | One-day showcase; best with screenshots and a short story of why it was made. |

## 4. Christian and Bible communities

Read each group's rules first; most welcome a free, ad-free tool when it is shared once, honestly,
by its maker. Never repeat-post.

- **CrossWire (the SWORD Project):** the app reads SWORD modules. Ask on the sword-devel mailing
  list (https://crosswire.org/mailman/listinfo/sword-devel) to be added to their list of front-ends.
- **BibleSupport.com forum:** "e-Sword Modules/Resources" or "General" — the app opens e-Sword
  and MySword modules, so their users are a natural audience.
- **Reddit:** r/Bible, r/TrueChristian, r/Reformed, r/Pentecostal, r/biblestudy — check each
  sub's self-promotion rule; a post such as "I made a free offline Bible study app (no ads, no
  account)" with screenshots does best.
- **Facebook groups** for pastors, preachers and Bible teachers (the sermon builder is the hook).
- **Your church network:** South Point Church, Pastor Mike, ministry WhatsApp groups (message
  below).

## 5. Texts to paste

**Name:** Bible Concordance

**Short (one line, ≤150 characters):**
Free, offline Bible study for Windows and Android: Strong's, commentaries, sermon builder. No account, no ads.

**Medium (a paragraph):**
Bible Concordance is a free Bible study app for Windows and Android that works offline. Read the
BSB, KJV, ASV, WEB and YLT (and download over a thousand more translations), study any word in
the Hebrew or Greek with Strong's, read seven commentaries, search by word or subject, and build
sermons from Scripture to slides with a presenter view. It opens e-Sword, MySword and SWORD
modules, and the phone and computer keep your notes in step over your home Wi-Fi. No account, no
adverts, free for anyone to use and share.

**Long (for directories that allow it):**
Bible Concordance is a free, ad-free Bible study app for Windows computers and Android phones.
Everything works offline: the Bibles, the Strong's Hebrew and Greek dictionaries, the commentaries
and the study data are inside the app.

- Read and compare the Berean Standard Bible, King James, American Standard, World English and
  Young's Literal translations, with the words of Jesus in red; download over a thousand more free
  translations in hundreds of languages.
- Tap any word for its Hebrew or Greek root, meaning and every verse that uses it.
- Seven commentaries, including Matthew Henry, Jamieson-Fausset-Brown, Clarke, Calvin and Keil &
  Delitzsch, plus Bible dictionaries, topics, cross-references and maps.
- A sermon builder: gather Scripture and material on a subject or passage, arrange it in a
  template, print handouts, and present slides on a projector with a presenter view. It never
  writes for you: the sermon is yours.
- A library of free commentaries, dictionaries, books and devotionals, and your own e-Sword,
  MySword and SWORD modules.
- Bookmarks, highlights, notes with tags, reading plans and read aloud, kept in step between the
  phone and the computer over your home Wi-Fi.

No account, no adverts, no subscription. Free to use, copy and share, for personal, church or
ministry use. Source code: https://github.com/BadBull22/bible

**Categories / tags:** Bible, Bible study, concordance, Strong's, commentary, sermon, preaching,
Christian, church, offline, education, reference.

**WhatsApp / Facebook message:**
I'd like to share a free Bible study app: Bible Concordance, for Windows and Android. It works
without internet — several translations, Strong's Hebrew and Greek, commentaries, and a sermon
builder with slides. No ads and no account. Download it at https://bible4me.org

## 6. Screenshots to take

Directories want 3–6 screenshots (PNG, at least 1280×720 for Windows). Good ones:

1. **Windows:** a chapter open with the Strong's word study panel showing a Greek word.
2. **Windows:** the sermon builder, with gathered Scripture on the left and the sermon on the right.
3. **Windows:** Present mode (the presenter view) or the slides page.
4. **Windows:** the map or the cross-reference graph.
5. **Android:** the reading view with a highlight, and the verse sheet open.
6. **Android:** the Library with a commentary open, and a verse picture.

(Claude can take these in a session when the app is not in use and the phone is plugged in.)

## 7. Links

- Website: https://bible4me.org · Windows: https://bible4me.org/windows/ · Android: https://bible4me.org/android/
- Windows installer: https://github.com/BadBull22/bible/releases/download/v2.9.0/BibleConcordance_2.9.0_x64-setup.exe
- Android APK: https://github.com/BadBull22/bible/releases/download/android-v2.9.0/BibleConcordance_Android_2.9.0.apk
- Share picture (1200×630): https://bible4me.org/assets/share.jpg · Logo (512×512): https://bible4me.org/assets/icon.png

## Done on the site already (2026-10-17)

- `sitemap.xml` and `robots.txt`; a canonical address on each page.
- A share picture with the title and description for WhatsApp, Facebook, X and others (Open Graph
  and Twitter tags).
- App details for search engines (schema.org `SoftwareApplication` / `MobileApplication`:
  free, version, download link) and a **Questions** section on the home page with the same
  questions as data (`FAQPage`).
- Page titles that say what people search for ("free offline Bible study software for Windows",
  "free offline Bible app for Android").
- Search engines told through **IndexNow** (Bing, DuckDuckGo via Bing, Yandex, Seznam, Naver):
  accepted. The key file is `docs/<key>.txt`; after a change, the pages can be sent again.
- The GitHub README now opens with the website and download links.
