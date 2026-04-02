import { Command } from "lucide-react";

interface HeaderProps {
  models: string[];
  selectedModel: string;
  onModelChange: (model: string) => void;
  isLoading: boolean;
}

export function Header({ models, selectedModel, onModelChange, isLoading }: HeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/50 px-6">
      <div className="flex items-center gap-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground/5">
          <Command size={14} className="text-muted-foreground" />
        </div>
        <span className="text-sm font-medium text-foreground">OpenBench</span>
      </div>

      <div className="flex items-center gap-3">
        <select
          value={selectedModel}
          onChange={(e) => onModelChange(e.target.value)}
          className="h-8 appearance-none rounded-md border border-border bg-transparent px-3 pr-8 text-sm text-foreground outline-none ring-0 transition-colors hover:border-border/80 focus:border-ring focus:ring-1 focus:ring-ring/30 disabled:opacity-50"
          disabled={isLoading || models.length === 0}
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 10px center",
          }}
        >
          {models.length === 0 ? (
            <option value="">No models</option>
          ) : (
            models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))
          )}
        </select>
      </div>
    </header>
  );
}