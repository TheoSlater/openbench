import { createTheme, ThemeOptions } from "@mui/material/styles";

declare module "@mui/material/styles" {
  interface TypeBackground {
    sidebar: string;
  }
  interface Palette {
    border: {
      light: string;
      main: string;
    };
    chat: {
      bubble: string;
      bubbleUser: string;
    }
  }
  interface PaletteOptions {
    border?: {
      light?: string;
      main?: string;
    };
    chat?: {
      bubble?: string;
      bubbleUser?: string;
    }
  }
}

const baseThemeOptions: ThemeOptions = {
  typography: {
    fontFamily: '"Geist Variable", "Inter", "system-ui", "sans-serif"',
    fontSize: 14,
    h1: { fontSize: "2.5rem", fontWeight: 600 },
    h2: { fontSize: "2rem", fontWeight: 600 },
    h3: { fontSize: "1.5rem", fontWeight: 600 },
    h4: { fontSize: "1.25rem", fontWeight: 600 },
    h5: { fontSize: "1.125rem", fontWeight: 600 },
    h6: { fontSize: "1rem", fontWeight: 600 },
    body1: { fontSize: "1rem" },
    body2: { fontSize: "0.875rem" },
    caption: { fontSize: "0.75rem" },
    button: { textTransform: "none", fontWeight: 500 },
  },
  shape: {
    borderRadius: 12,
  },
  spacing: 8,
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: "8px",
          padding: "6px 16px",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
        },
      },
    },
  },
};

export const darkTheme = createTheme({
  ...baseThemeOptions,
  palette: {
    mode: "dark",
    primary: {
      main: "#ffffff",
      contrastText: "#000000",
    },
    secondary: {
      main: "#2f2f2f", // From reference design (message bubbles, active states)
      contrastText: "#ffffff",
    },
    background: {
      default: "#171717", // Subtle dark grey from reference
      paper: "#1a1a1a",   // Slightly lighter for inputs/cards
      sidebar: "#121212", // Darker background for sidebar
    },
    text: {
      primary: "#ececec",   // Soft white for better readability
      secondary: "#a3a3a3", // Muted text, fully opaque (neutral-400)
    },
    divider: "rgba(255, 255, 255, 0.05)",
    action: {
      hover: "rgba(255, 255, 255, 0.05)",
      selected: "rgba(255, 255, 255, 0.1)",
    },
    border: {
      main: "rgba(255, 255, 255, 0.1)",
      light: "rgba(255, 255, 255, 0.05)",
    },
    chat: {
      bubble: "#262626",
      bubbleUser: "#2f2f2f",
    },
    success: {
      main: "#4ade80",
    },
  },
});

export const lightTheme = createTheme({
  ...baseThemeOptions,
  palette: {
    mode: "light",
    primary: {
      main: "#000000",
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#f5f5f5",
      contrastText: "#000000",
    },
    background: {
      default: "#ffffff",
      paper: "#f9f9f9",
      sidebar: "#f3f3f3",
    },
    text: {
      primary: "#1a1a1a",
      secondary: "#737373", // Muted text, fully opaque (neutral-500)
    },
    divider: "rgba(0, 0, 0, 0.05)",
    action: {
      hover: "rgba(0, 0, 0, 0.05)",
      selected: "rgba(0, 0, 0, 0.1)",
    },
    border: {
      main: "rgba(0, 0, 0, 0.1)",
      light: "rgba(0, 0, 0, 0.05)",
    },
    chat: {
      bubble: "#f3f3f3",
      bubbleUser: "#e5e5e5",
    },
  },
});
