//! The ACP host: one long-lived task per agent process.
//!
//! # Why it is shaped this way
//!
//! `agent-client-protocol` 2.0 has no "connect and hand me back a connection"
//! call. `connect_with(transport, async |cx| …)` runs the dispatch loop for as
//! long as the closure runs, and `ConnectionTo` only exists inside it. A
//! connection therefore cannot be constructed and stored in Tauri managed
//! state.
//!
//! What it can be is *published*. `ConnectionTo` is `Clone + Send + Sync +
//! 'static` (verified in the audit, Part 3), so the host spawns one task per
//! agent that enters `connect_with`, sends a clone of `cx` out through a
//! oneshot, and then parks until cancelled. Commands take the clone and use it
//! from anywhere. No `LocalSet`, no thread confinement, no actor.
//!
//! The child process is ours rather than the SDK's — see `lifecycle` for why
//! (Windows job objects). The SDK still owns protocol, framing, and transport.

use super::capabilities::AgentDescriptor;
use super::error::AcpError;
use super::events::{self, AcpEvent};
use super::lifecycle::{LaunchOptions, OwnedChild, StderrTail};
use super::permission::{PermissionDecision, PermissionRequest};
use super::registry::{
    EventSink, ProcessRegistry, ProcessState, Recoverability, ReserveError, SessionRecord,
    SessionRegistry, UnrecoverableReason,
};
use agent_client_protocol::schema::v1::{
    AuthCapabilities, AuthenticateRequest, CancelNotification, ClientCapabilities,
    InitializeRequest, NewSessionRequest, PermissionOptionId, PromptRequest,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionId, SessionNotification,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, Agent, Client, ConnectTo, ConnectionTo, Lines};
use futures::{AsyncReadExt, AsyncWriteExt};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{oneshot, Mutex};
use tokio_util::sync::CancellationToken;

/// Bounded startup timeout. Covers spawn plus the ACP handshake.
pub const STARTUP_TIMEOUT: Duration = Duration::from_secs(10);
pub const AUTHENTICATE_TIMEOUT: Duration = Duration::from_secs(600);
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_PROTOCOL_LINE: usize = 1024 * 1024;

#[derive(Default)]
struct TransportSignals {
    malformed_input: AtomicBool,
    write_timeout: AtomicBool,
}

/// One readiness handshake, including terminal-auth capability negotiation.
#[must_use]
pub fn client_initialize_request() -> InitializeRequest {
    let mut meta = serde_json::Map::new();
    meta.insert("terminal-auth".into(), serde_json::Value::Bool(true));
    InitializeRequest::new(ProtocolVersion::V1)
        .client_capabilities(ClientCapabilities::new().auth(AuthCapabilities::new().terminal(true)))
        .meta(meta)
}

/// A pending permission request, waiting for the user.
struct PendingPermission {
    /// Resolves when the user decides, or when the request is withdrawn.
    responder: oneshot::Sender<PermissionDecision>,
    session_id: String,
}

#[derive(Clone)]
struct LiveSession {
    connection: ConnectionTo<Agent>,
    workspace: String,
    acp_session_id: Option<String>,
    sink: EventSink,
}

/// A started agent, from the caller's point of view.
pub struct AgentSession {
    pub conversation_id: String,
    pub descriptor: AgentDescriptor,
    connection: ConnectionTo<Agent>,
}

impl std::fmt::Debug for AgentSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentSession")
            .field("conversation_id", &self.conversation_id)
            .finish_non_exhaustive()
    }
}

impl AgentSession {
    /// The live connection, for sending session requests.
    ///
    /// `ConnectionTo<Agent>`: we are the client, so the counterpart is the
    /// agent. It is `Clone + Send + Sync + 'static`, which is what allows a
    /// handle to outlive the `connect_with` closure that owns the loop.
    #[must_use]
    pub fn connection(&self) -> &ConnectionTo<Agent> {
        &self.connection
    }

    pub async fn authenticate(&self, method_id: &str) -> Result<AgentDescriptor, AcpError> {
        self.authenticate_with_timeouts(method_id, AUTHENTICATE_TIMEOUT, STARTUP_TIMEOUT)
            .await
    }

    pub(super) async fn authenticate_with_timeouts(
        &self,
        method_id: &str,
        authenticate_timeout: Duration,
        initialize_timeout: Duration,
    ) -> Result<AgentDescriptor, AcpError> {
        if super::capabilities::advertised_auth_method(&self.descriptor.auth_methods, method_id)
            .is_none()
        {
            return Err(AcpError::Protocol {
                message: "The selected sign-in method is no longer available.".into(),
                excerpt: None,
            });
        }

        tokio::time::timeout(
            authenticate_timeout,
            self.connection
                .send_request(AuthenticateRequest::new(method_id.to_string()))
                .block_task(),
        )
        .await
        .map_err(|_| AcpError::Timeout {
            operation: "authenticate".into(),
            elapsed_ms: u64::try_from(authenticate_timeout.as_millis()).unwrap_or(u64::MAX),
        })?
        .map_err(agent_error)?;

        let response = tokio::time::timeout(
            initialize_timeout,
            self.connection
                .send_request(client_initialize_request())
                .block_task(),
        )
        .await
        .map_err(|_| AcpError::Timeout {
            operation: "initialize after sign-in".into(),
            elapsed_ms: u64::try_from(initialize_timeout.as_millis()).unwrap_or(u64::MAX),
        })?
        .map_err(agent_error)?;

        Ok(AgentDescriptor::from_response(&response))
    }
}

/// Owns every agent process and session.
pub struct AcpHost {
    processes: Arc<ProcessRegistry>,
    sessions: Arc<SessionRegistry>,
    pending_permissions: Arc<Mutex<HashMap<String, PendingPermission>>>,
    live_sessions: Arc<Mutex<HashMap<String, LiveSession>>>,
    next_request_id: std::sync::atomic::AtomicU64,
}

impl std::fmt::Debug for AcpHost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AcpHost").finish_non_exhaustive()
    }
}

impl Default for AcpHost {
    fn default() -> Self {
        AcpHost {
            processes: ProcessRegistry::new(),
            sessions: SessionRegistry::new(),
            pending_permissions: Arc::new(Mutex::new(HashMap::new())),
            live_sessions: Arc::new(Mutex::new(HashMap::new())),
            next_request_id: std::sync::atomic::AtomicU64::new(1),
        }
    }
}

impl AcpHost {
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(AcpHost::default())
    }

    #[must_use]
    pub fn processes(&self) -> &Arc<ProcessRegistry> {
        &self.processes
    }

    #[must_use]
    pub fn sessions(&self) -> &Arc<SessionRegistry> {
        &self.sessions
    }

    /// Start an agent for a conversation and complete the ACP handshake.
    ///
    /// Never called from a render path: the caller is a Tauri command driven by
    /// an explicit user action or a verification request.
    ///
    /// The slot is reserved before anything is spawned, so two concurrent calls
    /// for the same conversation cannot both produce a process.
    pub async fn start(
        self: &Arc<Self>,
        conversation_id: &str,
        installation_id: &str,
        options: LaunchOptions,
        sink: EventSink,
    ) -> Result<AgentSession, AcpError> {
        // A workspace is mandatory and must exist. An agent pointed at nothing
        // would fall back to the process's own cwd, which is Poly UI's
        // directory.
        if !options.working_directory.is_dir() {
            return Err(AcpError::Spawn {
                message: format!(
                    "the workspace directory does not exist: {}",
                    options.working_directory.display()
                ),
                executable: options.executable.display().to_string(),
            });
        }

        let cancel = CancellationToken::new();
        let epoch = match self
            .processes
            .reserve(conversation_id, installation_id, cancel.clone())
            .await
        {
            Ok(epoch) => epoch,
            Err(ReserveError::AlreadyActive { state, .. }) => {
                return Err(AcpError::Spawn {
                    message: format!(
                        "an agent for this conversation is already {}",
                        match state {
                            ProcessState::Starting => "starting",
                            ProcessState::Running => "running",
                            ProcessState::Stopping => "stopping",
                            ProcessState::Stopped => "stopped",
                        }
                    ),
                    executable: options.executable.display().to_string(),
                });
            }
        };

        let result = self
            .start_inner(conversation_id, epoch, options, sink, cancel.clone())
            .await;

        if result.is_err() {
            // Guaranteed cleanup on initialization failure: the slot is freed
            // and the child killed before the error is returned. Epoch-scoped,
            // so a failure here cannot tear down a later start.
            self.processes.stop_epoch(conversation_id, epoch).await;
        }
        result
    }

    async fn start_inner(
        self: &Arc<Self>,
        conversation_id: &str,
        epoch: u64,
        options: LaunchOptions,
        sink: EventSink,
        cancel: CancellationToken,
    ) -> Result<AgentSession, AcpError> {
        let config = options.to_config();
        let agent = AcpAgent::new(config);

        // Spawn ourselves so the child can be adopted into a job object before
        // it has a chance to fork anything.
        let (stdin, stdout, stderr, child) =
            agent.spawn_process().map_err(|error| AcpError::Spawn {
                message: error.to_string(),
                executable: options.executable.display().to_string(),
            })?;

        let owned = Arc::new(Mutex::new(OwnedChild::adopt(child, &options.executable)?));
        let pid = owned.lock().await.pid();
        self.processes
            .attach_child(conversation_id, epoch, pid, owned.clone())
            .await;

        let stderr_tail = StderrTail::new();
        spawn_stderr_drain(stderr, stderr_tail.clone());

        let (ready_tx, ready_rx) = oneshot::channel::<Result<AgentSession, AcpError>>();
        let host = self.clone();
        let conversation = conversation_id.to_string();
        let workspace = options.working_directory.display().to_string();
        let tail_for_task = stderr_tail.clone();
        let sink_for_task = sink.clone();
        let cancel_for_task = cancel.clone();

        tauri::async_runtime::spawn(async move {
            let (transport, transport_signals) = bounded_transport(stdin, stdout);
            let outcome = run_connection(
                host.clone(),
                conversation.clone(),
                workspace,
                (transport, transport_signals),
                sink_for_task.clone(),
                cancel_for_task,
                ready_tx,
            )
            .await;

            // The connection ended, cleanly or otherwise. Report and clean up.
            if let Err(error) = outcome {
                let error = enrich_with_stderr(error, &tail_for_task);
                sink_for_task
                    .send(AcpEvent::Failed {
                        session_id: conversation.clone(),
                        error,
                    })
                    .await;
            }
            host.withdraw_permissions_for(&conversation, "the agent stopped", &sink_for_task)
                .await;
            host.live_sessions.lock().await.remove(&conversation);
            // Epoch-scoped: this task may be winding down long after its
            // process was stopped and a new one started for the same
            // conversation. Deregistering that successor would leave it running
            // untracked.
            host.processes.stop_epoch(&conversation, epoch).await;
        });

        // Bounded startup. A hang during initialize is caught here rather than
        // leaving the UI waiting forever.
        let started = tokio::time::timeout(STARTUP_TIMEOUT, ready_rx).await;

        match started {
            Ok(Ok(Ok(session))) => {
                self.processes
                    .set_state(conversation_id, epoch, ProcessState::Running)
                    .await;
                self.sessions
                    .upsert(SessionRecord {
                        conversation_id: conversation_id.to_string(),
                        installation_id: session.conversation_id.clone(),
                        acp_session_id: None,
                        workspace_path: options.working_directory.display().to_string(),
                        mode_id: None,
                        created_at: now(),
                        last_active_at: now(),
                        recoverability: if session.descriptor.capabilities.load_session {
                            Recoverability::Recoverable
                        } else {
                            Recoverability::Unrecoverable {
                                reason: UnrecoverableReason::AgentCannotLoadSessions,
                            }
                        },
                    })
                    .await;
                self.live_sessions.lock().await.insert(
                    conversation_id.to_string(),
                    LiveSession {
                        connection: session.connection.clone(),
                        workspace: options.working_directory.display().to_string(),
                        acp_session_id: None,
                        sink,
                    },
                );
                Ok(session)
            }
            Ok(Ok(Err(error))) => Err(enrich_with_stderr(error, &stderr_tail)),
            // The task ended without reporting: the child died during startup.
            Ok(Err(_)) => Err(enrich_with_stderr(
                AcpError::Initialize {
                    message: "the agent exited before completing initialization".into(),
                    stderr_tail: None,
                },
                &stderr_tail,
            )),
            Err(_) => {
                cancel.cancel();
                Err(AcpError::Timeout {
                    operation: "initialize".into(),
                    elapsed_ms: u64::try_from(STARTUP_TIMEOUT.as_millis()).unwrap_or(u64::MAX),
                })
            }
        }
    }

    /// Stop the agent for a conversation. Idempotent.
    pub async fn stop(&self, conversation_id: &str) {
        self.processes.stop(conversation_id).await;
        self.live_sessions.lock().await.remove(conversation_id);
    }

    /// Stop everything. Called before `std::process::exit` on app shutdown,
    /// where no destructor will run.
    pub async fn shutdown(&self) {
        self.processes.stop_all().await;
        self.live_sessions.lock().await.clear();
    }

    pub async fn new_session(&self, conversation_id: &str) -> Result<String, AcpError> {
        let live = self
            .live_sessions
            .lock()
            .await
            .get(conversation_id)
            .cloned()
            .ok_or_else(|| AcpError::Protocol {
                message: format!("no ACP process is running for conversation {conversation_id}"),
                excerpt: None,
            })?;
        let response = live
            .connection
            .send_request(NewSessionRequest::new(&live.workspace))
            .block_task()
            .await
            .map_err(agent_error)?;
        let session_id = response.session_id.0.to_string();
        if let Some(current) = self.live_sessions.lock().await.get_mut(conversation_id) {
            current.acp_session_id = Some(session_id.clone());
        }
        self.sessions
            .set_acp_session_id(conversation_id, &session_id)
            .await;
        Ok(session_id)
    }

    pub async fn prompt(
        &self,
        conversation_id: &str,
        prompt: &str,
    ) -> Result<events::TurnEnd, AcpError> {
        let live = self
            .live_sessions
            .lock()
            .await
            .get(conversation_id)
            .cloned()
            .ok_or_else(|| AcpError::Protocol {
                message: format!("no ACP process is running for conversation {conversation_id}"),
                excerpt: None,
            })?;
        let session_id = live
            .acp_session_id
            .as_deref()
            .ok_or_else(|| AcpError::Protocol {
                message: "create an ACP session before sending a prompt".into(),
                excerpt: None,
            })?;
        let response = live
            .connection
            .send_request(PromptRequest::new(
                SessionId::new(session_id),
                vec![prompt.to_string().into()],
            ))
            .block_task()
            .await
            .map_err(agent_error)?;
        let stop_reason = events::TurnEnd::from(&response.stop_reason);
        live.sink
            .send(AcpEvent::TurnEnded {
                session_id: session_id.to_string(),
                stop_reason,
            })
            .await;
        Ok(stop_reason)
    }

    pub async fn cancel_turn(&self, conversation_id: &str) -> Result<(), AcpError> {
        let live = self
            .live_sessions
            .lock()
            .await
            .get(conversation_id)
            .cloned()
            .ok_or_else(|| AcpError::Protocol {
                message: format!("no ACP process is running for conversation {conversation_id}"),
                excerpt: None,
            })?;
        let session_id = live.acp_session_id.ok_or_else(|| AcpError::Protocol {
            message: "no ACP turn is active".into(),
            excerpt: None,
        })?;
        live.connection
            .send_notification(CancelNotification::new(SessionId::new(session_id)))
            .map_err(|error| AcpError::Transport {
                message: error.to_string(),
                exit_code: None,
                stderr_tail: None,
            })
    }

    /// Answer a pending permission request.
    ///
    /// The only way a request is ever answered. There is no path that decides
    /// on the user's behalf.
    pub async fn answer_permission(
        &self,
        request_id: &str,
        decision: PermissionDecision,
    ) -> Result<(), AcpError> {
        let pending = self.pending_permissions.lock().await.remove(request_id);
        let Some(pending) = pending else {
            return Err(AcpError::Protocol {
                message: format!("no permission request is pending with id {request_id}"),
                excerpt: None,
            });
        };
        pending
            .responder
            .send(decision)
            .map_err(|_| AcpError::Transport {
                message: "the agent stopped waiting for this permission".into(),
                exit_code: None,
                stderr_tail: None,
            })
    }

    /// Resolve every outstanding request for a conversation as withdrawn.
    ///
    /// Called on cancellation and on process death. Withdrawn, never allowed:
    /// a request nobody answered must not become an approval.
    async fn withdraw_permissions_for(&self, session_id: &str, reason: &str, sink: &EventSink) {
        let withdrawn: Vec<(String, PendingPermission)> = {
            let mut pending = self.pending_permissions.lock().await;
            let ids: Vec<String> = pending
                .iter()
                .filter(|(_, entry)| entry.session_id == session_id)
                .map(|(id, _)| id.clone())
                .collect();
            ids.into_iter()
                .filter_map(|id| pending.remove(&id).map(|entry| (id, entry)))
                .collect()
        };

        for (request_id, entry) in withdrawn {
            let _ = entry.responder.send(PermissionDecision::Cancelled);
            sink.send(AcpEvent::PermissionWithdrawn {
                session_id: session_id.to_string(),
                request_id,
                reason: reason.to_string(),
            })
            .await;
        }
    }

    fn allocate_request_id(&self) -> String {
        let id = self
            .next_request_id
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        format!("perm-{id}")
    }
}

fn agent_error(error: agent_client_protocol::Error) -> AcpError {
    AcpError::Agent {
        code: error.code.into(),
        message: error.message.to_string(),
    }
}

/// Run one connection to completion.
///
/// Enters `connect_with`, initializes, publishes the connection, then parks
/// until cancelled or until the agent's stdout reaches EOF.
async fn run_connection<T>(
    host: Arc<AcpHost>,
    conversation_id: String,
    workspace: String,
    transport: (T, Arc<TransportSignals>),
    sink: EventSink,
    cancel: CancellationToken,
    ready_tx: oneshot::Sender<Result<AgentSession, AcpError>>,
) -> Result<(), AcpError>
where
    T: ConnectTo<Client> + 'static,
{
    let (transport, transport_signals) = transport;
    let permission_host = host.clone();
    let permission_sink = sink.clone();
    let permission_workspace = workspace.clone();
    let permission_cancel = cancel.clone();
    let notification_sink = sink.clone();
    let notification_conversation = conversation_id.clone();

    let ready_tx = Arc::new(Mutex::new(Some(ready_tx)));
    let ready_for_closure = ready_tx.clone();
    let signals_for_closure = transport_signals.clone();

    let result = Client
        .builder()
        .name("poly-ui")
        // Session updates arrive as notifications. Normalized here; React never
        // sees the raw payload.
        .on_receive_notification(
            move |notification: SessionNotification, _cx| {
                let sink = notification_sink.clone();
                let conversation = notification_conversation.clone();
                async move {
                    for event in events::normalize_update(
                        &conversation,
                        &notification.update,
                        notification.meta.as_ref(),
                    ) {
                        sink.send(event).await;
                    }
                    Ok(())
                }
            },
            agent_client_protocol::on_receive_notification!(),
        )
        // Permission requests are routed to the UI and answered only by a user.
        .on_receive_request(
            move |request: RequestPermissionRequest,
                  responder: agent_client_protocol::Responder<RequestPermissionResponse>,
                  _cx| {
                let host = permission_host.clone();
                let sink = permission_sink.clone();
                let workspace = permission_workspace.clone();
                let cancel = permission_cancel.clone();
                async move {
                    let request_id = host.allocate_request_id();
                    let (decision_tx, decision_rx) = oneshot::channel();

                    let normalized = PermissionRequest::normalize(
                        request_id.clone(),
                        &request,
                        Some(workspace.as_str()),
                    );
                    let session_id = normalized.session_id.clone();

                    host.pending_permissions.lock().await.insert(
                        request_id.clone(),
                        PendingPermission {
                            responder: decision_tx,
                            session_id: session_id.clone(),
                        },
                    );

                    sink.send(AcpEvent::PermissionRequested {
                        session_id: session_id.clone(),
                        request: normalized,
                    })
                    .await;

                    // Park until the user decides — or until the agent goes
                    // away. Watching cancellation here is not optional: without
                    // it a request nobody answered keeps this handler alive,
                    // and `connect_with` will not return while a handler it
                    // owns is still running. The connection would never close
                    // and the withdrawal would never be reported.
                    //
                    // Either way the outcome is `Cancelled`. A request that was
                    // never answered must never become an approval.
                    let decision = tokio::select! {
                        decision = decision_rx => decision.unwrap_or(PermissionDecision::Cancelled),
                        () = cancel.cancelled() => PermissionDecision::Cancelled,
                    };

                    let was_pending = host
                        .pending_permissions
                        .lock()
                        .await
                        .remove(&request_id)
                        .is_some();

                    // Still pending means nobody answered: the agent stopped
                    // while the user was still looking at it. Report the
                    // withdrawal so the prompt does not sit on screen forever.
                    if was_pending {
                        sink.send(AcpEvent::PermissionWithdrawn {
                            session_id: session_id.clone(),
                            request_id: request_id.clone(),
                            reason: "the agent stopped before this was answered".into(),
                        })
                        .await;
                    }

                    let outcome = match decision {
                        PermissionDecision::Selected { option_id } => {
                            RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                                PermissionOptionId::new(option_id),
                            ))
                        }
                        PermissionDecision::Cancelled => RequestPermissionOutcome::Cancelled,
                    };
                    responder.respond(RequestPermissionResponse::new(outcome))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(transport, async move |cx| {
            // Initialize. A failure here is reported to the waiting starter
            // rather than only ending the task.
            let response = cx
                .send_request(client_initialize_request())
                .block_task()
                .await;

            let response = match response {
                Ok(response) => response,
                Err(error) => {
                    if let Some(tx) = ready_for_closure.lock().await.take() {
                        let message = error.message.to_string();
                        let failure = if signals_for_closure.malformed_input.load(Ordering::Relaxed)
                        {
                            AcpError::Protocol {
                                message: "The coding agent sent malformed output.".into(),
                                excerpt: None,
                            }
                        } else if signals_for_closure.write_timeout.load(Ordering::Relaxed) {
                            AcpError::WriteTimeout {
                                elapsed_ms: u64::try_from(WRITE_TIMEOUT.as_millis())
                                    .unwrap_or(u64::MAX),
                            }
                        } else {
                            AcpError::Initialize {
                                message,
                                stderr_tail: None,
                            }
                        };
                        let _ = tx.send(Err(failure));
                    }
                    return Err(error);
                }
            };

            let descriptor = AgentDescriptor::from_response(&response);

            // Publish a clone of the connection. This is the whole trick: the
            // connection stays owned by this task, but callers hold a handle.
            if let Some(tx) = ready_for_closure.lock().await.take() {
                let _ = tx.send(Ok(AgentSession {
                    conversation_id: conversation_id.clone(),
                    descriptor,
                    connection: cx.clone(),
                }));
            }

            // Park. Whichever comes first: the user stops the agent, or the
            // agent's stdout reaches EOF.
            tokio::select! {
                () = cancel.cancelled() => {}
                () = cx.incoming_closed() => {}
            }
            Ok(())
        })
        .await;

    // If we never got as far as publishing, the starter is still waiting.
    if let Some(tx) = ready_tx.lock().await.take() {
        let _ = tx.send(Err(match &result {
            Err(_) if transport_signals.malformed_input.load(Ordering::Relaxed) => {
                AcpError::Protocol {
                    message: "The coding agent sent malformed output.".into(),
                    excerpt: None,
                }
            }
            Err(_) if transport_signals.write_timeout.load(Ordering::Relaxed) => {
                AcpError::WriteTimeout {
                    elapsed_ms: u64::try_from(WRITE_TIMEOUT.as_millis()).unwrap_or(u64::MAX),
                }
            }
            Err(error) => AcpError::Initialize {
                message: error.message.to_string(),
                stderr_tail: None,
            },
            Ok(()) => AcpError::Initialize {
                message: "the agent closed the connection before initializing".into(),
                stderr_tail: None,
            },
        }));
    }

    result.map_err(|error| {
        let message = error.message.to_string();
        if transport_signals.malformed_input.load(Ordering::Relaxed) {
            AcpError::Protocol {
                message: "The coding agent sent malformed output.".into(),
                excerpt: None,
            }
        } else if transport_signals.write_timeout.load(Ordering::Relaxed) {
            AcpError::WriteTimeout {
                elapsed_ms: u64::try_from(WRITE_TIMEOUT.as_millis()).unwrap_or(u64::MAX),
            }
        } else {
            AcpError::Transport {
                message,
                exit_code: None,
                stderr_tail: None,
            }
        }
    })
}

fn bounded_transport(
    stdin: async_process::ChildStdin,
    stdout: async_process::ChildStdout,
) -> (
    Lines<
        impl futures::Sink<String, Error = std::io::Error> + Send + 'static,
        impl futures::Stream<Item = std::io::Result<String>> + Send + 'static,
    >,
    Arc<TransportSignals>,
) {
    let signals = Arc::new(TransportSignals::default());
    let outgoing_signals = signals.clone();
    let outgoing = futures::sink::unfold(stdin, move |mut writer, line: String| {
        let signals = outgoing_signals.clone();
        async move {
            let write = async {
                writer.write_all(line.as_bytes()).await?;
                writer.write_all(b"\n").await?;
                writer.flush().await
            };
            match futures::future::select(Box::pin(write), async_io::Timer::after(WRITE_TIMEOUT))
                .await
            {
                futures::future::Either::Left((result, _)) => result?,
                futures::future::Either::Right(_) => {
                    signals.write_timeout.store(true, Ordering::Relaxed);
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "writing to the coding agent timed out",
                    ));
                }
            }
            Ok(writer)
        }
    });

    let incoming_signals = signals.clone();
    let incoming = futures::stream::unfold(
        (stdout, Vec::<u8>::new(), false),
        move |(mut reader, mut pending, done)| {
            let signals = incoming_signals.clone();
            async move {
                if done {
                    return None;
                }
                loop {
                    if let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
                        if newline > MAX_PROTOCOL_LINE {
                            signals.malformed_input.store(true, Ordering::Relaxed);
                            return Some((
                                Err(std::io::Error::new(
                                    std::io::ErrorKind::InvalidData,
                                    "protocol line exceeds 1 MiB",
                                )),
                                (reader, Vec::new(), true),
                            ));
                        }
                        let mut line: Vec<u8> = pending.drain(..=newline).collect();
                        line.pop();
                        if line.last() == Some(&b'\r') {
                            line.pop();
                        }
                        let parsed = String::from_utf8(line).map_err(|_| {
                            signals.malformed_input.store(true, Ordering::Relaxed);
                            std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                "protocol line is not UTF-8",
                            )
                        });
                        return Some((parsed, (reader, pending, false)));
                    }
                    if pending.len() > MAX_PROTOCOL_LINE {
                        signals.malformed_input.store(true, Ordering::Relaxed);
                        return Some((
                            Err(std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                "protocol line exceeds 1 MiB",
                            )),
                            (reader, Vec::new(), true),
                        ));
                    }

                    let mut chunk = [0_u8; 8192];
                    match reader.read(&mut chunk).await {
                        Ok(0) if pending.is_empty() => return None,
                        Ok(0) => {
                            let parsed =
                                String::from_utf8(std::mem::take(&mut pending)).map_err(|_| {
                                    signals.malformed_input.store(true, Ordering::Relaxed);
                                    std::io::Error::new(
                                        std::io::ErrorKind::InvalidData,
                                        "protocol line is not UTF-8",
                                    )
                                });
                            return Some((parsed, (reader, Vec::new(), true)));
                        }
                        Ok(read) => pending.extend_from_slice(&chunk[..read]),
                        Err(error) => return Some((Err(error), (reader, Vec::new(), true))),
                    }
                }
            }
        },
    );

    (Lines::new(outgoing, incoming), signals)
}

/// Read the child's stderr into a bounded tail.
///
/// stderr is diagnostics. It is never parsed as protocol and never influences
/// readiness — it only decorates an error the protocol already reported.
fn spawn_stderr_drain(stderr: async_process::ChildStderr, tail: Arc<StderrTail>) {
    tauri::async_runtime::spawn(async move {
        use futures::AsyncBufReadExt;
        use futures::StreamExt;
        let reader = futures::io::BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Some(Ok(line)) = lines.next().await {
            tail.push_line(&line);
        }
    });
}

/// Attach the child's stderr tail to an error, where the variant has room for
/// it. Usually the actual explanation.
fn enrich_with_stderr(error: AcpError, tail: &Arc<StderrTail>) -> AcpError {
    let snapshot = tail.snapshot().map(|text| AcpError::excerpt(&text));
    match error {
        AcpError::Initialize { message, .. } => AcpError::Initialize {
            message,
            stderr_tail: snapshot,
        },
        AcpError::Transport {
            message, exit_code, ..
        } => AcpError::Transport {
            message,
            exit_code,
            stderr_tail: snapshot,
        },
        other => other,
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_ids_are_host_assigned_and_unique() {
        let host = AcpHost::default();
        let first = host.allocate_request_id();
        let second = host.allocate_request_id();
        assert_ne!(first, second);
        // Not derived from the wire id, so the UI cannot answer a request by
        // guessing a JSON-RPC number.
        assert!(first.starts_with("perm-"));
    }

    #[tokio::test]
    async fn answering_an_unknown_permission_is_an_error() {
        let host = AcpHost::default();
        let error = host
            .answer_permission("nope", PermissionDecision::Cancelled)
            .await
            .unwrap_err();
        assert!(matches!(error, AcpError::Protocol { .. }));
    }

    #[tokio::test]
    async fn withdrawing_resolves_pending_requests_as_cancelled() {
        let host = Arc::new(AcpHost::default());
        let (sink, mut receiver) = EventSink::new(8);
        let (tx, rx) = oneshot::channel();

        host.pending_permissions.lock().await.insert(
            "perm-1".into(),
            PendingPermission {
                responder: tx,
                session_id: "conv-1".into(),
            },
        );

        host.withdraw_permissions_for("conv-1", "the agent stopped", &sink)
            .await;

        // The waiting handler is released as cancelled, not approved.
        assert_eq!(rx.await.unwrap(), PermissionDecision::Cancelled);
        match receiver.recv().await.unwrap() {
            AcpEvent::PermissionWithdrawn { request_id, .. } => {
                assert_eq!(request_id, "perm-1");
            }
            other => panic!("expected withdrawal, got {other:?}"),
        }
        assert!(host.pending_permissions.lock().await.is_empty());
    }

    #[tokio::test]
    async fn a_missing_workspace_is_refused_before_anything_is_spawned() {
        let host = AcpHost::new();
        let (sink, _receiver) = EventSink::new(8);

        let error = host
            .start(
                "conv-1",
                "inst-1",
                LaunchOptions {
                    executable: "/bin/echo".into(),
                    args: vec![],
                    working_directory: "/definitely/not/a/directory".into(),
                    env: vec![],
                },
                sink,
            )
            .await
            .unwrap_err();

        assert!(matches!(error, AcpError::Spawn { .. }));
        // Nothing was reserved, so a later start is not blocked.
        assert!(host.processes().list().await.is_empty());
    }
}
