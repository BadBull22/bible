const COMMANDS: &[&str] = &["share", "speak", "stop_speaking", "save_text", "open_text", "voices", "share_image", "save_image"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
