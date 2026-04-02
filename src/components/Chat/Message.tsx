import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Role } from "@/types/chat";

export interface MessageProps {
  role: Role;
  content: string;
}

export function Message({ role, content }: MessageProps) {
  const isUser = role === "user";

  return (
    <div
      className={cn(
        "group flex w-full animate-fade-in",
        isUser ? "bg-transparent" : "bg-secondary/30",
      )}
    >
      <div className="mx-auto flex w-full max-w-3xl gap-4 px-4 py-6">
        {/* Avatar - minimal */}
        <div className="shrink-0 pt-0.5">
          {isUser ? (
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
              <User size={14} strokeWidth={2} />
            </div>
          ) : (
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500">
              <Bot size={14} strokeWidth={2} />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 pt-0.5">
          <p className="text-[15px] leading-7 text-foreground whitespace-pre-wrap">
            {content}
          </p>
        </div>
      </div>
    </div>
  );
}
