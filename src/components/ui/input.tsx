import * as React from "react";
import { InputBase, SxProps, Theme } from "@mui/material";

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'color' | 'size'> {
  sx?: SxProps<Theme>;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, sx, ...props }, ref) => {
    return (
      <InputBase
        type={type}
        inputRef={ref}
        className={className}
        sx={{
          width: "100%",
          minWidth: 0,
          borderRadius: "8px",
          border: "1px solid",
          borderColor: "divider",
          bgcolor: "transparent",
          px: 1.5,
          py: 0.5,
          fontSize: "14px",
          transition: "all 0.2s",
          "&.Mui-focused": {
            borderColor: "primary.main",
            boxShadow: (theme) => `0 0 0 2px ${theme.palette.primary.main}33`,
          },
          "& .MuiInputBase-input": {
            p: 0,
            height: "32px",
            "&::placeholder": {
              color: "text.disabled",
              opacity: 1,
            },
          },
          ...sx,
        }}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
