use serde::Deserialize;

#[derive(Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}
