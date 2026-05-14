import { describe, expect, it, vi } from "vitest";
import {
  dispatchLocalCommand,
  handleEngineLocalCommand,
  handleProviderLocalCommand,
} from "../src/runtime/local-commands/dispatch.js";

function makeHandlers(overrides: Partial<Parameters<typeof dispatchLocalCommand>[2]> = {}) {
  const sendReply = overrides.sendReply ?? vi.fn().mockResolvedValue({ messageId: "m1" });
  const updateInstanceConfig = overrides.updateInstanceConfig ?? vi.fn(async (updater: (cfg: Record<string, unknown>) => void) => updater({} as Record<string, unknown>));
  const clearSessions = overrides.clearSessions ?? vi.fn().mockResolvedValue({ ok: true });
  return { sendReply, updateInstanceConfig, clearSessions };
}

describe("dispatchLocalCommand", () => {
  it("returns false for non-command text", async () => {
    const handlers = makeHandlers();
    const handled = await dispatchLocalCommand("hello", {
      locale: "zh",
      currentEngine: "deepseek",
      currentProvider: {},
    }, handlers);
    expect(handled).toBe(false);
    expect(handlers.sendReply).not.toHaveBeenCalled();
  });

  it("routes /engine to engine handler", async () => {
    const handlers = makeHandlers();
    const handled = await dispatchLocalCommand("/engine", {
      locale: "zh",
      currentEngine: "deepseek",
      currentProvider: {},
    }, handlers);
    expect(handled).toBe(true);
    expect(handlers.sendReply).toHaveBeenCalledWith(expect.stringContaining("当前引擎"));
  });

  it("routes /provider to provider handler", async () => {
    const handlers = makeHandlers();
    const handled = await dispatchLocalCommand("/provider", {
      locale: "zh",
      currentEngine: "deepseek",
      currentProvider: { kind: "deepseek", name: "deepseek" },
    }, handlers);
    expect(handled).toBe(true);
    expect(handlers.sendReply).toHaveBeenCalledWith(expect.stringContaining("当前 provider"));
  });
});

describe("handleEngineLocalCommand", () => {
  it("switches engine and clears sessions on success", async () => {
    const config: Record<string, unknown> = { engine: "codex", model: "gpt-5.5" };
    const handlers = makeHandlers({
      updateInstanceConfig: async (updater) => updater(config),
    });

    const handled = await handleEngineLocalCommand("/engine deepseek", {
      locale: "zh",
      currentEngine: "codex",
      currentProvider: {},
    }, handlers);

    expect(handled).toBe(true);
    expect(handlers.clearSessions).toHaveBeenCalledOnce();
    expect(config.engine).toBe("deepseek");
    expect(config.model).toBeUndefined();
    expect(handlers.sendReply).toHaveBeenCalledWith(expect.stringContaining("deepseek"));
  });

  it("rejects invalid engine names", async () => {
    const handlers = makeHandlers();
    const handled = await handleEngineLocalCommand("/engine gpt", {
      locale: "zh",
      currentEngine: "codex",
      currentProvider: {},
    }, handlers);
    expect(handled).toBe(true);
    expect(handlers.clearSessions).not.toHaveBeenCalled();
    expect(handlers.updateInstanceConfig).not.toHaveBeenCalled();
    expect(handlers.sendReply).toHaveBeenCalledWith(expect.stringContaining("用法"));
  });

  it("returns false for non-engine text", async () => {
    const handlers = makeHandlers();
    const handled = await handleEngineLocalCommand("hello", {
      locale: "zh",
      currentEngine: "codex",
      currentProvider: {},
    }, handlers);
    expect(handled).toBe(false);
  });

  it("does not change config when clearSessions fails", async () => {
    let configWritten = false;
    const handlers = makeHandlers({
      clearSessions: vi.fn().mockResolvedValue({ ok: false, error: new Error("locked") }),
      updateInstanceConfig: async () => { configWritten = true; },
    });

    const handled = await handleEngineLocalCommand("/engine claude", {
      locale: "zh",
      currentEngine: "codex",
      currentProvider: {},
    }, handlers);

    expect(handled).toBe(true);
    expect(configWritten).toBe(false);
    expect(handlers.sendReply).toHaveBeenCalledWith(expect.stringContaining("未能切换"));
  });
});

describe("handleProviderLocalCommand", () => {
  it("sets deepseek preset for current engine", async () => {
    const config: Record<string, unknown> = { engine: "codex" };
    const handlers = makeHandlers({
      updateInstanceConfig: async (updater) => updater(config),
    });

    const handled = await handleProviderLocalCommand("/provider deepseek", {
      locale: "zh",
      currentEngine: "codex",
      currentProvider: { kind: "native" },
    }, handlers);

    expect(handled).toBe(true);
    expect(config.provider).toMatchObject({
      kind: "openai-compatible",
      name: "deepseek",
      model: "deepseek-v4-flash",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    });
    expect(handlers.sendReply).toHaveBeenCalledWith(expect.stringContaining("provider 已设为"));
  });

  it("sets deepseek native preset for deepseek engine", async () => {
    const config: Record<string, unknown> = { engine: "deepseek" };
    const handlers = makeHandlers({
      updateInstanceConfig: async (updater) => updater(config),
    });

    await handleProviderLocalCommand("/provider deepseek", {
      locale: "zh",
      currentEngine: "deepseek",
      currentProvider: { kind: "native" },
    }, handlers);

    expect(config.provider).toMatchObject({
      kind: "deepseek",
      model: "deepseek-v4-flash",
    });
  });

  it("sets explicit openai-compatible provider with custom baseUrl/model", async () => {
    const config: Record<string, unknown> = { engine: "codex" };
    const handlers = makeHandlers({
      updateInstanceConfig: async (updater) => updater(config),
    });

    await handleProviderLocalCommand("/provider openai-compatible https://router.example/v1 deepseek-v4-flash", {
      locale: "zh",
      currentEngine: "codex",
      currentProvider: { kind: "native" },
    }, handlers);

    expect(config.provider).toMatchObject({
      kind: "openai-compatible",
      baseUrl: "https://router.example/v1",
      model: "deepseek-v4-flash",
      apiKeyEnv: "OPENAI_API_KEY",
    });
  });

  it("infers DEEPSEEK_API_KEY when baseUrl contains deepseek", async () => {
    const config: Record<string, unknown> = { engine: "codex" };
    const handlers = makeHandlers({
      updateInstanceConfig: async (updater) => updater(config),
    });

    await handleProviderLocalCommand("/provider openai-compatible https://api.deepseek.com deepseek-chat", {
      locale: "zh",
      currentEngine: "codex",
      currentProvider: { kind: "native" },
    }, handlers);

    expect((config.provider as Record<string, unknown>).apiKeyEnv).toBe("DEEPSEEK_API_KEY");
  });

  it("returns false for non-provider text", async () => {
    const handlers = makeHandlers();
    const handled = await handleProviderLocalCommand("hello", {
      locale: "zh",
      currentEngine: "codex",
      currentProvider: {},
    }, handlers);
    expect(handled).toBe(false);
  });
});
