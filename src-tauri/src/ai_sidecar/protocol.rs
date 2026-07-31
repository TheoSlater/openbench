use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum SidecarRecord {
    Ready,
    Chunk {
        #[serde(rename = "requestId")]
        request_id: String,
        chunk: serde_json::Value,
    },
    Done {
        #[serde(rename = "requestId")]
        request_id: String,
    },
    Result {
        #[serde(rename = "requestId")]
        request_id: String,
        result: serde_json::Value,
    },
    Error {
        #[serde(rename = "requestId")]
        request_id: String,
        error: String,
    },
    Log {
        level: String,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum AiRuntimeEvent {
    Chunk {
        request_id: String,
        chunk: serde_json::Value,
    },
    Done {
        request_id: String,
    },
    Error {
        request_id: String,
        error: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_ai_sdk_chunks_opaque() {
        let record: SidecarRecord = serde_json::from_str(
            r#"{"type":"chunk","requestId":"r1","chunk":{"type":"data-agent-plan","data":{"secretShape":"untouched"}}}"#,
        )
        .unwrap();
        let SidecarRecord::Chunk { request_id, chunk } = record else {
            panic!("chunk")
        };
        assert_eq!(request_id, "r1");
        assert_eq!(chunk["type"], "data-agent-plan");
        assert_eq!(chunk["data"]["secretShape"], "untouched");
    }

    #[test]
    fn rejects_unknown_protocol_records() {
        assert!(serde_json::from_str::<SidecarRecord>(r#"{"type":"provider-delta"}"#).is_err());
    }
}
