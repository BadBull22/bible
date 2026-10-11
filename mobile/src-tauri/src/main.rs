// Prevents an extra console window on Windows in release (the app also runs as a desktop
// window, which is how it is tried out before it goes onto a phone).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    bible_pocket_lib::run()
}
