#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

const AUTH_CALLBACK_EVENT: &str = "centinel://auth-callback";
const SIDECAR_PORT: u16 = 37701;

struct PendingAuthCallback(Mutex<Option<String>>);

/// The local service (sidecar) started by this app, if any.
struct SidecarProcess(Mutex<Option<Child>>);

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

/// Stops the local service this app started. The updater's restart skips
/// `RunEvent::Exit`, so without this the old version's service keeps running
/// and the updated app reuses it.
#[tauri::command]
fn stop_sidecar(state: tauri::State<'_, SidecarProcess>) -> Result<(), String> {
    let mut slot = state
        .0
        .lock()
        .map_err(|_| "Could not stop the local service.".to_string())?;
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

/// True when something already listens on the sidecar port, e.g. `pnpm dev`.
fn sidecar_already_running() -> bool {
    ["127.0.0.1", "[::1]"].iter().any(|host| {
        format!("{host}:{SIDECAR_PORT}")
            .parse::<SocketAddr>()
            .map(|addr| TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok())
            .unwrap_or(false)
    })
}

/// Apps opened from Finder get a minimal PATH. Add the usual install
/// locations so the sidecar can find the Codex CLI and other tools.
fn tool_path() -> String {
    let separator = if cfg!(windows) { ';' } else { ':' };
    let path = std::env::var("PATH").unwrap_or_default();
    if cfg!(windows) {
        // Windows apps inherit the full user PATH; the Unix locations below do not apply.
        return path;
    }
    let mut parts: Vec<String> = path
        .split(separator)
        .filter(|part| !part.is_empty())
        .map(String::from)
        .collect();
    let mut extra = vec!["/opt/homebrew/bin".to_string(), "/usr/local/bin".to_string()];
    if let Ok(home) = std::env::var("HOME") {
        extra.push(format!("{home}/.local/bin"));
        extra.push(format!("{home}/.npm-global/bin"));
    }
    for dir in extra.into_iter().rev() {
        if !parts.contains(&dir) {
            parts.insert(0, dir);
        }
    }
    parts.join(":")
}

/// Start the bundled sidecar in packaged builds. Development builds and
/// machines that already run a sidecar keep using the existing one.
fn start_sidecar(app: &tauri::App) -> Result<Option<Child>, String> {
    if cfg!(debug_assertions) || sidecar_already_running() {
        return Ok(None);
    }
    let resolver = app.path_resolver();
    let script = match resolver.resolve_resource("resources/sidecar/dist/index.mjs") {
        Some(path) if path.exists() => path,
        _ => return Ok(None),
    };
    let sidecar_dir: PathBuf = script
        .parent()
        .and_then(|dist| dist.parent())
        .ok_or("Could not resolve the sidecar directory.")?
        .to_path_buf();
    let exe_dir = std::env::current_exe()
        .map_err(|error| error.to_string())?
        .parent()
        .ok_or("Could not resolve the app directory.")?
        .to_path_buf();
    let node = exe_dir.join(if cfg!(windows) { "centinel-node.exe" } else { "centinel-node" });
    // The official Codex CLI ships next to the app executable (externalBin).
    let codex = exe_dir.join(if cfg!(windows) { "codex.exe" } else { "codex" });
    let sample_shop = resolver
        .resolve_resource("resources/sample-shop")
        .filter(|path| path.join("server.js").exists());
    let home = resolver.app_data_dir().ok_or("Could not resolve the app data directory.")?;
    std::fs::create_dir_all(home.join("logs")).map_err(|error| error.to_string())?;
    let log = std::fs::File::create(home.join("logs/sidecar.log")).map_err(|error| error.to_string())?;
    let errors = log.try_clone().map_err(|error| error.to_string())?;

    let mut command = Command::new(node);
    if codex.exists() {
        command.env("CENTINEL_BUNDLED_CODEX_BIN", &codex);
    }
    if let Some(sample_shop) = sample_shop {
        command.env("CENTINEL_SAMPLE_SHOP_DIR", sample_shop);
    }
    let child = command
        .arg(&script)
        .current_dir(&sidecar_dir)
        .env("CENTINEL_PACKAGED", "1")
        .env("CENTINEL_HOME", &home)
        .env("CENTINEL_RUNTIME_ENV", sidecar_dir.join("runtime.env"))
        .env("PATH", tool_path())
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(errors))
        .spawn()
        .map_err(|error| format!("Could not start the local service: {error}"))?;
    Ok(Some(child))
}

fn main() {
    // On Windows, a second process is launched for centinel:// URLs. Prepare
    // forwards that URL to this primary process before it exits.
    tauri_plugin_deep_link::prepare("com.centinel.app");
    let app = tauri::Builder::default()
        .manage(PendingAuthCallback(Mutex::new(None)))
        .manage(SidecarProcess(Mutex::new(None)))
        .setup(|app| {
            match start_sidecar(app) {
                Ok(child) => {
                    if let Ok(mut slot) = app.state::<SidecarProcess>().0.lock() {
                        *slot = child;
                    }
                }
                Err(error) => eprintln!("[centinel] {error}"),
            }
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
        .invoke_handler(tauri::generate_handler![app_data_dir, take_auth_callback, stop_sidecar])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Ok(mut slot) = app_handle.state::<SidecarProcess>().0.lock() {
                if let Some(mut child) = slot.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    });
}
