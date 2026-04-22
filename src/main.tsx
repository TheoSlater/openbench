import React, { useMemo, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { useMediaQuery } from "@mui/material";
import { darkTheme, lightTheme } from "./theme";
import { useThemeStore } from "./store/themeStore";
import App from "./App";
import "@fontsource-variable/geist";

function getTheme(mode: string, prefersDark: boolean) {
  if (mode === "system") {
    return prefersDark ? darkTheme : lightTheme;
  }
  return mode === "dark" ? darkTheme : lightTheme;
}

function Root() {
  const { mode } = useThemeStore();
  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");

  const theme = useMemo(() => getTheme(mode, prefersDarkMode), [mode, prefersDarkMode]);

  useEffect(() => {
    const isDark = mode === "dark" || (mode === "system" && prefersDarkMode);
    document.documentElement.classList.toggle("dark", isDark);
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
