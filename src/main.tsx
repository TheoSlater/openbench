import React, { useMemo } from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { darkTheme, lightTheme } from "./theme";
import "@fontsource-variable/geist";
import App from "./App";
import { useThemeStore } from "./store/themeStore";
import { useMediaQuery } from "@mui/material";

function Root() {
  const { mode } = useThemeStore();
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");

  const theme = useMemo(() => {
    if (mode === "system") {
      return prefersDarkMode ? darkTheme : lightTheme;
    }
    return mode === "dark" ? darkTheme : lightTheme;
  }, [mode, prefersDarkMode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
