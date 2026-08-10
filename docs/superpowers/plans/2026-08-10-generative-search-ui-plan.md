# Generative search-backed UI implementation plan

Design: `docs/superpowers/specs/2026-08-10-generative-search-ui-design.md`

## 1. Replace hidden generative-tool searches

- Update `sidecar/src/generative-tools.ts` so `displayWeather` owns only the
  Open-Meteo fast path plus the typed search-backed render path.
- Return a recoverable `needs-web-search` result after an Open-Meteo failure;
  do not call `searchWeb` from either generative tool.
- Add strict schemas for normalized weather and stock values, including the
  optional summary and HTTP(S) source metadata needed by the card.
- Keep existing Open-Meteo fields and units canonical: Celsius and metres per
  second.

## 2. Teach the model the tool sequence

- Update `src/lib/chat/prompts.ts` with explicit weather and stock sequencing:
  use `web_search` for fallback/current facts, summarize the results, then
  call the card tool with individual typed fields.
- Update tool descriptions/input examples so the model does not send raw
  result arrays to card tools.
- Preserve the existing `web_search` citation stream and feature configuration.

## 3. Render normalized cards

- Extend `src/features/chat/components/Message/GenerativeTool.tsx` validation
  for search-backed weather output and structured stock output.
- Render optional condition/summary/source data without inventing missing
  values; keep invalid URLs rejected and preserve explicit error/loading states.
- Replace the stock result-link list with price/change/currency/status/time and
  source details, while retaining a compact fallback list only for the
  intermediate search-needed state.
- Add a focused jsdom test covering the weather and stock card fields.

## 4. Verify the tool loop

- Update `tests/aiToolsRuntime.test.ts` for Open-Meteo success, weather
  Open-Meteo → `web_search` → structured weather, and stock
  `web_search` → structured stock.
- Run focused Vitest tests, sidecar typecheck, TypeScript/Vite build, and
  `git diff --check`.
- Confirm only feature files and the committed design/plan are staged; leave
  all pre-existing dirty files untouched.
