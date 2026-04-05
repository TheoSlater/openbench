import * as React from "react";
import { Tabs as MuiTabs, Tab as MuiTab, Box, SxProps, Theme } from "@mui/material";
import { cn } from "@/lib/utils";

function Tabs({
  className,
  value,
  onValueChange,
  children,
  sx,
}: {
  className?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box className={cn("flex flex-col gap-2", className)} sx={sx}>
      <TabsContext.Provider value={{ value, onValueChange }}>
        {children}
      </TabsContext.Provider>
    </Box>
  );
}

const TabsContext = React.createContext<{
  value?: string;
  onValueChange?: (value: string) => void;
}>({});

function TabsList({
  className,
  children,
  variant = "default",
  sx,
}: {
  className?: string;
  children: React.ReactNode;
  variant?: "default" | "line";
  sx?: SxProps<Theme>;
}) {
  const { value, onValueChange } = React.useContext(TabsContext);
  return (
    <MuiTabs
      value={value}
      onChange={(_, newValue) => onValueChange?.(newValue)}
      className={className}
      variant="fullWidth"
      sx={{
        minHeight: 40,
        borderBottom: variant === "line" ? "1px solid" : "none",
        borderColor: "divider",
        "& .MuiTabs-indicator": {
          display: variant === "line" ? "block" : "none",
        },
        "& .MuiTabs-flexContainer": {
          gap: variant === "default" ? 1 : 0,
          bgcolor: variant === "default" ? "action.selected" : "transparent",
          p: variant === "default" ? 0.5 : 0,
          borderRadius: variant === "default" ? "8px" : 0,
        },
        ...sx as any,
      }}
    >
      {children}
    </MuiTabs>
  );
}

function TabsTrigger({
  className,
  value,
  children,
  sx,
}: {
  className?: string;
  value: string;
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}) {
  return (
    <MuiTab
      value={value}
      label={children}
      className={className}
      disableRipple
      sx={{
        textTransform: "none",
        minHeight: 32,
        minWidth: 0,
        px: 2,
        py: 1,
        fontSize: "14px",
        fontWeight: 500,
        borderRadius: "6px",
        color: "text.secondary",
        "&.Mui-selected": {
          color: "text.primary",
          bgcolor: "action.selected",
        },
        ...sx as any,
      }}
    />
  );
}

function TabsContent({
  className,
  value,
  children,
  sx,
}: {
  className?: string;
  value: string;
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}) {
  const { value: activeValue } = React.useContext(TabsContext);
  if (activeValue !== value) return null;
  return (
    <Box className={cn("flex-1 text-sm outline-none", className)} sx={sx}>
      {children}
    </Box>
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
