//! What the desktop app and the phone app share, so it is written once: reading SWORD,
//! e-Sword and MySword modules (`sword`, `esword`, `markup`), Bible references and book names
//! (`refs`), keeping devices in step through a shared folder (`sync`), and the search: what a
//! search means and how its passages rank (`find`: names, numbers, spelling) and, with the `meaning` feature, finding
//! verses by meaning (`meaning`). Nothing here knows
//! about Tauri or either app's screens.

pub mod esword;
pub mod find;
pub mod library;
pub mod markup;
#[cfg(feature = "meaning")]
pub mod meaning;
pub mod refs;
pub mod sword;
pub mod sync;
