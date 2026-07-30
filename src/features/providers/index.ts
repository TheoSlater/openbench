import { useAuthStore } from "@/store/authStore";
import type { Provider } from "@/generated/bindings/Provider";

// Persisted messages still use these historical display values. Runtime
// selection itself uses the Rust-owned RuntimeRef binding.
export type ProviderType =
  | "OllamaLocal"
  | "OpenAICompatible"
  | "AnthropicNative"
  | "GeminiNative";
export function getCurrentProviderAccountId(): string {
  const auth = useAuthStore.getState();
  return auth.user?.id || auth.guestId || "";
}

export function toLegacyProviderType(provider: Provider): ProviderType {
  if (provider === "anthropic") return "AnthropicNative";
  if (provider === "gemini") return "GeminiNative";
  if (provider === "ollama") return "OllamaLocal";
  return "OpenAICompatible";
}
