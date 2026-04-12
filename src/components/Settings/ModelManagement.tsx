import { useState, useEffect } from "react";
import { 
  Box, 
  Typography, 
  TextField, 
  Button, 
  List, 
  ListItem, 
  ListItemText, 
  IconButton, 
  LinearProgress,
  Paper,
} from "@mui/material";
import { Download, Trash2, RefreshCw } from "lucide-react";
import { useModelStore, type OllamaModel, type PullProgress } from "@/store/modelStore";
import { loggedInvoke, formatFileSize, cn } from "@/lib/utils";
import { listen } from "@tauri-apps/api/event";

export function ModelManagement() {
  const { availableModels, setAvailableModels, pullingModel, setPullingModel, pullProgress, setPullProgress } = useModelStore();
  const [newModelName, setNewModelName] = useState("");
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refreshModels = async () => {
    setIsRefreshing(true);
    try {
      const models = await loggedInvoke<OllamaModel[]>("get_local_models");
      setAvailableModels({ ollama: models });
    } catch (error) {
      console.error("Failed to refresh models:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handlePullModel = async () => {
    if (!newModelName.trim()) return;
    
    const modelToPull = newModelName.trim();
    setPullingModel(modelToPull);
    setIsPulling(true);
    setPullProgress({ status: "Starting..." });

    try {
      await loggedInvoke("pull_model", { model: modelToPull });
      setNewModelName("");
      refreshModels();
    } catch (error) {
      console.error("Failed to pull model:", error);
      // We don't necessarily want to alert if it's already pulling or something,
      // but a simple feedback is good.
    } finally {
      setPullingModel(null);
      setPullProgress(null);
      setIsPulling(false);
    }
  };

  const handleDeleteModel = async (modelName: string) => {
    if (!confirm(`Are you sure you want to delete ${modelName}?`)) return;

    try {
      await loggedInvoke("delete_model", { model: modelName });
      refreshModels();
    } catch (error) {
      console.error("Failed to delete model:", error);
    }
  };

  useEffect(() => {
    const unlistenPromise = listen<PullProgress>("pull-progress", (event) => {
      setPullProgress(event.payload);
    });

    return () => {
      unlistenPromise.then(unlisten => unlisten());
    };
  }, [setPullProgress]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* Pull Model Section */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: "14px" }}>
          Pull New Model
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <TextField
            fullWidth
            size="small"
            placeholder="e.g. llama3, deepseek-r1:7b"
            value={newModelName}
            onChange={(e) => setNewModelName(e.target.value)}
            disabled={isPulling}
            sx={{
              "& .MuiOutlinedInput-root": {
                borderRadius: "8px",
                bgcolor: "action.hover",
                fontSize: "14px",
                "& fieldset": { border: "none" },
              },
            }}
          />
          <Button
            variant="contained"
            disableElevation
            onClick={handlePullModel}
            disabled={isPulling || !newModelName.trim()}
            startIcon={<Download size={16} />}
            sx={{
              borderRadius: "8px",
              textTransform: "none",
              px: 3,
              bgcolor: "primary.main",
              "&:hover": { bgcolor: "primary.dark" },
            }}
          >
            Pull
          </Button>
        </Box>

        {isPulling && pullProgress && (
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              borderRadius: "8px",
              bgcolor: "action.hover",
              border: "none",
            }}
          >
            <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 500, fontSize: "13px" }}>
                Pulling {pullingModel}...
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: "12px" }}>
                {pullProgress.status}
              </Typography>
            </Box>
            {pullProgress.total && pullProgress.completed ? (
              <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                <LinearProgress
                  variant="determinate"
                  value={(pullProgress.completed / pullProgress.total) * 100}
                  sx={{ 
                    flex: 1, 
                    height: 6, 
                    borderRadius: 3,
                    bgcolor: "action.selected",
                    "& .MuiLinearProgress-bar": {
                        borderRadius: 3,
                    }
                  }}
                />
                <Typography variant="caption" sx={{ minWidth: 35, fontSize: "11px", fontWeight: 600 }}>
                  {Math.round((pullProgress.completed / pullProgress.total) * 100)}%
                </Typography>
              </Box>
            ) : (
              <LinearProgress sx={{ height: 4, borderRadius: 2 }} />
            )}
          </Paper>
        )}
      </Box>

      {/* Local Models Section */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: "14px" }}>
            Local Models
          </Typography>
          <IconButton size="small" onClick={refreshModels} disabled={isRefreshing}>
            <RefreshCw size={16} className={cn(isRefreshing && "animate-spin")} />
          </IconButton>
        </Box>

        <List sx={{ p: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          {availableModels.ollama.map((model) => (
            <ListItem
              key={model.name}
              sx={{
                borderRadius: "8px",
                bgcolor: "action.hover",
                "&:hover": { bgcolor: "action.selected" },
                py: 1,
                px: 2,
              }}
              secondaryAction={
                <IconButton
                  edge="end"
                  size="small"
                  onClick={() => handleDeleteModel(model.name)}
                  sx={{ 
                    color: "text.secondary",
                    "&:hover": { color: "error.main" }
                  }}
                >
                  <Trash2 size={16} />
                </IconButton>
              }
            >
              <ListItemText
                primary={model.name}
                secondary={
                  <Box sx={{ display: "flex", gap: 2, alignItems: "center", mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: "12px" }}>
                      {formatFileSize(model.size)}
                    </Typography>
                    {model.supports_vision && (
                      <Box
                        sx={{
                          px: 0.8,
                          py: 0.2,
                          borderRadius: "4px",
                          bgcolor: "primary.main",
                          color: "primary.contrastText",
                          fontSize: "10px",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        Vision
                      </Box>
                    )}
                  </Box>
                }
                primaryTypographyProps={{ fontSize: "14px", fontWeight: 500 }}
              />
            </ListItem>
          ))}
          {availableModels.ollama.length === 0 && !isRefreshing && (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 4, fontSize: "13px" }}>
              No local models found.
            </Typography>
          )}
        </List>
      </Box>
    </Box>
  );
}
