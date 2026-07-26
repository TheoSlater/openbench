//! The helper's side of the pipe.
//!
//! Two streams, both on the child's stdio:
//!
//! - **stdin**, newline-delimited JSON: one [`Command`] per line, fire and
//!   forget. No responses, no correlation ids; failures come back as
//!   [`Tag::Error`].
//! - **the rescued stdout fd**, binary: `u32 le length | u8 tag | u32 le id |
//!   payload`, where `length` counts the tag, id and payload.
//!
//! `Tag::Frame` payloads are the exact packet `frame::encode_frame` produces,
//! so the main process forwards them into the frontend channel without
//! parsing, and `cefFrame.ts` never learns a process boundary exists.

use std::io::Write;
use std::sync::{Arc, Mutex};

/// Identifies which browser a message belongs to. One helper hosts many.
pub type BrowserId = u32;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum Tag {
    Frame = 0,
    Cursor = 1,
    Address = 2,
    NavState = 3,
    Error = 4,
}

/// Commands the main process sends. `id` names the browser; `open` creates it.
#[derive(serde::Deserialize)]
#[serde(tag = "cmd", rename_all = "camelCase")]
pub enum Command {
    #[serde(rename_all = "camelCase")]
    Open {
        id: BrowserId,
        url: String,
        width: i32,
        height: i32,
        scale_factor: f32,
    },
    #[serde(rename_all = "camelCase")]
    Resize {
        id: BrowserId,
        width: i32,
        height: i32,
        scale_factor: f32,
    },
    #[serde(rename_all = "camelCase")]
    Navigate { id: BrowserId, url: String },
    #[serde(rename_all = "camelCase")]
    Back { id: BrowserId },
    #[serde(rename_all = "camelCase")]
    Forward { id: BrowserId },
    #[serde(rename_all = "camelCase")]
    Reload { id: BrowserId },
    #[serde(rename_all = "camelCase")]
    Close { id: BrowserId },
    #[serde(rename_all = "camelCase")]
    Input {
        id: BrowserId,
        events: Vec<crate::input::CefInputEvent>,
    },
    /// Tear the whole helper down. Sent on app exit.
    #[serde(rename_all = "camelCase")]
    Shutdown,
}

/// Navigation state mirrored from CEF's `on_loading_state_change`.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavState {
    pub is_loading: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
}

/// Writes framed messages to the main process.
///
/// Cloneable and `Send` because cef-rs's `wrap_*!` macros clone handler structs
/// and hand them to Chromium's threads. The mutex serialises whole messages, so
/// a frame written from CEF's UI thread can never interleave with an error
/// written from anywhere else.
#[derive(Clone)]
pub struct Sink {
    out: Arc<Mutex<Box<dyn Write + Send>>>,
}

impl Sink {
    pub fn new(out: Box<dyn Write + Send>) -> Self {
        Self {
            out: Arc::new(Mutex::new(out)),
        }
    }

    pub fn send(&self, tag: Tag, id: BrowserId, payload: &[u8]) {
        let Ok(length) = u32::try_from(payload.len() + 5) else {
            return;
        };
        let mut out = match self.out.lock() {
            Ok(out) => out,
            Err(poisoned) => poisoned.into_inner(),
        };
        // A broken pipe means the main process is gone; there is nothing useful
        // to do about it here, and the helper exits when stdin closes.
        let _ = out.write_all(&length.to_le_bytes());
        let _ = out.write_all(&[tag as u8]);
        let _ = out.write_all(&id.to_le_bytes());
        let _ = out.write_all(payload);
        let _ = out.flush();
    }

    pub fn error(&self, id: BrowserId, message: &str) {
        self.send(Tag::Error, id, message.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone)]
    struct Shared(Arc<Mutex<Vec<u8>>>);

    impl Write for Shared {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn message_is_length_prefixed_with_tag_and_id() {
        let buffer = Arc::new(Mutex::new(Vec::new()));
        let sink = Sink::new(Box::new(Shared(buffer.clone())));

        sink.send(Tag::Frame, 7, &[0xAA, 0xBB]);

        let bytes = buffer.lock().unwrap().clone();
        assert_eq!(&bytes[0..4], &7u32.to_le_bytes()); // 1 tag + 4 id + 2 payload
        assert_eq!(bytes[4], Tag::Frame as u8);
        assert_eq!(&bytes[5..9], &7u32.to_le_bytes());
        assert_eq!(&bytes[9..], &[0xAA, 0xBB]);
    }

    #[test]
    fn commands_parse_from_the_frontend_wire_shape() {
        let open: Command = serde_json::from_str(
            r#"{"cmd":"open","id":1,"url":"https://example.com","width":800,"height":600,"scaleFactor":1.0}"#,
        )
        .expect("open parses");
        assert!(matches!(open, Command::Open { id: 1, .. }));

        let back: Command = serde_json::from_str(r#"{"cmd":"back","id":2}"#).expect("back parses");
        assert!(matches!(back, Command::Back { id: 2 }));

        assert!(serde_json::from_str::<Command>(r#"{"cmd":"nope","id":1}"#).is_err());
    }
}
