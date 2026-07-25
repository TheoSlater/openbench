import { ArrowLeft, ArrowRight, ExternalLink, MoreVertical, RotateCw } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

export function BrowserToolbar({
  url,
  onUrlChange,
  onNavigate,
  canGoBack,
  canGoForward,
  onGoBack,
  onGoForward,
  onReload,
  canReload,
  onOpenExternal,
  canOpenExternal,
}: {
  url: string;
  onUrlChange: (url: string) => void;
  onNavigate: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  canReload: boolean;
  onOpenExternal: () => void;
  canOpenExternal: boolean;
}) {
  return (
    <div className="grid h-14 shrink-0 grid-cols-[104px_minmax(0,1fr)_32px] items-center gap-3 border-b border-sidebar-border px-4">
      <div className="flex items-center gap-1">
        <IconButton
          size="small"
          aria-label="Back"
          title="Back"
          disabled={!canGoBack}
          onClick={onGoBack}
          className="text-muted-foreground"
        >
          <ArrowLeft size={18} />
        </IconButton>
        <IconButton
          size="small"
          aria-label="Forward"
          title="Forward"
          disabled={!canGoForward}
          onClick={onGoForward}
          className="text-muted-foreground"
        >
          <ArrowRight size={18} />
        </IconButton>
        <IconButton
          size="small"
          aria-label="Reload preview"
          title="Reload preview"
          onClick={onReload}
          disabled={!canReload}
          className="text-muted-foreground"
        >
          <RotateCw size={16} />
        </IconButton>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onNavigate();
        }}
        className="relative h-10 w-full min-w-0 max-w-[720px] justify-self-center"
      >
        <Input
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder="Enter a URL"
          spellCheck={false}
          autoComplete="off"
          className="h-10 rounded-[18px] border border-transparent bg-transparent px-5 pr-11 text-center text-sm text-foreground shadow-none transition-colors placeholder:text-muted-foreground hover:bg-sidebar-accent focus:bg-transparent focus:text-left focus-visible:border-ring focus-visible:ring-0"
        />
        <button
          type="submit"
          aria-label="Open page or search"
          className="absolute right-2 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        >
          <ExternalLink size={16} />
        </button>
      </form>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="small" aria-label="More browser actions" title="More">
            <MoreVertical size={18} />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem disabled={!canOpenExternal} onSelect={onOpenExternal}>
            <ExternalLink />
            Open in external browser
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
