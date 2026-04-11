# Openbench

A lightweight desktop app for experimenting with local LLMs. Built with Tauri, React, and Rust, designed around a developer workflow rather than just a chat interface.

Runs on top of Ollama, so everything stays on your machine.

## Features

**Local-first & private.** Conversations are stored in a local SQLite database and never leave your machine.

**Multi-model comparison.** Run multiple Ollama models side-by-side and compare outputs in real time.

**Prompt playground.** A dedicated workspace for prompt engineering: system prompt editing, temperature controls, and raw request/response inspection.

**Temporary chats.** Incognito sessions for one-off prompts that don't get saved to history.

**Rich output rendering.** GitHub Flavored Markdown, syntax-highlighted code blocks, and LaTeX via KaTeX.

**Developer tools.** Request/response inspector and a dev mode for testing the UI without a live backend.

## Tech Stack

**Frontend:** React 19, TypeScript, Vite, Zustand, Tailwind CSS, MUI

**Backend:** Rust (Tauri 2), SQLx, ollama-rs

**Storage:** SQLite

## Getting Started

### Prerequisites

- [Ollama](https://ollama.com/) installed and running
- [Bun](https://bun.sh/) for package management
- Rust toolchain for the Tauri backend

### Install

```bash
git clone https://github.com/your-username/openbench.git
cd openbench
bun install
```

### Development

```bash
bun run tauri dev
```

### Build

```bash
bun run build
bun run tauri build
```

## Shortcuts

| Action | macOS | Windows / Linux |
|---|---|---|
| Open settings | `Cmd + ,` | `Ctrl + ,` |
| Toggle dev mode | `/dev on` / `/dev off` | `/dev on` / `/dev off` |

## Contributing

Bug reports, feature suggestions, and pull requests are all welcome.

## License

MIT
