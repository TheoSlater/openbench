import { useEffect, useMemo, useState } from "react";
import { SystemPrompt, useModelStore } from "@/store/modelStore";

/**
 * Generate a prompt id without external dependencies.
 */
const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `prompt-${Date.now()}`;

/**
 * System prompt management panel.
 */
export function PersonalizationPanel() {
  const { systemPrompts, activeSystemPromptId, actions } = useModelStore();
  const activePrompt = useMemo(
    () => systemPrompts.find((prompt) => prompt.id === activeSystemPromptId) ?? null,
    [activeSystemPromptId, systemPrompts],
  );
  const [name, setName] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    setName(activePrompt?.name ?? "");
    setContent(activePrompt?.content ?? "");
  }, [activePrompt]);

  /**
   * Persist changes to the active prompt or create one if missing.
   */
  const handleSave = () => {
    const nextPrompt: SystemPrompt = {
      id: activePrompt?.id ?? createId(),
      name: name.trim() || "Untitled",
      content,
    };
    if (activePrompt) {
      actions.updateSystemPrompt(nextPrompt);
    } else {
      actions.addSystemPrompt(nextPrompt);
      actions.setSystemPrompt(nextPrompt.id);
    }
  };

  /**
   * Create a new prompt based on current edits.
   */
  const handleSaveAsNew = () => {
    const nextPrompt: SystemPrompt = {
      id: createId(),
      name: name.trim() || "New prompt",
      content,
    };
    actions.addSystemPrompt(nextPrompt);
    actions.setSystemPrompt(nextPrompt.id);
  };

  /**
   * Delete a prompt after confirmation.
   * @param id - Prompt id to remove.
   */
  const handleDelete = (id: string) => {
    const ok = window.confirm("Delete this system prompt?");
    if (!ok) return;
    actions.deleteSystemPrompt(id);
  };

  return (
    <section className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Personalization</h3>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Manage system prompts that steer assistant behavior.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px,1fr]">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
            Saved prompts
          </p>
          <div className="space-y-2">
            {systemPrompts.map((prompt) => (
              <label
                key={prompt.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm text-foreground/90 hover:border-border"
              >
                <input
                  type="radio"
                  name="active-system-prompt"
                  checked={prompt.id === activeSystemPromptId}
                  onChange={() => actions.setSystemPrompt(prompt.id)}
                  className="h-3.5 w-3.5"
                />
                <span className="truncate">{prompt.name}</span>
                <button
                  type="button"
                  className="ml-auto text-xs text-muted-foreground/70 hover:text-foreground/90"
                  onClick={(event) => {
                    event.preventDefault();
                    handleDelete(prompt.id);
                  }}
                >
                  Delete
                </button>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
            Prompt name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-2 w-full rounded-lg border border-border/60 bg-muted/50 px-3 py-2 text-sm text-foreground outline-none transition focus:border-border"
              placeholder="Name this prompt"
            />
          </label>

          <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
            Prompt content
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="mt-2 min-h-[220px] w-full resize-none rounded-lg border border-border/60 bg-muted/50 px-3 py-2 text-sm leading-6 text-foreground outline-none transition focus:border-border"
              placeholder="Write your system prompt..."
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded-full bg-muted px-4 py-2 text-xs font-medium text-foreground transition hover:bg-muted/80"
              onClick={handleSave}
            >
              Save
            </button>
            <button
              type="button"
              className="rounded-full border border-border/60 px-4 py-2 text-xs font-medium text-muted-foreground/80 transition hover:border-border hover:text-foreground/90"
              onClick={handleSaveAsNew}
            >
              Save as new
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
