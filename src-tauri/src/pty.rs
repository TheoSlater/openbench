use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
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
                    });
                    break;
                }
            }
        }
        let _ = child.wait();
        if let Ok(mut sessions) = sessions.lock() {
            sessions.remove(&thread_id);
        }
        let _ = on_event.send(PtyEvent {
            kind: "exit",
            data: None,
            message: None,
        });
    });

    Ok(id)
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
