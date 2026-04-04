import type { Role } from "@/types/chat";
import { Copy, MoreHorizontal, RotateCcw, Check } from "lucide-react";
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

export interface MessageProps {
  role: Role;
  content: string;
  messageIndex?: number;
  onRegenerate?: (messageIndex: number) => void;
}

export function Message({
  role,
  content,
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
      <Box sx={{ display: "flex", w: "100%", justifyContent: "flex-end", py: 1 }}>
        <Box
          sx={{
            maxWidth: { xs: "85%", sm: "70%" },
            borderRadius: "1.5rem",
            bgcolor: "#2f2f2f",
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
              color: "#ececec",
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
              "& p": { lineHeight: 1.75, fontSize: "16px", color: "#ececec", mb: 2 },
              "& pre": { bgcolor: "#2f2f2f", p: 2, borderRadius: "12px", overflowX: "auto", mb: 2 },
              "& code": { color: "#ececec", fontFamily: "monospace" },
              "& ul, & ol": { color: "#ececec", pl: 3, mb: 2 },
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
              sx={{ color: "rgba(255, 255, 255, 0.4)", "&:hover": { color: "#fff", bgcolor: "rgba(255, 255, 255, 0.05)" } }}
            >
              {copied ? <Check size={14} style={{ color: "#4caf50" }} /> : <Copy size={14} />}
            </IconButton>
          </Tooltip>

          {canRegenerate && (
            <Tooltip title="Regenerate">
              <IconButton
                size="small"
                onClick={() => onRegenerate(messageIndex)}
                sx={{ color: "rgba(255, 255, 255, 0.4)", "&:hover": { color: "#fff", bgcolor: "rgba(255, 255, 255, 0.05)" } }}
              >
                <RotateCcw size={14} />
              </IconButton>
            </Tooltip>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger>
              <IconButton size="small" sx={{ color: "rgba(255, 255, 255, 0.4)", "&:hover": { color: "#fff", bgcolor: "rgba(255, 255, 255, 0.05)" } }}>
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
