import type { OllamaModel } from "./types";
import type { ProviderType } from "@/features/providers";
import { getCurrentProviderAccountId, toLegacyProviderType } from "@/features/providers";
import { connectionsClient } from "@/features/connections/client";

interface ProviderAndModelsResult {
  models: OllamaModel[];
  online: boolean;
}

export const ollamaClient = {
  async getProviderAndModels(): Promise<ProviderAndModelsResult> {
    const summaries = await connectionsClient.list(getCurrentProviderAccountId());
    const enabled = summaries.filter((item) =>
      item.connection.enabled && item.health.status !== "failed"
    );
    const models = (await Promise.all(enabled.map(async ({ connection }) =>
      (await connectionsClient.models(connection.id))
        .filter((model) => model.enabled)
        .map((model) => ({
          name: model.remote_id,
          families: [],
          size: 0,
          provider_type: toLegacyProviderType(connection.provider),
        }))
    ))).flat();
    return { models, online: enabled.length > 0 };
  },

  async getProviderModels(providerType: ProviderType): Promise<OllamaModel[]> {
    const result = await this.getProviderAndModels();
    return result.models.filter((model) => model.provider_type === providerType);
  },
};
