// Design: Dark minimal chat input — soft surface, muted icons, spacious two-row layout.
import { ArrowUp, Plus, Square } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputAction,
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
    <footer className="shrink-0 bg-background px-4 pb-6 pt-4 relative z-10">
      <div className="mx-auto w-full max-w-3xl">
        <PromptInput
          value={value}
          onValueChange={onChange}
          onSubmit={handleSubmit}
          isLoading={isStreaming}
          maxHeight={200}
          disabled={isStreaming || (!selectedModel && !allowEmptyModel)}
          className="flex min-h-[64px] w-full flex-col gap-3 overflow-visible rounded-[1.75rem] border-[1px] border-white/10 bg-[#2f2f2f] px-5 py-4 shadow-[0_4px_20px_rgb(0,0,0,0.12)] backdrop-blur-sm transition-all duration-300"
        >
          <PromptInputTextarea
            ref={textareaRef}
            placeholder={`Message ${selectedModel || "OpenBench"}`}
            className="min-h-[32px] max-h-[200px] w-full overflow-y-auto bg-transparent px-0 py-1 text-[15px] leading-6 text-foreground placeholder:text-muted-foreground/60"
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
            </div>
            <PromptInputAction tooltip={isStreaming ? "Stop" : "Send"}>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
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
        {hasMessages && (
          <p className="mt-3 text-center text-xs text-muted-foreground/70">
            AI can make mistakes. Check important info.
          </p>
        )}
      </div>
    </footer>
  );
}
