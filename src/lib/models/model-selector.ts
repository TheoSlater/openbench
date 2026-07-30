import {
  modelChoiceId,
  type ProviderModel,
} from "./model-choice";

export function mergeModelOptions<T extends ProviderModel>(
  localModels: T[],
  externalModels: T[],
): T[] {
  const seen = new Set<string>();

  return [...localModels, ...externalModels].filter((model) => {
    const id = modelChoiceId(model.provider_type, model.name);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
