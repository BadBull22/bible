fn main() {
    // the database is compiled into the app (see lib.rs), so a new one means a rebuild
    println!("cargo:rerun-if-changed=resources/phone.db.gz");
    tauri_build::build()
}
