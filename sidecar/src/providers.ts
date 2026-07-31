import type { LanguageModel } from "ai";
import type { RuntimeConnection } from "./protocol";

type ProviderFetch = typeof fetch;
type DiscoveryConnection = Omit<RuntimeConnection, "modelId"> & { modelId?: string };

const stripSlash = (url: string) => url.replace(/\/+$/, "");

function openAiBase(connection: RuntimeConnection): string | undefined {
  return connection.baseUrl ? stripSlash(connection.baseUrl) : undefined;
}

function compatibleBase(connection: DiscoveryConnection): string {
  const base = stripSlash(connection.baseUrl ?? (
    connection.provider === "ollama"
      ? "http://127.0.0.1:11434"
      : connection.provider === "lmstudio"
        ? "http://127.0.0.1:1234/v1"
        : connection.provider === "openrouter"
          ? "https://openrouter.ai/api/v1"
          : "https://api.openai.com/v1"
  ));
  return connection.provider === "ollama" && !base.endsWith("/v1") ? `${base}/v1` : base;
}

export async function createModel(
  connection: RuntimeConnection,
  providerFetch?: ProviderFetch,
): Promise<LanguageModel> {
  switch (connection.provider) {
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({
        apiKey: connection.secret,
        baseURL: openAiBase(connection),
        headers: connection.headers,
        fetch: providerFetch,
      }).chat(connection.modelId);
    }
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({
        apiKey: connection.secret,
        baseURL: connection.baseUrl && stripSlash(connection.baseUrl),
        headers: connection.headers,
        fetch: providerFetch,
      })(connection.modelId);
    }
    case "gemini": {
      const { createGoogleGenerativeAI } = await import("@ai-sdk/google");
      return createGoogleGenerativeAI({
        apiKey: connection.secret,
        baseURL: connection.baseUrl && stripSlash(connection.baseUrl),
        headers: connection.headers,
        fetch: providerFetch,
      })(connection.modelId);
    }
    case "vercel-gateway": {
      const { createGateway } = await import("@ai-sdk/gateway");
      return createGateway({
        apiKey: connection.secret,
        baseURL: connection.baseUrl && stripSlash(connection.baseUrl),
        headers: connection.headers,
        fetch: providerFetch,
      })(connection.modelId);
    }
    case "openrouter":
    case "ollama":
    case "lmstudio":
    case "openai-compatible": {
      const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
      const provider = createOpenAICompatible({
        name: connection.provider,
        apiKey: connection.secret ?? "local",
        baseURL: compatibleBase(connection),
        headers: connection.headers,
        fetch: providerFetch,
      });
      return provider.chatModel(connection.modelId);
    }
  }
}

type ModelRow = { id: string; name?: string; owned_by?: string };

async function listJsonModels(
  url: string,
  connection: DiscoveryConnection,
  providerFetch: ProviderFetch,
): Promise<ModelRow[]> {
  const headers = new Headers(connection.headers);
  if (connection.secret) headers.set("authorization", `Bearer ${connection.secret}`);
  const response = await providerFetch(url, { headers });
  if (!response.ok) throw new Error(`Model discovery failed (${response.status})`);
  const body = await response.json() as {
    data?: Array<ModelRow & { display_name?: string }>;
    models?: Array<{ name: string; displayName?: string }>;
  };
  if (Array.isArray(body.data)) {
    return body.data.map(({ display_name, ...model }) => ({
      ...model,
      name: model.name ?? display_name,
    }));
  }
  if (Array.isArray(body.models)) {
    return body.models.map((model) => ({
      id: model.name.replace(/^models\//, ""),
      name: model.displayName,
    }));
  }
  throw new Error("Model discovery returned an invalid catalog");
}

export async function listModels(
  connection: DiscoveryConnection,
  providerFetch: ProviderFetch = fetch,
): Promise<ModelRow[]> {
  if (connection.provider === "vercel-gateway") {
    const { createGateway } = await import("@ai-sdk/gateway");
    const catalog = await createGateway({
      apiKey: connection.secret,
      baseURL: connection.baseUrl && stripSlash(connection.baseUrl),
      headers: connection.headers,
      fetch: providerFetch,
    }).getAvailableModels();
    return catalog.models.map((model) => ({ id: model.id, name: model.name }));
  }

  if (connection.provider === "anthropic") {
    return listJsonModels(
      `${stripSlash(connection.baseUrl ?? "https://api.anthropic.com/v1")}/models`,
      {
        ...connection,
        secret: undefined,
        headers: {
          ...connection.headers,
          ...(connection.secret ? { "x-api-key": connection.secret } : {}),
          "anthropic-version": "2023-06-01",
        },
      },
      providerFetch,
    );
  }
  if (connection.provider === "gemini") {
    const base = stripSlash(connection.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta");
    return listJsonModels(`${base}/models`, {
      ...connection,
      secret: undefined,
      headers: {
        ...connection.headers,
        ...(connection.secret ? { "x-goog-api-key": connection.secret } : {}),
      },
    }, providerFetch);
  }
  return listJsonModels(`${compatibleBase(connection)}/models`, connection, providerFetch);
}
