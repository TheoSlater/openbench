import { cn } from "@/lib/utils";
import type { Role } from "@/types/chat";
import { Copy, MoreHorizontal, RotateCcw, Check } from "lucide-react";
import { useState, useEffect } from "react";
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
  const [copied, setCopied] = useState(false);
  const isUser = role === "user";
  const canRegenerate =
    typeof messageIndex === "number" && typeof onRegenerate === "function";

  useEffect(() => {
    if (copied) {
      const timeout = setTimeout(() => {
        setCopied(false);
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [copied]);

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard?.writeText(content).then(() => {
      setCopied(true);
    }).catch(() => {});
  };

  if (isUser) {
    return (
      <div className="flex w-full justify-end py-2">
        <div className="max-w-[85%] sm:max-w-[70%] rounded-[1.5rem] bg-[#2f2f2f] px-5 py-3 text-[15.5px] text-[#ececec] shadow-sm">
          <p className="whitespace-pre-wrap break-words leading-relaxed">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex w-full animate-fade-in py-4">
      <div className="w-full max-w-[95%] sm:max-w-[85%] md:max-w-[80%]">
        {content ? (
          <div className="prose prose-invert max-w-none">
            <p className="text-[16px] leading-7 text-[#ececec] whitespace-pre-wrap">
              {content}
            </p>
          </div>
        ) : null}
        <div
          className={cn(
            "mt-1.5 flex items-center gap-1.5 text-[12px] text-muted-foreground/50",
            "opacity-0 group-hover:opacity-100 transition-all duration-300",
          )}
        >
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md p-1.5 transition-all hover:bg-white/5 hover:text-foreground/80 active:scale-95"
            aria-label="Copy"
            onClick={handleCopy}
          >
            <div className="relative size-3.5 flex items-center justify-center">
              {copied ? (
                <Check className="size-3.5 text-green-500 animate-in zoom-in-50 duration-200" />
              ) : (
                <Copy className="size-3.5 animate-in fade-in duration-200" />
              )}
            </div>
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md p-1.5 transition-all hover:bg-white/5 hover:text-foreground/80 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
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
            <DropdownMenuTrigger
              className="flex items-center gap-1.5 rounded-md p-1.5 transition-all hover:bg-white/5 hover:text-foreground/80 active:scale-95 outline-none"
              aria-label="More options"
            >
              <MoreHorizontal className="size-3.5" />
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
