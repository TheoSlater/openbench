const reasoningModelHints = ["deepseek-r1", "reasoning", "o1", "o3"];

export function modelSupportsReasoning(model: string) {
  if (!model) return false;
  const normalized = model.toLowerCase();

  if (reasoningModelHints.some((hint) => normalized.includes(hint))) {
    return true;
  }

  return /(^|[^a-z0-9])r1([^a-z0-9]|$)/.test(normalized);
}
