import * as React from "react";
import { Avatar as MuiAvatar, Box } from "@mui/material";
import { cn } from "@/lib/utils";

function Avatar({
  className,
  children,
  ...props
}: {
  className?: string;
  children?: React.ReactNode;
} & React.ComponentProps<typeof Box>) {
  return (
    <MuiAvatar
      component={Box}
      className={className}
      sx={{
        width: 32,
        height: 32,
        fontSize: "0.875rem",
        bgcolor: "action.selected",
        color: "text.secondary",
        border: "1px solid",
        borderColor: "divider",
      }}
      {...props}
    >
      {children}
    </MuiAvatar>
  );
}

function AvatarImage({ src, alt, className }: { src?: string; alt?: string; className?: string }) {
  return (
    <Box
      component="img"
      src={src}
      alt={alt}
      className={cn("aspect-square size-full rounded-full object-cover", className)}
    />
  );
}

function AvatarFallback({
  className,
  children,
  ...props
}: {
  className?: string;
  children: React.ReactNode;
} & React.ComponentProps<typeof Box>) {
  return (
    <Box
      className={cn(
        "flex size-full items-center justify-center rounded-full text-sm",
        className
      )}
      {...props}
    >
      {children}
    </Box>
  );
}

export {
  Avatar,
  AvatarImage,
  AvatarFallback,
};
