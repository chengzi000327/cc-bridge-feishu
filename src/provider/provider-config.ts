import { z } from "zod";

export const ProviderKindSchema = z.enum([
  "native",
  "openai-compatible",
  "anthropic-compatible",
  "command-template",
]);
export const ThinkingEffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

export const ProviderConfigSchema = z.object({
  kind: ProviderKindSchema.optional(),
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional(),
  temperature: z.number().min(0).max(2).optional(),
  thinking: z.object({
    enabled: z.boolean().optional(),
    effort: ThinkingEffortSchema.optional(),
  }).optional(),
  timeoutMs: z.number().int().min(10_000).max(86_400_000).optional(),
  inactivityTimeoutMs: z.number().int().min(10_000).max(86_400_000).nullable().optional(),
  retries: z.object({
    maxAttempts: z.number().int().min(1).max(5).optional(),
    baseDelayMs: z.number().int().min(0).max(60_000).optional(),
    maxDelayMs: z.number().int().min(0).max(300_000).optional(),
  }).optional(),
  extraEnv: z.record(z.string(), z.string()).optional(),
  extraArgs: z.array(z.string()).optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
}).passthrough();

export type ProviderConfig = z.infer<typeof ProviderConfigSchema> & {
  kind: "native" | "openai-compatible" | "anthropic-compatible" | "command-template";
  thinking: { enabled?: boolean; effort?: "low" | "medium" | "high" | "xhigh" | "max" };
  timeoutMs: number;
  inactivityTimeoutMs: number | null;
  retries: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number };
  extraEnv: Record<string, string>;
  extraArgs: string[];
};

export function normalizeProviderConfig(raw: unknown): ProviderConfig {
  const parsed = ProviderConfigSchema.safeParse(raw);
  const value = parsed.success ? parsed.data : {};
  return {
    kind: value.kind ?? "native",
    name: value.name,
    model: value.model,
    baseUrl: value.baseUrl,
    apiKeyEnv: value.apiKeyEnv,
    temperature: value.temperature,
    thinking: {
      enabled: value.thinking?.enabled,
      effort: value.thinking?.effort,
    },
    timeoutMs: value.timeoutMs ?? 3_600_000,
    inactivityTimeoutMs: value.inactivityTimeoutMs === null ? null : value.inactivityTimeoutMs ?? 1_800_000,
    retries: {
      maxAttempts: value.retries?.maxAttempts ?? 1,
      baseDelayMs: value.retries?.baseDelayMs ?? 1000,
      maxDelayMs: value.retries?.maxDelayMs ?? 10_000,
    },
    extraEnv: value.extraEnv ?? {},
    extraArgs: value.extraArgs ?? [],
    command: value.command,
    args: value.args,
  };
}
