const COMMANDS: &[&str] = &["share", "speak", "stop_speaking", "save_text", "open_text", "open_file", "pick_folder", "battery_settings", "open_link", "voices", "share_image", "save_image", "install_update", "list_computer_pictures", "read_computer_picture", "save_computer_picture", "share_computer_pictures", "open_computer_file", "share_file", "save_backup_copy", "list_backup_copies", "read_backup_copy"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
