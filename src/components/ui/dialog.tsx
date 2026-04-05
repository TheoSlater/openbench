import * as React from "react";
import { Dialog as MuiDialog, Box, SxProps, Theme } from "@mui/material";

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
  className,
  sx,
}: {
  children: React.ReactNode;
  showCloseButton?: boolean;
  className?: string;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box
      className={className}
      sx={{
        bgcolor: "background.sidebar",
        border: "1px solid",
        borderColor: "divider",
        borderRadius: "12px",
        overflow: "hidden",
        position: "relative",
        ...sx as any,
      }}
    >
      {children}
    </Box>
  );
}

export function DialogTitle({ 
  children,
  className,
  sx,
}: { 
  children: React.ReactNode;
  className?: string;
  sx?: SxProps<Theme>;
}) {
  return <Box className={className} sx={sx}>{children}</Box>;
}

export function DialogHeader({ 
  children,
  className,
  sx,
}: { 
  children: React.ReactNode;
  className?: string;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box 
      className={className} 
      sx={{ 
        p: 2, 
        pb: 1,
        ...sx as any
      }}
    >
      {children}
    </Box>
  );
}

export function DialogDescription({ 
  children,
  className,
  sx,
}: { 
  children: React.ReactNode;
  className?: string;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box 
      className={className} 
      sx={{ 
        p: 2, 
        pt: 0, 
        color: "text.secondary", 
        fontSize: "14px",
        ...sx as any
      }}
    >
      {children}
    </Box>
  );
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
