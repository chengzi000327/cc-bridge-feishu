# Feishu Railway Provider Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 `cloveric/cc-telegram-bridge` 复用 Codex CLI / Claude Code CLI 执行核心，将 Telegram 接入口替换为飞书，并支持可配置 provider、模型、温度、思考模式、超时和重试，最终可部署到 Railway 作为 24h 在线助手。

**Architecture:** 先导入上游代码作为基线，不重写执行核心；新增 `src/transport/*` 抽象统一消息和发送接口，再用 `src/feishu/*` 实现飞书事件回调、鉴权、消息解析和回复发送。模型 provider 配置进入实例级 `config.json`，由 Codex / Claude adapter 在每轮执行时读取并映射到 CLI 参数、环境变量和命令模板。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、Zod、Feishu Open Platform HTTP API、Codex CLI、Claude Code CLI、Railway Docker 部署、Railway Volume。

---

## 已确认的上游基线

当前工作区只有 `AGENTS.md`，不是 Git 仓库。上游 `cc-telegram-bridge` 当前 `HEAD` 为 `d0ed8fbbd12203dea7164f613c298c5534068dbe`，主要结构如下：

- `src/codex/process-adapter.ts`：Codex CLI process runtime，当前支持 `model`、`effort`、approval flags、turn timeout。
- `src/codex/app-server-adapter.ts`：Codex app-server runtime。
- `src/codex/claude-adapter.ts` / `src/codex/claude-stream-adapter.ts`：Claude Code CLI runtime，当前支持 `model`、`effort`、permission mode。
- `src/service.ts`：Telegram long polling 服务编排、实例环境、adapter 创建、消息去重、队列、停止任务。
- `src/telegram/*`：Telegram API、update normalizer、命令、交付、文件、审批按钮、群聊逻辑。
- `src/runtime/bridge.ts`、`src/runtime/bridge-turn.ts`、`src/runtime/session-manager.ts`：可复用的核心会话和执行流程。
- `src/state/config-file-schema.ts`、`src/telegram/instance-config.ts`：实例级配置 schema 和读取逻辑。

## 目标配置形态

实例目录仍然使用 `config.json`，但新增 `provider` 配置层。示例：

```json
{
  "engine": "codex",
  "locale": "zh",
  "approvalMode": "full-auto",
  "provider": {
    "kind": "openai-compatible",
    "name": "deepseek",
    "model": "deepseek-chat",
    "baseUrl": "https://api.deepseek.com",
    "apiKeyEnv": "DEEPSEEK_API_KEY",
    "temperature": 0.2,
    "thinking": {
      "enabled": true,
      "effort": "medium"
    },
    "timeoutMs": 1800000,
    "inactivityTimeoutMs": 300000,
    "retries": {
      "maxAttempts": 2,
      "baseDelayMs": 1000,
      "maxDelayMs": 10000
    },
    "extraEnv": {
      "OPENAI_BASE_URL": "https://api.deepseek.com"
    },
    "extraArgs": []
  }
}
```

约束：

- `temperature` 范围为 `0 <= value <= 2`。
- `thinking.enabled` 控制是否向 CLI 传推理/思考参数；`thinking.effort` 可选 `low | medium | high | xhigh | max`。
- `timeoutMs` 是整轮最大运行时间；`inactivityTimeoutMs` 是无输出超时。
- `retries.maxAttempts` 表示最多执行次数，`1` 为不重试。
- `kind = "command-template"` 时允许配置完整命令模板，用于 `claude-code-router`、LiteLLM、OpenRouter 或其他兼容层。

## 文件结构

- Create: `src/transport/types.ts`  
  定义平台无关消息、附件、发送 API、事件去重 ID。
- Create: `src/transport/conversation-key.ts`  
  使用字符串 conversation key，避免继续把 Telegram chat id 当 number。
- Create: `src/transport/message-input.ts`  
  从平台无关 attachment 下载到 inbox，并生成 engine input。
- Create: `src/feishu/crypto.ts`  
  处理飞书 encrypted event 解密。
- Create: `src/feishu/event-normalizer.ts`  
  将飞书 `im.message.receive_v1` 和 URL 校验 challenge 转为内部事件。
- Create: `src/feishu/api.ts`  
  获取 tenant access token、发文本、发文件、下载 message resource。
- Create: `src/feishu/webhook-server.ts`  
  HTTP 服务：`GET /health`、`POST /feishu/events`。
- Create: `src/provider/provider-config.ts`  
  provider schema、默认值、校验和 CLI 映射输入。
- Create: `src/provider/retry.ts`  
  对 engine turn 做可控重试。
- Create: `src/provider/command-template.ts`  
  安全展开命令模板，支持 `{model}`、`{baseUrl}`、`{temperature}`、`{effort}`。
- Create: `tests/feishu-crypto.test.ts`
- Create: `tests/feishu-event-normalizer.test.ts`
- Create: `tests/feishu-api.test.ts`
- Create: `tests/webhook-server.test.ts`
- Create: `tests/provider-config.test.ts`
- Create: `tests/provider-retry.test.ts`
- Create: `railway.toml`
- Modify: `package.json`
- Modify: `Dockerfile`
- Modify: `src/config.ts`
- Modify: `src/types.ts`
- Modify: `src/state/config-file-schema.ts`
- Modify: `src/telegram/instance-config.ts`，后续重命名为 `src/config/instance-config.ts`
- Modify: `src/service.ts`
- Modify: `src/index.ts`
- Modify: `src/codex/process-adapter.ts`
- Modify: `src/codex/app-server-adapter.ts`
- Modify: `src/codex/claude-adapter.ts`
- Modify: `src/codex/claude-stream-adapter.ts`
- Modify: `README.zh-CN.md`

## Task 1: 导入上游代码并建立基线

**Files:**
- Modify: project root
- Test: `package.json`

- [ ] **Step 1: 导入上游仓库**

Run:

```bash
git clone --depth 1 https://github.com/cloveric/cc-telegram-bridge.git /private/tmp/cc-telegram-bridge-import
cp -R /private/tmp/cc-telegram-bridge-import/. .
rm -rf .git
git init
git add .
git commit -m "chore: import cc-telegram-bridge baseline"
```

Expected: 当前目录出现 `src/`、`tests/`、`package.json`、`Dockerfile`，第一次提交只包含上游基线。

- [ ] **Step 2: 安装依赖并验证基线**

Run:

```bash
npm install
npm test
npm run build
```

Expected: `vitest run` 通过，`tsc -p tsconfig.json` 通过。

## Task 2: 增加平台无关 transport 类型

**Files:**
- Create: `src/transport/types.ts`
- Create: `src/transport/conversation-key.ts`
- Test: `tests/transport-types.test.ts`

- [ ] **Step 1: 写 conversation key 测试**

```ts
import { describe, expect, it } from "vitest";
import { getConversationKey } from "../src/transport/conversation-key.js";

describe("getConversationKey", () => {
  it("builds a direct conversation key", () => {
    expect(getConversationKey({ platform: "feishu", chatId: "oc_1", threadId: undefined })).toBe("feishu:oc_1");
  });

  it("builds a thread conversation key", () => {
    expect(getConversationKey({ platform: "feishu", chatId: "oc_1", threadId: "om_2" })).toBe("feishu:oc_1:om_2");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/transport-types.test.ts`

Expected: FAIL，提示找不到 `src/transport/conversation-key.js`。

- [ ] **Step 3: 新增 transport 类型**

`src/transport/types.ts`:

```ts
export type BridgePlatform = "telegram" | "feishu";

export interface BridgeAttachment {
  id: string;
  name?: string;
  kind: "audio" | "document" | "image" | "voice";
  mimeType?: string;
}

export interface BridgeReplyContext {
  messageId: string;
  text: string;
  attachments: BridgeAttachment[];
}

export interface BridgeMessage {
  platform: BridgePlatform;
  updateId: string;
  chatId: string;
  userId: string;
  chatType: "private" | "group";
  threadId?: string;
  conversationKey: string;
  text: string;
  replyContext?: BridgeReplyContext;
  attachments: BridgeAttachment[];
}

export interface BridgeSendOptions {
  threadId?: string;
  disableNotification?: boolean;
  inlineActions?: Array<Array<{ text: string; value: string }>>;
}

export interface BridgeApi {
  sendMessage(chatId: string, text: string, options?: BridgeSendOptions): Promise<{ messageId: string }>;
  sendFile(chatId: string, filename: string, contents: string | Uint8Array, options?: BridgeSendOptions): Promise<{ messageId: string }>;
  downloadAttachment(attachment: BridgeAttachment, targetPath: string): Promise<void>;
}
```

`src/transport/conversation-key.ts`:

```ts
export function getConversationKey(input: { platform: string; chatId: string; threadId?: string }): string {
  return input.threadId ? `${input.platform}:${input.chatId}:${input.threadId}` : `${input.platform}:${input.chatId}`;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/transport-types.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/transport tests/transport-types.test.ts
git commit -m "feat: add platform-neutral transport types"
```

## Task 3: 实现飞书事件 normalizer

**Files:**
- Create: `src/feishu/event-normalizer.ts`
- Test: `tests/feishu-event-normalizer.test.ts`

- [ ] **Step 1: 写飞书消息事件测试**

```ts
import { describe, expect, it } from "vitest";
import { normalizeFeishuEvent } from "../src/feishu/event-normalizer.js";

describe("normalizeFeishuEvent", () => {
  it("returns challenge response", () => {
    expect(normalizeFeishuEvent({ type: "url_verification", challenge: "abc" })).toEqual({
      kind: "challenge",
      challenge: "abc",
    });
  });

  it("normalizes text messages", () => {
    const normalized = normalizeFeishuEvent({
      header: { event_id: "evt_1", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_1" } },
        message: {
          chat_id: "oc_1",
          chat_type: "p2p",
          message_id: "om_1",
          message_type: "text",
          content: "{\"text\":\"你好\"}"
        }
      }
    });

    expect(normalized).toMatchObject({
      kind: "message",
      message: {
        platform: "feishu",
        updateId: "evt_1",
        chatId: "oc_1",
        userId: "ou_1",
        chatType: "private",
        conversationKey: "feishu:oc_1",
        text: "你好",
        attachments: []
      }
    });
  });

  it("normalizes image and file message keys as attachments", () => {
    const normalized = normalizeFeishuEvent({
      header: { event_id: "evt_2", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_1" } },
        message: {
          chat_id: "oc_1",
          chat_type: "group",
          message_id: "om_2",
          message_type: "file",
          content: "{\"file_key\":\"file_v2_1\",\"file_name\":\"report.pdf\"}"
        }
      }
    });

    expect(normalized).toMatchObject({
      kind: "message",
      message: {
        chatType: "group",
        text: "",
        attachments: [{ id: "file_v2_1", name: "report.pdf", kind: "document" }]
      }
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/feishu-event-normalizer.test.ts`

Expected: FAIL，缺少 `normalizeFeishuEvent`。

- [ ] **Step 3: 实现 normalizer**

```ts
import { getConversationKey } from "../transport/conversation-key.js";
import type { BridgeAttachment, BridgeMessage } from "../transport/types.js";

export type NormalizedFeishuEvent =
  | { kind: "challenge"; challenge: string }
  | { kind: "message"; message: BridgeMessage }
  | { kind: "ignore" };

function parseContent(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeText(messageType: string, content: Record<string, unknown>): string {
  if (messageType === "text" && typeof content.text === "string") return content.text;
  if (messageType === "post") return JSON.stringify(content);
  return "";
}

function normalizeAttachments(messageType: string, content: Record<string, unknown>): BridgeAttachment[] {
  if (messageType === "image" && typeof content.image_key === "string") {
    return [{ id: content.image_key, kind: "image" }];
  }
  if (messageType === "audio" && typeof content.file_key === "string") {
    return [{ id: content.file_key, kind: "audio", name: typeof content.file_name === "string" ? content.file_name : undefined }];
  }
  if (messageType === "file" && typeof content.file_key === "string") {
    return [{ id: content.file_key, kind: "document", name: typeof content.file_name === "string" ? content.file_name : undefined }];
  }
  return [];
}

export function normalizeFeishuEvent(body: unknown): NormalizedFeishuEvent {
  const raw = body as any;
  if (raw?.type === "url_verification" && typeof raw.challenge === "string") {
    return { kind: "challenge", challenge: raw.challenge };
  }

  if (raw?.header?.event_type !== "im.message.receive_v1") {
    return { kind: "ignore" };
  }

  const eventId = raw.header?.event_id;
  const message = raw.event?.message;
  const sender = raw.event?.sender;
  const chatId = message?.chat_id;
  const userId = sender?.sender_id?.open_id;
  const messageId = message?.message_id;
  const messageType = message?.message_type;
  if (
    typeof eventId !== "string" ||
    typeof chatId !== "string" ||
    typeof userId !== "string" ||
    typeof messageId !== "string" ||
    typeof messageType !== "string"
  ) {
    return { kind: "ignore" };
  }

  const content = parseContent(message.content);
  const threadId = typeof message.thread_id === "string" ? message.thread_id : undefined;
  const chatType = message.chat_type === "p2p" ? "private" : "group";
  const conversationKey = getConversationKey({ platform: "feishu", chatId, threadId });

  return {
    kind: "message",
    message: {
      platform: "feishu",
      updateId: eventId,
      chatId,
      userId,
      chatType,
      threadId,
      conversationKey,
      text: normalizeText(messageType, content),
      attachments: normalizeAttachments(messageType, content),
    },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/feishu-event-normalizer.test.ts tests/transport-types.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/feishu/event-normalizer.ts tests/feishu-event-normalizer.test.ts
git commit -m "feat: normalize feishu events"
```

## Task 4: 实现飞书加密事件解密和 token 校验

**Files:**
- Create: `src/feishu/crypto.ts`
- Test: `tests/feishu-crypto.test.ts`

- [ ] **Step 1: 写校验和明文 passthrough 测试**

```ts
import { describe, expect, it } from "vitest";
import { assertFeishuToken, parseFeishuEventBody } from "../src/feishu/crypto.js";

describe("feishu crypto", () => {
  it("accepts matching verification token", () => {
    expect(() => assertFeishuToken({ token: "expected" }, "expected")).not.toThrow();
  });

  it("rejects mismatched verification token", () => {
    expect(() => assertFeishuToken({ token: "bad" }, "expected")).toThrow("Invalid Feishu verification token");
  });

  it("returns plain body when encrypt key is absent", () => {
    const body = { token: "t", event: { ok: true } };
    expect(parseFeishuEventBody(body, { verificationToken: "t" })).toEqual(body);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/feishu-crypto.test.ts`

Expected: FAIL，缺少模块。

- [ ] **Step 3: 实现 token 校验和解密入口**

```ts
import { createHash, createDecipheriv } from "node:crypto";

export interface FeishuCryptoOptions {
  verificationToken?: string;
  encryptKey?: string;
}

export function assertFeishuToken(body: unknown, expectedToken?: string): void {
  if (!expectedToken) return;
  const token = (body as { token?: unknown })?.token;
  if (token !== expectedToken) {
    throw new Error("Invalid Feishu verification token");
  }
}

function deriveAesKey(encryptKey: string): Buffer {
  return createHash("sha256").update(encryptKey).digest();
}

export function decryptFeishuPayload(encrypt: string, encryptKey: string): unknown {
  const encrypted = Buffer.from(encrypt, "base64");
  const key = deriveAesKey(encryptKey);
  const iv = encrypted.subarray(0, 16);
  const payload = encrypted.subarray(16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(true);
  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]).toString("utf8");
  return JSON.parse(decrypted);
}

export function parseFeishuEventBody(body: unknown, options: FeishuCryptoOptions): unknown {
  if (options.encryptKey && typeof (body as { encrypt?: unknown })?.encrypt === "string") {
    const decrypted = decryptFeishuPayload((body as { encrypt: string }).encrypt, options.encryptKey);
    assertFeishuToken(decrypted, options.verificationToken);
    return decrypted;
  }

  assertFeishuToken(body, options.verificationToken);
  return body;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/feishu-crypto.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/feishu/crypto.ts tests/feishu-crypto.test.ts
git commit -m "feat: validate and decrypt feishu event payloads"
```

## Task 5: 实现 provider 配置 schema

**Files:**
- Create: `src/provider/provider-config.ts`
- Modify: `src/state/config-file-schema.ts`
- Modify: `src/telegram/instance-config.ts`
- Test: `tests/provider-config.test.ts`

- [ ] **Step 1: 写 provider 配置测试**

```ts
import { describe, expect, it } from "vitest";
import { normalizeProviderConfig } from "../src/provider/provider-config.js";

describe("normalizeProviderConfig", () => {
  it("fills defaults", () => {
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
      args: undefined
    });
  });

  it("accepts deepseek config", () => {
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
      retries: { maxAttempts: 2 }
    });
    expect(config.model).toBe("deepseek-chat");
    expect(config.temperature).toBe(0.2);
    expect(config.retries.maxAttempts).toBe(2);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/provider-config.test.ts`

Expected: FAIL，缺少模块。

- [ ] **Step 3: 新增 provider config**

```ts
import { z } from "zod";

export const ProviderKindSchema = z.enum(["native", "openai-compatible", "anthropic-compatible", "command-template"]);
export const ThinkingEffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

export const ProviderConfigSchema = z.object({
  kind: ProviderKindSchema.optional(),
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional(),
  temperature: z.number().min(0).max(2).optional(),
  thinking: z.object({
    enabled: z.boolean().optional(),
    effort: ThinkingEffortSchema.optional(),
  }).optional(),
  timeoutMs: z.number().int().min(10_000).max(86_400_000).optional(),
  inactivityTimeoutMs: z.number().int().min(10_000).max(86_400_000).nullable().optional(),
  retries: z.object({
    maxAttempts: z.number().int().min(1).max(5).optional(),
    baseDelayMs: z.number().int().min(0).max(60_000).optional(),
    maxDelayMs: z.number().int().min(0).max(300_000).optional(),
  }).optional(),
  extraEnv: z.record(z.string(), z.string()).optional(),
  extraArgs: z.array(z.string()).optional(),
  command: z.string().min(1).optional(),
  args: z.array(z.string()).optional(),
}).passthrough();

export type ProviderConfig = z.infer<typeof ProviderConfigSchema> & {
  kind: "native" | "openai-compatible" | "anthropic-compatible" | "command-template";
  thinking: { enabled?: boolean; effort?: "low" | "medium" | "high" | "xhigh" | "max" };
  timeoutMs: number;
  inactivityTimeoutMs: number | null;
  retries: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number };
  extraEnv: Record<string, string>;
  extraArgs: string[];
};

export function normalizeProviderConfig(raw: unknown): ProviderConfig {
  const parsed = ProviderConfigSchema.safeParse(raw);
  const value = parsed.success ? parsed.data : {};
  return {
    kind: value.kind ?? "native",
    name: value.name,
    model: value.model,
    baseUrl: value.baseUrl,
    apiKeyEnv: value.apiKeyEnv,
    temperature: value.temperature,
    thinking: {
      enabled: value.thinking?.enabled,
      effort: value.thinking?.effort,
    },
    timeoutMs: value.timeoutMs ?? 3_600_000,
    inactivityTimeoutMs: value.inactivityTimeoutMs === null ? null : value.inactivityTimeoutMs ?? 1_800_000,
    retries: {
      maxAttempts: value.retries?.maxAttempts ?? 1,
      baseDelayMs: value.retries?.baseDelayMs ?? 1000,
      maxDelayMs: value.retries?.maxDelayMs ?? 10_000,
    },
    extraEnv: value.extraEnv ?? {},
    extraArgs: value.extraArgs ?? [],
    command: value.command,
    args: value.args,
  };
}
```

- [ ] **Step 4: 扩展 config schema**

在 `src/state/config-file-schema.ts` 中加入：

```ts
import { ProviderConfigSchema } from "../provider/provider-config.js";
```

并在 `ConfigFileSchema` 里加入：

```ts
provider: ProviderConfigSchema.optional(),
```

在 `src/telegram/instance-config.ts` 的 `InstanceConfig` 中加入：

```ts
provider: ProviderConfig;
```

在 `loadInstanceConfig()` 返回值中加入：

```ts
provider: normalizeProviderConfig(config.provider),
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/provider-config.test.ts tests/config.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/provider/provider-config.ts src/state/config-file-schema.ts src/telegram/instance-config.ts tests/provider-config.test.ts
git commit -m "feat: add provider configuration schema"
```

## Task 6: 将 provider 配置映射到 Codex / Claude CLI

**Files:**
- Modify: `src/codex/process-adapter.ts`
- Modify: `src/codex/app-server-adapter.ts`
- Modify: `src/codex/claude-adapter.ts`
- Modify: `src/codex/claude-stream-adapter.ts`
- Test: `tests/process-adapter.test.ts`
- Test: `tests/claude-adapter.test.ts`

- [ ] **Step 1: 为 Codex 参数生成补测试**

在 `tests/process-adapter.test.ts` 增加断言：当 `config.json` 有 `provider.temperature`、`provider.model`、`provider.thinking.effort` 时，spawn args 包含：

```ts
expect(args).toContain("-m");
expect(args).toContain("deepseek-chat");
expect(args).toContain("-c");
expect(args).toContain("model_reasoning_effort=\"medium\"");
expect(args).toContain("temperature=0.2");
```

- [ ] **Step 2: 为 Claude 参数生成补测试**

在 `tests/claude-adapter.test.ts` 增加断言：当 `provider.model = "sonnet"`、`provider.thinking.effort = "high"` 时，spawn args 包含：

```ts
expect(args).toContain("--model");
expect(args).toContain("sonnet");
expect(args).toContain("--effort");
expect(args).toContain("high");
```

- [ ] **Step 3: 修改 adapter 读取 provider**

在 Codex adapter 的 `loadEngineOptions()` 中读取：

```ts
const provider = normalizeProviderConfig(parsed.provider);
return {
  effort: provider.thinking.effort ?? parsed.effort,
  model: provider.model ?? parsed.model,
  codexServiceTier: parsed.codexServiceTier === "fast" ? "fast" : undefined,
  provider,
};
```

在参数构建处加入：

```ts
if (engineOptions.provider.temperature !== undefined) {
  engineFlags.push("-c", `temperature=${engineOptions.provider.temperature}`);
}
if (engineOptions.provider.baseUrl) {
  engineFlags.push("-c", `model_provider.base_url="${engineOptions.provider.baseUrl}"`);
}
engineFlags.push(...engineOptions.provider.extraArgs);
```

在 child env 合并处加入：

```ts
const providerEnv = { ...engineOptions.provider.extraEnv };
if (engineOptions.provider.apiKeyEnv && process.env[engineOptions.provider.apiKeyEnv]) {
  providerEnv[engineOptions.provider.apiKeyEnv] = process.env[engineOptions.provider.apiKeyEnv]!;
}
```

并将 `providerEnv` 合并到 `input.extraEnv` 前。

- [ ] **Step 4: 把 provider timeout 传入 adapter**

在 `src/service.ts` 的 `createAdapter()` 中读取 `loadInstanceConfig(config.stateDir).provider`，实例化 `ProcessCodexAdapter` 时传：

```ts
provider.timeoutMs,
provider.inactivityTimeoutMs,
```

对 `ClaudeStreamAdapter` 和 `ProcessClaudeAdapter` 增加等价 options 字段：

```ts
turnTimeoutMs?: number;
inactivityTimeoutMs?: number | null;
```

并在 `runClaudeCommand()` 中用 `setTimeout` + `killProcessTree(child.pid)` 实现超时。

- [ ] **Step 5: 运行 adapter 测试**

Run:

```bash
npx vitest run tests/process-adapter.test.ts tests/app-server-adapter.test.ts tests/claude-adapter.test.ts tests/claude-stream-adapter.test.ts
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/codex src/service.ts tests/process-adapter.test.ts tests/app-server-adapter.test.ts tests/claude-adapter.test.ts tests/claude-stream-adapter.test.ts
git commit -m "feat: map provider config to engine cli options"
```

## Task 7: 增加 engine turn 重试

**Files:**
- Create: `src/provider/retry.ts`
- Modify: `src/runtime/bridge-turn.ts`
- Test: `tests/provider-retry.test.ts`
- Test: `tests/bridge-turn.test.ts`

- [ ] **Step 1: 写重试测试**

```ts
import { describe, expect, it } from "vitest";
import { runWithProviderRetry } from "../src/provider/retry.js";

describe("runWithProviderRetry", () => {
  it("returns first success", async () => {
    await expect(runWithProviderRetry({ maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 }, async () => "ok")).resolves.toBe("ok");
  });

  it("retries transient failures", async () => {
    let attempts = 0;
    const result = await runWithProviderRetry({ maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 }, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("rate limit");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });
});
```

- [ ] **Step 2: 实现重试工具**

```ts
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /rate limit|timeout|temporar|ECONNRESET|ETIMEDOUT|502|503|504/i.test(message);
}

async function delay(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWithProviderRetry<T>(config: RetryConfig, fn: (attempt: number) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= config.maxAttempts || !isRetryable(error)) {
        throw error;
      }
      const backoff = Math.min(config.maxDelayMs, config.baseDelayMs * 2 ** (attempt - 1));
      await delay(backoff);
    }
  }
  throw lastError;
}
```

- [ ] **Step 3: 集成到 `BridgeTurn`**

在 `src/runtime/bridge-turn.ts` 中围绕 `adapter.sendUserMessage()` 使用：

```ts
const instanceConfig = await loadInstanceConfig(stateDir);
const response = await runWithProviderRetry(instanceConfig.provider.retries, () => adapter.sendUserMessage(sessionId, input));
```

如果 `bridge-turn.ts` 当前没有 `stateDir`，从调用方传入 `loadProviderRetry` callback，避免运行时反向依赖状态层。

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/provider-retry.test.ts tests/bridge-turn.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/provider/retry.ts src/runtime/bridge-turn.ts tests/provider-retry.test.ts tests/bridge-turn.test.ts
git commit -m "feat: retry transient provider failures"
```

## Task 8: 实现飞书 API 客户端

**Files:**
- Create: `src/feishu/api.ts`
- Test: `tests/feishu-api.test.ts`

- [ ] **Step 1: 写 token 缓存和发消息测试**

```ts
import { describe, expect, it, vi } from "vitest";
import { FeishuApi } from "../src/feishu/api.js";

describe("FeishuApi", () => {
  it("fetches tenant access token and sends a text message", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, tenant_access_token: "tat", expire: 7200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { message_id: "om_reply" } }), { status: 200 }));

    const api = new FeishuApi({ appId: "app", appSecret: "secret", fetchImpl });
    const result = await api.sendMessage("oc_1", "你好");

    expect(result.messageId).toBe("om_reply");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 实现 FeishuApi**

```ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BridgeApi, BridgeAttachment, BridgeSendOptions } from "../transport/types.js";

interface FeishuApiOptions {
  appId: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

export class FeishuApi implements BridgeApi {
  private readonly fetchImpl: typeof fetch;
  private readonly apiBaseUrl: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly options: FeishuApiOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBaseUrl = options.apiBaseUrl ?? "https://open.feishu.cn/open-apis";
  }

  private async tenantAccessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const response = await this.fetchImpl(`${this.apiBaseUrl}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: this.options.appId, app_secret: this.options.appSecret }),
    });
    const json = await response.json() as { code?: number; msg?: string; tenant_access_token?: string; expire?: number };
    if (!response.ok || json.code !== 0 || !json.tenant_access_token) {
      throw new Error(`Feishu token request failed: ${json.msg ?? response.statusText}`);
    }
    this.token = { value: json.tenant_access_token, expiresAt: Date.now() + Math.max(60, (json.expire ?? 7200) - 300) * 1000 };
    return this.token.value;
  }

  private async postJson<T>(url: string, body: unknown): Promise<T> {
    const token = await this.tenantAccessToken();
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await response.json() as { code?: number; msg?: string; data?: T };
    if (!response.ok || json.code !== 0) {
      throw new Error(`Feishu API request failed: ${json.msg ?? response.statusText}`);
    }
    return json.data as T;
  }

  async sendMessage(chatId: string, text: string, _options?: BridgeSendOptions): Promise<{ messageId: string }> {
    const data = await this.postJson<{ message_id: string }>(`${this.apiBaseUrl}/im/v1/messages?receive_id_type=chat_id`, {
      receive_id: chatId,
      msg_type: "text",
      content: JSON.stringify({ text }),
    });
    return { messageId: data.message_id };
  }

  async sendFile(chatId: string, filename: string, contents: string | Uint8Array): Promise<{ messageId: string }> {
    const text = typeof contents === "string" ? contents : new TextDecoder().decode(contents);
    return this.sendMessage(chatId, `文件 ${filename}\n\n${text.slice(0, 30000)}`);
  }

  async downloadAttachment(attachment: BridgeAttachment, targetPath: string): Promise<void> {
    await mkdir(path.dirname(targetPath), { recursive: true });
    const token = await this.tenantAccessToken();
    const response = await this.fetchImpl(`${this.apiBaseUrl}/im/v1/messages/${attachment.id}/resources/${attachment.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Feishu attachment download failed: ${response.status} ${response.statusText}`);
    const buffer = new Uint8Array(await response.arrayBuffer());
    await writeFile(targetPath, buffer);
  }
}
```

- [ ] **Step 3: 运行测试**

Run: `npx vitest run tests/feishu-api.test.ts`

Expected: PASS。

- [ ] **Step 4: 提交**

```bash
git add src/feishu/api.ts tests/feishu-api.test.ts
git commit -m "feat: add feishu api client"
```

## Task 9: 新增飞书 webhook server

**Files:**
- Create: `src/feishu/webhook-server.ts`
- Modify: `src/index.ts`
- Modify: `src/service.ts`
- Test: `tests/webhook-server.test.ts`

- [ ] **Step 1: 写 health 和 challenge 测试**

```ts
import { describe, expect, it } from "vitest";
import { createFeishuWebhookServer } from "../src/feishu/webhook-server.js";

describe("createFeishuWebhookServer", () => {
  it("responds to health checks", async () => {
    const server = createFeishuWebhookServer({ verificationToken: "t", onMessage: async () => {} });
    const response = await server.inject({ method: "GET", path: "/health" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
  });

  it("responds to feishu challenge", async () => {
    const server = createFeishuWebhookServer({ verificationToken: "t", onMessage: async () => {} });
    const response = await server.inject({
      method: "POST",
      path: "/feishu/events",
      body: JSON.stringify({ token: "t", type: "url_verification", challenge: "abc" })
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "abc" });
  });
});
```

- [ ] **Step 2: 实现 webhook server**

实现一个轻量 HTTP server，并暴露 `inject()` 方便测试：

```ts
import http from "node:http";
import { parseFeishuEventBody } from "./crypto.js";
import { normalizeFeishuEvent } from "./event-normalizer.js";
import type { BridgeMessage } from "../transport/types.js";

export interface FeishuWebhookOptions {
  verificationToken?: string;
  encryptKey?: string;
  onMessage(message: BridgeMessage): Promise<void>;
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function handleRequest(input: { method: string; path: string; body?: unknown }, options: FeishuWebhookOptions): Promise<{ status: number; body: unknown }> {
  if (input.method === "GET" && input.path === "/health") return { status: 200, body: "ok" };
  if (input.method !== "POST" || input.path !== "/feishu/events") return { status: 404, body: { error: "not found" } };
  const parsed = parseFeishuEventBody(input.body, { verificationToken: options.verificationToken, encryptKey: options.encryptKey });
  const event = normalizeFeishuEvent(parsed);
  if (event.kind === "challenge") return { status: 200, body: { challenge: event.challenge } };
  if (event.kind === "message") await options.onMessage(event.message);
  return { status: 200, body: { ok: true } };
}

export function createFeishuWebhookServer(options: FeishuWebhookOptions) {
  return {
    async inject(input: { method: string; path: string; body?: string }) {
      const result = await handleRequest({
        method: input.method,
        path: input.path,
        body: input.body ? JSON.parse(input.body) : undefined,
      }, options);
      return new Response(typeof result.body === "string" ? result.body : JSON.stringify(result.body), { status: result.status });
    },
    listen(port: number, host = "0.0.0.0") {
      const server = http.createServer(async (req, res) => {
        try {
          const body = req.method === "POST" ? await readJson(req) : undefined;
          const result = await handleRequest({ method: req.method ?? "GET", path: req.url?.split("?")[0] ?? "/", body }, options);
          res.statusCode = result.status;
          res.setHeader("Content-Type", typeof result.body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8");
          res.end(typeof result.body === "string" ? result.body : JSON.stringify(result.body));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
      server.listen(port, host);
      return server;
    },
  };
}
```

- [ ] **Step 3: 在 `src/index.ts` 接入 Railway HTTP 模式**

新增启动分支：

```ts
if (process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET) {
  await runFeishuHttpService(process.env);
  return;
}
```

在 `src/service.ts` 新增 `runFeishuHttpService(env)`，内部创建 `FeishuApi`、`Bridge`，并把 `BridgeMessage` 转给新的通用处理函数。

- [ ] **Step 4: 运行测试和 build**

Run:

```bash
npx vitest run tests/webhook-server.test.ts tests/feishu-event-normalizer.test.ts tests/feishu-crypto.test.ts
npm run build
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/feishu/webhook-server.ts src/index.ts src/service.ts tests/webhook-server.test.ts
git commit -m "feat: serve feishu webhook events"
```

## Task 10: 把 Telegram delivery 迁移为通用 delivery

**Files:**
- Create: `src/transport/delivery.ts`
- Create: `src/transport/message-input.ts`
- Modify: `src/telegram/delivery.ts`
- Modify: `src/service.ts`
- Test: `tests/bridge.test.ts`
- Test: `tests/bridge-turn.test.ts`

- [ ] **Step 1: 建立通用处理函数**

从 `src/telegram/delivery.ts` 抽出不依赖 Telegram API 的逻辑到：

```ts
export async function handleBridgeMessage(
  normalized: BridgeMessage,
  context: BridgeDeliveryContext,
): Promise<void>
```

`BridgeDeliveryContext` 使用 `BridgeApi`，不再使用 `TelegramApi`。

- [ ] **Step 2: 保留 Telegram 兼容层**

`src/telegram/delivery.ts` 改为只做 adapter：

```ts
export async function handleNormalizedTelegramMessage(normalized: NormalizedTelegramMessage, context: TelegramDeliveryContext): Promise<void> {
  return handleBridgeMessage(convertTelegramMessage(normalized), convertTelegramContext(context));
}
```

- [ ] **Step 3: 飞书服务调用通用处理函数**

`runFeishuHttpService()` 中：

```ts
const server = createFeishuWebhookServer({
  verificationToken: env.FEISHU_VERIFICATION_TOKEN,
  encryptKey: env.FEISHU_ENCRYPT_KEY,
  onMessage: async (message) => {
    await chatQueue.enqueue(message.conversationKey, async () => {
      await handleBridgeMessage(message, { api, bridge, inboxDir: config.inboxDir, instanceName: config.instanceName });
    });
  },
});
server.listen(Number(env.PORT ?? 3000));
```

- [ ] **Step 4: 运行回归测试**

Run: `npm test`

Expected: 全量 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/transport src/telegram src/service.ts tests
git commit -m "refactor: route platform messages through common delivery"
```

## Task 11: Railway 部署配置

**Files:**
- Modify: `Dockerfile`
- Create: `railway.toml`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: 更新 Dockerfile**

```Dockerfile
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV BRIDGE_HOME=/data/cc-bridge-feishu
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/src/index.js"]
```

- [ ] **Step 2: 新增 railway.toml**

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "Dockerfile"

[deploy]
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10
```

- [ ] **Step 3: 文档写明 Railway 环境变量**

`README.zh-CN.md` 增加：

````md
## Railway 部署

必填环境变量：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_VERIFICATION_TOKEN`
- `FEISHU_ENCRYPT_KEY`：如果飞书事件订阅未开启加密，可留空。
- `BRIDGE_HOME=/data/cc-bridge-feishu`
- `CODEX_HOME=/data/cc-bridge-feishu/.codex`
- `CLAUDE_CONFIG_DIR=/data/cc-bridge-feishu/.claude`

Provider 示例：

```json
{
  "engine": "codex",
  "provider": {
    "kind": "openai-compatible",
    "name": "deepseek",
    "model": "deepseek-chat",
    "baseUrl": "https://api.deepseek.com",
    "apiKeyEnv": "DEEPSEEK_API_KEY",
    "temperature": 0.2,
    "thinking": { "enabled": true, "effort": "medium" },
    "timeoutMs": 1800000,
    "inactivityTimeoutMs": 300000,
    "retries": { "maxAttempts": 2, "baseDelayMs": 1000, "maxDelayMs": 10000 }
  }
}
```

Railway 必须挂载 Volume 到 `/data`，否则 CLI 登录态、会话、workspace 和实例配置会在重启后丢失。
````

- [ ] **Step 4: build 验证**

Run:

```bash
npm run build
docker build -t cc-bridge-feishu .
```

Expected: TypeScript build 和 Docker build 均成功。

- [ ] **Step 5: 提交**

```bash
git add Dockerfile railway.toml README.zh-CN.md
git commit -m "chore: add railway deployment support"
```

## Task 12: 端到端验收

**Files:**
- Modify: `README.zh-CN.md`
- Test: local runtime

- [ ] **Step 1: 本地启动**

Run:

```bash
FEISHU_APP_ID=cli_xxx \
FEISHU_APP_SECRET=xxx \
FEISHU_VERIFICATION_TOKEN=xxx \
BRIDGE_HOME=/private/tmp/cc-bridge-feishu-data \
PORT=3000 \
npm run dev
```

Expected: stdout 出现 `Feishu webhook listening on 0.0.0.0:3000`。

- [ ] **Step 2: 健康检查**

Run:

```bash
curl -i http://127.0.0.1:3000/health
```

Expected: `HTTP/1.1 200 OK` 且 body 为 `ok`。

- [ ] **Step 3: 飞书 challenge**

Run:

```bash
curl -s http://127.0.0.1:3000/feishu/events \
  -H 'Content-Type: application/json' \
  -d '{"token":"xxx","type":"url_verification","challenge":"abc"}'
```

Expected:

```json
{"challenge":"abc"}
```

- [ ] **Step 4: 飞书后台配置**

在飞书开放平台：

- 事件订阅 Request URL：`https://<railway-domain>/feishu/events`
- 订阅事件：`im.message.receive_v1`
- 权限：读取用户消息、发送消息、读取文件资源，按飞书后台实际权限名勾选。
- 如果开启 Encrypt Key，同步设置 Railway 环境变量 `FEISHU_ENCRYPT_KEY`。

- [ ] **Step 5: Railway 验收**

Run:

```bash
curl -i https://<railway-domain>/health
```

Expected: `200 OK`。

在飞书给机器人发送：

```text
/status
```

Expected: 机器人在飞书会话中返回实例状态。

- [ ] **Step 6: Provider 验收**

在实例 `config.json` 写入 DeepSeek provider 后发送：

```text
用一句话告诉我你当前使用的模型配置。
```

Expected: 后端日志显示 Codex/Claude CLI 启动参数包含配置中的 model、temperature、thinking effort；飞书收到回复。

## 自检结果

- Spec coverage: 飞书接入口、provider 模型配置、温度、思考模式、最大超时、重试次数、Railway 24h 部署均有任务覆盖。
- Placeholder scan: 没有使用 `TBD`、`TODO`、`implement later` 作为实施内容。
- Type consistency: `BridgeMessage`、`BridgeApi`、`ProviderConfig` 在后续任务中使用的字段与定义一致。

## 参考资料

- 上游代码：`https://github.com/cloveric/cc-telegram-bridge`
- 飞书事件订阅：`https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/request-url-configuration-case`
- 飞书接收消息事件：`https://open.feishu.cn/document/server-docs/im-v1/message/events/receive`
- 飞书发送消息 API：`https://open.feishu.cn/document/server-docs/im-v1/message/create`
- Railway Volumes：`https://docs.railway.com/reference/volumes`
- Railway Deploy configuration：`https://docs.railway.com/reference/config-as-code`
