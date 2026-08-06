import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type TooltipLabelProps = {
  title?: React.ReactNode;
  placement?: "top" | "right" | "bottom" | "left";
  arrow?: boolean;
  children: React.ReactElement;
};

export function TooltipLabel({
  title,
  placement = "top",
  arrow: _arrow,
  children,
}: TooltipLabelProps) {
  if (!title) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={placement}>{title}</TooltipContent>
    </Tooltip>
  );
}
