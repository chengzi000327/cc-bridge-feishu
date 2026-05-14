import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { bootstrapFeishuRailwayState } from "../src/config/feishu-railway-bootstrap.js";

describe("bootstrapFeishuRailwayState", () => {
  async function createStateDir(): Promise<string> {
    return mkdtemp(path.join(os.tmpdir(), "feishu-bootstrap-"));
  }

  it("does not overwrite an existing runtime config with FEISHU_ENGINE", async () => {
    const stateDir = await createStateDir();
    const configPath = path.join(stateDir, "config.json");
    await writeFile(configPath, JSON.stringify({
      engine: "deepseek",
      provider: { kind: "deepseek", name: "deepseek", model: "deepseek-chat" },
    }, null, 2) + "\n");

    await bootstrapFeishuRailwayState({
      stateDir,
      engine: "claude",
      provider: "deepseek",
      hasDeepseekKey: true,
    });

    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config.engine).toBe("deepseek");
    expect(config.provider).toEqual({ kind: "deepseek", name: "deepseek", model: "deepseek-chat" });
  });

  it("keeps runtime config across Railway restarts", async () => {
    const stateDir = await createStateDir();
    const configPath = path.join(stateDir, "config.json");

    await bootstrapFeishuRailwayState({
      stateDir,
      engine: "codex",
      provider: "deepseek",
      hasDeepseekKey: true,
    });

    const runtimeConfig = {
      engine: "claude",
      model: "claude-runtime-model",
      effort: "high",
      provider: {
        kind: "anthropic-compatible",
        name: "runtime-router",
        model: "runtime-model",
        baseUrl: "https://router.example.test",
      },
    };
    await writeFile(configPath, JSON.stringify(runtimeConfig, null, 2) + "\n");

    await bootstrapFeishuRailwayState({
      stateDir,
      engine: "codex",
      provider: "deepseek",
      hasDeepseekKey: true,
    });

    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config).toEqual(runtimeConfig);
  });

  it.each([
    ["deepseek", "deepseek", "deepseek"],
    ["codex", "openai-compatible", "deepseek"],
    ["claude", "anthropic-compatible", "deepseek-via-router"],
  ] as const)("initializes %s with a DeepSeek provider preset when config is missing", async (engine, providerKind, providerName) => {
    const stateDir = await createStateDir();
    const configPath = path.join(stateDir, "config.json");

    await bootstrapFeishuRailwayState({
      stateDir,
      engine,
      provider: "deepseek",
      hasDeepseekKey: true,
    });

    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config.engine).toBe(engine);
    expect(config.provider).toMatchObject({
      kind: providerKind,
      name: providerName,
      apiKeyEnv: "DEEPSEEK_API_KEY",
    });
  });

  it("does not write a DeepSeek provider when the DeepSeek key is missing", async () => {
    const stateDir = await createStateDir();
    const configPath = path.join(stateDir, "config.json");

    await bootstrapFeishuRailwayState({
      stateDir,
      engine: "codex",
      provider: "deepseek",
      hasDeepseekKey: false,
    });

    const config = JSON.parse(await readFile(configPath, "utf8"));
    expect(config.engine).toBe("codex");
    expect(config.provider).toBeUndefined();
  });
});
