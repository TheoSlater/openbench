import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";

/**
 * Shown while a terminal module is being fetched or its PTY is starting.
 *
 * Sits on the panel background rather than the terminal's own black so it
 * reads as the drawer filling in, not as a terminal that failed to draw.
 */
export function TerminalLoading({ label }: { label: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      className="flex h-full w-full items-center justify-center gap-2 bg-sidebar text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2 className={cn("size-4", !reduceMotion && "animate-spin")} />
      <span className="text-sm">{label}</span>
    </div>
  );
}
