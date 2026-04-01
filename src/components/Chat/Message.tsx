import { Bot, User } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Simple utility for tailwind class merging
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Role = 'user' | 'assistant';

export interface ChatMessageProps {
  role: Role;
  content: string;
}

export function Message({ role, content }: ChatMessageProps) {
  const isUser = role === 'user';
  
  return (
    <div className={cn(
      "px-4 py-8 flex gap-6 w-full group",
      isUser ? "bg-neutral-900" : "bg-neutral-800/50"
    )}>
      <div className="max-w-3xl mx-auto flex gap-6 w-full">
        <div className="shrink-0 pt-1">
          {isUser ? (
            <div className="w-8 h-8 rounded bg-blue-600 flex items-center justify-center">
              <User size={18} className="text-white" />
            </div>
          ) : (
            <div className="w-8 h-8 rounded bg-emerald-600 flex items-center justify-center">
              <Bot size={18} className="text-white" />
            </div>
          )}
        </div>
        <div className="prose prose-invert max-w-none w-full">
          <p className="leading-7 whitespace-pre-wrap">{content}</p>
        </div>
      </div>
    </div>
  );
}
