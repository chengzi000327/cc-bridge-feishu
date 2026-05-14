import type {
  AdapterUsage,
  CodexAdapter,
  CodexAdapterResponse,
  CodexSessionHandle,
  CodexUserMessageInput,
} from "../codex/adapter.js";
import type { ProviderConfig } from "../provider/provider-config.js";

interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  id?: string;
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
}

function baseUrlFor(provider: ProviderConfig): string {
  return (provider.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/, "");
}

function modelFor(provider: ProviderConfig): string {
  return provider.model ?? "deepseek-chat";
}

function apiKeyFor(provider: ProviderConfig, env: NodeJS.ProcessEnv): string | undefined {
  return env[provider.apiKeyEnv ?? "DEEPSEEK_API_KEY"];
}

function usageFrom(response: ChatCompletionResponse): AdapterUsage | undefined {
  const usage = response.usage;
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    cachedTokens: usage.prompt_cache_hit_tokens,
  };
}

function buildMessages(input: CodexUserMessageInput): ChatCompletionMessage[] {
  const messages: ChatCompletionMessage[] = [];
  if (input.instructions?.trim()) {
    messages.push({ role: "system", content: input.instructions.trim() });
  }
  const parts = [input.text];
  for (const file of input.files) {
    parts.push(`Attachment: ${file}`);
  }
  messages.push({ role: "user", content: parts.join("\n") });
  return messages;
}

export class DeepSeekAdapter implements CodexAdapter {
  readonly bridgeInstructionMode = "telegram-out-only" as const;
  readonly supportsTurnScopedEnv = true;

  constructor(
    private readonly provider: ProviderConfig,
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async createSession(chatId: number): Promise<CodexSessionHandle> {
    return { sessionId: `deepseek-${chatId}` };
  }

  async sendUserMessage(sessionId: string, input: CodexUserMessageInput): Promise<CodexAdapterResponse> {
    const apiKey = apiKeyFor(this.provider, this.env);
    if (!apiKey) {
      throw new Error(`${this.provider.apiKeyEnv ?? "DEEPSEEK_API_KEY"} is required for DeepSeek engine`);
    }

    const response = await this.fetchImpl(`${baseUrlFor(this.provider)}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: modelFor(this.provider),
        messages: buildMessages(input),
        temperature: this.provider.temperature,
        stream: false,
      }),
      signal: input.abortSignal,
    });

    const json = await response.json() as ChatCompletionResponse;
    if (!response.ok || json.error) {
      throw new Error(`DeepSeek request failed: ${json.error?.message ?? response.statusText}`);
    }

    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error("DeepSeek returned no visible reply");
    }

    return {
      text,
      sessionId,
      usage: usageFrom(json),
    };
  }
}
