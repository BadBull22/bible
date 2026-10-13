//! The phone's database, search and marks, run against the real bundled database.
//! (`cargo test --test phone`: the unit tests of the shared desktop search need the
//! desktop databases and are not run from here.)

use bible_pocket_lib::{db, search, unpack_db, userdata};
use rusqlite::Connection;

fn open() -> (Connection, Connection) {
    // tests run side by side; the app itself unpacks once, at start
    static ONE_AT_A_TIME: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
    let dir = std::env::temp_dir().join("bible-pocket-test");
    let path = unpack_db(&dir).unwrap();
    assert_eq!(unpack_db(&dir).unwrap(), path, "unpacking again reuses the same file");
    (db::open_read_only(&path).unwrap(), db::open_read_only(&path).unwrap())
}

#[test]
fn reads_the_bible() {
    let (d, _) = open();
    let versions = search::versions(&d).unwrap();
    assert_eq!(versions.iter().map(|v| v.code.as_str()).collect::<Vec<_>>(), ["BSB", "KJV", "ASV", "YLT", "WEB"]);
    let books = search::books(&d).unwrap();
    assert_eq!(books.len(), 66);
    assert_eq!((books[0].name.as_str(), books[0].chapters), ("Genesis", 50));
    assert_eq!(books.iter().find(|b| b.name == "Psalms").unwrap().chapters, 150);
    assert_eq!(books.iter().filter(|b| b.testament == "NT").count(), 27);
    let john3 = search::chapter(&d, "KJV", "John", 3).unwrap();
    assert_eq!(john3.len(), 36);
    assert!(john3[15].text.starts_with("For God so loved the world"));

    // the words of Jesus: all of John 3:16, none of the narrator's 3:1, and only the part
    // He speaks in 3:3 ("Jesus replied, ..."), in every translation
    assert!(john3[0].red.is_empty());
    assert!(!john3[15].red.is_empty() && john3[15].red[0].0 == 0);
    assert!(john3[2].red[0].0 > 0, "not the words that introduce Him");
    for v in ["BSB", "ASV", "WEB", "YLT"] {
        assert!(!search::chapter(&d, v, "John", 3).unwrap()[15].red.is_empty(), "{v}");
    }
    assert!(search::chapter(&d, "BSB", "Genesis", 1).unwrap().iter().all(|v| v.red.is_empty()));
    assert!(search::chapter(&d, "BSB", "Revelation", 22).unwrap().iter().any(|v| !v.red.is_empty()));
}

#[test]
fn searches_words_phrases_and_subjects() {
    let (d, s) = open();
    let all = search::Scope::default();

    // an exact phrase: found, counted, and shown in the translation being read
    let r = search::search(&d, &s, "your faith has healed you", "BSB", all, 200).unwrap();
    assert!(r.exact >= 3, "exact {}", r.exact);
    // (a hit may be a short passage that contains the verse)
    let has = |hits: &[search::Hit], book: &str, chapter: i64, verse: i64| hits.iter().any(|h| h.book == book && h.chapter == chapter && h.verse <= verse && verse <= h.verse_end);
    assert!(has(&r.hits, "Mark", 10, 52));
    let kjv = search::search(&d, &s, "thy faith hath made thee whole", "KJV", all, 200).unwrap();
    assert!(has(&kjv.hits, "Mark", 10, 52));
    assert!(kjv.hits.iter().any(|h| h.book == "Mark" && h.chapter == 10 && h.text.contains("made thee whole")));

    // a subject: the central passages come back, not only verses with the word
    let gifts = search::search(&d, &s, "gifts of the spirit", "BSB", all, 200).unwrap();
    assert!(gifts.hits.iter().any(|h| h.book == "1 Corinthians" && h.chapter == 12), "1 Corinthians 12 for the gifts of the Spirit");
    assert!(gifts.hits[0].why.iter().any(|w| w == "core"));

    // kept to a testament, or to one book
    let nt = search::search(&d, &s, "shepherd", "BSB", search::Scope { testament: Some("NT"), book: None }, 500).unwrap();
    assert!(!nt.hits.is_empty() && nt.hits.iter().all(|h| !["Psalms", "Ezekiel", "Genesis"].contains(&h.book.as_str())));
    let psalms = search::search(&d, &s, "shepherd", "BSB", search::Scope { testament: None, book: Some("Psalms") }, 500).unwrap();
    assert!(has(&psalms.hits, "Psalms", 23, 1) && psalms.hits.iter().all(|h| h.book == "Psalms"));
    assert!(psalms.exact < nt.exact + 100 && psalms.exact > 0);

    // nothing to search for, and odd punctuation, are not errors
    assert!(search::search(&d, &s, "  ", "BSB", all, 50).unwrap().hits.is_empty());
    search::search(&d, &s, "\"love (one) another*", "BSB", all, 50).unwrap();

    // topical headings
    let faith = search::topics(&s, "faith").unwrap();
    assert!(!faith.is_empty() && faith[0].name.to_lowercase() == "faith", "{faith:?}");
    let verses = search::topic_verses(&d, &s, faith[0].id, "BSB", 400).unwrap();
    assert!(verses.len() > 10 && verses.iter().all(|h| !h.text.is_empty()));
}

#[test]
fn bookmarks_and_highlights() {
    let c = Connection::open_in_memory().unwrap();
    userdata::init(&c).unwrap();
    assert!(userdata::toggle_bookmark(&c, "John", 3, 16).unwrap());
    assert!(userdata::toggle_bookmark(&c, "John", 3, 3).unwrap());
    userdata::set_highlight(&c, "John", 3, 16, Some("yellow")).unwrap();
    userdata::set_highlight(&c, "John", 3, 16, Some("green")).unwrap();
    assert!(userdata::set_highlight(&c, "John", 3, 17, Some("tartan")).is_err());
    userdata::set_note(&c, "John", 3, 16, "  The gospel in one verse. ").unwrap();
    assert_eq!(userdata::note(&c, "John", 3, 16).unwrap(), "The gospel in one verse.");
    assert_eq!(userdata::note(&c, "John", 3, 17).unwrap(), "");
    assert_eq!(marks_of(&c), (vec![3, 16], vec![(16, "green".to_string())], vec![16]));
    assert_eq!(userdata::bookmarks(&c).unwrap().len(), 2);
    assert_eq!(userdata::highlights(&c).unwrap()[0].color, "green");
    assert!(!userdata::toggle_bookmark(&c, "John", 3, 3).unwrap(), "a second tap removes it");
    userdata::set_highlight(&c, "John", 3, 16, None).unwrap();
    assert_eq!(marks_of(&c), (vec![16], vec![], vec![16]));
    userdata::set_note(&c, "John", 3, 16, " ").unwrap();
    assert!(userdata::notes(&c).unwrap().is_empty(), "an empty note is removed");
}

fn marks_of(c: &Connection) -> (Vec<i64>, Vec<(i64, String)>, Vec<i64>) {
    let m = userdata::chapter_marks(c, "John", 3).unwrap();
    (m.bookmarks, m.highlights, m.notes)
}

#[test]
fn plans_and_backup() {
    let mut phone = Connection::open_in_memory().unwrap();
    userdata::init(&phone).unwrap();
    userdata::toggle_bookmark(&phone, "Romans", 8, 28).unwrap();
    userdata::set_highlight(&phone, "Psalms", 23, 1, Some("blue")).unwrap();
    userdata::set_note(&phone, "Romans", 8, 28, "All things.").unwrap();
    userdata::start_plan(&phone, "nt-90", "2026-10-01").unwrap();
    userdata::set_plan_day(&phone, "nt-90", 1, true).unwrap();
    userdata::set_plan_day(&phone, "nt-90", 2, true).unwrap();
    userdata::set_plan_day(&phone, "nt-90", 2, false).unwrap();
    assert_eq!(userdata::plan_progress(&phone).unwrap(), [userdata::PlanProgress { plan_id: "nt-90".into(), started_on: "2026-10-01".into(), done_days: vec![1] }]);

    let (json, counts) = userdata::backup_json(&phone).unwrap();
    assert_eq!(counts, userdata::Counts { bookmarks: 1, highlights: 1, notes: 1, plans: 1 });
    assert!(json.contains("bible-concordance-study/1"));

    // onto a fresh phone, then again: nothing doubles
    let mut other = Connection::open_in_memory().unwrap();
    userdata::init(&other).unwrap();
    assert_eq!(userdata::restore(&mut other, &json).unwrap(), counts);
    assert_eq!(userdata::restore(&mut other, &json).unwrap(), userdata::Counts::default());
    assert_eq!(userdata::note(&other, "Romans", 8, 28).unwrap(), "All things.");
    assert_eq!(userdata::plan_progress(&other).unwrap()[0].done_days, [1]);

    // a backup from the desktop app: its extra parts are left alone, a bright colour becomes
    // the nearest of the phone's, a note's tags and range are kept, and a newer note wins
    let desktop = r#"{"format":"bible-concordance-study/1","exported_at":"2030-01-01 10:00:00",
        "bookmarks":[{"book":"John","chapter":1,"verse":1,"value":"","created_at":"2026-01-01 08:00:00","verse_text":"In the beginning"}],
        "highlights":[{"book":"John","chapter":1,"verse":1,"value":"lime","created_at":"2026-01-01 08:00:00"},
                      {"book":"Psalms","chapter":23,"verse":1,"value":"pink","created_at":"2026-01-01 08:00:00"}],
        "notes":[{"book":"Romans","chapter":8,"verse":28,"value":"Newer, from the desktop.","created_at":"2026-01-01 08:00:00","updated_at":"2099-01-01 08:00:00","verse_end":30,"tags":["hope","sermon"]}],
        "plans":[{"plan_id":"nt-90","started_on":"2026-09-01","done_days":[1,5]}],
        "sermons":[{"id":3,"title":"Faith"}],"book_bookmarks":[{"module":"x","section":1,"para":2}]}"#;
    let n = userdata::restore(&mut phone, desktop).unwrap();
    assert_eq!(n, userdata::Counts { bookmarks: 1, highlights: 1, notes: 1, plans: 1 });
    assert_eq!(userdata::note(&phone, "Romans", 8, 28).unwrap(), "Newer, from the desktop.");
    let m = userdata::chapter_marks(&phone, "John", 1).unwrap();
    assert_eq!(m.highlights, [(1, "green".to_string())]);
    assert_eq!(userdata::chapter_marks(&phone, "Psalms", 23).unwrap().highlights, [(1, "blue".to_string())], "a highlight already here keeps its colour");
    let p = &userdata::plan_progress(&phone).unwrap()[0];
    assert_eq!((p.started_on.as_str(), p.done_days.as_slice()), ("2026-10-01", &[1, 5][..]));
    let back = userdata::backup(&phone).unwrap();
    let note = back.notes.iter().find(|n| n.book == "Romans").unwrap();
    assert_eq!((note.verse_end, note.tags.clone()), (Some(30), vec!["hope".to_string(), "sermon".to_string()]));

    assert!(userdata::restore(&mut phone, "not a backup").is_err());
    assert!(userdata::restore(&mut phone, r#"{"format":"something-else/9"}"#).is_err());
}

#[test]
fn a_verse_looked_at_more_closely() {
    let (d, s) = open();
    let refs = search::cross_refs(&d, "BSB", "John", 3, 16).unwrap();
    assert!(refs.len() >= 8 && refs.len() <= 12, "{}", refs.len());
    assert_eq!((refs[0].book.as_str(), refs[0].chapter, refs[0].verse), ("Romans", 5, 8), "the most agreed-on first");
    assert!(refs.iter().all(|h| !h.text.is_empty()));
    assert!(search::cross_refs(&d, "BSB", "John", 3, 999).unwrap().is_empty());

    let all = search::compare(&d, "John", 3, 16).unwrap();
    assert_eq!(all.iter().map(|(code, _)| code.as_str()).collect::<Vec<_>>(), ["BSB", "KJV", "ASV", "YLT", "WEB"]);
    assert!(all[1].1.contains("only begotten Son"));

    let found = search::articles(&s, "faith", 60).unwrap();
    assert_eq!(found[0].name.to_lowercase(), "faith");
    let article = search::article(&s, found[0].id).unwrap().unwrap();
    assert!(article.body.len() > 200 && article.body.contains('⟦'), "an article, with its references marked");
    let jerusalem = search::articles(&s, "jerusalem", 60).unwrap();
    assert!(jerusalem.iter().any(|a| a.source.starts_with("Easton")) && jerusalem.iter().any(|a| a.source.starts_with("Smith")), "both dictionaries");
    assert!(search::articles(&s, "x", 60).unwrap().is_empty());
    assert!(search::article(&s, -1).unwrap().is_none());

    // a search offers articles and topics on its subject, and topics are never articles
    let r = search::search(&d, &s, "baptism", "BSB", search::Scope::default(), 50).unwrap();
    assert!(!r.articles.is_empty() && r.articles.len() <= 6);
    assert!(r.topics.iter().all(|t| t.source.contains("Topical")));
}

#[test]
fn word_study_and_commentary() {
    use bible_pocket_lib::study_extra;
    let (d, _) = open();
    // John 3:16 in the KJV: "loved" is G25, "God" G2316; a translation without tagging uses the BSB
    let (used, words) = study_extra::verse_words(&d, "KJV", "John", 3, 16).unwrap();
    assert_eq!(used, "KJV");
    assert!(words.iter().any(|w| w.text.to_lowercase().contains("loved") && w.numbers.contains(&"G25".to_string())), "{words:?}");
    assert_eq!(study_extra::verse_words(&d, "WEB", "John", 3, 16).unwrap().0, "BSB");
    // Hebrew: one English word can carry two numbers
    let (_, gen) = study_extra::verse_words(&d, "BSB", "Genesis", 1, 1).unwrap();
    assert!(gen.iter().any(|w| w.numbers.contains(&"H430".to_string())));

    let love = study_extra::strongs_entry(&d, "g26").unwrap().unwrap();
    assert_eq!((love.number.as_str(), love.language.as_str()), ("G26", "Greek"));
    assert!(love.definition.contains("love"));
    assert!(love.counts.iter().any(|(v, verses, n)| v == "KJV" && *verses > 80 && n >= verses), "{:?}", love.counts);
    assert!(study_extra::strongs_entry(&d, "X1").unwrap().is_none());
    let uses = study_extra::strongs_uses(&d, "KJV", "G26", 500).unwrap();
    assert!(uses.len() > 80 && uses.iter().any(|u| u.book == "1 Corinthians" && u.chapter == 13));
    assert!(uses.windows(2).all(|w| (&w[0].book, w[0].chapter, w[0].verse) != (&w[1].book, w[1].chapter, w[1].verse)));

    let notes = study_extra::verse_notes(&d, "John", 3, 16).unwrap();
    assert!(!notes.is_empty() && notes.iter().all(|n| n.verse_start == 16), "{notes:?}");
    assert!(notes.iter().any(|n| n.text.contains("God loved the world")));
    // a verse inside a note's range gets that note
    assert_eq!(study_extra::verse_notes(&d, "John", 3, 15).unwrap()[0].verse_start, 14);
    assert!(study_extra::chapter_notes(&d, "John", 3).unwrap().len() >= 10);
    assert!(study_extra::book_intro(&d, "Ruth").unwrap().contains("Naomi"));
    let about = study_extra::commentary_about(&d).unwrap();
    assert_eq!((about.name.as_str(), about.licence.as_str()), ("Tyndale Open Study Notes", "CC BY-SA 4.0"));
}

#[test]
fn tags_and_the_reading_streak() {
    let mut c = Connection::open_in_memory().unwrap();
    userdata::init(&c).unwrap();
    userdata::toggle_bookmark(&c, "John", 3, 16).unwrap();
    userdata::set_note(&c, "Romans", 8, 28, "All things.").unwrap();
    userdata::set_tags(&c, "bookmarks", "John", 3, 16, &["#Hope, prayer ".into(), "hope".into()]).unwrap();
    userdata::set_tags(&c, "notes", "Romans", 8, 28, &["Hope".into()]).unwrap();
    assert_eq!(userdata::tags_of(&c, "bookmarks", "John", 3, 16).unwrap(), ["Hope", "prayer"]);
    assert_eq!(userdata::bookmarks(&c).unwrap()[0].tags, ["Hope", "prayer"]);
    assert_eq!(userdata::all_tags(&c).unwrap(), [("Hope".to_string(), 2), ("prayer".to_string(), 1)]);
    assert!(userdata::set_tags(&c, "highlights", "John", 3, 16, &[]).is_err());

    for (day, ch) in [("2026-10-01", 1), ("2026-10-02", 2), ("2026-10-02", 3), ("2026-10-04", 4), ("2026-10-05", 4), ("2026-10-06", 5)] {
        userdata::mark_read(&c, "Mark", ch, day).unwrap();
    }
    let s = userdata::reading_stats(&c, "2026-10-06").unwrap();
    assert_eq!((s.streak, s.best_streak, s.read_today, s.days, s.chapters), (3, 3, true, 5, 5));
    assert_eq!(s.books, [("Mark".to_string(), 5)]);
    assert_eq!(userdata::reading_stats(&c, "2026-10-07").unwrap().streak, 3, "yesterday still counts");
    assert_eq!(userdata::reading_stats(&c, "2026-10-08").unwrap().streak, 0);

    // the backup carries the bookmark's tags and the reading log
    let (json, _) = userdata::backup_json(&c).unwrap();
    let mut other = Connection::open_in_memory().unwrap();
    userdata::init(&other).unwrap();
    userdata::restore(&mut other, &json).unwrap();
    assert_eq!(userdata::tags_of(&other, "bookmarks", "John", 3, 16).unwrap(), ["Hope", "prayer"]);
    assert_eq!(userdata::reading_stats(&other, "2026-10-06").unwrap().chapters, 5);
    let _ = &mut c;
}

#[test]
fn an_older_database_gets_bookmark_tags() {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("CREATE TABLE bookmarks (book TEXT NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT '', PRIMARY KEY (book, chapter, verse)); INSERT INTO bookmarks (book, chapter, verse) VALUES ('John', 1, 1);").unwrap();
    userdata::init(&c).unwrap();
    userdata::init(&c).unwrap();
    assert_eq!(userdata::bookmarks(&c).unwrap()[0].tags, Vec::<String>::new());
}

/// Downloads a real translation from eBible.org: needs the internet, so run it by name:
/// `cargo test --test phone downloads_a_translation -- --ignored`.
#[test]
#[ignore]
fn downloads_a_translation() {
    use bible_pocket_lib::bibles;
    let mut c = Connection::open_in_memory().unwrap();
    bibles::init(&c).unwrap();
    let offers = bibles::catalog(&c, "2026-10-13", false).unwrap();
    assert!(offers.len() > 1000, "{}", offers.len());
    let luther = offers.iter().find(|o| o.id == "deu1912").expect("Luther 1912 is offered").clone();
    let n = bibles::install(&mut c, &luther, &|_| {}).unwrap();
    assert!(n > 31000, "{n}");
    let john3 = bibles::chapter(&c, "deu1912", "John", 3).unwrap();
    assert!(john3[15].text.contains("Also hat Gott die Welt geliebt"), "{}", john3[15].text);
    assert_eq!(bibles::installed(&c).unwrap()[0].code, "deu1912");
    assert!(bibles::catalog(&c, "2026-10-14", false).unwrap().iter().any(|o| o.id == "deu1912" && o.installed), "the cached list, marked installed");
    bibles::remove(&c, "deu1912").unwrap();
    assert!(bibles::installed(&c).unwrap().is_empty());
}

/// Downloads the nature backgrounds from the GitHub release: needs the internet, so run it by
/// name: `cargo test --test phone downloads_the_backgrounds -- --ignored`.
#[test]
#[ignore]
fn downloads_the_backgrounds() {
    use bible_pocket_lib::backgrounds;
    let dir = std::env::temp_dir().join("bible-pocket-backgrounds-test");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    assert_eq!(backgrounds::count(&dir), 0);
    let n = backgrounds::install(&dir, &|_| {}).unwrap();
    assert_eq!(n, 100);
    let thumbs = backgrounds::thumbs(&dir).unwrap();
    assert_eq!(thumbs.len(), 100);
    assert!(thumbs.iter().any(|t| t.theme == "sunset") && thumbs.iter().any(|t| t.theme == "sheep"));
    let (b64, info) = backgrounds::image(&dir, &thumbs[0].id).unwrap();
    assert!(b64.len() > 20_000 && info.licence == "CC0", "{}", info.licence);
    assert!(backgrounds::image(&dir, "../x").is_err());
    backgrounds::remove(&dir).unwrap();
    assert_eq!(backgrounds::count(&dir), 0);
}
