// Design: Dark minimal chat input — soft surface, muted icons, spacious two-row layout.
import { ArrowUp, Plus, Sparkles, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputAction,
} from "@/components/ui/prompt-input";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isStreaming: boolean;
  selectedModel: string;
  allowEmptyModel?: boolean;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  selectedModel,
  allowEmptyModel = false,
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (value !== "") return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = "32px";
  }, [value]);

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
    <footer className="shrink-0 bg-background px-4 pb-6 pt-4">
      <div className="mx-auto w-full max-w-3xl">
        <PromptInput
          value={value}
          onValueChange={onChange}
          onSubmit={handleSubmit}
          isLoading={isStreaming}
          maxHeight={200}
          disabled={isStreaming || (!selectedModel && !allowEmptyModel)}
          className="flex min-h-[64px] w-full flex-col gap-3 overflow-visible rounded-2xl border border-white/10 bg-[#1c1c1e] px-4 py-3 shadow-[0_10px_24px_rgba(0,0,0,0.35)] transition-colors duration-200"
        >
          <PromptInputTextarea
            ref={textareaRef}
            placeholder="How can I help you today?"
            className="min-h-[32px] max-h-[200px] w-full overflow-y-auto bg-transparent px-0 py-1 text-[15px] leading-6 text-foreground placeholder:text-muted-foreground/70"
          />
          <div className="mt-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PromptInputAction tooltip="Add">
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground/80"
                  aria-label="Add"
                >
                  <Plus className="size-4" />
                </button>
              </PromptInputAction>
              <PromptInputAction tooltip="Magic">
                <button
                  type="button"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground/80"
                  aria-label="Magic"
                >
                  <Sparkles className="size-4" />
                </button>
              </PromptInputAction>
            </div>
            <PromptInputAction tooltip={isStreaming ? "Stop" : "Send"}>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1a4a7a] text-white shadow-[0_6px_16px_rgba(26,74,122,0.45)] transition-all hover:bg-[#21558a] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleAction}
                disabled={
                  isStreaming
                    ? false
                    : !value.trim() || (!selectedModel && !allowEmptyModel)
                }
                aria-label={isStreaming ? "Stop generation" : "Send message"}
              >
                {isStreaming ? (
                  <Square className="size-4 fill-current" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </button>
            </PromptInputAction>
          </div>
        </PromptInput>
        <p className="mt-3 text-center text-xs text-muted-foreground/70">
          AI can make mistakes. Check important info.
        </p>
      </div>
    </footer>
  );
}
