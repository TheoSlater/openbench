import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const platform = process.env.TAURI_ENV_PLATFORM;
if (!["linux", "windows"].includes(platform) || process.env.TAURI_ENV_DEBUG === "true") {
  process.exit(0);
}

const releaseDir = join(import.meta.dirname, "..", "src-tauri", "target", "release");

if (platform === "linux") {
  const libcef = join(releaseDir, "libcef.so");
  const result = spawnSync("strip", ["--strip-unneeded", libcef], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`strip failed for ${libcef}`);
}

for (const locale of await readdir(join(releaseDir, "locales"))) {
  if (locale !== "en-US.pak") {
    await rm(join(releaseDir, "locales", locale));
  }
}

for (const file of ["CMakeLists.txt", "CREDITS.html", "archive.json"]) {
  await rm(join(releaseDir, file), { force: true });
}
