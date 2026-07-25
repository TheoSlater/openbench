import { Box } from "@/components/ui/Box";
import { Typography } from "@/components/ui/Typography";
import { IconButton } from "@/components/ui/icon-button";
import { TooltipLabel as Tooltip } from "@/components/ui/tooltip-label";

import { Paperclip, Copy, Check, MoreHorizontal } from "lucide-react";
import { isImageAttachment, createDataUrl, formatFileSize } from "@/lib/utils/utils";
import { cn } from "@/lib/utils";
import type { MessageProps } from "./types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCopyMessage } from "./hooks";
import { MemoryMenuItems } from "./MemoryMenuItems";
import { useSettingsStore } from "@/store/settingsStore";

export function UserMessage({ id, conversationId, content, attachments }: MessageProps) {
  const { copied, handleCopy } = useCopyMessage(content);
  const memoryUiEnabled = useSettingsStore((state) => state.general.memoryBeta);

  return (
    <Box
      className="group/message ml-auto flex w-fit max-w-[min(82%,48rem)] flex-col items-end gap-2"
    >
      {attachments && attachments.length > 0 && (
        <Box
          className="grid max-w-full grid-cols-2 gap-2"
        >
          {attachments.map((att) => (
            <Box
              key={att.id}
              className={cn(
                "flex min-w-0 overflow-hidden rounded-2xl border border-border/50 bg-card text-card-foreground",
                isImageAttachment(att.type) && "size-32",
              )}
            >
              {isImageAttachment(att.type) ? (
                <img
                  src={createDataUrl(att.type, att.content || "")}
                  alt={att.name}
                  className="size-full object-cover"
                />
              ) : (
                <>
                  <Box
                    className="flex size-10 shrink-0 items-center justify-center text-muted-foreground"
                  >
                    <Paperclip size={20} />
                  </Box>
                  <Box>
                    <Typography
                      variant="body2"
                      noWrap
                    >
                      {att.name}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                    >
                      {formatFileSize(att.size)}
                    </Typography>
                  </Box>
                </>
              )}
            </Box>
          ))}
        </Box>
      )}
      <Box
        className="rounded-2xl rounded-br-sm bg-muted/70 px-3 py-2 text-foreground select-text"
      >
        <Typography
          className="whitespace-pre-wrap text-sm leading-6"
        >
          {content}
        </Typography>
      </Box>

      <Box className="action-bar flex items-center gap-1 pr-1 text-muted-foreground transition-opacity">
        <Tooltip title={copied ? "Copied" : "Copy"}>
          <IconButton
            size="small"
            onClick={handleCopy}
            className="size-7 rounded-full"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </IconButton>
        </Tooltip>
        {memoryUiEnabled && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                size="small"
                className="size-7 rounded-full"
              >
                <MoreHorizontal size={14} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <MemoryMenuItems messageId={id} conversationId={conversationId} content={content} />
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </Box>
    </Box>
  );
}
