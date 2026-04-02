import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export function useModels() {
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    invoke<string[]>("get_local_models")
      .then((fetchedModels) => {
        setModels(fetchedModels);
        if (fetchedModels.length > 0) {
          setSelectedModel(fetchedModels[0]);
        }
      })
      .catch((error) => {
        console.error("Failed to load models:", error);
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  return {
    models,
    selectedModel,
    setSelectedModel,
    isLoading,
    hasModels: models.length > 0,
  };
}