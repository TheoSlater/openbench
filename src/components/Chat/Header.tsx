import { SidebarTrigger } from "@/components/ui/sidebar";

interface HeaderProps {
  availableModels: {
    ollama: string[];
    anthropic: string[];
    openai: string[];
  };
  selectedModel: string;
  onModelChange: (provider: "ollama" | "anthropic" | "openai", model: string) => void;
  isLoading: boolean;
  ollamaError?: string | null;
}


export function Header({
  availableModels,
  selectedModel,
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
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/5 bg-[#0d0d0d] px-4 md:px-6">
      <div className="flex items-center gap-2 md:gap-2.5">
        <SidebarTrigger className="md:hidden mr-1 text-white/40" />
        {ollamaError ? (
          <span className="text-xs text-red-400/60">
            {ollamaError}
          </span>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <select
          value={selectedValue}
          onChange={(e) => handleChange(e.target.value)}
          className="h-9 max-w-[120px] sm:max-w-none appearance-none rounded-xl border border-white/10 bg-[#1a1a1a] px-3 pr-8 text-[14px] font-medium text-white/90 outline-none ring-0 transition-colors hover:border-white/20 focus:border-white/20 disabled:opacity-50"
          disabled={isLoading || !hasAnyModels}
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='rgba(255,255,255,0.2)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 10px center",
          }}
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
    </header>
  );
}
