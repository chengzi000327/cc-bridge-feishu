import { describe, expect, it, vi } from "vitest";

import { handleProviderTelegramCommand } from "../src/telegram/provider-commands.js";

describe("handleProviderTelegramCommand", () => {
  it("shows the current provider on bare /provider", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: "m1" });

    const handled = await handleProviderTelegramCommand({
      locale: "en",
      text: "/provider",
      currentEngine: "codex",
      currentProvider: { kind: "openai-compatible", name: "deepseek", model: "deepseek-v4-flash" },
      sendMessage,
      chatId: 123,
      updateInstanceConfig: vi.fn(),
    });

    expect(handled).toBe(true);
    expect(sendMessage).toHaveBeenCalledWith(123, expect.stringContaining("Current provider: openai-compatible"));
    expect(sendMessage).toHaveBeenCalledWith(123, expect.stringContaining("/provider deepseek"));
  });

  it("sets DeepSeek provider using engine-aware preset", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: "m1" });
    const written: Record<string, unknown> = { engine: "codex" };

    const handled = await handleProviderTelegramCommand({
      locale: "zh",
      text: "/provider deepseek",
      currentEngine: "codex",
      currentProvider: { kind: "native" },
      sendMessage,
      chatId: 123,
      updateInstanceConfig: async (updater) => updater(written),
    });

    expect(handled).toBe(true);
    expect(written.provider).toMatchObject({
      kind: "openai-compatible",
      name: "deepseek",
      model: "deepseek-v4-flash",
    });
    expect(sendMessage).toHaveBeenCalledWith(123, expect.stringContaining("provider 已设为 deepseek"));
  });

  it("sets an explicit OpenAI-compatible provider", async () => {
    const written: Record<string, unknown> = { engine: "codex" };

    const handled = await handleProviderTelegramCommand({
      locale: "zh",
      text: "/provider openai-compatible https://router.example/v1 deepseek-v4-flash",
      currentEngine: "codex",
      currentProvider: { kind: "native" },
      sendMessage: vi.fn().mockResolvedValue({ messageId: "m1" }),
      chatId: 123,
      updateInstanceConfig: async (updater) => updater(written),
    });

    expect(handled).toBe(true);
    expect(written.provider).toMatchObject({
      kind: "openai-compatible",
      name: "openai-compatible",
      baseUrl: "https://router.example/v1",
      model: "deepseek-v4-flash",
      apiKeyEnv: "OPENAI_API_KEY",
    });
  });

  it("uses DeepSeek key env for explicit DeepSeek-compatible base URLs", async () => {
    const written: Record<string, unknown> = { engine: "claude" };

    await handleProviderTelegramCommand({
      locale: "en",
      text: "/provider anthropic-compatible http://127.0.0.1:3456 deepseek-v4-flash",
      currentEngine: "claude",
      currentProvider: { kind: "native" },
      sendMessage: vi.fn().mockResolvedValue({ messageId: "m1" }),
      chatId: 123,
      updateInstanceConfig: async (updater) => updater(written),
    });

    expect(written.provider).toMatchObject({
      kind: "anthropic-compatible",
      name: "anthropic-compatible",
      baseUrl: "http://127.0.0.1:3456",
      model: "deepseek-v4-flash",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    });
  });

  it("returns false for non-provider commands", async () => {
    await expect(handleProviderTelegramCommand({
      locale: "en",
      text: "/engine codex",
      currentEngine: "codex",
      currentProvider: { kind: "native" },
      sendMessage: vi.fn(),
      chatId: 123,
      updateInstanceConfig: vi.fn(),
    })).resolves.toBe(false);
  });
});
