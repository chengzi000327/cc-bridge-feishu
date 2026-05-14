import type { ProviderConfig } from "./provider-config.js";

export type EngineName = "codex" | "claude" | "deepseek";
export type ProviderPresetName = "deepseek";

export function createProviderPreset(engine: EngineName, provider: ProviderPresetName): Partial<ProviderConfig> {
  if (provider !== "deepseek") {
    throw new Error(`Unsupported provider preset: ${provider}`);
  }

  const common = {
    model: "deepseek-v4-flash",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    temperature: 0.2,
    thinking: { enabled: true, effort: "medium" as const },
    timeoutMs: 1_800_000,
    inactivityTimeoutMs: 300_000,
    retries: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 10_000 },
  };

  if (engine === "claude") {
    return {
      kind: "anthropic-compatible",
      name: "deepseek-via-router",
      baseUrl: "https://api.deepseek.com",
      ...common,
    };
  }

  return {
    kind: engine === "deepseek" ? "deepseek" : "openai-compatible",
    name: "deepseek",
    baseUrl: "https://api.deepseek.com",
    ...common,
  };
}
