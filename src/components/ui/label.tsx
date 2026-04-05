import * as React from "react";
import { FormLabel, SxProps, Theme } from "@mui/material";

const Label = React.forwardRef<
  HTMLLabelElement,
  Omit<React.ComponentPropsWithoutRef<"label">, 'color'> & { sx?: SxProps<Theme> }
>(({ className, children, sx, ...props }, ref) => (
  <FormLabel
    ref={ref}
    component="label"
    className={className}
    sx={{
      display: "flex",
      alignItems: "center",
      gap: 1,
      fontSize: "14px",
      fontWeight: 500,
      color: "text.primary",
      mb: 0.5,
      cursor: "pointer",
      "&.Mui-disabled": {
        opacity: 0.5,
        cursor: "not-allowed",
      },
      ...sx as any,
    }}
    {...props}
  >
    {children}
  </FormLabel>
));
Label.displayName = "Label";

export { Label };
