# Repository Guidelines

## Project Structure & Module Organization
- `src/`: React + TypeScript front end (entry: `src/main.tsx`, root: `src/App.tsx`).
- `src/components/`: UI and feature components (e.g., `src/components/Chat/`).
- `src/hooks/`: React hooks such as `useChatStream` and `useModels`.
- `src/lib/`: shared utilities (e.g., `src/lib/utils.ts`).
- `public/`: static assets served by Vite.
- `src-tauri/`: Tauri (Rust) backend, config, and build assets (`src-tauri/src/`, `src-tauri/tauri.conf.json`).
- `dist/`: Vite build output (generated; avoid manual edits).

## Build, Test, and Development Commands
- `bun install`: install JS dependencies.
- `bun  run dev`: run the Vite dev server for the UI.
- `bun run build`: type-check (`tsc`) then build the UI with Vite.
- `bun run preview`: serve the built UI locally.
- `bun run tauri dev`: run the Tauri app in dev mode (passes args to the Tauri CLI).

## Coding Style & Naming Conventions
- TypeScript + React function components; 2-space indentation; double quotes.
- Tailwind CSS for styling; keep class lists readable and grouped by purpose.
- Component files use `PascalCase.tsx`; hooks use `useSomething.ts`.
- Path aliases use `@/` (e.g., `@/components/Chat`).

## Testing Guidelines
- No automated test runner is configured in `package.json` yet.
- If you add tests, document the chosen framework and add scripts (e.g., `npm run test`) here and in `package.json`.

## Commit & Pull Request Guidelines
- Git history shows mixed styles (e.g., `feat: initial commit` and plain messages). Use short, descriptive, imperative messages; conventional prefixes are welcome but not required.
- PRs should include: a concise summary, testing notes (commands run), and screenshots for UI changes.

## Configuration Notes
- Tauri config lives in `src-tauri/tauri.conf.json`; capabilities in `src-tauri/capabilities/`.
- Front-end build tooling is Vite + Tailwind (`vite.config.ts`, `tailwind.config.js`, `postcss.config.js`).
