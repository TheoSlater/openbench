import * as React from "react";
import { Menu, MenuItem } from "@mui/material";

function DropdownMenu({ children, open, onOpenChange }: { children: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const isOpen = open !== undefined ? open : Boolean(anchorEl);

  const handleClose = () => {
    setAnchorEl(null);
    onOpenChange?.(false);
  };

  return (
    <DropdownMenuContext.Provider value={{ anchorEl, setAnchorEl, handleClose, isOpen }}>
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

function DropdownMenuTrigger({ children }: { children: React.ReactElement<any> }) {
  const { setAnchorEl } = React.useContext(DropdownMenuContext);
  return React.cloneElement(children, {
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      setAnchorEl(e.currentTarget);
      children.props.onClick?.(e);
    },
  });
}

function DropdownMenuContent({ children, align = "start" }: { children: React.ReactNode; align?: "start" | "end" }) {
  const { anchorEl, handleClose, isOpen } = React.useContext(DropdownMenuContext);
  return (
    <Menu
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
          bgcolor: "#1a1a1a",
          border: "1px solid rgba(255, 255, 255, 0.1)",
          color: "rgba(255, 255, 255, 0.9)",
          mt: 0.5,
          minWidth: 160,
          boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
        }
      }}
    >
      {children}
    </Menu>
  );
}

function DropdownMenuItem({ children, onClick, variant, className }: { children: React.ReactNode; onClick?: () => void; variant?: "default" | "destructive"; className?: string }) {
  const { handleClose } = React.useContext(DropdownMenuContext);
  return (
    <MenuItem
      className={className}
      onClick={() => {
        onClick?.();
        handleClose();
      }}
      sx={{
        fontSize: "13px",
        gap: 1.5,
        color: variant === "destructive" ? "#f87171" : "inherit",
        "&:hover": {
          bgcolor: variant === "destructive" ? "rgba(248, 113, 113, 0.1)" : "rgba(255, 255, 255, 0.05)",
        }
      }}
    >
      {children}
    </MenuItem>
  );
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem };
