//! A scriptable ACP agent used only by the host's tests.
//!
//! The scenario is chosen by `POLY_MOCK_SCENARIO` (or the first argument) and
//! decides how this process behaves — including how it misbehaves.
//!
//! This binary writes JSON-RPC lines by hand rather than going through the SDK's
//! `Agent` role. That is deliberate and is the one place in the repository where
//! hand-rolled protocol is correct: half of the scenarios exist to emit output
//! the SDK would refuse to produce (malformed JSON, valid JSON that is not an
//! ACP message, a reply that never comes). A well-behaved agent cannot test a
//! client's handling of a badly behaved one.
//!
//! Nothing here is compiled into the application: it is a `[[bin]]`, and no
//! application module references it.

use std::io::{BufRead, Write};

/// How the mock behaves for one run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Scenario {
    /// Initialize, advertise a full capability set, create a session, stream
    /// assistant output, complete the turn.
    Normal,
    /// As `Normal`, but the initialize response advertises nothing optional.
    CapabilitiesMinimal,
    /// As `Normal`, with every capability this host understands advertised.
    CapabilitiesFull,
    /// Ask for permission mid-turn and honour the answer.
    Permission,
    /// Ask for permission and never respond to anything afterwards.
    PermissionNeverAnswered,
    /// A tool call moving through pending, in-progress, and completed.
    ToolCalls,
    /// Emit a line that is not JSON at all, then keep working.
    MalformedJson,
    /// Emit well-formed JSON that is not an ACP message, then keep working.
    NonAcpJson,
    /// Write heavily to stderr while the protocol runs correctly on stdout.
    StderrNoise,
    /// Accept the initialize request and never answer it.
    HangInitialize,
    /// Accept authenticate and never answer it.
    HangAuthenticate,
    /// Return from authenticate, then reject the required second initialize.
    FailReinitialize,
    /// Exit with a non-zero code part-way through a turn.
    ExitNonZeroMidSession,
    /// Exit with code zero part-way through a turn.
    ExitZeroMidSession,
    /// Ignore termination signals so the host has to escalate to a hard kill.
    IgnoreTermination,
    OversizedLine,
}

impl Scenario {
    fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "normal" => Scenario::Normal,
            "capabilities-minimal" => Scenario::CapabilitiesMinimal,
            "capabilities-full" => Scenario::CapabilitiesFull,
            "permission" => Scenario::Permission,
            "permission-never-answered" => Scenario::PermissionNeverAnswered,
            "tool-calls" => Scenario::ToolCalls,
            "malformed-json" => Scenario::MalformedJson,
            "non-acp-json" => Scenario::NonAcpJson,
            "stderr-noise" => Scenario::StderrNoise,
            "hang-initialize" => Scenario::HangInitialize,
            "hang-authenticate" => Scenario::HangAuthenticate,
            "fail-reinitialize" => Scenario::FailReinitialize,
            "exit-nonzero-mid-session" => Scenario::ExitNonZeroMidSession,
            "exit-zero-mid-session" => Scenario::ExitZeroMidSession,
            "ignore-termination" => Scenario::IgnoreTermination,
            "oversized-line" => Scenario::OversizedLine,
            _ => return None,
        })
    }
}

fn main() {
    let scenario = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("POLY_MOCK_SCENARIO").ok())
        .and_then(|value| Scenario::parse(&value))
        .unwrap_or(Scenario::Normal);

    if scenario == Scenario::IgnoreTermination {
        ignore_termination_signals();
    }

    let stdin = std::io::stdin();
    let mut lines = stdin.lock().lines();
    let mut initialize_count = 0;

    while let Some(Ok(line)) = lines.next() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(message) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let method = message.get("method").and_then(|value| value.as_str());
        let id = message.get("id").cloned();

        match (method, id) {
            (Some("initialize"), Some(id)) => {
                initialize_count += 1;
                handle_initialize(scenario, initialize_count, &id);
            }
            (Some("session/new"), Some(id)) => handle_new_session(scenario, &id),
            (Some("session/prompt"), Some(id)) => handle_prompt(scenario, &id),
            (Some("authenticate"), Some(_)) if scenario == Scenario::HangAuthenticate => {}
            (Some("authenticate"), Some(id)) => respond(&id, serde_json::json!({})),
            // A request we do not model still gets an answer, so the host is
            // never left waiting on something this mock simply does not do.
            (Some(_), Some(id)) => respond_error(&id, -32601, "method not found"),
            _ => {}
        }
    }
}

fn handle_initialize(scenario: Scenario, count: usize, id: &serde_json::Value) {
    if scenario == Scenario::HangInitialize {
        // Accept the request, answer nothing, and stay alive so the host has to
        // hit its own startup timeout rather than observing EOF.
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3600));
        }
    }

    if scenario == Scenario::MalformedJson {
        emit_raw("{ this is not json at all");
    }
    if scenario == Scenario::NonAcpJson {
        // Well-formed JSON, not a JSON-RPC message.
        emit_raw(r#"{"hello":"world","numbers":[1,2,3]}"#);
        // Well-formed JSON-RPC shape, unknown method, no id — unroutable.
        emit_raw(r#"{"jsonrpc":"2.0","method":"totally/unknown","params":{}}"#);
    }
    if scenario == Scenario::StderrNoise {
        for index in 0..2000 {
            eprintln!("mock stderr noise line {index} — this must not disturb the protocol");
        }
    }
    if scenario == Scenario::OversizedLine {
        emit_raw(&"x".repeat(1024 * 1024 + 1));
        return;
    }
    if scenario == Scenario::FailReinitialize && count > 1 {
        respond_error(id, 401, "sign-in was not confirmed");
        return;
    }

    respond(
        id,
        serde_json::json!({
            "protocolVersion": 1,
            "agentCapabilities": capabilities(scenario),
            "authMethods": auth_methods(scenario),
            "agentInfo": { "name": "poly-mock-agent", "version": "0.0.0" },
        }),
    );
}

fn capabilities(scenario: Scenario) -> serde_json::Value {
    match scenario {
        // Everything omitted. The host must not read absence as support.
        Scenario::CapabilitiesMinimal => serde_json::json!({}),
        Scenario::CapabilitiesFull => serde_json::json!({
            "loadSession": true,
            "promptCapabilities": {
                "image": true,
                "audio": true,
                "embeddedContext": true,
            },
            "mcpCapabilities": { "http": true, "sse": true },
            "sessionCapabilities": {
                "list": {},
                "delete": {},
                "additionalDirectories": {},
            },
        }),
        _ => serde_json::json!({
            "loadSession": true,
            "promptCapabilities": { "image": true, "embeddedContext": true },
            "mcpCapabilities": {},
            "sessionCapabilities": {},
        }),
    }
}

fn auth_methods(scenario: Scenario) -> serde_json::Value {
    match scenario {
        Scenario::CapabilitiesMinimal => serde_json::json!([]),
        _ => serde_json::json!([
            { "id": "mock-login", "name": "Mock Login", "description": "A pretend login" },
        ]),
    }
}

fn handle_new_session(_scenario: Scenario, id: &serde_json::Value) {
    respond(id, serde_json::json!({ "sessionId": "mock-session-1" }));
}

fn handle_prompt(scenario: Scenario, id: &serde_json::Value) {
    let session_id = "mock-session-1";

    match scenario {
        Scenario::ExitZeroMidSession => {
            stream_chunk(session_id, "partial output before a clean exit");
            flush();
            std::process::exit(0);
        }
        Scenario::ExitNonZeroMidSession => {
            stream_chunk(session_id, "partial output before a crash");
            eprintln!("mock agent is about to fail");
            flush();
            std::process::exit(7);
        }
        Scenario::Permission | Scenario::PermissionNeverAnswered => {
            request_permission(session_id);
            if scenario == Scenario::PermissionNeverAnswered {
                // Leave the turn open forever: the request is outstanding when
                // the host cancels or the process is killed.
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(3600));
                }
            }
            stream_chunk(session_id, "done after permission");
        }
        Scenario::ToolCalls => {
            emit_update(
                session_id,
                serde_json::json!({
                    "sessionUpdate": "tool_call",
                    "toolCallId": "call-1",
                    "title": "Read src/main.rs",
                    "kind": "read",
                    "status": "pending",
                    "locations": [{ "path": "/tmp/poly-mock/src/main.rs" }],
                }),
            );
            emit_update(
                session_id,
                serde_json::json!({
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": "call-1",
                    "status": "in_progress",
                }),
            );
            emit_update(
                session_id,
                serde_json::json!({
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": "call-1",
                    "status": "completed",
                    "content": [{ "type": "content", "content": { "type": "text", "text": "fn main() {}" } }],
                }),
            );
            stream_chunk(session_id, "read the file");
        }
        Scenario::IgnoreTermination => {
            stream_chunk(session_id, "streaming forever");
            loop {
                std::thread::sleep(std::time::Duration::from_secs(3600));
            }
        }
        _ => {
            emit_update(
                session_id,
                serde_json::json!({
                    "sessionUpdate": "agent_thought_chunk",
                    "content": { "type": "text", "text": "thinking about it" },
                }),
            );
            for part in ["Hello", ", ", "world"] {
                stream_chunk(session_id, part);
            }
        }
    }

    respond(id, serde_json::json!({ "stopReason": "end_turn" }));
}

fn request_permission(session_id: &str) {
    // A request from agent to client. The mock does not wait for the answer:
    // the host's behavior under an unanswered request is what the tests check.
    emit_raw(
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": 9001,
            "method": "session/request_permission",
            "params": {
                "sessionId": session_id,
                "toolCall": {
                    "toolCallId": "call-danger",
                    "title": "Run rm -rf /tmp/poly-mock-scratch",
                    "kind": "execute",
                    "status": "pending",
                    "locations": [{ "path": "/tmp/poly-mock-scratch" }],
                    "rawInput": { "command": "rm -rf /tmp/poly-mock-scratch" },
                },
                "options": [
                    { "optionId": "allow-once", "name": "Allow once", "kind": "allow_once" },
                    { "optionId": "allow-always", "name": "Always allow", "kind": "allow_always" },
                    { "optionId": "reject-once", "name": "Reject", "kind": "reject_once" },
                ],
            },
        })
        .to_string(),
    );
}

fn stream_chunk(session_id: &str, text: &str) {
    emit_update(
        session_id,
        serde_json::json!({
            "sessionUpdate": "agent_message_chunk",
            "content": { "type": "text", "text": text },
        }),
    );
}

/// `session/update` params are `{ sessionId, update: { sessionUpdate, … } }`.
/// The update object is nested, not flattened alongside `sessionId`.
fn emit_update(session_id: &str, update: serde_json::Value) {
    emit_raw(
        &serde_json::json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": { "sessionId": session_id, "update": update },
        })
        .to_string(),
    );
}

fn respond(id: &serde_json::Value, result: serde_json::Value) {
    emit_raw(&serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result }).to_string());
}

fn respond_error(id: &serde_json::Value, code: i64, message: &str) {
    emit_raw(
        &serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message },
        })
        .to_string(),
    );
}

fn emit_raw(line: &str) {
    let stdout = std::io::stdout();
    let mut stdout = stdout.lock();
    let _ = writeln!(stdout, "{line}");
    let _ = stdout.flush();
}

fn flush() {
    let _ = std::io::stdout().flush();
    let _ = std::io::stderr().flush();
}

/// Make the process survive a polite termination request, so the host must
/// escalate to a hard kill within its bounded wait.
#[cfg(unix)]
fn ignore_termination_signals() {
    // SAFETY: `signal` with `SIG_IGN` is async-signal-safe and this runs before
    // any other thread exists.
    unsafe {
        libc::signal(libc::SIGTERM, libc::SIG_IGN);
        libc::signal(libc::SIGINT, libc::SIG_IGN);
        libc::signal(libc::SIGHUP, libc::SIG_IGN);
    }
}

#[cfg(windows)]
fn ignore_termination_signals() {
    // Windows has no graceful signal for a non-console child; the host goes
    // straight to TerminateProcess via the job object. Nothing to ignore.
}
