export type ProviderKind =
  | "ollama-local"
  | "openai-compatible"
  | "anthropic-native"
  | "gemini-native";

export interface ProviderPreset {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl: string;
  requiresApiKey: boolean;
  defaultHeaders?: Record<string, string>;
  modelSuggestions?: string[];
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    requiresApiKey: true,
    modelSuggestions: ["gpt-4o", "gpt-4o-mini", "gpt-4o-mini-search-preview"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    requiresApiKey: true,
    defaultHeaders: {
      "HTTP-Referer": "",
      "X-Title": "Poly UI",
    },
    modelSuggestions: [
      "anthropic/claude-sonnet-20241022",
      "openai/gpt-4o",
      "google/gemini-2.0-flash-001",
    ],
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    requiresApiKey: true,
    modelSuggestions: [
      "llama3-70b-8192",
      "mixtral-8x7b-32768",
      "deepseek-r1-distill-llama-70b",
    ],
  },
  {
    id: "together",
    label: "Together AI",
    kind: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    requiresApiKey: true,
    modelSuggestions: ["mistralai/Mixtral-8x7B-Instruct-v0.1"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai-compatible",
    baseUrl: "https://api.deepseek.com/v1",
    requiresApiKey: true,
    modelSuggestions: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "anthropic-native",
    baseUrl: "https://api.anthropic.com/v1",
    requiresApiKey: true,
    modelSuggestions: ["claude-sonnet-4-20250514", "claude-haiku-4-20250414"],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    kind: "gemini-native",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    requiresApiKey: true,
    modelSuggestions: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    kind: "ollama-local",
    baseUrl: "http://127.0.0.1:11434",
    requiresApiKey: false,
  },
  {
    id: "custom",
    label: "Custom",
    kind: "openai-compatible",
    baseUrl: "",
    requiresApiKey: false,
  },
];

export function lookupPreset(
  id: string | null | undefined,
  baseUrl: string | null | undefined,
): ProviderPreset {
  if (id) {
    const found = PROVIDER_PRESETS.find((p) => p.id === id);
    if (found) return found;
  }
  if (baseUrl) {
    const matched = PROVIDER_PRESETS.find(
      (p) => p.baseUrl && baseUrl.startsWith(p.baseUrl),
    );
    if (matched) return matched;
  }
  const custom = PROVIDER_PRESETS.find((p) => p.id === "custom")!;
  return { ...custom, baseUrl: baseUrl ?? "" };
}
