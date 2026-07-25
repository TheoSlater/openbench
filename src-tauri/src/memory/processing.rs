use crate::memory::types::MemoryCompletedTurnRecordInput;

pub fn completed_turn_id(
    conversation_id: &str,
    user_message_id: &str,
    assistant_message_id: &str,
) -> String {
    format!("{conversation_id}:{user_message_id}:{assistant_message_id}")
}

pub fn is_substantive_turn(input: &MemoryCompletedTurnRecordInput) -> bool {
    let user = input.user_content.trim();
    let assistant = input.assistant_content.trim();
    user.chars().filter(|c| !c.is_whitespace()).count() >= 3
        && assistant.chars().filter(|c| !c.is_whitespace()).count() >= 3
}

pub fn is_completed_success(input: &MemoryCompletedTurnRecordInput) -> bool {
    matches!(
        input.assistant_status.as_deref().unwrap_or("complete"),
        "complete" | "completed"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(user: &str, assistant: &str, status: Option<&str>) -> MemoryCompletedTurnRecordInput {
        MemoryCompletedTurnRecordInput {
            owner_id: "user-1".to_string(),
            conversation_id: "chat-1".to_string(),
            user_message_id: "user-msg".to_string(),
            assistant_message_id: "assistant-msg".to_string(),
            user_scope_owner_id: Some("user-1".to_string()),
            project_scope_owner_id: None,
            chat_scope_owner_id: Some("chat-1".to_string()),
            skip_reason: None,
            user_content: user.to_string(),
            assistant_content: assistant.to_string(),
            assistant_status: status.map(str::to_string),
        }
    }

    #[test]
    fn turn_id_is_stable() {
        assert_eq!(completed_turn_id("c", "u", "a"), "c:u:a");
    }

    #[test]
    fn rejects_empty_turns() {
        assert!(!is_substantive_turn(&input("ok", "", Some("complete"))));
    }

    #[test]
    fn accepts_complete_status_only() {
        assert!(is_completed_success(&input(
            "hello",
            "answer",
            Some("complete")
        )));
        assert!(!is_completed_success(&input(
            "hello",
            "answer",
            Some("aborted")
        )));
        assert!(!is_completed_success(&input(
            "hello",
            "answer",
            Some("error")
        )));
    }
}
