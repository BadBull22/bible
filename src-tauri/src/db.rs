use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

pub fn open(db_path: PathBuf) -> Connection {
    let conn = Connection::open(db_path).expect("failed to open bible.db");
    conn.pragma_update(None, "query_only", true).ok();
    conn
}
