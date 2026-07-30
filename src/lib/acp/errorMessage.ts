import type { AcpError } from "@/generated/bindings/AcpError";

/**
 * Render a normalized ACP error for display.
 *
 * Every variant carries something specific, so this never falls back to a
 * generic "something went wrong". Where the agent supplied its own wording it
 * is passed through verbatim — a version complaint from an adapter is the
 * adapter's sentence, not one Poly UI invented.
 *
 * Exhaustive by construction: adding a variant in Rust regenerates the binding
 * and breaks this switch at compile time.
 */
export function acpErrorMessage(error: AcpError): string {
  switch (error.kind) {
    case "resolve":
    case "spawn":
    case "protocol":
    case "agent":
      return error.message;
    case "initialize":
    case "transport":
      // The agent's stderr tail is usually the real explanation.
      return error.stderr_tail ? `${error.message}\n\n${error.stderr_tail}` : error.message;
    case "timeout":
      return `${error.operation} timed out after ${Number(error.elapsed_ms)}ms`;
    case "request-timeout":
      return `The coding agent did not answer within ${Number(error.elapsed_ms)}ms`;
    case "idle-timeout":
      return `The coding agent was idle for ${Number(error.elapsed_ms)}ms`;
    case "hard-turn-timeout":
      return `The coding agent turn exceeded ${Number(error.elapsed_ms)}ms`;
    case "write-timeout":
      return `The coding agent stopped reading after ${Number(error.elapsed_ms)}ms`;
    case "cancel-drain-timeout":
      return `The coding agent did not stop within ${Number(error.elapsed_ms)}ms`;
    case "agent-exited": {
      const message = error.exit_code === null
        ? "The coding agent exited"
        : `The coding agent exited with code ${error.exit_code}`;
      return error.stderr_tail ? `${message}\n\n${error.stderr_tail}` : message;
    }
    case "cancelled":
      return `${error.operation} was cancelled`;
  }
}

/** Whether retrying the same operation could plausibly succeed. */
export function isRetryable(error: AcpError): boolean {
  return [
    "timeout",
    "request-timeout",
    "idle-timeout",
    "write-timeout",
    "agent-exited",
    "transport",
    "spawn",
  ].includes(error.kind);
}

export function needsReauthentication(error: AcpError): boolean {
  if (error.kind !== "agent" && error.kind !== "transport" && error.kind !== "initialize") {
    return false;
  }
  if (error.kind === "agent" && error.code === 401) return true;
  const message = error.message.toLowerCase();
  return (
    (message.includes("unauthorized") && message.includes("sign"))
    || (message.includes("authentication") && message.includes("expired"))
    || (message.includes("credential") && message.includes("expired"))
  );
}
