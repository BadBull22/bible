const COMMANDS: &[&str] = &["share", "speak", "stop_speaking", "save_text", "open_text"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
