import { cn } from "@/lib/utils";
import type { Role } from "@/types/chat";
import { Copy, MoreHorizontal, RotateCcw } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface MessageProps {
  role: Role;
  content: string;
  messageIndex?: number;
  onRegenerate?: (messageIndex: number) => void;
}

export function Message({
  role,
  content,
  messageIndex,
  onRegenerate,
}: MessageProps) {
  const isUser = role === "user";
  const canRegenerate =
    typeof messageIndex === "number" && typeof onRegenerate === "function";

  if (isUser) {
    return (
      <div className="flex w-full justify-end">
        <div className="max-w-[80%] rounded-2xl bg-primary px-4 py-2.5 text-[15px] font-semibold text-primary-foreground shadow-sm">
          <p className="whitespace-pre-wrap break-words leading-6">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full animate-fade-in">
      <div className="max-w-[80%]">
        {content ? (
          <p className="text-[16px] leading-7 text-foreground whitespace-pre-wrap">
            {content}
          </p>
        ) : null}
        <div
          className={cn(
            "mt-3 flex items-center gap-3 text-[12px] text-muted-foreground/70",
            "opacity-80 transition-opacity duration-150 hover:opacity-100",
          )}
        >
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full px-1.5 py-1 transition-colors hover:text-foreground/80"
            aria-label="Copy"
            onClick={() => {
              if (!content) return;
              navigator.clipboard?.writeText(content).catch(() => {});
            }}
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full px-1.5 py-1 transition-colors hover:text-foreground/80"
            aria-label="Regenerate"
            onClick={() => {
              if (!canRegenerate) return;
              onRegenerate(messageIndex);
            }}
            disabled={!canRegenerate}
          >
            <RotateCcw className="size-3.5" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-full px-1.5 py-1 transition-colors hover:text-foreground/80"
                aria-label="More options"
              >
                <MoreHorizontal className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem disabled>More options soon</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
