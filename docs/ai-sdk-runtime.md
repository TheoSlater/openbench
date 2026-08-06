# AI SDK runtime architecture

PolyUI has one AI runtime. Vercel AI SDK owns model generation, provider stream normalization, regular tool loops, and the AI-facing Claude Code/Codex path.

## Final runtime

```text
React visual UI
  -> @ai-sdk/react useChat (50 ms update throttle)
  -> TauriChatTransport (requestId + connectionId)
  -> ai_runtime_* Tauri commands
  -> Rust AiSidecar supervisor + OS keychain
  -> private newline-delimited JSON over child stdin/stdout
  -> bundled polyui-ai-runtime executable
  -> AI SDK Core/providers/tools/local CLI providers
```

No loopback server or port exists. Sidecar is a private child process. Rust starts it lazily, waits for readiness, routes opaque request-scoped AI SDK UI chunks, restarts after a crash on the next request, and sends `shutdown` during app exit. Unix uses a separate process group; Windows uses a kill-on-close Job Object so sidecar-spawned Claude/Codex descendants cannot outlive PolyUI.

## Secret flow

1. React submits a connection ID. Password inputs are uncontrolled and used only by the save/validate command.
2. Rust authorizes connection ownership and resolves its `SecretRef` from OS keychain.
3. Rust writes resolved connection settings and secret to sidecar stdin for that request.
4. Sidecar constructs provider client, then drops request data when request ends.
5. Frontend receives only AI SDK chunks, public model metadata, and redacted errors.

Secrets never enter Zustand, browser storage, URLs, Tauri events, conversation rows, or sidecar logs. Protocol validation rejects frontend secret fields. Web-search keys use same keychain boundary.

## Providers and discovery

Direct BYOK registry:

- OpenAI — `@ai-sdk/openai`
- Anthropic — `@ai-sdk/anthropic`
- Google Gemini — `@ai-sdk/google`
- Ollama — `@ai-sdk/openai-compatible` against its OpenAI-compatible API
- OpenRouter, LM Studio, and custom OpenAI-compatible servers — `@ai-sdk/openai-compatible`
- Vercel AI Gateway — optional `@ai-sdk/gateway` connection with its own key

Gateway is never required. It supplies broad provider/model coverage without bundling dozens of direct-provider packages. Direct providers remain available for current PolyUI BYOK connections. Model refresh uses native catalog endpoints where available; Anthropic keeps a small native listing request because AI SDK does not standardize model discovery.

Provider packages load only when selected. One registry function constructs models; listing-only provider code contains no generation or stream parser.

## Streaming, tools, and persistence

`streamText` produces AI SDK `UIMessageChunk` records. `@ai-sdk/react` consumes them through one module-level Tauri listener and request-specific streams. Independent `requestId` values isolate parallel models, background chats, aborts, and retries. React updates are throttled to 50 ms so tokens do not cause one render each.

Regular chat exposes Zod-validated AI SDK tools through the per-request registry. Weather uses keyless Open-Meteo first and falls back to web search; stock uses web search. Tool schemas include descriptions, strict validation where supported, and input examples. The registry also applies active-tool filtering, stable tool order, tool choice, lifecycle callbacks, and sequential execution with `stopWhen: isStepCount(10)`:

- `web_search` — local DuckDuckGo HTML, Exa, Tavily, and Ollama-backed search. Results become standard tool/source parts and existing PolyUI citation state.
- `terminal` — requires explicit user approval before it starts. After approval, the frontend receives a `data-terminal` start part, opens the AI terminal tab, and calls `pty_spawn_command` so the shell runs inside the host PTY the user can watch and interrupt. Rust relays the captured PTY output and exit status back to the sidecar as `pty-data` / `pty-exit` commands keyed by the tool's `toolCallId`; a `PtyBroker` buffers that data until the tool call registers and resolves the model's `execute` with the result. No filesystem tool exists in regular chat.
- `displayWeather` — geocodes the location and reads current temperature/wind from Open-Meteo without a key; falls back to web search when either request fails, then renders a weather card.
- `getStockPrice` — searches the web for the symbol and renders a stock-results card.

### AI terminal sandbox

The host PTY is only a relay. Full AI commands run as the unprivileged `sandbox` user in a disposable Docker/Podman container with a private `/workspace`, `/home/sandbox`, and `/tmp`; host execution is never a fallback. Containers are labeled for exact startup reaping, capped at 4 CPUs, 4 GiB RAM, 512 processes, and an 8 GiB workspace. Sessions are reused per conversation, resettable from the terminal, and reaped after 30 minutes idle.

Simple read-only commands can use a `host-restricted` headless runner when Docker/Podman is not needed. It accepts only fixed direct executables (`pwd`, `ls`, file reads, search, version checks, and `git status`), clears inherited environment variables, maps paths into a private disposable temp workspace, and exposes no ports. Shell syntax, writes, package managers, servers, compilers, arbitrary tools, and host paths still require Docker/Podman; there is no host-shell fallback.

The default network mode is bridge egress so npm, apt, git, and development servers work. Preview forwarding binds only to PolyUI loopback listeners and rejects loopback, link-local/metadata, and private host targets; the inspected container address is the only private address allowed as a preview target. Diagnostics expose the active runtime, policy, limits, capabilities, ports, and usage without host paths or secrets.

SQLite stays authoritative. `src/lib/ai/messages.ts` is the only mapping boundary:

- text and reasoning map to existing message fields;
- web citations map to existing search data;
- tool, source, and agent events map to `runtimeParts`;
- usage, finish/error state, and `agentSessionId` persist with the message.

Partial streams update the existing assistant row at throttled boundaries. No AI SDK conversation database exists.

## Claude Code and Codex

Both coding agents use current AI SDK `LanguageModelV4` integrations and existing local CLI login state. No provider API key, Vercel Sandbox, AI Gateway, or custom ACP host is involved.

- Claude Code: `ai-sdk-provider-claude-code`, local workspace `cwd`, Claude Code preset/tools, existing `claude` login, session resume, task callbacks, and explicit `canUseTool` decisions.
- Codex: `ai-sdk-provider-codex-cli` app-server mode, existing `codex` login, persistent threads, session resume, raw plan/file/terminal events, `approvalPolicy: on-request`, and `autoApprove: false`.

Official AI SDK `HarnessAgent` was evaluated first. Its Claude Code/Codex harness implementations require a network sandbox integration, which conflicts with PolyUI's local-workspace and no-Vercel-Sandbox requirements. Local AI SDK-compatible providers are smaller and preserve installed CLI login.

Coding sessions default to `read-only`. Claude read-only mode allowlists only `Read`, `Glob`, `Grep`, `WebFetch`, and `WebSearch`; other requested tools are denied. Codex uses its native read-only sandbox. `workspace-write` must be selected in UI and still prompts for command/file mutation approval. `danger-full-access` is not exposed. Permission requests remain typed `data-agent` parts, never plain text. Plans/tasks, terminal activity, file changes, reasoning, usage, errors, and session IDs are also preserved as standard or typed UI parts.

## Versions and pins

Checked against npm and installed package source on 2026-07-31:

- `ai` 7.0.44
- `@ai-sdk/react` 4.0.47
- `@ai-sdk/openai` 4.0.25
- `@ai-sdk/anthropic` 4.0.25
- `@ai-sdk/google` 4.0.29
- `@ai-sdk/openai-compatible` 3.0.18
- `@ai-sdk/gateway` 4.0.33
- `ai-sdk-provider-claude-code` 4.0.1
- `ai-sdk-provider-codex-cli` 2.1.2
- transitive `@anthropic-ai/claude-agent-sdk` 0.3.205

All AI SDK packages are exact-pinned as one AI SDK 7/provider-v4 family. The two CLI providers are community integrations and exact-pinned because CLI protocol/event surfaces move faster than stable direct-provider APIs. Codex app-server requires Codex CLI 0.144.0 or newer. Node 22 is the package engine floor; Bun 1.3.14 successfully type-checks and compiles the selected packages into standalone native binaries, so no Node runtime is bundled.

## Packaging impact

`bun run sidecar:build` builds target-suffixed Tauri `externalBin` output before frontend/Tauri packaging. Measured standalone sidecar sizes with Bun 1.3.14 and minification:

- Linux x64: 96,856,192 bytes (92.37 MiB)
- macOS arm64: 65,724,770 bytes (62.68 MiB)
- Windows x64: 100,743,168 bytes (96.08 MiB)

These are uncompressed payload additions; final installer deltas depend on each Tauri bundle format's compression and signing. Cross-target Bun compilation was verified for all three. CI/release hosts must still run native installer builds and signing.

Linux `.deb` and `.rpm` bundles build with the standalone sidecar. The current AppImage toolchain does not: `linuxdeploy` patches the Bun single-file executable during its first pass, then its GTK pass cannot read the modified ELF and exits while running `ldd`. This is a packaging-tool incompatibility, not an application build failure. Do not ship an AppImage until Bun or `linuxdeploy` preserves Bun's appended executable payload; use the `.deb`/`.rpm` artifacts meanwhile.

## Local development and tests

```bash
bun install
bun run sidecar:typecheck
bun run sidecar:test
bun run sidecar:build
bun run tauri dev
```

Sidecar tests inject fake `fetch` and a shared fake Claude/Codex executable. They need no browser/Tauri APIs, API keys, subscriptions, or installed CLI authentication.

## Manual smoke tests

Use non-billable/local models where possible; real hosted/CLI prompts may consume account quota.

```bash
bun run tauri dev
```

1. Add Ollama, send text, attach an image, cancel mid-stream, retry, and restart app to confirm restored partial/final content.
2. Start two models together; cancel one and confirm other continues without cross-talk.
3. Configure web search, run query, inspect status and citations, then remove key and confirm frontend storage contains no credential.
4. Add optional Gateway connection, refresh catalog, and stream one selected Gateway model.
5. With existing `claude` login: choose workspace, run read-only request, verify mutation denial, switch to Can edit, approve/deny one file action, continue and resume session.
6. With existing `codex` login and CLI >= 0.144.0: repeat read-only/write/approval/cancel/resume checks and inspect plan, command, and file cards.
7. Quit while a coding agent runs; verify no `polyui-ai-runtime`, `claude`, or `codex app-server` child remains.

Known risk: Claude Code and Codex integrations are community packages over evolving local CLI protocols. Exact pins and fake protocol fixtures limit drift, but upgrades require reading package source, running fixture suites, and repeating authenticated smoke tests with user approval.
