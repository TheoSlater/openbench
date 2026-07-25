use crate::auth::{authorize_account, AuthError};
use crate::error::AppError;
use crate::models::chat::ModelDetails;
use crate::providers::base::{ProviderConfig, ProviderStatus, ProviderType};
use crate::providers::factory::ProviderFactory;
use crate::AppState;

fn map_auth_err(error: AuthError) -> String {
    match error {
        AuthError::SessionExpired => "Session expired".to_string(),
        _ => "Not authorized for this account".to_string(),
    }
}

async fn check_account(
    state: &tauri::State<'_, AppState>,
    token: Option<&str>,
    account_id: Option<&str>,
) -> Result<(), String> {
    match account_id {
        Some(id) => authorize_account(&state.db, token, id)
            .await
            .map_err(map_auth_err),
        None => Ok(()),
    }
}

#[derive(serde::Serialize)]
pub struct ProviderStatusResponse {
    pub provider_type: ProviderType,
    pub status: ProviderStatus,
    pub config: ProviderConfig,
}

#[derive(serde::Serialize)]
pub struct ProviderAndModelsResponse {
    pub providers: Vec<ProviderStatusResponse>,
    pub models: Vec<ModelDetails>,
}

fn normalize_account_arg(account_id: Option<String>) -> Option<String> {
    account_id
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
}

fn should_preload_models(provider_type: ProviderType) -> bool {
    matches!(
        provider_type,
        ProviderType::OllamaLocal
            | ProviderType::OpenAICompatible
            | ProviderType::AnthropicNative
            | ProviderType::GeminiNative
    )
}

async fn try_preload_models(
    config: &ProviderConfig,
) -> Option<(Vec<ModelDetails>, ProviderStatus)> {
    let provider = ProviderFactory::create_model_catalog(config.clone())?;
    let result = match tokio::time::timeout(
        std::time::Duration::from_secs(10),
        provider.get_available_models(),
    )
    .await
    {
        Ok(Ok(models)) => (
            models
                .into_iter()
                .map(|mut model| {
                    model.provider_config_id = Some(config.id);
                    model
                })
                .collect(),
            ProviderStatus::Online,
        ),
        Ok(Err(error)) => {
            eprintln!(
                "[Providers] Failed to list {:?} models: {error}",
                provider.get_provider_type()
            );
            (Vec::new(), ProviderStatus::Offline)
        }
        Err(_) => {
            eprintln!(
                "[Providers] Timed out listing {:?} models",
                provider.get_provider_type()
            );
            (Vec::new(), ProviderStatus::Offline)
        }
    };
    Some(result)
}

fn config_health_key(config: &ProviderConfig) -> i64 {
    config.id
}

#[tauri::command]
pub async fn get_providers(
    state: tauri::State<'_, AppState>,
    account_id: Option<String>,
    token: Option<String>,
) -> Result<Vec<ProviderStatusResponse>, String> {
    let account_id = normalize_account_arg(account_id);
    check_account(&state, token.as_deref(), account_id.as_deref()).await?;
    let selector = &state.provider_selector;
    let configs = selector
        .get_provider_configs(account_id.as_deref())
        .await
        .map_err(|e| AppError::Db(e).to_string())?;
    let health = selector.check_all_providers(account_id.as_deref()).await;

    let mut response = Vec::new();
    for config in configs {
        let key = config_health_key(&config);
        let status = health.get(&key).cloned().unwrap_or(ProviderStatus::Offline);
        response.push(ProviderStatusResponse {
            provider_type: config.provider_type,
            status,
            config,
        });
    }
    Ok(response)
}

#[tauri::command]
pub async fn get_provider_and_models(
    state: tauri::State<'_, AppState>,
    account_id: Option<String>,
    token: Option<String>,
) -> Result<ProviderAndModelsResponse, String> {
    let account_id = normalize_account_arg(account_id);
    check_account(&state, token.as_deref(), account_id.as_deref()).await?;
    let selector = &state.provider_selector;
    let configs = selector
        .get_provider_configs(account_id.as_deref())
        .await
        .map_err(|e| AppError::Db(e).to_string())?;
    let health = selector.check_all_providers(account_id.as_deref()).await;

    let mut providers = Vec::new();
    let mut models = Vec::new();
    for config in configs {
        let key = config_health_key(&config);
        let mut status = health.get(&key).cloned().unwrap_or(ProviderStatus::Offline);
        if status == ProviderStatus::Online && should_preload_models(config.provider_type) {
            if let Some((preloaded_models, preload_status)) = try_preload_models(&config).await {
                models.extend(preloaded_models);
                status = preload_status;
            }
        }
        providers.push(ProviderStatusResponse {
            provider_type: config.provider_type,
            status,
            config: config.clone(),
        });
    }

    Ok(ProviderAndModelsResponse { providers, models })
}

#[tauri::command]
pub async fn get_provider_models(
    state: tauri::State<'_, AppState>,
    provider_type: ProviderType,
    account_id: Option<String>,
    token: Option<String>,
) -> Result<Vec<ModelDetails>, String> {
    let account_id = normalize_account_arg(account_id);
    check_account(&state, token.as_deref(), account_id.as_deref()).await?;
    let configs = state
        .provider_selector
        .get_provider_configs(account_id.as_deref())
        .await?;
    let mut models = Vec::new();

    for config in configs
        .into_iter()
        .filter(|config| config.provider_type == provider_type && config.enabled)
    {
        if let Some((provider_models, _)) = try_preload_models(&config).await {
            models.extend(provider_models);
        }
    }

    Ok(models)
}

#[derive(serde::Deserialize)]
pub struct UpdateProviderConfigRequest {
    pub provider_type: ProviderType,
    pub enabled: bool,
    pub id: i64,
    #[serde(default)]
    pub ollama_host: Option<String>,
    #[serde(default)]
    pub ollama_api_key: Option<String>,
    #[serde(default)]
    pub ollama_api_base_url: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub api_base_url: Option<String>,
    #[serde(default)]
    pub preset: Option<String>,
    #[serde(default)]
    pub headers: Option<String>,
    #[serde(default)]
    pub model_suggestions: Option<String>,
}

#[tauri::command]
pub async fn update_provider_config(
    state: tauri::State<'_, AppState>,
    request: UpdateProviderConfigRequest,
    account_id: Option<String>,
    token: Option<String>,
) -> Result<(), String> {
    let account_id = normalize_account_arg(account_id);
    check_account(&state, token.as_deref(), account_id.as_deref()).await?;
    state
        .provider_selector
        .update_provider_config(
            account_id.as_deref(),
            request.id,
            &request.provider_type,
            request.enabled,
            request.ollama_host,
            request.ollama_api_key,
            request.ollama_api_base_url,
            request.api_key,
            request.api_base_url,
            request.preset,
            request.headers,
            request.model_suggestions,
        )
        .await
        .map_err(|e| AppError::Db(e).to_string())
}

#[derive(serde::Deserialize)]
pub struct AddProviderRequest {
    pub provider_type: ProviderType,
    pub enabled: bool,
    #[serde(default)]
    pub ollama_host: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub api_base_url: Option<String>,
    #[serde(default)]
    pub preset: Option<String>,
    #[serde(default)]
    pub headers: Option<String>,
    #[serde(default)]
    pub model_suggestions: Option<String>,
}

#[tauri::command]
pub async fn add_provider(
    state: tauri::State<'_, AppState>,
    request: AddProviderRequest,
    account_id: Option<String>,
    token: Option<String>,
) -> Result<i64, String> {
    let account_id = normalize_account_arg(account_id);
    check_account(&state, token.as_deref(), account_id.as_deref()).await?;
    state
        .provider_selector
        .add_provider_config(
            account_id.as_deref(),
            &request.provider_type,
            request.enabled,
            request.ollama_host,
            request.api_key,
            request.api_base_url,
            request.preset,
            request.headers,
            request.model_suggestions,
        )
        .await
        .map_err(|e| AppError::Db(e).to_string())
}

#[tauri::command]
pub async fn delete_provider(
    state: tauri::State<'_, AppState>,
    account_id: Option<String>,
    id: i64,
    token: Option<String>,
) -> Result<(), String> {
    let account_id = normalize_account_arg(account_id);
    check_account(&state, token.as_deref(), account_id.as_deref()).await?;
    state
        .provider_selector
        .delete_provider_config(account_id.as_deref(), id)
        .await
        .map_err(|e| AppError::Db(e).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preloads_models_for_all_providers() {
        assert!(should_preload_models(ProviderType::OllamaLocal));
        assert!(should_preload_models(ProviderType::OpenAICompatible));
    }
}
