import { cn } from "@/lib/utils";
import type { Role } from "@/types/chat";
import {
  Copy,
  MoreHorizontal,
  RotateCcw,
  Share,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";

export interface MessageProps {
  role: Role;
  content: string;
}

export function Message({ role, content }: MessageProps) {
  const isUser = role === "user";

  if (isUser) {
    return (
      <div className="flex w-full justify-end">
        <div className="max-w-[80%] rounded-2xl bg-[#1a4a7a] px-4 py-2.5 text-[15px] font-semibold text-white shadow-sm">
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
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full px-1.5 py-1 transition-colors hover:text-foreground/80"
            aria-label="Thumbs up"
          >
            <ThumbsUp className="size-3.5" />
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full px-1.5 py-1 transition-colors hover:text-foreground/80"
            aria-label="Thumbs down"
          >
            <ThumbsDown className="size-3.5" />
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full px-1.5 py-1 transition-colors hover:text-foreground/80"
            aria-label="Share or export"
          >
            <Share className="size-3.5" />
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full px-1.5 py-1 transition-colors hover:text-foreground/80"
            aria-label="Regenerate"
          >
            <RotateCcw className="size-3.5" />
          </button>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-full px-1.5 py-1 transition-colors hover:text-foreground/80"
            aria-label="More options"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
