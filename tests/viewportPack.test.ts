import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const readJson = (path: string) => JSON.parse(read(path));

const appManifest = read("../src-tauri/Cargo.toml");
const helperManifest = read("../src-tauri/viewport/Cargo.toml");
const buildScript = read("../src-tauri/build.rs");
const appBackend = read("../src-tauri/src/lib.rs");
const appMain = read("../src-tauri/src/main.rs");
const viewportModule = read("../src-tauri/src/viewport/mod.rs");
const packModule = read("../src-tauri/src/viewport/pack.rs");
const packWorkflow = read("../.github/workflows/viewport-pack.yml");
const tauriConfig = readJson("../src-tauri/tauri.conf.json");
const linuxBundleConfig = readJson("../src-tauri/tauri.linux.conf.json");
const windowsBundleConfig = readJson("../src-tauri/tauri.windows.conf.json");

// The whole point of the split: libcef is 261MB and the browser is opt-in and
// off by default, so it must not be linked into the app that every user runs.
describe("the app links no CEF", () => {
  it("has no cef dependency", () => {
    expect(appManifest).not.toMatch(/^\s*cef\s*=/m);
    expect(appManifest).not.toContain("cef-dll-sys");
  });

  it("has no cef cfg gate or CEF link arguments", () => {
    expect(buildScript).not.toContain("rustc-cfg=cef");
    expect(buildScript).not.toContain("$ORIGIN");
    // The version script existed only because the app's sqlx-bundled SQLite
    // interposed over the system libsqlite3 that CEF's NSS init drives.
    expect(buildScript).not.toContain("version-script");
    expect(existsSync(new URL("../src-tauri/hide-bundled-sqlite.map", import.meta.url))).toBe(
      false,
    );
  });

  it("no longer re-executes itself as a CEF subprocess", () => {
    // CEF used to re-exec this binary for its render/GPU/zygote children, which
    // forced execute_process to be the first statement in main.
    expect(appMain).not.toContain("execute_subprocess");
    expect(appBackend).not.toContain("cef_osr");
  });

  it("ships no CEF runtime in any bundle", () => {
    const forbidden = /libcef|icudtl|swiftshader|resources\.pak|v8_context_snapshot|chrome_elf/i;
    for (const format of ["deb", "rpm", "appimage"]) {
      const files = linuxBundleConfig.bundle?.linux?.[format]?.files ?? {};
      expect(Object.keys(files).join(" "), `${format} still ships CEF`).not.toMatch(forbidden);
    }
    expect(JSON.stringify(windowsBundleConfig.bundle ?? {})).not.toMatch(forbidden);
    // beforeBundleCommand only existed to strip libcef before packaging it.
    expect(tauriConfig.build.beforeBundleCommand).toBeUndefined();
    expect(existsSync(new URL("../scripts/optimize-cef-runtime.mjs", import.meta.url))).toBe(false);
  });
});

describe("the helper owns CEF", () => {
  it("is a workspace member the app build does not pull in", () => {
    expect(appManifest).toContain("[workspace]");
    expect(appManifest).toContain('members = ["viewport"]');
  });

  it("depends on cef and builds a binary", () => {
    expect(helperManifest).toMatch(/^cef\s*=/m);
    expect(helperManifest).toContain('name = "polyui-viewport"');
  });

  it("does not also declare cef-dll-sys as a build-dependency", () => {
    // cef-dll-sys arrives through `cef`. Declaring it again under
    // [build-dependencies] makes cargo compile a second, host-side unit and run
    // its build script twice — and the two runs race extracting CEF into the
    // same CEF_PATH, which fails a cold build with a rename ENOENT.
    expect(helperManifest).not.toContain("[build-dependencies]");
    expect(helperManifest).not.toContain("cef-dll-sys");
  });

  it("downloads packs from the repo the pack workflow publishes to", () => {
    // The download URL is compiled into every shipped build, so a build whose
    // PACK_REPO disagrees with where CI publishes ships a browser that 404s.
    const downloadsFrom = packModule.match(/PACK_REPO: &str = "([^"]+)"/)?.[1];
    const publishesTo = packWorkflow.match(/repository: (\S+)/)?.[1];
    expect(downloadsFrom).toBe(publishesTo);
  });

  it("pins the CEF version the app looks for to the one it is built against", () => {
    // The app resolves the downloaded pack at
    // <data>/com.tslater.polyui/viewport/<CEF_VERSION>/. If these drift, the app
    // silently looks in a directory the pack workflow never writes.
    const declared = viewportModule.match(/CEF_VERSION: &str = "([^"]+)"/)?.[1];
    const built = helperManifest.match(/^cef\s*=\s*\{\s*version\s*=\s*"([\d.]+)"/m)?.[1];
    expect(declared).toBeDefined();
    expect(built).toBeDefined();
    // cef 150.0.0 tracks CEF 150.0.10; compare the major line, which is what a
    // version bump actually changes.
    expect(declared!.split(".")[0]).toBe(built!.split(".")[0]);
  });
});
