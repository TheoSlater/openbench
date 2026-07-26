import { useCallback, useRef } from "react";
import { BashShell } from "@wterm/just-bash";
import { Terminal, useTerminal } from "@wterm/react";
import "@wterm/react/css";
import { useSettingsStore } from "@/store/settingsStore";
import { NativeTerminalViewport } from "./NativeTerminalViewport";

export function TerminalViewport() {
  const betaFeatures = useSettingsStore(
    (state) => state.general.betaFeatures,
  );
  const terminalEmulator = useSettingsStore(
    (state) => state.general.terminalEmulator,
  );

  if (!betaFeatures) return null;

  return terminalEmulator === "native" ? (
    <NativeTerminalViewport />
  ) : (
    <BrowserTerminalViewport />
  );
}

function BrowserTerminalViewport() {
  const { ref, write } = useTerminal();
  const shellRef = useRef<BashShell | null>(null);

  // TODO: Add an AI-callable shell tool that runs commands only after user permission.
  const handleReady = useCallback(() => {
    if (shellRef.current) return;
    const shell = new BashShell();
    shellRef.current = shell;
    void shell.attach(write);
  }, [write]);

  const handleData = useCallback((data: string) => {
    void shellRef.current?.handleInput(data);
  }, []);

  return (
    <Terminal
      ref={ref}
      aria-label="Terminal"
      autoResize
      cursorBlink
      className="h-full w-full rounded-none shadow-none"
      onReady={handleReady}
      onData={handleData}
    />
  );
}
