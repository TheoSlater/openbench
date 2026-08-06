# PolyUI onboarding redesign

## Goal

Replace the current account gate with a local-first, five-step onboarding flow that feels like one full-window desktop surface. The app shell stays mounted underneath the onboarding overlay so the final action reveals the chat UI without a page reload or shell remount.

## Design

- `src/features/onboarding/` owns the shell, five steps, provider cards, navigation, persistence, and motion tokens.
- Motion is provided by the installed `motion` package. `AnimatePresence` handles directional step changes; `layoutId` is reserved for the progress and selection treatments. CSS handles the ambient background and reduced-motion fallback.
- The layout has stable progress, flexible centre, and bottom navigation regions. The centre can scroll at short heights; navigation never participates in step reflow.
- Existing typography, Tailwind semantic colours, radii, and `useReducedMotion`/`performance.reduceMotion` remain the source of truth.

## State and data flow

- A versioned local-storage record stores `completed`, `lastCompletedStep`, and confirmed onboarding choices. Draft transition state remains in React state.
- Provider cards call existing `connectionsClient`, `useConnectionsStore`, Ollama monitoring, and `agentStatus`; API/Ollama setup uses the existing connection validation path. No synthetic readiness or installation state is introduced.
- Theme choices go through `useThemeStore`; capability choices use the existing runtime/sandbox seam with a small persisted capability mode so chat-only can disable the direct-chat terminal and agent modes remain bounded by workspace/approval controls.
- Existing account/auth backend code remains available for compatibility and existing scoped data, but the desktop UI no longer requires PolyUI login, registration, profiles, avatars, or an auth modal. New local identity uses the existing guest-account path.
- Completion is written only after the final action's exit transition completes. Provider setup may be skipped; configured provider rows are never reset.

## Motion and accessibility

- Shared tokens cover hover, press, state, expansion, step, entrance, completion, easing, travel, stagger, and reduced-motion values.
- Forward and backward transitions use 8–16px composited travel with opacity. Cards preserve their outer dimensions while status content crossfades. Ambient motion stops under reduced motion.
- The active step is announced, the next step receives focus after transition, provider setup fields retain focus, and navigation buttons are safe against rapid repeated input.
- Cards use buttons/radio semantics, visible keyboard focus, live status announcements, and accessible progress text.

## Verification

Add pure state/persistence tests for navigation, interruption, completion, provider status mapping, capability selection, theme choice, repeated navigation, and reduced motion. Add source-level coverage for removal of the auth gate and profile surfaces. Run formatting, typecheck, unit tests, production build, and the available Tauri smoke checks; manually exercise every step, themes, keyboard navigation, reduced motion, narrow heights, and existing configured providers.

## Scope boundary

The backend auth commands and data schema are not deleted because they still protect existing registered-account rows and mobile/legacy paths. They are removed from the onboarding and desktop account-management UI; provider sign-in remains provider-owned (for example, Claude Code or Codex CLI authentication).
