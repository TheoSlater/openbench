use super::protocol::SidecarRecord;
use super::{wait_for_response, WaitError};
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::{oneshot, Mutex};

#[test]
fn crash_records_cannot_embed_provider_payloads() {
    assert!(serde_json::from_str::<SidecarRecord>(
        r#"{"type":"error","requestId":"r1","error":"runtime stopped"}"#,
    )
    .is_ok());
}

#[tokio::test]
async fn timed_out_response_is_removed() {
    let pending = Mutex::new(HashMap::new());
    let (sender, receiver) = oneshot::channel();
    pending.lock().await.insert("slow".into(), sender);

    assert_eq!(
        wait_for_response(&pending, "slow", receiver, Duration::from_millis(1)).await,
        Err(WaitError::TimedOut),
    );
    assert!(pending.lock().await.is_empty());
}
