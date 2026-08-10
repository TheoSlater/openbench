use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use sysinfo::{
    CpuRefreshKind, MemoryRefreshKind, ProcessesToUpdate, RefreshKind, System,
};
use tauri::{AppHandle, Emitter};

/// How often the worker samples CPU / memory and emits a stats event.
const SAMPLE_INTERVAL: Duration = Duration::from_millis(100);

pub const DEBUG_STATS_EVENT: &str = "debug-overlay-stats";
pub const DEV_LOG_EVENT: &str = "dev-log";

const MAX_DEV_LOG_MESSAGE_LENGTH: usize = 1200;
static DEV_LOGGING_ENABLED: AtomicBool = AtomicBool::new(true);

pub fn short_id(value: &str) -> String {
    value.chars().take(16).collect()
}

pub fn stop_dev_logging() {
    DEV_LOGGING_ENABLED.store(false, Ordering::SeqCst);
}

fn dev_logging_enabled() -> bool {
    cfg!(debug_assertions) && DEV_LOGGING_ENABLED.load(Ordering::Relaxed)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevLogPayload {
    pub level: String,
    pub message: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugStatsPayload {
    pub seq: u64,
    pub cpu_percent: f32,
    pub mem_total_mb: u64,
    pub mem_used_mb: u64,
    pub app_mem_mb: f64,
}

pub struct DebugOverlayState {
    enabled: AtomicBool,
    stopping: Arc<AtomicBool>,
    worker: Mutex<Option<thread::JoinHandle<()>>>,
}

impl Default for DebugOverlayState {
    fn default() -> Self {
        Self {
            enabled: AtomicBool::new(false),
            stopping: Arc::new(AtomicBool::new(false)),
            worker: Mutex::new(None),
        }
    }
}

/// Starts or stops the stats worker. Starting twice is a no-op; stopping
/// joins the worker (it exits within `SAMPLE_INTERVAL`).
pub fn set_enabled(state: &DebugOverlayState, app: &AppHandle, on: bool) {
    if state.enabled.swap(on, Ordering::SeqCst) == on {
        return;
    }
    if on {
        state.stopping.store(false, Ordering::Relaxed);
        let stop = state.stopping.clone();
        let app = app.clone();
        let worker = thread::spawn(move || stats_worker(app, stop));
        *state.worker.lock().expect("overlay worker mutex poisoned") = Some(worker);
        terminal_log("info", "debug overlay enabled");
    } else {
        state.stopping.store(true, Ordering::Relaxed);
        if let Some(worker) = state.worker.lock().expect("overlay worker mutex poisoned").take() {
            let _ = worker.join();
        }
        terminal_log("info", "debug overlay disabled");
    }
}

fn stats_worker(app: AppHandle, stop: Arc<AtomicBool>) {
    let mut system = System::new_with_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::nothing().with_cpu_usage())
            .with_memory(MemoryRefreshKind::nothing().with_ram()),
    );
    system.refresh_cpu_usage();
    system.refresh_memory();
    let current_pid = sysinfo::get_current_pid().ok();

    let mut seq = 0u64;
    while !stop.load(Ordering::Relaxed) {
        let tick = Instant::now();
        system.refresh_cpu_usage();
        system.refresh_memory();
        if let Some(pid) = &current_pid {
            system.refresh_processes(ProcessesToUpdate::Some(std::slice::from_ref(pid)), true);
        }

        seq += 1;
        let app_mem_mb = current_pid
            .as_ref()
            .and_then(|pid| system.process(*pid))
            .map(|process| bytes_to_mb(process.memory()))
            .unwrap_or(0.0);
        let payload = DebugStatsPayload {
            seq,
            cpu_percent: system.global_cpu_usage(),
            mem_total_mb: bytes_to_mb(system.total_memory()) as u64,
            mem_used_mb: bytes_to_mb(system.used_memory()) as u64,
            app_mem_mb,
        };
        let _ = app.emit(DEBUG_STATS_EVENT, &payload);

        let elapsed = tick.elapsed();
        if elapsed < SAMPLE_INTERVAL {
            thread::sleep(SAMPLE_INTERVAL - elapsed);
        }
    }
}

fn bytes_to_mb(bytes: u64) -> f64 {
    bytes as f64 / (1024.0 * 1024.0)
}

pub fn terminal_log(level: &str, message: &str) {
    if !dev_logging_enabled() {
        return;
    }
    let message = message
        .chars()
        .take(MAX_DEV_LOG_MESSAGE_LENGTH)
        .collect::<String>();
    match level {
        "error" => log::error!("[dev] {message}"),
        "warn" => log::warn!("[dev] {message}"),
        _ => log::info!("[dev] {message}"),
    }
    println!("[dev] {message}");
}

pub fn emit_dev_log(app: &tauri::AppHandle, level: &str, message: &str) {
    if !dev_logging_enabled() {
        return;
    }
    let message = message
        .chars()
        .take(MAX_DEV_LOG_MESSAGE_LENGTH)
        .collect::<String>();
    terminal_log(level, &message);
    let _ = app.emit(
        DEV_LOG_EVENT,
        DevLogPayload {
            level: level.to_string(),
            message,
        },
    );
}

#[tauri::command]
pub fn debug_overlay_enable(
    app: tauri::AppHandle,
    state: tauri::State<'_, DebugOverlayState>,
    enabled: bool,
) {
    set_enabled(state.inner(), &app, enabled);
}

#[tauri::command]
pub fn debug_log(level: String, message: String) {
    if cfg!(debug_assertions) {
        terminal_log(&level, &message);
    }
}
