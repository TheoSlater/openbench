import type { Role, Attachment } from "@/types/chat";
import { Copy, MoreHorizontal, RotateCcw, Check, Paperclip } from "lucide-react";
import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Box, Typography, IconButton, Tooltip } from "@mui/material";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isImageAttachment, createDataUrl, formatFileSize } from "@/lib/utils";

export interface MessageProps {
  role: Role;
  content: string;
  attachments?: Attachment[];
  messageIndex?: number;
  onRegenerate?: (messageIndex: number) => void;
}

export function Message({
  role,
  content,
  attachments,
  messageIndex,
  onRegenerate,
}: MessageProps) {
  const [copied, setCopied] = useState(false);
  const isUser = role === "user";
  const canRegenerate =
    typeof messageIndex === "number" && typeof onRegenerate === "function";

  useEffect(() => {
    if (copied) {
      const timeout = setTimeout(() => {
        setCopied(false);
      }, 2000);
      return () => clearTimeout(timeout);
    }
  }, [copied]);

  const handleCopy = () => {
    if (!content) return;
    navigator.clipboard?.writeText(content).then(() => {
      setCopied(true);
    }).catch(() => {});
  };

  if (isUser) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          w: "100%",
          alignItems: "flex-end",
          py: 1,
        }}
      >
        {attachments && attachments.length > 0 && (
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              gap: 1,
              mb: 1,
              maxWidth: { xs: "85%", sm: "70%" },
            }}
          >
            {attachments.map((att) => (
              <Box
                key={att.id}
                sx={{
                  width: isImageAttachment(att.type) ? 120 : "auto",
                  height: isImageAttachment(att.type) ? 120 : "auto",
                  minWidth: isImageAttachment(att.type) ? 0 : 200,
                  borderRadius: "12px",
                  overflow: "hidden",
                  border: "1px solid",
                  borderColor: "divider",
                  bgcolor: "secondary.main",
                  display: "flex",
                  alignItems: "center",
                  p: isImageAttachment(att.type) ? 0 : 1.5,
                  gap: 1.5,
                }}
              >
                {isImageAttachment(att.type) ? (
                  <img
                    src={createDataUrl(att.type, att.content || "")}
                    alt={att.name}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <>
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: "8px",
                        bgcolor: "action.hover",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Paperclip size={20} />
                    </Box>
                    <Box sx={{ overflow: "hidden" }}>
                      <Typography
                        variant="body2"
                        sx={{
                          fontWeight: 500,
                          color: "text.primary",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {att.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: "text.secondary" }}
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
          sx={{
            maxWidth: { xs: "85%", sm: "70%" },
            borderRadius: "1.5rem",
            bgcolor: "secondary.main",
            px: 2.5,
            py: 1.5,
            boxShadow: 1,
          }}
        >
          <Typography
            sx={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              lineHeight: 1.6,
              fontSize: "15.5px",
              color: "text.primary",
            }}
          >
            {content}
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        w: "100%",
        py: 2,
        "& .action-bar": {
          opacity: 0,
          transition: "opacity 0.3s",
        },
        "&:hover .action-bar": {
          opacity: 1,
        }
      }}
    >
      <Box sx={{ w: "100%", maxWidth: { xs: "95%", sm: "85%", md: "80%" } }}>
        {content ? (
          <Box
            sx={{
              "& p": { lineHeight: 1.75, fontSize: "16px", color: "text.primary", mb: 2 },
              "& pre": { bgcolor: "secondary.main", p: 2, borderRadius: "12px", overflowX: "auto", mb: 2 },
              "& code": { color: "text.primary", fontFamily: "monospace" },
              "& ul, & ol": { color: "text.primary", pl: 3, mb: 2 },
              "& li": { mb: 1 },
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
            >
              {content}
            </ReactMarkdown>
          </Box>
        ) : null}
        
        <Box
          className="action-bar"
          sx={{
            mt: 1,
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <Tooltip title={copied ? "Copied" : "Copy"}>
            <IconButton
              size="small"
              onClick={handleCopy}
              sx={{ color: "text.secondary", "&:hover": { color: "text.primary", bgcolor: "action.hover" } }}
            >
              {copied ? <Check size={14} color="green" /> : <Copy size={14} />}
            </IconButton>
          </Tooltip>

          {canRegenerate && (
            <Tooltip title="Regenerate">
              <IconButton
                size="small"
                onClick={() => onRegenerate(messageIndex)}
                sx={{ color: "text.secondary", "&:hover": { color: "text.primary", bgcolor: "action.hover" } }}
              >
                <RotateCcw size={14} />
              </IconButton>
            </Tooltip>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger>
              <IconButton size="small" sx={{ color: "text.secondary", "&:hover": { color: "text.primary", bgcolor: "action.hover" } }}>
                <MoreHorizontal size={14} />
              </IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => {}}>More options soon</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Box>
      </Box>
    </Box>
  );
}
