<p align="center">
  <img src="./public/PolyUI-Logo.png" alt="PolyUI logo" width="144" />
</p>

<h1 align="center">PolyUI</h1>

<p align="center">
  A focused desktop app for local models, hosted providers, and coding agents.
</p>

<p align="center">
  <a href="https://github.com/monolabsdev/poly-ui/releases/latest">
    <img alt="Latest PolyUI release" src="https://img.shields.io/github/v/release/monolabsdev/poly-ui?style=flat-square&label=release" />
  </a>
  <a href="https://github.com/monolabsdev/poly-ui/releases">
    <img alt="PolyUI downloads" src="https://img.shields.io/github/downloads/monolabsdev/poly-ui/total?style=flat-square&label=downloads" />
  </a>
  <a href="https://github.com/monolabsdev/poly-ui/stargazers">
    <img alt="PolyUI GitHub stars" src="https://img.shields.io/github/stars/monolabsdev/poly-ui?style=flat-square&label=stars" />
  </a>
  <a href="LICENSE">
    <img alt="MIT license" src="https://img.shields.io/github/license/monolabsdev/poly-ui?style=flat-square" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/monolabsdev/poly-ui/releases/latest"><strong>Download the latest release</strong></a>
  ·
  <a href="https://github.com/monolabsdev/poly-ui/issues">Issues</a>
  ·
  <a href="https://linear.app/poly-ui/view/roadmap-fa502b4506c7">Roadmap</a>
</p>

<p align="center">
  <img src="./public/PolyUI_Demo.png" alt="PolyUI desktop app showing an AI conversation beside an integrated browser tab" width="100%" />
</p>

PolyUI brings local models, bring-your-own-key cloud providers, and local coding agents into one focused desktop application. Choose where your requests run, keep conversations and application data on your device, and give external tools only the access you approve.

## What you need to know

- **Local or hosted models.** Use Ollama, LM Studio, or another local model server, or connect OpenAI, Anthropic, Google Gemini, OpenRouter, Vercel AI Gateway, or another OpenAI-compatible provider.
- **Coding agents in your workspace.** Run Claude Code and Codex with their existing CLI logins. Sessions start read-only; workspace edits and command execution require explicit approval.
- **Local data, explicit network boundaries.** Conversations stay in local SQLite, and provider credentials are stored in the operating system keychain. Hosted providers, web search, and other network-backed features send requests to the service you configure.

## Download

Download the latest package from [GitHub Releases](https://github.com/monolabsdev/poly-ui/releases/latest).

| Platform | Package |
| --- | --- |
| macOS | Apple Silicon `.dmg` |
| Windows | x64 setup `.exe` or `.msi` |
| Debian and Ubuntu | x64 or arm64 `.deb` |
| Fedora, RHEL, and openSUSE | x64 or arm64 `.rpm` |

Use `x64` for most Intel and AMD computers. Use `arm64` for ARM-based Linux devices and Apple Silicon Macs.

### Install from the command line

Linux and macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/monolabsdev/poly-ui/main/scripts/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/monolabsdev/poly-ui/main/scripts/install.ps1 | iex
```

The scripts detect your operating system and architecture, download the matching GitHub release, and run the installer.

> [!NOTE]
> Ollama is optional. Install it only when you want to run local Ollama models.

> [!NOTE]
> AppImage packages are temporarily unavailable because the current Bun sidecar executable is incompatible with the AppImage `linuxdeploy` packaging process. Use the `.deb` or `.rpm` package on Linux.

## How PolyUI works

PolyUI can run completely offline when connected to Ollama or another local model server. Cloud providers, web search, and other network-backed features require an internet connection and send requests to the service you configure.

Provider secrets are retrieved from the operating system keychain for individual requests. They are not stored in frontend state, browser storage, conversation records, URLs, or sidecar logs.

<details>
<summary>Build from source</summary>

### Requirements

- [Git](https://git-scm.com/)
- [Bun](https://bun.sh/) 1.3.14
- The Rust toolchain
- [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/) for your operating system

### Run locally

```bash
git clone https://github.com/monolabsdev/poly-ui.git
cd poly-ui

bun install
bun run sidecar:build
bun run tauri dev
```

### Test

```bash
bun run test
bun run sidecar:typecheck
bun run sidecar:test
```

### Build

```bash
bun run tauri build
```

To build the Windows installer that also sets up Ollama:

```bash
bun run ollama-setup
```

</details>

<details>
<summary>Architecture and security</summary>

PolyUI uses React and Tauri for its desktop interface, Rust for native application services and credential handling, and a private Bun sidecar for the Vercel AI SDK runtime.

The sidecar communicates with the Rust host through standard input and output. It does not expose a local HTTP server or open a loopback port.

</details>

## Contributing

Bug reports, focused pull requests, documentation improvements, and tested fixes are welcome. Before making a substantial architectural or product change, open an [issue](https://github.com/monolabsdev/poly-ui/issues) describing the problem and proposed approach.

When submitting code, keep changes focused, update relevant tests, verify the affected frontend, Rust, and sidecar layers, and explain user-visible behavior or security implications in the pull request.

## Roadmap

Current work and planned features are tracked on the [public PolyUI roadmap](https://linear.app/poly-ui/view/roadmap-fa502b4506c7).

## Support

Support continued development through [Ko-fi](https://ko-fi.com/F8O123TMDU).

## License

PolyUI is available under the [MIT License](LICENSE).

Copyright © 2026 Theo Slater.
