use crate::acp::resolve::{self, ResolveRequest};
use crate::runtime::AgentKind;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Manager;
use ts_rs::TS;

const INSTALL_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AdapterInstallPlan {
    pub package: String,
    pub command: String,
    pub adapter_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AdapterInstallResult {
    pub adapter_path: String,
}

struct ResolvedPlan {
    npm: PathBuf,
    prefix: PathBuf,
    adapter: PathBuf,
    public: AdapterInstallPlan,
}

fn package(agent: AgentKind) -> (&'static str, &'static str) {
    match agent {
        AgentKind::Codex => ("@agentclientprotocol/codex-acp", "codex-acp"),
        AgentKind::ClaudeCode => ("@agentclientprotocol/claude-agent-acp", "claude-agent-acp"),
    }
}

fn display_arg(value: &Path) -> String {
    format!("\"{}\"", value.display().to_string().replace('"', "\\\""))
}

fn build_plan(root: &Path, npm: PathBuf, agent: AgentKind) -> ResolvedPlan {
    let (package, program) = package(agent);
    let prefix = root.join(agent.as_str());
    #[cfg(windows)]
    let adapter = prefix
        .join("node_modules")
        .join(".bin")
        .join(format!("{program}.cmd"));
    #[cfg(not(windows))]
    let adapter = prefix.join("node_modules").join(".bin").join(program);
    let command = format!(
        "{} install --prefix {} --omit=dev {}",
        display_arg(&npm),
        display_arg(&prefix),
        package
    );
    ResolvedPlan {
        npm,
        prefix,
        adapter: adapter.clone(),
        public: AdapterInstallPlan {
            package: package.into(),
            command,
            adapter_path: adapter.display().to_string(),
        },
    }
}

fn resolve_plan(app: &tauri::AppHandle, agent: AgentKind) -> Result<ResolvedPlan, String> {
    let npm = resolve::resolve(&ResolveRequest::new("npm")).map_err(|_| {
        "Node.js and npm were not found. Install Node.js, or choose an existing adapter executable."
            .to_string()
    })?;
    resolve::resolve(&ResolveRequest::new("node")).map_err(|_| {
        "npm was found, but Node.js was not. Repair the Node.js installation, then try again."
            .to_string()
    })?;
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("Could not locate Poly UI's app-data folder: {error}"))?
        .join("acp-adapters");
    Ok(build_plan(&root, npm.path, agent))
}

#[tauri::command]
pub fn adapter_install_plan(
    app: tauri::AppHandle,
    agent: AgentKind,
) -> Result<AdapterInstallPlan, String> {
    Ok(resolve_plan(&app, agent)?.public)
}

#[tauri::command]
pub async fn install_adapter(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
    agent: AgentKind,
) -> Result<AdapterInstallResult, String> {
    let plan = resolve_plan(&app, agent)?;
    tokio::fs::create_dir_all(&plan.prefix)
        .await
        .map_err(|error| format!("Could not create the adapter folder: {error}"))?;

    let mut installed = false;
    for attempt in 1..=3 {
        let output = tokio::time::timeout(
            INSTALL_TIMEOUT,
            tokio::process::Command::new(&plan.npm)
                .arg("install")
                .arg("--prefix")
                .arg(&plan.prefix)
                .arg("--omit=dev")
                .arg(&plan.public.package)
                .kill_on_drop(true)
                .output(),
        )
        .await
        .map_err(|_| "Adapter installation timed out after 5 minutes.".to_string())?
        .map_err(|error| format!("Could not start npm: {error}"))?;

        if output.status.success() {
            installed = true;
            break;
        }
        if attempt == 3 {
            return Err(npm_install_error(&String::from_utf8_lossy(&output.stderr)).to_string());
        }
        tokio::time::sleep(Duration::from_millis(250 * attempt)).await;
    }
    debug_assert!(installed);
    if !resolve::is_executable_file(&plan.adapter) {
        return Err(format!(
            "npm finished, but the adapter executable was not created at {}.",
            plan.adapter.display()
        ));
    }

    resolve::invalidate_resolution_cache();
    let agent_kind = agent.as_str();
    crate::acp::verification::invalidate(&state.db, agent_kind).await?;
    match agent {
        AgentKind::Codex => state.codex.invalidate(),
        AgentKind::ClaudeCode => state.claude.invalidate(),
    }

    Ok(AdapterInstallResult {
        adapter_path: plan.adapter.display().to_string(),
    })
}

fn npm_install_error(stderr: &str) -> &'static str {
    let lower = stderr.to_ascii_lowercase();
    if lower.contains("eacces") || lower.contains("permission denied") {
        "npm could not write the adapter folder. Check its permissions and try again."
    } else if lower.contains("enotfound")
        || lower.contains("eai_again")
        || lower.contains("network")
    {
        "npm could not reach the package registry. Check the network connection and try again."
    } else {
        // Never return npm's raw diagnostics: registry URLs can contain tokens.
        "npm could not install the adapter. Check npm's configuration and try again."
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plans_a_private_install_with_structured_known_output() {
        let plan = build_plan(
            Path::new("/tmp/Poly UI"),
            PathBuf::from("/usr/bin/npm"),
            AgentKind::Codex,
        );
        assert_eq!(plan.public.package, "@agentclientprotocol/codex-acp");
        assert!(plan.public.command.contains("\"/tmp/Poly UI/codex\""));
        assert!(plan
            .public
            .adapter_path
            .ends_with("node_modules/.bin/codex-acp"));
    }

    #[test]
    fn install_errors_are_actionable_without_echoing_diagnostics() {
        let secret = "https://token:secret@example.test";
        assert!(npm_install_error(&format!("network {secret}")).contains("network"));
        assert!(!npm_install_error(&format!("network {secret}")).contains(secret));
        assert!(npm_install_error("EACCES").contains("permissions"));
    }
}
