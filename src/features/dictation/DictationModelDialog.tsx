import { Box } from "@/components/ui/Box";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Modal } from "@/components/ui/modal";
import { LinearProgress } from "@/components/ui/linear-progress";
import { Stack } from "@/components/ui/Stack";
import { Typography } from "@/components/ui/Typography";
import { cn } from "@/lib/utils";
import type { WhisperModelInfo } from "@/hooks/useDictation";

interface DictationModelDialogProps {
  open: boolean;
  models: WhisperModelInfo[];
  selectedModelId: string | null;
  installingModelId: string | null;
  downloadPercent: number | null;
  onClose: () => void;
  onInstall: (modelId: string) => void;
  onSelect: (modelId: string) => void;
}

export function DictationModelDialog({
  open,
  models,
  selectedModelId,
  installingModelId,
  downloadPercent,
  onClose,
  onInstall,
  onSelect,
}: DictationModelDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Install dictation model"
      maxWidth={384}
      contentClassName="p-5"
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={!!installingModelId}>
            Cancel
          </Button>
        </div>
      }
    >
        <Typography variant="body2" color="muted" className="mb-4">
          Dictation runs locally. Choose a Whisper model to download before recording.
        </Typography>

        <Stack spacing={1.25}>
          {models.map((model) => {
            const installing = installingModelId === model.id;
            const selected = selectedModelId === model.id;
            const actionLabel = model.installed ? "Use" : "Download";

            return (
              <Box
                key={model.id}
                className={cn(
                  "rounded-xl border border-border/60 p-3",
                  selected && "border-primary",
                )}
              >
                <Box className="flex items-start justify-between gap-3">
                  <Box className="min-w-0 flex-1">
                    <Box className="flex flex-wrap items-center gap-1.5">
                      <Typography variant="subtitle2">
                        {model.name}
                      </Typography>
                      {model.recommended && (
                        <Chip
                          label="Recommended"
                          size="small"
                          color="primary"
                        />
                      )}
                      {model.installed && (
                        <Chip label="Installed" size="small" />
                      )}
                    </Box>
                    <Typography variant="body2" color="muted" className="mt-0.5">
                      {model.description}
                    </Typography>
                    <Typography variant="caption" color="muted" className="mt-1 block">
                      {model.sizeLabel} / {model.speedLabel} /{" "}
                      {model.qualityLabel}
                    </Typography>
                  </Box>

                  <Button
                    size="sm"
                    variant={model.installed ? "outline" : "default"}
                    disabled={!!installingModelId}
                    onClick={() =>
                      model.installed
                        ? onSelect(model.id)
                        : onInstall(model.id)
                    }
                  >
                    {installing ? "Downloading" : actionLabel}
                  </Button>
                </Box>

                {installing && (
                  <Box className="mt-3">
                    <LinearProgress
                      variant={
                        downloadPercent === null
                          ? "indeterminate"
                          : "determinate"
                      }
                      value={downloadPercent ?? undefined}
                    />
                    <Typography variant="caption" color="muted" className="mt-1 block">
                      {downloadPercent === null
                        ? "Starting download..."
                        : `${downloadPercent}% downloaded`}
                    </Typography>
                  </Box>
                )}
              </Box>
            );
          })}
        </Stack>
    </Modal>
  );
}
