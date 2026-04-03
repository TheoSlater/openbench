// Design: Dark minimal chat input — soft surface, muted icons, spacious two-row layout.
import { ArrowUp, Square } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import {
  PromptInput,
  PromptInputTextarea,
} from "@/components/ui/prompt-input";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onStop: () => void;
  isStreaming: boolean;
  selectedModel: string;
  hasMessages: boolean;
  allowEmptyModel?: boolean;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  selectedModel,
  hasMessages,
  allowEmptyModel = false,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = () => {
    if (!value.trim() || isStreaming) return;
    onSubmit();
  };

  const handleAction = () => {
    if (isStreaming) {
      onStop();
      return;
    }
    handleSubmit();
  };

  return (
    <div className={cn("shrink-0 bg-transparent px-4 pb-6 pt-4 relative z-10", hasMessages ? "bg-[#0d0d0d]" : "bg-transparent")}>
      <div className="mx-auto w-full max-w-3xl">
        <PromptInput
          value={value}
          onValueChange={onChange}
          onSubmit={handleSubmit}
          isLoading={isStreaming}
          maxHeight={200}
          disabled={isStreaming || (!selectedModel && !allowEmptyModel)}
          className="flex min-h-[56px] w-full flex-col gap-2 overflow-visible rounded-[2rem] border border-white/5 bg-[#1a1a1a] px-5 py-3 transition-all duration-300"
        >
          <PromptInputTextarea
            ref={textareaRef}
            placeholder="How can I help you today?"
            className="min-h-[24px] max-h-[200px] w-full bg-transparent px-0 py-1 text-[16px] leading-relaxed text-white/90 placeholder:text-white/20"
          />
          <div className="flex items-center justify-end mt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={cn(
                  "flex size-8 items-center justify-center rounded-full transition-all duration-200",
                  (value.trim() || isStreaming)
                    ? "bg-white text-black hover:bg-white/90" 
                    : "bg-white/5 text-white/10 cursor-not-allowed"
                )}
                onClick={handleAction}
                disabled={isStreaming ? false : !value.trim() || (!selectedModel && !allowEmptyModel)}
                aria-label={isStreaming ? "Stop generation" : "Send message"}
              >
                {isStreaming ? (
                  <Square className="size-3.5 fill-current" />
                ) : (
                  <ArrowUp className="size-4 stroke-[2.5px]" />
                )}
              </button>
            </div>
          </div>
        </PromptInput>
        {!hasMessages && (
          <p className="mt-3 text-center text-[11px] font-medium text-white/20">
            OpenBench can make mistakes. Check important info.
          </p>
        )}
      </div>
    </div>
  );
}
