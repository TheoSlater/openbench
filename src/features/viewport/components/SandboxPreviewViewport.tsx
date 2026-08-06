import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Clipboard, ExternalLink, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui/icon-button";
import type { SandboxPreview } from "../viewportStore";

export function SandboxPreviewViewport({ preview }: { preview?: SandboxPreview }) {
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setReady(false);
    setFailed(false);
    setCopied(false);
  }, [preview?.containerPort, preview?.sandboxId, preview?.url]);

  if (!preview) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Preview unavailable</div>;
  }

  const copyUrl = async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(preview.url);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const openPreview = () => {
    void openUrl(preview.url).catch(() => window.open(preview.url, "_blank", "noopener,noreferrer"));
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-2 text-xs">
        <span
          className={`size-2 rounded-full ${failed ? "bg-destructive" : ready ? "bg-emerald-500" : "bg-amber-500"}`}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
          localhost:{preview.containerPort}
        </span>
        <span className="text-[11px] text-muted-foreground">{failed ? "Unavailable" : ready ? "Ready" : "Loading"}</span>
        <IconButton
          size="small"
          aria-label="Reload sandbox preview"
          title="Reload preview"
          onClick={() => {
            setReady(false);
            setFailed(false);
            setReloadKey((key) => key + 1);
          }}
        >
          <RefreshCw size={14} />
        </IconButton>
        <IconButton
          size="small"
          aria-label="Copy preview URL"
          title="Copy URL"
          onClick={() => void copyUrl()}
        >
          {copied ? <Check size={14} /> : <Clipboard size={14} />}
        </IconButton>
        <IconButton
          size="small"
          aria-label="Open preview in browser"
          title="Open in browser"
          onClick={openPreview}
        >
          <ExternalLink size={14} />
        </IconButton>
      </header>
      <iframe
        key={reloadKey}
        title={`Sandbox preview on port ${preview.containerPort}`}
        src={preview.url}
        className="min-h-0 flex-1 border-0 bg-white"
        onLoad={() => setReady(true)}
        onError={() => setFailed(true)}
        sandbox="allow-forms allow-modals allow-popups allow-presentation allow-scripts allow-same-origin"
      />
    </div>
  );
}
