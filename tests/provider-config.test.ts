import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigFileSchema } from "../src/state/config-file-schema.js";
import { loadInstanceConfig } from "../src/runtime/instance-config.js";
import { normalizeProviderConfig } from "../src/provider/provider-config.js";
import { createProviderPreset } from "../src/provider/provider-presets.js";
import { removeTempRoot } from "./helpers/temp-files.js";

describe("normalizeProviderConfig", () => {
  it("fills native defaults", () => {
    expect(normalizeProviderConfig(undefined)).toEqual({
      kind: "native",
      name: undefined,
      model: undefined,
      baseUrl: undefined,
      apiKeyEnv: undefined,
      temperature: undefined,
      thinking: { enabled: undefined, effort: undefined },
      timeoutMs: 3600000,
      inactivityTimeoutMs: 1800000,
      retries: { maxAttempts: 1, baseDelayMs: 1000, maxDelayMs: 10000 },
      extraEnv: {},
      extraArgs: [],
      command: undefined,
      args: undefined,
    });
  });

  it("accepts DeepSeek openai-compatible config", () => {
    const config = normalizeProviderConfig({
      kind: "openai-compatible",
      name: "deepseek",
      model: "deepseek-chat",
      baseUrl: "https://api.deepseek.com",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      temperature: 0.2,
      thinking: { enabled: true, effort: "medium" },
      timeoutMs: 1800000,
      inactivityTimeoutMs: 300000,
      retries: { maxAttempts: 2 },
    });

    expect(config.model).toBe("deepseek-chat");
    expect(config.temperature).toBe(0.2);
    expect(config.thinking.effort).toBe("medium");
    expect(config.retries.maxAttempts).toBe(2);
    expect(config.retries.baseDelayMs).toBe(1000);
    expect(config.retries.maxDelayMs).toBe(10000);
  });

  it("allows provider in config file schema", () => {
    const result = ConfigFileSchema.safeParse({
      provider: {
        kind: "openai-compatible",
        model: "deepseek-chat",
        temperature: 0.2,
        thinking: { effort: "medium" },
        retries: { maxAttempts: 2 },
      },
    });

    expect(result.success).toBe(true);
  });

  it.each(["deepseek", "openai-compatible", "anthropic-compatible"] as const)(
    "allows provider kind %s in config file schema",
    (kind) => {
      const result = ConfigFileSchema.safeParse({
        provider: {
          kind,
          model: "deepseek-v4-flash",
          baseUrl: "https://api.deepseek.com",
        },
      });

      expect(result.success).toBe(true);
    },
  );

  it("keeps old provider config shapes backward compatible", () => {
    const config = normalizeProviderConfig({
      model: "legacy-model",
      baseUrl: "https://legacy.example/v1",
    });

    expect(config).toMatchObject({
      kind: "native",
      model: "legacy-model",
      baseUrl: "https://legacy.example/v1",
    });
  });

  it("loads provider config into instance config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "provider-config-"));

    try {
      await writeFile(
        path.join(root, "config.json"),
        JSON.stringify({
          provider: {
            kind: "openai-compatible",
            name: "deepseek",
            model: "deepseek-chat",
            temperature: 0.2,
            thinking: { enabled: true, effort: "medium" },
            retries: { maxAttempts: 2 },
          },
        }),
        "utf8",
      );

      const config = await loadInstanceConfig(root);

      expect(config.provider.kind).toBe("openai-compatible");
      expect(config.provider.name).toBe("deepseek");
      expect(config.provider.model).toBe("deepseek-chat");
      expect(config.provider.temperature).toBe(0.2);
      expect(config.provider.thinking).toEqual({ enabled: true, effort: "medium" });
      expect(config.provider.retries).toEqual({ maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 10000 });
    } finally {
      await removeTempRoot(root);
    }
  });
});

describe("createProviderPreset", () => {
  it("creates DeepSeek defaults for Codex through an OpenAI-compatible provider", () => {
    expect(createProviderPreset("codex", "deepseek")).toMatchObject({
      kind: "openai-compatible",
      name: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    });
  });

  it("creates DeepSeek defaults for native DeepSeek engine", () => {
    expect(createProviderPreset("deepseek", "deepseek")).toMatchObject({
      kind: "deepseek",
      name: "deepseek",
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    });
  });

  it("creates an Anthropic-compatible provider for Claude through router", () => {
    expect(createProviderPreset("claude", "deepseek")).toMatchObject({
      kind: "anthropic-compatible",
      name: "deepseek-via-router",
      model: "deepseek-v4-flash",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    });
  });
});
