//! The ACP host.
//!
//! Poly UI is an ACP *client*: coding agents are external processes that own
//! their own agent loop, tool execution, and session state. This module starts
//! them, speaks the protocol to them, and normalizes what they say into
//! something React can render.
//!
//! Nothing here knows that any particular vendor exists. Adapter detection,
//! authentication, and launch options are per-vendor concerns and land in later
//! checkpoints; this module is what they build on.
//!
//! Layout:
//!
//! - [`resolve`] — finding an executable. Reusable across vendors.
//! - [`lifecycle`] — owning the child process, including Windows job objects.
//! - [`registry`] — one owner per process, plus the conversation-to-session map
//!   and the bounded event queue.
//! - [`capabilities`] — what an agent said it can do, read only from its own
//!   initialize response.
//! - [`events`] — the normalized event enum React consumes.
//! - [`permission`] — normalizing permission requests. Never auto-answered.
//! - [`error`] — one error type, every variant actionable.
//! - [`host`] — the connection task that ties them together.

// The host lands in this checkpoint; its Tauri command surface and the UI
// arrive in checkpoints 4 through 7. Until then several accessors are exercised
// only by tests, which does not count as use.
#![allow(dead_code)]

pub mod capabilities;
pub mod error;
pub mod events;
pub mod host;
pub mod lifecycle;
pub mod permission;
pub mod probe;
pub mod registry;
pub mod resolve;
pub mod verification;

#[cfg(test)]
mod host_tests;

#[cfg(test)]
mod probe_contract_tests {
    use super::probe::{classify_auth_exit, AuthenticationState};

    #[test]
    fn auth_exit_classifies_logged_in_logged_out_and_invalid_config() {
        assert_eq!(classify_auth_exit(0, ""), AuthenticationState::LoggedIn);
        assert_eq!(
            classify_auth_exit(1, "credentials missing"),
            AuthenticationState::LoggedOut
        );
        assert!(matches!(
            classify_auth_exit(
                1,
                "Error loading configuration from config.toml: unknown variant `broken`"
            ),
            AuthenticationState::ConfigInvalid { .. }
        ));
    }

    #[test]
    fn config_invalid_requires_two_distinctive_phrases() {
        assert_eq!(
            classify_auth_exit(1, "unknown variant"),
            AuthenticationState::LoggedOut
        );
        assert_eq!(
            classify_auth_exit(1, "error loading configuration"),
            AuthenticationState::LoggedOut
        );
    }
}

#[cfg(test)]
mod initialize_contract_tests {
    #[test]
    fn terminal_auth_capabilities_are_sent_with_initialize() {
        let json =
            serde_json::to_value(super::host::client_initialize_request()).expect("serialize");
        assert_eq!(json["clientCapabilities"]["auth"]["terminal"], true);
        assert_eq!(json["_meta"]["terminal-auth"], true);
    }
}
