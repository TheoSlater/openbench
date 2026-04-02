import { ArrowUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from "@/components/ui/prompt-input";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isStreaming: boolean;
  selectedModel: string;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  isStreaming,
  selectedModel,
}: ChatInputProps) {
  const handleSubmit = () => {
    if (!value.trim() || isStreaming) return;
    onSubmit();
  };

  return (
    <footer className="shrink-0 border-t border-border/50 bg-background px-4 pb-6 pt-4">
      <div className="mx-auto w-full max-w-3xl">
        <PromptInput
          value={value}
          onValueChange={onChange}
          onSubmit={handleSubmit}
          isLoading={isStreaming}
          disabled={isStreaming || !selectedModel}
          className="rounded-xl border-border bg-card shadow-sm transition-shadow focus-within:shadow-md"
        >
          <PromptInputTextarea
            placeholder={
              isStreaming
                ? "Generating..."
                : `Message ${selectedModel || "model"}`
            }
            className="min-h-[44px] text-[15px] text-foreground placeholder:text-muted-foreground/60"
          />
          <PromptInputActions className="justify-end pt-2">
            <PromptInputAction tooltip={isStreaming ? "Stop generation" : "Send message"}>
              <Button
                variant="default"
                size="icon"
                className="h-8 w-8 rounded-lg bg-primary text-primary-foreground shadow-none transition-all hover:bg-primary/90 disabled:opacity-40"
                onClick={handleSubmit}
                disabled={!value.trim() || isStreaming}
              >
                {isStreaming ? (
                  <Square className="size-3.5 fill-current" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </Button>
            </PromptInputAction>
          </PromptInputActions>
        </PromptInput>

        <p className="mt-3 text-center text-xs text-muted-foreground/60">
          OpenBench uses local Ollama. Your data stays on your machine.
        </p>
      </div>
    </footer>
  );
}