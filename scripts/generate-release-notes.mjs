import { execFileSync } from "child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = String(pkg.version ?? "").trim();

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return "";
  }
}

function notesForCurrentRef() {
  // Only app tags, so a stray non-version tag can never become the point the
  // changelog is computed from.
  const previousTag = tryGit([
    "describe",
    "--tags",
    "--abbrev=0",
    "--match",
    "v*",
    "HEAD^",
  ]);
  const range = previousTag ? `${previousTag}..HEAD` : "HEAD";
  const log = tryGit(["log", "--pretty=format:* %s (%h)", range]);
  return log || `Poly UI v${version}`;
}

if (!version) {
  throw new Error("package.json version is missing");
}

const output = {
  [version]: {
    body: notesForCurrentRef(),
    htmlUrl: `https://github.com/monolabsdev/poly-ui/releases/tag/v${version}`,
  },
};

const outputPath = join(root, "src", "generated", "releaseNotes.json");
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Generated release notes for v${version}`);
