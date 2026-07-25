import * as React from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ChipProps = React.HTMLAttributes<HTMLSpanElement> & {
  label?: React.ReactNode;
  onDelete?: () => void;
  size?: "small" | "medium";
  color?: "default" | "primary" | "success" | "error" | "warning";
  icon?: React.ReactNode;
  clickable?: boolean;
  disabled?: boolean;
};

export function Chip({
  label,
  children,
  onDelete,
  size = "medium",
  color = "default",
  icon,
  clickable,
  disabled,
  className,
  ...props
}: ChipProps) {
  return (
    <Badge
      className={cn(
        "gap-1 rounded-full",
        size === "small" && "px-2 py-0 text-xs",
        clickable && "cursor-pointer select-none bg-transparent hover:bg-foreground/[0.06]",
        disabled && "pointer-events-none opacity-50",
        color === "success" && "bg-[var(--success-soft)] text-success",
        color === "error" && "bg-destructive/10 text-destructive",
        color === "warning" && "bg-[var(--warning-soft)] text-warning",
        color === "primary" && "bg-primary text-primary-foreground",
        className,
      )}
      {...props}
    >
      {icon ? <span className="inline-flex shrink-0">{icon}</span> : null}
      {label ?? children}
      {onDelete ? (
        <button type="button" onClick={onDelete} className="ml-1 rounded-full">
          <X size={12} />
        </button>
      ) : null}
    </Badge>
  );
}
