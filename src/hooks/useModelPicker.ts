import { useEffect } from "react";
import { useModelStore } from "@/store/modelStore";

const OLLAMA_URL =
  import.meta.env.VITE_OLLAMA_URL ?? "http://localhost:11434";

type OllamaTagsResponse = {
  models?: { name?: string }[];
};

export function useModelPicker() {
  const setAvailableModels = useModelStore((state) => state.setAvailableModels);
  const setSelectedModel = useModelStore((state) => state.setSelectedModel);
  const setIsLoading = useModelStore((state) => state.setIsLoading);
  const setOllamaError = useModelStore((state) => state.setOllamaError);
  const selectedModel = useModelStore((state) => state.selectedModel);

  useEffect(() => {
    let isMounted = true;

    const loadOllamaModels = async () => {
      setIsLoading(true);
      setOllamaError(null);
      try {
        const response = await fetch(`${OLLAMA_URL}/api/tags`);
        if (!response.ok) {
          throw new Error(`Ollama error: ${response.status}`);
        }
        const data: OllamaTagsResponse = await response.json();
        const models =
          data.models
            ?.map((model) => model.name)
            .filter((name): name is string => Boolean(name)) ?? [];

        if (!isMounted) return;
        setAvailableModels({ ollama: models });
        if (!selectedModel && models.length > 0) {
          setSelectedModel("ollama", models[0]);
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
