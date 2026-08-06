import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf-8"));

function isGitDirty(): boolean {
  try {
    const out = execSync("git status --porcelain", { cwd: __dirname }).toString().trim();
    return out.length > 0;
  } catch {
    // Not a git checkout (e.g. release tarball) — never dirty.
    return false;
  }
}

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
const serverHost = host || "127.0.0.1";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react({
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
    tailwindcss(),
  ],
  base: "./",
  define: {
    DEV: process.env.NODE_ENV !== "production",
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Only dev builds surfaced via `__APP_DIRTY__`; release builds are always clean.
    __APP_DIRTY__: JSON.stringify(process.env.NODE_ENV !== "production" && isGitDirty()),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // The terminal emulator is only reachable through a dynamic import, so Vite
  // never sees it while scanning entry points. Without this, the first drawer
  // open in `tauri dev` triggers a dependency re-bundle and a page reload
  // instead of just rendering. No effect on production builds.
  optimizeDeps: {
    include: [
      "@xterm/xterm",
      "@xterm/addon-fit",
    ],
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        mobile: path.resolve(__dirname, "mobile.html"),
      },
      output: {
        manualChunks: {
          "vendor-markdown": ["react-markdown", "remark-gfm", "remark-math", "rehype-katex", "katex"],
          "vendor-date": ["date-fns"],
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: serverHost,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
