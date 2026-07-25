//! CEF offscreen rendering (OSR) viewport — spike (`spike/cef-osr`).
//!
//! Why this exists: both existing viewport surfaces are dead ends. An iframe
//! dies on X-Frame-Options/CSP/frame-busting; a native child webview dies on
//! airspace (it composites above all HTML, so Radix overlays land underneath).
//! CEF OSR escapes both: Chromium renders the page into a buffer here, the
//! frames are shipped to the frontend, and the page is drawn into a `<canvas>`
//! that lives in the normal DOM.
//!
//! Linux and Windows only, gated by the `cef` cfg that `build.rs` emits. macOS
//! is excluded: CEF there refuses to re-execute the main binary and instead
//! requires four helper `.app` bundles inside `Contents/Frameworks`, which the
//! Tauri bundler does not produce. See spike-notes.md.
//!
//! ## Layout
//!
//! - [`lifecycle`] — process startup/teardown, CEF settings, the on/off pref.
//! - [`browser`] — the single OSR browser instance and the CEF UI thread hop.
//! - [`handlers`] — CEF callback objects (paint, cursor, address).
//! - [`frame`] — BGRA dirty-rect packing for the frontend channel.
//! - [`input`] — frontend input events replayed onto the browser host.
//! - [`commands`] — the Tauri command surface; argument validation lives here.
//!
//! ## Unsafe
//!
//! All unsafe in the CEF integration is confined to this module tree. cef-rs's
//! `wrap_*!` macros generate the refcount plumbing, so the unsafe here is
//! limited to the raw-pointer facts CEF's C API forces on us:
//!
//! 1. `execute_process`/`initialize` take a `*mut u8` Windows sandbox-info
//!    pointer. On Linux it is required to be null.
//! 2. `on_paint` hands us a `*const u8` BGRA buffer owned by CEF, valid only
//!    for the duration of the call.
//! 3. Linux multi-threaded CEF requires Xlib/GDK threading initialized before
//!    either CEF or GTK touches X11.
//!
//! ## Threading invariants
//!
//! - `execute_subprocess` MUST be the first thing `main` does, before any
//!   thread is spawned. CEF forks a zygote on Linux; forking a process that
//!   already has threads is undefined behaviour. Windows has no zygote, but
//!   the call still has to precede any other startup work.
//! - `init` and `shutdown` run on the main application thread. CEF owns a
//!   separate UI thread; all browser work is posted there through
//!   [`browser::on_cef_ui`].

mod browser;
/// Tauri commands. Public because `tauri::generate_handler!` needs to name the
/// hidden items the `#[tauri::command]` macro generates alongside each function.
pub mod commands;
mod frame;
mod handlers;
mod input;
mod lifecycle;

pub use input::{CefInputEvent, CefKeyEventType, CefMouseButton};
pub use lifecycle::{enabled_on_next_start, execute_subprocess, init, shutdown};
