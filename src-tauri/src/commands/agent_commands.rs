use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliStatus {
    installed: bool,
    authenticated: bool,
    executable: Option<String>,
    version: Option<String>,
}

fn executable(name: &str) -> Option<PathBuf> {
    let file = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.into()
    };
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
        .chain(dirs::home_dir().into_iter().flat_map(|home| {
            [
                home.join(".local/bin"),
                home.join(".bun/bin"),
                home.join(".npm-global/bin"),
                home.join(".claude/local"),
            ]
        }))
        .map(|dir| dir.join(&file))
        .find(|path| path.is_file())
}

async fn output(path: &Path, args: &[&str]) -> Option<std::process::Output> {
    tokio::time::timeout(
        Duration::from_secs(10),
        tokio::process::Command::new(path).args(args).output(),
    )
    .await
    .ok()?
    .ok()
}

#[tauri::command]
pub async fn agent_cli_status(kind: String) -> Result<AgentCliStatus, String> {
    let (name, auth_args) = match kind.as_str() {
        "codex" => ("codex", &["login", "status"][..]),
        "claude-code" => ("claude", &["auth", "status"][..]),
        _ => return Err("Unknown coding agent".into()),
    };
    let Some(path) = executable(name) else {
        return Ok(AgentCliStatus {
            installed: false,
            authenticated: false,
            executable: None,
            version: None,
        });
    };
    let version = output(&path, &["--version"])
        .await
        .filter(|value| value.status.success())
        .map(|value| String::from_utf8_lossy(&value.stdout).trim().to_string())
        .filter(|value| !value.is_empty());
    let authenticated = output(&path, auth_args)
        .await
        .is_some_and(|value| value.status.success());
    Ok(AgentCliStatus {
        installed: true,
        authenticated,
        executable: Some(path.display().to_string()),
        version,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_unknown_agent() {
        assert!(agent_cli_status("other".into()).await.is_err());
    }
}
