//! Codex-specific detection, authentication, and launch options.
//!
//! This module adds no protocol path. Sessions, streaming, permissions,
//! cancellation, and cleanup all go through [`crate::acp`]; what lives here is
//! only the vendor-shaped part: where the adapter is, what version it reports,
//! how it is launched, and which of *its own* advertised auth methods the user
//! picked.
//!
//! Two deliberate non-goals, both from the adapter's README:
//!
//! - **No version compatibility matrix.** The npm package bundles a compatible
//!   `@openai/codex`, so CLI-versus-adapter skew is the adapter's problem, not
//!   ours. A version string is informational; readiness is a successful ACP
//!   initialize and nothing else.
//! - **No terminal scraping.** The adapter is a stdio ACP server that drives the
//!   Codex App Server. Its stdout is protocol; its stderr is diagnostics.

pub mod setup;

use crate::acp::lifecycle::LaunchOptions;
use crate::acp::resolve::{self, ResolveError, ResolveRequest, ResolvedFrom};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use ts_rs::TS;

/// The adapter's npm bin name.
pub const ADAPTER_PROGRAM: &str = "codex-acp";
pub const CLI_PROGRAM: &str = "codex";
/// Bump only for a published adapter release fixing a Poly-breaking defect.
pub const MIN_ADAPTER_VERSION: [u64; 3] = [1, 1, 7];

/// Points the adapter at a different Codex binary. An advanced override, not
/// the normal path — the package ships its own compatible Codex.
pub const CODEX_PATH_ENV: &str = "CODEX_PATH";

/// Hides the browser-dependent ChatGPT method during initialize.
pub const NO_BROWSER_ENV: &str = "NO_BROWSER";

/// How long a `--version` probe may take before it is abandoned.
const VERSION_PROBE_TIMEOUT: Duration = Duration::from_secs(10);

/// Where the adapter executable was found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum AdapterSource {
    UserOverride,
    PathLookup,
    KnownLocation,
}

impl From<ResolvedFrom> for AdapterSource {
    fn from(source: ResolvedFrom) -> Self {
        match source {
            ResolvedFrom::UserOverride => AdapterSource::UserOverride,
            ResolvedFrom::PathLookup => AdapterSource::PathLookup,
            ResolvedFrom::KnownLocation => AdapterSource::KnownLocation,
        }
    }
}

/// Whether a user-configured `CODEX_PATH` actually resolves.
///
/// Tracked separately from the adapter itself: an override that points at
/// nothing is a setting that silently does nothing, which is worse than an
/// error.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "kebab-case")]
#[ts(export)]
pub enum CodexPathOverride {
    /// No override configured. The bundled Codex is used.
    Unset,
    /// Configured and runnable.
    Resolved { path: String },
    /// Configured but not usable, with the reason.
    Broken { path: String, reason: String },
}

/// What a filesystem-only detection pass found.
///
/// Cached and used to render the settings page. Building one never spawns a
/// process — see [`detect`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodexDetection {
    pub cli_path: Option<String>,
    pub cli_source: Option<AdapterSource>,
    pub cli_problem: Option<String>,
    pub cli_version: Option<String>,
    /// Absolute path to the adapter, or `None` if it was not found.
    pub adapter_path: Option<String>,
    pub adapter_source: Option<AdapterSource>,
    /// Why resolution failed, when it did. Names the offending path if the
    /// user configured one.
    pub adapter_problem: Option<String>,
    /// Informational only. Never gates readiness.
    pub adapter_version: Option<String>,
    pub codex_path: CodexPathOverride,
    /// When this was last refreshed, so the UI can show staleness.
    pub checked_at: String,
}

/// User-configurable inputs to detection.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodexSettings {
    /// A saved override for the *adapter* executable.
    pub adapter_override: Option<String>,
    /// A saved value for `CODEX_PATH` — a different Codex binary.
    pub codex_path: Option<String>,
    /// Hide the browser-based ChatGPT method. For remote and headless machines
    /// where a browser cannot open.
    #[serde(default)]
    pub no_browser: bool,
}

/// Locate the adapter and check the override, without running anything.
///
/// Pure `stat` calls, so this is safe on a background refresh and safe to call
/// while rendering — though rendering should read the cache instead.
#[must_use]
pub fn detect(settings: &CodexSettings, now: String) -> CodexDetection {
    let cli = resolve::resolve(
        &ResolveRequest::new(CLI_PROGRAM)
            .with_override(settings.codex_path.as_ref().map(PathBuf::from)),
    );
    let (cli_path, cli_source, cli_problem) = match cli {
        Ok(found) => (
            Some(found.path.display().to_string()),
            Some(AdapterSource::from(found.source)),
            None,
        ),
        Err(error) => (None, None, Some(error.to_string())),
    };
    let resolved = resolve::resolve(
        &ResolveRequest::new(ADAPTER_PROGRAM)
            .with_override(settings.adapter_override.as_ref().map(PathBuf::from)),
    );

    let (adapter_path, adapter_source, adapter_problem) = match resolved {
        Ok(found) => (
            Some(found.path.display().to_string()),
            Some(AdapterSource::from(found.source)),
            None,
        ),
        Err(error) => (None, None, Some(error.to_string())),
    };

    CodexDetection {
        cli_path,
        cli_source,
        cli_problem,
        cli_version: None,
        adapter_path,
        adapter_source,
        adapter_problem,
        // Filled in only by an explicit verification pass.
        adapter_version: None,
        codex_path: check_codex_path(settings.codex_path.as_deref()),
        checked_at: now,
    }
}

/// Validate a configured `CODEX_PATH`.
#[must_use]
pub fn check_codex_path(configured: Option<&str>) -> CodexPathOverride {
    let Some(raw) = configured.map(str::trim).filter(|value| !value.is_empty()) else {
        return CodexPathOverride::Unset;
    };
    let path = PathBuf::from(raw);

    if !path.exists() {
        return CodexPathOverride::Broken {
            path: raw.to_string(),
            reason: ResolveError::OverrideMissing { path }.to_string(),
        };
    }
    if !resolve::is_executable_file(&path) {
        return CodexPathOverride::Broken {
            path: raw.to_string(),
            reason: ResolveError::OverrideNotExecutable { path }.to_string(),
        };
    }
    CodexPathOverride::Resolved {
        path: raw.to_string(),
    }
}

/// Read the adapter's version string.
///
/// Spawns a process, so it is only reached from an explicit verification
/// action. A failure is `None`: the version is informational and never decides
/// readiness.
#[must_use]
pub fn probe_adapter_version(adapter_path: &str) -> Option<String> {
    resolve::probe_version(
        std::path::Path::new(adapter_path),
        &["--version"],
        VERSION_PROBE_TIMEOUT,
    )
}

#[must_use]
pub fn adapter_version_is_supported(version: Option<&str>) -> bool {
    version
        .and_then(resolve::parse_strict_version)
        .is_some_and(|parsed| parsed >= MIN_ADAPTER_VERSION)
}

/// Building launch options failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchError {
    /// The adapter was not found.
    AdapterMissing { reason: String },
    /// A configured `CODEX_PATH` does not work. Refused rather than dropped,
    /// so the user is not left with a setting that quietly does nothing.
    BrokenCodexPath { path: String, reason: String },
    /// Codex conversations require a real workspace.
    WorkspaceRequired,
    /// The chosen workspace does not exist.
    WorkspaceMissing { path: String },
}

impl std::fmt::Display for LaunchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LaunchError::AdapterMissing { reason } => {
                write!(f, "the Codex adapter is not installed: {reason}")
            }
            LaunchError::BrokenCodexPath { path, reason } => {
                write!(
                    f,
                    "CODEX_PATH is set to {path}, which cannot be used: {reason}"
                )
            }
            LaunchError::WorkspaceRequired => {
                f.write_str("Codex needs a workspace folder before it can start")
            }
            LaunchError::WorkspaceMissing { path } => {
                write!(f, "the workspace folder no longer exists: {path}")
            }
        }
    }
}

/// Build the launch options for a Codex session.
///
/// The workspace is mandatory and must exist. There is deliberately no default:
/// falling back to the process's own directory would point Codex at Poly UI's
/// installation.
pub fn launch_options(
    detection: &CodexDetection,
    settings: &CodexSettings,
    workspace: &str,
) -> Result<LaunchOptions, LaunchError> {
    let Some(adapter_path) = detection.adapter_path.as_ref() else {
        return Err(LaunchError::AdapterMissing {
            reason: detection
                .adapter_problem
                .clone()
                .unwrap_or_else(|| "not found".to_string()),
        });
    };

    let workspace = workspace.trim();
    if workspace.is_empty() {
        return Err(LaunchError::WorkspaceRequired);
    }
    let working_directory = PathBuf::from(workspace);
    if !working_directory.is_dir() {
        return Err(LaunchError::WorkspaceMissing {
            path: workspace.to_string(),
        });
    }

    let mut env: Vec<(String, String)> = Vec::new();

    match &detection.codex_path {
        CodexPathOverride::Resolved { path } => {
            env.push((CODEX_PATH_ENV.to_string(), path.clone()));
        }
        CodexPathOverride::Broken { path, reason } => {
            return Err(LaunchError::BrokenCodexPath {
                path: path.clone(),
                reason: reason.clone(),
            });
        }
        CodexPathOverride::Unset => {}
    }

    if settings.no_browser {
        // The adapter reads presence, not a value. Setting it hides the
        // ChatGPT method from the advertised list at initialize time.
        env.push((NO_BROWSER_ENV.to_string(), "1".to_string()));
    }

    Ok(LaunchOptions {
        executable: PathBuf::from(adapter_path),
        // No arguments: the adapter is a stdio ACP server and speaks the
        // protocol on stdin/stdout as soon as it starts.
        args: Vec::new(),
        working_directory,
        env,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn now() -> String {
        "2026-07-27T00:00:00Z".to_string()
    }

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let root =
                std::env::temp_dir().join(format!("poly-codex-{label}-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            Fixture { root }
        }

        fn dir(&self, name: &str) -> PathBuf {
            let path = self.root.join(name);
            std::fs::create_dir_all(&path).unwrap();
            path
        }

        fn executable(&self, dir: &std::path::Path, name: &str) -> PathBuf {
            let path = dir.join(name);
            std::fs::write(&path, "#!/bin/sh\necho 1.1.7\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mut permissions = std::fs::metadata(&path).unwrap().permissions();
                permissions.set_mode(0o755);
                std::fs::set_permissions(&path, permissions).unwrap();
            }
            path
        }

        fn plain_file(&self, dir: &std::path::Path, name: &str) -> PathBuf {
            let path = dir.join(name);
            std::fs::write(&path, "not runnable").unwrap();
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn detection_with_adapter(path: &std::path::Path) -> CodexDetection {
        CodexDetection {
            cli_path: Some("/bin/codex".into()),
            cli_source: Some(AdapterSource::PathLookup),
            cli_problem: None,
            cli_version: None,
            adapter_path: Some(path.display().to_string()),
            adapter_source: Some(AdapterSource::UserOverride),
            adapter_problem: None,
            adapter_version: None,
            codex_path: CodexPathOverride::Unset,
            checked_at: now(),
        }
    }

    #[test]
    fn detects_an_adapter_supplied_as_an_override() {
        let fixture = Fixture::new("override");
        let bin = fixture.dir("bin");
        let adapter = fixture.executable(&bin, "codex-acp");

        let detection = detect(
            &CodexSettings {
                adapter_override: Some(adapter.display().to_string()),
                ..Default::default()
            },
            now(),
        );

        assert!(detection.adapter_path.is_some());
        assert_eq!(detection.adapter_path, Some(adapter.display().to_string()));
        assert_eq!(detection.adapter_source, Some(AdapterSource::UserOverride));
        assert_eq!(detection.adapter_problem, None);
        // Detection never spawns, so no version is read here.
        assert_eq!(detection.adapter_version, None);
    }

    #[test]
    fn reports_an_absent_adapter_without_guessing() {
        let fixture = Fixture::new("absent");
        let empty = fixture.dir("empty");

        let detection = detect(
            &CodexSettings {
                adapter_override: Some(empty.join("nothing-here").display().to_string()),
                ..Default::default()
            },
            now(),
        );

        assert!(detection.adapter_path.is_none());
        assert_eq!(detection.adapter_path, None);
        assert!(detection.adapter_problem.is_some());
    }

    #[test]
    fn an_adapter_override_pointing_at_a_non_executable_is_reported() {
        let fixture = Fixture::new("not-exec");
        let bin = fixture.dir("bin");
        let plain = fixture.plain_file(&bin, "codex-acp");

        let detection = detect(
            &CodexSettings {
                adapter_override: Some(plain.display().to_string()),
                ..Default::default()
            },
            now(),
        );

        assert!(detection.adapter_path.is_none());
        let problem = detection.adapter_problem.expect("a reason");
        assert!(problem.contains(&plain.display().to_string()), "{problem}");
    }

    #[test]
    fn an_unset_codex_path_is_the_normal_case() {
        assert_eq!(check_codex_path(None), CodexPathOverride::Unset);
        assert_eq!(check_codex_path(Some("   ")), CodexPathOverride::Unset);
    }

    #[test]
    fn a_working_codex_path_resolves() {
        let fixture = Fixture::new("codex-path");
        let bin = fixture.dir("bin");
        let codex = fixture.executable(&bin, "codex");

        assert_eq!(
            check_codex_path(Some(&codex.display().to_string())),
            CodexPathOverride::Resolved {
                path: codex.display().to_string()
            }
        );
    }

    #[test]
    fn a_codex_path_that_does_not_resolve_is_reported_not_ignored() {
        let missing = check_codex_path(Some("/definitely/not/here/codex"));
        match missing {
            CodexPathOverride::Broken { path, reason } => {
                assert_eq!(path, "/definitely/not/here/codex");
                assert!(reason.contains("does not exist"), "{reason}");
            }
            other => panic!("expected broken, got {other:?}"),
        }

        let fixture = Fixture::new("codex-path-bad");
        let bin = fixture.dir("bin");
        let plain = fixture.plain_file(&bin, "codex");
        let broken = check_codex_path(Some(&plain.display().to_string()));
        #[cfg(unix)]
        assert!(matches!(broken, CodexPathOverride::Broken { .. }));
        #[cfg(not(unix))]
        let _ = broken;
    }

    #[test]
    fn launch_options_carry_the_workspace_and_no_arguments() {
        let fixture = Fixture::new("launch");
        let bin = fixture.dir("bin");
        let adapter = fixture.executable(&bin, "codex-acp");
        let workspace = fixture.dir("My Project");

        let options = launch_options(
            &detection_with_adapter(&adapter),
            &CodexSettings::default(),
            &workspace.display().to_string(),
        )
        .expect("options");

        assert_eq!(options.executable, adapter);
        assert!(options.args.is_empty(), "the adapter takes no arguments");
        assert_eq!(options.working_directory, workspace);
        assert!(options.env.is_empty());
        // A path with a space survives as one structured value.
        assert!(options
            .working_directory
            .display()
            .to_string()
            .contains("My Project"));
    }

    #[test]
    fn no_browser_is_passed_through_when_requested() {
        let fixture = Fixture::new("no-browser");
        let bin = fixture.dir("bin");
        let adapter = fixture.executable(&bin, "codex-acp");
        let workspace = fixture.dir("workspace");

        let options = launch_options(
            &detection_with_adapter(&adapter),
            &CodexSettings {
                no_browser: true,
                ..Default::default()
            },
            &workspace.display().to_string(),
        )
        .expect("options");

        assert_eq!(
            options.env,
            vec![(NO_BROWSER_ENV.to_string(), "1".to_string())]
        );
    }

    #[test]
    fn a_resolved_codex_path_reaches_the_child_environment() {
        let fixture = Fixture::new("codex-path-env");
        let bin = fixture.dir("bin");
        let adapter = fixture.executable(&bin, "codex-acp");
        let codex = fixture.executable(&bin, "codex");
        let workspace = fixture.dir("workspace");

        let mut detection = detection_with_adapter(&adapter);
        detection.codex_path = CodexPathOverride::Resolved {
            path: codex.display().to_string(),
        };

        let options = launch_options(
            &detection,
            &CodexSettings {
                no_browser: true,
                ..Default::default()
            },
            &workspace.display().to_string(),
        )
        .expect("options");

        assert_eq!(
            options.env,
            vec![
                (CODEX_PATH_ENV.to_string(), codex.display().to_string()),
                (NO_BROWSER_ENV.to_string(), "1".to_string()),
            ]
        );
    }

    #[test]
    fn a_broken_codex_path_refuses_to_launch() {
        let fixture = Fixture::new("broken-codex-path");
        let bin = fixture.dir("bin");
        let adapter = fixture.executable(&bin, "codex-acp");
        let workspace = fixture.dir("workspace");

        let mut detection = detection_with_adapter(&adapter);
        detection.codex_path = CodexPathOverride::Broken {
            path: "/gone/codex".into(),
            reason: "the configured path does not exist: /gone/codex".into(),
        };

        // Launching while quietly ignoring the override would run the bundled
        // Codex and leave the user believing their setting applied.
        let error = launch_options(
            &detection,
            &CodexSettings::default(),
            &workspace.display().to_string(),
        )
        .unwrap_err();
        assert!(matches!(error, LaunchError::BrokenCodexPath { .. }));
    }

    #[test]
    fn a_workspace_is_mandatory_and_never_defaulted() {
        let fixture = Fixture::new("workspace");
        let bin = fixture.dir("bin");
        let adapter = fixture.executable(&bin, "codex-acp");
        let detection = detection_with_adapter(&adapter);

        assert_eq!(
            launch_options(&detection, &CodexSettings::default(), "").unwrap_err(),
            LaunchError::WorkspaceRequired
        );
        assert_eq!(
            launch_options(&detection, &CodexSettings::default(), "   ").unwrap_err(),
            LaunchError::WorkspaceRequired
        );
        assert_eq!(
            launch_options(&detection, &CodexSettings::default(), "/gone/workspace").unwrap_err(),
            LaunchError::WorkspaceMissing {
                path: "/gone/workspace".into()
            }
        );
    }

    #[test]
    fn a_missing_adapter_cannot_be_launched() {
        let fixture = Fixture::new("no-adapter");
        let workspace = fixture.dir("workspace");
        let detection = CodexDetection {
            cli_path: None,
            cli_source: None,
            cli_problem: Some("could not find codex".into()),
            cli_version: None,
            adapter_path: None,
            adapter_source: None,
            adapter_problem: Some("could not find codex-acp".into()),
            adapter_version: None,
            codex_path: CodexPathOverride::Unset,
            checked_at: now(),
        };

        let error = launch_options(
            &detection,
            &CodexSettings::default(),
            &workspace.display().to_string(),
        )
        .unwrap_err();
        match error {
            LaunchError::AdapterMissing { reason } => assert!(reason.contains("codex-acp")),
            other => panic!("expected adapter missing, got {other:?}"),
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_version_probe_reads_the_adapters_own_output() {
        let fixture = Fixture::new("version");
        let bin = fixture.dir("bin");
        let adapter = fixture.executable(&bin, "codex-acp");

        assert_eq!(
            probe_adapter_version(&adapter.display().to_string()).as_deref(),
            Some("1.1.7")
        );
    }

    #[test]
    fn probing_a_missing_adapter_is_not_an_error() {
        // The version is informational; readiness comes from ACP initialize.
        assert_eq!(probe_adapter_version("/definitely/not/here"), None);
    }

    #[test]
    fn partial_and_prerelease_versions_fail_closed() {
        assert!(!adapter_version_is_supported(Some("1.2")));
        assert!(!adapter_version_is_supported(Some("1.2.0-rc1")));
        assert!(adapter_version_is_supported(Some("1.1.7")));
    }
}
