import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { resizePty, writePty } from "../pty";
import {
  getAiTerminalSession,
  subscribeAiTerminal,
  type AiTerminalSession,
} from "../aiTerminal";
import { TerminalLoading } from "./TerminalLoading";

/**
 * The real terminal behind the AI's terminal tool: the command runs in the
 * host PTY and is rendered here with xterm.js, input included.
 */
export function AiTerminalViewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const writtenRef = useRef(0);
  const attachRef = useRef<{ ptyId: string | null; done: boolean }>({
    ptyId: null,
    done: false,
  });
  const [session, setSession] = useState<AiTerminalSession | null>(
    () => getAiTerminalSession(),
  );

  useEffect(() => {
    return subscribeAiTerminal(setSession);
  }, []);

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
    terminalRef.current = terminal;

    const input = terminal.onData((data) => {
      const { ptyId, done } = attachRef.current;
      if (ptyId && !done) void writePty(ptyId, data);
    });
    const resized = terminal.onResize(({ cols, rows }) => {
      const { ptyId } = attachRef.current;
      if (ptyId) void resizePty(ptyId, cols, rows);
    });
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(container);

    return () => {
      observer.disconnect();
      input.dispose();
      resized.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal || !session) return;
    if (sessionIdRef.current !== session.toolCallId) {
      sessionIdRef.current = session.toolCallId;
      writtenRef.current = 0;
      terminal.reset();
    }
    attachRef.current = { ptyId: session.ptyId, done: session.done };
    const pending = session.events.slice(writtenRef.current);
    writtenRef.current = session.events.length;
    for (const event of pending) {
      if (event.kind === "data" && event.data) {
        terminal.write(Uint8Array.from(event.data));
      } else if (event.kind === "error") {
        terminal.writeln(`\r\nPTY error: ${event.message ?? "unknown error"}`);
      } else if (event.kind === "exit") {
        terminal.writeln("\r\n[Process exited]");
      }
    }
    if (session.ptyId) {
      void resizePty(session.ptyId, terminal.cols, terminal.rows);
    }
  }, [session]);

  const waiting = !session || (!session.ptyId && !session.error);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full bg-black p-3" />
      {waiting ? (
        <div className="absolute inset-0">
          <TerminalLoading
            label={session ? "Waiting for command…" : "Waiting for the AI to run a command…"}
          />
        </div>
      ) : null}
    </div>
  );
}
