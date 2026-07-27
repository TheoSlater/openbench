import { useCallback, useEffect, useRef, useState } from "react";
import { GhosttyCore } from "@wterm/ghostty";
import { Terminal, useTerminal, type WTerm } from "@wterm/react";
import "@wterm/react/css";
import { closePty, resizePty, startPty, writePty } from "../pty";
import { TerminalLoading } from "./TerminalLoading";

export function NativeTerminalViewport() {
  const { ref, write } = useTerminal();
  const sessionRef = useRef<string | null>(null);
  const disposedRef = useRef(false);
  const [core, setCore] = useState<GhosttyCore | null>(null);
  const [starting, setStarting] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    void GhosttyCore.load().then(setCore).catch(setLoadError);
    return () => {
      disposedRef.current = true;
      if (sessionRef.current) void closePty(sessionRef.current);
    };
  }, []);

  const handleReady = useCallback((terminal: WTerm) => {
    void startPty(terminal.cols, terminal.rows, (event) => {
      if (disposedRef.current) return;
      if (event.kind === "data" && event.data) {
        write(Uint8Array.from(event.data));
      }
      if (event.kind === "error") {
        write(`\r\nPTY error: ${event.message ?? "unknown error"}`);
      }
      if (event.kind === "exit") write("\r\n[Process exited]");
    })
      .then((sessionId) => {
        if (disposedRef.current) {
          void closePty(sessionId);
        } else {
          sessionRef.current = sessionId;
          void resizePty(sessionId, terminal.cols, terminal.rows);
        }
      })
      .catch((error) => {
        write(`\r\nUnable to start PTY: ${String(error)}`);
      })
      .finally(() => {
        if (!disposedRef.current) setStarting(false);
      });
  }, [write]);

  const handleData = useCallback((data: string) => {
    if (sessionRef.current) void writePty(sessionRef.current, data);
  }, []);

  const handleResize = useCallback((cols: number, rows: number) => {
    if (sessionRef.current) void resizePty(sessionRef.current, cols, rows);
  }, []);

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        Unable to load terminal: {String(loadError)}
      </div>
    );
  }

  if (!core) return <TerminalLoading label="Loading terminal…" />;

  return (
    <div className="relative h-full w-full bg-black p-3">
      <Terminal
        ref={ref}
        aria-label="Terminal"
        autoResize
        core={core}
        cursorBlink
        className="h-full w-full rounded-none shadow-none"
        onData={handleData}
        onReady={handleReady}
        onResize={handleResize}
      />
      {starting ? (
        <div className="absolute inset-0">
          <TerminalLoading label="Starting shell…" />
        </div>
      ) : null}
    </div>
  );
}
