import type { Config } from "tailwindcss"

const config = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        background: "#F9F9F8",
        foreground: "#1A1A1A",
        sidebar: "#F2F1EF",
        border: "#E0DED9",
        muted: {
          DEFAULT: "#F2F1EF",
          foreground: "#8A8A8A",
        },
        accent: {
          DEFAULT: "#1A1A1A",
          foreground: "#F9F9F8",
        },
      },
      borderRadius: {
        lg: "8px",
        md: "6px",
        sm: "4px",
      },
      boxShadow: {
        sm: "0 1px 3px rgba(0,0,0,0.08)",
      }
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config

export default config
