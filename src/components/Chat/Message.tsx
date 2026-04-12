import type { Role, Attachment } from "@/types/chat";
import { Copy, MoreHorizontal, RotateCcw, Check, Paperclip } from "lucide-react";
import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import ThinkingIndicator from "./ThinkingIndicator";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Box, Typography, IconButton, Tooltip, Collapse } from "@mui/material";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isImageAttachment, createDataUrl, formatFileSize } from "@/lib/utils";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

export interface MessageProps {
  role: Role;
  content: string;
  attachments?: Attachment[];
  messageIndex?: number;
  model?: string;
  thinking?: string;
  thinkingDuration?: number;
  isThinking?: boolean;
  onRegenerate?: (messageIndex: number) => void;
}

export function Message({
  role,
  content,
  attachments,
  messageIndex,
  model,
  thinking,
  thinkingDuration,
  isThinking,
  onRegenerate,
}: MessageProps) {
  const [copied, setCopied] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(isThinking || false);
  const isUser = role === "user";
  
  const processedContent = content
    ? content
        .replace(/\\\[/g, "$$$$")
        .replace(/\\\]/g, "$$$$")
        .replace(/\\\(/g, "$")
        .replace(/\\\)/g, "$")
    : "";

  const processedThinking = thinking
    ? thinking
        .replace(/\\\[/g, "$$$$")
        .replace(/\\\]/g, "$$$$")
        .replace(/\\\(/g, "$")
        .replace(/\\\)/g, "$")
    : "";

  useEffect(() => {
    // If it's thinking, it should be expanded.
    // If it finishes thinking, it should collapse.
    if (isThinking) {
      setThinkingExpanded(true);
    } else if (thinking && !isThinking) {
      // Small delay to let the user see it's done before collapsing?
      // Or just collapse immediately to match the prompt "it should collapse"
      setThinkingExpanded(false);
    }
  }, [isThinking, !!thinking]);
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
          width: "100%",
          alignItems: "flex-end",
          py: 0.5,
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
                  transition: "all 0.2s ease",
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
                        borderRadius: 1,
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
            borderRadius: "24px",
            bgcolor: "chat.bubbleUser",
            border: "1px solid",
            borderColor: "border.light",
            px: 2.5,
            py: 1.5,
            transition: "all 0.2s ease",
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
        width: "100%",
        py: 0.5,
        "& .action-bar": {
          opacity: 0,
          transition: "opacity 0.2s",
        },
        "&:hover .action-bar, &:focus-within .action-bar": {
          opacity: 1,
        },
        "@media (hover: none)": {
          "& .action-bar": {
            opacity: 1,
          },
        },
      }}
    >
      <Box sx={{ width: "100%" }}>
        {model && (
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              fontWeight: 600,
              mb: 1,
              display: "block",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              fontSize: "10px",
            }}
          >
            {model}
          </Typography>
        )}

        {(thinking || isThinking) && (
          <Box sx={{ mb: 2, maxWidth: { xs: "90%", sm: "80%" } }}>
            <Box onClick={() => setThinkingExpanded(!thinkingExpanded)}>
              <ThinkingIndicator
                isActive={isThinking}
                isExpanded={thinkingExpanded}
                thinkingDuration={thinkingDuration}
              />
            </Box>
            <Collapse in={thinkingExpanded}>
              <Box
                sx={{
                  mt: 1,
                  pl: 2,
                  borderLeft: "2px solid",
                  borderColor: "divider",
                }}
              >
                <Box
                  sx={{
                    color: "text.secondary",
                    fontSize: "14px",
                    lineHeight: 1.6,
                    "& p": { mb: 1, "&:last-child": { mb: 0 } },
                  }}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                  >
                    {processedThinking}
                  </ReactMarkdown>
                </Box>
              </Box>
            </Collapse>
          </Box>
        )}

        {content ? (
          <Box
            sx={{
              color: "text.primary",
              fontSize: "15px",
              lineHeight: 1.6,
              maxWidth: { xs: "90%", sm: "80%" },
              "& p": { mb: 2, "&:last-child": { mb: 0 }, lineHeight: 1.6, fontSize: "15px" },
              "& pre": { mb: 2, p: 0, borderRadius: "8px", overflow: "hidden" },
              "& code": {
                bgcolor: "action.hover",
                px: 0.6,
                py: 0.2,
                borderRadius: "4px",
                fontFamily: "monospace",
                fontSize: "0.9em",
              },
              "& ul, & ol": { pl: 3, mb: 2 },
              "& li": { mb: 0.5 },
              "& blockquote": {
                borderLeft: "4px solid",
                borderColor: "divider",
                pl: 2,
                fontStyle: "italic",
                color: "text.secondary",
                mb: 2,
              },
              "& table": {
                width: "100%",
                borderCollapse: "collapse",
                mb: 2,
                border: "1px solid",
                borderColor: "divider",
              },
              "& th, & td": {
                border: "1px solid",
                borderColor: "divider",
                p: 1,
                textAlign: "left",
              },
              "& th": { bgcolor: "action.hover", fontWeight: 600 },
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                code({ node, inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || "");
                  return !inline && match ? (
                    <SyntaxHighlighter
                      style={vscDarkPlus as any}
                      language={match[1]}
                      PreTag="div"
                      {...props}
                    >
                      {String(children).replace(/\n$/, "")}
                    </SyntaxHighlighter>
                  ) : (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  );
                },
              }}
            >
              {processedContent}
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
