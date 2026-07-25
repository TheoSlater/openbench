use super::providers::{
    brave::BraveProvider, duckduckgo::DuckDuckGoProvider, mojeek::MojeekProvider, SearchProvider,
};
use super::ranking::rank_and_fuse;
use super::types::{
    ProviderFailure, RawSearchResult, SearchWebRequest, SearchWebResponse, WebSearchError,
};
use reqwest::{redirect::Policy, Client};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const DEFAULT_MAX_RESULTS: usize = 8;
const SEARCH_CACHE_TTL: Duration = Duration::from_secs(10 * 60);

static CLIENT: OnceLock<Client> = OnceLock::new();
static SEARCH_CACHE: OnceLock<Mutex<HashMap<String, (Instant, SearchWebResponse)>>> =
    OnceLock::new();

pub async fn search_web(mut request: SearchWebRequest) -> SearchWebResponse {
    request.query = request.query.trim().to_string();
    let max = request
        .max_results
        .unwrap_or(DEFAULT_MAX_RESULTS)
        .clamp(1, 12);
    let cache_key = cache_key(&request);
    if let Some(cached) = cached_search(&cache_key) {
        return cached;
    }

    let client = http_client();
    let mut raw = Vec::new();
    let mut used = Vec::new();
    let mut failed = Vec::new();
    let first: Vec<Box<dyn SearchProvider>> =
        vec![Box::new(DuckDuckGoProvider), Box::new(MojeekProvider)];

    let (a, b) = tokio::join!(
        run_provider(first[0].as_ref(), client, &request),
        run_provider(first[1].as_ref(), client, &request)
    );
    collect(a, &mut raw, &mut used, &mut failed);
    collect(b, &mut raw, &mut used, &mut failed);

    if unique_count(&raw) < 6 {
        collect(
            run_provider(&BraveProvider, client, &request).await,
            &mut raw,
            &mut used,
            &mut failed,
        );
    }

    raw.retain(|item| domain_allowed(item.url.host_str().unwrap_or_default(), &request));
    let results = rank_and_fuse(&request.query, raw, max);
    let response = SearchWebResponse {
        query: request.query,
        results,
        providers_used: used,
        providers_failed: failed,
        cached: false,
    };
    put_cache(cache_key, response.clone());
    response
}

pub fn http_client() -> &'static Client {
    CLIENT.get_or_init(|| {
        Client::builder()
            .user_agent("PolyUI/0.15 local-web-search")
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(4))
            .redirect(Policy::limited(5))
            .build()
            .expect("web search HTTP client")
    })
}

async fn run_provider(
    provider: &dyn SearchProvider,
    client: &Client,
    request: &SearchWebRequest,
) -> (&'static str, Result<Vec<RawSearchResult>, WebSearchError>) {
    (
        provider.id(),
        tokio::time::timeout(provider.timeout(), provider.search(client, request))
            .await
            .unwrap_or(Err(WebSearchError::Timeout)),
    )
}

fn collect(
    item: (&'static str, Result<Vec<RawSearchResult>, WebSearchError>),
    raw: &mut Vec<RawSearchResult>,
    used: &mut Vec<String>,
    failed: &mut Vec<ProviderFailure>,
) {
    match item.1 {
        Ok(mut results) if !results.is_empty() => {
            used.push(item.0.to_string());
            raw.append(&mut results);
        }
        Ok(_) => failed.push(ProviderFailure {
            provider: item.0.to_string(),
            error: WebSearchError::NoResults.to_string(),
        }),
        Err(error) => failed.push(ProviderFailure {
            provider: item.0.to_string(),
            error: error.to_string(),
        }),
    }
}

fn domain_allowed(domain: &str, request: &SearchWebRequest) -> bool {
    let domain = domain.to_ascii_lowercase();
    let includes: Vec<String> = request
        .include_domains
        .iter()
        .map(|d| d.to_ascii_lowercase())
        .collect();
    let excludes: Vec<String> = request
        .exclude_domains
        .iter()
        .map(|d| d.to_ascii_lowercase())
        .collect();
    (includes.is_empty() || includes.iter().any(|d| domain.ends_with(d)))
        && !excludes.iter().any(|d| domain.ends_with(d))
}

fn unique_count(raw: &[RawSearchResult]) -> usize {
    raw.iter()
        .map(|item| item.url.as_str().trim_end_matches('/').to_string())
        .collect::<std::collections::HashSet<_>>()
        .len()
}

fn cache_key(request: &SearchWebRequest) -> String {
    format!(
        "{}|{:?}|{}|{}",
        request.query.to_ascii_lowercase(),
        request.freshness,
        request.include_domains.join(","),
        request.exclude_domains.join(",")
    )
}

fn cached_search(key: &str) -> Option<SearchWebResponse> {
    let cache = SEARCH_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = cache.lock().ok()?;
    let now = Instant::now();
    guard.retain(|_, (created, _)| now.duration_since(*created) < SEARCH_CACHE_TTL);
    guard.get(key).map(|(_, response)| {
        let mut response = response.clone();
        response.cached = true;
        response
    })
}

fn put_cache(key: String, response: SearchWebResponse) {
    let cache = SEARCH_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut guard) = cache.lock() {
        if guard.len() > 64 {
            guard.clear();
        }
        guard.insert(key, (Instant::now(), response));
    }
}
