import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { SystemPrompt, useModelStore } from "@/store/modelStore";
import type { PersonalizationPanelRef } from "./SettingsModal";

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
      <div className="flex w-full flex-col">
        {/* Custom Instructions */}
        <section className="py-0">
          <div className="mb-6 space-y-1">
            <label
              htmlFor="prompt-content"
              className="text-sm font-bold tracking-tight text-foreground"
            >
              Custom instructions
            </label>
            <p className="text-xs text-muted-foreground/60 leading-relaxed">
              What would you like the AI to know to provide better responses?
            </p>
          </div>
          <textarea
            id="prompt-content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-[300px] w-full rounded-2xl border-2 border-border/30 bg-muted/10 px-6 py-5 text-sm font-medium leading-relaxed focus:border-foreground/20 focus:bg-background focus:ring-8 focus:ring-foreground/5 outline-none transition-all resize-y placeholder:text-muted-foreground/30"
            placeholder="Example: I'm a developer working with React and Rust. Keep explanations concise..."
          />
        </section>
      </div>
    );
  },
);

PersonalizationPanel.displayName = "PersonalizationPanel";
