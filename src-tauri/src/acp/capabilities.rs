//! What an agent said it can do, read from its initialize response.
//!
//! Two rules, both enforced by construction in [`AgentCapabilitySet::from_response`]:
//!
//! 1. Never hardcode that an agent supports a feature. The set is built from the
//!    response and from nothing else — there is no per-vendor table here, and
//!    this checkpoint does not know any vendor exists.
//! 2. Never default a capability to true when the response omits it. Every
//!    field derives from an explicit `true` or an explicitly present object.
//!    Absence means no.

use agent_client_protocol::schema::v1::{AgentCapabilities, AuthMethod, InitializeResponse};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The capability set Poly UI cares about, per installation.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentCapabilitySet {
    /// `session/load` — restoring a session by id.
    pub load_session: bool,
    /// `session/resume` — continuing a session that is still known to the agent.
    pub resume_session: bool,
    /// The agent asks before acting, via `session/request_permission`.
    ///
    /// Not separately advertised in ACP v1: any agent may send the request, and
    /// the client advertises whether it can answer. Tracked here so the UI can
    /// say whether permission prompts are expected, and set when the agent
    /// actually asks.
    pub permission_requests: bool,
    /// The agent can read and write files through the client.
    pub filesystem: bool,
    /// The agent can run commands in a client-hosted terminal.
    pub terminal: bool,
    /// The agent can run background terminals.
    pub background_terminal: bool,
    /// Images may be sent in a prompt.
    pub images: bool,
    /// Embedded context references may be sent in a prompt.
    pub context_references: bool,
    /// The agent reports an execution plan.
    pub plans: bool,
    /// The agent exposes slash commands.
    pub slash_commands: bool,
    /// The agent accepts client-provided MCP servers over any transport.
    pub mcp: bool,
}

/// An authentication method the agent advertised.
///
/// Poly UI never renders these — see `acp::capabilities` module docs. Kept
/// only as the internal signal for whether the agent still wants credentials
/// (`!auth_methods.is_empty()`), never surfaced past that boolean.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentAuthMethod {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub kind: AgentAuthKind,
    pub requires_interaction: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum AgentAuthKind {
    Agent,
    Terminal,
    Environment,
}

/// Everything learned from a successful initialize.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AgentDescriptor {
    /// The negotiated wire protocol version. Not the SDK crate version — the
    /// two are unrelated and must not be inferred from each other.
    pub protocol_version: String,
    pub capabilities: AgentCapabilitySet,
    pub auth_methods: Vec<AgentAuthMethod>,
    pub agent_name: Option<String>,
    pub agent_version: Option<String>,
}

impl AgentCapabilitySet {
    /// Read the capability set from an initialize response.
    ///
    /// Only explicit positives count. `Option` capability objects are "present
    /// means supported" per the schema, so `is_some()` is the correct read —
    /// but `None` never becomes `true`.
    #[must_use]
    pub fn from_agent_capabilities(capabilities: &AgentCapabilities) -> Self {
        let session = &capabilities.session_capabilities;
        AgentCapabilitySet {
            load_session: capabilities.load_session,
            // `session/resume` rides on the same session capability object.
            // Absence means the agent did not advertise it.
            resume_session: session.list.is_some(),
            // Set later, when the agent actually sends a permission request.
            permission_requests: false,
            // The filesystem and terminal capabilities in ACP v1 are advertised
            // by the *client*, not the agent: they describe what we offer. What
            // the agent will use is only observable from its requests, so these
            // start false and are raised on first use rather than assumed.
            filesystem: false,
            terminal: false,
            background_terminal: false,
            images: capabilities.prompt_capabilities.image,
            context_references: capabilities.prompt_capabilities.embedded_context,
            // Plans arrive as session updates; no advertisement exists.
            plans: false,
            // Slash commands arrive as an available-commands update.
            slash_commands: false,
            mcp: capabilities.mcp_capabilities.http
                || capabilities.mcp_capabilities.sse
                || session.additional_directories.is_some(),
        }
    }
}

impl AgentDescriptor {
    /// Build a descriptor from an initialize response.
    #[must_use]
    pub fn from_response(response: &InitializeResponse) -> Self {
        AgentDescriptor {
            protocol_version: format!("{:?}", response.protocol_version),
            capabilities: AgentCapabilitySet::from_agent_capabilities(&response.agent_capabilities),
            auth_methods: response
                .auth_methods
                .iter()
                .map(AgentAuthMethod::from_schema)
                .collect(),
            agent_name: response.agent_info.as_ref().map(|info| info.name.clone()),
            agent_version: response
                .agent_info
                .as_ref()
                .map(|info| info.version.clone()),
        }
    }
}

impl AgentAuthMethod {
    fn from_schema(method: &AuthMethod) -> Self {
        AgentAuthMethod {
            id: method.id().0.to_string(),
            name: method.name().to_string(),
            description: method.description().map(str::to_string),
            kind: match method {
                AuthMethod::Agent(_) => AgentAuthKind::Agent,
                AuthMethod::Terminal(_) => AgentAuthKind::Terminal,
                AuthMethod::EnvVar(_) => AgentAuthKind::Environment,
                _ => AgentAuthKind::Agent,
            },
            requires_interaction: method
                .meta()
                .and_then(|meta| {
                    meta.get("requires-interaction")
                        .or_else(|| meta.get("requiresInteraction"))
                })
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(true),
        }
    }
}

#[must_use]
pub fn advertised_auth_method<'a>(
    methods: &'a [AgentAuthMethod],
    method_id: &str,
) -> Option<&'a AgentAuthMethod> {
    methods.iter().find(|method| method.id == method_id)
}

#[must_use]
pub fn preferred_auth_method(methods: &[AgentAuthMethod]) -> Option<&AgentAuthMethod> {
    methods.iter().min_by_key(|method| {
        if !method.requires_interaction {
            0
        } else {
            match method.kind {
                AgentAuthKind::Agent => 1,
                AgentAuthKind::Terminal => 2,
                AgentAuthKind::Environment => 3,
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> InitializeResponse {
        serde_json::from_str(json).expect("initialize response")
    }

    #[test]
    fn an_omitted_capability_is_never_true() {
        let response = parse(r#"{"protocolVersion":1,"agentCapabilities":{},"authMethods":[]}"#);
        let descriptor = AgentDescriptor::from_response(&response);
        let capabilities = descriptor.capabilities;

        assert_eq!(capabilities, AgentCapabilitySet::default());
        assert!(!capabilities.load_session);
        assert!(!capabilities.resume_session);
        assert!(!capabilities.images);
        assert!(!capabilities.context_references);
        assert!(!capabilities.mcp);
        assert!(descriptor.auth_methods.is_empty());
    }

    #[test]
    fn a_full_capability_set_is_read_from_the_response() {
        let response = parse(
            r#"{
                "protocolVersion":1,
                "agentCapabilities":{
                    "loadSession":true,
                    "promptCapabilities":{"image":true,"embeddedContext":true},
                    "mcpCapabilities":{"http":true,"sse":true},
                    "sessionCapabilities":{"list":{},"delete":{},"additionalDirectories":{}}
                },
                "authMethods":[
                    {"id":"a","name":"Method A","description":"first"},
                    {"id":"b","name":"Method B"}
                ],
                "agentInfo":{"name":"mock","version":"1.2.3"}
            }"#,
        );
        let descriptor = AgentDescriptor::from_response(&response);

        assert!(descriptor.capabilities.load_session);
        assert!(descriptor.capabilities.resume_session);
        assert!(descriptor.capabilities.images);
        assert!(descriptor.capabilities.context_references);
        assert!(descriptor.capabilities.mcp);
        assert_eq!(descriptor.agent_name.as_deref(), Some("mock"));
        assert_eq!(descriptor.agent_version.as_deref(), Some("1.2.3"));
        assert_eq!(descriptor.auth_methods.len(), 2);
        assert_eq!(descriptor.auth_methods[0].id, "a");
        assert_eq!(
            descriptor.auth_methods[0].description.as_deref(),
            Some("first")
        );
        assert_eq!(descriptor.auth_methods[1].description, None);
    }

    #[test]
    fn a_false_capability_stays_false() {
        let response = parse(
            r#"{"protocolVersion":1,
                "agentCapabilities":{"loadSession":false,
                    "promptCapabilities":{"image":false,"embeddedContext":false}},
                "authMethods":[]}"#,
        );
        let capabilities = AgentDescriptor::from_response(&response).capabilities;
        assert!(!capabilities.load_session);
        assert!(!capabilities.images);
    }

    #[test]
    fn client_side_capabilities_are_not_claimed_on_the_agents_behalf() {
        // fs/terminal in ACP v1 describe what the *client* offers. Reading them
        // as agent capabilities would claim support nobody advertised.
        let response = parse(
            r#"{"protocolVersion":1,
                "agentCapabilities":{"loadSession":true},
                "authMethods":[]}"#,
        );
        let capabilities = AgentDescriptor::from_response(&response).capabilities;
        assert!(!capabilities.filesystem);
        assert!(!capabilities.terminal);
        assert!(!capabilities.background_terminal);
        assert!(!capabilities.permission_requests);
    }

    #[test]
    fn preferred_auth_method_never_invents_an_unadvertised_id() {
        let methods = vec![AgentAuthMethod {
            id: "browser".into(),
            name: "Browser".into(),
            description: None,
            kind: AgentAuthKind::Agent,
            requires_interaction: true,
        }];
        assert_eq!(
            preferred_auth_method(&methods).map(|method| method.id.as_str()),
            Some("browser")
        );
        assert!(advertised_auth_method(&methods, "invented").is_none());
    }

    #[test]
    fn descriptor_round_trips_across_the_boundary() {
        let response = parse(
            r#"{"protocolVersion":1,"agentCapabilities":{"loadSession":true},
                "authMethods":[{"id":"x","name":"X"}]}"#,
        );
        let descriptor = AgentDescriptor::from_response(&response);
        let json = serde_json::to_string(&descriptor).unwrap();
        assert_eq!(
            serde_json::from_str::<AgentDescriptor>(&json).unwrap(),
            descriptor
        );
    }
}
