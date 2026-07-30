import { lazy, Suspense } from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { TerminalLoading } from "./TerminalLoading";

// Ghostty's WASM core is intentionally split from the drawer so opening the
// viewport does not make the drawer wait for the terminal engine to download.
const NativeTerminalViewportLazy = lazy(() =>
  import("./NativeTerminalViewport").then((module) => ({
    default: module.NativeTerminalViewport,
  })),
);
const XtermTerminalViewportLazy = lazy(() =>
  import("./XtermTerminalViewport").then((module) => ({
    default: module.XtermTerminalViewport,
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
      {terminalEmulator === "xterm" ? (
        <XtermTerminalViewportLazy />
      ) : (
        <NativeTerminalViewportLazy />
      )}
    </Suspense>
  );
}
