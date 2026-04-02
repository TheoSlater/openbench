interface EmptyStateProps {
  selectedModel: string;
}

export function EmptyState({ selectedModel }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-4">
      <h1 className="mb-4 text-2xl font-bold tracking-tight text-foreground/90">
        {selectedModel || "OpenBench"}
      </h1>
    </div>
  );
}
