# Generative User Interfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add model-selectable weather and stock tools that render structured results as native PolyUI cards in chat, with Open-Meteo weather lookup falling back to web search.

**Architecture:** Reuse the existing AI SDK sidecar tool registry, Open-Meteo/web search fetch paths, and `UIMessage` runtime-part persistence. Weather tries keyless geocoding/forecast requests before falling back to normalized search results; stock uses normalized search results. `AgentParts` dispatches these typed tool parts to small result cards and keeps generic agent-tool activity unchanged.

**Tech Stack:** TypeScript, AI SDK 7, Zod, React, existing PolyUI Card components, Vitest.

## Global Constraints

- Keep existing Tauri/sidecar transport; no Next.js API route or loopback server.
- Keep secrets out of frontend requests and persistence.
- Reuse existing `runtimeParts` and message rendering; no new store or dependency.
- Preserve existing tool ordering, approval behavior, and coding-agent filtering.

---

### Task 1: Add generative tools to the sidecar

**Files:**
- Create: `sidecar/src/generative-tools.ts`
- Modify: `sidecar/src/tools.ts`
- Modify: `sidecar/src/web-search.ts`
- Modify: `sidecar/src/runtime.ts`
- Modify: `src/lib/chat/prompts.ts`
- Test: `tests/aiToolsRuntime.test.ts`
- Test: `tests/aiToolRegistry.test.ts`

**Interfaces:**
- Produces `displayWeather({ location })` with Open-Meteo fallback behavior and `getStockPrice({ symbol })` with web-search output.
- `createToolRegistry({ generativeUI: true })` includes both tools; omitted option keeps current registry behavior.

- [x] **Step 1: Write failing registry and tool-loop tests**

```ts
expect(Object.keys(createToolRegistry({ generativeUI: true }).tools))
  .toEqual(["displayWeather", "getStockPrice"]);
expect(chunks).toContainEqual(expect.objectContaining({
  type: "tool-output-available",
  toolCallId: "weather-call",
  output: { location: "London", weather: "Sunny", temperature: 75 },
}));
```

- [x] **Step 2: Run focused tests and verify failure**

Run: `bun run test -- tests/aiToolRegistry.test.ts tests/aiToolsRuntime.test.ts`

Expected: FAIL because registry and runtime do not expose generative tools.

- [x] **Step 3: Implement minimal schemas and registry wiring**

```ts
const weatherTool = createWeatherTool({
  fetch,
  search: { provider: "local" },
});
// execute tries Open-Meteo, then searchWeb.
```

Register both tools only when `generativeUI` is true and pass that option from `streamChat`.

- [x] **Step 4: Run focused tests and verify pass**

Run: `bun run test -- tests/aiToolRegistry.test.ts tests/aiToolsRuntime.test.ts`

Expected: PASS.

### Task 2: Render structured results in chat

**Files:**
- Create: `src/features/chat/components/Message/GenerativeTool.tsx`
- Modify: `src/features/chat/components/Message/AgentParts.tsx`
- Modify: `src/lib/ai/messages.ts`

**Interfaces:**
- `GenerativeTool` consumes a runtime tool part with `toolName`, `state`, `input`, `output`, and `errorText`.
- Weather and stock outputs are validated at the UI boundary before rendering.

- [x] **Step 1: Add typed weather/search-result card rendering**

Render loading for non-terminal states, an Open-Meteo weather card or search-result card for valid output, and an error card for failed or malformed output.

- [x] **Step 2: Keep generic tool activity separate**

`AgentParts` sends only the two generative tools to `GenerativeTool`; terminal, web search, approvals, and agent plans retain existing behavior.

- [x] **Step 3: Preserve tool parts when switching runtime families**

Add `displayWeather` and `getStockPrice` to the existing PolyUI tool-name allowlist so persisted cards remain available to chat-model history and are stripped for coding-agent history.

### Task 3: Verify and document

**Files:**
- Modify: `docs/ai-sdk-runtime.md`

- [x] **Step 1: Document web search and search-backed generative cards**

- [x] **Step 2: Run verification**

Run: `bun run test -- tests/aiToolRegistry.test.ts tests/aiToolsRuntime.test.ts tests/aiMessagePersistence.test.ts`

Run: `bun run sidecar:typecheck`

Run: `bun run build`

Expected: all commands exit 0.
