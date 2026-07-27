import { lazy, Suspense } from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { TerminalLoading } from "./TerminalLoading";

// Both emulators are heavy — a WASM bash on one side, xterm on the other — and
// only ever one runs. Importing them eagerly put ~512kB in the drawer's chunk,
// all of which had to arrive before the drawer could paint. Split so the drawer
// opens immediately and only the chosen emulator is fetched.
const BrowserTerminalViewportLazy = lazy(() =>
  import("./BrowserTerminalViewport").then((module) => ({
    default: module.BrowserTerminalViewport,
  })),
);
const NativeTerminalViewportLazy = lazy(() =>
  import("./NativeTerminalViewport").then((module) => ({
    default: module.NativeTerminalViewport,
  })),
);

export function TerminalViewport() {
  const betaFeatures = useSettingsStore((state) => state.general.betaFeatures);
  const terminalEmulator = useSettingsStore(
    (state) => state.general.terminalEmulator,
  );

  if (!betaFeatures) return null;

  return (
    <Suspense fallback={<TerminalLoading label="Loading terminal…" />}>
      {terminalEmulator === "native" ? (
        <NativeTerminalViewportLazy />
      ) : (
        <BrowserTerminalViewportLazy />
      )}
    </Suspense>
  );
}
