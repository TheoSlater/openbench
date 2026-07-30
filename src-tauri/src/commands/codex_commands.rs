//! Tauri surface for Codex setup.
//!
//! The split that matters for performance:
//!
//! - [`codex_status`] only reads the durable snapshot. It never spawns.
//! - [`codex_verify`] spawns a process and completes a real ACP handshake. It
//!   is only reachable from an explicit user action in settings.
//! - [`codex_refresh_detection`] is the background refresh, also spawn-free.

use crate::acp::error::AcpError;
use crate::acp::registry::{EventSink, EVENT_QUEUE_CAPACITY};
use crate::codex::setup::{CodexSetupState, CodexSetupView};
use crate::codex::{self, CodexDetection, CodexSettings};
use crate::AppState;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

/// The settings value already fully verified during this app session.
#[derive(Debug, Default)]
pub struct CodexCache {
    verification_attempted: AtomicBool,
}

impl CodexCache {
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

fn source_name(source: crate::codex::AdapterSource) -> String {
    match source {
        crate::codex::AdapterSource::UserOverride => "user-override",
        crate::codex::AdapterSource::PathLookup => "path-lookup",
        crate::codex::AdapterSource::KnownLocation => "known-location",
    }
    .into()
}

fn installation_state(detection: &CodexDetection) -> crate::acp::verification::InstallationState {
    use crate::acp::verification::InstallationState;
    match (
        detection.cli_path.is_some(),
        detection.adapter_path.is_some(),
    ) {
        (false, false) => InstallationState::NotInstalled,
        (false, true) => InstallationState::CliMissing,
        (true, false) => InstallationState::AdapterMissing,
        (true, true)
            if !codex::adapter_version_is_supported(detection.adapter_version.as_deref()) =>
        {
            InstallationState::AdapterOutdated
        }
        (true, true) => InstallationState::Available,
    }
}

fn snapshot(
    detection: &CodexDetection,
    authentication: crate::acp::probe::AuthenticationState,
    availability: Option<bool>,
    availability_error: Option<String>,
    checked_at: String,
) -> crate::acp::verification::AgentVerification {
    crate::acp::verification::AgentVerification {
        agent_kind: "codex".into(),
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
    detection: &CodexDetection,
) -> Result<crate::acp::probe::AuthenticationState, String> {
    let Some(cli) = detection.cli_path.as_deref() else {
        return Ok(crate::acp::probe::AuthenticationState::NotApplicable);
    };
    crate::acp::probe::run_auth_probe(
        std::path::Path::new(cli),
        &["login", "status"],
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

/// Detection, from cache when available.
/// The current setup state. Never spawns a process.
///
/// A previously-verified agent paints `READY` from the durable record on the
/// first render after an app restart.
#[tauri::command]
pub async fn codex_status(
    state: tauri::State<'_, AppState>,
    settings: CodexSettings,
) -> Result<CodexSetupView, String> {
    let _ = settings;
    let snapshot = crate::acp::verification::load_snapshot(&state.db, "codex").await?;
    Ok(CodexSetupState::from_snapshot(snapshot.as_ref()).into())
}

/// Re-check only vendor CLI authentication. Never starts the ACP adapter.
#[tauri::command]
pub async fn codex_revalidate(state: tauri::State<'_, AppState>) -> Result<CodexSetupView, String> {
    let Some(mut snapshot) = crate::acp::verification::load_snapshot(&state.db, "codex").await?
    else {
        return Ok(CodexSetupState::Unknown.into());
    };
    let Some(cli_path) = snapshot.cli_path.as_deref() else {
        return Ok(CodexSetupState::from_snapshot(Some(&snapshot)).into());
    };
    let Ok(authentication) = crate::acp::probe::run_auth_probe(
        std::path::Path::new(cli_path),
        &["login", "status"],
        Some(crate::acp::resolve::augmented_path().as_os_str()),
        std::time::Duration::from_secs(10),
    ) else {
        return Ok(CodexSetupState::from_snapshot(Some(&snapshot)).into());
    };
    snapshot.authentication = authentication;
    snapshot.auth_checked_at = Some(now());
    crate::acp::verification::store_snapshot(&state.db, &snapshot).await?;
    Ok(CodexSetupState::from_snapshot(Some(&snapshot)).into())
}

/// Re-scan the filesystem. Background refresh; still spawn-free.
#[tauri::command]
pub async fn codex_refresh_detection(settings: CodexSettings) -> Result<CodexDetection, String> {
    let detection = codex::detect(&settings, now());
    Ok(detection)
}

/// Start the adapter, complete a real ACP handshake, and report what it said.
///
/// The only readiness signal. A process that merely starts and exits zero
/// proves nothing, so nothing here consults an exit code.
#[tauri::command]
pub async fn codex_verify(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    settings: CodexSettings,
    workspace: String,
) -> Result<CodexSetupView, String> {
    let workspace = verification_workspace(workspace);
    if !state.codex.begin_verification() {
        let snapshot = crate::acp::verification::load_snapshot(&state.db, "codex").await?;
        return Ok(CodexSetupState::from_snapshot(snapshot.as_ref()).into());
    }
    // A fresh scan: the user asked, and a stale path is the likeliest reason
    // verification is being run at all.
    let checked_at = now();
    let mut detection = codex::detect(&settings, checked_at.clone());
    if let Some(path) = detection.adapter_path.clone() {
        detection.adapter_version = codex::probe_adapter_version(&path);
    }
    if let Some(path) = detection.cli_path.clone() {
        detection.cli_version = crate::acp::resolve::probe_version(
            std::path::Path::new(&path),
            &["--version"],
            std::time::Duration::from_secs(10),
        );
    }

    let previous = crate::acp::verification::load_snapshot(&state.db, "codex").await?;
    let authentication = probe_auth(&detection).unwrap_or_else(|_| {
        previous
            .map(|snapshot| snapshot.authentication)
            .unwrap_or(crate::acp::probe::AuthenticationState::NotApplicable)
    });
    if installation_state(&detection) != crate::acp::verification::InstallationState::Available {
        let cached = snapshot(&detection, authentication, None, None, checked_at);
        crate::acp::verification::store_snapshot(&state.db, &cached).await?;
        return Ok(CodexSetupState::from_snapshot(Some(&cached)).into());
    }

    let options = match codex::launch_options(&detection, &settings, &workspace) {
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
            return Ok(CodexSetupState::from_snapshot(Some(&cached)).into());
        }
    };

    // Verification uses its own conversation id so it can never collide with a
    // live session in the checkpoint 3 registry.
    let conversation_id = format!("codex-verify-{}", uuid::Uuid::new_v4());
    let (sink, mut receiver) = EventSink::new(EVENT_QUEUE_CAPACITY);

    // Drain the verification session's events so the bounded queue cannot fill
    // and block the handshake.
    tauri::async_runtime::spawn(async move { while receiver.recv().await.is_some() {} });

    let result = state
        .acp
        .start(&conversation_id, "codex", options, sink)
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
            let setup = CodexSetupState::from_snapshot(Some(&cached));
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
            CodexSetupState::from_snapshot(Some(&cached))
        }
    };

    let view: CodexSetupView = outcome.into();
    let _ = app.emit("codex-setup-state", &view);
    Ok(view)
}

#[tauri::command]
pub async fn codex_authenticate(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    settings: CodexSettings,
    workspace: String,
) -> Result<CodexSetupView, String> {
    let checked_at = now();
    let workspace = verification_workspace(workspace);
    let mut detection = codex::detect(&settings, checked_at.clone());
    if let Some(path) = detection.adapter_path.clone() {
        detection.adapter_version = codex::probe_adapter_version(&path);
    }
    if let Some(path) = detection.cli_path.clone() {
        detection.cli_version = crate::acp::resolve::probe_version(
            std::path::Path::new(&path),
            &["--version"],
            std::time::Duration::from_secs(10),
        );
    }
    let authentication =
        probe_auth(&detection).unwrap_or(crate::acp::probe::AuthenticationState::NotApplicable);
    if installation_state(&detection) != crate::acp::verification::InstallationState::Available {
        let cached = snapshot(&detection, authentication, None, None, checked_at);
        crate::acp::verification::store_snapshot(&state.db, &cached).await?;
        return Ok(CodexSetupState::from_snapshot(Some(&cached)).into());
    }

    let options = codex::launch_options(&detection, &settings, &workspace)
        .map_err(|error| error.to_string())?;
    let conversation_id = "codex-authenticate";
    let (sink, mut receiver) = EventSink::new(EVENT_QUEUE_CAPACITY);
    tauri::async_runtime::spawn(async move { while receiver.recv().await.is_some() {} });
    let session = state
        .acp
        .start(conversation_id, "codex", options, sink)
        .await
        .map_err(|error| error.to_string())?;

    let Some(method) =
        crate::acp::capabilities::preferred_auth_method(&session.descriptor.auth_methods)
    else {
        state.acp.stop(conversation_id).await;
        return Ok(CodexSetupState::CliLoginRequired {
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
    let view: CodexSetupView = CodexSetupState::from_snapshot(Some(&cached)).into();
    let _ = app.emit("codex-setup-state", &view);
    Ok(view)
}

#[tauri::command]
pub async fn codex_cancel_authenticate(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.acp.stop("codex-authenticate").await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_explicit_workspace_is_never_overridden() {
        assert_eq!(
            verification_workspace("/some/project".into()),
            "/some/project"
        );
    }

    #[test]
    fn an_empty_workspace_falls_back_to_home() {
        let resolved = verification_workspace(String::new());
        assert!(!resolved.is_empty());
        assert_eq!(resolved, dirs::home_dir().unwrap().display().to_string());
    }

    #[test]
    fn verification_runs_once_until_explicitly_invalidated() {
        let cache = CodexCache::default();
        assert!(cache.begin_verification());
        assert!(!cache.begin_verification());
        cache.invalidate();
        assert!(cache.begin_verification());
    }
}
