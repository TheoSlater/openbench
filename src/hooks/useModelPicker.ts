import { useEffect } from "react";
import { useModelStore, type OllamaModel } from "@/store/modelStore";
import { loggedInvoke } from "@/lib/utils";

export function useModelPicker() {
  const setAvailableModels = useModelStore((state) => state.setAvailableModels);
  const setSelectedModel = useModelStore((state) => state.setSelectedModel);
  const setIsLoading = useModelStore((state) => state.setIsLoading);
  const setOllamaError = useModelStore((state) => state.setOllamaError);
  const selectedModel = useModelStore((state) => state.selectedModel);
  const defaultModel = useModelStore((state) => state.defaultModel);

  const loadOllamaModels = async () => {
    setIsLoading(true);
    setOllamaError(null);
    try {
      const models = await loggedInvoke<OllamaModel[]>("get_local_models");
      setAvailableModels({ ollama: models });

      if (!selectedModel && models.length > 0) {
        const modelNames = models.map((model) => model.name);
        const preferredModel =
          defaultModel && modelNames.includes(defaultModel)
            ? defaultModel
            : modelNames[0];
        setSelectedModel("ollama", preferredModel);
      }
    } catch (error) {
      console.error("Failed to load Ollama models:", error);
      setOllamaError("Ollama unavailable");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOllamaModels();
  }, []); // Only load on mount
}
