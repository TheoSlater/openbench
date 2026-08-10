# Runtime catalog and model picker redesign

## Goal

PolyUI must expose one reliable runtime catalog to every frontend surface. The model picker, Settings, onboarding, the chat header, and chat execution must agree about which connections and coding agents are available without repeating discovery work or waiting on unrelated providers.

The picker must open from local state immediately, refresh in the background, and let a ready coding agent use its default model before optional model discovery finishes.

## Current failures

The current implementation has several independent state paths:

- `ModelSelector` loads connections, refreshes every remote catalog, checks both agents, lists both agents' models, and loads recents only after the picker opens.
- Settings and onboarding each run their own agent status requests and can therefore disagree with the picker.
- Cached connection models already stored in SQLite are ignored while the picker waits for remote refreshes.
- `ai_runtime_agent_models` repeats the full version and authentication check that the frontend just completed.
- Claude discovery executes `claude models`. Claude Code has no model-list command, so this starts a normal prompt, takes about ten seconds locally, and returns prose that is parsed as model identifiers.
- The sidecar awaits discovery commands in its input loop, serializing requests that the frontend issued concurrently.
- Timed-out Rust requests leave pending entries behind until a late result or process restart.
- The legacy Ollama monitor polls all connections and maintains a second session-storage model cache even though SQLite is the source of truth.
- Chat selection still converts a single `RuntimeRef` back into the retired multi-model `ModelChoice[]` path.

These are architectural causes, not picker-only rendering defects.

## Chosen architecture

Use one frontend runtime catalog store backed by the existing SQLite, Tauri, and sidecar boundaries. Do not add another native cache, protocol, dependency, or persistence layer.

The canonical frontend API will live with runtime selection and expose:

- a Zustand store for the catalog state;
- narrow selector hooks for components;
- pure functions that derive picker options and presentation state;
- shared actions for initial hydration, background refresh, per-connection refresh, per-agent refresh, removal, and invalidation.

The existing `connectionsClient` remains the typed Tauri command boundary. SQLite remains the durable source of truth for configured connections and discovered provider models. `RuntimeRef` remains the only runtime-selection value passed into chat.

No store imports another store. Startup passes the current account id into the catalog initializer, and components subscribe through selectors.

## Catalog state and API

The store holds only state that multiple consumers need:

```ts
type CatalogStatus = "idle" | "loading" | "ready" | "error";

type AgentCatalogEntry = {
  kind: "codex" | "claude-code";
  status: AgentCliStatus | null;
  statusState: CatalogStatus;
  models: AgentModelEntry[];
  modelsState: CatalogStatus;
  error: string | null;
};

type RuntimeCatalogState = {
  accountId: string | null;
  connections: ConnectionSummary[];
  modelsByConnection: Record<string, ConnectionModel[]>;
  refreshingConnectionIds: Set<string>;
  connectionErrors: Record<string, string | null>;
  agents: Record<AgentKind, AgentCatalogEntry>;
  recentRuntimeIds: Set<string>;
  status: CatalogStatus;
  error: string | null;
  lastCheckedAt: number | null;
};
```

The public actions are deliberately small:

- `start(accountId)` hydrates once, deduplicates concurrent callers, and registers one focus refresh.
- `refresh()` rechecks summaries and agents without clearing last-known-good data.
- `refreshConnection(connectionId)` refreshes one remote catalog and stores its result.
- `refreshAgent(kind)` rechecks one CLI and optional real model catalog.
- `removeConnection(connectionId)` performs the mutation and updates the shared state.
- `stop()` removes the single focus listener during shutdown or tests.

No component calls `agentStatus`, `agentModels`, `connectionsClient.list`, `connectionsClient.models`, or `connectionsClient.recents` directly for catalog presentation. Connection editors may still call save/validate commands, then refresh the shared catalog.

## Hydration and refresh flow

Startup begins catalog hydration after local authentication/guest restoration. It must not delay the main window.

1. Load connection summaries and recent runtimes from SQLite concurrently with both agent status checks.
2. Publish each agent result independently as soon as it returns.
3. After summaries arrive, load every cached connection model list in parallel from SQLite and publish each result independently.
4. Mark initial hydration ready when local data has settled, even if one source failed.
5. Revalidate enabled connection catalogs in the background. Preserve cached models when revalidation fails.
6. For Codex, expose a selectable default-agent row immediately after readiness succeeds, then enrich it with the real app-server model list in the background.
7. For Claude Code, expose one selectable default-agent row after readiness succeeds. Do not invent, hard-code, or probe for a model catalog the CLI does not expose.

`start` and refresh actions are single-flight. Opening the picker never initiates a remote refresh and never clears existing rows. Window focus performs a shared refresh only when the previous check is stale; explicit Retry always forces the selected source.

## Native and sidecar reliability

Agent executable resolution becomes a cheap shared Rust function. Full status checks run version and authentication commands concurrently. Chat startup and agent model discovery use the already resolved executable path without repeating version/authentication subprocesses.

The sidecar input loop must remain responsive while discovery runs. Model and agent-model requests start request-scoped asynchronous work, like chat streams already do, so one slow provider cannot block another discovery request, cancellation, approval, or chat start.

Every one-shot request has one terminal outcome: result, error, cancellation, or timeout. Rust removes pending entries on timeout and sends cancellation to the sidecar. The sidecar removes active request state in `finally`. Late results are ignored safely.

Provider secrets remain in Rust/keychain-owned paths. No catalog state, error, log, URL, or frontend request contains credentials.

## Runtime selection and chat

The application supports one selected runtime. Remove the retired multi-model array plumbing:

- `ChatWorkspace` no longer converts a selected chat runtime into `ModelChoice[]`.
- `useChatStream` creates exactly one job from the selected `RuntimeRef`.
- Provider metadata retained on persisted messages is presentation/history data only, resolved at the message-mapping boundary rather than used for routing.
- Runtime availability comes from the shared catalog, not from the presence of a non-null runtime alone.

Historical persisted messages remain readable. This cleanup must not delete user conversations or credentials.

## Model picker UX

The picker is an operating surface, not a connection-management screen.

- Open instantly from catalog state with no fetch effect in the component.
- Remove the All/Local/External tabs; search and clear section labels are sufficient.
- Order sections as Recent, Coding agents, Cloud models, and Local models.
- Keep rows compact: model/agent name first, connection name as secondary text, selected check at the end.
- While an agent is being checked and there is no cached result, show one disabled `Checking Codex…` or `Checking Claude Code…` row. Publish or remove it independently when the check settles.
- Do not keep unavailable providers as permanent `Set up` rows. A single footer action opens Connections settings.
- Preserve last-known-good rows during background refresh and show only a small, non-blocking refresh indicator.
- If no runtime exists, show one concise empty state and the Connections action.
- Search, arrow navigation, Enter selection, focus management, listbox semantics, accessible status announcements, and reduced motion remain supported.
- Choosing a coding agent still requests a workspace before materializing its `RuntimeRef`.

No decorative provider logos, large cards, or additional onboarding copy are added.

## Settings, onboarding, and header

- Settings coding-agent cards read the shared agent entries and call `refreshAgent` for Retry.
- Connection cards read shared summaries/models and update the catalog after save, validation, refresh, or removal.
- Onboarding reads the same catalog selectors. Its existing uncommitted layout work is preserved; only data access changes.
- The header stops using the legacy Ollama monitor's global Online/Offline claim. It shows no global provider warning unless the selected runtime is known unavailable.

Each surface may format the shared state for its own density, but none owns a second readiness truth.

## Deletions and consolidation

Remove code made redundant by the catalog:

- the Ollama health monitor, its polling lifecycle, its session-storage model cache, and its provider adapter;
- the unused legacy `ModelSelectorOption` implementation;
- per-component agent status/model effects;
- `mergeModelOptions`, `ModelChoice`, and the old model-choice identifier path after chat migration;
- unused agent-installation repository/types generated for an architecture that never became a runtime source; historical migrations remain intact;
- misleading comments and tests that assert implementation strings instead of behavior.

Rename the model store if touched so its name reflects its actual system-prompt responsibility. Do not add compatibility wrappers for deleted frontend APIs.

## Error behavior

- One provider failure never hides healthy providers or agents.
- Refresh errors retain cached rows and attach the error only to the failed source.
- Initial SQLite failure produces the picker empty/error state and a Retry action.
- Agent status failure is distinct from `installed: false` or signed out.
- Model-list failure does not make an otherwise ready coding agent unavailable; its default row remains selectable.
- Deleted connections disappear immediately and a selected deleted runtime is cleared through the existing store coordinator.
- Stale selected runtimes fail with a specific availability message before a send, while persisted historical messages remain untouched.

## Verification

Automated checks must prove behavior rather than source strings:

- store tests cover single-flight startup, incremental publication, cached-first connection models, preserved last-good data, per-source errors, forced retry, and account changes;
- picker tests cover immediate cached rendering, independent agent updates, empty/error states, search, keyboard selection, and workspace cancellation;
- sidecar tests prove two discovery requests overlap, a slow discovery does not block chat/cancel, and active state is cleaned after success/error/cancel;
- Rust tests cover unknown agents, cheap executable resolution, timeout cleanup, and request cancellation;
- chat tests prove exactly one `RuntimeRef` becomes one job without the legacy `ModelChoice[]` bridge;
- existing security tests continue proving frontend payloads contain no credentials.

Required repository checks:

```text
bun run test
bun run sidecar:typecheck
bun run build
cargo test --manifest-path src-tauri/Cargo.toml
```

For native Windows verification, use an isolated Cargo target when the running app locks the normal target.

## Performance and UX acceptance

- With cached SQLite models, opening the picker shows rows in the same render; it performs zero remote requests.
- Initial cached catalog hydration completes without waiting for remote discovery.
- Codex and Claude rows update independently; either can be selected as soon as its status succeeds.
- The invalid `claude models` subprocess no longer exists.
- Independent sidecar discovery work overlaps in a deterministic timing test.
- Reopening the picker does not repeat discovery while the shared catalog is fresh.
- No 10-second polling loop or session-storage model catalog remains.
- A bounded desktop and narrow-window visual pass finds no clipping, focus loss, layout jump, misleading status, or inaccessible state. Reduced-motion behavior is verified.

## Out of scope

- Adding providers, coding agents, model capabilities, or provider logos.
- Persisting coding-agent readiness as durable truth.
- Building a new native catalog daemon or event protocol.
- Changing credential storage, sandbox policy, or conversation persistence.
- Reworking the unrelated onboarding visual changes already present in the worktree.
