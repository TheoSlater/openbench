import { useEffect, useState } from "react";
import { Link } from "@/components/ui/link";
import { Separator } from "@/components/ui/separator";
import { SettingsSection } from "../SettingsShell";
import { getBundledAppVersion, getInstalledAppVersion } from "@/lib/utils/appVersion";

const APP_REPO = "https://github.com/monolabsdev/poly-ui";
const BADGES = [
  ["Repository size", "https://img.shields.io/github/repo-size/monolabsdev/poly-ui"],
  ["Top language", "https://img.shields.io/github/languages/top/monolabsdev/poly-ui"],
  ["Last commit", "https://img.shields.io/github/last-commit/monolabsdev/poly-ui?color=red"],
  ["GitHub stars", "https://img.shields.io/github/stars/monolabsdev/poly-ui?style=social"],
] as const;

export function AboutTab() {
  const [version, setVersion] = useState(() => getBundledAppVersion());

  useEffect(() => {
    let cancelled = false;
    void getInstalledAppVersion().then((installedVersion) => {
      if (!cancelled && installedVersion) setVersion(installedVersion);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SettingsSection
      title="PolyUI"
      description={`Version ${version ?? "unknown"}`}
      action={
        <Link href={APP_REPO} target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground">
          View on GitHub
        </Link>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5 py-1">
        {BADGES.map(([alt, src]) => (
          <Link key={src} href={APP_REPO} target="_blank" rel="noopener noreferrer" underline="none">
            <img src={src} alt={alt} className="h-5 max-w-full" />
          </Link>
        ))}
      </div>
      <Separator className="my-2" />
      <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Private desktop AI chat for Ollama, OpenAI-compatible APIs, and local models.
      </p>
    </SettingsSection>
  );
}
