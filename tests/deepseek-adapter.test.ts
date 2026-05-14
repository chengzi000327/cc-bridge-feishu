import { describe, expect, it, vi } from "vitest";

import { DeepSeekAdapter } from "../src/deepseek/adapter.js";
import { normalizeProviderConfig } from "../src/provider/provider-config.js";

describe("DeepSeekAdapter", () => {
  it("sends chat completions to the configured provider", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "你好" } }],
        usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
      }),
    });

    const adapter = new DeepSeekAdapter(
      normalizeProviderConfig({
        kind: "deepseek",
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        apiKeyEnv: "DEEPSEEK_API_KEY",
        temperature: 0.2,
      }),
      { DEEPSEEK_API_KEY: "secret" },
      fetchImpl as unknown as typeof fetch,
    );

    const response = await adapter.sendUserMessage("deepseek-1", {
      text: "hello",
      files: ["a.txt"],
      instructions: "用中文回复",
    });

    expect(response).toEqual({
      text: "你好",
      sessionId: "deepseek-1",
      usage: { inputTokens: 2, outputTokens: 3, cachedTokens: undefined },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.deepseek.com/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-v4-flash",
          messages: [
            { role: "system", content: "用中文回复" },
            { role: "user", content: "hello\nAttachment: a.txt" },
          ],
          temperature: 0.2,
          stream: false,
        }),
      }),
    );
  });

  it("reports the configured API key env when credentials are missing", async () => {
    const adapter = new DeepSeekAdapter(
      normalizeProviderConfig({
        kind: "deepseek",
        apiKeyEnv: "CUSTOM_DEEPSEEK_KEY",
      }),
      {},
    );

    await expect(adapter.sendUserMessage("deepseek-1", { text: "hello", files: [] }))
      .rejects.toThrow("CUSTOM_DEEPSEEK_KEY is required for DeepSeek engine");
  });

  it("turns DeepSeek error payloads into readable errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      statusText: "Bad Request",
      json: async () => ({ error: { message: "model not found" } }),
    });
    const adapter = new DeepSeekAdapter(
      normalizeProviderConfig({ kind: "deepseek", apiKeyEnv: "DEEPSEEK_API_KEY" }),
      { DEEPSEEK_API_KEY: "secret" },
      fetchImpl as unknown as typeof fetch,
    );

    await expect(adapter.sendUserMessage("deepseek-1", { text: "hello", files: [] }))
      .rejects.toThrow("DeepSeek request failed: model not found");
  });

  it("rejects empty assistant replies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: " " } }] }),
    });
    const adapter = new DeepSeekAdapter(
      normalizeProviderConfig({ kind: "deepseek", apiKeyEnv: "DEEPSEEK_API_KEY" }),
      { DEEPSEEK_API_KEY: "secret" },
      fetchImpl as unknown as typeof fetch,
    );

    await expect(adapter.sendUserMessage("deepseek-1", { text: "hello", files: [] }))
      .rejects.toThrow("DeepSeek returned no visible reply");
  });
});
