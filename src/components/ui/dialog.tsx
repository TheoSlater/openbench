import * as React from "react";
import { Dialog as MuiDialog, Box } from "@mui/material";

export function Dialog({
  children,
  open,
  onOpenChange,
}: {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <MuiDialog
      open={open || false}
      onClose={() => onOpenChange?.(false)}
      maxWidth={false}
      PaperProps={{
        sx: {
          bgcolor: "transparent",
          backgroundImage: "none",
          boxShadow: "none",
          m: 0,
        },
      }}
    >
      {children}
    </MuiDialog>
  );
}

export function DialogContent({
  children,
}: {
  children: React.ReactNode;
  showCloseButton?: boolean;
}) {
  return (
    <Box
      sx={{
        bgcolor: "#0d0d0d",
        border: "1px solid rgba(255, 255, 255, 0.05)",
        borderRadius: "16px",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {children}
    </Box>
  );
}

export function DialogTitle({ children }: { children: React.ReactNode }) {
  return <Box>{children}</Box>;
}

export function DialogClose({
  children,
  render,
}: {
  children?: React.ReactNode;
  render?: React.ReactElement<any>;
}) {
  if (render) {
    return React.cloneElement(render, {
      onClick: (e: React.MouseEvent) => {
        render.props.onClick?.(e);
      },
      children: children || render.props.children,
    });
  }
  return <>{children}</>;
}
