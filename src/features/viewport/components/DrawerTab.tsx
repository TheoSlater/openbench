import { X } from "lucide-react";
import type { ReactNode } from "react";

export function DrawerTab({
  icon,
  label,
  onClose,
}: {
  icon: ReactNode;
  label: string;
  onClose?: () => void;
}) {
  return (
    <div className="group inline-flex h-8 min-w-0 items-center rounded-2xl bg-sidebar-accent text-sm font-medium text-foreground shadow-sm [&_svg]:size-4">
      <span className="inline-flex h-full min-w-0 items-center gap-2 rounded-l-2xl pl-3 pr-1">
        {icon}
        <span className="truncate">{label}</span>
      </span>
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
    </div>
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
