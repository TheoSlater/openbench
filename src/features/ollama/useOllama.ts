import { useOllamaStore } from "./monitor";
import { useShallow } from "zustand/react/shallow";

export function useOllama() {
  const store = useOllamaStore(
    useShallow((state) => ({
      state: state.state,
      localModels: state.localModels,
      models: state.models,
      externalModelsLoaded: state.externalModelsLoaded,
      externalModelsLoading: state.externalModelsLoading,
      externalModelsError: state.externalModelsError,
      error: state.error,
      pullingModel: state.pullingModel,
      pullProgress: state.pullProgress,
    }))
  );

  const actions = useOllamaStore((state) => state.actions);

  return {
    ...store,
    actions,
    online: store.state === "online",
    refresh: actions.refresh,
  };
}
