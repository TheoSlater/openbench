import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/features/sidebar/hooks/useReducedMotion";

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

/** Body for `SidebarMenuButton asChild`. Rows that embed their own buttons
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
  return (
    <div className="flex min-h-6 items-center justify-between">
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
              "flex size-4 items-center justify-center [&>svg]:size-3.5",
              !reduceMotion && "transition-transform duration-200 ease-out",
              disclosure.expanded && "rotate-90",
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
      {action}
    </div>
  );
}
