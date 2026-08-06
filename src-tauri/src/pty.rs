use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;
use tauri::State;
use uuid::Uuid;

const MAX_PTY_DIMENSION: u16 = 1_000;

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyEvent {
    kind: &'static str,
    data: Option<Vec<u8>>,
    message: Option<String>,
    exit_code: Option<i32>,
}

pub fn validate_pty_size(cols: u16, rows: u16) -> Result<PtySize, String> {
    if cols == 0 || rows == 0 || cols > MAX_PTY_DIMENSION || rows > MAX_PTY_DIMENSION {
        return Err("PTY dimensions must be between 1 and 1000.".to_string());
    }
    Ok(PtySize {
        cols,
        rows,
        pixel_width: 0,
        pixel_height: 0,
    })
}

#[tauri::command]
pub fn pty_spawn(
    state: State<'_, PtyState>,
    cols: u16,
    rows: u16,
    on_event: Channel<PtyEvent>,
) -> Result<String, String> {
    let size = validate_pty_size(cols, rows)?;
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|error| error.to_string())?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let mut command = CommandBuilder::new_default_prog();
    if let Some(home) = dirs::home_dir() {
        command.cwd(home);
    }
    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    drop(pair.slave);

    let id = Uuid::new_v4().to_string();
    state
        .sessions
        .lock()
        .map_err(|_| "PTY state lock poisoned.".to_string())?
        .insert(
            id.clone(),
            PtySession {
                master: pair.master,
                writer,
                killer: child.clone_killer(),
            },
        );

    let sessions = state.sessions.clone();
    let thread_id = id.clone();
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    if on_event
                        .send(PtyEvent {
                            kind: "data",
                            data: Some(buffer[..read].to_vec()),
                            message: None,
                            exit_code: None,
                        })
                        .is_err()
                    {
                        let _ = child.kill();
                        break;
                    }
                }
                Err(error) => {
                    let _ = on_event.send(PtyEvent {
                        kind: "error",
                        data: None,
                        message: Some(error.to_string()),
                        exit_code: None,
                    });
                    break;
                }
            }
        }
        let exit_code = child.wait().ok().map(|status| status.exit_code() as i32);
        if let Ok(mut sessions) = sessions.lock() {
            sessions.remove(&thread_id);
        }
        let _ = on_event.send(PtyEvent {
            kind: "exit",
            data: None,
            message: None,
            exit_code,
        });
    });

    Ok(id)
}

/// Spawns an isolated sandbox command in a PTY. The AI path never uses the
/// host shell or host working directory.
#[tauri::command(async)]
pub async fn pty_spawn_command(
    state: State<'_, PtyState>,
    app_state: State<'_, crate::AppState>,
    cols: u16,
    rows: u16,
    command: String,
    cwd: Option<String>,
    sandbox_id: String,
    relay_request_id: Option<String>,
    on_event: Channel<PtyEvent>,
) -> Result<String, String> {
    let size = validate_pty_size(cols, rows)?;
    let sessions = state.sessions.clone();
    let sandboxes = app_state.sandboxes.clone();
    let sidecar = app_state.ai.clone();
    tauri::async_runtime::spawn_blocking(move || {
        spawn_ai_command(
            sessions,
            sandboxes,
            sidecar,
            size,
            command,
            cwd,
            sandbox_id,
            relay_request_id,
            on_event,
        )
    })
    .await
    .map_err(|error| format!("AI PTY worker failed: {error}"))?
}

fn spawn_ai_command(
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    sandboxes: Arc<crate::sandbox::SandboxManager>,
    sidecar: Arc<crate::ai_sidecar::AiSidecar>,
    size: PtySize,
    command: String,
    cwd: Option<String>,
    sandbox_id: String,
    relay_request_id: Option<String>,
    on_event: Channel<PtyEvent>,
) -> Result<String, String> {
    let status_channel = on_event.clone();
    let status = move |message: &str| {
        let _ = status_channel.send(PtyEvent {
            kind: "status",
            data: None,
            message: Some(message.to_string()),
            exit_code: None,
        });
    };
    status("Initializing sandbox…");
    let sandbox_command =
        match sandboxes.spawn_command(&sandbox_id, &command, cwd.as_deref(), &status) {
            Ok(command) => command,
            Err(error) => {
                let _ = on_event.send(PtyEvent {
                    kind: "error",
                    data: None,
                    message: Some(error.clone()),
                    exit_code: None,
                });
                relay_pty_failure(&sidecar, relay_request_id.as_deref(), &error);
                return Err(error);
            }
        };
    status("Starting terminal…");
    let pair = native_pty_system()
        .openpty(size)
        .map_err(|error| error.to_string())
        .map_err(|error| {
            relay_pty_failure(&sidecar, relay_request_id.as_deref(), &error);
            error
        })?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())
        .map_err(|error| {
            relay_pty_failure(&sidecar, relay_request_id.as_deref(), &error);
            error
        })?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())
        .map_err(|error| {
            relay_pty_failure(&sidecar, relay_request_id.as_deref(), &error);
            error
        })?;
    let mut builder = CommandBuilder::new(&sandbox_command.program);
    for arg in sandbox_command.args {
        builder.arg(arg);
    }
    let mut child = pair
        .slave
        .spawn_command(builder)
        .map_err(|error| error.to_string())
        .map_err(|error| {
            relay_pty_failure(&sidecar, relay_request_id.as_deref(), &error);
            error
        })?;
    drop(pair.slave);

    if let Err(error) = sandboxes.command_started(&sandbox_id) {
        let _ = child.kill();
        relay_pty_failure(&sidecar, relay_request_id.as_deref(), &error);
        return Err(error);
    }

    let id = Uuid::new_v4().to_string();
    let insert_result = sessions
        .lock()
        .map_err(|_| "PTY state lock poisoned.".to_string())
        .map(|mut sessions| {
            sessions.insert(
                id.clone(),
                PtySession {
                    master: pair.master,
                    writer,
                    killer: child.clone_killer(),
                },
            );
        });
    if let Err(error) = insert_result {
        let _ = child.kill();
        let _ = sandboxes.command_finished(&sandbox_id);
        relay_pty_failure(&sidecar, relay_request_id.as_deref(), &error);
        return Err(error);
    }

    let thread_id = id.clone();
    let relay = relay_request_id.map(|request_id| (request_id, sidecar.clone()));
    let port_manager = sandboxes.clone();
    let port_sandbox_id = sandbox_id.clone();
    let monitor_sessions = sessions.clone();
    let monitor_id = id.clone();
    let monitor_manager = sandboxes.clone();
    let monitor_sandbox_id = sandbox_id.clone();
    std::thread::spawn(move || loop {
        let alive = monitor_sessions
            .lock()
            .map(|sessions| sessions.contains_key(&monitor_id))
            .unwrap_or(false);
        if !alive {
            break;
        }
        let _ = monitor_manager.refresh_ports(&monitor_sandbox_id);
        std::thread::sleep(Duration::from_secs(1));
    });
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    let chunk = buffer[..read].to_vec();
                    if on_event
                        .send(PtyEvent {
                            kind: "data",
                            data: Some(chunk.clone()),
                            message: None,
                            exit_code: None,
                        })
                        .is_err()
                    {
                        let _ = child.kill();
                        break;
                    }
                    if let Some((request_id, sidecar)) = &relay {
                        if let Err(error) = forward_pty_event(
                            sidecar,
                            request_id,
                            "pty-data",
                            json!({ "data": chunk }),
                        ) {
                            crate::startup_log::log_error(format!(
                                "AI PTY data relay failed for {request_id}: {error}"
                            ));
                        }
                    }
                }
                Err(error) => {
                    let _ = on_event.send(PtyEvent {
                        kind: "error",
                        data: None,
                        message: Some(error.to_string()),
                        exit_code: None,
                    });
                    break;
                }
            }
        }
        let _ = port_manager.refresh_ports(&port_sandbox_id);
        let exit_code = child.wait().ok().map(|status| status.exit_code() as i32);
        if let Ok(true) = port_manager.workspace_limit_reached(&port_sandbox_id) {
            let warning =
                "Sandbox workspace limit reached. Delete files or reset the sandbox before the next command.";
            let _ = on_event.send(PtyEvent {
                kind: "status",
                data: None,
                message: Some(warning.to_string()),
                exit_code: None,
            });
            if let Some((request_id, sidecar)) = &relay {
                let _ = forward_pty_event(
                    sidecar,
                    request_id,
                    "pty-data",
                    json!({ "data": format!("\r\n{warning}\r\n").into_bytes() }),
                );
            }
        }
        let _ = port_manager.command_finished(&port_sandbox_id);
        if let Ok(mut sessions) = sessions.lock() {
            sessions.remove(&thread_id);
        }
        let _ = on_event.send(PtyEvent {
            kind: "exit",
            data: None,
            message: None,
            exit_code,
        });
        if let Some((request_id, sidecar)) = &relay {
            if let Err(error) = forward_pty_event(
                sidecar,
                request_id,
                "pty-exit",
                json!({ "exitCode": exit_code }),
            ) {
                crate::startup_log::log_error(format!(
                    "AI PTY exit relay failed for {request_id}: {error}"
                ));
            }
        }
    });

    Ok(id)
}

fn forward_pty_event(
    sidecar: &Arc<crate::ai_sidecar::AiSidecar>,
    request_id: &str,
    kind: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    tauri::async_runtime::block_on(sidecar.forward(json!({
        "type": kind,
        "requestId": request_id,
        "payload": payload,
    })))
}

fn relay_pty_failure(
    sidecar: &Arc<crate::ai_sidecar::AiSidecar>,
    request_id: Option<&str>,
    error: &str,
) {
    let Some(request_id) = request_id else {
        return;
    };
    let _ = forward_pty_event(
        sidecar,
        request_id,
        "pty-data",
        json!({ "data": error.as_bytes().to_vec() }),
    );
    let _ = forward_pty_event(sidecar, request_id, "pty-exit", json!({ "exitCode": -1 }));
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    // ponytail: one global lock is enough for one viewport terminal; use a
    // per-session lock if concurrent terminal tabs are added.
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "PTY state lock poisoned.".to_string())?;
    let session = sessions
        .get_mut(&id)
        .ok_or_else(|| "PTY session not found.".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, PtyState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let size = validate_pty_size(cols, rows)?;
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "PTY state lock poisoned.".to_string())?;
    sessions
        .get(&id)
        .ok_or_else(|| "PTY session not found.".to_string())?
        .master
        .resize(size)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn pty_close(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| "PTY state lock poisoned.".to_string())?
        .remove(&id);
    if let Some(mut session) = session {
        session.killer.kill().map_err(|error| error.to_string())?;
    }
    Ok(())
}
