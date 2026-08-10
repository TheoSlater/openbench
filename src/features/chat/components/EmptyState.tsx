import { useSettingsStore } from "@/store/settingsStore";
import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/button";
import { Typography } from "@/components/ui/Typography";

interface EmptyStateProps {
  children?: React.ReactNode;
  selectedModels: string[];
  userName?: string;
  isTemporary?: boolean;
  providerOnline: boolean;
  onOpenConnections: () => void;
}

export function EmptyState({
  children,
  selectedModels,
  userName,
  isTemporary: _isTemporary,
  providerOnline,
  onOpenConnections,
}: EmptyStateProps) {
  const showModelInEmptyState = useSettingsStore((s) => s.general.showModelInEmptyState);

  const heading = showModelInEmptyState && selectedModels.length > 0
    ? selectedModels.join(", ")
    : userName ? `Hello, ${userName}` : "Hello";

  return (
    <Box className="macos-empty-state relative flex min-h-0 flex-1 items-center justify-center px-6 py-10">
      <Box className="macos-empty-state__group flex w-full max-w-3xl flex-col items-center gap-6">
        <Typography
          as="h1"
          variant="h3"
          align="center"
          className="text-2xl font-medium tracking-normal text-foreground"
        >
          {heading}
        </Typography>

        {!providerOnline && (
          <Box className="flex flex-col items-center gap-3">
            <Typography variant="body2" align="center" color="muted">
              Your AI provider is offline. Make sure it&apos;s running, or check
              your connection settings.
            </Typography>
            <Button variant="outline" size="sm" onClick={onOpenConnections}>
              Open connections
            </Button>
          </Box>
        )}

        <Box className="w-full">
        {children}
        </Box>
      </Box>
    </Box>
  );
}
