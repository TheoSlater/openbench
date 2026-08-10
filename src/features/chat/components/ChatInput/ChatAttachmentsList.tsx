import { FileText, Image as ImageIcon, LoaderCircle, X } from "lucide-react";
import { memo, useState } from "react";
import { Box } from "@/components/ui/Box";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { Typography } from "@/components/ui/Typography";
import type { Attachment } from "@/types/chat";
import { createDataUrl, formatFileSize, isImageAttachment } from "@/lib/utils/utils";

interface ChatAttachmentsListProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}

function attachmentLabel(attachment: Attachment) {
  const extension = attachment.name.split(".").pop();
  return extension ? extension.toUpperCase() : attachment.type.split("/").pop()?.toUpperCase() ?? "FILE";
}

function attachmentStatus(attachment: Attachment) {
  if (attachment.status === "processing" || attachment.status === "previewing") return "Preparing";
  if (attachment.status === "error") return "Needs attention";
  return "Ready";
}

export const ChatAttachmentsList = memo(function ChatAttachmentsList({
  attachments,
  onRemove,
}: ChatAttachmentsListProps) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewAttachment = attachments.find((attachment) => attachment.id === previewId);
  const readyCount = attachments.filter(
    (attachment) => attachment.status !== "processing" && attachment.status !== "previewing" && attachment.status !== "error",
  ).length;

  if (attachments.length === 0) return null;

  return (
    <>
      <Box className="flex flex-wrap gap-2 pb-2 animate-fade-in">
        <Box className="flex basis-full items-center gap-2 px-1" role="status" aria-live="polite">
          <Typography as="span" variant="caption" className="font-medium text-foreground">
            Attachments
          </Typography>
          <Typography as="span" variant="caption" color="text.secondary">
            {readyCount} of {attachments.length} ready
          </Typography>
        </Box>

        {attachments.map((attachment) => {
          const image = isImageAttachment(attachment.type);
          const ready = attachment.status !== "processing" && attachment.status !== "previewing" && attachment.status !== "error";

          return (
            <Box
              key={attachment.id}
              className="relative flex min-w-0 basis-full overflow-hidden rounded-xl border border-border/60 bg-muted/30 sm:basis-[calc(50%-0.25rem)]"
            >
              <button
                type="button"
                disabled={!ready}
                onClick={() => setPreviewId(attachment.id)}
                className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-2 pr-10 text-left transition-colors hover:bg-muted/70 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70"
                aria-label={ready ? `Preview ${attachment.name}` : `${attachment.name} is still preparing`}
              >
                <Box className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/50 bg-background text-muted-foreground">
                  {image && (attachment.previewUrl || attachment.content) ? (
                    <img
                      src={attachment.previewUrl ?? createDataUrl(attachment.type, attachment.content ?? "")}
                      alt=""
                      className="size-full object-cover"
                    />
                  ) : image ? (
                    <ImageIcon size={20} />
                  ) : (
                    <FileText size={20} />
                  )}
                  {!ready && (
                    <Box className="absolute inset-0 grid place-items-center bg-background/70">
                      <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
                    </Box>
                  )}
                </Box>

                <Box className="min-w-0 flex-1">
                  <Typography as="span" variant="body2" noWrap className="block font-medium">
                    {attachment.name}
                  </Typography>
                  <Typography as="span" variant="caption" color="text.secondary" className="block">
                    {attachmentLabel(attachment)} · {formatFileSize(attachment.size)} · {attachmentStatus(attachment)}
                  </Typography>
                </Box>
              </button>

              <IconButton
                size="small"
                onClick={() => onRemove(attachment.id)}
                aria-label={`Remove attachment ${attachment.name}`}
                className="absolute right-1 top-1 size-7 rounded-full bg-background/80 hover:bg-background"
              >
                <X size={14} />
              </IconButton>
            </Box>
          );
        })}
      </Box>

      <Dialog
        open={Boolean(previewAttachment)}
        onOpenChange={(open) => {
          if (!open) setPreviewId(null);
        }}
      >
        {previewAttachment && (
          <DialogContent className="w-[min(720px,calc(100vw-2rem))] max-w-none gap-4">
            <DialogHeader className="min-w-0 pr-8">
              <DialogTitle className="truncate">{previewAttachment.name}</DialogTitle>
              <DialogDescription>
                {attachmentLabel(previewAttachment)} · {formatFileSize(previewAttachment.size)}
              </DialogDescription>
            </DialogHeader>

            {isImageAttachment(previewAttachment.type) ? (
              <Box className="grid max-h-[min(65vh,36rem)] min-h-40 place-items-center overflow-hidden rounded-2xl border border-border/60 bg-muted/30 p-3">
                <img
                  src={previewAttachment.previewUrl ?? createDataUrl(previewAttachment.type, previewAttachment.content ?? "")}
                  alt={previewAttachment.name}
                  className="max-h-[min(60vh,32rem)] max-w-full object-contain"
                />
              </Box>
            ) : (
              <pre className="max-h-[min(65vh,36rem)] overflow-auto rounded-2xl border border-border/60 bg-muted/30 p-4 font-mono text-xs leading-5 whitespace-pre-wrap break-words text-foreground">
                {previewAttachment.content}
              </pre>
            )}

            {previewAttachment.width && previewAttachment.height && (
              <Typography variant="caption" color="text.secondary">
                {previewAttachment.width} × {previewAttachment.height} px
              </Typography>
            )}
          </DialogContent>
        )}
      </Dialog>
    </>
  );
});
