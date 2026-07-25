mod content_results;
mod exa;
pub mod local;
mod ollama;
mod tavily;

use crate::models::chat::SearchResultItem;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

pub use exa::ExaWebSearchClient;
pub use ollama::OllamaWebSearchClient;
pub use tavily::TavilyWebSearchClient;

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WebSearchProvider {
    Local,
    #[default]
    Exa,
    Ollama,
    Tavily,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchConfig {
    pub provider: WebSearchProvider,
    pub api_key: String,
}

impl WebSearchConfig {
    pub fn is_configured(&self) -> bool {
        self.provider == WebSearchProvider::Local || !self.api_key.trim().is_empty()
    }
}

#[async_trait]
pub trait WebSearchClient: Send + Sync {
    fn provider(&self) -> WebSearchProvider;
    async fn search(&self, query: &str, api_key: &str) -> Result<Vec<SearchResultItem>, String>;
}

pub fn create_web_search_client(config: &WebSearchConfig) -> Box<dyn WebSearchClient> {
    match config.provider {
        WebSearchProvider::Local => Box::new(LocalWebSearchClient),
        WebSearchProvider::Exa => Box::new(ExaWebSearchClient),
        WebSearchProvider::Ollama => Box::new(OllamaWebSearchClient),
        WebSearchProvider::Tavily => Box::new(TavilyWebSearchClient),
    }
}

pub struct LocalWebSearchClient;

#[async_trait]
impl WebSearchClient for LocalWebSearchClient {
    fn provider(&self) -> WebSearchProvider {
        WebSearchProvider::Local
    }

    async fn search(&self, query: &str, _api_key: &str) -> Result<Vec<SearchResultItem>, String> {
        let response = local::search_web(local::types::SearchWebRequest {
            query: query.to_string(),
            max_results: Some(8),
            freshness: None,
            include_domains: Vec::new(),
            exclude_domains: Vec::new(),
        })
        .await;
        if response.results.is_empty() && !response.providers_failed.is_empty() {
            return Err(response
                .providers_failed
                .iter()
                .map(|f| format!("{}: {}", f.provider, f.error))
                .collect::<Vec<_>>()
                .join("; "));
        }
        Ok(response
            .results
            .into_iter()
            .map(|result| SearchResultItem {
                title: result.title,
                url: result.url,
                highlights: vec![result.snippet],
            })
            .collect())
    }
}

fn truncate_highlight(value: String) -> String {
    let mut chars = value.chars();
    let truncated: String = chars.by_ref().take(180).collect();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

#[cfg(test)]
pub mod test {
    use super::*;

    #[test]
    fn creates_tavily_client_from_provider_config() {
        let config = WebSearchConfig {
            provider: WebSearchProvider::Tavily,
            api_key: "tvly-test".into(),
        };

        let client = create_web_search_client(&config);

        assert_eq!(client.provider(), WebSearchProvider::Tavily);
    }

    #[test]
    fn creates_ollama_client_from_provider_config() {
        let config = WebSearchConfig {
            provider: WebSearchProvider::Ollama,
            api_key: "ollama-test".into(),
        };

        let client = create_web_search_client(&config);

        assert_eq!(client.provider(), WebSearchProvider::Ollama);
    }

    #[test]
    fn deserializes_frontend_web_search_config() {
        let config: WebSearchConfig = serde_json::from_value(serde_json::json!({
            "provider": "tavily",
            "apiKey": "tvly-test"
        }))
        .unwrap();

        assert_eq!(config.provider, WebSearchProvider::Tavily);
        assert_eq!(config.api_key, "tvly-test");
    }

    #[test]
    fn normalizes_tavily_results_to_shared_search_items() {
        let response = content_results::ContentResultsResponse {
            results: vec![content_results::ContentResult {
                title: "Lionel Messi".into(),
                url: "https://example.com/messi".into(),
                content: "Footballer profile".into(),
            }],
        };

        assert_eq!(
            content_results::normalize_results(response),
            vec![SearchResultItem {
                title: "Lionel Messi".into(),
                url: "https://example.com/messi".into(),
                highlights: vec!["Footballer profile".into()],
            }]
        );
    }

    #[test]
    fn normalizes_ollama_results_to_shared_search_items() {
        let response = content_results::ContentResultsResponse {
            results: vec![content_results::ContentResult {
                title: "Ollama".into(),
                url: "https://ollama.com".into(),
                content: "Run models locally".into(),
            }],
        };

        assert_eq!(
            content_results::normalize_results(response),
            vec![SearchResultItem {
                title: "Ollama".into(),
                url: "https://ollama.com".into(),
                highlights: vec!["Run models locally".into()],
            }]
        );
    }
}
