// Jendela konsol tidak ikut muncul di Windows (rilis).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    rakit_desktop_lib::run()
}
