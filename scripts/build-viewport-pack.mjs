// Assembles the downloadable CEF runtime pack.
//
// Takes what `cargo build -p polyui-viewport` left in target/release — the
// helper plus the CEF runtime that cef-dll-sys copies next to it — strips the
// 1.4GB libcef down to ~261MB, drops every locale but en-US, and tars it.
//
// This is the strip-and-prune logic that used to run as a beforeBundleCommand
// on every app build. It now runs once per CEF version instead.

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const asset = process.argv[2];
if (!asset) {
  console.error("usage: node scripts/build-viewport-pack.mjs <asset-name.tar.gz>");
  process.exit(1);
}

const isWindows = process.platform === "win32";
const release = join(import.meta.dirname, "..", "src-tauri", "target", "release");
const stage = join(import.meta.dirname, "..", "dist-pack", "stage");
const outDir = join(import.meta.dirname, "..", "dist-pack");

// Everything CEF needs at runtime. Missing any of these means libcef refuses to
// initialize, so the pack is verified against this list rather than a glob.
const RUNTIME = isWindows
  ? [
      "polyui-viewport.exe",
      "libcef.dll",
      "chrome_elf.dll",
      "d3dcompiler_47.dll",
      "libEGL.dll",
      "libGLESv2.dll",
      "vk_swiftshader.dll",
      "vulkan-1.dll",
      "vk_swiftshader_icd.json",
      "icudtl.dat",
      "chrome_100_percent.pak",
      "chrome_200_percent.pak",
      "resources.pak",
      "v8_context_snapshot.bin",
    ]
  : [
      "polyui-viewport",
      "libcef.so",
      "libEGL.so",
      "libGLESv2.so",
      "libvk_swiftshader.so",
      "libvulkan.so.1",
      "vk_swiftshader_icd.json",
      "icudtl.dat",
      "chrome_100_percent.pak",
      "chrome_200_percent.pak",
      "resources.pak",
      "v8_context_snapshot.bin",
    ];

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "locales"), { recursive: true });

for (const file of RUNTIME) {
  const source = join(release, file);
  if (!statSync(source, { throwIfNoEntry: false })) {
    console.error(`missing runtime file: ${source}`);
    process.exit(1);
  }
  copyFileSync(source, join(stage, file));
}

// Only the locale CEF is configured for. The rest is ~90MB of .pak files for
// languages the viewport never selects.
copyFileSync(join(release, "locales", "en-US.pak"), join(stage, "locales", "en-US.pak"));

// Upstream libcef ships with full debug info: 1.4GB on Linux. Stripping is what
// makes a downloadable pack viable at all.
if (!isWindows) {
  const libcef = join(stage, "libcef.so");
  const before = statSync(libcef).size;
  const result = spawnSync("strip", ["--strip-unneeded", libcef], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error("strip failed");
    process.exit(1);
  }
  const after = statSync(libcef).size;
  console.log(
    `libcef.so ${(before / 1e6).toFixed(1)}MB -> ${(after / 1e6).toFixed(1)}MB`,
  );
}

const tar = spawnSync("tar", ["-czf", join(outDir, asset), "-C", stage, "."], {
  stdio: "inherit",
});
if (tar.status !== 0) {
  console.error("tar failed");
  process.exit(1);
}

const packed = statSync(join(outDir, asset)).size;
const staged = readdirSync(stage, { recursive: true })
  .map((entry) => statSync(join(stage, entry.toString())))
  .filter((s) => s.isFile())
  .reduce((total, s) => total + s.size, 0);
console.log(
  `${asset}: ${(staged / 1e6).toFixed(1)}MB staged -> ${(packed / 1e6).toFixed(1)}MB packed`,
);
