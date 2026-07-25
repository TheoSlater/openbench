use serde::{Deserialize, Serialize};
use std::fmt;
use url::Url;

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Freshness {
    Day,
    Week,
    Month,
    Year,
    #[default]
    Any,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SearchWebRequest {
    pub query: String,
    pub max_results: Option<usize>,
    pub freshness: Option<Freshness>,
    #[serde(default)]
    pub include_domains: Vec<String>,
    #[serde(default)]
    pub exclude_domains: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SearchWebResponse {
    pub query: String,
    pub results: Vec<SearchResult>,
    pub providers_used: Vec<String>,
    pub providers_failed: Vec<ProviderFailure>,
    pub cached: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub url: String,
    pub display_url: String,
    pub snippet: String,
    pub published_at: Option<String>,
    pub providers: Vec<String>,
    pub score: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct ProviderFailure {
    pub provider: String,
    pub error: String,
}

#[derive(Clone, Debug)]
pub struct RawSearchResult {
    pub provider: String,
    pub rank: usize,
    pub title: String,
    pub url: Url,
    pub snippet: String,
    pub published_at: Option<String>,
}

impl RawSearchResult {
    pub fn new(
        provider: impl Into<String>,
        rank: usize,
        title: impl Into<String>,
        url: &str,
        snippet: impl Into<String>,
    ) -> Result<Self, WebSearchError> {
        Ok(Self {
            provider: provider.into(),
            rank,
            title: title.into(),
            url: crate::web_search::local::normalize::normalize_url(url)?,
            snippet: snippet.into(),
            published_at: None,
        })
    }
}

#[derive(Debug)]
#[allow(dead_code)]
pub enum WebSearchError {
    Cancelled,
    Timeout,
    ProviderUnavailable,
    ProviderParseFailed,
    NoResults,
    InvalidUrl,
    BlockedAddress,
    ResponseTooLarge,
    UnsupportedContentType,
    ExtractionFailed,
    DynamicPageUnsupported,
    CacheError,
    Internal,
}

impl fmt::Display for WebSearchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Cancelled => "cancelled",
            Self::Timeout => "timeout",
            Self::ProviderUnavailable => "provider_unavailable",
            Self::ProviderParseFailed => "provider_parse_failed",
            Self::NoResults => "no_results",
            Self::InvalidUrl => "invalid_url",
            Self::BlockedAddress => "blocked_address",
            Self::ResponseTooLarge => "response_too_large",
            Self::UnsupportedContentType => "unsupported_content_type",
            Self::ExtractionFailed => "extraction_failed",
            Self::DynamicPageUnsupported => "dynamic_page_unsupported",
            Self::CacheError => "cache_error",
            Self::Internal => "internal",
        })
    }
}

impl std::error::Error for WebSearchError {}
