import { ChevronDown, Timer } from "lucide-react";

interface ReasoningIndicatorProps {
  isStreaming: boolean;
  elapsedMs: number;
  lastDurationMs: number | null;
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.max(1, Math.ceil(totalSeconds / 60));
  return `${totalMinutes}m`;
}

export function ReasoningIndicator({
  isStreaming,
  elapsedMs,
  lastDurationMs,
}: ReasoningIndicatorProps) {
  const displayMs = lastDurationMs ?? elapsedMs;

  return (
    <details className="group w-fit">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full bg-[#2a2a2a] px-3 py-1 text-[12px] text-muted-foreground/80 transition-colors hover:text-foreground/80">
        <Timer className="size-3.5" />
        <span>
          {isStreaming
            ? "Thinking..."
            : `Thought for ${formatDuration(displayMs)}`}
        </span>
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-3 flex flex-col gap-3 text-[13px] text-muted-foreground/70">
        <div className="relative flex items-start gap-3">
          <div className="relative mt-1.5 flex h-4 w-2 items-start justify-center">
            <div className="h-2 w-2 rounded-full bg-muted-foreground/70" />
            <div className="absolute top-3 h-4 w-px bg-muted-foreground/30" />
          </div>
          <div className="flex-1">Analyzing the user's request</div>
          <ChevronDown className="mt-0.5 size-3.5 text-muted-foreground/60" />
        </div>
        <div className="relative flex items-start gap-3">
          <div className="relative mt-1.5 flex h-4 w-2 items-start justify-center">
            <div className="h-2 w-2 rounded-full bg-muted-foreground/70" />
            <div className="absolute top-3 h-4 w-px bg-muted-foreground/30" />
          </div>
          <div className="flex-1">Considering implementation options</div>
          <ChevronDown className="mt-0.5 size-3.5 text-muted-foreground/60" />
        </div>
        <div className="relative flex items-start gap-3">
          <div className="relative mt-1.5 flex h-4 w-2 items-start justify-center">
            <div className="h-2 w-2 rounded-full bg-muted-foreground/70" />
          </div>
          <div className="flex-1">Selecting the best approach</div>
          <ChevronDown className="mt-0.5 size-3.5 text-muted-foreground/60" />
        </div>
      </div>
    </details>
  );
}
