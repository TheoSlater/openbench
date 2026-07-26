import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const buildScript = readFileSync(new URL("../src-tauri/build.rs", import.meta.url), "utf8");
const optimizer = readFileSync(
  new URL("../scripts/optimize-cef-runtime.mjs", import.meta.url),
  "utf8",
);
const tauriConfig = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const appBackend = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const startup = readFileSync(new URL("../src/startup.ts", import.meta.url), "utf8");
const linuxBundleConfig = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.linux.conf.json", import.meta.url), "utf8"),
);
const windowsBundleConfig = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.windows.conf.json", import.meta.url), "utf8"),
);
const cargoManifest = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
const platform = readFileSync(new URL("../src/lib/utils/platform.ts", import.meta.url), "utf8");

describe("CEF packaging", () => {
  it("optimizes CEF after Cargo finishes building it", () => {
    expect(tauriConfig.build.beforeBundleCommand).toBe(
      "node scripts/optimize-cef-runtime.mjs",
    );
  });

  it("strips CEF symbols only from Linux release builds", () => {
    expect(optimizer).toContain('platform === "linux"');
    expect(optimizer).toContain('spawnSync("strip"');
    expect(optimizer).toContain('"--strip-unneeded"');
  });

  it("compiles CEF on Linux and Windows but never macOS", () => {
    // macOS needs helper .app bundles inside Contents/Frameworks rather than
    // re-executing this binary, which the Tauri bundler does not produce.
    expect(cargoManifest).toContain(
      `[target.'cfg(any(target_os = "linux", target_os = "windows"))'.dependencies]`,
    );
    expect(buildScript).toContain('if target.contains("linux") || target.contains("windows")');
    expect(buildScript).toContain("cargo::rustc-cfg=cef");
    expect(platform).toContain("SUPPORTS_CHROMIUM_BROWSER = IS_LINUX || IS_WINDOWS");
  });

  it("stages CEF before Tauri validates bundle resources", () => {
    expect(cargoManifest).toContain(
      `[target.'cfg(any(target_os = "linux", target_os = "windows"))'.build-dependencies]`,
    );
    expect(cargoManifest).toContain('cef-dll-sys = "150.0.0"');
  });

  it("ships the CEF runtime beside the exe on Windows", () => {
    expect(windowsBundleConfig.bundle).not.toHaveProperty("//");
    // Same rule as Linux: libcef.dll is a load-time dependency and resolves
    // its data files from its own directory. On Windows, Tauri resources land
    // next to the exe, so `resources` is the right mechanism here.
    const resources = windowsBundleConfig.bundle.resources;
    const required = [
      "libcef.dll",
      // libcef.dll will not load without it.
      "chrome_elf.dll",
      "icudtl.dat",
      "resources.pak",
      "chrome_100_percent.pak",
      "chrome_200_percent.pak",
      "v8_context_snapshot.bin",
      "locales/en-US.pak",
    ];
    for (const file of required) {
      expect(Object.values(resources), `Windows bundle is missing ${file}`).toContain(file);
    }
  });

  it("keeps only runtime files needed by the configured locale", () => {
    expect(optimizer).toContain('"en-US.pak"');
    expect(optimizer).toContain('"CREDITS.html"');
    expect(optimizer).toContain("await rm");
  });

  it("ships the CEF runtime beside libcef.so in every Linux package", () => {
    // libcef.so is a hard DT_NEEDED dependency of the binary and CEF resolves
    // icudtl.dat/pak files/locales from the directory containing libcef.so,
    // so every bundle format must carry the full runtime in /usr/lib/PolyUI.
    const requiredFiles = [
      "/usr/lib/PolyUI/libcef.so",
      "/usr/lib/PolyUI/icudtl.dat",
      "/usr/lib/PolyUI/resources.pak",
      "/usr/lib/PolyUI/chrome_100_percent.pak",
      "/usr/lib/PolyUI/chrome_200_percent.pak",
      "/usr/lib/PolyUI/v8_context_snapshot.bin",
      "/usr/lib/PolyUI/locales/en-US.pak",
    ];
    for (const format of ["deb", "rpm", "appimage"]) {
      const files = linuxBundleConfig.bundle.linux[format].files;
      for (const required of requiredFiles) {
        expect(files[required], `${format} is missing ${required}`).toBeDefined();
      }
    }
  });

  it("resolves libcef.so from the installed usr/lib/PolyUI layout", () => {
    expect(buildScript).toContain("$ORIGIN:$ORIGIN/../lib/PolyUI");
  });

  it("initializes CEF only when its boot preference is enabled", () => {
    expect(appBackend).toContain("#[cfg(cef)]");
    expect(appBackend).toContain("cef_osr::enabled_on_next_start()");
    expect(appBackend).toContain("tauri::process::restart");
    expect(startup).toContain("cefViewportIsEnabled");
  });
});
