import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonBaseProps = {
  as?: React.ElementType;
  component?: React.ElementType;
  className?: string;
  type?: React.ButtonHTMLAttributes<HTMLButtonElement>["type"];
  children?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
  onMouseEnter?: React.MouseEventHandler<HTMLElement>;
  onMouseLeave?: React.MouseEventHandler<HTMLElement>;
} & Record<string, any>;

export function ButtonBase({
  as,
  component,
  type,
  className,
  ...props
}: ButtonBaseProps) {
  const Component = (as ?? component ?? "button") as React.ElementType;
  const typeProps = Component === "button" ? { type: type ?? "button" } : {};
  return (
    <Component
      {...typeProps}
      className={cn(
        "border border-transparent bg-transparent text-left select-none outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30",
        className,
      )}
      {...props}
    />
  );
};
