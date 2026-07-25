<p align="center">
  <img src="public/polyui-logo.png" alt="PolyUI logo" width="144" />
</p>

<h1 align="center">PolyUI</h1>

![GitHub repo size](https://img.shields.io/github/repo-size/monolabsdev/poly-ui)
![GitHub language count](https://img.shields.io/github/languages/count/monolabsdev/poly-ui)
![GitHub top language](https://img.shields.io/github/languages/top/monolabsdev/poly-ui)
![GitHub last commit](https://img.shields.io/github/last-commit/monolabsdev/poly-ui?color=red)
![GitHub stars](https://img.shields.io/github/stars/monolabsdev/poly-ui?style=social)
<div align="center">

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/F8O123TMDU)

</div>

PolyUI is a desktop AI chat app that runs entirely offline. One calm window for your models - use Ollama, OpenAI-compatible APIs, and more. Built for private, everyday conversations with local LLMs.

![polyui demo](public/PolyUI_Demo.png)

## Key features of PolyUI

- 🚀 **Effortless Setup**: Install via the setup file. You'll need Ollama installed first.
- 🤝 **Ollama Integration**: Use ollama models effortlessly through this application.
- ✒️🔢 **Full Markdown and LaTeX Support**: Elevate the LLM experience with comprehensive Markdown and LaTeX capabilities. (uses LaTeX via KaTeX)
- 💭 **Multi-model conversations**: Chat with multiple local LLMs simultaneously with real-time, side-by-side streaming responses.
- 🧍 **Guest mode**: Skip signup and chat without saving anything to disk.
- 📚 **Archived conversations**: Keep your chat history organised by archiving old conversations.
- 🤖 **Install models**: Install Ollama models directly from the app.
- 📜 **System prompts**: Choose from 4 different AI personas or use a custom system prompt.
- 🔐 **Account Authentication**: Create local accounts for secure sign-in.
- 🔒 **Privacy first**: Everything stays on your machine. Nothing leaves without your say-so.

## How to Install 🚀

### Installation via releases
PolyUI can be installed from the [releases](https://github.com/monolabsdev/poly-ui/releases) page. Download the file that matches your operating system and CPU:

### Command line install

Linux and macOS:
```bash
curl -fsSL https://raw.githubusercontent.com/monolabsdev/poly-ui/main/scripts/install.sh | sh
```

Windows PowerShell:
```powershell
irm https://raw.githubusercontent.com/monolabsdev/poly-ui/main/scripts/install.ps1 | iex
```

- **macOS**: download `PolyUI-*-macos-universal.dmg`.
- **Windows**: download `PolyUI-*-windows-x64-setup.exe` or `PolyUI-*-windows-x64.msi`.
- **Windows with Ollama setup**: download `PolyUI-*-windows-x64-ollama-setup.exe`.
- **Linux Debian/Ubuntu**: download `PolyUI-*-linux-x64.deb` or `PolyUI-*-linux-arm64.deb`, then install with:
  ```bash
  sudo apt install ./PolyUI-*-linux-*.deb
  ```
- **Linux Fedora/RHEL/openSUSE**: download `PolyUI-*-linux-x64.rpm` or `PolyUI-*-linux-arm64.rpm`, then install with:
  ```bash
  sudo rpm -i PolyUI-*-linux-*.rpm
  ```
- **Other Linux distributions**: download `PolyUI-*-linux-x64.AppImage` or `PolyUI-*-linux-arm64.AppImage`, then run:
  ```bash
  chmod +x PolyUI-*-linux-*.AppImage
  ./PolyUI-*-linux-*.AppImage
  ```

Use `x64` for most Intel/AMD PCs. Use `arm64` for ARM Linux devices.

### Using the Dev Branch 🌙
> [!WARNING]
> The `:dev` branch contains the latest unstable features and changes. Use it at your own risk as it may have bugs or incomplete features.

> [!NOTE]
> This repo includes both AI-generated and hand-written code.

### Setup (dev)
Make sure you've got the essentials installed:
- Git
- Bun
- Tauri prerequisites (Rust, system deps, etc)

**Clone the repo** and switch to the dev branch:

```bash
git clone https://github.com/monolabsdev/openbench-ai.git
cd openbench-ai
git checkout dev
```

Install dependencies:
```bash
bun install
```

### 🧪 Running the dev server

```bash
bun run tauri dev
```

### 📦 Building for Production

To build the default installer:
```bash
bun run tauri build
```
To compile and build the Ollama + PolyUI installer:
```bash
bun run ollama-setup
```


## ❓ Frequently Asked Questions

###  How is PolyUI different from Open WebUI?

PolyUI is built for simplicity. No Python, Docker, or Kubernetes required — just install and run.

## What's next? 🌟
Check out our [roadmap](https://linear.app/poly-ui/view/roadmap-fa502b4506c7?layout=list&ordering=priority&grouping=workflowState&subGrouping=none&showCompletedIssues=all&showSubIssues=true&showTriageIssues=true)

## License
This project contains licensed code. See [LICENSE](LICENSE.md).

## Star History

<a href="https://www.star-history.com/?repos=monolabsdev%2Fpoly-ui&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=monolabsdev/poly-ui&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=monolabsdev/poly-ui&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=monolabsdev/poly-ui&type=date&legend=top-left" />
 </picture>
</a>
