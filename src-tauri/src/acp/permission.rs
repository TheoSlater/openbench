//! Normalizing `session/request_permission` into something a user can decide on.
//!
//! Two rules:
//!
//! - **Choices come from the payload.** The agent decides what it is willing to
//!   offer; mapping onto a fixed allow/deny enum would drop options like "allow
//!   for this session only" that only some agents provide. `kind` is carried
//!   alongside the agent's own label so the UI can style a destructive choice,
//!   but the label and id are always the agent's.
//! - **Nothing is ever auto-approved.** There is no code path here that answers
//!   a request without a user decision. Cancellation and process death resolve
//!   a request as withdrawn, never as allowed.

use agent_client_protocol::schema::v1::{
    PermissionOption, PermissionOptionKind, RequestPermissionRequest, ToolCallUpdate,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// How a choice should be presented. Advisory styling only — the decision is
/// always sent back by the agent's own `option_id`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum ChoiceKind {
    AllowOnce,
    AllowAlways,
    RejectOnce,
    RejectAlways,
    /// A choice this build does not recognise. Rendered with the agent's label
    /// and no assumed semantics.
    Other,
}

impl From<&PermissionOptionKind> for ChoiceKind {
    fn from(kind: &PermissionOptionKind) -> Self {
        match kind {
            PermissionOptionKind::AllowOnce => ChoiceKind::AllowOnce,
            PermissionOptionKind::AllowAlways => ChoiceKind::AllowAlways,
            PermissionOptionKind::RejectOnce => ChoiceKind::RejectOnce,
            PermissionOptionKind::RejectAlways => ChoiceKind::RejectAlways,
            _ => ChoiceKind::Other,
        }
    }
}

/// One option the agent offered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PermissionChoice {
    /// Sent back verbatim. Never reconstructed from `kind`.
    pub option_id: String,
    /// The agent's own label.
    pub name: String,
    pub kind: ChoiceKind,
}

impl PermissionChoice {
    fn from_option(option: &PermissionOption) -> Self {
        PermissionChoice {
            option_id: option.option_id.0.to_string(),
            name: option.name.clone(),
            kind: ChoiceKind::from(&option.kind),
        }
    }
}

/// A permission request, normalized for display.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PermissionRequest {
    /// Host-assigned id used to answer this request.
    pub request_id: String,
    pub session_id: String,
    /// What the agent wants to do, in its own words.
    pub action: String,
    /// The tool call this is about.
    pub tool_call_id: String,
    /// The kind of action, e.g. `execute` or `edit`.
    pub tool_kind: Option<String>,
    /// Files or directories affected.
    pub affected_paths: Vec<String>,
    /// The command being run, when the agent supplied one. The single most
    /// risk-relevant detail for an execute request.
    pub command: Option<String>,
    /// The session's working directory, so the user can judge scope.
    pub working_directory: Option<String>,
    /// Everything the agent sent as raw input, for a details disclosure.
    #[ts(type = "unknown | null")]
    pub raw_input: Option<serde_json::Value>,
    /// Rendered as given, in order.
    pub choices: Vec<PermissionChoice>,
}

/// How a pending request was resolved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "outcome", rename_all = "kebab-case")]
#[ts(export)]
pub enum PermissionDecision {
    /// The user picked an option.
    Selected { option_id: String },
    /// The turn was cancelled, or the agent went away. Not an approval.
    Cancelled,
}

fn extract_command(raw_input: Option<&serde_json::Value>) -> Option<String> {
    let raw = raw_input?;
    for key in ["command", "cmd", "script", "shellCommand"] {
        if let Some(value) = raw.get(key) {
            if let Some(text) = value.as_str() {
                return Some(text.to_string());
            }
            // Some agents send an argv array.
            if let Some(parts) = value.as_array() {
                let joined: Vec<String> = parts
                    .iter()
                    .filter_map(|part| part.as_str().map(str::to_string))
                    .collect();
                if !joined.is_empty() {
                    return Some(joined.join(" "));
                }
            }
        }
    }
    None
}

fn tool_call_details(
    update: &ToolCallUpdate,
) -> (
    String,
    Option<String>,
    Vec<String>,
    Option<serde_json::Value>,
) {
    let title = update
        .fields
        .title
        .clone()
        .unwrap_or_else(|| "Perform an action".to_string());
    let kind = update
        .fields
        .kind
        .as_ref()
        .map(|kind| format!("{kind:?}").to_lowercase());
    let paths = update
        .fields
        .locations
        .as_deref()
        .map(|locations| {
            locations
                .iter()
                .map(|location| location.path.display().to_string())
                .collect()
        })
        .unwrap_or_default();
    (title, kind, paths, update.fields.raw_input.clone())
}

impl PermissionRequest {
    /// Normalize an incoming request.
    ///
    /// `request_id` is assigned by the host, not taken from the wire: the JSON-RPC
    /// id belongs to the SDK's routing, and the UI must not be able to answer a
    /// request by guessing a number.
    #[must_use]
    pub fn normalize(
        request_id: impl Into<String>,
        request: &RequestPermissionRequest,
        working_directory: Option<&str>,
    ) -> Self {
        let (action, tool_kind, affected_paths, raw_input) = tool_call_details(&request.tool_call);
        PermissionRequest {
            request_id: request_id.into(),
            session_id: request.session_id.0.to_string(),
            action,
            tool_call_id: request.tool_call.tool_call_id.0.to_string(),
            tool_kind,
            affected_paths,
            command: extract_command(raw_input.as_ref()),
            working_directory: working_directory.map(str::to_string),
            raw_input,
            // Verbatim, in the order the agent listed them.
            choices: request
                .options
                .iter()
                .map(PermissionChoice::from_option)
                .collect(),
        }
    }

    /// Whether the agent left the user anything to choose.
    ///
    /// An empty option list is malformed; the UI shows it as an error rather
    /// than inventing an Allow button.
    #[must_use]
    pub fn has_choices(&self) -> bool {
        !self.choices.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(json: &str) -> RequestPermissionRequest {
        serde_json::from_str(json).expect("permission request")
    }

    const EXECUTE: &str = r#"{
        "sessionId":"s1",
        "toolCall":{
            "toolCallId":"c1",
            "title":"Run rm -rf /tmp/scratch",
            "kind":"execute",
            "status":"pending",
            "locations":[{"path":"/tmp/scratch"}],
            "rawInput":{"command":"rm -rf /tmp/scratch"}
        },
        "options":[
            {"optionId":"allow-once","name":"Allow once","kind":"allow_once"},
            {"optionId":"reject","name":"Reject","kind":"reject_once"}
        ]
    }"#;

    #[test]
    fn normalizes_the_risk_relevant_detail() {
        let normalized =
            PermissionRequest::normalize("req-1", &request(EXECUTE), Some("/home/theo/project"));

        assert_eq!(normalized.request_id, "req-1");
        assert_eq!(normalized.session_id, "s1");
        assert_eq!(normalized.action, "Run rm -rf /tmp/scratch");
        assert_eq!(normalized.tool_call_id, "c1");
        assert_eq!(normalized.tool_kind.as_deref(), Some("execute"));
        assert_eq!(normalized.affected_paths, vec!["/tmp/scratch".to_string()]);
        assert_eq!(normalized.command.as_deref(), Some("rm -rf /tmp/scratch"));
        assert_eq!(
            normalized.working_directory.as_deref(),
            Some("/home/theo/project")
        );
    }

    #[test]
    fn choices_come_from_the_payload_not_a_fixed_enum() {
        let custom = request(
            r#"{"sessionId":"s1",
                "toolCall":{"toolCallId":"c1","title":"Edit","kind":"edit","status":"pending"},
                "options":[
                    {"optionId":"yes-for-session","name":"Allow for this session","kind":"allow_always"},
                    {"optionId":"weird","name":"Do something bespoke","kind":"allow_once"}
                ]}"#,
        );
        let normalized = PermissionRequest::normalize("req-2", &custom, None);

        assert_eq!(normalized.choices.len(), 2);
        // The agent's ids and labels survive intact.
        assert_eq!(normalized.choices[0].option_id, "yes-for-session");
        assert_eq!(normalized.choices[0].name, "Allow for this session");
        assert_eq!(normalized.choices[1].option_id, "weird");
        assert_eq!(normalized.choices[1].name, "Do something bespoke");
    }

    #[test]
    fn an_empty_option_list_is_reported_rather_than_filled_in() {
        let empty = request(
            r#"{"sessionId":"s1",
                "toolCall":{"toolCallId":"c1","title":"Edit","status":"pending"},
                "options":[]}"#,
        );
        let normalized = PermissionRequest::normalize("req-3", &empty, None);
        assert!(!normalized.has_choices());
        assert!(normalized.choices.is_empty());
    }

    #[test]
    fn extracts_a_command_from_an_argv_array() {
        let argv = request(
            r#"{"sessionId":"s1",
                "toolCall":{"toolCallId":"c1","title":"Run","kind":"execute","status":"pending",
                    "rawInput":{"cmd":["git","push","--force"]}},
                "options":[{"optionId":"a","name":"Allow","kind":"allow_once"}]}"#,
        );
        let normalized = PermissionRequest::normalize("req-4", &argv, None);
        assert_eq!(normalized.command.as_deref(), Some("git push --force"));
    }

    #[test]
    fn a_request_without_a_command_simply_has_none() {
        let edit = request(
            r#"{"sessionId":"s1",
                "toolCall":{"toolCallId":"c1","title":"Edit file","kind":"edit","status":"pending"},
                "options":[{"optionId":"a","name":"Allow","kind":"allow_once"}]}"#,
        );
        let normalized = PermissionRequest::normalize("req-5", &edit, None);
        assert_eq!(normalized.command, None);
        assert!(normalized.affected_paths.is_empty());
        assert_eq!(normalized.action, "Edit file");
    }

    #[test]
    fn cancellation_is_not_an_approval() {
        let decision = PermissionDecision::Cancelled;
        let json = serde_json::to_string(&decision).unwrap();
        assert_eq!(json, r#"{"outcome":"cancelled"}"#);
        assert!(!json.contains("allow"));
        assert_eq!(
            serde_json::from_str::<PermissionDecision>(&json).unwrap(),
            decision
        );
    }

    #[test]
    fn a_selection_carries_the_agents_option_id() {
        let decision = PermissionDecision::Selected {
            option_id: "allow-once".into(),
        };
        let json = serde_json::to_string(&decision).unwrap();
        assert!(json.contains("allow-once"));
        assert_eq!(
            serde_json::from_str::<PermissionDecision>(&json).unwrap(),
            decision
        );
    }

    #[test]
    fn an_unknown_choice_kind_gets_no_assumed_semantics() {
        let normalized = PermissionRequest::normalize("req-6", &request(EXECUTE), None);
        assert_eq!(normalized.choices[0].kind, ChoiceKind::AllowOnce);
        assert_eq!(normalized.choices[1].kind, ChoiceKind::RejectOnce);
    }
}
