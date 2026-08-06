import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";

export const sidebarIconButtonClassName =
  "size-7 min-w-7 rounded-full bg-transparent p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-muted";

/** Keyboard activation for div-based rows: only when the row itself is
 * focused, so Enter inside an embedded input (rename) doesn't click the row. */
export function activateRowOnKeyDown(event: React.KeyboardEvent<HTMLElement>) {
  if (
    (event.key === "Enter" || event.key === " ") &&
    event.target === event.currentTarget
  ) {
    event.preventDefault();
    event.currentTarget.click();
  }
}

/** Body for custom `SidebarMenuButton` rows. Rows that embed their own buttons
 * (actions menu, rename controls) can't be a real <button> — HTML forbids
 * nesting them and React warns loudly — so the row renders as a div with
 * button semantics restored. */
export function SidebarMenuRow({
  onKeyDown,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented) activateRowOnKeyDown(event);
      }}
      {...props}
    />
  );
}

export function SidebarSectionHeader({
  label,
  action,
  disclosure,
}: {
  label: string;
  action?: React.ReactNode;
  disclosure?: {
    expanded: boolean;
    onToggle: () => void;
    controlsId: string;
  };
}) {
  const reduceMotion = useReducedMotion();
  // At rest the header is just a muted label, flush with the rows below it;
  // the action fades in on hover/focus so the resting sidebar stays quiet.
  const revealed =
    "opacity-0 transition-opacity group-hover/section:opacity-100 group-focus-within/section:opacity-100";
  return (
    <div className="group/section flex min-h-6 items-center justify-between">
      {disclosure ? (
        <button
          type="button"
          aria-expanded={disclosure.expanded}
          aria-controls={disclosure.controlsId}
          onClick={disclosure.onToggle}
          className="flex h-6 min-w-0 items-center gap-1 rounded-lg pr-2 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span
            className={cn(
              "size-4 items-center justify-center [&>svg]:size-3.5",
              !reduceMotion && "transition-transform duration-200 ease-out",
              // Expanded is the resting state, so the chevron leaves the
              // layout entirely — at `opacity-0` it still reserved its box and
              // indented the label away from the rows below it. Collapsed, it
              // is the only cue the section can be reopened, so it stays.
              disclosure.expanded ? "hidden" : "flex opacity-100",
            )}
          >
            <ChevronRight />
          </span>
          <span className="text-xs font-medium leading-[1.2]">
            {label}
          </span>
        </button>
      ) : (
        <span className="text-xs font-medium leading-[1.2] text-muted-foreground">
          {label}
        </span>
      )}
      {action ? <div className={revealed}>{action}</div> : null}
    </div>
  );
}

/** "2w", "3d", "5m" — the compact age shown at the right edge of a chat row. */
export function shortTimeAgo(value: string | number | Date) {
  const seconds = (Date.now() - new Date(value).getTime()) / 1000;
  if (seconds < 60) return "now";
  const units: [number, string][] = [
    [31536000, "y"],
    [2592000, "mo"],
    [604800, "w"],
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
  ];
  const [size, suffix] = units.find(([n]) => seconds >= n)!;
  return `${Math.floor(seconds / size)}${suffix}`;
}
