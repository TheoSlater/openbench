import { Box, Typography } from "@mui/material";

import { EyeOff } from "lucide-react";

interface EmptyStateProps {
  children?: React.ReactNode;
  selectedModels: string[];
  userName?: string;
  isTemporary?: boolean;
}

export function EmptyState({
  children,
  selectedModels,
  userName,
  isTemporary,
}: EmptyStateProps) {
  const isMultiModel = selectedModels.length >= 2;

  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        px: 2,
        maxWidth: isMultiModel ? "100%" : 840,
        mx: "auto",
        width: "100%",
        height: "100%",
        mt: -8,
      }}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 1,
          mb: 6,
        }}
      >
        {isTemporary && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 1.5,
              py: 0.5,
              borderRadius: "20px",
              color: "text.secondary",
              mb: 1,
            }}
          >
            <EyeOff />
            <Typography sx={{ fontSize: "18px", fontWeight: 400 }}>
              Temporary Chat
            </Typography>
          </Box>
        )}
        <Typography
          variant="h3"
          sx={{
            fontWeight: 600,
            color: "primary.main",
            fontSize: "36px",
            letterSpacing: "-0.5px",
            opacity: 1,
          }}
        >
          {isMultiModel
            ? `Hello, ${userName || "User"}`
            : selectedModels[0] || "OpenBench"}
        </Typography>
      </Box>

      {/* Input area */}
      <Box sx={{ width: "100%", maxWidth: 768 }}>{children}</Box>
    </Box>
  );
}
