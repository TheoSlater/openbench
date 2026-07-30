import type { ProviderType } from "@/features/providers";

export type ProviderModel = {
  name: string;
  provider_type: ProviderType;
  provider_config_id?: number;
};

export type ModelChoice = {
  provider: ProviderType;
  model: string;
  providerConfigId?: number;
};

export function modelChoiceId(
  provider: ProviderType,
  model: string,
  providerConfigId?: number,
): string {
  const encodedModel = encodeURIComponent(model);
  return providerConfigId === undefined
    ? `${provider}:${encodedModel}`
    : `${provider}:${providerConfigId}:${encodedModel}`;
}

