import { getVersion as getTauriVersion } from "@tauri-apps/api/app";

export function normalizeAppVersion(version: unknown): string | null {
  if (typeof version !== "string") return null;
  const trimmed = version.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/^v/i, "");
  return normalized || null;
}

// ponytail: plain x.y.z numeric compare; add prerelease handling if we ever ship -beta tags
export function compareAppVersions(a: string, b: string): number {
  const pa = (normalizeAppVersion(a) ?? "").split(".").map(Number);
  const pb = (normalizeAppVersion(b) ?? "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Dev builds append -dirty when the working tree has uncommitted changes;
// -stale means a newer release is available upstream.
export function tagAppVersion(
  version: string | null,
  { dirty, stale }: { dirty: boolean; stale: boolean },
): string | null {
  if (!version) return null;
  const flags = [
    dirty ? "dirty" : null,
    stale ? "stale" : null,
  ]
    .filter(Boolean)
    .join("-");
  return flags ? `${version}-${flags}` : version;
}

export function getBundledAppVersion(): string | null {
  try {
    return normalizeAppVersion(__APP_VERSION__);
  } catch {
    return null;
  }
}

export async function getInstalledAppVersion(): Promise<string | null> {
  try {
    const version = normalizeAppVersion(await getTauriVersion());
    if (version) return version;
  } catch {
    // Non-Tauri contexts, tests, and browser preview fall back to the bundled version.
  }

  return getBundledAppVersion();
}
