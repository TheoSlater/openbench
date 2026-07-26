import { X } from "lucide-react";
import { Reorder } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function DrawerTab({
  id,
  icon,
  label,
  active,
  dragging,
  reduceMotion,
  onSelect,
  onClose,
  onDragStart,
  onDragEnd,
}: {
  id: string;
  icon: ReactNode;
  label: string;
  active: boolean;
  dragging?: boolean;
  reduceMotion?: boolean;
  onSelect: () => void;
  onClose?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <Reorder.Item
      as="div"
      value={id}
      dragMomentum={false}
      dragElastic={0.04}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      whileDrag={reduceMotion ? undefined : { scale: 1.03 }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 500, damping: 40 }
      }
      className={cn(
        "group relative inline-flex h-8 min-w-0 shrink-0 cursor-grab items-center rounded-2xl text-sm font-medium text-foreground active:cursor-grabbing [&_svg]:size-4",
        active && "bg-sidebar-accent shadow-sm",
        dragging && "z-10 bg-sidebar-accent shadow-lg ring-1 ring-border",
      )}
    >
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        onClick={onSelect}
        className="inline-flex h-full min-w-0 items-center gap-2 rounded-l-2xl pl-3 pr-1"
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>
      {onClose ? (
        <button
          type="button"
          data-tab-close
          aria-label={`Close ${label} tab`}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="mr-1 inline-flex size-5 items-center justify-center rounded-full text-muted-foreground opacity-70 hover:bg-sidebar-accent hover:text-foreground group-hover:opacity-100"
        >
          <X size={12} />
        </button>
      ) : null}
    </Reorder.Item>
  );
}

/** Hostname if the value parses as a URL, else a truncated fallback. */
export function browserTabLabel(value?: string | null) {
  if (!value) return "New tab";
  try {
    return new URL(value).hostname.replace(/^www\./, "") || "New tab";
  } catch {
    return value.length > 22 ? `${value.slice(0, 22)}...` : value;
  }
}
