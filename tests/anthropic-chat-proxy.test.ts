import { describe, expect, it, vi } from "vitest";

import { createAnthropicChatProxy } from "../src/provider/anthropic-chat-proxy.js";
import {
  anthropicMessagesToChat,
  chatCompletionToAnthropicMessage,
} from "../src/provider/anthropic-chat-transform.js";

describe("anthropic-chat-transform", () => {
  it("maps Anthropic messages to DeepSeek chat completions", () => {
    expect(anthropicMessagesToChat({
      model: "deepseek-v4-flash",
      system: [
        { type: "text", text: "用中文回复" },
        { type: "text", text: "保持简洁" },
      ],
      messages: [
        { role: "user", content: "你好" },
        { role: "assistant", content: [{ type: "text", text: "你好！" }] },
        { role: "user", content: [{ type: "text", text: "介绍一下 DeepSeek" }] },
      ],
      temperature: 0.2,
      max_tokens: 1024,
    })).toEqual({
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: "用中文回复\n保持简洁" },
        { role: "user", content: "你好" },
        { role: "assistant", content: "你好！" },
        { role: "user", content: "介绍一下 DeepSeek" },
      ],
      temperature: 0.2,
      max_tokens: 1024,
      stream: false,
    });
  });

  it("maps chat completion back to Anthropic message shape", () => {
    expect(chatCompletionToAnthropicMessage({
      id: "chatcmpl-1",
      choices: [{ message: { content: "你好" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    }, "deepseek-v4-flash")).toMatchObject({
      id: "chatcmpl-1",
      type: "message",
      role: "assistant",
      model: "deepseek-v4-flash",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "你好" }],
      usage: { input_tokens: 1, output_tokens: 2 },
    });
  });
});

describe("createAnthropicChatProxy", () => {
  it("responds to health checks", async () => {
    const proxy = await createAnthropicChatProxy({
      provider: { apiKeyEnv: "DEEPSEEK_API_KEY" },
      env: { DEEPSEEK_API_KEY: "secret" },
      port: 0,
    });

    try {
      const response = await fetch(`${proxy.baseUrl}/health`);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("ok");
    } finally {
      await proxy.close();
    }
  });

  it("serves /v1/messages and forwards to DeepSeek chat completions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "chatcmpl-1",
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    });
    const proxy = await createAnthropicChatProxy({
      provider: {
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        apiKeyEnv: "DEEPSEEK_API_KEY",
      },
      env: { DEEPSEEK_API_KEY: "secret" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      port: 0,
    });

    try {
      const response = await fetch(`${proxy.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: "ignored-client-model",
          system: "用中文回复",
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 128,
          temperature: 0.1,
        }),
      });

      expect(response.ok).toBe(true);
      expect(await response.json()).toMatchObject({
        type: "message",
        role: "assistant",
        model: "deepseek-v4-flash",
        content: [{ type: "text", text: "ok" }],
        usage: { input_tokens: 3, output_tokens: 4 },
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
              { role: "user", content: "ping" },
            ],
            temperature: 0.1,
            max_tokens: 128,
            stream: false,
          }),
        }),
      );
    } finally {
      await proxy.close();
    }
  });

  it("returns a clear error when the configured API key is missing", async () => {
    const proxy = await createAnthropicChatProxy({
      provider: { apiKeyEnv: "CUSTOM_DEEPSEEK_KEY" },
      env: {},
      port: 0,
    });

    try {
      const response = await fetch(`${proxy.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "ping" }] }),
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: { type: "api_error", message: "CUSTOM_DEEPSEEK_KEY is required for Anthropic chat proxy" },
      });
    } finally {
      await proxy.close();
    }
  });

  it("returns upstream error JSON cleanly", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ error: { message: "model not found", type: "invalid_request_error" } }),
    });
    const proxy = await createAnthropicChatProxy({
      provider: { apiKeyEnv: "DEEPSEEK_API_KEY" },
      env: { DEEPSEEK_API_KEY: "secret" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      port: 0,
    });

    try {
      const response = await fetch(`${proxy.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "ping" }] }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: { type: "invalid_request_error", message: "model not found" },
      });
    } finally {
      await proxy.close();
    }
  });
});
