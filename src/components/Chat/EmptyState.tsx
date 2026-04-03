import { ChevronDown } from "lucide-react";

interface EmptyStateProps {
  selectedModel: string;
  availableModels: {
    ollama: string[];
    anthropic: string[];
    openai: string[];
  };
  onModelChange: (provider: "ollama" | "anthropic" | "openai", model: string) => void;
  isLoading: boolean;
  children?: React.ReactNode;
}

export function EmptyState({
  selectedModel,
  availableModels,
  onModelChange,
  isLoading,
  children,
}: EmptyStateProps) {
  const hasAnyModels = availableModels.ollama.length > 0;
  const selectedValue = selectedModel || "";

  const handleChange = (value: string) => {
    if (!value) return;
    onModelChange("ollama", value);
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 max-w-3xl mx-auto w-full">
      {/* Model Selector Dropdown */}
      <div className="mb-8 relative">
        <div className="group relative">
          <button className="flex items-center gap-2 rounded-2xl px-4 py-2 transition-colors hover:bg-white/5 pointer-events-none">
            <span className="text-xl font-bold text-white/90 tracking-tight">
              {selectedModel || "gpt-4.1-nano"}
            </span>
            <ChevronDown className="size-5 text-white/20 group-hover:text-white/40 transition-colors" />
          </button>
          <select
            value={selectedValue}
            onChange={(e) => handleChange(e.target.value)}
            disabled={isLoading || !hasAnyModels}
            className="absolute inset-0 w-full cursor-pointer opacity-0"
            aria-label="Select model"
          >
            {!hasAnyModels ? (
              <option value="">No models</option>
            ) : (
              <optgroup label="Ollama">
                {availableModels.ollama.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      </div>

      {/* Input area rendered here when in empty state */}
      <div className="w-full">
        {children}
      </div>
    </div>
  );
}
