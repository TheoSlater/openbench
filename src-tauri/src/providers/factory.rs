use crate::providers::anthropic::AnthropicNativeProvider;
use crate::providers::base::{
    ChatProvider, LocalModelManager, ModelCatalog, ProviderConfig, ProviderType,
};
use crate::providers::gemini::GeminiNativeProvider;
use crate::providers::ollama::OllamaProvider;
use crate::providers::openai_compatible::OpenAICompatibleProvider;
use crate::providers::profile::ProviderProfile;

pub struct ProviderFactory;

impl ProviderFactory {
    pub fn create_chat_provider(config: ProviderConfig) -> Option<Box<dyn ChatProvider>> {
        let profile = ProviderProfile::from_config(config);
        if !profile.enabled {
            return None;
        }

        match profile.provider_type {
            ProviderType::OllamaLocal => Some(Box::new(OllamaProvider::new(
                profile.endpoint,
                ProviderType::OllamaLocal,
                profile.api_key,
            ))),
            ProviderType::OpenAICompatible => Some(Box::new(OpenAICompatibleProvider::new(
                profile.endpoint,
                profile.api_key.unwrap_or_default(),
                profile.headers,
            ))),
            ProviderType::AnthropicNative => Some(Box::new(AnthropicNativeProvider::new(
                profile.endpoint,
                profile.api_key,
            ))),
            ProviderType::GeminiNative => Some(Box::new(GeminiNativeProvider::new(
                profile.endpoint,
                profile.api_key,
            ))),
        }
    }

    pub fn create_model_catalog(config: ProviderConfig) -> Option<Box<dyn ModelCatalog>> {
        let profile = ProviderProfile::from_config(config);
        if !profile.enabled {
            return None;
        }

        match profile.provider_type {
            ProviderType::OllamaLocal => Some(Box::new(OllamaProvider::new(
                profile.endpoint,
                ProviderType::OllamaLocal,
                profile.api_key,
            ))),
            ProviderType::OpenAICompatible => Some(Box::new(OpenAICompatibleProvider::new(
                profile.endpoint,
                profile.api_key.unwrap_or_default(),
                profile.headers,
            ))),
            ProviderType::AnthropicNative => Some(Box::new(AnthropicNativeProvider::new(
                profile.endpoint,
                profile.api_key,
            ))),
            ProviderType::GeminiNative => Some(Box::new(GeminiNativeProvider::new(
                profile.endpoint,
                profile.api_key,
            ))),
        }
    }

    pub fn create_local_model_manager(
        config: ProviderConfig,
    ) -> Option<Box<dyn LocalModelManager>> {
        let profile = ProviderProfile::from_config(config);
        if !profile.enabled || profile.provider_type != ProviderType::OllamaLocal {
            return None;
        }

        Some(Box::new(OllamaProvider::new(
            profile.endpoint,
            ProviderType::OllamaLocal,
            profile.api_key,
        )))
    }
}
