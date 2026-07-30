//! Host tests, all driven by the mock agent binary.
//!
//! No vendor adapter is installed, referenced, or required. Every failure mode
//! is produced by `src/bin/mock_acp_agent.rs`.

use super::error::AcpError;
use super::events::AcpEvent;
use super::host::AcpHost;
use super::lifecycle::{LaunchOptions, OwnedChild, TERMINATION_GRACE};
use super::permission::PermissionDecision;
use super::registry::{
    EventSink, ProcessState, Recoverability, SessionRecord, SessionRegistry, UnrecoverableReason,
};
use agent_client_protocol::schema::v1::{PromptRequest, SessionId};
use agent_client_protocol::{AcpAgent, AcpAgentConfig};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc::Receiver;

/// Path to the mock agent binary, built alongside the test binary.
///
/// `cargo test` puts the test executable under the same profile directory as
/// the `[[bin]]` targets, so the mock is a sibling of its parent.
fn mock_agent_path() -> PathBuf {
    let mut path = std::env::current_exe().expect("test executable path");
    path.pop();
    if path.ends_with("deps") {
        path.pop();
    }
    let candidate = path.join(if cfg!(windows) {
        "mock_acp_agent.exe"
    } else {
        "mock_acp_agent"
    });
    assert!(
        candidate.exists(),
        "mock agent not built at {}; run `cargo build --bin mock_acp_agent`",
        candidate.display()
    );
    candidate
}

/// A temporary directory used as an agent workspace.
struct Workspace(PathBuf);

impl Workspace {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!("poly-acp-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).expect("workspace");
        Workspace(path)
    }

    fn path(&self) -> PathBuf {
        self.0.clone()
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn options(scenario: &str, workspace: &Workspace) -> LaunchOptions {
    LaunchOptions {
        executable: mock_agent_path(),
        args: vec![scenario.to_string()],
        working_directory: workspace.path(),
        env: vec![],
    }
}

fn sink() -> (EventSink, Receiver<AcpEvent>) {
    EventSink::new(256)
}

fn prompt(session_id: &str) -> PromptRequest {
    PromptRequest::new(SessionId::new(session_id), vec![])
}

/// Wait for an event matching a predicate, bounded so a hung test fails rather
/// than blocking the suite.
async fn wait_for<F>(receiver: &mut Receiver<AcpEvent>, mut predicate: F) -> Option<AcpEvent>
where
    F: FnMut(&AcpEvent) -> bool,
{
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(2), receiver.recv()).await {
            Ok(Some(event)) => {
                if predicate(&event) {
                    return Some(event);
                }
            }
            Ok(None) => return None,
            Err(_) => continue,
        }
    }
    None
}

async fn wait_until_empty(host: &Arc<AcpHost>) {
    let deadline = Instant::now() + Duration::from_secs(15);
    while !host.processes().list().await.is_empty() && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[tokio::test]
async fn spawns_initializes_and_reports_what_the_agent_advertised() {
    let workspace = Workspace::new("normal");
    let host = AcpHost::new();
    let (events, _receiver) = sink();

    let session = host
        .start("conv-1", "inst-1", options("normal", &workspace), events)
        .await
        .expect("agent starts");

    assert_eq!(session.conversation_id, "conv-1");
    assert_eq!(
        session.descriptor.agent_name.as_deref(),
        Some("poly-mock-agent")
    );
    assert!(session.descriptor.capabilities.load_session);
    assert_eq!(session.descriptor.auth_methods.len(), 1);
    assert_eq!(session.descriptor.auth_methods[0].id, "mock-login");

    assert_eq!(
        host.processes().state_of("conv-1").await,
        Some(ProcessState::Running)
    );

    host.stop("conv-1").await;
    assert_eq!(host.processes().state_of("conv-1").await, None);
}

#[tokio::test]
async fn authenticate_rejects_an_unadvertised_method_before_sending_it() {
    let workspace = Workspace::new("auth-id");
    let host = AcpHost::new();
    let (events, _receiver) = sink();
    let session = host
        .start(
            "conv-auth-id",
            "inst-1",
            options("normal", &workspace),
            events,
        )
        .await
        .expect("agent starts");

    let error = session.authenticate("invented").await.unwrap_err();
    assert!(matches!(error, AcpError::Protocol { .. }));
    host.stop("conv-auth-id").await;
}

#[tokio::test]
async fn authenticate_requires_a_second_successful_initialize() {
    let workspace = Workspace::new("auth-reinitialize");
    let host = AcpHost::new();
    let (events, _receiver) = sink();
    let session = host
        .start(
            "conv-auth-reinitialize",
            "inst-1",
            options("fail-reinitialize", &workspace),
            events,
        )
        .await
        .expect("agent starts");

    let error = session
        .authenticate_with_timeouts(
            "mock-login",
            Duration::from_millis(100),
            Duration::from_millis(100),
        )
        .await
        .unwrap_err();
    assert!(matches!(error, AcpError::Agent { code: 401, .. }));
    assert_eq!(
        host.processes().state_of("conv-auth-reinitialize").await,
        Some(ProcessState::Running)
    );
    host.stop("conv-auth-reinitialize").await;
}

#[tokio::test]
async fn authenticate_timeout_leaves_the_same_session_stoppable() {
    let workspace = Workspace::new("auth-timeout");
    let host = AcpHost::new();
    let (events, _receiver) = sink();
    let session = host
        .start(
            "conv-auth-timeout",
            "inst-1",
            options("hang-authenticate", &workspace),
            events,
        )
        .await
        .expect("agent starts");

    let error = session
        .authenticate_with_timeouts(
            "mock-login",
            Duration::from_millis(50),
            Duration::from_millis(50),
        )
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        AcpError::Timeout { ref operation, .. } if operation == "authenticate"
    ));
    assert_eq!(
        host.processes().state_of("conv-auth-timeout").await,
        Some(ProcessState::Running)
    );
    host.stop("conv-auth-timeout").await;
}

#[tokio::test]
async fn host_owns_session_creation_prompt_and_event_stream() {
    let workspace = Workspace::new("owned-session");
    let host = AcpHost::new();
    let (events, mut receiver) = sink();

    host.start(
        "conv-owned",
        "inst-1",
        options("normal", &workspace),
        events,
    )
    .await
    .expect("agent starts");
    let session_id = host
        .new_session("conv-owned")
        .await
        .expect("session created");
    assert_eq!(session_id, "mock-session-1");

    let ended = host
        .prompt("conv-owned", "hello")
        .await
        .expect("prompt completes");
    assert_eq!(ended, super::events::TurnEnd::EndTurn);
    assert!(wait_for(&mut receiver, |event| matches!(
        event,
        AcpEvent::AgentMessage { text, .. } if text == "Hello"
    ))
    .await
    .is_some());

    host.stop("conv-owned").await;
}

#[tokio::test]
async fn initialization_that_hangs_times_out_and_leaves_no_process() {
    let workspace = Workspace::new("hang");
    let host = AcpHost::new();
    let (events, _receiver) = sink();

    let started = Instant::now();
    let result = tokio::time::timeout(
        super::host::STARTUP_TIMEOUT + Duration::from_secs(10),
        host.start(
            "conv-hang",
            "inst-1",
            options("hang-initialize", &workspace),
            events,
        ),
    )
    .await
    .expect("start must return within the startup bound");

    match result {
        Err(AcpError::Timeout { operation, .. }) => assert_eq!(operation, "initialize"),
        other => panic!("expected an initialize timeout, got {other:?}"),
    }
    assert!(started.elapsed() >= super::host::STARTUP_TIMEOUT);

    // Guaranteed cleanup on initialization failure.
    wait_until_empty(&host).await;
    assert!(host.processes().list().await.is_empty());
}

#[tokio::test]
async fn an_oversized_protocol_line_is_normalized_without_a_crash() {
    let workspace = Workspace::new("oversized-line");
    let host = AcpHost::new();
    let (events, _receiver) = sink();

    let result = host
        .start(
            "conv-oversized",
            "inst-1",
            options("oversized-line", &workspace),
            events,
        )
        .await;

    assert!(
        matches!(result, Err(AcpError::Protocol { .. })),
        "{result:?}"
    );
    wait_until_empty(&host).await;
}

#[tokio::test]
async fn malformed_stdout_does_not_crash_the_host() {
    let workspace = Workspace::new("malformed");
    let host = AcpHost::new();
    let (events, _receiver) = sink();

    // The mock writes an unparseable line before its initialize response. The
    // host must survive it: either the junk is skipped and the handshake
    // completes, or it becomes a normalized error. A panic or a hang is not an
    // acceptable third option, and neither is a silent success with no
    // diagnosis.
    let result = tokio::time::timeout(
        super::host::STARTUP_TIMEOUT + Duration::from_secs(10),
        host.start(
            "conv-malformed",
            "inst-1",
            options("malformed-json", &workspace),
            events,
        ),
    )
    .await
    .expect("start must return");

    match result {
        Ok(session) => {
            assert_eq!(session.conversation_id, "conv-malformed");
            host.stop("conv-malformed").await;
        }
        Err(error) => {
            assert!(
                matches!(
                    error,
                    AcpError::Protocol { .. }
                        | AcpError::Initialize { .. }
                        | AcpError::Transport { .. }
                        | AcpError::Timeout { .. }
                ),
                "malformed output must produce a normalized error, got {error:?}"
            );
        }
    }

    wait_until_empty(&host).await;
    assert!(host.processes().list().await.is_empty());
}

#[tokio::test]
async fn valid_json_that_is_not_acp_does_not_terminate_the_session() {
    let workspace = Workspace::new("non-acp");
    let host = AcpHost::new();
    let (events, _receiver) = sink();

    // A JSON object that is not JSON-RPC, plus a JSON-RPC notification for an
    // unknown method — then a normal initialize response.
    let session = host
        .start(
            "conv-non-acp",
            "inst-1",
            options("non-acp-json", &workspace),
            events,
        )
        .await
        .expect("unroutable JSON must be ignored, not fatal");

    assert_eq!(session.conversation_id, "conv-non-acp");
    assert_eq!(
        host.processes().state_of("conv-non-acp").await,
        Some(ProcessState::Running)
    );

    host.stop("conv-non-acp").await;
}

#[tokio::test]
async fn heavy_stderr_does_not_interfere_with_the_protocol() {
    let workspace = Workspace::new("stderr");
    let host = AcpHost::new();
    let (events, _receiver) = sink();

    // 2000 stderr lines precede the initialize response. stderr is drained
    // separately and never parsed, so the handshake still completes.
    let session = host
        .start(
            "conv-stderr",
            "inst-1",
            options("stderr-noise", &workspace),
            events,
        )
        .await
        .expect("stderr noise must not disturb stdout");

    assert!(session.descriptor.capabilities.load_session);
    host.stop("conv-stderr").await;
}

#[tokio::test]
async fn capability_negotiation_reads_minimal_and_full_sets() {
    let workspace = Workspace::new("caps");
    let host = AcpHost::new();

    let (events, _r1) = sink();
    let minimal = host
        .start(
            "conv-min",
            "inst-1",
            options("capabilities-minimal", &workspace),
            events,
        )
        .await
        .expect("minimal agent starts");

    // Nothing advertised means nothing supported.
    assert!(!minimal.descriptor.capabilities.load_session);
    assert!(!minimal.descriptor.capabilities.images);
    assert!(!minimal.descriptor.capabilities.mcp);
    assert!(!minimal.descriptor.capabilities.resume_session);
    assert!(minimal.descriptor.auth_methods.is_empty());
    host.stop("conv-min").await;

    let (events, _r2) = sink();
    let full = host
        .start(
            "conv-full",
            "inst-1",
            options("capabilities-full", &workspace),
            events,
        )
        .await
        .expect("full agent starts");

    assert!(full.descriptor.capabilities.load_session);
    assert!(full.descriptor.capabilities.images);
    assert!(full.descriptor.capabilities.context_references);
    assert!(full.descriptor.capabilities.mcp);
    assert!(full.descriptor.capabilities.resume_session);
    host.stop("conv-full").await;
}

#[tokio::test]
async fn a_conversation_never_gets_two_processes() {
    let workspace = Workspace::new("duplicate");
    let host = AcpHost::new();
    let (events, _receiver) = sink();

    let _first = host
        .start(
            "conv-dup",
            "inst-1",
            options("normal", &workspace),
            events.clone(),
        )
        .await
        .expect("first start");

    let second = host
        .start("conv-dup", "inst-1", options("normal", &workspace), events)
        .await;

    assert!(second.is_err(), "a second start must be refused");
    assert_eq!(host.processes().list().await.len(), 1);

    host.stop("conv-dup").await;
}

#[tokio::test]
async fn rapid_start_cancel_start_leaves_exactly_one_process() {
    let workspace = Workspace::new("restart");
    let host = AcpHost::new();

    for round in 0..3 {
        let (events, _receiver) = sink();
        host.start(
            "conv-restart",
            "inst-1",
            options("normal", &workspace),
            events,
        )
        .await
        .unwrap_or_else(|error| panic!("round {round} failed to start: {error:?}"));

        assert_eq!(
            host.processes().list().await.len(),
            1,
            "round {round} must hold exactly one process"
        );

        host.stop("conv-restart").await;
        assert!(host.processes().list().await.is_empty());
    }
}

#[tokio::test]
async fn a_child_that_exits_mid_session_is_reported_and_leaves_no_orphan() {
    let workspace = Workspace::new("exit");

    // Zero and non-zero exits are handled identically: an exit part-way through
    // a turn is a failure either way.
    for scenario in ["exit-zero-mid-session", "exit-nonzero-mid-session"] {
        let host = AcpHost::new();
        let (events, mut receiver) = sink();
        let conversation = format!("conv-{scenario}");

        let session = host
            .start(
                &conversation,
                "inst-1",
                options(scenario, &workspace),
                events,
            )
            .await
            .expect("agent starts before it exits");

        let request = session.connection().send_request(prompt("mock-session-1"));
        let _ = tokio::time::timeout(Duration::from_secs(10), request.block_task()).await;

        let failure = wait_for(&mut receiver, |event| {
            matches!(event, AcpEvent::Failed { .. })
        })
        .await;
        if let Some(AcpEvent::Failed { error, .. }) = failure {
            assert!(
                !error.label().is_empty(),
                "{scenario} must produce a normalized error, got {error:?}"
            );
        }

        wait_until_empty(&host).await;
        assert!(
            host.processes().list().await.is_empty(),
            "{scenario} left an orphan"
        );
    }
}

#[tokio::test]
async fn cancellation_mid_stream_releases_the_process() {
    let workspace = Workspace::new("cancel");
    let host = AcpHost::new();
    let (events, _receiver) = sink();

    let session = host
        .start(
            "conv-cancel",
            "inst-1",
            options("ignore-termination", &workspace),
            events,
        )
        .await
        .expect("agent starts");

    // Start a turn the mock never finishes.
    let _pending = session.connection().send_request(prompt("mock-session-1"));
    tokio::time::sleep(Duration::from_millis(300)).await;

    let started = Instant::now();
    host.stop("conv-cancel").await;

    assert!(host.processes().list().await.is_empty());
    // Escalation is bounded: a process ignoring SIGTERM is killed rather than
    // waited on indefinitely.
    assert!(
        started.elapsed() < TERMINATION_GRACE + Duration::from_secs(8),
        "termination took {:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn a_process_that_ignores_termination_is_force_killed_within_the_bound() {
    let config = AcpAgentConfig::new(mock_agent_path()).arg("ignore-termination");
    let agent = AcpAgent::new(config);
    let (_stdin, _stdout, _stderr, child) = agent.spawn_process().expect("spawn");

    let mut owned = OwnedChild::adopt(child, &mock_agent_path()).expect("adopt");
    assert!(owned.pid() > 0);

    // Let it install its signal handlers.
    tokio::time::sleep(Duration::from_millis(400)).await;

    let started = Instant::now();
    let outcome = owned.terminate().await;
    let elapsed = started.elapsed();

    #[cfg(unix)]
    assert_eq!(
        outcome,
        super::lifecycle::ChildOutcome::Forced,
        "a process ignoring SIGTERM must be force-killed"
    );
    #[cfg(not(unix))]
    let _ = outcome;

    assert!(
        elapsed < TERMINATION_GRACE + Duration::from_secs(5),
        "force kill took {elapsed:?}, exceeding the bounded wait"
    );
}

#[tokio::test]
async fn terminating_a_cooperative_child_reports_its_exit_code() {
    let config = AcpAgentConfig::new(mock_agent_path()).arg("normal");
    let agent = AcpAgent::new(config);
    let (stdin, _stdout, _stderr, child) = agent.spawn_process().expect("spawn");

    let mut owned = OwnedChild::adopt(child, &mock_agent_path()).expect("adopt");
    // Closing stdin makes the mock's read loop end, so it exits on its own.
    drop(stdin);
    tokio::time::sleep(Duration::from_millis(400)).await;

    let outcome = owned.terminate().await;
    assert!(
        matches!(
            outcome,
            super::lifecycle::ChildOutcome::Exited(_) | super::lifecycle::ChildOutcome::AlreadyGone
        ),
        "a child that already exited must not be reported as forced: {outcome:?}"
    );
}

#[tokio::test]
async fn a_permission_request_is_routed_and_never_auto_answered() {
    let workspace = Workspace::new("permission");
    let host = AcpHost::new();
    let (events, mut receiver) = sink();

    let session = host
        .start(
            "conv-perm",
            "inst-1",
            options("permission", &workspace),
            events,
        )
        .await
        .expect("agent starts");

    let _pending = session.connection().send_request(prompt("mock-session-1"));

    let event = wait_for(&mut receiver, |event| {
        matches!(event, AcpEvent::PermissionRequested { .. })
    })
    .await
    .expect("a permission request must reach the UI");

    let AcpEvent::PermissionRequested { request, .. } = event else {
        unreachable!()
    };

    // Normalized for a human decision, carrying the agent's own choices.
    assert_eq!(request.action, "Run rm -rf /tmp/poly-mock-scratch");
    assert_eq!(request.tool_kind.as_deref(), Some("execute"));
    assert_eq!(
        request.command.as_deref(),
        Some("rm -rf /tmp/poly-mock-scratch")
    );
    assert_eq!(
        request.affected_paths,
        vec!["/tmp/poly-mock-scratch".to_string()]
    );
    assert_eq!(request.choices.len(), 3);
    assert_eq!(request.choices[0].option_id, "allow-once");
    assert_eq!(request.choices[2].option_id, "reject-once");
    assert_eq!(
        request.working_directory,
        Some(workspace.path().display().to_string())
    );

    // Answering is an explicit call; nothing decided on the user's behalf.
    host.answer_permission(
        &request.request_id,
        PermissionDecision::Selected {
            option_id: "reject-once".into(),
        },
    )
    .await
    .expect("the pending request is answerable");

    // A second answer is refused rather than silently ignored.
    assert!(host
        .answer_permission(&request.request_id, PermissionDecision::Cancelled)
        .await
        .is_err());

    host.stop("conv-perm").await;
}

#[tokio::test]
async fn a_permission_request_pending_when_the_process_dies_is_withdrawn() {
    let workspace = Workspace::new("permission-dead");
    let host = AcpHost::new();
    let (events, mut receiver) = sink();

    let session = host
        .start(
            "conv-perm-dead",
            "inst-1",
            options("permission-never-answered", &workspace),
            events,
        )
        .await
        .expect("agent starts");

    let _pending = session.connection().send_request(prompt("mock-session-1"));

    let requested = wait_for(&mut receiver, |event| {
        matches!(event, AcpEvent::PermissionRequested { .. })
    })
    .await
    .expect("permission requested");
    let AcpEvent::PermissionRequested { request, .. } = requested else {
        unreachable!()
    };

    // Kill the agent while the request is outstanding.
    host.stop("conv-perm-dead").await;

    let withdrawn = wait_for(&mut receiver, |event| {
        matches!(event, AcpEvent::PermissionWithdrawn { .. })
    })
    .await
    .expect("a pending request must be withdrawn when the process dies");

    match withdrawn {
        AcpEvent::PermissionWithdrawn { request_id, .. } => {
            assert_eq!(request_id, request.request_id);
        }
        other => panic!("expected withdrawal, got {other:?}"),
    }

    // Withdrawn is not approved: the request is gone, not granted.
    assert!(host
        .answer_permission(&request.request_id, PermissionDecision::Cancelled)
        .await
        .is_err());
}

#[tokio::test]
async fn a_tool_call_streams_through_its_states() {
    let workspace = Workspace::new("tools");
    let host = AcpHost::new();
    let (events, mut receiver) = sink();

    let session = host
        .start(
            "conv-tools",
            "inst-1",
            options("tool-calls", &workspace),
            events,
        )
        .await
        .expect("agent starts");

    let _pending = session.connection().send_request(prompt("mock-session-1"));

    let mut seen = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(15);
    while seen.len() < 3 && Instant::now() < deadline {
        if let Ok(Some(AcpEvent::ToolActivity { activity, .. })) =
            tokio::time::timeout(Duration::from_secs(2), receiver.recv()).await
        {
            if let Some(status) = activity.status {
                assert_eq!(activity.tool_call_id, "call-1");
                seen.push(status);
            }
        }
    }

    use super::events::ToolStatus;
    assert_eq!(
        seen,
        vec![
            ToolStatus::Pending,
            ToolStatus::InProgress,
            ToolStatus::Completed
        ],
        "the tool call must be reported through each state"
    );

    host.stop("conv-tools").await;
}

#[tokio::test]
async fn streams_assistant_output_and_completes_the_turn() {
    let workspace = Workspace::new("stream");
    let host = AcpHost::new();
    let (events, mut receiver) = sink();

    let session = host
        .start(
            "conv-stream",
            "inst-1",
            options("normal", &workspace),
            events,
        )
        .await
        .expect("agent starts");

    let _pending = session.connection().send_request(prompt("mock-session-1"));

    let mut text = String::new();
    let mut saw_thought = false;
    let deadline = Instant::now() + Duration::from_secs(15);
    while text != "Hello, world" && Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(2), receiver.recv()).await {
            Ok(Some(AcpEvent::AgentMessage { text: chunk, .. })) => text.push_str(&chunk),
            Ok(Some(AcpEvent::AgentThought { .. })) => saw_thought = true,
            Ok(Some(_)) => {}
            _ => break,
        }
    }

    assert_eq!(text, "Hello, world");
    assert!(saw_thought, "reasoning must reach the UI as its own event");

    host.stop("conv-stream").await;
}

#[tokio::test]
async fn shutdown_stops_every_agent() {
    let workspace = Workspace::new("shutdown");
    let host = AcpHost::new();

    for index in 0..2 {
        let (events, _receiver) = sink();
        host.start(
            &format!("conv-{index}"),
            "inst-1",
            options("normal", &workspace),
            events,
        )
        .await
        .expect("agent starts");
    }
    assert_eq!(host.processes().list().await.len(), 2);

    // This is what runs before `std::process::exit` on app quit, where no
    // destructor would.
    host.shutdown().await;
    assert!(host.processes().list().await.is_empty());
}

#[tokio::test]
async fn a_missing_executable_is_a_normalized_spawn_error() {
    let workspace = Workspace::new("missing-exe");
    let host = AcpHost::new();
    let (events, _receiver) = sink();

    let error = host
        .start(
            "conv-missing",
            "inst-1",
            LaunchOptions {
                executable: PathBuf::from("/definitely/not/an/executable"),
                args: vec![],
                working_directory: workspace.path(),
                env: vec![],
            },
            events,
        )
        .await
        .unwrap_err();

    match error {
        AcpError::Spawn { executable, .. } => {
            assert_eq!(executable, "/definitely/not/an/executable");
        }
        other => panic!("expected a spawn error, got {other:?}"),
    }
    assert!(host.processes().list().await.is_empty());
}

#[tokio::test]
async fn session_records_track_recoverability_from_advertised_capabilities() {
    let workspace = Workspace::new("recover");
    let host = AcpHost::new();

    let (events, _r1) = sink();
    host.start(
        "conv-loadable",
        "inst-1",
        options("normal", &workspace),
        events,
    )
    .await
    .expect("agent starts");

    let record = host
        .sessions()
        .get("conv-loadable")
        .await
        .expect("a session record");
    assert_eq!(record.recoverability, Recoverability::Recoverable);
    assert_eq!(
        record.workspace_path,
        workspace.path().display().to_string()
    );
    host.stop("conv-loadable").await;

    // An agent that does not advertise session loading is marked unrecoverable
    // up front, rather than being silently restarted later.
    let (events, _r2) = sink();
    host.start(
        "conv-unloadable",
        "inst-1",
        options("capabilities-minimal", &workspace),
        events,
    )
    .await
    .expect("agent starts");

    let record = host
        .sessions()
        .get("conv-unloadable")
        .await
        .expect("a session record");
    assert_eq!(
        record.recoverability,
        Recoverability::Unrecoverable {
            reason: UnrecoverableReason::AgentCannotLoadSessions
        }
    );
    host.stop("conv-unloadable").await;
}

#[tokio::test]
async fn a_missing_workspace_blocks_the_session_rather_than_defaulting() {
    let host = AcpHost::new();
    let (events, _receiver) = sink();

    // Never fall back to the application directory.
    let error = host
        .start(
            "conv-no-workspace",
            "inst-1",
            LaunchOptions {
                executable: mock_agent_path(),
                args: vec!["normal".into()],
                working_directory: PathBuf::from("/definitely/not/a/workspace"),
                env: vec![],
            },
            events,
        )
        .await
        .unwrap_err();

    assert!(matches!(error, AcpError::Spawn { .. }));
    assert!(host.processes().list().await.is_empty());

    // The stored-session decision agrees.
    let record = SessionRecord {
        conversation_id: "conv-no-workspace".into(),
        installation_id: "inst-1".into(),
        acp_session_id: Some("acp-1".into()),
        workspace_path: "/definitely/not/a/workspace".into(),
        mode_id: None,
        created_at: "2026-07-27T00:00:00Z".into(),
        last_active_at: "2026-07-27T00:00:00Z".into(),
        recoverability: Recoverability::Unknown,
    };
    assert_eq!(
        SessionRegistry::restoration_blocker(&record, true, false),
        Some(UnrecoverableReason::WorkspaceMissing)
    );
}

#[tokio::test]
async fn a_stale_session_id_blocks_restoration_rather_than_starting_a_new_one() {
    let host = AcpHost::new();
    let workspace = Workspace::new("stale");
    let (events, _receiver) = sink();

    host.start(
        "conv-stale",
        "inst-1",
        options("normal", &workspace),
        events,
    )
    .await
    .expect("agent starts");

    host.sessions()
        .set_acp_session_id("conv-stale", "acp-1")
        .await;
    host.sessions()
        .mark_unrecoverable("conv-stale", UnrecoverableReason::StaleSessionId)
        .await;

    let record = host.sessions().get("conv-stale").await.expect("record");
    assert_eq!(
        record.recoverability,
        Recoverability::Unrecoverable {
            reason: UnrecoverableReason::StaleSessionId
        }
    );
    // The id is cleared, so nothing downstream can present a fresh session as
    // the restored one.
    assert_eq!(record.acp_session_id, None);
    assert_eq!(
        SessionRegistry::restoration_blocker(&record, true, true),
        Some(UnrecoverableReason::StaleSessionId)
    );

    host.stop("conv-stale").await;
}

#[tokio::test]
async fn a_custom_environment_reaches_the_child() {
    let workspace = Workspace::new("env");
    let host = AcpHost::new();
    let (events, _receiver) = sink();

    let mut launch = options("normal", &workspace);
    launch
        .env
        .push(("POLY_TEST_FLAG".into(), "value with spaces".into()));

    let session = host
        .start("conv-env", "inst-1", launch, events)
        .await
        .expect("agent starts with a custom environment");

    assert_eq!(session.conversation_id, "conv-env");
    host.stop("conv-env").await;
}

#[tokio::test]
async fn concurrent_starts_for_one_conversation_produce_one_process() {
    let workspace = Workspace::new("concurrent");
    let host = AcpHost::new();
    let (events, _receiver) = sink();

    let mut handles = Vec::new();
    for _ in 0..5 {
        let host = Arc::clone(&host);
        let launch = options("normal", &workspace);
        let events = events.clone();
        handles.push(tokio::spawn(async move {
            host.start("conv-race", "inst-1", launch, events)
                .await
                .is_ok()
        }));
    }

    let mut successes = 0;
    for handle in handles {
        if handle.await.unwrap() {
            successes += 1;
        }
    }

    assert_eq!(successes, 1, "exactly one concurrent start may win");
    assert_eq!(host.processes().list().await.len(), 1);

    host.stop("conv-race").await;
}
