import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Check, Clipboard, History, RotateCcw, ShieldCheck, Square, Trash2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";
import { IconButton } from "@/components/ui/icon-button";
import { resizePty, writePty } from "../pty";
import {
  getAiTerminalOutput,
  getAiTerminalSession,
  resetAiSandbox,
  stopAiCommand,
  subscribeAiTerminal,
  type SandboxDiagnostics,
  type AiTerminalSession,
} from "../aiTerminal";
import { TerminalLoading } from "./TerminalLoading";

function formatBytes(value: number): string {
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KiB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

function formatAge(value: number): string {
  if (value < 1_000) return "now";
  if (value < 60_000) return `${Math.round(value / 1_000)}s`;
  return `${Math.round(value / 60_000)}m`;
}

/**
 * Visible xterm attached to the AI sandbox PTY.
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
  const [copied, setCopied] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SandboxDiagnostics | null>(null);
  const [sandboxUnavailable, setSandboxUnavailable] = useState(false);

  useEffect(() => {
    return subscribeAiTerminal(setSession);
  }, []);

  useEffect(() => setCopied(false), [session?.toolCallId]);

  useEffect(() => {
    const sandboxId = session?.sandboxId;
    if (!sandboxId) {
      setDiagnostics(null);
      setSandboxUnavailable(false);
      return;
    }
    let disposed = false;
    let stopDestroyed: (() => void) | undefined;
    const load = async () => {
      try {
        const next = await invoke<SandboxDiagnostics>("sandbox_diagnostics", { sandboxId });
        if (!disposed) {
          setDiagnostics(next);
          setSandboxUnavailable(false);
        }
      } catch {
        if (!disposed) {
          setDiagnostics(null);
          setSandboxUnavailable(Boolean(session?.done || session?.resetting));
        }
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5_000);
    void listen<string>("sandbox-destroyed", ({ payload }) => {
      if (payload === sandboxId) {
        setDiagnostics(null);
        setSandboxUnavailable(true);
      }
    })
      .then((stop) => {
        if (disposed) stop();
        else stopDestroyed = stop;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      stopDestroyed?.();
    };
  }, [session?.sandboxId, session?.done, session?.resetting]);

  useLayoutEffect(() => {
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
        terminal.writeln(`\r\nSandbox error: ${event.message ?? "unknown error"}`);
      } else if (event.kind === "exit") {
        terminal.writeln("\r\n[Process exited]");
      }
    }
    if (session.ptyId) {
      void resizePty(session.ptyId, terminal.cols, terminal.rows);
    }
  }, [session]);

  const waiting = !session || (!session.ptyId && !session.done);
  const loadingLabel = session?.error
    ? `Sandbox error: ${session.error}`
    : session?.status
      ?? (session ? "Starting sandbox…" : "Waiting for the AI to run a command…");
  const commandRunning = Boolean(session && session.ptyId && !session.done);
  const outputAvailable = Boolean(getAiTerminalOutput());

  const clearTerminal = () => {
    terminalRef.current?.reset();
    writtenRef.current = session?.events.length ?? 0;
    terminalRef.current?.focus();
  };

  const copyOutput = async () => {
    const output = getAiTerminalOutput();
    if (!output || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(output);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const resetSandbox = () => {
    if (window.confirm("Reset this sandbox? Its workspace and installed packages will be deleted.")) {
      void resetAiSandbox();
    }
  };

  const result = !session
    ? "Idle"
    : sandboxUnavailable
      ? "Sandbox unavailable"
      : session.error
      ? "Failed"
      : session.resetting
        ? session.status ?? "Sandbox reset"
        : !session.done
          ? session.status ?? "Running"
          : session.exitCode === 0
            ? "Exited 0"
            : session.exitCode == null
              ? "Exited"
              : `Exited ${session.exitCode}`;

  const duration = session?.durationMs == null
    ? ""
    : session.durationMs < 1_000
      ? `${session.durationMs}ms`
      : `${(session.durationMs / 1_000).toFixed(1)}s`;

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-2">
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${session?.error ? "bg-destructive" : commandRunning ? "bg-emerald-500" : "bg-muted-foreground/50"}`}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={session?.command}>
          {session?.command ?? "AI sandbox terminal"}
        </span>
        <span className="max-w-40 truncate text-[11px] text-muted-foreground" title={result}>
          {result}
        </span>
        {duration ? <span className="text-[11px] text-muted-foreground">{duration}</span> : null}
        {session ? (
          <details className="relative">
            <summary
              className={`flex cursor-pointer list-none items-center gap-1 rounded px-1.5 py-1 text-[11px] hover:bg-muted ${sandboxUnavailable ? "text-destructive" : "text-muted-foreground hover:text-foreground"}`}
              aria-label="Show sandbox diagnostics"
              title="Sandbox diagnostics"
            >
              <ShieldCheck size={13} />
              Sandbox
            </summary>
            <div className="absolute right-0 top-8 z-30 w-72 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md">
              {diagnostics ? (
                <>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <span className="font-medium">{diagnostics.runtime}</span>
                    <span className="text-muted-foreground">{diagnostics.state}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    <span>Workspace</span>
                    <span className="text-right text-foreground">{formatBytes(diagnostics.workspaceBytes)} / {formatBytes(diagnostics.workspaceLimitBytes)}</span>
                    <span>Memory</span>
                    <span className="text-right text-foreground">{formatBytes(diagnostics.memoryLimitBytes)}</span>
                    <span>CPU</span>
                    <span className="text-right text-foreground">{diagnostics.cpuLimit} cores</span>
                    <span>Processes</span>
                    <span className="text-right text-foreground">{diagnostics.activeCommands} / {diagnostics.pidsLimit}</span>
                    <span>Idle</span>
                    <span className="text-right text-foreground">{formatAge(diagnostics.lastActivityAgeMs)}</span>
                  </div>
                  <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
                    <div>Network: <span className="text-foreground">{diagnostics.networkPolicy}</span></div>
                    <div className="mt-1 truncate" title={diagnostics.containerName}>Container: {diagnostics.containerName}</div>
                  </div>
                  {diagnostics.capabilities.length ? (
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      Tools: <span className="text-foreground">{diagnostics.capabilities.join(", ")}</span>
                    </div>
                  ) : null}
                  {diagnostics.ports.length ? (
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      <div>Preview ports</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {diagnostics.ports.map((port) => (
                          <a
                            key={port.containerPort}
                            className="rounded bg-muted px-1.5 py-0.5 text-foreground hover:underline"
                            href={port.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            :{port.containerPort}
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {sandboxUnavailable ? "Cleaned up or unavailable." : "Loading sandbox status…"}
                </div>
              )}
            </div>
          </details>
        ) : null}
        {session?.history.length ? (
          <details className="relative">
            <summary
              className="flex cursor-pointer list-none items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Show terminal history"
            >
              <History size={13} />
              {session.history.length}
            </summary>
            <div className="absolute right-0 top-8 z-30 max-h-64 w-72 overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
              {[...session.history].reverse().map((entry) => (
                <div key={entry.toolCallId} className="rounded px-2 py-1.5 text-xs hover:bg-muted">
                  <div className="truncate font-mono" title={entry.command}>{entry.command}</div>
                  <div className="text-muted-foreground">
                    {entry.status}
                    {entry.durationMs == null ? "" : ` · ${(entry.durationMs / 1_000).toFixed(1)}s`}
                    {entry.exitCode == null ? "" : ` · ${entry.exitCode}`}
                  </div>
                </div>
              ))}
            </div>
          </details>
        ) : null}
        <IconButton
          size="small"
          aria-label="Stop AI command"
          title="Stop command"
          disabled={!commandRunning}
          onClick={() => void stopAiCommand()}
        >
          <Square size={13} fill="currentColor" />
        </IconButton>
        <IconButton
          size="small"
          aria-label="Copy terminal output"
          title="Copy output"
          disabled={!outputAvailable}
          onClick={() => void copyOutput()}
        >
          {copied ? <Check size={14} /> : <Clipboard size={14} />}
        </IconButton>
        <IconButton
          size="small"
          aria-label="Clear terminal output"
          title="Clear output"
          disabled={!session}
          onClick={clearTerminal}
        >
          <Trash2 size={14} />
        </IconButton>
        <IconButton
          size="small"
          aria-label="Reset AI sandbox"
          title="Reset sandbox"
          disabled={!session || session.status === "Resetting sandbox…"}
          onClick={resetSandbox}
        >
          <RotateCcw size={14} />
        </IconButton>
      </header>
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full bg-black p-3" />
      {waiting ? (
        <div className="absolute inset-0">
          <TerminalLoading label={loadingLabel} error={Boolean(session?.error)} />
        </div>
      ) : null}
      </div>
    </div>
  );
}
