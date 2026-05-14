import type { ProviderConfig } from "../provider/provider-config.js";
import { createProviderPreset, type EngineName } from "../provider/provider-presets.js";
import type { Locale } from "../runtime/message-renderer.js";

type ProviderCommand =
  | { kind: "query" }
  | { kind: "deepseek" }
  | { kind: "openai-compatible" | "anthropic-compatible"; baseUrl: string; model: string }
  | { kind: "invalid" };

function parseProviderCommand(text: string): ProviderCommand | null {
  const match = text.trim().match(/^\/provider(?:@\w+)?(?:\s+(.+))?$/i);
  if (!match) return null;

  const rawArgs = match[1]?.trim() ?? "";
  if (!rawArgs) return { kind: "query" };

  const parts = rawArgs.split(/\s+/).filter(Boolean);
  const [kind, baseUrl, model] = parts;
  if (parts.length === 1 && kind === "deepseek") {
    return { kind: "deepseek" };
  }
  if (
    parts.length === 3 &&
    (kind === "openai-compatible" || kind === "anthropic-compatible") &&
    baseUrl &&
    model
  ) {
    return { kind, baseUrl, model };
  }
  return { kind: "invalid" };
}

export function isProviderTelegramCommand(text: string): boolean {
  return parseProviderCommand(text) !== null;
}

function renderUsage(locale: Locale): string {
  return locale === "zh"
    ? [
        "用法:",
        "/provider",
        "/provider deepseek",
        "/provider openai-compatible <baseUrl> <model>",
        "/provider anthropic-compatible <baseUrl> <model>",
      ].join("\n")
    : [
        "Usage:",
        "/provider",
        "/provider deepseek",
        "/provider openai-compatible <baseUrl> <model>",
        "/provider anthropic-compatible <baseUrl> <model>",
      ].join("\n");
}

function renderCurrentProvider(provider: Partial<ProviderConfig>, locale: Locale): string {
  const kind = provider.kind ?? "native";
  const name = provider.name ? ` (${provider.name})` : "";
  const model = provider.model ? `\nmodel: ${provider.model}` : "";
  const baseUrl = provider.baseUrl ? `\nbaseUrl: ${provider.baseUrl}` : "";
  const usage = renderUsage(locale);
  return locale === "zh"
    ? `当前 provider: ${kind}${name}${model}${baseUrl}\n\n${usage}`
    : `Current provider: ${kind}${name}${model}${baseUrl}\n\n${usage}`;
}

function apiKeyEnvFor(kind: "openai-compatible" | "anthropic-compatible", baseUrl: string): string {
  const normalized = baseUrl.toLowerCase();
  const isDeepseekUrl = normalized.includes("deepseek");
  const isLocalRouter = normalized.includes("127.0.0.1") || normalized.includes("localhost");
  if (isDeepseekUrl || (kind === "anthropic-compatible" && isLocalRouter)) {
    return "DEEPSEEK_API_KEY";
  }
  return kind === "openai-compatible" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
}

function renderProviderSetMessage(input: {
  locale: Locale;
  label: string;
}): string {
  return input.locale === "zh"
    ? `provider 已设为 ${input.label}。重启此实例后生效。`
    : `Provider set to ${input.label}. Restart this instance to apply.`;
}

export async function handleProviderTelegramCommand(input: {
  locale: Locale;
  text: string;
  currentEngine: EngineName;
  currentProvider: Partial<ProviderConfig>;
  sendMessage: (chatId: number, text: string) => Promise<unknown>;
  chatId: number;
  updateInstanceConfig: (updater: (config: Record<string, unknown>) => void) => Promise<void>;
}): Promise<boolean> {
  const command = parseProviderCommand(input.text);
  if (!command) return false;

  if (command.kind === "query") {
    await input.sendMessage(input.chatId, renderCurrentProvider(input.currentProvider, input.locale));
    return true;
  }

  if (command.kind === "invalid") {
    await input.sendMessage(input.chatId, renderUsage(input.locale));
    return true;
  }

  if (command.kind === "deepseek") {
    const provider = createProviderPreset(input.currentEngine, "deepseek");
    await input.updateInstanceConfig((config) => {
      config.provider = provider;
    });
    await input.sendMessage(input.chatId, renderProviderSetMessage({
      locale: input.locale,
      label: provider.name ?? "deepseek",
    }));
    return true;
  }

  const provider: Partial<ProviderConfig> = {
    kind: command.kind,
    name: command.kind,
    baseUrl: command.baseUrl,
    model: command.model,
    apiKeyEnv: apiKeyEnvFor(command.kind, command.baseUrl),
  };
  await input.updateInstanceConfig((config) => {
    config.provider = provider;
  });
  await input.sendMessage(input.chatId, renderProviderSetMessage({
    locale: input.locale,
    label: command.kind,
  }));
  return true;
}
