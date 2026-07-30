//! One error type for everything that can go wrong driving an ACP agent.
//!
//! Every variant carries something the UI can act on: a path to fix, a timeout
//! to raise, a message from the agent to show verbatim. A variant that only
//! said "it failed" would push the diagnosis back onto the user.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A normalized ACP failure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export)]
pub enum AcpError {
    /// The executable could not be found, or a configured override is unusable.
    Resolve {
        /// Human-readable reason, already specific about which path failed.
        message: String,
        /// Set when the user configured a path that did not work, so the UI can
        /// send them straight to that setting.
        offending_path: Option<String>,
    },
    /// The process could not be started at all.
    Spawn {
        message: String,
        /// The executable that failed to start.
        executable: String,
    },
    /// The process started but the ACP handshake did not complete.
    Initialize {
        message: String,
        /// Tail of the agent's stderr, bounded. Usually the actual reason.
        stderr_tail: Option<String>,
    },
    /// A bounded wait elapsed.
    Timeout {
        /// Which operation timed out, e.g. `initialize`.
        operation: String,
        elapsed_ms: u64,
    },
    RequestTimeout {
        elapsed_ms: u64,
    },
    IdleTimeout {
        elapsed_ms: u64,
    },
    HardTurnTimeout {
        elapsed_ms: u64,
    },
    WriteTimeout {
        elapsed_ms: u64,
    },
    CancelDrainTimeout {
        elapsed_ms: u64,
    },
    AgentExited {
        exit_code: Option<i32>,
        stderr_tail: Option<String>,
    },
    /// The agent sent something that is not usable ACP: unparseable JSON, or
    /// JSON that is not a protocol message.
    Protocol {
        message: String,
        /// A bounded excerpt of the offending output, for a bug report.
        excerpt: Option<String>,
    },
    /// The pipe to the agent failed, or the agent exited while we were talking
    /// to it.
    Transport {
        message: String,
        /// Present when the child exited; `None` if it was killed by a signal.
        exit_code: Option<i32>,
        stderr_tail: Option<String>,
    },
    /// The agent answered a request with a protocol-level error. Its own words,
    /// not ours — a version mismatch surfaces here rather than as a
    /// Poly-invented state.
    Agent {
        code: i32,
        message: String,
    },
    /// The operation was cancelled by the user or by shutdown.
    Cancelled {
        operation: String,
    },
}

impl AcpError {
    /// Whether retrying the same operation could plausibly succeed.
    #[must_use]
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            AcpError::Timeout { .. }
                | AcpError::Transport { .. }
                | AcpError::Spawn { .. }
                | AcpError::RequestTimeout { .. }
                | AcpError::IdleTimeout { .. }
                | AcpError::WriteTimeout { .. }
                | AcpError::AgentExited { .. }
        )
    }

    /// A short label for logs. Never contains agent output, which may be long
    /// and is not ours to reformat.
    #[must_use]
    pub fn label(&self) -> &'static str {
        match self {
            AcpError::Resolve { .. } => "resolve",
            AcpError::Spawn { .. } => "spawn",
            AcpError::Initialize { .. } => "initialize",
            AcpError::Timeout { .. } => "timeout",
            AcpError::RequestTimeout { .. } => "request-timeout",
            AcpError::IdleTimeout { .. } => "idle-timeout",
            AcpError::HardTurnTimeout { .. } => "hard-turn-timeout",
            AcpError::WriteTimeout { .. } => "write-timeout",
            AcpError::CancelDrainTimeout { .. } => "cancel-drain-timeout",
            AcpError::AgentExited { .. } => "agent-exited",
            AcpError::Protocol { .. } => "protocol",
            AcpError::Transport { .. } => "transport",
            AcpError::Agent { .. } => "agent",
            AcpError::Cancelled { .. } => "cancelled",
        }
    }

    /// Bound an excerpt of untrusted agent output before it is carried in an
    /// error, so a megabyte of garbage cannot ride into the UI.
    #[must_use]
    pub fn excerpt(raw: &str) -> String {
        const LIMIT: usize = 512;
        let trimmed = raw.trim();
        if trimmed.chars().count() <= LIMIT {
            return trimmed.to_string();
        }
        let kept: String = trimmed.chars().take(LIMIT).collect();
        format!("{kept}… [truncated]")
    }
}

impl std::fmt::Display for AcpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AcpError::Resolve { message, .. }
            | AcpError::Spawn { message, .. }
            | AcpError::Initialize { message, .. }
            | AcpError::Protocol { message, .. }
            | AcpError::Transport { message, .. }
            | AcpError::Agent { message, .. } => f.write_str(message),
            AcpError::Timeout {
                operation,
                elapsed_ms,
            } => write!(f, "{operation} timed out after {elapsed_ms}ms"),
            AcpError::RequestTimeout { elapsed_ms } => {
                write!(f, "The coding agent did not answer within {elapsed_ms}ms")
            }
            AcpError::IdleTimeout { elapsed_ms } => {
                write!(f, "The coding agent was idle for {elapsed_ms}ms")
            }
            AcpError::HardTurnTimeout { elapsed_ms } => {
                write!(f, "The coding agent turn exceeded {elapsed_ms}ms")
            }
            AcpError::WriteTimeout { elapsed_ms } => {
                write!(f, "The coding agent stopped reading after {elapsed_ms}ms")
            }
            AcpError::CancelDrainTimeout { elapsed_ms } => {
                write!(f, "The coding agent did not stop within {elapsed_ms}ms")
            }
            AcpError::AgentExited { exit_code, .. } => match exit_code {
                Some(code) => write!(f, "The coding agent exited with code {code}"),
                None => f.write_str("The coding agent exited"),
            },
            AcpError::Cancelled { operation } => write!(f, "{operation} was cancelled"),
        }
    }
}

impl From<crate::acp::resolve::ResolveError> for AcpError {
    fn from(error: crate::acp::resolve::ResolveError) -> Self {
        use crate::acp::resolve::ResolveError;
        let offending_path = match &error {
            ResolveError::OverrideMissing { path }
            | ResolveError::OverrideNotExecutable { path } => Some(path.display().to_string()),
            ResolveError::NotFound { .. } => None,
        };
        AcpError::Resolve {
            message: error.to_string(),
            offending_path,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_variant_carries_something_actionable() {
        let cases = [
            AcpError::Resolve {
                message: "not found".into(),
                offending_path: Some("/tmp/x".into()),
            },
            AcpError::Spawn {
                message: "permission denied".into(),
                executable: "/tmp/x".into(),
            },
            AcpError::Initialize {
                message: "handshake failed".into(),
                stderr_tail: Some("boom".into()),
            },
            AcpError::Timeout {
                operation: "initialize".into(),
                elapsed_ms: 15_000,
            },
            AcpError::Protocol {
                message: "not json".into(),
                excerpt: Some("{{{".into()),
            },
            AcpError::Transport {
                message: "exited".into(),
                exit_code: Some(7),
                stderr_tail: None,
            },
            AcpError::Agent {
                code: -32600,
                message: "unsupported protocol version".into(),
            },
            AcpError::Cancelled {
                operation: "prompt".into(),
            },
        ];
        for error in cases {
            assert!(!error.label().is_empty());
            assert!(!error.to_string().is_empty());
            // Round-trips across the boundary.
            let json = serde_json::to_string(&error).unwrap();
            assert_eq!(serde_json::from_str::<AcpError>(&json).unwrap(), error);
        }
    }

    #[test]
    fn only_transient_failures_are_retryable() {
        assert!(AcpError::Timeout {
            operation: "initialize".into(),
            elapsed_ms: 1,
        }
        .is_retryable());
        assert!(!AcpError::Resolve {
            message: "no".into(),
            offending_path: None,
        }
        .is_retryable());
        assert!(!AcpError::Agent {
            code: -1,
            message: "no".into(),
        }
        .is_retryable());
    }

    #[test]
    fn excerpts_are_bounded() {
        let long = "x".repeat(10_000);
        let excerpt = AcpError::excerpt(&long);
        assert!(excerpt.chars().count() < 600, "{}", excerpt.len());
        assert!(excerpt.ends_with("[truncated]"));
        assert_eq!(AcpError::excerpt("  short  "), "short");
    }

    #[test]
    fn a_bad_override_becomes_an_error_naming_the_path() {
        let error: AcpError = crate::acp::resolve::ResolveError::OverrideNotExecutable {
            path: "/tmp/not-runnable".into(),
        }
        .into();
        match error {
            AcpError::Resolve { offending_path, .. } => {
                assert_eq!(offending_path.as_deref(), Some("/tmp/not-runnable"));
            }
            other => panic!("expected resolve error, got {other:?}"),
        }
    }
}
