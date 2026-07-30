//! The process and session registries, and the bounded event sink.
//!
//! One owner for every live agent process. Keyed by conversation, because that
//! is the thing a user can double-click: the invariant "a session never ends up
//! with two uncontrolled processes" is enforced by reserving the slot before
//! spawning, not by checking afterwards.

use super::events::AcpEvent;
use super::lifecycle::OwnedChild;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use ts_rs::TS;

/// What a registered process is doing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum ProcessState {
    /// The slot is reserved and the process is being spawned and initialized.
    Starting,
    /// Initialized and usable.
    Running,
    /// Being torn down.
    Stopping,
    /// Gone. The entry lingers only long enough to report why.
    Stopped,
}

/// Whether a session can be picked back up.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "kebab-case")]
#[ts(export)]
pub enum Recoverability {
    /// The agent advertised session loading and the session is believed live.
    Recoverable,
    /// Cannot be restored. Carries the reason so the UI says which, and never
    /// silently starts a fresh session in its place.
    Unrecoverable { reason: UnrecoverableReason },
    /// Not yet determined — the host has not tried since the last restart.
    Unknown,
}

/// Why a session cannot be restored.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export)]
pub enum UnrecoverableReason {
    /// The agent does not implement `session/load`.
    AgentCannotLoadSessions,
    /// The agent no longer recognises the session id.
    StaleSessionId,
    /// The workspace directory is gone.
    WorkspaceMissing,
    /// The process died and restoring would mean a different conversation.
    ProcessCrashed,
}

/// A live agent process.
#[derive(Debug)]
pub struct ProcessEntry {
    /// Distinguishes this reservation from any earlier one for the same
    /// conversation. See [`ProcessRegistry::reserve`].
    pub epoch: u64,
    pub conversation_id: String,
    pub installation_id: String,
    pub state: ProcessState,
    pub pid: Option<u32>,
    /// Cancels the connection task, which owns the child.
    pub cancel: tokio_util::sync::CancellationToken,
    /// Held so termination can force-kill without waiting for the task.
    pub child: Option<Arc<Mutex<OwnedChild>>>,
}

/// A process, as reported to the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProcessStatus {
    pub conversation_id: String,
    pub installation_id: String,
    pub state: ProcessState,
    pub pid: Option<u32>,
}

/// The mapping from a Poly UI conversation to an ACP session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SessionRecord {
    pub conversation_id: String,
    pub installation_id: String,
    /// The agent's own session id. `None` until the agent hands one back.
    pub acp_session_id: Option<String>,
    pub workspace_path: String,
    /// The selected mode, where the agent supports modes.
    pub mode_id: Option<String>,
    pub created_at: String,
    pub last_active_at: String,
    pub recoverability: Recoverability,
}

/// Reserving a slot failed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReserveError {
    /// A process for this conversation is already starting or running. Returned
    /// rather than spawning a second one.
    AlreadyActive {
        conversation_id: String,
        state: ProcessState,
    },
}

/// Owns every live agent process.
#[derive(Debug, Default)]
pub struct ProcessRegistry {
    entries: Mutex<HashMap<String, ProcessEntry>>,
    next_epoch: std::sync::atomic::AtomicU64,
}

impl ProcessRegistry {
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(ProcessRegistry::default())
    }

    /// Reserve the slot for a conversation before spawning.
    ///
    /// This is the whole duplicate-process guard: the slot is taken while the
    /// lock is held, so two concurrent starts cannot both proceed to spawn. A
    /// caller that loses the race gets [`ReserveError::AlreadyActive`] and must
    /// not spawn.
    ///
    /// Returns an *epoch* identifying this reservation. Every later mutation
    /// carries it, so a connection task that is torn down late cannot clobber
    /// the reservation that replaced it: after `stop` then `start` for the same
    /// conversation, the old task's cleanup would otherwise deregister the new
    /// process and leave it running untracked.
    pub async fn reserve(
        &self,
        conversation_id: &str,
        installation_id: &str,
        cancel: tokio_util::sync::CancellationToken,
    ) -> Result<u64, ReserveError> {
        let mut entries = self.entries.lock().await;
        if let Some(existing) = entries.get(conversation_id) {
            if matches!(
                existing.state,
                ProcessState::Starting | ProcessState::Running | ProcessState::Stopping
            ) {
                return Err(ReserveError::AlreadyActive {
                    conversation_id: conversation_id.to_string(),
                    state: existing.state,
                });
            }
        }
        let epoch = self
            .next_epoch
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        entries.insert(
            conversation_id.to_string(),
            ProcessEntry {
                epoch,
                conversation_id: conversation_id.to_string(),
                installation_id: installation_id.to_string(),
                state: ProcessState::Starting,
                pid: None,
                cancel,
                child: None,
            },
        );
        Ok(epoch)
    }

    /// Record the spawned child against a reserved slot.
    ///
    /// Ignored if the slot has since been replaced.
    pub async fn attach_child(
        &self,
        conversation_id: &str,
        epoch: u64,
        pid: u32,
        child: Arc<Mutex<OwnedChild>>,
    ) {
        let mut entries = self.entries.lock().await;
        if let Some(entry) = entries
            .get_mut(conversation_id)
            .filter(|entry| entry.epoch == epoch)
        {
            entry.pid = Some(pid);
            entry.child = Some(child);
        }
    }

    /// Ignored if the slot has since been replaced.
    pub async fn set_state(&self, conversation_id: &str, epoch: u64, state: ProcessState) {
        let mut entries = self.entries.lock().await;
        if let Some(entry) = entries
            .get_mut(conversation_id)
            .filter(|entry| entry.epoch == epoch)
        {
            entry.state = state;
        }
    }

    pub async fn state_of(&self, conversation_id: &str) -> Option<ProcessState> {
        self.entries
            .lock()
            .await
            .get(conversation_id)
            .map(|entry| entry.state)
    }

    /// Every live process.
    pub async fn list(&self) -> Vec<ProcessStatus> {
        let mut statuses: Vec<ProcessStatus> = self
            .entries
            .lock()
            .await
            .values()
            .map(|entry| ProcessStatus {
                conversation_id: entry.conversation_id.clone(),
                installation_id: entry.installation_id.clone(),
                state: entry.state,
                pid: entry.pid,
            })
            .collect();
        statuses.sort_by(|a, b| a.conversation_id.cmp(&b.conversation_id));
        statuses
    }

    /// Stop whatever process currently holds this conversation's slot.
    ///
    /// Removes the entry before awaiting termination, so a `start` racing this
    /// `stop` cannot see a half-torn-down slot and refuse.
    pub async fn stop(&self, conversation_id: &str) {
        self.stop_matching(conversation_id, None).await;
    }

    /// Stop the process only if the slot still belongs to `epoch`.
    ///
    /// What a connection task calls when it winds down. A task whose process
    /// was already stopped and replaced must not tear down its successor.
    pub async fn stop_epoch(&self, conversation_id: &str, epoch: u64) {
        self.stop_matching(conversation_id, Some(epoch)).await;
    }

    async fn stop_matching(&self, conversation_id: &str, epoch: Option<u64>) {
        let entry = {
            let mut entries = self.entries.lock().await;
            match entries.get_mut(conversation_id) {
                Some(entry) if epoch.is_none_or(|epoch| entry.epoch == epoch) => {
                    entry.state = ProcessState::Stopping;
                }
                // Either nothing is registered, or the slot has moved on to a
                // newer reservation that this caller does not own.
                _ => return,
            }
            entries.remove(conversation_id)
        };

        let Some(entry) = entry else { return };
        entry.cancel.cancel();
        if let Some(child) = entry.child {
            child.lock().await.terminate().await;
        }
    }

    /// Stop everything. Called on app exit, where `Drop` will not run.
    pub async fn stop_all(&self) {
        let entries: Vec<ProcessEntry> = {
            let mut guard = self.entries.lock().await;
            guard.drain().map(|(_, entry)| entry).collect()
        };
        for entry in entries {
            entry.cancel.cancel();
            if let Some(child) = entry.child {
                // Forced rather than graceful: on the exit path there is no
                // time to wait, and `std::process::exit` follows immediately.
                child.lock().await.force_now();
            }
        }
    }

    /// Drop a slot without terminating — used when the connection task has
    /// already observed the child exit.
    pub async fn forget(&self, conversation_id: &str) {
        self.entries.lock().await.remove(conversation_id);
    }
}

/// Maps conversations to ACP sessions.
#[derive(Debug, Default)]
pub struct SessionRegistry {
    records: Mutex<HashMap<String, SessionRecord>>,
}

impl SessionRegistry {
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(SessionRegistry::default())
    }

    pub async fn upsert(&self, record: SessionRecord) {
        self.records
            .lock()
            .await
            .insert(record.conversation_id.clone(), record);
    }

    pub async fn get(&self, conversation_id: &str) -> Option<SessionRecord> {
        self.records.lock().await.get(conversation_id).cloned()
    }

    pub async fn list(&self) -> Vec<SessionRecord> {
        let mut records: Vec<SessionRecord> = self.records.lock().await.values().cloned().collect();
        records.sort_by(|a, b| a.conversation_id.cmp(&b.conversation_id));
        records
    }

    pub async fn set_acp_session_id(&self, conversation_id: &str, acp_session_id: &str) {
        let mut records = self.records.lock().await;
        if let Some(record) = records.get_mut(conversation_id) {
            record.acp_session_id = Some(acp_session_id.to_string());
        }
    }

    pub async fn touch(&self, conversation_id: &str, now: &str) {
        let mut records = self.records.lock().await;
        if let Some(record) = records.get_mut(conversation_id) {
            record.last_active_at = now.to_string();
        }
    }

    /// Mark a session as impossible to restore, with the reason.
    ///
    /// The alternative — quietly creating a new ACP session and presenting it
    /// as the old one — would show the user a conversation the agent has no
    /// memory of.
    pub async fn mark_unrecoverable(&self, conversation_id: &str, reason: UnrecoverableReason) {
        let mut records = self.records.lock().await;
        if let Some(record) = records.get_mut(conversation_id) {
            record.recoverability = Recoverability::Unrecoverable { reason };
            record.acp_session_id = None;
        }
    }

    /// Decide whether a stored session could be restored.
    ///
    /// Pure: every input is explicit, so the decision is testable without a
    /// process. Returns the reason it cannot be, or `None` if it can.
    #[must_use]
    pub fn restoration_blocker(
        record: &SessionRecord,
        agent_can_load_sessions: bool,
        workspace_exists: bool,
    ) -> Option<UnrecoverableReason> {
        if !workspace_exists {
            return Some(UnrecoverableReason::WorkspaceMissing);
        }
        if !agent_can_load_sessions {
            return Some(UnrecoverableReason::AgentCannotLoadSessions);
        }
        if record.acp_session_id.is_none() {
            return Some(UnrecoverableReason::StaleSessionId);
        }
        None
    }
}

/// How many events may be queued for the frontend before shedding.
pub const EVENT_QUEUE_CAPACITY: usize = 512;

/// A bounded sender for normalized events.
///
/// When the frontend falls behind, the queue fills. The policy:
///
/// - **Lossy events are dropped** (thought chunks, tool progress, plans, meta).
///   Losing some degrades the live view; the agent's own record is the source
///   of truth for the transcript.
/// - **Everything else blocks the producer** — assistant text, permission
///   requests, turn ends, failures. Dropping a permission request would hang
///   the agent forever waiting for an answer nobody was asked for; dropping a
///   `TurnEnded` would leave the UI spinning.
/// - **A drop is reported**, via [`AcpEvent::Lagged`], so the UI can say its
///   view is incomplete rather than silently showing less than happened.
#[derive(Debug, Clone)]
pub struct EventSink {
    sender: mpsc::Sender<AcpEvent>,
    dropped: Arc<std::sync::atomic::AtomicU32>,
}

impl EventSink {
    #[must_use]
    pub fn new(capacity: usize) -> (Self, mpsc::Receiver<AcpEvent>) {
        let (sender, receiver) = mpsc::channel(capacity);
        (
            EventSink {
                sender,
                dropped: Arc::new(std::sync::atomic::AtomicU32::new(0)),
            },
            receiver,
        )
    }

    /// Queue an event, applying the shedding policy.
    ///
    /// Returns `false` when the receiver is gone.
    pub async fn send(&self, event: AcpEvent) -> bool {
        use std::sync::atomic::Ordering;

        if event.is_lossy() {
            return match self.sender.try_send(event) {
                Ok(()) => true,
                Err(mpsc::error::TrySendError::Full(_)) => {
                    self.dropped.fetch_add(1, Ordering::Relaxed);
                    true
                }
                Err(mpsc::error::TrySendError::Closed(_)) => false,
            };
        }

        // Non-lossy: flush the lag report first so the UI learns about the gap
        // before the event that follows it.
        let dropped = self.dropped.swap(0, Ordering::Relaxed);
        if dropped > 0 {
            let notice = AcpEvent::Lagged {
                session_id: event.session_id().to_string(),
                dropped,
            };
            if self.sender.send(notice).await.is_err() {
                return false;
            }
        }

        self.sender.send(event).await.is_ok()
    }

    /// How many events have been shed since the last report. Test helper.
    #[must_use]
    pub fn dropped_count(&self) -> u32 {
        self.dropped.load(std::sync::atomic::Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cancellation() -> tokio_util::sync::CancellationToken {
        tokio_util::sync::CancellationToken::new()
    }

    fn record(conversation_id: &str, acp_session_id: Option<&str>) -> SessionRecord {
        SessionRecord {
            conversation_id: conversation_id.into(),
            installation_id: "inst-1".into(),
            acp_session_id: acp_session_id.map(str::to_string),
            workspace_path: "/tmp/workspace".into(),
            mode_id: None,
            created_at: "2026-07-27T00:00:00Z".into(),
            last_active_at: "2026-07-27T00:00:00Z".into(),
            recoverability: Recoverability::Unknown,
        }
    }

    #[tokio::test]
    async fn a_conversation_cannot_reserve_two_slots() {
        let registry = ProcessRegistry::new();
        registry
            .reserve("conv-1", "inst-1", cancellation())
            .await
            .unwrap();

        let error = registry
            .reserve("conv-1", "inst-1", cancellation())
            .await
            .unwrap_err();
        assert_eq!(
            error,
            ReserveError::AlreadyActive {
                conversation_id: "conv-1".into(),
                state: ProcessState::Starting,
            }
        );

        // A different conversation is unaffected.
        registry
            .reserve("conv-2", "inst-1", cancellation())
            .await
            .unwrap();
        assert_eq!(registry.list().await.len(), 2);
    }

    #[tokio::test]
    async fn a_running_slot_also_blocks_a_second_start() {
        let registry = ProcessRegistry::new();
        let epoch = registry
            .reserve("conv-1", "inst-1", cancellation())
            .await
            .unwrap();
        registry
            .set_state("conv-1", epoch, ProcessState::Running)
            .await;

        assert!(registry
            .reserve("conv-1", "inst-1", cancellation())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn stopping_frees_the_slot_for_an_immediate_restart() {
        let registry = ProcessRegistry::new();
        let epoch = registry
            .reserve("conv-1", "inst-1", cancellation())
            .await
            .unwrap();
        registry
            .set_state("conv-1", epoch, ProcessState::Running)
            .await;

        registry.stop("conv-1").await;
        assert_eq!(registry.state_of("conv-1").await, None);

        // Rapid start → cancel → start must succeed with one process.
        registry
            .reserve("conv-1", "inst-1", cancellation())
            .await
            .unwrap();
        let processes = registry.list().await;
        assert_eq!(processes.len(), 1);
        assert_eq!(processes[0].conversation_id, "conv-1");
    }

    #[tokio::test]
    async fn stopping_cancels_the_connection_task() {
        let registry = ProcessRegistry::new();
        let cancel = cancellation();
        registry
            .reserve("conv-1", "inst-1", cancel.clone())
            .await
            .unwrap();

        assert!(!cancel.is_cancelled());
        registry.stop("conv-1").await;
        assert!(cancel.is_cancelled());
    }

    #[tokio::test]
    async fn a_late_cleanup_cannot_deregister_the_process_that_replaced_it() {
        let registry = ProcessRegistry::new();

        // Round one starts and is stopped.
        let first = registry
            .reserve("conv-1", "inst-1", cancellation())
            .await
            .unwrap();
        registry.stop("conv-1").await;

        // Round two starts immediately for the same conversation.
        let second = registry
            .reserve("conv-1", "inst-1", cancellation())
            .await
            .unwrap();
        assert_ne!(first, second);
        registry
            .set_state("conv-1", second, ProcessState::Running)
            .await;

        // Round one's connection task only now gets around to winding down.
        // Deregistering here would leave round two's process running untracked.
        registry.stop_epoch("conv-1", first).await;

        assert_eq!(
            registry.state_of("conv-1").await,
            Some(ProcessState::Running),
            "a superseded task must not tear down its successor"
        );
        assert_eq!(registry.list().await.len(), 1);

        // The owning epoch still can.
        registry.stop_epoch("conv-1", second).await;
        assert!(registry.list().await.is_empty());
    }

    #[tokio::test]
    async fn a_stale_epoch_cannot_mutate_a_newer_reservation() {
        let registry = ProcessRegistry::new();
        let first = registry
            .reserve("conv-1", "inst-1", cancellation())
            .await
            .unwrap();
        registry.stop("conv-1").await;
        let second = registry
            .reserve("conv-1", "inst-2", cancellation())
            .await
            .unwrap();

        // A late state update from the old task is ignored.
        registry
            .set_state("conv-1", first, ProcessState::Stopped)
            .await;
        assert_eq!(
            registry.state_of("conv-1").await,
            Some(ProcessState::Starting)
        );

        registry
            .set_state("conv-1", second, ProcessState::Running)
            .await;
        assert_eq!(
            registry.state_of("conv-1").await,
            Some(ProcessState::Running)
        );
    }

    #[tokio::test]
    async fn stop_all_cancels_everything() {
        let registry = ProcessRegistry::new();
        let first = cancellation();
        let second = cancellation();
        registry.reserve("a", "inst", first.clone()).await.unwrap();
        registry.reserve("b", "inst", second.clone()).await.unwrap();

        registry.stop_all().await;

        assert!(first.is_cancelled());
        assert!(second.is_cancelled());
        assert!(registry.list().await.is_empty());
    }

    #[tokio::test]
    async fn the_registry_reports_which_session_each_process_belongs_to() {
        let registry = ProcessRegistry::new();
        registry
            .reserve("conv-1", "inst-a", cancellation())
            .await
            .unwrap();
        let second = registry
            .reserve("conv-2", "inst-b", cancellation())
            .await
            .unwrap();
        registry
            .set_state("conv-2", second, ProcessState::Running)
            .await;

        let processes = registry.list().await;
        assert_eq!(processes[0].conversation_id, "conv-1");
        assert_eq!(processes[0].installation_id, "inst-a");
        assert_eq!(processes[0].state, ProcessState::Starting);
        assert_eq!(processes[1].installation_id, "inst-b");
        assert_eq!(processes[1].state, ProcessState::Running);
    }

    #[tokio::test]
    async fn session_records_map_conversations_to_acp_sessions() {
        let registry = SessionRegistry::new();
        registry.upsert(record("conv-1", None)).await;

        registry.set_acp_session_id("conv-1", "acp-9").await;
        let stored = registry.get("conv-1").await.unwrap();
        assert_eq!(stored.acp_session_id.as_deref(), Some("acp-9"));

        registry.touch("conv-1", "2026-07-28T00:00:00Z").await;
        assert_eq!(
            registry.get("conv-1").await.unwrap().last_active_at,
            "2026-07-28T00:00:00Z"
        );
    }

    #[tokio::test]
    async fn an_unrecoverable_session_loses_its_id_rather_than_being_reused() {
        let registry = SessionRegistry::new();
        registry.upsert(record("conv-1", Some("acp-9"))).await;

        registry
            .mark_unrecoverable("conv-1", UnrecoverableReason::StaleSessionId)
            .await;

        let stored = registry.get("conv-1").await.unwrap();
        assert_eq!(
            stored.recoverability,
            Recoverability::Unrecoverable {
                reason: UnrecoverableReason::StaleSessionId
            }
        );
        // Clearing the id is what stops a later restore from silently
        // presenting a fresh session as the old one.
        assert_eq!(stored.acp_session_id, None);
    }

    #[test]
    fn restoration_is_blocked_for_each_documented_reason() {
        let live = record("conv-1", Some("acp-9"));

        assert_eq!(
            SessionRegistry::restoration_blocker(&live, true, true),
            None
        );

        assert_eq!(
            SessionRegistry::restoration_blocker(&live, true, false),
            Some(UnrecoverableReason::WorkspaceMissing)
        );
        assert_eq!(
            SessionRegistry::restoration_blocker(&live, false, true),
            Some(UnrecoverableReason::AgentCannotLoadSessions)
        );

        let stale = record("conv-1", None);
        assert_eq!(
            SessionRegistry::restoration_blocker(&stale, true, true),
            Some(UnrecoverableReason::StaleSessionId)
        );

        // A missing workspace is reported ahead of a load-capability problem:
        // it is the one the user can actually fix.
        assert_eq!(
            SessionRegistry::restoration_blocker(&stale, false, false),
            Some(UnrecoverableReason::WorkspaceMissing)
        );
    }

    #[tokio::test]
    async fn a_slow_consumer_sheds_lossy_events_and_keeps_the_rest() {
        let (sink, mut receiver) = EventSink::new(4);

        // Fill the queue with events that may be shed.
        for index in 0..50 {
            sink.send(AcpEvent::AgentThought {
                session_id: "s1".into(),
                text: format!("thought {index}"),
            })
            .await;
        }
        assert!(sink.dropped_count() > 0, "the queue should have overflowed");

        // Drain enough room for the critical event and its lag report.
        for _ in 0..4 {
            receiver.recv().await;
        }

        sink.send(AcpEvent::TurnEnded {
            session_id: "s1".into(),
            stop_reason: super::super::events::TurnEnd::EndTurn,
        })
        .await;

        // The lag report arrives before the event that follows the gap.
        let mut saw_lagged = false;
        let mut saw_turn_end = false;
        while let Ok(event) = receiver.try_recv() {
            match event {
                AcpEvent::Lagged { dropped, .. } => {
                    assert!(dropped > 0);
                    saw_lagged = true;
                }
                AcpEvent::TurnEnded { .. } => {
                    assert!(saw_lagged, "the gap must be reported before the next event");
                    saw_turn_end = true;
                }
                _ => {}
            }
        }
        assert!(saw_lagged, "a dropped event must be reported");
        assert!(saw_turn_end, "a terminal event must never be dropped");
        assert_eq!(sink.dropped_count(), 0, "the counter resets once reported");
    }

    #[tokio::test]
    async fn a_permission_request_is_never_shed() {
        let (sink, mut receiver) = EventSink::new(2);

        // Saturate with lossy events.
        for index in 0..10 {
            sink.send(AcpEvent::AgentThought {
                session_id: "s1".into(),
                text: format!("{index}"),
            })
            .await;
        }

        // A permission request must reach the UI, so the producer waits for
        // room rather than dropping it.
        let sink_clone = sink.clone();
        let sender = tokio::spawn(async move {
            sink_clone
                .send(AcpEvent::PermissionRequested {
                    session_id: "s1".into(),
                    request: super::super::permission::PermissionRequest {
                        request_id: "r1".into(),
                        session_id: "s1".into(),
                        action: "Run something".into(),
                        tool_call_id: "c1".into(),
                        tool_kind: Some("execute".into()),
                        affected_paths: vec![],
                        command: Some("ls".into()),
                        working_directory: None,
                        raw_input: None,
                        choices: vec![],
                    },
                })
                .await
        });

        let mut delivered = false;
        for _ in 0..20 {
            if let Some(event) = receiver.recv().await {
                if matches!(event, AcpEvent::PermissionRequested { .. }) {
                    delivered = true;
                    break;
                }
            }
        }
        assert!(delivered, "a permission request must not be dropped");
        assert!(sender.await.unwrap());
    }

    #[tokio::test]
    async fn sending_after_the_receiver_is_gone_reports_failure() {
        let (sink, receiver) = EventSink::new(4);
        drop(receiver);

        assert!(
            !sink
                .send(AcpEvent::TurnEnded {
                    session_id: "s1".into(),
                    stop_reason: super::super::events::TurnEnd::EndTurn,
                })
                .await
        );
    }
}
