import { useEffect } from "react";
import { SystemPrompt, useModelStore } from "@/store/modelStore";

const STORAGE_KEY = "openbench.systemPrompts";

type StoredPrompts = {
  systemPrompts: SystemPrompt[];
  activeSystemPromptId: string | null;
};

/**
 * Persist system prompts to localStorage and restore on startup.
 */
export function useSystemPrompts() {
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as StoredPrompts;
        if (Array.isArray(parsed.systemPrompts)) {
          const nextActive =
            parsed.activeSystemPromptId ??
            parsed.systemPrompts[0]?.id ??
            null;
          useModelStore.setState({
            systemPrompts: parsed.systemPrompts,
            activeSystemPromptId: nextActive,
          });
        }
      }
    } catch (error) {
      console.error("Failed to load system prompts:", error);
    }

    const unsubscribe = useModelStore.subscribe((state) => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            systemPrompts: state.systemPrompts,
            activeSystemPromptId: state.activeSystemPromptId,
          }),
        );
      } catch (error) {
        console.error("Failed to save system prompts:", error);
      }
    });

    return () => unsubscribe();
  }, []);
}
