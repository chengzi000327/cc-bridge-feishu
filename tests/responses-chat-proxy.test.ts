import { describe, expect, it, vi } from "vitest";

import { createResponsesChatProxy } from "../src/provider/responses-chat-proxy.js";
import { chatCompletionToResponses, responsesToChatCompletion } from "../src/provider/responses-chat-transform.js";

describe("responses-chat-transform", () => {
  it("maps a simple Responses request to DeepSeek chat completions", () => {
    expect(responsesToChatCompletion({
      model: "deepseek-v4-flash",
      input: "你好",
      instructions: "用中文回复",
      temperature: 0.2,
    })).toEqual({
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: "用中文回复" },
        { role: "user", content: "你好" },
      ],
      temperature: 0.2,
      stream: false,
    });
  });

  it("maps Responses message items to DeepSeek chat completions", () => {
    expect(responsesToChatCompletion({
      model: "deepseek-v4-flash",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "第一段" },
            { type: "input_text", text: "第二段" },
          ],
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "上一轮" }],
        },
      ],
    })).toEqual({
      model: "deepseek-v4-flash",
      messages: [
        { role: "user", content: "第一段\n第二段" },
        { role: "assistant", content: "上一轮" },
      ],
      stream: false,
    });
  });

  it("maps DeepSeek chat completion back to a Responses-like payload", () => {
    expect(chatCompletionToResponses({
      id: "chat-1",
      choices: [{ message: { content: "你好" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    })).toMatchObject({
      id: "chat-1",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "你好" }] }],
      output_text: "你好",
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
    });
  });
});

describe("createResponsesChatProxy", () => {
  it("serves /health", async () => {
    const proxy = await createResponsesChatProxy({
      provider: {
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        apiKeyEnv: "DEEPSEEK_API_KEY",
      },
      env: { DEEPSEEK_API_KEY: "secret" },
      fetchImpl: vi.fn() as unknown as typeof fetch,
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

  it("serves /v1/responses and forwards to DeepSeek chat completions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: "chat-1",
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
      }),
    });
    const proxy = await createResponsesChatProxy({
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
      const response = await fetch(`${proxy.baseUrl}/v1/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "deepseek-v4-flash", input: "ping" }),
      });

      expect(response.ok).toBe(true);
      expect(await response.json()).toMatchObject({
        id: "chat-1",
        output_text: "ok",
        usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
      });
      expect(fetchImpl).toHaveBeenCalledWith(
        "https://api.deepseek.com/chat/completions",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ Authorization: "Bearer secret" }),
          body: JSON.stringify({
            model: "deepseek-v4-flash",
            messages: [{ role: "user", content: "ping" }],
            stream: false,
          }),
        }),
      );
    } finally {
      await proxy.close();
    }
  });

  it("returns a clean error when the provider API key is missing", async () => {
    const fetchImpl = vi.fn();
    const proxy = await createResponsesChatProxy({
      provider: {
        baseUrl: "https://api.deepseek.com",
        model: "deepseek-v4-flash",
        apiKeyEnv: "DEEPSEEK_API_KEY",
      },
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      port: 0,
    });

    try {
      const response = await fetch(`${proxy.baseUrl}/v1/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "deepseek-v4-flash", input: "ping" }),
      });

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: { message: "Missing provider API key env DEEPSEEK_API_KEY" },
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      await proxy.close();
    }
  });

  it("preserves upstream error status and JSON message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: "rate limited" } }),
    });
    const proxy = await createResponsesChatProxy({
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
      const response = await fetch(`${proxy.baseUrl}/v1/responses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "deepseek-v4-flash", input: "ping" }),
      });

      expect(response.status).toBe(429);
      expect(await response.json()).toEqual({ error: { message: "rate limited" } });
    } finally {
      await proxy.close();
    }
  });
});
