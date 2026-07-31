use super::protocol::SidecarRecord;

#[test]
fn crash_records_cannot_embed_provider_payloads() {
    assert!(serde_json::from_str::<SidecarRecord>(
        r#"{"type":"error","requestId":"r1","error":"runtime stopped"}"#,
    )
    .is_ok());
}
