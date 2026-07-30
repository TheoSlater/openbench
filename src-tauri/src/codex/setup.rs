//! The Codex setup state the settings page renders.
//!
//! Codex owns credential handling. This module only combines persisted
//! installation, availability, and vendor status into one display state.
//!
//! State-driven: each state carries exactly what its screen needs and implies
//! one primary action. The UI does not compute the state from a pile of
//! booleans — it switches on the tag.

use crate::acp::probe::AuthenticationState;
use crate::acp::verification::{AgentVerification, InstallationState};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The single action the card offers. Every non-ready, non-crashed state
/// collapses into `SetUp` — the user does not need to know whether the
/// adapter is missing, unauthenticated, or simply unverified. The setup
/// sheet works that out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum PrimaryAction {
    SetUp,
    SignIn,
    Retry,
    None,
}

/// What the Codex settings card renders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "state", rename_all = "kebab-case")]
#[ts(export)]
pub enum CodexSetupState {
    /// No persisted verification exists yet.
    Unknown,
    /// No adapter found.
    NotInstalled {
        reason: Option<String>,
    },
    /// Installed, but no initialize has confirmed it works yet.
    NeedsInitialize {
        adapter_path: String,
    },
    /// Initialized, but the user has never signed in to the Codex CLI.
    ///
    /// Terminal state of the setup flow: Poly UI tells the user to run
    /// `codex login` and re-checks. It never renders a method, a URL, or a
    /// token.
    AuthenticationRequired {
        adapter_path: String,
    },
    /// Initialize advertised no sign-in method (for example with NO_BROWSER).
    CliLoginRequired {
        adapter_path: String,
    },
    /// Vendor configuration cannot be parsed; signing in cannot fix it.
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

impl CodexSetupState {
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
    /// One clear primary action per state.
    #[must_use]
    pub fn primary_action(&self) -> PrimaryAction {
        match self {
            CodexSetupState::Ready { .. } => PrimaryAction::None,
            CodexSetupState::ConfigInvalid { .. } | CodexSetupState::Unknown => PrimaryAction::None,
            CodexSetupState::AuthenticationRequired { .. } => PrimaryAction::SignIn,
            CodexSetupState::CliLoginRequired { .. } => PrimaryAction::SignIn,
            CodexSetupState::Crashed { .. } => PrimaryAction::Retry,
            CodexSetupState::NotInstalled { .. }
            | CodexSetupState::NeedsInitialize { .. }
            | CodexSetupState::CliMissing { .. }
            | CodexSetupState::AdapterMissing { .. }
            | CodexSetupState::AdapterOutdated { .. } => PrimaryAction::SetUp,
        }
    }

    /// Whether a session may be started.
    #[must_use]
    pub fn is_usable(&self) -> bool {
        matches!(self, CodexSetupState::Ready { .. })
    }
}

/// What the settings page renders: the state plus the decision derived from it.
///
/// The derivation lives in Rust and crosses the boundary as data, so the
/// frontend switches on a value rather than re-implementing the rules.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CodexSetupView {
    pub state: CodexSetupState,
    pub primary_action: PrimaryAction,
    pub usable: bool,
}

impl From<CodexSetupState> for CodexSetupView {
    fn from(state: CodexSetupState) -> Self {
        CodexSetupView {
            primary_action: state.primary_action(),
            usable: state.is_usable(),
            state,
        }
    }
}
