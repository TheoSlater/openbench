import * as React from "react";
import {
  Menu,
  MenuItem,
  Divider,
  ListSubheader,
  SxProps,
  Theme,
} from "@mui/material";

function DropdownMenu({
  children,
  open,
  onOpenChange,
}: {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const isOpen = open !== undefined ? open : Boolean(anchorEl);

  const handleClose = () => {
    setAnchorEl(null);
    onOpenChange?.(false);
  };

  return (
    <DropdownMenuContext.Provider
      value={{ anchorEl, setAnchorEl, handleClose, isOpen }}
    >
      {children}
    </DropdownMenuContext.Provider>
  );
}

const DropdownMenuContext = React.createContext<{
  anchorEl: HTMLElement | null;
  setAnchorEl: (el: HTMLElement | null) => void;
  handleClose: () => void;
  isOpen: boolean;
}>({
  anchorEl: null,
  setAnchorEl: () => {},
  handleClose: () => {},
  isOpen: false,
});

function DropdownMenuTrigger({
  children,
}: {
  children: React.ReactElement<any>;
  asChild?: boolean;
}) {
  const { setAnchorEl } = React.useContext(DropdownMenuContext);
  return React.cloneElement(children, {
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      setAnchorEl(e.currentTarget);
      children.props.onClick?.(e);
    },
  });
}

function DropdownMenuContent({
  children,
  align = "start",
  className,
}: {
  children: React.ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  const { anchorEl, handleClose, isOpen } =
    React.useContext(DropdownMenuContext);
  return (
    <Menu
      className={className}
      anchorEl={anchorEl}
      open={isOpen}
      onClose={handleClose}
      transformOrigin={{
        vertical: "top",
        horizontal: align === "end" ? "right" : "left",
      }}
      anchorOrigin={{
        vertical: "bottom",
        horizontal: align === "end" ? "right" : "left",
      }}
      PaperProps={{
        sx: {
          bgcolor: "background.paper",
          border: "1px solid",
          borderColor: "divider",
          color: "text.primary",
          mt: 0.5,
          minWidth: 160,
          boxShadow: 3,
        },
      }}
    >
      {children}
    </Menu>
  );
}

function DropdownMenuItem({
  children,
  onClick,
  variant,
  className,
  disabled,
  sx,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "destructive";
  className?: string;
  disabled?: boolean;
  sx?: SxProps<Theme>;
}) {
  const { handleClose } = React.useContext(DropdownMenuContext);
  return (
    <MenuItem
      className={className}
      disabled={disabled}
      onClick={() => {
        onClick?.();
        handleClose();
      }}
      sx={{
        fontSize: "14px",
        gap: 1.5,
        mx: 1,
        my: 0.5,
        borderRadius: "8px",
        color: variant === "destructive" ? "error.main" : "inherit",
        "&:hover": {
          bgcolor: variant === "destructive" ? "error.dark" : "action.hover",
          color: variant === "destructive" ? "error.contrastText" : "inherit",
        },
        ...(sx as any),
      }}
    >
      {children}
    </MenuItem>
  );
}

function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <ListSubheader
      sx={{
        px: 2,
        py: 1,
        fontSize: "12px",
        fontWeight: 600,
        lineHeight: "1.2",
        color: "text.secondary",
        bgcolor: "transparent",
      }}
    >
      {children}
    </ListSubheader>
  );
}

function DropdownMenuSeparator() {
  return <Divider sx={{ my: 0.5, borderColor: "divider" }} />;
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
};
