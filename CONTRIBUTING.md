# Contributing to Openbench

Thank you for your interest in contributing to Openbench! We welcome contributions of all kinds, from bug fixes to new features and documentation improvements.

## Development Environment

Openbench is a Tauri 2 application with a React frontend and a Rust backend.

### Prerequisites

- [Ollama](https://ollama.com/) installed and running
- [Bun](https://bun.sh/) (preferred package manager)
- [Rust toolchain](https://rustup.rs/)

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/openbench.git
   cd openbench
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Run in development mode:
   ```bash
   bun run tauri dev
   ```

## Project Structure

- `src/`: React frontend code.
  - `components/`: UI components (MUI + Tailwind).
  - `store/`: Zustand state management.
  - `hooks/`: Custom React hooks, including `useChatStream.ts` for core logic.
  - `lib/`: Utility functions and database layer (`db.ts`).
- `src-tauri/`: Rust backend code.
  - `src/lib.rs`: Tauri commands and core logic.
  - `src/auth.rs`: Authentication logic.
  - `src/db.rs`: SQLx database connection.

## Development Guidelines

### Frontend

- **State Management:** Use Zustand stores in `src/store/`.
- **Styling:** Use a mix of Tailwind CSS and MUI components. Follow existing patterns.
- **Hooks:** Keep complex logic in custom hooks.
- **Database:** All persistent data should go through `src/lib/db.ts`.

### Backend (Rust)

- **Commands:** Define new Tauri commands in `src-tauri/src/lib.rs`.
- **Error Handling:** Use `Result<T, String>` for command return types to show errors in the frontend.
- **Streaming:** Use `app_handle.emit()` to stream data back to the frontend.

### Thinking Blocks

The app supports reasoning models that use `<think>` (Qwen/DeepSeek) or `<|channel>thought` (Gemma) tags. If you modify the message parsing logic, ensure these blocks are correctly extracted and displayed in the UI.

## Testing

Before submitting a PR, please ensure:

1. The project builds correctly: `bun run build` and `bun run tauri build`.
2. You've tested your changes with a live Ollama instance if possible.
3. You can use `/dev on` in the chat input to test UI changes without Ollama.

## Submitting Changes

1. Create a new branch for your feature or bug fix.
2. Make your changes and commit them with descriptive messages.
3. Push your branch and open a Pull Request.

## Code Style

- Follow the existing code style and formatting in the project.
- Use TypeScript for all frontend code.
- Add comments to explain complex logic, especially in the streaming and parsing code.

## Questions?

If you have any questions, feel free to open an issue or reach out to the maintainers.
