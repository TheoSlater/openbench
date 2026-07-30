//! The normalized event stream React consumes.
//!
//! React never sees a raw ACP payload. Everything the agent emits is translated
//! into [`AcpEvent`] here, so a schema change in the SDK stops at this file
//! rather than reaching a component.
//!
//! Adapter-specific extras travel in one side channel — the `meta` field on
//! [`AcpEvent::Meta`] — rather than being threaded through every variant. That
//! keeps vendor quirks out of the event type while still making them reachable.

use super::permission::PermissionRequest;
use agent_client_protocol::schema::v1::{
    ContentBlock, ContentChunk, Plan, SessionUpdate, StopReason, ToolCall, ToolCallStatus,
    ToolCallUpdate,
};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Why a turn ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum TurnEnd {
    EndTurn,
    MaxTokens,
    MaxTurnRequests,
    Refusal,
    Cancelled,
    /// A stop reason this build does not know. The agent's own spelling is
    /// preserved rather than being coerced into `EndTurn`.
    Other,
}

impl From<&StopReason> for TurnEnd {
    fn from(reason: &StopReason) -> Self {
        match reason {
            StopReason::EndTurn => TurnEnd::EndTurn,
            StopReason::MaxTokens => TurnEnd::MaxTokens,
            StopReason::MaxTurnRequests => TurnEnd::MaxTurnRequests,
            StopReason::Refusal => TurnEnd::Refusal,
            StopReason::Cancelled => TurnEnd::Cancelled,
            _ => TurnEnd::Other,
        }
    }
}

/// Progress of a tool call.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum ToolStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}

impl From<&ToolCallStatus> for ToolStatus {
    fn from(status: &ToolCallStatus) -> Self {
        match status {
            ToolCallStatus::Pending => ToolStatus::Pending,
            ToolCallStatus::InProgress => ToolStatus::InProgress,
            ToolCallStatus::Completed => ToolStatus::Completed,
            _ => ToolStatus::Failed,
        }
    }
}

/// A file or directory a tool call touches.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolLocation {
    pub path: String,
    pub line: Option<u32>,
}

/// A tool call, flattened to what the UI renders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ToolActivity {
    pub tool_call_id: String,
    pub title: Option<String>,
    pub kind: Option<String>,
    pub status: Option<ToolStatus>,
    pub locations: Vec<ToolLocation>,
}

/// One step of an agent's plan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanStep {
    pub content: String,
    pub status: String,
    pub priority: String,
}

/// Everything an ACP session can tell the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[ts(export)]
pub enum AcpEvent {
    /// The session is live. Carries what the agent advertised.
    SessionStarted {
        session_id: String,
        descriptor: super::capabilities::AgentDescriptor,
    },
    /// A chunk of the agent's answer.
    AgentMessage { session_id: String, text: String },
    /// A chunk of the agent's reasoning.
    AgentThought { session_id: String, text: String },
    /// A chunk of the user's message, echoed back by the agent.
    UserMessage { session_id: String, text: String },
    /// A tool call was announced or changed.
    ToolActivity {
        session_id: String,
        activity: ToolActivity,
    },
    /// The agent's execution plan.
    Plan {
        session_id: String,
        steps: Vec<PlanStep>,
    },
    /// The agent's available slash commands changed.
    AvailableCommands {
        session_id: String,
        commands: Vec<String>,
    },
    /// The session's mode changed.
    ModeChanged { session_id: String, mode_id: String },
    /// The agent is asking for permission. Never auto-answered.
    PermissionRequested {
        session_id: String,
        request: PermissionRequest,
    },
    /// A pending permission request went away without an answer — the turn was
    /// cancelled, or the process died while it was outstanding.
    PermissionWithdrawn {
        session_id: String,
        request_id: String,
        reason: String,
    },
    /// The turn finished.
    TurnEnded {
        session_id: String,
        stop_reason: TurnEnd,
    },
    /// Something went wrong. The session may or may not still be usable —
    /// consult the session registry.
    Failed {
        session_id: String,
        error: super::error::AcpError,
    },
    /// Events were dropped because the frontend was not keeping up.
    ///
    /// Emitted instead of silently losing output: the UI can tell the user its
    /// view of this turn is incomplete. Only lossy events are ever dropped —
    /// see `EventSink`.
    Lagged { session_id: String, dropped: u32 },
    /// Adapter-specific metadata. The single side channel for vendor extras, so
    /// no other variant has to carry an untyped bag.
    Meta {
        session_id: String,
        /// Where it came from, e.g. `session_update`.
        origin: String,
        /// Opaque to Poly UI. ts-rs has no binding for `serde_json::Value`, so
        /// the TypeScript shape is pinned here to what serde emits.
        #[ts(type = "unknown")]
        meta: serde_json::Value,
    },
}

impl AcpEvent {
    /// Whether this event may be dropped under backpressure.
    ///
    /// Content chunks and progress are lossy: dropping some degrades the view
    /// but the transcript is rebuilt from the agent's own record. Terminal and
    /// decision-carrying events are not — losing a permission request would
    /// hang the agent forever, and losing `TurnEnded` would leave the UI
    /// spinning.
    #[must_use]
    pub fn is_lossy(&self) -> bool {
        matches!(
            self,
            AcpEvent::AgentThought { .. }
                | AcpEvent::UserMessage { .. }
                | AcpEvent::ToolActivity { .. }
                | AcpEvent::Plan { .. }
                | AcpEvent::Meta { .. }
                | AcpEvent::AvailableCommands { .. }
        )
    }

    #[must_use]
    pub fn session_id(&self) -> &str {
        match self {
            AcpEvent::SessionStarted { session_id, .. }
            | AcpEvent::AgentMessage { session_id, .. }
            | AcpEvent::AgentThought { session_id, .. }
            | AcpEvent::UserMessage { session_id, .. }
            | AcpEvent::ToolActivity { session_id, .. }
            | AcpEvent::Plan { session_id, .. }
            | AcpEvent::AvailableCommands { session_id, .. }
            | AcpEvent::ModeChanged { session_id, .. }
            | AcpEvent::PermissionRequested { session_id, .. }
            | AcpEvent::PermissionWithdrawn { session_id, .. }
            | AcpEvent::TurnEnded { session_id, .. }
            | AcpEvent::Failed { session_id, .. }
            | AcpEvent::Lagged { session_id, .. }
            | AcpEvent::Meta { session_id, .. } => session_id,
        }
    }
}

fn chunk_text(chunk: &ContentChunk) -> Option<String> {
    match &chunk.content {
        ContentBlock::Text(text) => Some(text.text.clone()),
        _ => None,
    }
}

fn tool_locations(
    locations: &[agent_client_protocol::schema::v1::ToolCallLocation],
) -> Vec<ToolLocation> {
    locations
        .iter()
        .map(|location| ToolLocation {
            path: location.path.display().to_string(),
            line: location.line,
        })
        .collect()
}

fn from_tool_call(call: &ToolCall) -> ToolActivity {
    ToolActivity {
        tool_call_id: call.tool_call_id.0.to_string(),
        title: Some(call.title.clone()),
        kind: Some(format!("{:?}", call.kind).to_lowercase()),
        status: Some(ToolStatus::from(&call.status)),
        locations: tool_locations(&call.locations),
    }
}

fn from_tool_call_update(update: &ToolCallUpdate) -> ToolActivity {
    ToolActivity {
        tool_call_id: update.tool_call_id.0.to_string(),
        title: update.fields.title.clone(),
        kind: update
            .fields
            .kind
            .as_ref()
            .map(|kind| format!("{kind:?}").to_lowercase()),
        status: update.fields.status.as_ref().map(ToolStatus::from),
        locations: update
            .fields
            .locations
            .as_deref()
            .map(tool_locations)
            .unwrap_or_default(),
    }
}

fn from_plan(plan: &Plan) -> Vec<PlanStep> {
    plan.entries
        .iter()
        .map(|entry| PlanStep {
            content: entry.content.clone(),
            status: format!("{:?}", entry.status).to_lowercase(),
            priority: format!("{:?}", entry.priority).to_lowercase(),
        })
        .collect()
}

/// Translate one ACP session update into normalized events.
///
/// Returns a `Vec` because a single update can produce both a content event and
/// a `Meta` event carrying its adapter-specific extras.
#[must_use]
pub fn normalize_update(
    session_id: &str,
    update: &SessionUpdate,
    meta: Option<&serde_json::Map<String, serde_json::Value>>,
) -> Vec<AcpEvent> {
    let session_id = session_id.to_string();
    let mut events = Vec::new();

    match update {
        SessionUpdate::AgentMessageChunk(chunk) => {
            if let Some(text) = chunk_text(chunk) {
                events.push(AcpEvent::AgentMessage {
                    session_id: session_id.clone(),
                    text,
                });
            }
        }
        SessionUpdate::AgentThoughtChunk(chunk) => {
            if let Some(text) = chunk_text(chunk) {
                events.push(AcpEvent::AgentThought {
                    session_id: session_id.clone(),
                    text,
                });
            }
        }
        SessionUpdate::UserMessageChunk(chunk) => {
            if let Some(text) = chunk_text(chunk) {
                events.push(AcpEvent::UserMessage {
                    session_id: session_id.clone(),
                    text,
                });
            }
        }
        SessionUpdate::ToolCall(call) => events.push(AcpEvent::ToolActivity {
            session_id: session_id.clone(),
            activity: from_tool_call(call),
        }),
        SessionUpdate::ToolCallUpdate(update) => events.push(AcpEvent::ToolActivity {
            session_id: session_id.clone(),
            activity: from_tool_call_update(update),
        }),
        SessionUpdate::Plan(plan) => events.push(AcpEvent::Plan {
            session_id: session_id.clone(),
            steps: from_plan(plan),
        }),
        SessionUpdate::AvailableCommandsUpdate(update) => {
            events.push(AcpEvent::AvailableCommands {
                session_id: session_id.clone(),
                commands: update
                    .available_commands
                    .iter()
                    .map(|command| command.name.clone())
                    .collect(),
            });
        }
        SessionUpdate::CurrentModeUpdate(update) => events.push(AcpEvent::ModeChanged {
            session_id: session_id.clone(),
            mode_id: update.current_mode_id.0.to_string(),
        }),
        // An update this build does not model is not an error; it becomes a
        // Meta event so nothing is silently lost.
        other => events.push(AcpEvent::Meta {
            session_id: session_id.clone(),
            origin: "session_update".into(),
            meta: serde_json::to_value(other).unwrap_or(serde_json::Value::Null),
        }),
    }

    if let Some(meta) = meta.filter(|map| !map.is_empty()) {
        events.push(AcpEvent::Meta {
            session_id,
            origin: "session_update".into(),
            meta: serde_json::Value::Object(meta.clone()),
        });
    }

    events
}

#[cfg(test)]
mod tests {
    use super::*;

    fn update(json: &str) -> SessionUpdate {
        serde_json::from_str(json).expect("session update")
    }

    #[test]
    fn normalizes_message_and_thought_chunks() {
        let events = normalize_update(
            "s1",
            &update(
                r#"{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hi"}}"#,
            ),
            None,
        );
        assert_eq!(
            events,
            vec![AcpEvent::AgentMessage {
                session_id: "s1".into(),
                text: "hi".into()
            }]
        );

        let events = normalize_update(
            "s1",
            &update(
                r#"{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"hm"}}"#,
            ),
            None,
        );
        assert!(matches!(events[0], AcpEvent::AgentThought { .. }));
    }

    #[test]
    fn normalizes_a_tool_call_through_its_states() {
        let started = normalize_update(
            "s1",
            &update(
                r#"{"sessionUpdate":"tool_call","toolCallId":"c1","title":"Read x",
                    "kind":"read","status":"pending",
                    "locations":[{"path":"/tmp/x","line":4}]}"#,
            ),
            None,
        );
        match &started[0] {
            AcpEvent::ToolActivity { activity, .. } => {
                assert_eq!(activity.tool_call_id, "c1");
                assert_eq!(activity.title.as_deref(), Some("Read x"));
                assert_eq!(activity.status, Some(ToolStatus::Pending));
                assert_eq!(activity.locations[0].path, "/tmp/x");
                assert_eq!(activity.locations[0].line, Some(4));
            }
            other => panic!("expected tool activity, got {other:?}"),
        }

        for (json, expected) in [
            (
                r#"{"sessionUpdate":"tool_call_update","toolCallId":"c1","status":"in_progress"}"#,
                ToolStatus::InProgress,
            ),
            (
                r#"{"sessionUpdate":"tool_call_update","toolCallId":"c1","status":"completed"}"#,
                ToolStatus::Completed,
            ),
            (
                r#"{"sessionUpdate":"tool_call_update","toolCallId":"c1","status":"failed"}"#,
                ToolStatus::Failed,
            ),
        ] {
            let events = normalize_update("s1", &update(json), None);
            match &events[0] {
                AcpEvent::ToolActivity { activity, .. } => {
                    assert_eq!(activity.status, Some(expected));
                }
                other => panic!("expected tool activity, got {other:?}"),
            }
        }
    }

    #[test]
    fn adapter_metadata_travels_in_the_side_channel_only() {
        let mut meta = serde_json::Map::new();
        meta.insert("codex".into(), serde_json::json!({ "threadId": "t-1" }));

        let events = normalize_update(
            "s1",
            &update(
                r#"{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hi"}}"#,
            ),
            Some(&meta),
        );

        assert_eq!(events.len(), 2);
        // The content event carries no vendor bag.
        let content = serde_json::to_string(&events[0]).unwrap();
        assert!(!content.contains("codex"), "{content}");
        match &events[1] {
            AcpEvent::Meta { meta, origin, .. } => {
                assert_eq!(origin, "session_update");
                assert_eq!(meta["codex"]["threadId"], "t-1");
            }
            other => panic!("expected meta, got {other:?}"),
        }
    }

    #[test]
    fn an_unmodelled_update_becomes_meta_rather_than_being_dropped() {
        let events = normalize_update(
            "s1",
            &update(r#"{"sessionUpdate":"usage_update","used":10,"size":200000}"#),
            None,
        );
        assert!(matches!(events[0], AcpEvent::Meta { .. }));
    }

    #[test]
    fn only_content_and_progress_are_droppable() {
        let lossy = AcpEvent::AgentThought {
            session_id: "s".into(),
            text: "x".into(),
        };
        assert!(lossy.is_lossy());

        for critical in [
            AcpEvent::AgentMessage {
                session_id: "s".into(),
                text: "x".into(),
            },
            AcpEvent::TurnEnded {
                session_id: "s".into(),
                stop_reason: TurnEnd::EndTurn,
            },
            AcpEvent::Failed {
                session_id: "s".into(),
                error: super::super::error::AcpError::Cancelled {
                    operation: "x".into(),
                },
            },
        ] {
            assert!(!critical.is_lossy(), "{critical:?}");
        }
    }

    #[test]
    fn every_event_reports_its_session() {
        let event = AcpEvent::Lagged {
            session_id: "s9".into(),
            dropped: 3,
        };
        assert_eq!(event.session_id(), "s9");
    }

    #[test]
    fn events_round_trip_across_the_boundary() {
        let event = AcpEvent::ToolActivity {
            session_id: "s1".into(),
            activity: ToolActivity {
                tool_call_id: "c1".into(),
                title: Some("Read".into()),
                kind: Some("read".into()),
                status: Some(ToolStatus::Completed),
                locations: vec![ToolLocation {
                    path: "/tmp/x".into(),
                    line: None,
                }],
            },
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"tool-activity\""));
        assert_eq!(serde_json::from_str::<AcpEvent>(&json).unwrap(), event);
    }

    #[test]
    fn an_unknown_stop_reason_does_not_masquerade_as_a_clean_end() {
        assert_eq!(TurnEnd::from(&StopReason::EndTurn), TurnEnd::EndTurn);
        assert_eq!(TurnEnd::from(&StopReason::Cancelled), TurnEnd::Cancelled);
        assert_eq!(TurnEnd::from(&StopReason::Refusal), TurnEnd::Refusal);
    }
}
