mod ai_sidecar;
mod auth;
mod commands;
mod connections;
mod db;
mod error;
mod memory;
mod mobile_pairing;
mod mobile_push;
mod models;
pub mod pty;
mod runtime;
pub mod sandbox;
mod startup_log;
mod updater;
mod whisper_state;
mod window_state_recovery;

use crate::commands::db_commands::execute_sql;
use crate::commands::dictation_commands::{
    download_whisper_model, get_whisper_models_status, native_dictation_audio_level,
    preload_whisper_model, release_tts_engine, release_whisper_model, select_whisper_model,
    start_native_dictation_recording, stop_native_dictation_and_transcribe,
    stop_native_dictation_recording, transcribe_audio, transcribe_native_dictation_partial,
};
use crate::connections::secrets::{KeyringSecretStore, SecretStore};
use crate::mobile_pairing::{
    mobile_pairing_start, mobile_pairing_status, mobile_pairing_stop, MobilePairingState,
};
use crate::updater::{check_for_updates, download_update, install_update};
use crate::whisper_state::WhisperState;
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use std::time::Instant;
use tauri::Manager;
use tokio::sync::Mutex;

/// The AI SDK sidecar supervisor, reachable from the exit handler.
///
/// `RunEvent::ExitRequested` has no `AppState`, and the exit path hard-exits
/// without unwinding, so the supervisor must be reachable without going through
/// managed state.
static AI_SIDECAR_FOR_EXIT: std::sync::OnceLock<Arc<crate::ai_sidecar::AiSidecar>> =
    std::sync::OnceLock::new();
static SANDBOXES_FOR_EXIT: std::sync::OnceLock<Arc<crate::sandbox::SandboxManager>> =
    std::sync::OnceLock::new();

pub struct AppState {
    pub db: SqlitePool,
    pub ai: Arc<crate::ai_sidecar::AiSidecar>,
    pub sandboxes: Arc<crate::sandbox::SandboxManager>,
    pub last_update_check: Mutex<Option<Instant>>,
    pub update_download_path: Mutex<Option<PathBuf>>,
    /// OS keychain. The database only ever holds a reference into this.
    pub secret_store: Arc<dyn SecretStore>,
}

#[cfg(target_os = "windows")]
const ONNXRUNTIME_LIBRARY_NAME: &str = "onnxruntime.dll";
#[cfg(target_os = "macos")]
const ONNXRUNTIME_LIBRARY_NAME: &str = "libonnxruntime.dylib";
#[cfg(target_os = "linux")]
const ONNXRUNTIME_LIBRARY_NAME: &str = "libonnxruntime.so";

fn onnxruntime_path(resource_dir: &Path) -> PathBuf {
    resource_dir.join(ONNXRUNTIME_LIBRARY_NAME)
}

fn initialize_onnxruntime(app: &tauri::App) -> Result<(), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let path = onnxruntime_path(&resource_dir);
    ort::init_from(&path)
        .map_err(|error| {
            format!(
                "failed to load ONNX Runtime from {}: {error}",
                path.display()
            )
        })?
        .commit();
    Ok(())
}

#[tauri::command]
fn restart_app(app: tauri::AppHandle) -> Result<(), String> {
    let env = app.env();
    app.run_on_main_thread(move || {
        tauri::process::restart(&env);
    })
    .map_err(|error| error.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    startup_log::install_panic_hook();
    startup_log::log_phase("app entry reached");
    startup_log::log_startup_environment();

    let context = tauri::generate_context!();
    startup_log::log_phase("config loaded");
    window_state_recovery::recover_invalid_window_state();

    startup_log::log_phase("plugin init: fs");
    let builder = tauri::Builder::default().plugin(tauri_plugin_fs::init());
    startup_log::log_phase("plugin init: http");
    let builder = builder.plugin(tauri_plugin_http::init());
    startup_log::log_phase("plugin init: sql");
    let builder = builder.plugin(tauri_plugin_sql::Builder::default().build());
    startup_log::log_phase("plugin init: opener");
    let builder = builder.plugin(tauri_plugin_opener::init());
    startup_log::log_phase("plugin init: window-state");
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    startup_log::log_phase("plugin init: os");
    let builder = builder.plugin(tauri_plugin_os::init());
    startup_log::log_phase("plugin init: notification");
    let builder = builder.plugin(tauri_plugin_notification::init());
    startup_log::log_phase("plugin init: dialog");
    let builder = builder.plugin(tauri_plugin_dialog::init());
    startup_log::log_phase("plugin init: supertonic");
    let builder = builder.plugin(tauri_plugin_supertonic::init());

    startup_log::log_phase("plugins registered");

    let result = builder
        .manage(MobilePairingState::default())
        .manage(pty::PtyState::default())
        .setup(|app| {
            startup_log::log_phase("setup hook entered");
            startup_log::log_phase("ONNX Runtime initialization");
            initialize_onnxruntime(app).map_err(|error| {
                startup_log::log_error(&error);
                std::io::Error::other(error)
            })?;
            startup_log::log_phase("ONNX Runtime ready");
            match app.path().app_data_dir() {
                Ok(path) => startup_log::log_phase(format!("app_data_dir: {}", path.display())),
                Err(error) => {
                    startup_log::log_error(format!("app_data_dir lookup failed: {error}"))
                }
            }
            match app.path().app_config_dir() {
                Ok(path) => startup_log::log_phase(format!("app_config_dir: {}", path.display())),
                Err(error) => {
                    startup_log::log_error(format!("app_config_dir lookup failed: {error}"))
                }
            }
            match app.path().app_local_data_dir() {
                Ok(path) => {
                    startup_log::log_phase(format!("app_local_data_dir: {}", path.display()))
                }
                Err(error) => {
                    startup_log::log_error(format!("app_local_data_dir lookup failed: {error}"))
                }
            }
            startup_log::log_phase("database opening");
            let db = init_db_with_retry(app.handle()).map_err(|error| {
                startup_log::log_error(format!("database init failed: {error}"));
                std::io::Error::other(error)
            })?;
            startup_log::log_phase("database ready");

            let secret_store: Arc<dyn SecretStore> = Arc::new(KeyringSecretStore);
            let ai =
                crate::ai_sidecar::AiSidecar::new(app.handle()).map_err(std::io::Error::other)?;
            let sandboxes = Arc::new(
                crate::sandbox::SandboxManager::new(app.handle()).map_err(std::io::Error::other)?,
            );
            AI_SIDECAR_FOR_EXIT
                .set(ai.clone())
                .unwrap_or_else(|_| log::warn!("AI sidecar was registered twice"));
            SANDBOXES_FOR_EXIT
                .set(sandboxes.clone())
                .unwrap_or_else(|_| log::warn!("sandbox manager was registered twice"));
            app.manage(AppState {
                db: db.clone(),
                ai,
                sandboxes,
                last_update_check: Mutex::new(None),
                update_download_path: Mutex::new(None),
                secret_store: secret_store.clone(),
            });

            // Runtime rework data migration. Off the setup thread because it
            // touches the OS keychain, which blocks. Idempotent, so a failure
            // here is retried on the next launch and leaves provider_configs
            // untouched — the app stays usable on the existing path either way.
            let migration_db = db;
            tauri::async_runtime::spawn(async move {
                match db::rework_migration::run(&migration_db, secret_store.as_ref()).await {
                    Ok(report) => {
                        startup_log::log_phase(format!("runtime rework migration ok: {report:?}"));
                        match db::cleanup_migration::run(&migration_db, &report).await {
                            Ok(outcome) => startup_log::log_phase(format!(
                                "runtime cleanup migration: {outcome:?}"
                            )),
                            Err(error) => startup_log::log_error(format!(
                                "runtime cleanup migration failed: {error}"
                            )),
                        }
                    }
                    Err(error) => {
                        startup_log::log_error(format!("runtime rework migration failed: {error}"));
                    }
                }
            });
            let app_data_dir = app.path().app_data_dir().map_err(|error| {
                startup_log::log_error(format!("app data dir failed: {error}"));
                std::io::Error::other(error)
            })?;
            app.manage(WhisperState::new(app_data_dir));
            startup_log::log_phase("whisper state initialized");

            if let Some(_window) = app.get_webview_window("main") {
                startup_log::log_phase("main window created");
                _window.on_window_event(|event| match event {
                    tauri::WindowEvent::CloseRequested { .. } => {
                        startup_log::log_phase("window close requested");
                    }
                    tauri::WindowEvent::Destroyed => {
                        startup_log::log_phase("window destroyed");
                    }
                    tauri::WindowEvent::Focused(focused) => {
                        startup_log::log_phase(format!("window focused: {focused}"));
                    }
                    _ => {}
                });
                #[cfg(target_os = "macos")]
                {
                    let _ = _window.set_title_bar_style(tauri::TitleBarStyle::Overlay);
                }
                #[cfg(target_os = "windows")]
                apply_native_rounded_corners(&_window);
                #[cfg(target_os = "linux")]
                let _ = _window.set_decorations(false);
            } else {
                startup_log::log_error("main window missing during setup");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth::auth_signup,
            auth::auth_login,
            auth::auth_logout,
            auth::auth_get_current_user,
            auth::auth_update_status,
            auth::auth_update_profile,
            auth::auth_change_password,
            commands::connection_commands::resolve_legacy_default_model,
            commands::connection_commands::validate_connection,
            commands::connection_commands::refresh_connection_models,
            commands::connection_commands::save_manual_connection_model,
            commands::connection_commands::save_chat_connection,
            commands::connection_commands::list_chat_connections,
            commands::connection_commands::list_connection_models,
            commands::connection_commands::list_connection_summaries,
            commands::connection_commands::delete_chat_connection,
            commands::connection_commands::list_workspaces,
            commands::connection_commands::save_workspace,
            commands::connection_commands::get_conversation_runtime,
            commands::connection_commands::set_conversation_runtime,
            commands::connection_commands::list_recent_runtimes,
            commands::ai_runtime_commands::ai_runtime_start,
            commands::ai_runtime_commands::ai_runtime_agent_models,
            commands::ai_runtime_commands::ai_runtime_cancel,
            commands::ai_runtime_commands::ai_runtime_approval,
            commands::ai_runtime_commands::ai_runtime_models,
            commands::ai_runtime_commands::ai_runtime_generate,
            commands::ai_runtime_commands::web_search_credential_status,
            commands::ai_runtime_commands::set_web_search_credential,
            commands::agent_commands::agent_cli_status,
            commands::memory_commands::memory_get_settings,
            commands::memory_commands::memory_update_settings,
            commands::memory_commands::memory_test_connection,
            commands::memory_commands::memory_list,
            commands::memory_commands::memory_search,
            commands::memory_commands::memory_update,
            commands::memory_commands::memory_delete,
            commands::memory_commands::memory_clear_scope,
            commands::memory_commands::memory_clear_all,
            commands::memory_commands::memory_remember_message,
            commands::memory_commands::memory_forget_message,
            commands::memory_commands::memory_get_related,
            commands::memory_commands::memory_extract_user_message,
            commands::memory_commands::memory_list_for_chat,
            commands::memory_commands::memory_debug_extract_last_turn,
            commands::memory_commands::memory_enqueue_completed_turn,
            execute_sql,
            #[cfg(feature = "dev-sql-console")]
            commands::db_commands::clear_database,
            check_for_updates,
            download_update,
            install_update,
            restart_app,
            get_whisper_models_status,
            download_whisper_model,
            select_whisper_model,
            release_whisper_model,
            release_tts_engine,
            native_dictation_audio_level,
            preload_whisper_model,
            start_native_dictation_recording,
            stop_native_dictation_recording,
            stop_native_dictation_and_transcribe,
            transcribe_audio,
            transcribe_native_dictation_partial,
            startup_frontend_loaded,
            log_startup_error,
            log_startup_phase,
            startup_log_path,
            mobile_pairing_start,
            mobile_pairing_stop,
            mobile_pairing_status,
            pty::pty_spawn,
            pty::pty_spawn_command,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            sandbox::sandbox_destroy,
            sandbox::sandbox_ports,
            sandbox::sandbox_stop_processes,
            sandbox::sandbox_diagnostics,
        ])
        .build(context);
    startup_log::log_phase("tauri app built");

    let app = match result {
        Ok(app) => app,
        Err(error) => {
            startup_log::log_error(format!("tauri run failed: {error}"));
            panic!("error while running tauri application: {error}");
        }
    };

    app.run(|_app, event| {
        if let tauri::RunEvent::ExitRequested { code, .. } = event {
            // ponytail: hard-exit before Tauri teardown. Closing the sqlite pools
            // (block_on on the main thread) and dropping the ONNX/Supertonic
            // sessions deadlocks on Linux, leaving a frozen "not responding"
            // window. SQLite is crash-safe and window state is saved on
            // CloseRequested, so skipping cleanup loses nothing.
            //
            // Kill every agent child before the hard exit below. `process::exit`
            // runs no destructors, so `OwnedChild::drop` never fires here — this
            // is the only thing standing between quitting the app and leaving an
            // orphaned agent (and, via the job object, its whole tree) behind.
            if let Some(ai) = AI_SIDECAR_FOR_EXIT.get() {
                startup_log::log_phase("exit requested; stopping AI sidecar");
                tauri::async_runtime::block_on(ai.shutdown());
            }
            if let Some(sandboxes) = SANDBOXES_FOR_EXIT.get() {
                startup_log::log_phase("exit requested; destroying AI sandboxes");
                if let Err(error) = sandboxes.destroy_all() {
                    startup_log::log_error(format!("sandbox cleanup failed: {error}"));
                }
            }

            startup_log::log_phase("exit requested; terminating process");
            std::process::exit(code.unwrap_or(0));
        }
    });
    startup_log::log_phase("process exit");
}

#[tauri::command]
fn startup_frontend_loaded() -> Option<String> {
    startup_log::log_phase("frontend loaded");
    startup_log::log_path().map(|path| path.display().to_string())
}

#[tauri::command]
fn log_startup_error(message: String) {
    startup_log::log_error(format!("frontend startup failed: {message}"));
}

#[tauri::command]
fn log_startup_phase(message: String) {
    startup_log::log_phase(format!("frontend: {message}"));
}

#[tauri::command]
fn startup_log_path() -> Option<String> {
    startup_log::log_path().map(|path| path.display().to_string())
}

fn init_db_with_retry(app: &tauri::AppHandle) -> Result<SqlitePool, String> {
    let mut last_error = String::new();

    for attempt in 0..5 {
        match tauri::async_runtime::block_on(db::connection::init_db(app)) {
            Ok(db) => return Ok(db),
            Err(error) => {
                last_error = error;
                thread::sleep(Duration::from_millis(200 * (attempt + 1)));
            }
        }
    }

    Err(last_error)
}

#[cfg(target_os = "windows")]
fn apply_native_rounded_corners(window: &tauri::WebviewWindow) {
    use raw_window_handle::HasWindowHandle;
    if let Ok(handle) = window.window_handle() {
        if let raw_window_handle::RawWindowHandle::Win32(win32) = handle.as_raw() {
            use windows_sys::Win32::Graphics::Dwm::{
                DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
            };
            let preference = DWMWCP_ROUND;
            unsafe {
                DwmSetWindowAttribute(
                    win32.hwnd.get() as *mut std::ffi::c_void,
                    DWMWA_WINDOW_CORNER_PREFERENCE as u32,
                    &preference as *const _ as *const std::ffi::c_void,
                    std::mem::size_of::<u32>() as u32,
                );
            }
        }
    }
}

#[cfg(test)]
mod supertonic_runtime_tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn onnxruntime_uses_tauri_resource_directory() {
        let resource_dir = Path::new("/app/resources");

        assert_eq!(
            onnxruntime_path(resource_dir),
            resource_dir.join(ONNXRUNTIME_LIBRARY_NAME)
        );
    }
}
