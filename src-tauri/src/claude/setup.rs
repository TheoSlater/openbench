//! The Claude Code setup state the settings page renders.
//!
//! Claude Code owns credential handling. This module only combines persisted
//! installation, availability, and vendor status into one display state.

use crate::acp::probe::AuthenticationState;
use crate::acp::verification::{AgentVerification, InstallationState};
pub use crate::codex::setup::PrimaryAction;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What the Claude Code settings card renders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "state", rename_all = "kebab-case")]
#[ts(export)]
pub enum ClaudeSetupState {
    Unknown,
    /// No adapter found.
    NotInstalled {
        reason: Option<String>,
    },
    /// Installed, but no initialize has confirmed it works yet.
    NeedsInitialize {
        adapter_path: String,
    },
    /// Initialized, but the user has never signed in to the Claude Code CLI.
    ///
    /// Terminal state of the setup flow: Poly UI tells the user to run
    /// `claude login` (or `claude setup-token`) and re-checks. It never
    /// renders a method, a URL, or a token.
    AuthenticationRequired {
        adapter_path: String,
    },
    CliLoginRequired {
        adapter_path: String,
    },
    ConfigInvalid {
        adapter_path: String,
        diagnostic: String,
    },
    CliMissing {
        reason: Option<String>,
    },
    AdapterMissing {
        reason: Option<String>,
    },
    AdapterOutdated {
        adapter_path: String,
        version: Option<String>,
    },
    /// A successful initialize. Usable.
    Ready {
        adapter_path: String,
    },
    /// The process died, failed to start, or the handshake failed for a
    /// reason other than missing credentials.
    Crashed {
        adapter_path: Option<String>,
        message: String,
    },
}

impl ClaudeSetupState {
    #[must_use]
    pub fn from_snapshot(snapshot: Option<&AgentVerification>) -> Self {
        let Some(snapshot) = snapshot else {
            return Self::Unknown;
        };
        let adapter_path = snapshot.adapter_path.clone().unwrap_or_default();
        if snapshot.availability == Some(false) {
            return Self::Crashed {
                adapter_path: snapshot.adapter_path.clone(),
                message: snapshot
                    .availability_error
                    .clone()
                    .unwrap_or_else(|| "Adapter could not start".into()),
            };
        }
        match snapshot.installation {
            InstallationState::Unknown => Self::Unknown,
            InstallationState::NotInstalled => Self::NotInstalled { reason: None },
            InstallationState::CliMissing => Self::CliMissing { reason: None },
            InstallationState::AdapterMissing => Self::AdapterMissing { reason: None },
            InstallationState::AdapterOutdated => Self::AdapterOutdated {
                adapter_path,
                version: snapshot.adapter_version.clone(),
            },
            InstallationState::Available if snapshot.availability != Some(true) => {
                Self::NeedsInitialize { adapter_path }
            }
            InstallationState::Available => match &snapshot.authentication {
                AuthenticationState::LoggedIn | AuthenticationState::NotApplicable => {
                    Self::Ready { adapter_path }
                }
                AuthenticationState::LoggedOut => Self::AuthenticationRequired { adapter_path },
                AuthenticationState::ConfigInvalid { diagnostic } => Self::ConfigInvalid {
                    adapter_path,
                    diagnostic: diagnostic.clone(),
                },
            },
        }
    }
    #[must_use]
    pub fn primary_action(&self) -> PrimaryAction {
        match self {
            ClaudeSetupState::Ready { .. } => PrimaryAction::None,
            ClaudeSetupState::ConfigInvalid { .. } | ClaudeSetupState::Unknown => {
                PrimaryAction::None
            }
            ClaudeSetupState::AuthenticationRequired { .. } => PrimaryAction::SignIn,
            ClaudeSetupState::CliLoginRequired { .. } => PrimaryAction::SignIn,
            ClaudeSetupState::Crashed { .. } => PrimaryAction::Retry,
            ClaudeSetupState::NotInstalled { .. }
            | ClaudeSetupState::NeedsInitialize { .. }
            | ClaudeSetupState::CliMissing { .. }
            | ClaudeSetupState::AdapterMissing { .. }
            | ClaudeSetupState::AdapterOutdated { .. } => PrimaryAction::SetUp,
        }
    }

    #[must_use]
    pub fn is_usable(&self) -> bool {
        matches!(self, ClaudeSetupState::Ready { .. })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ClaudeSetupView {
    pub state: ClaudeSetupState,
    pub primary_action: PrimaryAction,
    pub usable: bool,
}

impl From<ClaudeSetupState> for ClaudeSetupView {
    fn from(state: ClaudeSetupState) -> Self {
        Self {
            primary_action: state.primary_action(),
            usable: state.is_usable(),
            state,
        }
    }
}
