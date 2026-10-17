//! What the desktop app and the phone app share, so it is written once: reading SWORD,
//! e-Sword and MySword modules (`sword`, `esword`, `markup`), Bible references and book names
//! (`refs`), and keeping devices in step through a shared folder (`sync`). Nothing here knows
//! about Tauri or either app's screens.

pub mod esword;
pub mod library;
pub mod markup;
pub mod refs;
pub mod sword;
pub mod sync;
