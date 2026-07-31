export type WebSearchProviderId = "local" | "exa" | "ollama" | "tavily";

export type WebSearchSettings = {
  provider: WebSearchProviderId;
};
