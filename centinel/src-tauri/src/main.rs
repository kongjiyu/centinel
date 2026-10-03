#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::sync::Mutex;
use tauri::Manager;

const AUTH_CALLBACK_EVENT: &str = "centinel://auth-callback";

struct PendingAuthCallback(Mutex<Option<String>>);

#[tauri::command]
fn app_data_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    let dir = app_handle
        .path_resolver()
        .app_data_dir()
        .ok_or("Could not resolve app data dir")?;
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
fn take_auth_callback(state: tauri::State<'_, PendingAuthCallback>) -> Result<Option<String>, String> {
    state
        .0
        .lock()
        .map_err(|_| "Could not read the pending authentication callback.".to_string())
        .map(|mut callback| callback.take())
}

fn main() {
    // On Windows, a second process is launched for centinel:// URLs. Prepare
    // forwards that URL to this primary process before it exits.
    tauri_plugin_deep_link::prepare("com.centinel.app");
    tauri::Builder::default()
        .manage(PendingAuthCallback(Mutex::new(None)))
        .setup(|app| {
            let app_handle = app.handle();
            tauri_plugin_deep_link::register("centinel", move |url| {
                if url.starts_with(AUTH_CALLBACK_EVENT) {
                    if let Ok(mut pending) = app_handle.state::<PendingAuthCallback>().0.lock() {
                        *pending = Some(url.clone());
                    }
                    let _ = app_handle.emit_all(AUTH_CALLBACK_EVENT, url);
                }
                if let Some(window) = app_handle.get_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![app_data_dir, take_auth_callback])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
