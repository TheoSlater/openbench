import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const rustc = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
if (rustc.status !== 0) {
  process.stderr.write(rustc.stderr || "rustc -vV failed\n");
  process.exit(rustc.status ?? 1);
}
const host = rustc.stdout.match(/^host: (.+)$/m)?.[1];
const target = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.TARGET || host;
if (!target) throw new Error("Rust target triple was not reported");

const extension = target.includes("windows") ? ".exe" : "";
const output = resolve(
  root,
  "src-tauri",
  "binaries",
  `polyui-ai-runtime-${target}${extension}`,
);
mkdirSync(dirname(output), { recursive: true });
const build = spawnSync(
  process.execPath,
  [
    "build",
    resolve(root, "sidecar/src/main.ts"),
    "--compile",
    "--minify",
    "--outfile",
    output,
  ],
  { stdio: "inherit" },
);
process.exit(build.status ?? 1);
