//! Connections, models, and workspaces.
//!
//! A *provider* describes API behavior (how to talk to Anthropic, how to talk
//! to an OpenAI-compatible endpoint). A *connection* is one set of credentials
//! and endpoint configuration for a provider — a user can hold several per
//! provider. A *model* belongs to a connection.
//!
//! No struct in this module holds secret material. Credentials live in the OS
//! keychain and the database stores only a [`secrets::SecretRef`].

// Persisted compatibility types remain readable while active generation and
// discovery run through the AI SDK sidecar.
#![allow(dead_code)]

pub mod repository;
pub mod secrets;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The API behavior a connection speaks.
///
/// This is deliberately not the old `ProviderType`: it names a wire protocol
/// and vendor, not a row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum Provider {
    Openai,
    Anthropic,
    Gemini,
    Openrouter,
    Ollama,
    Lmstudio,
    /// Any other endpoint speaking the OpenAI chat-completions shape.
    OpenaiCompatible,
    VercelGateway,
}

impl Provider {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Provider::Openai => "openai",
            Provider::Anthropic => "anthropic",
            Provider::Gemini => "gemini",
            Provider::Openrouter => "openrouter",
            Provider::Ollama => "ollama",
            Provider::Lmstudio => "lmstudio",
            Provider::OpenaiCompatible => "openai-compatible",
            Provider::VercelGateway => "vercel-gateway",
        }
    }

    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "openai" => Some(Provider::Openai),
            "anthropic" => Some(Provider::Anthropic),
            "gemini" => Some(Provider::Gemini),
            "openrouter" => Some(Provider::Openrouter),
            "ollama" => Some(Provider::Ollama),
            "lmstudio" => Some(Provider::Lmstudio),
            "openai-compatible" => Some(Provider::OpenaiCompatible),
            "vercel-gateway" => Some(Provider::VercelGateway),
            _ => None,
        }
    }

    /// Endpoint used when the connection stores no explicit `base_url`.
    #[must_use]
    pub fn default_base_url(self) -> &'static str {
        match self {
            Provider::Openai => "https://api.openai.com/v1",
            Provider::Anthropic => "https://api.anthropic.com/v1",
            Provider::Gemini => "https://generativelanguage.googleapis.com/v1beta",
            Provider::Openrouter => "https://openrouter.ai/api/v1",
            Provider::Ollama => "http://127.0.0.1:11434",
            Provider::Lmstudio => "http://127.0.0.1:1234/v1",
            Provider::OpenaiCompatible => "https://api.openai.com/v1",
            Provider::VercelGateway => "https://ai-gateway.vercel.sh/v4/ai",
        }
    }

    /// Whether a credential is normally required to use this provider.
    #[must_use]
    pub fn needs_credential(self) -> bool {
        !matches!(self, Provider::Ollama | Provider::Lmstudio)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConnectionValidation {
    pub ready: bool,
    pub message: String,
}

/// One configured endpoint plus credential.
///
/// Holds no secret: [`Connection::secret_ref`] is an opaque handle into the OS
/// keychain. `extra_headers` may still carry user-supplied header *values*
/// inherited from the pre-rework schema, so every formatting path must go
/// through [`Connection::redacted`] — see [`secrets::redact_headers`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Connection {
    pub id: String,
    pub account_id: String,
    pub provider: Provider,
    pub display_name: String,
    pub enabled: bool,
    /// `None` means "use [`Provider::default_base_url`]".
    pub base_url: Option<String>,
    /// Opaque keychain handle. Never a credential.
    #[ts(type = "string | null")]
    pub secret_ref: Option<secrets::SecretRef>,
    /// JSON object of extra request headers, or `None`.
    pub extra_headers: Option<String>,
    /// Ordering within the account. `i32` rather than `i64` so the generated
    /// binding is `number`, not `bigint`.
    pub position: i32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum ConnectionHealthStatus {
    #[default]
    Never,
    Ready,
    Failed,
}

impl ConnectionHealthStatus {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Never => "never",
            Self::Ready => "ready",
            Self::Failed => "failed",
        }
    }

    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "never" => Some(Self::Never),
            "ready" => Some(Self::Ready),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConnectionHealth {
    pub status: ConnectionHealthStatus,
    pub detail: Option<String>,
    pub last_validated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConnectionSummary {
    pub connection: Connection,
    pub health: ConnectionHealth,
    pub available_model_count: i32,
    pub enabled_model_count: i32,
}

impl Connection {
    /// The endpoint this connection actually talks to.
    #[must_use]
    pub fn effective_base_url(&self) -> &str {
        self.base_url
            .as_deref()
            .filter(|url| !url.trim().is_empty())
            .unwrap_or_else(|| self.provider.default_base_url())
    }

    /// A copy safe to log, export, or show in diagnostics.
    ///
    /// Header values are the only field that can carry user-pasted secrets;
    /// they are replaced while the names are kept, because the names are what
    /// makes a diagnostic useful.
    #[must_use]
    pub fn redacted(&self) -> Connection {
        Connection {
            extra_headers: self.extra_headers.as_deref().map(secrets::redact_headers),
            ..self.clone()
        }
    }
}

/// Where a model record came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum DiscoverySource {
    /// Returned by the provider's own model listing endpoint.
    Remote,
    /// Typed in by the user.
    Manual,
    /// Carried over from the pre-rework `model_suggestions` column.
    Migrated,
}

impl DiscoverySource {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            DiscoverySource::Remote => "remote",
            DiscoverySource::Manual => "manual",
            DiscoverySource::Migrated => "migrated",
        }
    }

    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "remote" => Some(DiscoverySource::Remote),
            "manual" => Some(DiscoverySource::Manual),
            "migrated" => Some(DiscoverySource::Migrated),
            _ => None,
        }
    }
}

/// A model offered by one connection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ConnectionModel {
    pub connection_id: String,
    /// The provider's own id, verbatim. Never normalized — it goes on the wire.
    pub remote_id: String,
    pub display_name: Option<String>,
    /// JSON blob; shape firms up when the provider layer lands in checkpoint 6.
    pub capabilities: Option<String>,
    pub enabled: bool,
    /// Alternate ids that should resolve to this model.
    pub aliases: Vec<String>,
    /// JSON blob for provider-specific extras.
    pub metadata: Option<String>,
    pub discovery_source: DiscoverySource,
    pub last_seen_at: Option<String>,
}

/// Whether a workspace directory is currently usable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum WorkspaceAvailability {
    Available,
    Missing,
    Unknown,
}

impl WorkspaceAvailability {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            WorkspaceAvailability::Available => "available",
            WorkspaceAvailability::Missing => "missing",
            WorkspaceAvailability::Unknown => "unknown",
        }
    }

    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "available" => Some(WorkspaceAvailability::Available),
            "missing" => Some(WorkspaceAvailability::Missing),
            "unknown" => Some(WorkspaceAvailability::Unknown),
            _ => None,
        }
    }
}

/// A directory a coding agent is allowed to work in.
///
/// Only coding-agent conversations reference one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Workspace {
    pub id: String,
    pub account_id: String,
    pub path: String,
    pub display_name: String,
    pub last_validated_at: Option<String>,
    pub availability: WorkspaceAvailability,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_strings_round_trip() {
        for provider in [
            Provider::Openai,
            Provider::Anthropic,
            Provider::Gemini,
            Provider::Openrouter,
            Provider::Ollama,
            Provider::Lmstudio,
            Provider::OpenaiCompatible,
            Provider::VercelGateway,
        ] {
            assert_eq!(Provider::parse(provider.as_str()), Some(provider));
            assert!(!provider.default_base_url().is_empty());
        }
        assert_eq!(Provider::parse("mystery"), None);
    }

    #[test]
    fn local_providers_need_no_credential() {
        assert!(!Provider::Ollama.needs_credential());
        assert!(!Provider::Lmstudio.needs_credential());
        assert!(Provider::Anthropic.needs_credential());
    }

    #[test]
    fn blank_base_url_falls_back_to_provider_default() {
        let mut connection = Connection {
            id: "c".into(),
            account_id: String::new(),
            provider: Provider::Anthropic,
            display_name: "Anthropic".into(),
            enabled: true,
            base_url: Some("   ".into()),
            secret_ref: None,
            extra_headers: None,
            position: 0,
        };
        assert_eq!(
            connection.effective_base_url(),
            "https://api.anthropic.com/v1"
        );

        connection.base_url = Some("https://proxy.example/v1".into());
        assert_eq!(connection.effective_base_url(), "https://proxy.example/v1");
    }

    #[test]
    fn enum_strings_round_trip() {
        for value in [
            DiscoverySource::Remote,
            DiscoverySource::Manual,
            DiscoverySource::Migrated,
        ] {
            assert_eq!(DiscoverySource::parse(value.as_str()), Some(value));
        }
        for value in [
            WorkspaceAvailability::Available,
            WorkspaceAvailability::Missing,
            WorkspaceAvailability::Unknown,
        ] {
            assert_eq!(WorkspaceAvailability::parse(value.as_str()), Some(value));
        }
    }
}
