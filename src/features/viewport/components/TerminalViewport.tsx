import { lazy, Suspense } from "react";
import { useSettingsStore } from "@/store/settingsStore";
import { TerminalLoading } from "./TerminalLoading";

// The xterm.js engine is intentionally split from the drawer so opening the
// viewport does not make the drawer wait for the terminal engine to download.
const XtermTerminalViewportLazy = lazy(() =>
  import("./XtermTerminalViewport").then((module) => ({
    default: module.XtermTerminalViewport,
  })),
);

export function TerminalViewport() {
  const betaFeatures = useSettingsStore((state) => state.general.betaFeatures);
  if (!betaFeatures) return null;

  return (
    <Suspense fallback={<TerminalLoading label="Loading terminal…" />}>
      <XtermTerminalViewportLazy />
    </Suspense>
  );
}
