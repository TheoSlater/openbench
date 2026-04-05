import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useModelStore, type OllamaModel } from "@/store/modelStore";

export function useModelPicker() {
  const setAvailableModels = useModelStore((state) => state.setAvailableModels);
  const setSelectedModel = useModelStore((state) => state.setSelectedModel);
  const setIsLoading = useModelStore((state) => state.setIsLoading);
  const setOllamaError = useModelStore((state) => state.setOllamaError);
  const selectedModel = useModelStore((state) => state.selectedModel);
  const defaultModel = useModelStore((state) => state.defaultModel);

  useEffect(() => {
    let isMounted = true;

    const loadOllamaModels = async () => {
      setIsLoading(true);
      setOllamaError(null);
      try {
        const models = await invoke<OllamaModel[]>("get_local_models");

        if (!isMounted) return;
        setAvailableModels({ ollama: models });
        
        const modelNames = models.map(m => m.name.toString());
        if (!selectedModel && models.length > 0) {
          // Priority: 1. Default model if available, 2. First available model
          const modelToSelect = (defaultModel && modelNames.includes(defaultModel)) 
            ? defaultModel 
            : modelNames[0];
          setSelectedModel("ollama", modelToSelect);
        }
      } catch (error) {
        console.error("Failed to load Ollama models:", error);
        if (!isMounted) return;
        setAvailableModels({ ollama: [] });
        setOllamaError("Ollama unavailable");
        if (!selectedModel) {
          setSelectedModel("ollama", "");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadOllamaModels();

    return () => {
      isMounted = false;
    };
  }, [selectedModel, setAvailableModels, setIsLoading, setOllamaError, setSelectedModel]);
}
