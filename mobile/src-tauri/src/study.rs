//! The topical Bibles' headings and references. On the phone they live in the same
//! database file as the Bible text; this is a second connection to it, named and shaped
//! like the desktop app's `study` module for the shared search (`sermon.rs`).

use std::sync::Mutex;

use rusqlite::Connection;

pub struct StudyState(pub Option<Mutex<Connection>>);
