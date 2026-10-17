const COMMANDS: &[&str] = &["share", "speak", "stop_speaking", "save_text", "open_text", "open_file", "pick_folder", "voices", "share_image", "save_image", "install_update"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
