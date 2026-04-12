<p align="center">
  <h1 align="center">OpenBench</h1>
  <p align="center">
    Run, compare, and debug local LLMs like a developer — not a chatbot user.
  </p>
  <p align="center">
    Lightweight. Local-first. Built for real workflows.
  </p>
</p>

<p align="center">
  <img src="./assets/demo.gif" alt="OpenBench Demo" />
</p>

<p align="center">
  <b>No cloud. No API keys. No nonsense.</b><br/>
  Runs entirely on <a href="https://ollama.com/">Ollama</a>. (for now)
</p>

---

## Why OpenBench?

Most LLM tools are just chat apps with better branding.

OpenBench is built for people who actually want control:
- Compare multiple models side-by-side  
- Tune prompts with real parameters  
- Inspect raw request/response data  

If you're testing prompts seriously, this is the tool you wanted.

---

## Features

### Multi-model comparison
Run multiple Ollama models simultaneously and compare outputs in real time.

### Prompt playground
- System prompt editing  
- Temperature & parameter controls  
- Full request/response inspection  

### Incognito chats
Temporary sessions that don’t touch your history.

### Local-first by default
All conversations are stored in SQLite. Nothing leaves your machine.

### Rich output rendering
- GitHub Flavored Markdown  
- Syntax-highlighted code blocks  
- LaTeX via KaTeX  

### Developer tools
- Request/response inspector  
- Dev mode (run UI without backend)  

---

## Tech Stack

**Frontend**  
React 19 · TypeScript · Vite · Zustand · Tailwind · MUI  

**Backend**  
Rust (Tauri 2) · SQLx · ollama-rs  

**Storage**  
SQLite  

---

## Getting Started

### 1. Prerequisites

- Ollama installed and running  
- Bun  
- Rust toolchain  

---

### 2. Install

```bash
git clone https://github.com/your-username/openbench.git
cd openbench
bun install
```

---

### 3. Run

```bash
bun run tauri dev
```

---

### 4. Build

```bash
bun run build
bun run tauri build
```

---

## Shortcuts

| Action | macOS | Windows / Linux |
|---|---|---|
| Open settings | `Cmd + ,` | `Ctrl + ,` |
| Toggle dev mode | `/dev on` / `/dev off` | `/dev on` / `/dev off` |

---

## Contributing

PRs, issues, and ideas are welcome.  
If you build something cool with OpenBench, show it off.

---

## License

MIT
