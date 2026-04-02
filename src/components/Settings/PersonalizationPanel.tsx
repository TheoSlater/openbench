import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { SystemPrompt, useModelStore } from "@/store/modelStore";
import type { PersonalizationPanelRef } from "./SettingsModal";
import { Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const CHARACTERISTICS = [
  {
    id: "warm",
    label: "Warm",
    description: "Friendly and approachable responses",
  },
  {
    id: "enthusiastic",
    label: "Enthusiastic",
    description: "High energy and excitement",
  },
  {
    id: "headers-lists",
    label: "Headers & Lists",
    description: "Structured and organized content",
  },
  { id: "emoji", label: "Emoji", description: "Use emojis to add personality" },
];

const BASE_STYLES = [
  {
    value: "default",
    label: "Default",
    description: "The standard AI assistant tone",
  },
  {
    value: "cynical",
    label: "Cynical",
    description: "A witty, skeptical, and slightly sarcastic voice",
  },
  {
    value: "professional",
    label: "Professional",
    description: "Clear, concise, and formal communication",
  },
  {
    value: "friendly",
    label: "Friendly",
    description: "Warm, empathetic, and casual interaction",
  },
];

/**
 * System prompt management panel.
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
    const [baseStyle, setBaseStyle] = useState("default");
    const [characteristics, setCharacteristics] = useState<string[]>([]);
    const [instantAnswers, setInstantAnswers] = useState(false);

    useEffect(() => {
      setContent(activePrompt?.content ?? "");
      setBaseStyle(activePrompt?.baseStyle ?? "default");
      setCharacteristics(activePrompt?.characteristics ?? []);
      setInstantAnswers(activePrompt?.instantAnswers ?? false);
    }, [activePrompt]);

    /**
     * Persist changes to the active prompt.
     */
    const handleSave = () => {
      const nextPrompt: SystemPrompt = {
        id: activePrompt?.id ?? "default",
        name: activePrompt?.name ?? "Default",
        content,
        baseStyle,
        characteristics,
        instantAnswers,
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

    const updateCharacteristic = (id: string, value: string) => {
      setCharacteristics((prev) => {
        if (value === "default") {
          return prev.filter((c) => c !== id);
        }
        return prev.includes(id) ? prev : [...prev, id];
      });
    };

    return (
      <div className="flex w-full flex-col divide-y divide-border/10">
        {/* Base Style and Tone */}
        <section className="py-8 first:pt-0">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <label className="text-sm font-bold tracking-tight text-foreground">
                Base style and tone
              </label>
              <p className="text-xs text-muted-foreground/60 leading-relaxed">
                Select the core personality and tone of the AI.
              </p>
            </div>
            <Select
              value={baseStyle}
              onValueChange={(val) => val && setBaseStyle(val)}
            >
              <SelectTrigger className="h-10 w-full sm:w-[180px] rounded-xl border-2 border-border/30 bg-muted/5 px-4 text-xs font-semibold focus:border-foreground/20 focus:bg-background focus:ring-4 focus:ring-foreground/5 transition-all">
                <SelectValue placeholder="Select style" />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-border/40 shadow-xl">
                {BASE_STYLES.map((style) => (
                  <SelectItem
                    key={style.value}
                    value={style.value}
                    className="py-2.5 rounded-lg"
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-bold text-xs">{style.label}</span>
                      <span className="text-[10px] text-muted-foreground/70">
                        {style.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </section>

        {/* Characteristics */}
        <section className="py-8">
          <div className="mb-6 space-y-1">
            <label className="text-sm font-bold tracking-tight text-foreground">
              Characteristics
            </label>
            <p className="text-xs text-muted-foreground/60 leading-relaxed">
              Pick specific traits to fine-tune the AI behavior.
            </p>
          </div>
          <div className="space-y-4">
            {CHARACTERISTICS.map((char) => (
              <div key={char.id} className="flex items-center justify-between py-1">
                <div className="space-y-0.5">
                  <span className="text-xs font-semibold text-foreground/90">
                    {char.label}
                  </span>
                  <p className="text-[11px] text-muted-foreground/50">
                    {char.description}
                  </p>
                </div>
                <Select
                  value={characteristics.includes(char.id) ? char.id : "default"}
                  onValueChange={(val) => updateCharacteristic(char.id, val as string)}
                >
                  <SelectTrigger className="h-9 w-[140px] rounded-xl border-2 border-border/30 bg-muted/5 px-4 text-[11px] font-semibold focus:border-foreground/20 focus:bg-background focus:ring-4 focus:ring-foreground/5 transition-all">
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl border-border/40 shadow-xl">
                    <SelectItem value="default" className="text-[11px] font-medium py-2 rounded-lg">
                      Default
                    </SelectItem>
                    <SelectItem value={char.id} className="text-[11px] font-medium py-2 rounded-lg">
                      {char.label}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </section>

        {/* Instant Answers */}
        <section className="py-8">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <label className="text-sm font-bold tracking-tight text-foreground">
                Instant answers
              </label>
              <p className="text-xs text-muted-foreground/60 leading-relaxed">
                Optimize for speed and rapid response delivery.
              </p>
            </div>
            <Switch
              checked={instantAnswers}
              onCheckedChange={setInstantAnswers}
            />
          </div>
        </section>

        {/* Custom Instructions */}
        <section className="py-8 last:pb-0">
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
            className="min-h-[200px] w-full rounded-2xl border-2 border-border/30 bg-muted/10 px-6 py-5 text-sm font-medium leading-relaxed focus:border-foreground/20 focus:bg-background focus:ring-8 focus:ring-foreground/5 outline-none transition-all resize-y placeholder:text-muted-foreground/30"
            placeholder="Example: I'm a developer working with React and Rust. Keep explanations concise..."
          />
        </section>
      </div>
    );
  },
);

PersonalizationPanel.displayName = "PersonalizationPanel";
