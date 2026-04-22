# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenBench is a desktop chat app for experimenting with local LLMs via Ollama. It's a Tauri 2 application with a React frontend and Rust backend.

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Zustand (state management), Tailwind CSS, MUI (components), Base UI (headless components)
- **Backend:** Rust (Tauri 2), SQLx for raw queries, ollama-rs for Ollama integration
- **Storage:** SQLite via tauri-plugin-sql
- **Package Manager:** Bun

## Common Commands

```bash
# Development - runs Vite dev server with Tauri
bun run tauri dev

# Build frontend only
bun run build

# Build full Tauri app (creates native binary)
bun run tauri build

# Preview built frontend
bun run preview
```

## Architecture

### Frontend Structure

**State Management (Zustand):**
- `src/store/chatStore.ts` - Conversations, messages, active conversation state
- `src/store/modelStore.ts` - Selected models, available models, system prompts
- `src/store/authStore.ts` - User authentication state
- `src/store/settingsStore.ts` - App settings
- `src/store/themeStore.ts` - Light/dark mode
- `src/store/inspectorStore.ts` - Request/response debugging logs

**Key Hooks:**
- `src/hooks/useChatStream.ts` - Core chat streaming logic. Listens to Tauri events (`chat-chunk`), manages streaming state, handles multi-model concurrent streaming, auto-renames conversations
- `src/hooks/useModelPicker.ts` - Loads available Ollama models on mount
- `src/hooks/useSystemPrompts.ts` - Loads system prompts

**Database Layer (`src/lib/db.ts`):**
- Wraps tauri-plugin-sql with fallback to in-memory storage when not in Tauri context
- Schema: conversations, messages, users, sessions tables
- Auto-migrates columns on init (attachments, isArchived, model)

**Types (`src/types/`):**
- `chat.ts` - Message, Conversation, Attachment, StreamPayload types
- `auth.ts` - User types
- `inspector.ts` - Request/response log types

### Backend Structure (Rust)

**Commands (`src-tauri/src/lib.rs`):**
- `get_local_models` - Lists Ollama models
- `pull_model` - Downloads models with progress events
- `chat_stream` - Streaming chat with tool support (timestamp tools built-in)
- `chat` - Non-streaming chat (used for auto-titling)
- `cancel_chat` - Abort current generation

**Auth (`src-tauri/src/auth.rs`):**
- Password hashing with bcrypt
- Session-based auth with 30-day expiry
- Tables: users, sessions

**Database (`src-tauri/src/db.rs`):**
- SQLx connection pool to SQLite
- Used by auth commands for raw SQL

**Key Backend Features:**
- Streaming via Tauri events (`chat-chunk`, `pull-progress`)
- Tool calling support: `get_current_timestamp`, `calculate_timestamp`
- Thinking block stripping for reasoning models (Gemma4 `<|channel>thought`, Qwen3/DeepSeek `<think>`)

### Multi-Model Streaming

The app supports streaming from multiple models simultaneously:
- Each model gets its own `request_id` (UUID)
- Frontend tracks pending streams in `pendingStreamsRef`
- Each chunk includes `request_id` to route to correct message bubble
- All streams for one user message share the same conversation

### Path Aliases

- `@/` maps to `src/` (Vite + TypeScript configured)
- Example: `import { useChatStore } from "@/store/chatStore"`

## Important Implementation Details

**Chat Flow:**
1. User sends message → `chatStore.addMessage()` saves user message
2. `useChatStream.sendMessage()` invokes Rust `chat_stream` command
3. Rust streams chunks via Tauri events
4. Frontend accumulates streaming messages in `streamingMessages` state
5. On `done: true`, message is persisted to DB via `addMessage()`

**Dev Mode:**
- Toggle with `/dev on` or `/dev off` in chat input
- Mocks responses without calling Ollama
- Useful for UI development without local LLM running

**Temporary Chats:**
- `isTemporary` conversations aren't persisted to DB
- Used for incognito sessions
- Appears in sidebar but lost on app restart

**Auto-Renaming:**
- After first assistant response, app calls `chat` command to generate a 2-3 word title
- Only triggers if conversation still has default "New Chat" title

## Component Patterns

**UI Components:**
- `src/components/ui/` - Base components (button, dialog, etc.)
- Mix of shadcn/ui style (Tailwind + Radix via Base UI) and MUI components
- MUI used for complex components (Snackbar, AppBar, ThemeProvider)

**Layout:**
- Collapsible sidebar with conversation list
- Main chat area with Inspector panel slide-out
- Settings modal (Cmd/Ctrl + ,)

**Theming:**
- Dual theme system: Tailwind dark mode + MUI theme
- CSS variables in `App.css` for Tailwind
- `theme.ts` exports MUI themes

## Database Schema

**conversations:** id, title, createdAt, updatedAt, isArchived
**messages:** id, conversationId, role, content, createdAt, attachments (JSON), model
**users:** id, email, passwordHash, fullName, status, avatarUrl, createdAt, updatedAt
**sessions:** id, userId, token, expiresAt, createdAt

## Environment Notes

- No `.env` file required for basic operation
- Ollama expected at default localhost:11434
- SQLite database at app data dir: `chat.db`

## Testing/Development Tips

- The app gracefully degrades to in-memory mode if SQLite unavailable
- Use `/dev on` to test UI without Ollama running
- Inspector panel (top-right bug icon) shows raw request/response logs
- Build may fail if `OLLAMA_HOST` env var not set when running Tauri build in some environments
