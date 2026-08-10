# Generative search-backed UI cards

## Goal

When structured weather data is unavailable, PolyUI must use the existing
`web_search` model tool, let the model extract current facts from the returned
results, and then render those facts through the existing weather card tool.
Stock cards use the same search-then-structured-render flow. The Open-Meteo
weather path remains the fast path.

## Options considered

1. Keep searching inside `displayWeather`/`getStockPrice` and parse snippets in
   the sidecar. Rejected: the model cannot summarize the results, and parsing
   provider-specific snippets duplicates search logic.
2. Add a second hidden model call dedicated to summarization. Rejected: it adds
   latency and a second orchestration path when the existing AI SDK tool loop
   already handles tool results and follow-up calls.
3. Use the existing tool loop: search is a first-class tool call, then the
   model calls the card tool with typed values. Chosen: one canonical flow,
   visible citations, and no new provider or dependency.

## Design

`displayWeather` accepts a location. With no structured data it queries
Open-Meteo and returns the current weather. If that request fails, it returns a
non-error `needs-web-search` result containing the location and recovery
instruction. The model then calls `web_search`, summarizes the returned
snippets, and calls `displayWeather` again with normalized values. The tool
does not call `searchWeb` itself.

`getStockPrice` is a renderer backed by structured input. If called before
search, it returns `needs-web-search`; the model then calls `web_search` and
retries with the symbol, price, currency, change, percentage change, market
status, timestamp, and concise summary it extracted. The tool does not perform
an invisible search.

Weather values use Celsius and metres per second in the card contract. Stock
values preserve the source currency and use numeric price/change fields.
Optional source title/URL and summary fields are accepted so the card can
explain what it is showing; web-search source events remain the citation
boundary.

The system prompt and tool descriptions explicitly define the sequence and
tell the model not to place raw search results into a card tool. The existing
source-url stream transform continues to emit citations from the actual
`web_search` call.

## UI

The weather card accepts both Open-Meteo and search-backed output, showing the
source label, location, temperature, wind, optional condition, and optional
summary. The stock card replaces the generic result-link list with the
structured price, change, currency, market status, timestamp, summary, and
source link when supplied. Invalid or incomplete output remains an explicit
error card; loading and `needs-web-search` states are clear and non-blocking.

## Error handling

- Open-Meteo errors become a recoverable tool result, so the model can search.
- Search errors remain `tool-output-error` and the assistant can explain the
  unavailable data.
- Structured values are validated at the tool boundary and again before UI
  rendering; URLs accept only HTTP(S).
- Missing optional search facts do not fabricate values; cards omit those
  fields and retain the source summary/citation.

## Verification

- Update sidecar runtime tests for the Open-Meteo success path, the
  Open-Meteo → `web_search` → weather-card path, and the stock search-card
  path.
- Add a focused component test for weather and stock structured rendering.
- Run the focused Vitest tests, sidecar typecheck, and the full TypeScript/Vite
  build.

## Scope

No new search provider, caching layer, parser, database state, or compatibility
format is added. The unrelated existing `src-tauri/Cargo.toml` worktree edit
is preserved and excluded from the feature commit.
