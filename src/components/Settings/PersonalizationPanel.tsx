import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { SystemPrompt, useModelStore } from "@/store/modelStore";
import type { PersonalizationPanelRef } from "./SettingsModal";
import { Box, Typography, TextField } from "@mui/material";

/**
 * System prompt management panel - simplified to only Custom Instructions.
 */
export const PersonalizationPanel = forwardRef<PersonalizationPanelRef>(
  (_, ref) => {
    const { systemPrompts, activeSystemPromptId, actions } = useModelStore();
    const activePrompt = useMemo(
      () =>
        systemPrompts.find((prompt) => prompt.id === activeSystemPromptId) ??
        null,
      [activeSystemPromptId, systemPrompts],
    );

    const [content, setContent] = useState("");

    useEffect(() => {
      setContent(activePrompt?.content ?? "");
    }, [activePrompt]);

    /**
     * Persist changes to the active prompt.
     */
    const handleSave = () => {
      const nextPrompt: SystemPrompt = {
        id: activePrompt?.id ?? "default",
        name: activePrompt?.name ?? "Default",
        content,
        baseStyle: activePrompt?.baseStyle ?? "default",
        characteristics: activePrompt?.characteristics ?? [],
        instantAnswers: activePrompt?.instantAnswers ?? false,
      };
      if (activePrompt) {
        actions.updateSystemPrompt(nextPrompt);
      } else {
        // Fallback if no active prompt somehow
        actions.addSystemPrompt(nextPrompt);
        actions.setSystemPrompt(nextPrompt.id);
      }
      return true;
    };

    /**
     * No longer used in single-column layout, but kept for interface compatibility.
     */
    const handleSaveAsNew = () => {
      return handleSave();
    };

    useImperativeHandle(ref, () => ({
      handleSave,
      handleSaveAsNew,
    }));

    return (
      <Box sx={{ display: "flex", width: "100%", flexDirection: "column" }}>
        {/* Custom Instructions */}
        <Box component="section" sx={{ py: 0 }}>
          <Box sx={{ mb: 3, display: "flex", flexDirection: "column", gap: 0.5 }}>
            <Typography
              component="label"
              htmlFor="prompt-content"
              sx={{ fontSize: "0.875rem", fontWeight: 700, color: "#fff" }}
            >
              Custom instructions
            </Typography>
            <Typography variant="caption" sx={{ color: "rgba(255, 255, 255, 0.4)", lineHeight: 1.6 }}>
              What would you like the AI to know to provide better responses?
            </Typography>
          </Box>
          <TextField
            id="prompt-content"
            multiline
            minRows={12}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Example: I'm a developer working with React and Rust. Keep explanations concise..."
            fullWidth
            sx={{
              "& .MuiOutlinedInput-root": {
                borderRadius: "16px",
                bgcolor: "rgba(255, 255, 255, 0.02)",
                fontSize: "14px",
                color: "#fff",
                lineHeight: 1.6,
                transition: "all 0.2s",
                "& fieldset": {
                  borderColor: "rgba(255, 255, 255, 0.1)",
                  borderWidth: "1px",
                },
                "&:hover fieldset": {
                  borderColor: "rgba(255, 255, 255, 0.2)",
                },
                "&.Mui-focused": {
                  bgcolor: "background.default",
                  "& fieldset": {
                    borderColor: "rgba(255, 255, 255, 0.2)",
                  },
                }
              },
              "& .MuiInputBase-input::placeholder": {
                color: "rgba(255, 255, 255, 0.2)",
                opacity: 1,
              }
            }}
          />
        </Box>
      </Box>
    );
  },
);

PersonalizationPanel.displayName = "PersonalizationPanel";
