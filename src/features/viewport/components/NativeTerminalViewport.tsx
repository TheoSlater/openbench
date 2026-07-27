import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { closePty, resizePty, startPty, writePty } from "../pty";
import { TerminalLoading } from "./TerminalLoading";

export function NativeTerminalViewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  // Spawning the shell is a round trip through Rust. Until it lands the
  // terminal is a black rectangle that swallows keystrokes, so cover it.
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "JetBrains Mono, monospace",
      fontSize: 14,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    fit.fit();
    terminal.focus();

    let id: string | null = null;
    let disposed = false;
    const input = terminal.onData((data) => {
      if (id) void writePty(id, data);
    });
    const resized = terminal.onResize(({ cols, rows }) => {
      if (id) void resizePty(id, cols, rows);
    });
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(container);

    void startPty(terminal.cols, terminal.rows, (event) => {
      if (disposed) return;
      if (event.kind === "data" && event.data) {
        terminal.write(Uint8Array.from(event.data));
      }
      if (event.kind === "error") {
        terminal.writeln(`\r\nPTY error: ${event.message ?? "unknown error"}`);
      }
      if (event.kind === "exit") terminal.writeln("\r\n[Process exited]");
    })
      .then((sessionId) => {
        if (disposed) {
          void closePty(sessionId);
        } else {
          id = sessionId;
          void resizePty(sessionId, terminal.cols, terminal.rows);
        }
      })
      .catch((error) => {
        terminal.writeln(`\r\nUnable to start PTY: ${String(error)}`);
      })
      .finally(() => {
        // Also on failure: the error is written into the terminal, so the
        // spinner must come off for it to be readable.
        if (!disposed) setStarting(false);
      });

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      resized.dispose();
      terminal.dispose();
      if (id) void closePty(id);
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full bg-black p-3" />
      {starting ? (
        <div className="absolute inset-0">
          <TerminalLoading label="Starting shell…" />
        </div>
      ) : null}
    </div>
  );
}
