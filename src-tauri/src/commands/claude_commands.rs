//! Tauri surface for Claude Code setup.
//!
//! - [`claude_status`] only reads the durable snapshot. It never spawns.
//! - [`claude_verify`] spawns a process and completes a real ACP handshake.
//!   It is only reachable from an explicit user action in settings.
//! - [`claude_refresh_detection`] is the background refresh, also spawn-free.

use crate::acp::error::AcpError;
use crate::acp::registry::{EventSink, EVENT_QUEUE_CAPACITY};
use crate::claude::setup::{ClaudeSetupState, ClaudeSetupView};
use crate::claude::{self, ClaudeDetection, ClaudeSettings};
use crate::AppState;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

/// The settings value already fully verified during this app session.
#[derive(Debug, Default)]
pub struct ClaudeCache {
    verification_attempted: AtomicBool,
}

impl ClaudeCache {
    fn begin_verification(&self) -> bool {
        !self.verification_attempted.swap(true, Ordering::SeqCst)
    }

    pub fn invalidate(&self) {
        self.verification_attempted.store(false, Ordering::SeqCst);
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn source_name(source: crate::claude::AdapterSource) -> String {
    match source {
        crate::claude::AdapterSource::UserOverride => "user-override",
        crate::claude::AdapterSource::PathLookup => "path-lookup",
        crate::claude::AdapterSource::KnownLocation => "known-location",
    }
    .into()
}

fn installation_state(detection: &ClaudeDetection) -> crate::acp::verification::InstallationState {
    use crate::acp::verification::InstallationState;
    match (
        detection.cli_path.is_some(),
        detection.adapter_path.is_some(),
    ) {
        (false, false) => InstallationState::NotInstalled,
        (false, true) => InstallationState::CliMissing,
        (true, false) => InstallationState::AdapterMissing,
        (true, true)
            if !claude::adapter_version_is_supported(detection.adapter_version.as_deref()) =>
        {
            InstallationState::AdapterOutdated
        }
        (true, true) => InstallationState::Available,
    }
}

fn snapshot(
    detection: &ClaudeDetection,
    authentication: crate::acp::probe::AuthenticationState,
    availability: Option<bool>,
    availability_error: Option<String>,
    checked_at: String,
) -> crate::acp::verification::AgentVerification {
    crate::acp::verification::AgentVerification {
        agent_kind: "claude-code".into(),
        cli_path: detection.cli_path.clone(),
        cli_source: detection.cli_source.map(source_name),
        cli_version: detection.cli_version.clone(),
        cli_checked_at: Some(checked_at.clone()),
        adapter_path: detection.adapter_path.clone(),
        adapter_source: detection.adapter_source.map(source_name),
        adapter_version: detection.adapter_version.clone(),
        adapter_checked_at: Some(checked_at.clone()),
        installation: installation_state(detection),
        availability,
        availability_error,
        availability_checked_at: availability.map(|_| checked_at.clone()),
        authentication,
        auth_checked_at: detection.cli_path.as_ref().map(|_| checked_at.clone()),
        verified_at: availability
            .filter(|available| *available)
            .map(|_| checked_at),
    }
}

fn probe_auth(
    detection: &ClaudeDetection,
) -> Result<crate::acp::probe::AuthenticationState, String> {
    let Some(cli) = detection.cli_path.as_deref() else {
        return Ok(crate::acp::probe::AuthenticationState::NotApplicable);
    };
    crate::acp::probe::run_auth_probe(
        std::path::Path::new(cli),
        &["auth", "status"],
        Some(crate::acp::resolve::augmented_path().as_os_str()),
        std::time::Duration::from_secs(10),
    )
}

/// A workspace is required to spawn, but setup verification is not a
/// workspace concern — a conversation picks its own when it is created. An
/// empty string here means "just prove the handshake works", so it falls
/// back to the user's home directory for that one throwaway process.
fn verification_workspace(workspace: String) -> String {
    if !workspace.is_empty() {
        return workspace;
    }
    dirs::home_dir()
        .map(|path| path.display().to_string())
        .unwrap_or(workspace)
}

/// The current setup state. Never spawns a process.
///
/// A previously-verified agent paints `READY` from the durable record on the
/// first render after an app restart.
#[tauri::command]
pub async fn claude_status(
    state: tauri::State<'_, AppState>,
    settings: ClaudeSettings,
) -> Result<ClaudeSetupView, String> {
    let _ = settings;
    let snapshot = crate::acp::verification::load_snapshot(&state.db, "claude-code").await?;
    Ok(ClaudeSetupState::from_snapshot(snapshot.as_ref()).into())
}

/// Re-check only vendor CLI authentication. Never starts the ACP adapter.
#[tauri::command]
pub async fn claude_revalidate(
    state: tauri::State<'_, AppState>,
) -> Result<ClaudeSetupView, String> {
    let Some(mut snapshot) =
        crate::acp::verification::load_snapshot(&state.db, "claude-code").await?
    else {
        return Ok(ClaudeSetupState::Unknown.into());
    };
    let Some(cli_path) = snapshot.cli_path.as_deref() else {
        return Ok(ClaudeSetupState::from_snapshot(Some(&snapshot)).into());
    };
    let Ok(authentication) = crate::acp::probe::run_auth_probe(
        std::path::Path::new(cli_path),
        &["auth", "status"],
        Some(crate::acp::resolve::augmented_path().as_os_str()),
        std::time::Duration::from_secs(10),
    ) else {
        return Ok(ClaudeSetupState::from_snapshot(Some(&snapshot)).into());
    };
    snapshot.authentication = authentication;
    snapshot.auth_checked_at = Some(now());
    crate::acp::verification::store_snapshot(&state.db, &snapshot).await?;
    Ok(ClaudeSetupState::from_snapshot(Some(&snapshot)).into())
}

/// Re-scan the filesystem. Background refresh; still spawn-free.
#[tauri::command]
pub async fn claude_refresh_detection(settings: ClaudeSettings) -> Result<ClaudeDetection, String> {
    let detection = claude::detect(&settings, now());
    Ok(detection)
}

/// Start the adapter, complete a real ACP handshake, and report what it said.
///
/// The only readiness signal. A process that merely starts and exits zero
/// proves nothing, so nothing here consults an exit code.
#[tauri::command]
pub async fn claude_verify(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    settings: ClaudeSettings,
    workspace: String,
) -> Result<ClaudeSetupView, String> {
    let workspace = verification_workspace(workspace);
    if !state.claude.begin_verification() {
        let snapshot = crate::acp::verification::load_snapshot(&state.db, "claude-code").await?;
        return Ok(ClaudeSetupState::from_snapshot(snapshot.as_ref()).into());
    }
    let checked_at = now();
    let detection = claude::probe_versions(claude::detect(&settings, checked_at.clone()));
    let previous = crate::acp::verification::load_snapshot(&state.db, "claude-code").await?;
    let authentication = probe_auth(&detection).unwrap_or_else(|_| {
        previous
            .map(|snapshot| snapshot.authentication)
            .unwrap_or(crate::acp::probe::AuthenticationState::NotApplicable)
    });
    if installation_state(&detection) != crate::acp::verification::InstallationState::Available {
        let cached = snapshot(&detection, authentication, None, None, checked_at);
        crate::acp::verification::store_snapshot(&state.db, &cached).await?;
        return Ok(ClaudeSetupState::from_snapshot(Some(&cached)).into());
    }

    let options = match claude::launch_options(&detection, &workspace) {
        Ok(options) => options,
        Err(error) => {
            let failure = AcpError::Spawn {
                message: error.to_string(),
                executable: detection.adapter_path.clone().unwrap_or_default(),
            };
            let cached = snapshot(
                &detection,
                authentication,
                Some(false),
                Some(failure.to_string()),
                checked_at,
            );
            crate::acp::verification::store_snapshot(&state.db, &cached).await?;
            return Ok(ClaudeSetupState::from_snapshot(Some(&cached)).into());
        }
    };

    let conversation_id = format!("claude-verify-{}", uuid::Uuid::new_v4());
    let (sink, mut receiver) = EventSink::new(EVENT_QUEUE_CAPACITY);
    tauri::async_runtime::spawn(async move { while receiver.recv().await.is_some() {} });

    let result = state
        .acp
        .start(&conversation_id, "claude", options, sink)
        .await;

    let outcome = match result {
        Ok(_) => {
            state.acp.stop(&conversation_id).await;
            let cached = snapshot(
                &detection,
                authentication,
                Some(true),
                None,
                checked_at.clone(),
            );
            let setup = ClaudeSetupState::from_snapshot(Some(&cached));
            crate::acp::verification::store_snapshot(&state.db, &cached).await?;
            setup
        }
        Err(error) => {
            state.acp.stop(&conversation_id).await;
            let cached = snapshot(
                &detection,
                authentication,
                Some(false),
                Some(error.to_string()),
                checked_at,
            );
            crate::acp::verification::store_snapshot(&state.db, &cached).await?;
            ClaudeSetupState::from_snapshot(Some(&cached))
        }
    };

    let view: ClaudeSetupView = outcome.into();
    let _ = app.emit("claude-setup-state", &view);
    Ok(view)
}

#[tauri::command]
pub async fn claude_authenticate(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    settings: ClaudeSettings,
    workspace: String,
) -> Result<ClaudeSetupView, String> {
    let checked_at = now();
    let workspace = verification_workspace(workspace);
    let detection = claude::probe_versions(claude::detect(&settings, checked_at.clone()));
    let authentication =
        probe_auth(&detection).unwrap_or(crate::acp::probe::AuthenticationState::NotApplicable);
    if installation_state(&detection) != crate::acp::verification::InstallationState::Available {
        let cached = snapshot(&detection, authentication, None, None, checked_at);
        crate::acp::verification::store_snapshot(&state.db, &cached).await?;
        return Ok(ClaudeSetupState::from_snapshot(Some(&cached)).into());
    }

    let options =
        claude::launch_options(&detection, &workspace).map_err(|error| error.to_string())?;
    let conversation_id = "claude-authenticate";
    let (sink, mut receiver) = EventSink::new(EVENT_QUEUE_CAPACITY);
    tauri::async_runtime::spawn(async move { while receiver.recv().await.is_some() {} });
    let session = state
        .acp
        .start(conversation_id, "claude-code", options, sink)
        .await
        .map_err(|error| error.to_string())?;

    let Some(method) =
        crate::acp::capabilities::preferred_auth_method(&session.descriptor.auth_methods)
    else {
        state.acp.stop(conversation_id).await;
        return Ok(ClaudeSetupState::CliLoginRequired {
            adapter_path: detection.adapter_path.unwrap_or_default(),
        }
        .into());
    };

    let result = session.authenticate(&method.id).await;
    state.acp.stop(conversation_id).await;
    result.map_err(|error| error.to_string())?;

    let authentication =
        probe_auth(&detection).unwrap_or(crate::acp::probe::AuthenticationState::LoggedOut);
    let cached = snapshot(&detection, authentication, Some(true), None, checked_at);
    crate::acp::verification::store_snapshot(&state.db, &cached).await?;
    let view: ClaudeSetupView = ClaudeSetupState::from_snapshot(Some(&cached)).into();
    let _ = app.emit("claude-setup-state", &view);
    Ok(view)
}

#[tauri::command]
pub async fn claude_cancel_authenticate(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.acp.stop("claude-authenticate").await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verification_runs_once_until_explicitly_invalidated() {
        let cache = ClaudeCache::default();
        assert!(cache.begin_verification());
        assert!(!cache.begin_verification());
        cache.invalidate();
        assert!(cache.begin_verification());
    }
}
