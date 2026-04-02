interface HeaderProps {
  availableModels: {
    ollama: string[];
    anthropic: string[];
    openai: string[];
  };
  selectedModel: string;
  selectedProvider: "ollama" | "anthropic" | "openai";
  onModelChange: (provider: "ollama" | "anthropic" | "openai", model: string) => void;
  isLoading: boolean;
  ollamaError?: string | null;
}

const providerLabels: Record<HeaderProps["selectedProvider"], string> = {
  ollama: "Ollama",
  anthropic: "Anthropic",
  openai: "OpenAI",
};

export function Header({
  availableModels,
  selectedModel,
  selectedProvider,
  onModelChange,
  isLoading,
  ollamaError,
}: HeaderProps) {
  const hasAnyModels = availableModels.ollama.length > 0;
  const selectedValue = selectedModel || "";

  const handleChange = (value: string) => {
    if (!value) return;
    onModelChange("ollama", value);
  };

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-6">
      <div className="flex items-center gap-2.5">
        <span className="text-sm font-medium text-foreground/90">OpenBench</span>
        <span className="text-xs text-muted-foreground/80">
          {providerLabels[selectedProvider]} · {selectedModel || "No model"}
        </span>
        {ollamaError ? (
          <span className="text-xs text-muted-foreground/60">
            {ollamaError}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <select
          value={selectedValue}
          onChange={(e) => handleChange(e.target.value)}
          className="h-8 appearance-none rounded-md border border-border/60 bg-transparent px-3 pr-8 text-sm text-foreground outline-none ring-0 transition-colors hover:border-border focus:border-ring focus:ring-1 focus:ring-ring/30 disabled:opacity-50"
          disabled={isLoading || !hasAnyModels}
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='hsl(var(--muted-foreground))' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 10px center",
          }}
        >
          {!hasAnyModels ? (
            <option value="">No models</option>
          ) : (
            <optgroup label={providerLabels.ollama}>
              {availableModels.ollama.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
    </header>
  );
}
