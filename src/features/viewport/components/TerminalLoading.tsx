import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { TextShimmer } from "@/components/ui/text-shimmer";

/**
 * Shown while a terminal module is being fetched or its PTY is starting.
 *
 * Sits on the panel background rather than the terminal's own black so it
 * reads as the drawer filling in, not as a terminal that failed to draw.
 */
export function TerminalLoading({ label, error = false }: { label: string; error?: boolean }) {
  const reduceMotion = useReducedMotion();

  return (
    <div
      className="flex h-full w-full items-center justify-center gap-2 bg-sidebar text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      <Loader2 className={cn("size-4", !reduceMotion && !error && "animate-spin")} />
      <span
        key={label}
        className={cn(
          "text-sm",
          !reduceMotion && "animate-in fade-in-0 slide-in-from-bottom-1 duration-200",
        )}
      >
        {error ? label : <TextShimmer duration={2} spread={15}>{label}</TextShimmer>}
      </span>
    </div>
  );
}
