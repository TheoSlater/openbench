import { Box, Typography } from "@mui/material";

interface EmptyStateProps {
  children?: React.ReactNode;
  selectedModels: string[];
  userName?: string;
}

export function EmptyState({ children, selectedModels, userName }: EmptyStateProps) {
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
        maxWidth: 840,
        mx: "auto",
        width: "100%",
        height: "100%",
        mt: -8,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 6 }}>
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
            : selectedModels[0] || "gpt-oss:20b-cloud"}
        </Typography>
      </Box>

      {/* Input area */}
      <Box sx={{ width: "100%", maxWidth: 768 }}>{children}</Box>
    </Box>
  );
}
