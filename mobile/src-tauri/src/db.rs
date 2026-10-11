//! The Bible text. Named and shaped like the desktop app's `db` module, because the
//! shared search (`sermon.rs`, used from the desktop app's source) refers to it.

use std::path::Path;
use std::sync::Mutex;

use rusqlite::{Connection, OpenFlags};

pub struct DbState(pub Mutex<Connection>);

pub fn open_read_only(path: &Path) -> rusqlite::Result<Connection> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
}
