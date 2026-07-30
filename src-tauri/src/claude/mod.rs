//! Claude adapter detection and launch options.
//!
//! npm shims need Node.js; prebuilt binaries do not. Detection is filesystem
//! only. Version probes and ACP initialize happen only after explicit verify.

pub mod setup;

use crate::acp::lifecycle::LaunchOptions;
use crate::acp::resolve::{self, ResolveRequest};
pub use crate::codex::AdapterSource;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;
use ts_rs::TS;

pub const ADAPTER_PROGRAM: &str = "claude-agent-acp";
pub const LEGACY_ADAPTER_PROGRAM: &str = "claude-code-acp";
pub const CLI_PROGRAM: &str = "claude";
/// Bump only for a published adapter release fixing a Poly-breaking defect.
pub const MIN_ADAPTER_VERSION: [u64; 3] = [0, 63, 0];
const VERSION_PROBE_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum ClaudeInstallKind {
    Npm,
    Standalone,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "kebab-case")]
#[ts(export)]
pub enum NodeRequirement {
    NotRequired,
    Ready {
        path: String,
        version: Option<String>,
    },
    Missing {
        reason: String,
    },
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ClaudeSettings {
    pub adapter_override: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ClaudeDetection {
    pub cli_path: Option<String>,
    pub cli_source: Option<AdapterSource>,
    pub cli_problem: Option<String>,
    pub cli_version: Option<String>,
    pub adapter_path: Option<String>,
    pub adapter_source: Option<AdapterSource>,
    pub adapter_problem: Option<String>,
    pub adapter_version: Option<String>,
    pub install_kind: Option<ClaudeInstallKind>,
    pub node: NodeRequirement,
    pub checked_at: String,
}

#[must_use]
pub fn detect(settings: &ClaudeSettings, now: String) -> ClaudeDetection {
    detect_with_requests(
        settings,
        now,
        ResolveRequest::new(ADAPTER_PROGRAM),
        ResolveRequest::new("node"),
        ResolveRequest::new(CLI_PROGRAM),
    )
}

fn detect_with_requests(
    settings: &ClaudeSettings,
    now: String,
    mut adapter_request: ResolveRequest,
    node_request: ResolveRequest,
    cli_request: ResolveRequest,
) -> ClaudeDetection {
    let cli = resolve::resolve(&cli_request);
    let (cli_path, cli_source, cli_problem) = match cli {
        Ok(found) => (
            Some(found.path.display().to_string()),
            Some(found.source.into()),
            None,
        ),
        Err(error) => (None, None, Some(error.to_string())),
    };
    adapter_request.override_path = settings.adapter_override.as_ref().map(PathBuf::from);
    let resolved = resolve::resolve(&adapter_request).or_else(|primary_error| {
        if settings.adapter_override.is_some() {
            return Err(primary_error);
        }
        let mut legacy = adapter_request.clone();
        legacy.program = LEGACY_ADAPTER_PROGRAM.into();
        resolve::resolve(&legacy)
    });
    let Ok(adapter) = resolved else {
        return ClaudeDetection {
            cli_path,
            cli_source,
            cli_problem,
            cli_version: None,
            adapter_path: None,
            adapter_source: None,
            adapter_problem: Some(resolved.unwrap_err().to_string()),
            adapter_version: None,
            install_kind: None,
            node: NodeRequirement::NotRequired,
            checked_at: now,
        };
    };

    let install_kind = classify_path(&adapter.path);
    let node = match install_kind {
        ClaudeInstallKind::Standalone => NodeRequirement::NotRequired,
        ClaudeInstallKind::Npm => match resolve::resolve(&node_request) {
            Ok(node) => NodeRequirement::Ready {
                path: node.path.display().to_string(),
                version: None,
            },
            Err(error) => NodeRequirement::Missing {
                reason: error.to_string(),
            },
        },
    };

    ClaudeDetection {
        cli_path,
        cli_source,
        cli_problem,
        cli_version: None,
        adapter_path: Some(adapter.path.display().to_string()),
        adapter_source: Some(adapter.source.into()),
        adapter_problem: None,
        adapter_version: None,
        install_kind: Some(install_kind),
        node,
        checked_at: now,
    }
}

fn classify_path(path: &Path) -> ClaudeInstallKind {
    let mut prefix = Vec::new();
    if let Ok(file) = std::fs::File::open(path) {
        let _ = file.take(512).read_to_end(&mut prefix);
    }
    classify_install_shape(path, &prefix)
}

fn classify_install_shape(path: &Path, prefix: &[u8]) -> ClaudeInstallKind {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(extension.as_str(), "cmd" | "ps1" | "js" | "mjs" | "cjs")
        || path.to_string_lossy().contains("node_modules")
    {
        return ClaudeInstallKind::Npm;
    }

    let first_line = String::from_utf8_lossy(prefix)
        .lines()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    if first_line.starts_with("#!") && first_line.contains("node") {
        ClaudeInstallKind::Npm
    } else {
        ClaudeInstallKind::Standalone
    }
}

#[must_use]
pub fn probe_versions(mut detection: ClaudeDetection) -> ClaudeDetection {
    detection.adapter_version = detection.adapter_path.as_deref().and_then(|path| {
        resolve::probe_version(Path::new(path), &["--version"], VERSION_PROBE_TIMEOUT)
    });
    if let NodeRequirement::Ready { path, version } = &mut detection.node {
        *version = resolve::probe_version(Path::new(path), &["--version"], VERSION_PROBE_TIMEOUT);
    }
    detection.cli_version = detection.cli_path.as_deref().and_then(|path| {
        resolve::probe_version(Path::new(path), &["--version"], VERSION_PROBE_TIMEOUT)
    });
    detection
}

#[must_use]
pub fn adapter_version_is_supported(version: Option<&str>) -> bool {
    version
        .and_then(resolve::parse_strict_version)
        .is_some_and(|parsed| parsed >= MIN_ADAPTER_VERSION)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchError {
    AdapterMissing { reason: String },
    NodeMissing { reason: String },
    WorkspaceRequired,
    WorkspaceMissing { path: String },
}

impl std::fmt::Display for LaunchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LaunchError::AdapterMissing { reason } => {
                write!(f, "the Claude adapter is not installed: {reason}")
            }
            LaunchError::NodeMissing { reason } => {
                write!(f, "the npm Claude adapter requires Node.js: {reason}")
            }
            LaunchError::WorkspaceRequired => {
                f.write_str("Claude Code needs a workspace folder before it can start")
            }
            LaunchError::WorkspaceMissing { path } => {
                write!(f, "the workspace folder no longer exists: {path}")
            }
        }
    }
}

pub fn launch_options(
    detection: &ClaudeDetection,
    workspace: &str,
) -> Result<LaunchOptions, LaunchError> {
    let adapter_path =
        detection
            .adapter_path
            .as_ref()
            .ok_or_else(|| LaunchError::AdapterMissing {
                reason: detection
                    .adapter_problem
                    .clone()
                    .unwrap_or_else(|| "not found".into()),
            })?;
    if let NodeRequirement::Missing { reason } = &detection.node {
        return Err(LaunchError::NodeMissing {
            reason: reason.clone(),
        });
    }

    let workspace = workspace.trim();
    if workspace.is_empty() {
        return Err(LaunchError::WorkspaceRequired);
    }
    let working_directory = PathBuf::from(workspace);
    if !working_directory.is_dir() {
        return Err(LaunchError::WorkspaceMissing {
            path: workspace.into(),
        });
    }

    Ok(LaunchOptions {
        executable: PathBuf::from(adapter_path),
        args: Vec::new(),
        working_directory,
        env: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::resolve::ResolveRequest;
    use std::path::{Path, PathBuf};

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let root =
                std::env::temp_dir().join(format!("poly-claude-{label}-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            Self { root }
        }

        fn executable(&self, name: &str, contents: &str) -> PathBuf {
            let path = self.root.join(name);
            std::fs::write(&path, contents).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut permissions = std::fs::metadata(&path).unwrap().permissions();
                permissions.set_mode(0o755);
                std::fs::set_permissions(&path, permissions).unwrap();
            }
            path
        }

        fn request(&self, program: &str) -> ResolveRequest {
            ResolveRequest::new(program)
                .with_path_entries(vec![self.root.clone()])
                .with_known_locations(Vec::new())
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn detect_fixture(
        settings: &ClaudeSettings,
        adapter_request: ResolveRequest,
        node_request: ResolveRequest,
    ) -> ClaudeDetection {
        detect_with_requests(
            settings,
            "2026-07-27T00:00:00Z".into(),
            adapter_request,
            node_request,
            ResolveRequest::new(CLI_PROGRAM)
                .with_path_entries(Vec::new())
                .with_known_locations(Vec::new()),
        )
    }

    #[test]
    fn detects_npm_install_and_requires_node() {
        let fixture = Fixture::new("npm");
        let adapter = fixture.executable("claude-agent-acp", "#!/usr/bin/env node\n");
        let node = fixture.executable("node", "#!/bin/sh\n");

        let found = detect_fixture(
            &ClaudeSettings::default(),
            fixture.request("claude-agent-acp"),
            fixture.request("node"),
        );

        assert_eq!(found.adapter_path.as_deref(), adapter.to_str());
        assert_eq!(found.install_kind, Some(ClaudeInstallKind::Npm));
        assert_eq!(
            found.node,
            NodeRequirement::Ready {
                path: node.display().to_string(),
                version: None,
            }
        );
    }

    #[test]
    fn detects_standalone_binary_without_checking_node() {
        let fixture = Fixture::new("standalone");
        fixture.executable("claude-agent-acp", "#!/bin/sh\n");

        let found = detect_fixture(
            &ClaudeSettings::default(),
            fixture.request("claude-agent-acp"),
            ResolveRequest::new("node")
                .with_path_entries(Vec::new())
                .with_known_locations(Vec::new()),
        );

        assert_eq!(found.install_kind, Some(ClaudeInstallKind::Standalone));
        assert_eq!(found.node, NodeRequirement::NotRequired);
        assert!(launch_options(&found, fixture.root.to_str().unwrap()).is_ok());
    }

    #[test]
    fn npm_install_reports_missing_node() {
        let fixture = Fixture::new("node-missing");
        fixture.executable("claude-agent-acp", "#!/usr/bin/env node\n");

        let found = detect_fixture(
            &ClaudeSettings::default(),
            fixture.request("claude-agent-acp"),
            ResolveRequest::new("node")
                .with_path_entries(Vec::new())
                .with_known_locations(Vec::new()),
        );

        assert_eq!(found.install_kind, Some(ClaudeInstallKind::Npm));
        assert!(matches!(found.node, NodeRequirement::Missing { .. }));
        assert!(matches!(
            launch_options(&found, fixture.root.to_str().unwrap()),
            Err(LaunchError::NodeMissing { .. })
        ));
    }

    #[test]
    fn standalone_never_reports_node_missing() {
        let fixture = Fixture::new("standalone-no-node");
        fixture.executable("claude-agent-acp", "#!/bin/sh\n");

        let found = detect_fixture(
            &ClaudeSettings::default(),
            fixture.request("claude-agent-acp"),
            ResolveRequest::new("node")
                .with_path_entries(Vec::new())
                .with_known_locations(Vec::new()),
        );

        assert!(!matches!(found.node, NodeRequirement::Missing { .. }));
    }

    #[test]
    fn user_override_wins_and_non_executable_override_is_reported() {
        let fixture = Fixture::new("override");
        let override_path = fixture.executable("custom-claude", "#!/bin/sh\n");
        fixture.executable("claude-agent-acp", "#!/usr/bin/env node\n");

        let found = detect_fixture(
            &ClaudeSettings {
                adapter_override: Some(override_path.display().to_string()),
            },
            fixture.request("claude-agent-acp"),
            fixture.request("node"),
        );
        assert_eq!(found.adapter_path.as_deref(), override_path.to_str());
        assert_eq!(found.adapter_source, Some(AdapterSource::UserOverride));

        let plain = fixture.root.join("plain");
        std::fs::write(&plain, "not executable").unwrap();
        let broken = detect_fixture(
            &ClaudeSettings {
                adapter_override: Some(plain.display().to_string()),
            },
            fixture.request("claude-agent-acp"),
            fixture.request("node"),
        );
        assert!(broken.adapter_path.is_none());
        assert!(broken
            .adapter_problem
            .as_deref()
            .unwrap()
            .contains("not a runnable executable"));
    }

    #[test]
    fn absent_adapter_is_not_installed() {
        let fixture = Fixture::new("absent");
        let found = detect_fixture(
            &ClaudeSettings::default(),
            fixture.request("claude-agent-acp"),
            fixture.request("node"),
        );
        assert!(found.adapter_path.is_none());
        assert_eq!(found.install_kind, None);
    }

    #[test]
    fn workspace_is_required_and_preserved_with_spaces() {
        let fixture = Fixture::new("workspace");
        let adapter = fixture.executable("claude-agent-acp", "#!/bin/sh\n");
        let workspace = fixture.root.join("workspace with spaces");
        std::fs::create_dir_all(&workspace).unwrap();
        let detection = ClaudeDetection {
            cli_path: Some("/bin/claude".into()),
            cli_source: Some(AdapterSource::PathLookup),
            cli_problem: None,
            cli_version: None,
            adapter_path: Some(adapter.display().to_string()),
            adapter_source: Some(AdapterSource::PathLookup),
            adapter_problem: None,
            adapter_version: None,
            install_kind: Some(ClaudeInstallKind::Standalone),
            node: NodeRequirement::NotRequired,
            checked_at: "2026-07-27T00:00:00Z".into(),
        };

        assert!(matches!(
            launch_options(&detection, ""),
            Err(LaunchError::WorkspaceRequired)
        ));
        let options = launch_options(&detection, workspace.to_str().unwrap()).unwrap();
        assert_eq!(options.executable, adapter);
        assert_eq!(options.working_directory, workspace);
        assert!(options.args.is_empty());
        assert!(options.env.is_empty());
    }

    #[test]
    fn npm_shape_recognizes_node_shebang_only() {
        assert_eq!(
            classify_install_shape(Path::new("/missing"), b"#!/usr/bin/env node\n"),
            ClaudeInstallKind::Npm
        );
        assert_eq!(
            classify_install_shape(Path::new("/missing"), b"#!/bin/sh\n"),
            ClaudeInstallKind::Standalone
        );
    }

    #[test]
    fn partial_and_prerelease_versions_fail_closed() {
        assert!(!adapter_version_is_supported(Some("1.2")));
        assert!(!adapter_version_is_supported(Some("1.2.0-rc1")));
        assert!(adapter_version_is_supported(Some("0.63.0")));
    }
}
