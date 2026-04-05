import { useEffect, useRef } from "react";
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
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    } catch {
      // Ignore parse errors
    }

    const unsubscribe = useModelStore.subscribe((state) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              systemPrompts: state.systemPrompts,
              activeSystemPromptId: state.activeSystemPromptId,
            }),
          );
        } catch {
          // Ignore storage errors
        }
      }, 300);
    });

    return () => {
      unsubscribe();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);
}
