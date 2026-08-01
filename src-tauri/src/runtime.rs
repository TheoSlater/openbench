//! The top-level runtime reference carried by every conversation.
//!
//! Poly UI has two runtime families that do not share an interface:
//! chat models (direct BYOK APIs or Gateway) and local coding agents
//! (Claude Code or Codex). A conversation may move between families in
//! place — switching the header model selector rebinds the conversation.
//!
//! The discriminant is stored in its own column (`conversations.runtime_kind`)
//! rather than inferred from which payload fields happen to be non-null. The
//! payload lives in `conversations.runtime_ref` as JSON.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Which coding agent an installation drives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum AgentKind {
    Codex,
    ClaudeCode,
}

impl AgentKind {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            AgentKind::Codex => "codex",
            AgentKind::ClaudeCode => "claude-code",
        }
    }

    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "codex" => Some(AgentKind::Codex),
            "claude-code" => Some(AgentKind::ClaudeCode),
            _ => None,
        }
    }
}

/// Why a conversation could not be pointed at a live runtime.
///
/// Carried instead of silently defaulting, so the UI can tell the user what
/// happened and offer a specific fix.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
// The shared `No` prefix is the point: every variant names something that was
// absent. `UnresolvedReason::History` would read as the opposite.
#[allow(clippy::enum_variant_names)]
pub enum UnresolvedReason {
    /// The conversation has assistant turns but none recorded a provider.
    NoProviderRecorded,
    /// A provider was recorded but no connection for it survived migration.
    NoConnection,
    /// A connection matched but the model it used is no longer offered.
    NoModel,
    /// The conversation has no assistant turns at all — nothing to infer from.
    NoHistory,
}

/// The runtime a conversation is bound to.
///
/// `kind` is the discriminant, mirrored into `conversations.runtime_kind`.
/// Keep the tag values in sync with [`RuntimeKind::as_str`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "kebab-case")]
#[ts(export)]
pub enum RuntimeRef {
    /// A direct BYOK model API. Poly UI owns the loop.
    ChatModel {
        connection_id: String,
        model_id: String,
    },
    /// A local coding-agent runtime. The agent owns the loop.
    ///
    /// The provider session id is absent until the agent has handed one back.
    CodingAgent {
        installation_id: String,
        agent_kind: AgentKind,
        workspace_id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent_session_id: Option<String>,
    },
    /// Migrated from pre-rework data that no longer resolves. Displayed as a
    /// prompt to pick a runtime, never silently treated as a default.
    Unresolved {
        reason: UnresolvedReason,
        /// What the old row recorded, for display. Never secret material.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        legacy_provider: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        legacy_model: Option<String>,
    },
}

/// The discriminant on its own, for the column and for family comparisons.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum RuntimeKind {
    ChatModel,
    CodingAgent,
    Unresolved,
}

impl RuntimeKind {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            RuntimeKind::ChatModel => "chat-model",
            RuntimeKind::CodingAgent => "coding-agent",
            RuntimeKind::Unresolved => "unresolved",
        }
    }

    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "chat-model" => Some(RuntimeKind::ChatModel),
            "coding-agent" => Some(RuntimeKind::CodingAgent),
            "unresolved" => Some(RuntimeKind::Unresolved),
            _ => None,
        }
    }
}

impl RuntimeRef {
    #[must_use]
    pub fn kind(&self) -> RuntimeKind {
        match self {
            RuntimeRef::ChatModel { .. } => RuntimeKind::ChatModel,
            RuntimeRef::CodingAgent { .. } => RuntimeKind::CodingAgent,
            RuntimeRef::Unresolved { .. } => RuntimeKind::Unresolved,
        }
    }

    /// JSON for the `runtime_ref` column.
    pub fn to_column(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// Parse a `(runtime_kind, runtime_ref)` column pair.
    ///
    /// The discriminant column is authoritative: a payload whose tag disagrees
    /// with it is a corrupt row, not a silent reinterpretation.
    pub fn from_columns(kind: &str, payload: &str) -> Result<Self, String> {
        let expected =
            RuntimeKind::parse(kind).ok_or_else(|| format!("unknown runtime kind: {kind}"))?;
        let compatible = payload.replace("\"acp_session_id\":", "\"agent_session_id\":");
        let parsed: RuntimeRef = serde_json::from_str(&compatible)
            .map_err(|error| format!("invalid runtime ref: {error}"))?;
        if parsed.kind() != expected {
            return Err(format!(
                "runtime_kind column says {} but payload is {}",
                expected.as_str(),
                parsed.kind().as_str()
            ));
        }
        Ok(parsed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chat() -> RuntimeRef {
        RuntimeRef::ChatModel {
            connection_id: "conn-1".into(),
            model_id: "gpt-5".into(),
        }
    }

    fn agent() -> RuntimeRef {
        RuntimeRef::CodingAgent {
            installation_id: "inst-1".into(),
            agent_kind: AgentKind::Codex,
            workspace_id: "ws-1".into(),
            agent_session_id: None,
        }
    }

    #[test]
    fn kind_matches_variant() {
        assert_eq!(chat().kind(), RuntimeKind::ChatModel);
        assert_eq!(agent().kind(), RuntimeKind::CodingAgent);
    }

    #[test]
    fn round_trips_through_columns() {
        for value in [
            chat(),
            agent(),
            RuntimeRef::CodingAgent {
                installation_id: "inst-1".into(),
                agent_kind: AgentKind::ClaudeCode,
                workspace_id: "ws-1".into(),
                agent_session_id: Some("sess-9".into()),
            },
            RuntimeRef::Unresolved {
                reason: UnresolvedReason::NoModel,
                legacy_provider: Some("OpenAICompatible".into()),
                legacy_model: Some("gpt-4o".into()),
            },
        ] {
            let payload = value.to_column().unwrap();
            let back = RuntimeRef::from_columns(value.kind().as_str(), &payload).unwrap();
            assert_eq!(back, value);
        }
    }

    #[test]
    fn discriminant_column_wins_over_payload() {
        let payload = chat().to_column().unwrap();
        let error = RuntimeRef::from_columns("coding-agent", &payload).unwrap_err();
        assert!(error.contains("coding-agent"), "{error}");
    }

    #[test]
    fn agent_session_id_is_omitted_when_absent() {
        let json = agent().to_column().unwrap();
        assert!(!json.contains("agent_session_id"), "{json}");
        assert!(json.contains("\"kind\":\"coding-agent\""), "{json}");
    }

    #[test]
    fn reads_legacy_agent_session_key() {
        let payload = r#"{"kind":"coding-agent","installation_id":"i","agent_kind":"codex","workspace_id":"w","acp_session_id":"s"}"#;
        assert!(matches!(
            RuntimeRef::from_columns("coding-agent", payload).unwrap(),
            RuntimeRef::CodingAgent { agent_session_id: Some(id), .. } if id == "s"
        ));
    }

    #[test]
    fn kind_strings_round_trip() {
        for kind in [
            RuntimeKind::ChatModel,
            RuntimeKind::CodingAgent,
            RuntimeKind::Unresolved,
        ] {
            assert_eq!(RuntimeKind::parse(kind.as_str()), Some(kind));
        }
        assert_eq!(RuntimeKind::parse("nope"), None);
    }

    #[test]
    fn agent_kind_strings_round_trip() {
        for kind in [AgentKind::Codex, AgentKind::ClaudeCode] {
            assert_eq!(AgentKind::parse(kind.as_str()), Some(kind));
        }
        assert_eq!(AgentKind::parse("gemini-cli"), None);
    }
}
