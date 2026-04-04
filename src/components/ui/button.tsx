import { Button as MuiButton, ButtonProps as MuiButtonProps } from "@mui/material";

interface ButtonProps extends Omit<MuiButtonProps, "variant" | "size"> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

export function Button({ variant = "default", size = "default", sx, ...props }: ButtonProps) {
  const getVariantStyles = (): any => {
    switch (variant) {
      case "ghost":
        return {
          color: "rgba(255, 255, 255, 0.6)",
          bgcolor: "transparent",
          "&:hover": { bgcolor: "rgba(255, 255, 255, 0.05)", color: "#fff" },
        };
      case "outline":
        return {
          border: "1px solid rgba(255, 255, 255, 0.1)",
          bgcolor: "transparent",
          "&:hover": { bgcolor: "rgba(255, 255, 255, 0.05)" },
        };
      case "destructive":
        return {
          bgcolor: "#ef4444",
          color: "#fff",
          "&:hover": { bgcolor: "#dc2626" },
        };
      default:
        return {
          bgcolor: "#fff",
          color: "#000",
          "&:hover": { bgcolor: "rgba(255, 255, 255, 0.9)" },
        };
    }
  };

  const getSizeStyles = (): any => {
    switch (size) {
      case "sm":
        return { height: 32, px: 1.5, fontSize: "12px" };
      case "lg":
        return { height: 44, px: 3, fontSize: "16px" };
      case "icon":
        return { width: 32, height: 32, p: 0 };
      default:
        return { height: 36, px: 2, fontSize: "14px" };
    }
  };

  return (
    <MuiButton
      disableRipple
      sx={{
        textTransform: "none",
        fontWeight: 600,
        borderRadius: "8px",
        ...getVariantStyles(),
        ...getSizeStyles(),
        ...sx,
      }}
      {...(props as any)}
    />
  );
}
