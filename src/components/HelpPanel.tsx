import { ReactNode, useMemo, useState } from "react";
import { CloseIcon } from "./icons";

interface Props {
  onBack: () => void;
  onClose: () => void;
}

interface Section {
  id: string;
  title: string;
  /** Plain words the filter box matches, in addition to the title. */
  keywords: string;
  body: ReactNode;
}

const K = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>;

// The user guide. Written for the reader, not the developer: what each feature is for and
// exactly where to click. Keep it in step with the app when features change.
const SECTIONS: Section[] = [
  {
    id: "start",
    title: "Getting started",
    keywords: "home opening screen gospel search reference go to verse recent try",
    body: (
      <>
        <p>
          The app opens on the <strong>Gospel</strong> screen. Type into the search box and it works out what you mean:
        </p>
        <ul>
          <li>
            A <strong>reference</strong> — <em>John 3:16</em>, <em>gen 1</em>, <em>1 sam 17:4</em>, <em>Jude 3</em> — shows a
            "Go to" button; press <K>Enter</K> to open it.
          </li>
          <li>
            A <strong>question</strong> — <em>how many times is love mentioned in the New Testament?</em>,{" "}
            <em>who was Aaron?</em> — gets an answer (see <em>Ask a question</em> below).
          </li>
          <li>
            A <strong>theme or story</strong> — <em>the prodigal son</em>, <em>the parting of the Red Sea</em> — lists the
            verses that match by meaning, even when the words differ.
          </li>
        </ul>
        <p>
          Below the box are your <strong>recent searches</strong>, some examples to try, the <strong>verse of the day</strong>,
          <strong> today's reading</strong> (if you've started a reading plan) and the "Inside this Bible" figures. Click{" "}
          <strong>Home</strong> in the top bar at any time to come back here.
        </p>
      </>
    ),
  },
  {
    id: "reading",
    title: "Reading and moving around",
    keywords: "book list sidebar chapter next previous arrow back translation version top search ctrl k jump highlight blue",
    body: (
      <>
        <ul>
          <li>
            The <strong>book list</strong> on the left opens any book and chapter. The ☰ button hides or shows it.
          </li>
          <li>
            <K>←</K> and <K>→</K> (or the buttons at the foot of the chapter) turn to the previous or next chapter.
          </li>
          <li>
            The <strong>translation</strong> menu in the top bar switches the text: BSB, KJV, ASV, YLT, WEB, the Hebrew Old
            Testament (WLC), and two Greek New Testaments — the Textus Receptus (TR, behind the KJV) and the Tyndale House
            Greek New Testament (THGNT, the critical text behind most modern translations).
          </li>
          <li>
            The <strong>search box</strong> in the top bar (<K>Ctrl</K> <K>K</K>) does the same as the Gospel screen from
            anywhere: a reference goes straight there, anything else opens Search.
          </li>
          <li>
            When you jump to a verse it is <strong>flashed in light blue</strong> for a few seconds so you can find it on the
            page. <strong>Back</strong> returns to where you were reading.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "verse-buttons",
    title: "The buttons beside every verse",
    keywords: "cross references compare translations commentary more menu interlinear topics bookmark note copy highlight",
    body: (
      <>
        <p>Each verse has four small buttons on the right:</p>
        <ul>
          <li>
            <strong>Cross references</strong> (chain link) — related verses across the Bible, shown as a diagram you can
            explore and as a list with each verse's text.
          </li>
          <li>
            <strong>Compare translations</strong> — the verse in every bundled translation side by side (plus NIV, NKJV and
            ESV if you've added keys in Settings).
          </li>
          <li>
            To read a <strong>whole chapter in several translations</strong>, press <strong>Side by side</strong> beside the
            chapter title. The translation you're reading stays in the first column (with all its tools); choose up to three
            more at the top of the columns (<strong>+ Add translation</strong>, × to remove). The verses line up row by row and
            scroll together; where a translation has no verse (e.g. the BSB at Matthew 17:21) its cell shows a dash. Your
            choice of columns is remembered, but the app always opens in a single column; <strong>Single column</strong>{" "}
            goes back. <em>Copy chapter</em> then copies every
            column.
          </li>
          <li>
            <strong>Commentary</strong> (open book) — nine bundled commentaries on that verse: Matthew Henry,
            Jamieson-Fausset-Brown, Adam Clarke, John Gill, Calvin, Keil &amp; Delitzsch (Old Testament), Tyndale Study
            Notes, John Wesley's Notes and the Scofield Reference Notes.
          </li>
          <li>
            <strong>⋯ More</strong> — Interlinear, Topics &amp; dictionary for this verse, Bookmark, Add note, Copy verse,
            Prepare study sheet and the highlight colours.
          </li>
        </ul>
        <p>
          Words with a faint dotted underline carry a <strong>Strong's number</strong>: click one for its original Hebrew or
          Greek word, definition and every place it occurs.
        </p>
      </>
    ),
  },
  {
    id: "highlight-notes",
    title: "Highlights, notes and bookmarks",
    keywords: "highlight colour color soft bright note write bookmark save marker clear delete range passage verses tags tag",
    body: (
      <>
        <ul>
          <li>
            <strong>Highlight</strong>: ⋯ → pick a colour. The top row is soft colours, the second row bright ones. Choose{" "}
            <em>Clear highlight</em> to remove it.
          </li>
          <li>
            <strong>Note</strong>: ⋯ → <em>Add note</em>. Type underneath the verse and press <em>Save note</em> (or{" "}
            <K>Ctrl</K> <K>Enter</K>). A small pencil appears next to verses with notes — click it to open the note again.
            Empty a note and save to delete it.
          </li>
          <li>
            <strong>A note on several verses</strong>: in the note, choose <em>through verse</em> to make it cover a passage
            (say verses 1–8). A thin bar in the margin marks every verse it covers; the pencil sits on the first one.
          </li>
          <li>
            <strong>Tags</strong>: type a few words under the note, separated by commas (<em>faith, prayer, sermon: grace</em>).
            Tags you've used before are offered as you type. In <strong>My Study</strong>, click a tag to see every note
            that carries it.
          </li>
          <li>
            <strong>Bookmark</strong>: ⋯ → <em>Bookmark</em>. A small ribbon marks the verse.
          </li>
        </ul>
        <p>
          All of these are kept on this computer only and survive reinstalling the app. Find them all in{" "}
          <strong>My Study</strong>.
        </p>
      </>
    ),
  },
  {
    id: "my-study",
    title: "My Study: your notes, plans, export and backup",
    keywords: "my study notes highlights bookmarks reading plan export import backup documents markdown json new pc tags tag",
    body: (
      <>
        <p>
          <strong>My Study</strong> in the top bar lists all your notes, highlights and bookmarks (newest first, with a filter
          box). Click any reference to go to it. Above your notes are your <strong>tags</strong>: click one to show only the
          notes with that tag, click it again to show all.
        </p>
        <ul>
          <li>
            <strong>Export</strong> saves everything into <em>Documents\Bible Concordance</em> as a readable file (.md — opens
            in Word or Notepad) plus a <em>.json</em> backup, and opens the folder.
          </li>
          <li>
            <strong>Import backup</strong> reads that .json back in — use it to move your study to another computer. It
            only adds; nothing you already have is deleted.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "sync",
    title: "Keeping your computers and phone in step",
    keywords: "sync synchronise keep in step folder onedrive google drive dropbox synology phone another computer laptop devices",
    body: (
      <>
        <p>
          <strong>Settings → Keep in step with your other devices</strong> keeps your notes, highlights, bookmarks, reading plans,
          sermons (with when they were preached), sermon templates and basket the same on all your computers and your phone.
          Choose a folder they all share — in OneDrive, Google Drive, Dropbox or on your Synology drive — and choose the same folder
          on each device. There is no account and nothing goes anywhere else: each device keeps one file of its own in that
          folder (in <em>Bible Concordance sync</em>) and reads the others'.
        </p>
        <ul>
          <li>It syncs when the app starts, every two minutes while it is open, and when you come back to its window; or press <em>Sync now</em>.</li>
          <li>The newest change wins, and something you delete stays deleted on every device.</li>
          <li>
            The same note changed on two devices before they synced keeps both texts (marked <em>from …</em>); the same sermon keeps
            the other device's version as a copy beside yours, named <em>(from …)</em>. Settings says when this happened.
          </li>
          <li>Pictures, videos and music in your sermons are copied too. Downloaded Bibles, books and modules are not: add them on each device.</li>
          <li>The phone keeps notes, highlights, bookmarks and reading plans in step; sermons stay on the computers.</li>
        </ul>
      </>
    ),
  },
  {
    id: "plans",
    title: "Reading plans and verse of the day",
    keywords: "reading plan year new testament gospels psalms proverbs tick day progress verse of the day",
    body: (
      <>
        <p>
          In <strong>My Study → Reading plans</strong>, press <em>Start today</em> on a plan: the whole Bible in a year, the
          New Testament in 90 days, the four Gospels in 30 days, or Psalms &amp; Proverbs in a month.
        </p>
        <p>
          Each day's chapters are listed with a tick box. Today's reading also appears on the Gospel screen — click a
          chapter to read it, then tick the day off. You can run several plans at once, and <em>Stop this plan</em> clears
          one.
        </p>
        <p>The verse of the day on the Gospel screen changes at midnight; its Copy button copies it with its reference.</p>
      </>
    ),
  },
  {
    id: "ask",
    title: "Ask a question",
    keywords: "ask question answer how many times confidence badge stated computed traditional commentary pentecostal dictionary",
    body: (
      <>
        <p>
          Type a real question on the Gospel screen, or in <strong>Search → Ask a question</strong>. The app answers it in
          one of four ways, and always says which:
        </p>
        <ul>
          <li>
            <strong>A count</strong> — "how many times is <em>grace</em> mentioned in Romans?" is counted exactly from the text,
            with every verse listed.
          </li>
          <li>
            <strong>A prepared answer</strong> — over 130 hand-checked answers with their scripture. The badge tells you how
            certain it is: <em>Stated in scripture</em>, <em>Computed from this app's data</em>,{" "}
            <em>Traditional / scholarly consensus</em>, <em>Scripture first, then the Pentecostal / evangelical reading</em>,{" "}
            <em>A commentator's view</em> or <em>Not stated in scripture</em>.
          </li>
          <li>
            <strong>A dictionary entry</strong> — "who was Melchizedek?" or "what does selah mean?" shows the entry from
            Easton's or Smith's Bible Dictionary, clearly marked as a reference work, not scripture.
          </li>
          <li>
            <strong>Related verses</strong> — when nothing above fits, it says so and shows the closest verses and
            commentary.
          </li>
        </ul>
        <p>Answers have a Copy button, and their scripture references are clickable.</p>
      </>
    ),
  },
  {
    id: "search",
    title: "Search: exact phrase, word count, themes, commentaries",
    keywords: "search panel phrase exact word count frequency topic theme commentary",
    body: (
      <ul>
        <li>
          <strong>Ask a question</strong> — as above.
        </li>
        <li>
          <strong>Topics &amp; themes</strong> — verses by meaning ("sacrifice of bulls" finds "burnt offering of bulls").
        </li>
        <li>
          <strong>Exact phrase</strong> — word-for-word matches in the translation you choose.
        </li>
        <li>
          <strong>Word count</strong> — how many times a word occurs, and where.
        </li>
        <li>
          <strong>Commentaries</strong> — searches the full text of all nine commentaries.
        </li>
      </ul>
    ),
  },
  {
    id: "interlinear",
    title: "Interlinear: the Hebrew and Greek behind a verse",
    keywords: "interlinear hebrew greek original grammar parsing strongs transliteration critical text textus receptus tr",
    body: (
      <>
        <p>
          ⋯ → <strong>Interlinear</strong> shows every original word of the verse: the Hebrew or Greek, how to say it, its
          English meaning, its dictionary form, its Strong's number, and its grammar in plain English (e.g. "Verb · Aorist
          Active Indicative · 3rd Singular" — hover for the full breakdown). Click the Strong's number for a word study.
        </p>
        <p>
          In the New Testament, choose <em>Critical text</em> or <em>Textus Receptus</em> to see where the Greek behind modern
          translations and behind the KJV differ, or <em>Show all</em> to see every word with its editions. Use the arrows to
          step through the verses.
        </p>
      </>
    ),
  },
  {
    id: "original-search",
    title: "Hebrew & Greek search (by word and grammar)",
    keywords: "hebrew greek original search grammar tense aorist perfect stem qal piel hiphil case lemma strongs every occurrence word study lexicon",
    body: (
      <>
        <p>
          <strong>Explore → Hebrew &amp; Greek search</strong> finds every place a Hebrew or Greek word is used, and lets you
          narrow it by its grammar — for example every <em>aorist</em> of ἀγαπάω (to love), or every <em>Piel</em> of a
          Hebrew verb.
        </p>
        <ul>
          <li>
            Type an English meaning (<em>love</em>), the word itself (<em>ἀγαπάω</em>, <em>ברא</em>) or a Strong's number (
            <em>G25</em>, <em>H1254</em>), then pick the word you mean from the list.
          </li>
          <li>
            Use the boxes — tense, voice, mood, stem, case, person, number… — to narrow the list. Each choice shows how many
            places it would leave. The chips underneath show which books it's found in.
          </li>
          <li>
            Click a reference to go there. <em>Word Study</em> opens the dictionary entry; the copy button copies the whole
            list.
          </li>
          <li>
            From any <strong>Word Study</strong>, <em>Search by grammar</em> opens this search on that word. If you've
            installed Greek or Hebrew lexicons from the <strong>Library</strong> (Abbott-Smith, Dodson, BDB and others),
            their entries for the word appear in the Word Study too, under <em>From your Library</em>.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "dictionary",
    title: "Bible dictionaries and topics",
    keywords: "dictionary easton smith nave torrey topical topic verse subject look up",
    body: (
      <>
        <p>
          <strong>Dictionary</strong> in the top bar searches four reference works: <em>Easton's</em> and <em>Smith's</em> Bible
          dictionaries (short articles on people, places and terms) and <em>Nave's</em> and <em>Torrey's</em> topical indexes
          (every verse on a subject). Use the buttons under the box to search just one.
        </p>
        <p>
          From any verse, ⋯ → <strong>Topics &amp; dictionary for this verse</strong> lists every entry that cites it — a quick
          way to find the themes a verse belongs to. These works are from the 1880s–1890s and reflect their authors' views.
        </p>
      </>
    ),
  },
  {
    id: "explore",
    title: "Genealogies, Firsts, People & Places, Map, Timeline",
    keywords: "genealogy family tree firsts facts promises prophecies people places events map timeline adams chart",
    body: (
      <ul>
        <li>
          <strong>Genealogies</strong> — family lines from Adam to Jesus, with ages from scripture.
        </li>
        <li>
          <strong>Firsts</strong> — firsts, facts, promises, spiritual warfare passages and fulfilled prophecies (foretold ↔
          fulfilled).
        </li>
        <li>
          <strong>People &amp; Places</strong> — who and where appears in the chapter you're reading.
        </li>
        <li>
          <strong>Map</strong> — biblical places with ancient and modern names, and kingdom outlines by period.
        </li>
        <li>
          <strong>Timeline</strong> — lifespans and events, plus a zoomable copy of Adams' 1871 Synchronological Chart.
        </li>
      </ul>
    ),
  },
  {
    id: "copy-print",
    title: "Copying and printing",
    keywords: "copy print paper pdf verse chapter answer word",
    body: (
      <>
        <ul>
          <li>
            <strong>Copy a verse</strong>: ⋯ → <em>Copy verse</em> copies the text with its reference and translation, ready to
            paste into Word, an email or a message.
          </li>
          <li>
            <strong>Copy a chapter</strong>: the <em>Copy chapter</em> button beside the chapter title.
          </li>
          <li>
            <strong>Copy an answer, dictionary entry, commentary note, cross reference or one of your notes</strong>: the{" "}
            <em>Copy</em> button on it. In the cross-reference list, the <em>Copy</em> beside "Strongest direct links" copies
            them all with their text.
          </li>
          <li>
            <strong>Print</strong> (top bar) prints the chapter on screen together with whichever side panel is open —
            e.g. open a commentary first to print both. Your highlights print as a light tint. To make a PDF, choose
            "Microsoft Print to PDF" as the printer.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "study-sheet",
    title: "Study sheets (for Bible study, sermons and services)",
    keywords: "study sheet sermon service preparation handout print pdf word docx copy notes lines translations commentary",
    body: (
      <>
        <p>
          A study sheet gathers everything about a passage onto one clean page you can print, save as PDF, paste into Word or
          an email, or save straight to a Word document.
        </p>
        <ul>
          <li>
            Open it from a verse's <strong>⋯ → Prepare study sheet…</strong>, or the <strong>Study sheet</strong> button beside
            the chapter title (for the whole chapter).
          </li>
          <li>
            Choose the <strong>verses</strong> (from … to …), up to <strong>three translations</strong> side by side, the
            strongest <strong>cross references</strong> with their text, <strong>key Hebrew / Greek words</strong>,{" "}
            <strong>your own notes and highlights</strong>, <strong>topics</strong> from Nave's and Torrey's, any of the{" "}
            <strong>commentaries</strong>, and <strong>blank lines</strong> for handwritten notes. Your choices are remembered
            for the next sheet.
          </li>
          <li>The preview updates as you change the options — what you see is what prints.</li>
          <li>
            <strong>Print / PDF</strong> prints just the sheet (pick "Microsoft Print to PDF" for a PDF).{" "}
            <strong>Copy</strong> keeps headings and bold when pasted into Word, Google Docs or an email;{" "}
            <strong>Plain text</strong> is for messaging apps. <strong>Save as Word</strong> writes a .docx into
            Documents\Bible Concordance and shows it — it never overwrites an earlier sheet.
          </li>
          <li>Commentary sections are labelled as the commentators' own views, not scripture.</li>
        </ul>
      </>
    ),
  },
  {
    id: "sermon",
    title: "Sermon builder",
    keywords:
      "sermon builder preach preacher pastor minister message outline points topic gather prepare series word document template big idea preach mode slides powerpoint handout fill in blanks small group lectionary calendar spurgeon simeon illustrations quotes library review edit hebrew greek word strong's definition lexicon preached preaching history tracker find search past sermons verse numbers background",
    body: (
      <>
        <p>
          <strong>Study → Sermon builder</strong> gathers material, gives you a prepared outline to write into, and turns it
          into a document, handouts, slides and a pulpit view. It finds and arranges; it never writes for you. The sermon is
          yours.
        </p>
        <ul>
          <li>
            <strong>Prepare</strong> is one screen in two halves that scroll on their own. On the left, type a subject (<em>faith in God</em>)
            or a passage (<em>John 3</em>) and press <em>Find</em>: Scripture, cross-references, commentary, your Library books, Spurgeon's
            sermons, outlines, stories and more, in groups that stay at the top while you scroll. Click a title to read it all; <em>Read</em>{" "}
            shows the chapter and <em>Study this passage</em> everything on it — both on the left, without leaving your sermon. Press{" "}
            <strong>+</strong> to add an item to the sermon.
          </li>
          <li>
            <strong>Hebrew and Greek words:</strong> <em>Words</em> under any passage (on the left, or in your sermon) shows its words;
            click one for the original word, its Strong's number and meaning, how often it is used and any lexicon you've downloaded,
            then <em>Add to the sermon</em> — it goes to the point's Explain section. Or type a word into <em>Look up a Hebrew or Greek
            word</em> (love, G26, H2617).
          </li>
          <li>
            On the right is <strong>your sermon</strong>. Write the big idea and purpose and choose a template: each point is a card,
            and what you add with + goes into its place — Scripture to Scripture, commentary to Explain, stories and pictures to
            Illustrate. Click a point or a section first to put things there instead. Sections with nothing in them yet fold away into
            chips (+ Apply); click one to write in it. Each point's <em>Add ▾</em> menu adds a section, a note, a picture or a new point.
            Drag a point by its handle, or anything in it to another section. Outline shows just the headings.
          </li>
          <li>
            <strong>Pictures, video, music and links:</strong> <em>+ Picture, video or link</em> adds a picture or any file from your computer
            (a copy is kept with the app), one of 100 nature photos (downloaded once, about 8 MB), a Bible picture you've downloaded, or a
            web link such as a YouTube video or a song. They appear in the printed and Word copy, in Preach (a link or file opens with a
            click) and on the slides.
          </li>
          <li>
            <strong>Review</strong> shows the sermon as it will print, with everything you wrote editable where it stands — the title, big
            idea, points, section names and your words. Passages and quotations can be taken out (Undo brings them back), and a quotation
            can be <em>shortened</em> for this sermon only; <em>Put back the whole text</em> restores it.
          </li>
          <li>
            <strong>Print &amp; handouts:</strong> the sermon, a listener's outline, a fill-in-the-blanks sheet with answers and a small-group
            guide — print, A4 or A5, large print, or save as Word.
          </li>
          <li>
            <strong>Slides:</strong> made from your sermon, then yours to change — reorder, edit, delete, and add words, song words,
            Scripture, pictures and video or music links, on navy or on a photo. Save as PowerPoint; a link on a slide plays when clicked
            in the slide show. The bar at the top stays in view: the background for all slides, <em>Verse numbers</em> on or off, and a
            button for each kind of slide to add. Under the slide you're editing, give that one slide its own background and put a
            picture beside its words. A passage is put on slides a few whole verses at a time, and the words shrink to fit. When the
            slides have video or music files, <em>Save as PowerPoint</em> asks each time: put them inside the PowerPoint (plays on any
            computer, a bigger file) or link to them (a small file that plays only on this computer). Web videos are always links.
          </li>
          <li>
            <strong>Present:</strong> <em>▶ Present</em> (or <em>From this slide</em>) shows the slides full screen on your second
            screen — the projector or TV — and on your own screen a presenter view: this slide, the next one, your notes for it, the
            time and how long you've been going, and every slide along the bottom to jump to. Write the notes under each slide's
            editor; only you see them. Keys: → or Space for the next slide, ← back, B to black out the screen, Esc to end (clickers
            work too). A video or music slide has <em>Play</em>, <em>Pause</em> and <em>Stop</em>: a kept file plays from this
            computer, a YouTube video needs the internet. With three or more screens, choose which one shows the slides; the app
            remembers it. With only one screen the slides fill it: in Windows press Windows key + P and choose <em>Extend</em> to use
            the projector as a second screen.
          </li>
          <li>
            <strong>Preach</strong> shows the sermon full screen with a clock; Esc leaves. <strong>My sermons</strong> holds your saved
            sermons by series, on a calendar, a series planner and the lectionary.
          </li>
          <li>
            <strong>When and where you preached it:</strong> one sermon can be preached many times. Under the sermon's details,{" "}
            <em>Record a preaching</em> notes the date, the place, to whom, how long it took and how it went; choosing the stage{" "}
            <em>Preached</em> asks for it. "Used before" then says when and where. <strong>My sermons → Find a sermon</strong> searches
            your sermons by their words, a passage ("Romans 8" finds a sermon on Romans 8:28–39), dates, series, place and stage —
            newest, oldest or most preached first.
          </li>
          <li>
            Your sermon is kept on this computer as you work, even if the app closes. Press <em>Save</em> once to put it in My sermons;
            after that it saves itself. <em>Undo</em> (Ctrl+Z) takes back the last change.
          </li>
        </ul>
        <p className="muted">
          Sources: Simeon's Horae Homileticae (1832), Spurgeon's sermons (CCEL), Moody's and Spurgeon's books of stories and
          sayings, and the 1979 Book of Common Prayer — all public domain.
        </p>
      </>
    ),
  },
  {
    id: "read-aloud",
    title: "Read aloud (listen to the Bible)",
    keywords: "listen audio read aloud voice speak speech kokoro narrator hear download natural voice",
    body: (
      <>
        <p>
          Press <strong>Listen</strong> beside a chapter's title, or ⋯ → <strong>Listen from here</strong> on any verse. The
          chapter is read in a natural voice, fully offline; the verse being read is highlighted and kept in view, and in a
          long verse the sentence being spoken is tinted. You can also right-click any verse and choose{" "}
          <strong>Listen from here</strong>.
        </p>
        <p>
          <strong>Books in your Library are read the same way.</strong> The sentence being spoken is tinted, its paragraph
          lightly marked, and the page scrolls along. Scroll away yourself and the page stops following — press{" "}
          <strong>Back to where it's reading</strong> to pick it up again. To start somewhere else, point at a paragraph
          and press the small 🔊 beside it, or right-click it and choose <strong>Listen from here</strong>. The book
          remembers where the reading stopped: <strong>Continue listening</strong> carries on from that sentence, even
          after closing the app.
        </p>
        <p>
          <strong>Your own bookmarks in a book:</strong> press <strong>Bookmark</strong> at the top (it marks the paragraph
          at the top of the window), the small bookmark beside a paragraph, or right-click → <strong>Bookmark this place</strong>.
          Give it a name if you like. Your bookmarks are listed at the top of the book's <strong>Contents</strong> and
          under <strong>My Study → Bookmarks</strong>, and are included in the My Study backup.
        </p>
        <p>
          <strong>The natural voice is a one-time download</strong> (about 200 MB), so the app itself stays smaller: go to{" "}
          <strong>Settings → Read aloud</strong> and press <em>Download the natural voice</em>. Until then, Listen uses the
          computer's built-in voice. Once downloaded it works offline, and it can be removed there again to free space.
        </p>
        <ul>
          <li>
            <strong>Listen to any text:</strong> select it with the mouse, right-click, and choose{" "}
            <strong>Listen to selection</strong>. This works for a few verses (each is highlighted as it's read) and for
            anything in a side panel — a commentary note, a Word Study, a dictionary entry, an answer. The same menu can
            copy the selection, add it to the study basket, or search for it. Commentary notes, Word Study entries,
            dictionary entries and answers also have their own 🔊 <strong>Listen</strong> button.
          </li>
          <li>
            <strong>Keys while it reads:</strong> <kbd>Space</kbd> pauses and continues; <kbd>←</kbd> and <kbd>→</kbd> go
            back or skip ahead one sentence. The double arrows on the player skip a whole paragraph (or verse).
          </li>
          <li>
            <strong>Sleep timer:</strong> on the player, choose to stop after 15, 30 or 60 minutes, or at the end of the
            chapter being read.
          </li>
          <li>
            The floating player has pause / continue, back and skip, stop, the <strong>voice</strong> (28 English voices,
            American and British, men and women), the <strong>speed</strong>, and <em>Carry on to the next chapter</em>.{" "}
            <strong>Drag it by its grip</strong> (the dots on the left) to move it off the text; it stays where you put it.
            Double-click the grip to put it back at the bottom.
          </li>
          <li>
            Choose your usual voice and speed in <strong>Settings → Read aloud</strong> (with a <em>Try this voice</em>
            button).
          </li>
          <li>
            The first Listen after starting the app takes a few seconds while the voice gets ready; after that it starts
            straight away.
          </li>
          <li>Read aloud works in English (not the Hebrew and Greek texts).</li>
          <li>Going to another chapter yourself, or changing translation, stops the reading.</li>
        </ul>
      </>
    ),
  },
  {
    id: "library",
    title: "Library: free Bibles, commentaries and books to download",
    keywords: "library download install sword crosswire ebible net bible module bible commentary dictionary devotional book barnes spurgeon josephus pilgrim afrikaans geneva add import own file zip language epub ebook e-book kindle pdf",
    body: (
      <>
        <p>
          <strong>Study → Library</strong> opens a catalogue of about 400 free works from the CrossWire Bible Society — Bibles
          (the Geneva Bible, Tyndale, Douay-Rheims, the Afrikaans 1953 Bybel and many other languages), commentaries
          (Barnes, Robertson's Word Pictures, Spurgeon's Treasury of David, the Treasury of Scripture Knowledge…),
          dictionaries (the International Standard Bible Encyclopedia, Hitchcock's Bible Names…), devotionals (Spurgeon's
          Morning and Evening, Daily Light) and classic books (Josephus, Pilgrim's Progress, Calvin's Institutes, John Owen,
          Jonathan Edwards…).
        </p>
        <ul>
          <li>
            <strong>Get more</strong>: filter by kind and language, search, and press <strong>Install</strong>. The internet is
            needed only while it downloads (most are a few MB); afterwards it works offline.
          </li>
          <li>
            <strong>From</strong> (at the top of Get more) chooses where the list comes from: <em>CrossWire</em> (the main
            library), <em>eBible.org</em> (about 1,500 Bibles and New Testaments in a very wide range of languages),{" "}
            <em>NET Bible</em> (the free edition), <em>Wycliffe</em> (minority languages), <em>CrossWire Attic</em> (older
            editions) and <em>CrossWire Beta</em> (still being tested).
          </li>
          <li>
            <strong>Add from file</strong>: add an <strong>e-book in EPUB format</strong> (<em>.epub</em>), a{" "}
            <strong>book as a PDF</strong> (<em>.pdf</em>) or a SWORD module (<em>.zip</em>) that you already have. A PDF
            stores printed pages rather than chapters and paragraphs, so it comes out rougher than an EPUB (a stray page
            header here and there; chapters only if the PDF has bookmarks, otherwise it's divided into parts) — choose the
            EPUB when a book comes in both. The app checks the whole file first and shows what it found (its title,
            how many chapters, anything left out). Nothing is added unless every check passes and you press{" "}
            <em>Add to my library</em>. An e-book then appears under <strong>Books</strong> in the left-hand list like any
            other, with contents, search and Listen; Bible references in its text ("John 3:16") become links. Only the text
            is added, not pictures. Items you add yourself are marked <em>Added by you</em> and can be removed again.
          </li>
          <li>
            <strong>e-Sword and MySword modules</strong>: <em>Add from file</em> also takes modules made for e-Sword (
            <em>.bblx .cmtx .dctx .topx .lexx .devx .refx</em>) and MySword (<em>.mybible</em>, also packed in <em>.gz</em> or{" "}
            <em>.zip</em>). A Bible joins your translation list, a commentary the Commentary panel, a dictionary, lexicon or
            topics the Dictionary panel, and a book or devotional your books. <em>Several files…</em> and{" "}
            <em>A whole folder…</em> add many at once and report on each. Modules locked by their publisher (e-Sword's own and
            bought modules) can't be opened; the app says so and adds nothing. Only add modules you have the right to use —
            many shared online are copies of copyrighted Bibles and books made without permission.
          </li>
          <li>
            <strong>Community libraries</strong>: below <em>Add from file</em>. <em>Search BibleSupport</em> searches the largest
            collection of e-Sword and MySword modules (downloading there needs a free account); MySword's own Bibles,
            commentaries, dictionaries, books and devotionals, eswordlibrary.com and bible.org's own studies are a click away. They
            open in your browser: choose and download there, then add the file here. The app itself downloads nothing from these
            sites. e-Sword's own website has no modules to download — its library is only inside the e-Sword program.
          </li>
          <li>
            <strong>Finding your place in a book</strong>: the slider above the text runs across the whole book — drag it to
            move, and it shows how far through you are. A book added from a PDF also shows the printed book's page numbers as
            small grey numbers in the text, with a <em>Page … of …</em> box to go straight to a page. Every book reopens at
            the place where you stopped reading.
          </li>
          <li>
            What can't be added: <strong>copy-protected</strong> e-books (most Kindle, Kobo and Apple Books purchases, and
            library loans — the app says so and stops), password-protected PDFs, Kindle files, scanned books that are only
            pictures of pages, and anything damaged. Add only files you have the right to use; they stay on this computer.
          </li>
          <li>
            Installed <strong>Bibles</strong> appear in the translation list, <strong>commentaries</strong> in the Commentary
            panel and <strong>dictionaries</strong> in the Dictionary panel, alongside the built-in ones.{" "}
            <strong>Books and devotionals</strong> open in their own reader — with contents, search, Previous/Next, and
            Listen / Copy / Basket for each section; devotionals open at today's date.
          </li>
          <li>
            <strong>My library</strong> lists what you've installed, with Read/Open and Remove. Each item's licence is shown;
            most are public domain.
          </li>
          <li>
            CrossWire itself files a few works under "questionable material"; they stay hidden unless you tick{" "}
            <em>Show questionable material</em>.
          </li>
          <li>
            Some Bibles number verses differently (e.g. the Jewish and Catholic traditions), so a verse can sit under a
            slightly different number than in the KJV. A Bible that includes the Apocrypha (Tobit, Judith, Wisdom, Sirach,
            Maccabees…) lists those books under <strong>Apocrypha</strong> in the left-hand list while you're reading that
            Bible; they have no interlinear.
          </li>
          <li>
            <strong>Apocrypha cross-references</strong>: the link button beside a verse in an Apocrypha book lists the
            passages that older printed Bibles connected with it — the 66 books first, then other Apocrypha books — and
            each entry names the Bible whose notes it comes from (mainly the Swedish Bible of 1917). For a verse in the 66
            books, the cross-reference panel has a separate box, <em>Related passages in the Apocrypha</em>, when there are
            any. The Apocrypha are always marked <em>not Scripture</em>: these links give history and background, and
            don't mean the Bible treats those books as Scripture.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "pictures",
    title: "Pictures (Bible art for each chapter)",
    keywords: "pictures images art illustrations dore tissot sweet gallery download",
    body: (
      <>
        <p>
          <strong>Explore → Pictures</strong> offers collections of Bible art — Gustave Doré's engravings, James Tissot's
          paintings of the life of Christ and of the Old Testament, and Sweet Publishing's colour illustrations — each
          picture linked to the passage it shows.
        </p>
        <ul>
          <li>
            On the <strong>Download</strong> tab, pick the collections you want (sizes are shown). They download once, gently,
            one picture at a time — you can stop and resume — and then work offline.
          </li>
          <li>
            When a chapter has pictures, a <strong>Pictures (n)</strong> button appears beside its title. Click a picture to
            see it large, with its caption, passage, artist and licence; ← and → step through, Esc closes.
          </li>
          <li>
            <strong>Gallery</strong> shows a whole collection. Any picture can be added to the{" "}
            <strong>study basket</strong>, and it then prints on the study sheet and goes into the Word document.
          </li>
          <li>Pictures come from Wikimedia Commons; each shows its source and licence.</li>
        </ul>
      </>
    ),
  },
  {
    id: "basket",
    title: "Study basket (gather material from anywhere)",
    keywords: "basket collect gather sermon service preparation outline sheet print word copy",
    body: (
      <>
        <p>
          The study basket collects material for one study, sermon or service from all over the app, then turns it into a
          single study sheet.
        </p>
        <ul>
          <li>
            Add things with the <strong>Basket</strong> button beside a commentary note, a cross reference, a dictionary entry,
            an answer, or an item in My Study — or with <strong>⋯ → Add to study basket</strong> on any verse (in the
            translation you're reading).
          </li>
          <li>
            Open it with <strong>Basket</strong> in the top bar (the number shows how many items it holds). Move items up and
            down, <strong>Edit</strong> any heading or text (this only changes the basket copy), remove items, and{" "}
            <strong>Add your own text</strong> — an opening prayer, outline points, questions for discussion.
          </li>
          <li>
            <strong>Make study sheet</strong> shows the whole basket as one page, in your order, with a title and blank lines
            for notes. Print it, save it as PDF or Word, or copy it — the same as a passage study sheet.
          </li>
          <li>The basket is kept until you empty it, even after closing the app.</li>
        </ul>
      </>
    ),
  },
  {
    id: "comfort",
    title: "Appearance, reading comfort and focus mode",
    keywords: "text size font line spacing width focus full screen f11 dark mode light mode theme colour color contrast pale grey faint red letter words of jesus",
    body: (
      <>
        <p>
          In <strong>Settings → Reading comfort</strong> change the text size, line spacing and page width. They're remembered
          next time.
        </p>
        <p>
          <strong>Words of Jesus in red</strong> (red-letter edition) is on by default and can be switched off there too. It
          works in the BSB, KJV, WEB, ASV and YLT and in the Greek TR and THGNT texts, and carries through to study sheets.
          The KJV and WEB mark His words in their source texts; for the other translations the marking was carried across
          word by word and fitted to each translation's own quotation marks, so an occasional boundary may differ slightly
          from a printed red-letter Bible.
        </p>
        <p>
          <strong>Focus</strong> in the top bar (or <K>F11</K>) goes full screen with just the text — no book list or panels.{" "}
          <K>Esc</K> comes back.
        </p>
        <p>
          <strong>Settings → Appearance</strong> chooses a light or dark <strong>theme</strong> (or matches Windows), the{" "}
          <strong>text colour</strong> (standard, strongest black or white, warm sepia, or blue-black) and the{" "}
          <strong>contrast</strong>. If headings or small labels look too pale, set Contrast to <em>High</em>.
        </p>
      </>
    ),
  },
  {
    id: "online",
    title: "NIV, NKJV and ESV (online)",
    keywords: "niv nkjv esv online key api bible crossway compare",
    body: (
      <p>
        These modern translations are copyrighted, so they aren't built in. If you get a free key from api.bible (NIV, NKJV)
        or api.esv.org (ESV) and paste it in <strong>Settings</strong>, they appear in <em>Compare translations</em> while
        you're online. Everything else in the app works fully offline.
      </p>
    ),
  },
  {
    id: "updates",
    title: "Updates, and when something goes wrong",
    keywords: "update new version upgrade install check automatic error problem log diagnostics crash bug report",
    body: (
      <>
        <p>
          <strong>Updates</strong>: when you're online the app looks for a new version about once a day and, if there is
          one, offers it in a small card at the bottom right — press <em>Update</em> and it downloads, installs and opens
          again by itself. Your notes, highlights, Library and pictures are kept. You can also check yourself, or turn the
          automatic check off, in <strong>Settings → Updates</strong>. Every update is checked against the app's digital
          signature before it's installed.
        </p>
        <p>
          <strong>If something goes wrong</strong>, the details are written to a log file on this computer (nothing is sent
          anywhere). <strong>Settings → Diagnostics</strong> has <em>Show log file</em> and <em>Copy recent log</em> — include
          that when reporting a problem. If a screen ever fails to draw, the app shows a <em>Reload</em> button instead of a
          blank window; your data is safe.
        </p>
      </>
    ),
  },
  {
    id: "keys",
    title: "Keyboard shortcuts",
    keywords: "keyboard shortcut keys",
    body: (
      <ul className="shortcut-list">
        <li>
          <K>←</K> <K>→</K> previous / next chapter
        </li>
        <li>
          <K>Ctrl</K> <K>K</K> jump to the search box
        </li>
        <li>
          <K>Esc</K> close the side panel, or leave focus mode
        </li>
        <li>
          <K>F11</K> focus mode
        </li>
        <li>
          <K>Ctrl</K> <K>Enter</K> save the note you're writing
        </li>
      </ul>
    ),
  },
];

export function HelpPanel({ onBack, onClose }: Props) {
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>("start");
  const q = filter.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? SECTIONS.filter((s) => `${s.title} ${s.keywords}`.toLowerCase().includes(q)) : SECTIONS),
    [q],
  );

  return (
    <aside className="side-panel wide help-panel">
      <div className="side-panel-header">
        <h3>Help &amp; user guide</h3>
        <button onClick={onClose} aria-label="Close panel">
          <CloseIcon size={14} />
        </button>
      </div>
      <button className="text-btn" onClick={onBack}>
        ← Back to Settings
      </button>
      <div className="search-controls">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="What do you want to do? (e.g. highlight, print, interlinear)"
          aria-label="Search the user guide"
          autoFocus
        />
      </div>
      {shown.length === 0 && <p className="muted">Nothing in the guide matches "{filter.trim()}".</p>}
      {shown.map((s) => (
        <details
          key={s.id}
          className="help-section"
          open={q ? true : open === s.id}
          onToggle={(e) => {
            if (q) return;
            const el = e.currentTarget;
            if (el.open) setOpen(s.id);
            else if (open === s.id) setOpen(null);
          }}
        >
          <summary>{s.title}</summary>
          <div className="help-body">{s.body}</div>
        </details>
      ))}
    </aside>
  );
}
