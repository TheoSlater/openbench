import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const bannedPatterns = [
  /@mui\//,
  /@emotion\//,
  /\bsx=/,
  /\bSxProps\b/,
  /\bThemeProvider\b/,
  /\bCssBaseline\b/,
  /\buseTheme\b/,
  /\bstyled\(/,
  /\bMui[A-Z]/,
  /\.Mui[A-Za-z-]+/,
  // Button/Chip aliases that duplicated an existing variant, plus props that
  // were accepted and silently discarded. `size="small"` is deliberately not
  // banned: it is still IconButton's own API.
  /variant="contained"/,
  /variant="outlined"/,
  /\bdisableElevation\b/,
  /\bdisableRipple\b/,
  // Deleted modules. dialog-panel exported Dialog/DialogContent/DialogTitle
  // that collided with dialog.tsx; modal-root hand-rolled a modal without a
  // focus trap; Paper was a styleless wrapper.
  /ui\/dialog-panel/,
  /ui\/modal-root/,
  /ui\/Paper/,
];

const textFilePattern = /\.(ts|tsx|js|jsx|css|json)$/;

function collectFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === "dist" || name === ".git") return [];
    if (statSync(path).isDirectory()) return collectFiles(path);
    return textFilePattern.test(path) ? [path] : [];
  });
}

describe("MUI migration", () => {
  it("has no MUI or Emotion usage left", () => {
    const offenders = collectFiles(join(root, "src"))
      .concat([join(root, "package.json"), join(root, "vite.config.ts")])
      .filter((file) => {
        const content = readFileSync(file, "utf8");
        return bannedPatterns.some((pattern) => pattern.test(content));
      })
      .map((file) => relative(root, file));

    expect(offenders).toEqual([]);
  });
});
