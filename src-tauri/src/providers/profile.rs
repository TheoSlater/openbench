use crate::providers::base::{ProviderConfig, ProviderType};

#[derive(Debug, Clone)]
pub struct ProviderProfile {
    pub provider_type: ProviderType,
    pub enabled: bool,
    pub endpoint: String,
    pub api_key: Option<String>,
    pub headers: Option<String>,
}

impl ProviderProfile {
    pub fn from_config(config: ProviderConfig) -> Self {
        let endpoint = match config.provider_type {
            ProviderType::OllamaLocal => config
                .ollama_host
                .unwrap_or_else(|| "http://localhost:11434".to_string()),
            ProviderType::OpenAICompatible => config
                .api_base_url
                .unwrap_or_else(|| "https://api.openai.com/v1".to_string()),
            ProviderType::AnthropicNative => config
                .api_base_url
                .unwrap_or_else(|| "https://api.anthropic.com/v1".to_string()),
            ProviderType::GeminiNative => config
                .api_base_url
                .unwrap_or_else(|| "https://generativelanguage.googleapis.com/v1beta".to_string()),
        };
        let api_key = match config.provider_type {
            ProviderType::OllamaLocal => config.ollama_api_key,
            ProviderType::OpenAICompatible => config.api_key,
            // Both Anthropic and Gemini use the standard api_key field.
            ProviderType::AnthropicNative | ProviderType::GeminiNative => config.api_key,
        };

        Self {
            provider_type: config.provider_type,
            enabled: config.enabled,
            endpoint,
            api_key,
            headers: config.headers,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_config(provider_type: ProviderType) -> ProviderConfig {
        ProviderConfig {
            id: 1,
            account_id: "test".into(),
            provider_type,
            enabled: true,
            ollama_host: None,
            ollama_api_key: None,
            ollama_api_base_url: None,
            api_key: None,
            api_base_url: None,
            priority: 0,
            preset: None,
            headers: None,
            model_suggestions: None,
        }
    }

    #[test]
    fn normalizes_ollama_profile_defaults() {
        let profile = ProviderProfile::from_config(base_config(ProviderType::OllamaLocal));

        assert_eq!(profile.provider_type, ProviderType::OllamaLocal);
        assert_eq!(profile.endpoint, "http://localhost:11434");
        assert_eq!(profile.api_key, None);
    }

    #[test]
    fn normalizes_openai_compatible_profile_defaults() {
        let profile = ProviderProfile::from_config(base_config(ProviderType::OpenAICompatible));

        assert_eq!(profile.provider_type, ProviderType::OpenAICompatible);
        assert_eq!(profile.endpoint, "https://api.openai.com/v1");
        assert_eq!(profile.api_key, None);
    }
}
