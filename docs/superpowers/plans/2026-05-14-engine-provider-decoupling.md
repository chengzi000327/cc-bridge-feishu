# Engine Provider Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在 0514 方案基础上把 `engine` 和 `provider` 彻底解耦，使 `codex`、`claude`、`deepseek` 三种 engine 都可以按各自能力接入 DeepSeek 或兼容 provider，并让 Railway 环境变量只作为首次初始化默认值。

**Architecture:** `config.json` 是运行时真实状态，Railway env 只在缺失配置时初始化。`engine` 决定执行器：Codex CLI、Claude Code CLI 或原生 DeepSeek adapter；`provider` 决定模型服务协议和连接参数。Codex 访问 DeepSeek 时通过本地 Responses-to-Chat proxy 适配协议；Claude 访问 DeepSeek 时通过 Anthropic Messages-to-Chat proxy 或外部 Anthropic-compatible router 适配协议。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、Zod、Codex CLI Responses API、Claude Code Anthropic Messages API、DeepSeek Chat Completions API、Railway Docker 部署、Feishu HTTP webhook。

---

## 0514 审核结论

用户给出的 7 个任务方向正确，但当前仓库已经有一部分基础能力，不建议从零重做：

- `src/state/config-file-schema.ts` 已允许 `engine: "codex" | "claude" | "deepseek"`，并已挂载 `provider` schema。
- `src/provider/provider-config.ts` 已支持 `native`、`deepseek`、`openai-compatible`、`anthropic-compatible`、`command-template`。
- `src/deepseek/adapter.ts` 已有原生 DeepSeek adapter 雏形，`src/service.ts` 已能在 `engine === "deepseek"` 时创建它。
- `src/codex/process-adapter.ts` 已会把 provider 映射成 Codex 的 `model_provider` / `wire_api="responses"` 参数，但直接指向 `https://api.deepseek.com` 会撞上 DeepSeek 只支持 `/chat/completions` 的协议差异。
- `src/index.ts` 的 `bootstrapFeishuRailwayState()` 仍有高风险行为：`FEISHU_ENGINE=claude` 会覆盖既有 `config.json`，并删除 `provider`、`model`、`effort`。这正是线上配置被 env 反复覆盖的来源。
- `src/telegram/engine-commands.ts` 当前命令层只接受 `claude | codex`，没有 `deepseek`，也没有 `/provider`。

因此实施顺序调整为：

1. 先修 Railway 启动自愈，不再覆盖既有 `config.json`。
2. 补齐命令层，让 `engine=deepseek` 和 `provider` 可运行时写入配置。
3. 加强 `deepseek` 原生 engine，作为最稳定兜底链路。
4. 新增 Codex Responses → DeepSeek Chat proxy。
5. 新增 Claude Anthropic Messages → DeepSeek Chat proxy 或接入外部 router。
6. 最后跑三条链路的 Feishu 私聊、群聊、未授权、超时、错误和重启保持验证。

## 目标配置形态

`config.json` 中 `engine` 和 `provider` 必须分层：

```json
{
  "engine": "codex",
  "provider": {
    "kind": "openai-compatible",
    "name": "deepseek",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash",
    "apiKeyEnv": "DEEPSEEK_API_KEY"
  }
}
```

三条目标组合：

```json
{ "engine": "codex", "provider": { "kind": "openai-compatible", "name": "deepseek" } }
```

```json
{ "engine": "claude", "provider": { "kind": "anthropic-compatible", "name": "deepseek-via-router" } }
```

```json
{ "engine": "deepseek", "provider": { "kind": "deepseek", "name": "deepseek" } }
```

Railway 默认变量保留：

```bash
FEISHU_ENGINE=codex
FEISHU_PROVIDER=deepseek
DEEPSEEK_API_KEY=...
```

约束：

- 仅当 `config.json` 不存在时，才用 `FEISHU_ENGINE` / `FEISHU_PROVIDER` 初始化默认配置。
- `config.json` 存在后，运行时以 `/engine`、`/provider` 写入的内容为准。
- 切换 engine 时清理不兼容的会话绑定，并明确提示“重启后生效”或后续实现热 reload。
- API key 只通过 `apiKeyEnv` 间接引用，不写入配置文件。

## 文件结构

- Create: `src/config/feishu-railway-bootstrap.ts`  
  从 `src/index.ts` 抽出 Railway 初始化逻辑，便于单元测试，并修复 env 覆盖既有配置的问题。
- Create: `src/provider/provider-presets.ts`  
  维护 `deepseek`、`openai-compatible`、`anthropic-compatible` 的默认 provider 模板。
- Create: `src/telegram/provider-commands.ts`  
  实现 `/provider` 查询和切换命令。
- Create: `tests/feishu-railway-bootstrap.test.ts`
- Create: `tests/telegram-provider-commands.test.ts`
- Create: `tests/deepseek-adapter.test.ts`
- Create: `src/provider/responses-chat-transform.ts`
- Create: `src/provider/responses-chat-proxy.ts`
- Create: `tests/responses-chat-proxy.test.ts`
- Create: `src/provider/anthropic-chat-transform.ts`
- Create: `src/provider/anthropic-chat-proxy.ts`
- Create: `tests/anthropic-chat-proxy.test.ts`
- Modify: `src/index.ts`
- Modify: `src/service.ts`
- Modify: `src/telegram/engine-commands.ts`
- Modify: `src/telegram/authorized-dispatch.ts` 或当前本地命令分发入口
- Modify: `src/codex/process-adapter.ts`
- Modify: `src/codex/claude-adapter.ts`
- Modify: `src/state/config-file-schema.ts`
- Modify: `src/provider/provider-config.ts`
- Modify: `Dockerfile`
- Modify: `README.zh-CN.md`

## Task 1: 修复 Railway env 覆盖运行时配置

**Files:**
- Create: `src/config/feishu-railway-bootstrap.ts`
- Modify: `src/index.ts`
- Test: `tests/feishu-railway-bootstrap.test.ts`

- [x] **Step 1: 写失败测试：既有 config 不被 FEISHU_ENGINE 覆盖**

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bootstrapFeishuRailwayState } from "../src/config/feishu-railway-bootstrap.js";

describe("bootstrapFeishuRailwayState", () => {
  it("does not overwrite an existing runtime config with FEISHU_ENGINE", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "feishu-bootstrap-"));
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
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/feishu-railway-bootstrap.test.ts`

Expected: FAIL，提示找不到 `src/config/feishu-railway-bootstrap.js` 或既有配置被覆盖。

- [x] **Step 3: 抽出 bootstrap 并只在 config 缺失时初始化 engine/provider**

`src/config/feishu-railway-bootstrap.ts` 提供：

```ts
export interface FeishuRailwayBootstrapInput {
  stateDir: string;
  codexHome?: string;
  claudeConfigDir?: string;
  engine?: string;
  provider?: string;
  allowedChatIds?: string;
  allowedGroupChatIds?: string;
  allowedUserIds?: string;
  hasDeepseekKey: boolean;
}

export async function bootstrapFeishuRailwayState(input: FeishuRailwayBootstrapInput): Promise<void> {
  // 从 src/index.ts 迁移现有目录、access.json、groupMode 初始化逻辑。
  // 关键规则：existingConfig 存在时，不根据 FEISHU_ENGINE / FEISHU_PROVIDER 改写 engine/provider。
  // config.json 不存在时，才根据 env 生成默认配置。
}
```

默认配置规则：

- `FEISHU_ENGINE=deepseek` 且 `FEISHU_PROVIDER=deepseek`：初始化 `engine: "deepseek"`、`provider.kind: "deepseek"`。
- `FEISHU_ENGINE=codex` 且 `FEISHU_PROVIDER=deepseek`：初始化 `engine: "codex"`、`provider.kind: "openai-compatible"`，后续由本地 Responses proxy 接管。
- `FEISHU_ENGINE=claude` 且 `FEISHU_PROVIDER=deepseek`：初始化 `engine: "claude"`、`provider.kind: "anthropic-compatible"`。
- 未设置 `FEISHU_ENGINE` 时默认 `codex`。
- 没有 `DEEPSEEK_API_KEY` 时不自动写入 DeepSeek provider。

- [x] **Step 4: 修改 `src/index.ts` 使用抽出的 bootstrap**

保留原调用点，但传入 `provider: process.env.FEISHU_PROVIDER`。

- [x] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/feishu-railway-bootstrap.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/config/feishu-railway-bootstrap.ts src/index.ts tests/feishu-railway-bootstrap.test.ts
git commit -m "fix: preserve runtime config during Feishu Railway bootstrap"
```

## Task 2: 配置模型分层和 provider presets

**Files:**
- Create: `src/provider/provider-presets.ts`
- Modify: `src/provider/provider-config.ts`
- Modify: `src/state/config-file-schema.ts`
- Test: `tests/provider-config.test.ts`

- [x] **Step 1: 写 provider preset 测试**

```ts
import { describe, expect, it } from "vitest";
import { createProviderPreset } from "../src/provider/provider-presets.js";

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
```

- [x] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/provider-config.test.ts`

Expected: FAIL，提示找不到 `provider-presets.js`。

- [x] **Step 3: 实现 provider presets**

`src/provider/provider-presets.ts`：

```ts
import type { ProviderConfig } from "./provider-config.js";

export type EngineName = "codex" | "claude" | "deepseek";
export type ProviderPresetName = "deepseek";

export function createProviderPreset(engine: EngineName, provider: ProviderPresetName): Partial<ProviderConfig> {
  if (provider !== "deepseek") {
    throw new Error(`Unsupported provider preset: ${provider}`);
  }

  if (engine === "claude") {
    return {
      kind: "anthropic-compatible",
      name: "deepseek-via-router",
      baseUrl: "http://127.0.0.1:3456",
      model: "deepseek-v4-flash",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      temperature: 0.2,
      thinking: { enabled: true, effort: "medium" },
      timeoutMs: 1_800_000,
      inactivityTimeoutMs: 300_000,
      retries: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 10_000 },
    };
  }

  return {
    kind: engine === "deepseek" ? "deepseek" : "openai-compatible",
    name: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    temperature: 0.2,
    thinking: { enabled: true, effort: "medium" },
    timeoutMs: 1_800_000,
    inactivityTimeoutMs: 300_000,
    retries: { maxAttempts: 2, baseDelayMs: 1000, maxDelayMs: 10_000 },
  };
}
```

- [x] **Step 4: 收紧 schema 文档化，不破坏向后兼容**

保持 `ProviderConfigSchema.passthrough()`，但新增测试覆盖：

- `provider.kind = "deepseek"` 可通过。
- `provider.kind = "openai-compatible"` 可通过。
- `provider.kind = "anthropic-compatible"` 可通过。
- 老配置只有 `model` / `baseUrl` 时仍可 normalize。

- [x] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/provider-config.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/provider/provider-presets.ts src/provider/provider-config.ts src/state/config-file-schema.ts tests/provider-config.test.ts
git commit -m "feat: add engine-aware provider presets"
```

## Task 3: 命令层支持 `/engine deepseek` 和 `/provider`

**Files:**
- Modify: `src/telegram/engine-commands.ts`
- Create: `src/telegram/provider-commands.ts`
- Modify: `src/telegram/authorized-dispatch.ts` 或当前命令分发入口
- Test: `tests/telegram-engine-commands.test.ts`
- Test: `tests/telegram-provider-commands.test.ts`

- [x] **Step 1: 写 `/engine deepseek` 测试**

在 `tests/telegram-engine-commands.test.ts` 增加：

```ts
it("switches to the native deepseek engine", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "telegram-engine-commands-"));
  const sendMessage = vi.fn().mockResolvedValue({ messageId: "m1" });
  const clearAll = vi.fn().mockResolvedValue(1);

  const handled = await handleLocalEngineTelegramCommand({
    stateDir: root,
    startedAt: Date.now(),
    locale: "zh",
    cfg: { engine: "codex" },
    normalized: createNormalizedMessage("/engine deepseek"),
    context: createContext({ sendMessage }),
    bridge: createBridge(),
    sessionStore: { clearAll, removeByChatId: vi.fn() },
    updateInstanceConfig: async (updater) => {
      const config: Record<string, unknown> = { engine: "codex", model: "gpt-5.5" };
      updater(config);
      expect(config.engine).toBe("deepseek");
      expect(config.model).toBeUndefined();
    },
  });

  expect(handled).toBe(true);
  expect(clearAll).toHaveBeenCalledTimes(1);
  expect(sendMessage).toHaveBeenCalledWith(expect.any(Number), expect.stringContaining("deepseek"));
});
```

- [x] **Step 2: 写 `/provider` 测试**

`tests/telegram-provider-commands.test.ts`：

```ts
import { describe, expect, it, vi } from "vitest";
import { handleProviderTelegramCommand } from "../src/telegram/provider-commands.js";

describe("handleProviderTelegramCommand", () => {
  it("sets DeepSeek provider using engine-aware preset", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: "m1" });
    let written: Record<string, unknown> = { engine: "codex" };

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
    let written: Record<string, unknown> = { engine: "codex" };

    await handleProviderTelegramCommand({
      locale: "zh",
      text: "/provider openai-compatible https://router.example/v1 deepseek-v4-flash",
      currentEngine: "codex",
      currentProvider: { kind: "native" },
      sendMessage: vi.fn().mockResolvedValue({ messageId: "m1" }),
      chatId: 123,
      updateInstanceConfig: async (updater) => updater(written),
    });

    expect(written.provider).toMatchObject({
      kind: "openai-compatible",
      name: "openai-compatible",
      baseUrl: "https://router.example/v1",
      model: "deepseek-v4-flash",
    });
  });
});
```

- [x] **Step 3: 运行测试确认失败**

Run:

```bash
npx vitest run tests/telegram-engine-commands.test.ts tests/telegram-provider-commands.test.ts
```

Expected: FAIL，`deepseek` 被判为非法，且 `provider-commands.js` 不存在。

- [x] **Step 4: 扩展 engine 命令**

把 `EngineCommandConfig.engine`、`renderEngineSwitchMessage()` 和校验分支全部扩到：

```ts
type EngineName = "codex" | "claude" | "deepseek";
```

帮助文案列出：

```text
/engine codex
/engine claude
/engine deepseek
```

- [x] **Step 5: 实现 provider 命令**

支持：

```text
/provider
/provider deepseek
/provider openai-compatible <baseUrl> <model>
/provider anthropic-compatible <baseUrl> <model>
```

写入规则：

- `/provider deepseek` 调用 `createProviderPreset(currentEngine, "deepseek")`。
- `openai-compatible` 默认 `apiKeyEnv = "OPENAI_API_KEY"`，如果 `baseUrl` 包含 `deepseek`，默认 `apiKeyEnv = "DEEPSEEK_API_KEY"`。
- `anthropic-compatible` 默认 `apiKeyEnv = "ANTHROPIC_API_KEY"`，如果 `baseUrl` 是本地 router 或名称 deepseek，默认 `apiKeyEnv = "DEEPSEEK_API_KEY"`。
- 切换 provider 后提示“重启此实例后生效”。

- [x] **Step 6: 把 `/provider` 接入本地命令分发**

在当前处理 `/engine`、`/compact`、`/context`、`/ultrareview` 的同一层优先拦截 `/provider`，避免转发给 engine。

- [x] **Step 7: 运行测试确认通过**

Run:

```bash
npx vitest run tests/telegram-engine-commands.test.ts tests/telegram-provider-commands.test.ts tests/service.test.ts
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/telegram/engine-commands.ts src/telegram/provider-commands.ts tests/telegram-engine-commands.test.ts tests/telegram-provider-commands.test.ts
git commit -m "feat: support runtime engine and provider switching"
```

## Task 4: 加强 `engine=deepseek` 原生兜底链路

**Files:**
- Modify: `src/deepseek/adapter.ts`
- Test: `tests/deepseek-adapter.test.ts`
- Modify: `src/service.ts`

- [x] **Step 1: 写 DeepSeek adapter 测试**

```ts
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
      }),
      { DEEPSEEK_API_KEY: "secret" },
      fetchImpl as unknown as typeof fetch,
    );

    const response = await adapter.sendUserMessage("deepseek-1", {
      text: "hello",
      files: [],
      instructions: "用中文回复",
    });

    expect(response.text).toBe("你好");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.deepseek.com/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer secret" }),
      }),
    );
  });
});
```

- [x] **Step 2: 运行测试**

Run: `npx vitest run tests/deepseek-adapter.test.ts`

Expected: 当前代码大概率 PASS；如失败，按失败点补齐。

- [x] **Step 3: 补齐错误和超时行为**

确保：

- 缺少 `DEEPSEEK_API_KEY` 时错误信息包含 env 名。
- DeepSeek 返回 `{ error: { message } }` 时抛出可分类错误。
- 空 `choices` 时抛出 `DeepSeek returned no visible reply`。
- `input.abortSignal` 透传到 fetch。

- [x] **Step 4: 确认 service 创建 DeepSeekAdapter 时读取最新 provider**

检查 `src/service.ts` 的 `createAdapterFactory()`：

```ts
if (engine === "deepseek") {
  return new DeepSeekAdapter(provider, childEnv);
}
```

如果已存在，只补测试覆盖；不要重构无关逻辑。

- [x] **Step 5: 运行测试确认通过**

Run:

```bash
npx vitest run tests/deepseek-adapter.test.ts tests/service.test.ts tests/provider-retry.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/deepseek/adapter.ts src/service.ts tests/deepseek-adapter.test.ts
git commit -m "test: cover native deepseek engine adapter"
```

## Task 5: Codex Responses API 到 DeepSeek Chat proxy

**Files:**
- Create: `src/provider/responses-chat-transform.ts`
- Create: `src/provider/responses-chat-proxy.ts`
- Modify: `src/service.ts`
- Modify: `src/codex/process-adapter.ts`
- Test: `tests/responses-chat-proxy.test.ts`
- Test: `tests/process-adapter.test.ts`

- [x] **Step 1: 写 transform 测试**

```ts
import { describe, expect, it } from "vitest";
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

  it("maps DeepSeek chat completion back to a Responses-like payload", () => {
    expect(chatCompletionToResponses({
      id: "chat-1",
      choices: [{ message: { content: "你好" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    })).toMatchObject({
      id: "chat-1",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "你好" }] }],
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
    });
  });
});
```

- [x] **Step 2: 写 proxy HTTP 测试**

```ts
import { describe, expect, it, vi } from "vitest";
import { createResponsesChatProxy } from "../src/provider/responses-chat-proxy.js";

describe("createResponsesChatProxy", () => {
  it("serves /v1/responses and forwards to DeepSeek chat completions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
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
      expect(fetchImpl).toHaveBeenCalledWith(
        "https://api.deepseek.com/chat/completions",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      await proxy.close();
    }
  });
});
```

- [x] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/responses-chat-proxy.test.ts`

Expected: FAIL，目标文件不存在。

- [x] **Step 4: 实现 Responses transform**

最低支持：

- `input` 为 string。
- `input` 为 Responses item 数组，提取 `message.content[].text`。
- `instructions` 映射为 system message。
- DeepSeek usage 映射为 Responses usage。
- 非流式优先，`stream: false`。

- [x] **Step 5: 实现本地 HTTP proxy**

`createResponsesChatProxy()` 返回：

```ts
export interface ResponsesChatProxyHandle {
  baseUrl: string;
  close(): Promise<void>;
}
```

路由：

- `GET /health` 返回 `200 ok`。
- `POST /v1/responses` 转发到 `${provider.baseUrl}/chat/completions`。
- 缺 API key 返回 500，并说明缺少 `apiKeyEnv`。
- DeepSeek 非 2xx 时保留状态码和错误消息。

- [x] **Step 6: 在 service 中为 `codex + deepseek/openai-compatible` 启动 proxy**

当 `engine === "codex"` 且 `provider.kind === "openai-compatible"` 且 `provider.name === "deepseek"` 时：

- 启动本地 proxy。
- 把传给 Codex adapter 的 provider 改成：

```json
{
  "kind": "openai-compatible",
  "name": "deepseek",
  "baseUrl": "http://127.0.0.1:<internal-port>/v1",
  "model": "deepseek-v4-flash",
  "apiKeyEnv": "DEEPSEEK_API_KEY"
}
```

Codex 仍使用：

```toml
model_provider = "deepseek"
model_providers.deepseek.base_url = "http://127.0.0.1:<internal-port>/v1"
model_providers.deepseek.wire_api = "responses"
```

- [x] **Step 7: 运行测试确认通过**

Run:

```bash
npx vitest run tests/responses-chat-proxy.test.ts tests/process-adapter.test.ts tests/service.test.ts
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/provider/responses-chat-transform.ts src/provider/responses-chat-proxy.ts src/service.ts src/codex/process-adapter.ts tests/responses-chat-proxy.test.ts tests/process-adapter.test.ts
git commit -m "feat: proxy Codex responses requests to DeepSeek chat"
```

## Task 6: Claude Anthropic-compatible router

**Files:**
- Create: `src/provider/anthropic-chat-transform.ts`
- Create: `src/provider/anthropic-chat-proxy.ts`
- Modify: `src/service.ts`
- Modify: `src/codex/claude-adapter.ts`
- Test: `tests/anthropic-chat-proxy.test.ts`
- Test: `tests/claude-adapter.test.ts`

- [x] **Step 1: 写 Anthropic Messages transform 测试**

```ts
import { describe, expect, it } from "vitest";
import { anthropicMessagesToChat, chatCompletionToAnthropicMessage } from "../src/provider/anthropic-chat-transform.js";

describe("anthropic-chat-transform", () => {
  it("maps Anthropic messages to DeepSeek chat completions", () => {
    expect(anthropicMessagesToChat({
      model: "deepseek-v4-flash",
      system: "用中文回复",
      messages: [{ role: "user", content: "你好" }],
      temperature: 0.2,
      max_tokens: 1024,
    })).toEqual({
      model: "deepseek-v4-flash",
      messages: [
        { role: "system", content: "用中文回复" },
        { role: "user", content: "你好" },
      ],
      temperature: 0.2,
      max_tokens: 1024,
      stream: false,
    });
  });

  it("maps chat completion back to Anthropic message shape", () => {
    expect(chatCompletionToAnthropicMessage({
      choices: [{ message: { content: "你好" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 2 },
    }, "deepseek-v4-flash")).toMatchObject({
      type: "message",
      role: "assistant",
      model: "deepseek-v4-flash",
      content: [{ type: "text", text: "你好" }],
      usage: { input_tokens: 1, output_tokens: 2 },
    });
  });
});
```

- [x] **Step 2: 写 proxy 测试**

```ts
import { describe, expect, it, vi } from "vitest";
import { createAnthropicChatProxy } from "../src/provider/anthropic-chat-proxy.js";

describe("createAnthropicChatProxy", () => {
  it("serves /v1/messages and forwards to DeepSeek chat completions", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
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
        body: JSON.stringify({ model: "deepseek-v4-flash", messages: [{ role: "user", content: "ping" }] }),
      });
      expect(response.ok).toBe(true);
      expect(fetchImpl).toHaveBeenCalledWith(
        "https://api.deepseek.com/chat/completions",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      await proxy.close();
    }
  });
});
```

- [x] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/anthropic-chat-proxy.test.ts`

Expected: FAIL，目标文件不存在。

- [x] **Step 4: 实现轻量 Anthropic Messages proxy**

优先内置 Node 服务，不先引入 `claude-code-router` 作为强依赖。这样 Dockerfile 不需要额外安装全局 npm 包，Railway 启动更可控。

最低支持：

- `POST /v1/messages`
- 非流式 `stream: false`
- string content 和 `{ type: "text", text }` content
- `system` string 或 system block 数组
- usage 映射
- 错误状态透传

- [x] **Step 5: Claude adapter 注入 router env**

当 `engine === "claude"` 且 `provider.kind === "anthropic-compatible"` 时，service 启动本地 Anthropic proxy，并向 Claude CLI child env 注入：

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:<internal-port>
ANTHROPIC_AUTH_TOKEN=$DEEPSEEK_API_KEY
```

如果 Claude Code 版本实际读取的变量名不同，优先在 `tests/claude-adapter.test.ts` 中固定本项目使用的 env 映射，再按真实 CLI 行为调整。

- [x] **Step 6: Dockerfile 保持轻量**

暂不安装外部 router。仅当内置 proxy 无法满足 Claude Code 当前协议时，再增加可选路径：

```bash
CLAUDE_ROUTER_COMMAND=claude-code-router
```

并在 README 标注这是 fallback，不作为默认。

- [x] **Step 7: 运行测试确认通过**

Run:

```bash
npx vitest run tests/anthropic-chat-proxy.test.ts tests/claude-adapter.test.ts tests/service.test.ts
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/provider/anthropic-chat-transform.ts src/provider/anthropic-chat-proxy.ts src/service.ts src/codex/claude-adapter.ts tests/anthropic-chat-proxy.test.ts tests/claude-adapter.test.ts
git commit -m "feat: proxy Claude messages requests to DeepSeek chat"
```

## Task 7: Railway 和文档验证

**Files:**
- Modify: `Dockerfile`
- Modify: `railway.toml`
- Modify: `README.zh-CN.md`
- Test: `tests/service.test.ts`
- Test: `tests/webhook-server.test.ts`

- [x] **Step 1: 写 Railway 重启保持测试**

在 `tests/feishu-railway-bootstrap.test.ts` 增加：

```ts
it("keeps config.json as the runtime source of truth across Railway restarts", async () => {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), "feishu-bootstrap-"));
  await bootstrapFeishuRailwayState({
    stateDir,
    engine: "codex",
    provider: "deepseek",
    hasDeepseekKey: true,
  });

  const configPath = path.join(stateDir, "config.json");
  const first = JSON.parse(await readFile(configPath, "utf8"));
  first.engine = "deepseek";
  first.provider = { kind: "deepseek", name: "deepseek", model: "deepseek-v4-flash", apiKeyEnv: "DEEPSEEK_API_KEY" };
  await writeFile(configPath, JSON.stringify(first, null, 2) + "\n");

  await bootstrapFeishuRailwayState({
    stateDir,
    engine: "claude",
    provider: "deepseek",
    hasDeepseekKey: true,
  });

  const second = JSON.parse(await readFile(configPath, "utf8"));
  expect(second.engine).toBe("deepseek");
  expect(second.provider.kind).toBe("deepseek");
});
```

- [x] **Step 2: 更新 README 配置说明**

新增中文说明：

```md
### Engine 与 Provider

`engine` 决定由哪个执行器处理消息：`codex`、`claude` 或 `deepseek`。
`provider` 决定模型服务连接方式：`deepseek`、`openai-compatible`、`anthropic-compatible` 或 `native`。

Railway 环境变量只用于首次初始化；`config.json` 存在后，运行时以 `/engine` 和 `/provider` 写入的配置为准。
```

- [x] **Step 3: 更新 Dockerfile 启动说明**

当前 Dockerfile 已满足要求，无需改动：

- Node 20+ (`FROM node:20-bookworm-slim`)
- Codex CLI / Claude Code CLI 安装逻辑（`npm install -g @openai/codex @anthropic-ai/claude-code`）
- `DEEPSEEK_API_KEY` 通过 Railway env 注入
- 不依赖外部 router

- [x] **Step 4: 运行单元测试**

Run:

```bash
npm test
```

Expected: PASS。

- [x] **Step 5: 运行构建**

Run:

```bash
npm run build
```

Expected: PASS。

- [ ] **Step 6: 手工验收三条链路** *(部分完成 2026-05-14)*

| 链路 | 状态 |
|------|------|
| `engine=deepseek` + `provider.kind=deepseek` | ✅ 在 Railway production 验证通过：私聊、managed group、`@bot` 群聊全部正常 |
| `engine=codex` + `provider.kind=openai-compatible`（DeepSeek 经本地 Responses proxy） | ⏳ 未验证，需要切换 engine 后测试 |
| `engine=claude` + `provider.kind=anthropic-compatible`（DeepSeek 经本地 Anthropic proxy） | ⏳ 未验证，需要切换 engine 后测试，且 Claude CLI 在容器内已通过 gosu drop 解决 root 检查 |

在 Railway 或本地 Feishu HTTP mode 分别验证：

```json
{ "engine": "codex", "provider": { "kind": "openai-compatible", "name": "deepseek" } }
```

```json
{ "engine": "claude", "provider": { "kind": "anthropic-compatible", "name": "deepseek-via-router" } }
```

```json
{ "engine": "deepseek", "provider": { "kind": "deepseek", "name": "deepseek" } }
```

每条链路检查：

- 私聊能回复。
- 群聊 `@` 能回复。
- 未授权用户被拒绝。
- provider 超时有可读错误。
- provider 模型错误进入 runtime/service 日志。
- Railway 重启后 `config.json` 保持 `/engine` 和 `/provider` 切换后的状态。

- [ ] **Step 7: 提交**

```bash
git add Dockerfile railway.toml README.zh-CN.md tests/feishu-railway-bootstrap.test.ts
git commit -m "docs: document engine provider decoupling"
```

## 风险和决策

- Codex CLI 的 `wire_api="responses"` 不能直接打 DeepSeek `/chat/completions`，所以本地 proxy 是必要层，不建议降 Codex 版本绕开。
- Claude Code 的 provider/env 变量可能随版本变化。先用内置 Anthropic-compatible proxy 固定本项目边界，再按真实 CLI 行为补最小适配。
- `engine=deepseek` 是兜底稳定链路，但没有 Codex/Claude 的完整 coding agent 工具协议。本计划把它作为线上可回复优先方案，不把它包装成完整 agent 替代品。
- `provider.kind = "command-template"` 继续保留作为高级逃生口，但不作为 0514 默认路径，避免部署链路过早复杂化。

## 后续 Feishu Hardening 任务

下面是 0514 engine/provider 主线之后必须补的飞书细节。OpenHarness 已经验证过这些边界，当前项目只覆盖了其中一部分：`src/feishu/delivery.ts` 已经有附件文件名清洗和 inbox 目录 containment，但 normalizer、群聊策略、真实文件发送和富文本解析还需要补齐。

详细实施计划已拆到 `docs/superpowers/plans/2026-05-14-feishu-hardening.md`。执行时优先使用那份计划；本节保留为 engine/provider 主线的后续索引。

**状态（2026-05-14 更新）：** Feishu Hardening Task 1-5 已实现并合入 main（mention 解析、群聊唤醒策略、富文本/卡片文本提取、真实图片/文件上传、附件路径安全）。Task 6 真实飞书联调仍需运营侧验证。下方 Task 8-12 仅作历史索引保留，新工作请直接更新 `2026-05-14-feishu-hardening.md`。

## Task 8: 飞书群聊唤醒策略

**Files:**
- Modify: `src/feishu/event-normalizer.ts`
- Modify: `src/feishu/webhook-server.ts`
- Modify: `src/feishu/delivery.ts`
- Test: `tests/feishu-event-normalizer.test.ts`
- Test: `tests/feishu-delivery.test.ts`

- [ ] **Step 1: 定义 Feishu group policy**

新增配置语义：

```ts
export type FeishuGroupPolicy = "managed_or_mention" | "managed_only" | "mention_only" | "all";
```

默认使用 `managed_or_mention`：

- 私聊永远进入授权流程。
- 群聊如果在 `groupMode.allowedChatIds` 中，按现有 managed group 逻辑处理。
- 未 managed 的群聊，只有明确 `@bot` 时才进入授权流程。
- 普通群消息默认忽略，避免机器人被群内噪音误唤醒。

- [ ] **Step 2: 写群聊忽略测试**

覆盖：

- 非 managed 群、无 `@bot`：返回 `ignore` 或 delivery 层不调用 bridge。
- 非 managed 群、有 `@bot`：进入 message。
- managed 群、无 `@bot`：进入 message。
- `group_policy = all`：普通群消息进入 message。

- [ ] **Step 3: 实现策略判断**

不要把 Telegram 的 numeric chat id 假设直接套到 Feishu open chat id。继续使用 `toFeishuBridgeNumericId()` 作为 config 内部兼容 ID，并在测试中固定 hash 行为。

## Task 9: Feishu mention 解析

**Files:**
- Modify: `src/feishu/event-normalizer.ts`
- Modify: `src/transport/types.ts`
- Test: `tests/feishu-event-normalizer.test.ts`

- [ ] **Step 1: 扩展 transport mention 类型**

```ts
export interface BridgeMention {
  openId?: string;
  userId?: string;
  unionId?: string;
  name?: string;
  key?: string;
}
```

`BridgeMessage` 增加：

```ts
mentions?: BridgeMention[];
mentionedBot?: boolean;
```

- [ ] **Step 2: 从 content 和 raw mentions 提取 mention**

Feishu text content 可能包含：

```json
{
  "text": "<at user_id=\"ou_xxx\">BotName</at> hello"
}
```

事件 raw message 也可能带 mentions 数组。需要提取：

- `open_id`
- `user_id`
- `union_id`
- `name`
- mention key / id

- [ ] **Step 3: 判断是否 @ 自己**

normalizer 接收 bot identity：

```ts
{
  botOpenId?: string;
  botUserId?: string;
  botUnionId?: string;
  botName?: string;
}
```

匹配规则：

- 优先匹配 `open_id`、`user_id`、`union_id`。
- 其次匹配 name，name 只作为兜底，避免同名误判。
- 命中后从传给 engine 的 `text` 中移除 bot mention 标记，保留用户真实问题。

## Task 10: Feishu 富文本和卡片文本提取

**Files:**
- Modify: `src/feishu/event-normalizer.ts`
- Test: `tests/feishu-event-normalizer.test.ts`

- [ ] **Step 1: 补 post 文本提取**

不要继续对 `post` content 做 `JSON.stringify(content)`。按 Feishu post 结构提取可读文本：

- `title`
- `content[][]` 中的 `text`
- `a.href`
- `at.user_name`
- `img.image_key` 作为附件或占位

- [ ] **Step 2: 补特殊消息类型**

至少覆盖：

- `interactive`：提取卡片标题、plain_text、markdown。
- `share_chat`：提取群名和 chat id。
- `share_user`：提取用户名和 user id。
- `merge_forward`：提取合并转发摘要。

- [ ] **Step 3: 测试空文本兜底**

如果无法提取文本但有附件，仍然进入附件流程；如果既无文本也无附件，则 ignore。

## Task 11: Feishu 文件和图片真实发送

**Files:**
- Modify: `src/feishu/api.ts`
- Test: `tests/feishu-api.test.ts`

- [ ] **Step 1: 替换 sendFile 文本 fallback**

当前 `sendFile()` 会把文件内容塞进 text 消息：

```text
文件 <filename>

<contents>
```

这只能作为临时兜底。下一步需要实现真实上传：

- 图片走 `/im/v1/images` 上传，发送 `msg_type = image`。
- 普通文件走 `/im/v1/files` 上传，发送 `msg_type = file`。
- 根据 MIME / 扩展名选择 image/file/media。

- [ ] **Step 2: 写上传测试**

覆盖：

- `.png/.jpg/.jpeg/.gif/.webp` 使用 image upload。
- 其他扩展名使用 file upload。
- 上传失败时返回可读错误，不回退到泄漏内容的文本消息。
- 大文件不尝试转成字符串。

- [ ] **Step 3: 支持 reply/thread options**

`BridgeSendOptions.threadId` 在 Feishu 中应映射为 reply 或 thread 发送参数。先按 Feishu 当前 API 能力选最小可行映射，并写测试固定。

## Task 12: Feishu 附件路径安全补强

**Files:**
- Modify: `src/feishu/delivery.ts`
- Modify: `src/feishu/api.ts`
- Test: `tests/feishu-delivery.test.ts`
- Test: `tests/feishu-api.test.ts`

- [ ] **Step 1: 保留并扩展现有 containment**

`src/feishu/delivery.ts` 已经做了：

- `path.basename(attachment.name)`
- 字符白名单清洗
- `path.resolve(inboxDir, filename)`
- `targetPath.startsWith(inboxRoot + path.sep)` containment

后续需要补：

- Windows 保留名处理：`CON`、`PRN`、`AUX`、`NUL`、`COM1`、`LPT1` 等。
- 空扩展 / 超长文件名截断。
- 重名附件自动加后缀，避免覆盖同一条消息内的文件。

- [ ] **Step 2: API 层拒绝目录逃逸 targetPath**

`FeishuApi.downloadAttachment()` 当前信任调用方传入的 `targetPath`。delivery 层已经防住正常路径，但 API 层可以新增可选 `rootDir` 或内部校验工具，测试直接调用 API 时也不能写出允许目录。

- [ ] **Step 3: 增加恶意文件名测试**

覆盖：

- `../../secret.txt`
- `/tmp/secret.txt`
- `subdir/evil.txt`
- `CON`
- 超长文件名
- 同名附件

## 验收标准

- `FEISHU_ENGINE=claude` 不再覆盖既有 `config.json`。
- `/engine codex`、`/engine claude`、`/engine deepseek` 都能写入配置并清理会话绑定。
- `/provider deepseek` 能按当前 engine 写入正确 provider kind。
- Codex + DeepSeek 通过本地 `/v1/responses` proxy 成功调用 DeepSeek `/chat/completions`。
- Claude + DeepSeek 通过本地 `/v1/messages` proxy 或明确配置的 Anthropic-compatible router 成功调用 DeepSeek `/chat/completions`。
- `deepseek` 原生 engine 可以直接回复飞书消息。
- 飞书群聊默认只响应 managed group 或明确 `@bot`。
- 飞书 mention、post、interactive、share_chat、share_user、merge_forward 都能提取可读文本。
- 飞书图片和文件使用真实上传发送，不再长期用文本消息替代文件。
- 飞书附件下载路径不能逃出 inbox，恶意文件名不会覆盖或写入危险路径。
- `npm test` 和 `npm run build` 通过。
