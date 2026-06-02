#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

#[tauri::command]
fn app_data_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    let dir = app_handle
        .path_resolver()
        .app_data_dir()
        .ok_or("Could not resolve app data dir")?;
    Ok(dir.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![app_data_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
