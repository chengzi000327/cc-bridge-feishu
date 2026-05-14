# Feishu Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐飞书接入层的群聊唤醒、mention 解析、富文本提取、真实文件发送和附件路径安全，让 Feishu transport 达到可上线长期运行的边界质量。

**Architecture:** 在 `src/feishu/*` 内收敛飞书协议细节，`src/transport/*` 只扩展平台无关字段。`event-normalizer` 负责解析消息、mention 和文本；`webhook-server` 注入 bot identity 与 group policy；`delivery` 负责群聊策略落地和附件落盘安全；`api` 负责真实上传/发送和下载 API 防护。

**Tech Stack:** Node.js 20+、TypeScript、Vitest、Feishu Open Platform HTTP API、Zod-free focused parsers、现有 `BridgeMessage` / `BridgeApi` transport 抽象。

---

## 现状对账

已具备：

- `src/feishu/delivery.ts` 已有基础附件路径安全：`path.basename()`、文件名字符清洗、`path.resolve()` 和 inbox containment。
- `src/feishu/api.ts` 已有 tenant access token 缓存、text 消息发送、附件下载。
- `src/feishu/event-normalizer.ts` 已能处理 `text`、`image`、`audio`、`file` 的最小路径。
- `src/feishu/webhook-server.ts` 已支持 `/health`、飞书 challenge、异步 ack message event。

仍缺：

- 群聊唤醒策略：还没有 `managed_or_mention`，Feishu 群普通消息可能被误处理。
- mention 解析：没有从 content/raw mentions 提取 `open_id/user_id/union_id/name`，也无法判断是否 `@bot`。
- 富文本/卡片提取：`post` 仍是 `JSON.stringify(content)`，`interactive/share_chat/share_user/merge_forward` 未提取。
- 文件真实发送：`sendFile()` 仍把文件内容拼成 text。
- 路径安全补强：API 层信任 `targetPath`；delivery 层还缺 Windows 保留名、超长名、同名附件处理。

## 文件结构

- Modify: `src/transport/types.ts`  
  增加 `BridgeMention`、`BridgeMessage.mentions`、`BridgeMessage.mentionedBot`。
- Modify: `src/feishu/event-normalizer.ts`  
  增加 bot identity、mention 解析、rich content 文本提取、空消息 ignore。
- Modify: `src/feishu/webhook-server.ts`  
  透传 bot identity 和 group policy 到 normalizer/delivery。
- Modify: `src/feishu/delivery.ts`  
  实现群聊唤醒策略和附件文件名安全补强。
- Modify: `src/feishu/api.ts`  
  实现 image/file upload、真实文件消息发送、下载 root containment。
- Test: `tests/feishu-event-normalizer.test.ts`
- Test: `tests/webhook-server.test.ts`
- Test: `tests/feishu-delivery.test.ts`
- Test: `tests/feishu-api.test.ts`
- Docs: `docs/superpowers/plans/2026-05-14-engine-provider-decoupling.md`

## Task 1: Feishu mention 解析和 bot identity

**Files:**
- Modify: `src/transport/types.ts`
- Modify: `src/feishu/event-normalizer.ts`
- Test: `tests/feishu-event-normalizer.test.ts`

- [x] **Step 1: 写 mention 解析失败测试**

在 `tests/feishu-event-normalizer.test.ts` 增加：

```ts
it("extracts Feishu mentions and marks messages that mention the bot", () => {
  const normalized = normalizeFeishuEvent({
    header: { event_id: "evt_mention", event_type: "im.message.receive_v1" },
    event: {
      sender: { sender_id: { open_id: "ou_sender" } },
      message: {
        chat_id: "oc_group",
        chat_type: "group",
        message_id: "om_mention",
        message_type: "text",
        content: JSON.stringify({
          text: "<at user_id=\"ou_bot\">BridgeBot</at> 帮我总结",
        }),
        mentions: [{
          key: "@_user_1",
          id: { open_id: "ou_bot", user_id: "u_bot", union_id: "on_bot" },
          name: "BridgeBot",
        }],
      },
    },
  }, {
    botOpenId: "ou_bot",
    botName: "BridgeBot",
  });

  expect(normalized).toMatchObject({
    kind: "message",
    message: {
      mentionedBot: true,
      text: "帮我总结",
      mentions: [{
        key: "@_user_1",
        openId: "ou_bot",
        userId: "u_bot",
        unionId: "on_bot",
        name: "BridgeBot",
      }],
    },
  });
});
```

- [x] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/feishu-event-normalizer.test.ts`

Expected: FAIL，`normalizeFeishuEvent` 不接受第二个参数，且 message 没有 `mentionedBot` / `mentions`。

- [x] **Step 3: 扩展 transport 类型**

在 `src/transport/types.ts` 增加：

```ts
export interface BridgeMention {
  openId?: string;
  userId?: string;
  unionId?: string;
  name?: string;
  key?: string;
}
```

在 `BridgeMessage` 增加：

```ts
mentions?: BridgeMention[];
mentionedBot?: boolean;
```

- [x] **Step 4: 实现 Feishu bot identity 和 mention parser**

在 `src/feishu/event-normalizer.ts` 增加：

```ts
export interface FeishuBotIdentity {
  botOpenId?: string;
  botUserId?: string;
  botUnionId?: string;
  botName?: string;
}
```

`normalizeFeishuEvent(body, identity = {})`：

- 从 `message.mentions` 解析 `key`、`id.open_id`、`id.user_id`、`id.union_id`、`name`。
- 从 text content 中解析 `<at user_id="...">name</at>`，补齐 raw mentions 缺失时的 mention。
- `mentionedBot = true` 当任一 mention 命中 `botOpenId`、`botUserId`、`botUnionId`；仅当这些都缺失时才用 `botName` 兜底。
- 从 `text` 中移除命中 bot 的 `<at ...>` 标签，其它 mention 转为可读 `@name`。

- [x] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/feishu-event-normalizer.test.ts`

Expected: PASS。

- [x] **Step 6: 提交**

```bash
git add src/transport/types.ts src/feishu/event-normalizer.ts tests/feishu-event-normalizer.test.ts
git commit -m "feat: parse Feishu mentions"
```

## Task 2: Feishu 群聊唤醒策略

**Files:**
- Modify: `src/feishu/webhook-server.ts`
- Modify: `src/feishu/delivery.ts`
- Modify: `src/feishu/event-normalizer.ts`
- Test: `tests/webhook-server.test.ts`
- Test: `tests/feishu-delivery.test.ts`

- [x] **Step 1: 写 webhook 注入 bot identity 测试**

在 `tests/webhook-server.test.ts` 增加：

```ts
it("uses bot identity to ignore unmentioned group messages by default", async () => {
  const onMessage = vi.fn();
  const server = createFeishuWebhookServer({
    verificationToken: "t",
    botOpenId: "ou_bot",
    onMessage,
  });

  const response = await server.inject({
    method: "POST",
    path: "/feishu/events",
    body: JSON.stringify({
      token: "t",
      header: { event_id: "evt_group", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_sender" } },
        message: {
          chat_id: "oc_group",
          chat_type: "group",
          message_id: "om_group",
          message_type: "text",
          content: "{\"text\":\"普通群消息\"}",
        },
      },
    }),
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(onMessage).not.toHaveBeenCalled();
});
```

- [x] **Step 2: 写 delivery managed group 测试**

在 `tests/feishu-delivery.test.ts` 增加：

```ts
it("processes managed Feishu groups even without a bot mention", async () => {
  const api = {
    sendMessage: vi.fn().mockResolvedValue({ messageId: "om_reply" }),
    sendFile: vi.fn(),
    downloadAttachment: vi.fn(),
  };
  const bridge = {
    handleAuthorizedMessage: vi.fn().mockResolvedValue({ text: "完成" }),
  };

  await handleFeishuMessage(message({
    chatType: "group",
    chatId: "oc_managed",
    conversationKey: "feishu:oc_managed",
    mentionedBot: false,
  }), {
    api,
    bridge,
    inboxDir: "/tmp/inbox",
    groupPolicy: "managed_or_mention",
    managedGroupIds: [toFeishuBridgeNumericId("oc_managed")],
  });

  expect(bridge.handleAuthorizedMessage).toHaveBeenCalledOnce();
});
```

- [x] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/webhook-server.test.ts tests/feishu-delivery.test.ts`

Expected: FAIL，`botOpenId`、`groupPolicy`、`managedGroupIds` 不存在。

- [x] **Step 4: 实现 group policy 类型和 delivery 判断**

在 `src/feishu/delivery.ts` 增加：

```ts
export type FeishuGroupPolicy = "managed_or_mention" | "managed_only" | "mention_only" | "all";
```

`FeishuDeliveryContext` 增加：

```ts
groupPolicy?: FeishuGroupPolicy;
managedGroupIds?: number[];
```

`handleFeishuMessage()` 开头判断：

- `private` 直接处理。
- `all` 直接处理。
- `managed_only` 只处理 managed group。
- `mention_only` 只处理 `message.mentionedBot`。
- `managed_or_mention` 处理 managed group 或 `mentionedBot`。
- 不满足时直接 return，不调用 bridge，也不发消息。

- [x] **Step 5: webhook-server 传 bot identity**

`FeishuWebhookOptions` 增加：

```ts
botOpenId?: string;
botUserId?: string;
botUnionId?: string;
botName?: string;
groupPolicy?: FeishuGroupPolicy;
```

在 `normalizeFeishuEvent(parsed, identity)` 中传入 bot identity。默认 `groupPolicy = "managed_or_mention"`。webhook 层只根据 `event.kind` 决定是否调用 `onMessage`；managed group 判断留给 delivery，因为它需要实例配置。

- [x] **Step 6: 运行测试确认通过**

Run: `npx vitest run tests/webhook-server.test.ts tests/feishu-delivery.test.ts tests/feishu-event-normalizer.test.ts`

Expected: PASS。

- [x] **Step 7: 提交**

```bash
git add src/feishu/webhook-server.ts src/feishu/delivery.ts src/feishu/event-normalizer.ts tests/webhook-server.test.ts tests/feishu-delivery.test.ts tests/feishu-event-normalizer.test.ts
git commit -m "feat: add Feishu group wake policy"
```

## Task 3: Feishu 富文本和卡片文本提取

**Files:**
- Modify: `src/feishu/event-normalizer.ts`
- Test: `tests/feishu-event-normalizer.test.ts`

- [x] **Step 1: 写 post 文本提取测试**

```ts
it("extracts readable text from post messages", () => {
  const normalized = normalizeFeishuEvent({
    header: { event_id: "evt_post", event_type: "im.message.receive_v1" },
    event: {
      sender: { sender_id: { open_id: "ou_1" } },
      message: {
        chat_id: "oc_1",
        chat_type: "p2p",
        message_id: "om_post",
        message_type: "post",
        content: JSON.stringify({
          post: {
            zh_cn: {
              title: "日报",
              content: [[
                { tag: "text", text: "完成 A" },
                { tag: "a", text: "链接", href: "https://example.com" },
                { tag: "at", user_name: "张三" },
              ]],
            },
          },
        }),
      },
    },
  });

  expect(normalized).toMatchObject({
    kind: "message",
    message: {
      text: "日报\n完成 A 链接 https://example.com @张三",
    },
  });
});
```

- [x] **Step 2: 写 interactive/share/merge_forward 测试**

增加一个参数化测试：

```ts
it.each([
  ["interactive", { title: "审批卡片", elements: [{ tag: "markdown", content: "**请审批**" }] }, "审批卡片\n请审批"],
  ["share_chat", { chat_id: "oc_shared", name: "项目群" }, "分享群聊：项目群 (oc_shared)"],
  ["share_user", { user_id: "ou_shared", name: "李四" }, "分享用户：李四 (ou_shared)"],
  ["merge_forward", { title: "聊天记录", messages: [{ sender: "A", text: "hello" }] }, "聊天记录\nA: hello"],
] as const)("extracts readable text from %s messages", (messageType, content, expectedText) => {
  const normalized = normalizeFeishuEvent({
    header: { event_id: `evt_${messageType}`, event_type: "im.message.receive_v1" },
    event: {
      sender: { sender_id: { open_id: "ou_1" } },
      message: {
        chat_id: "oc_1",
        chat_type: "p2p",
        message_id: `om_${messageType}`,
        message_type: messageType,
        content: JSON.stringify(content),
      },
    },
  });

  expect(normalized).toMatchObject({ kind: "message", message: { text: expectedText } });
});
```

- [x] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/feishu-event-normalizer.test.ts`

Expected: FAIL，`post` 仍输出 JSON 字符串，其它类型为空。

- [x] **Step 4: 实现 focused extractor**

在 `event-normalizer.ts` 内拆小函数：

```ts
function normalizeText(messageType: string, content: Record<string, unknown>): string
function extractPostText(content: Record<string, unknown>): string
function extractInteractiveText(content: Record<string, unknown>): string
function extractShareChatText(content: Record<string, unknown>): string
function extractShareUserText(content: Record<string, unknown>): string
function extractMergeForwardText(content: Record<string, unknown>): string
```

规则：

- 输出 trim 后的纯文本。
- markdown 只做最小清理：去掉 `**`、反引号，不做复杂渲染。
- 不认识的结构返回空字符串，不抛异常。

- [x] **Step 5: 空消息 ignore**

如果 `text.trim() === ""` 且 `attachments.length === 0`，返回 `{ kind: "ignore" }`。保留 image/file/audio 这种无文本但有附件的消息。

- [x] **Step 6: 运行测试确认通过**

Run: `npx vitest run tests/feishu-event-normalizer.test.ts`

Expected: PASS。

- [x] **Step 7: 提交**

```bash
git add src/feishu/event-normalizer.ts tests/feishu-event-normalizer.test.ts
git commit -m "feat: extract Feishu rich message text"
```

## Task 4: Feishu 文件和图片真实发送

**Files:**
- Modify: `src/feishu/api.ts`
- Test: `tests/feishu-api.test.ts`

- [x] **Step 1: 写图片上传发送测试**

在 `tests/feishu-api.test.ts` 增加：

```ts
it("uploads image bytes and sends an image message", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, tenant_access_token: "tat", expire: 7200 }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { image_key: "img_uploaded" } }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { message_id: "om_img" } }), { status: 200 }));
  const api = new FeishuApi({ appId: "app", appSecret: "secret", fetchImpl });

  await expect(api.sendFile("oc_1", "chart.png", new Uint8Array([1, 2, 3]))).resolves.toEqual({ messageId: "om_img" });

  expect(fetchImpl).toHaveBeenNthCalledWith(
    2,
    "https://open.feishu.cn/open-apis/im/v1/images",
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer tat" }),
    }),
  );
  expect(fetchImpl).toHaveBeenNthCalledWith(
    3,
    "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
    expect.objectContaining({
      body: JSON.stringify({
        receive_id: "oc_1",
        msg_type: "image",
        content: JSON.stringify({ image_key: "img_uploaded" }),
      }),
    }),
  );
});
```

- [x] **Step 2: 写普通文件上传发送测试**

```ts
it("uploads document bytes and sends a file message", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, tenant_access_token: "tat", expire: 7200 }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { file_key: "file_uploaded" } }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { message_id: "om_file" } }), { status: 200 }));
  const api = new FeishuApi({ appId: "app", appSecret: "secret", fetchImpl });

  await expect(api.sendFile("oc_1", "report.pdf", new Uint8Array([1, 2, 3]))).resolves.toEqual({ messageId: "om_file" });

  expect(fetchImpl).toHaveBeenNthCalledWith(
    2,
    "https://open.feishu.cn/open-apis/im/v1/files",
    expect.objectContaining({ method: "POST" }),
  );
  expect(JSON.parse((fetchImpl.mock.calls[2]?.[1] as RequestInit).body as string)).toEqual({
    receive_id: "oc_1",
    msg_type: "file",
    content: JSON.stringify({ file_key: "file_uploaded" }),
  });
});
```

- [x] **Step 3: 写上传失败不文本回退测试**

```ts
it("does not fall back to text when file upload fails", async () => {
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, tenant_access_token: "tat", expire: 7200 }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ code: 999, msg: "upload denied" }), { status: 400 }));
  const api = new FeishuApi({ appId: "app", appSecret: "secret", fetchImpl });

  await expect(api.sendFile("oc_1", "secret.pdf", new Uint8Array([1, 2, 3])))
    .rejects.toThrow("Feishu file upload failed: upload denied");
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
```

- [x] **Step 4: 运行测试确认失败**

Run: `npx vitest run tests/feishu-api.test.ts`

Expected: FAIL，当前 `sendFile()` 仍走 text。

- [x] **Step 5: 实现 upload helpers**

在 `src/feishu/api.ts` 增加：

```ts
function isImageFilename(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(filename);
}

async function uploadImage(filename: string, contents: Uint8Array): Promise<string>
async function uploadFile(filename: string, contents: Uint8Array): Promise<string>
```

用 `FormData` + `Blob` 发送 multipart：

- image: field `image_type = message`，field `image = Blob(contents)`。
- file: field `file_type = stream`，field `file_name = filename`，field `file = Blob(contents)`。

不要手动设置 multipart `Content-Type`，让 runtime 自动生成 boundary。

- [x] **Step 6: sendFile 真实发送**

`sendFile()`：

- string contents 用 `new TextEncoder().encode(contents)`。
- image 文件上传后调用 `postJson` 发 `msg_type: "image"`。
- 普通文件上传后调用 `postJson` 发 `msg_type: "file"`。
- `threadId` 暂时映射为 body 里的 `uuid` 不正确，不要乱填；如果 Feishu API 需要 reply/thread，另开任务查官方参数。当前只确保不丢 `options` 类型。

- [x] **Step 7: 运行测试确认通过**

Run: `npx vitest run tests/feishu-api.test.ts`

Expected: PASS。

- [x] **Step 8: 提交**

```bash
git add src/feishu/api.ts tests/feishu-api.test.ts
git commit -m "feat: send real Feishu file messages"
```

## Task 5: Feishu 附件路径安全补强

**Files:**
- Modify: `src/feishu/delivery.ts`
- Modify: `src/feishu/api.ts`
- Test: `tests/feishu-delivery.test.ts`
- Test: `tests/feishu-api.test.ts`

- [x] **Step 1: 写恶意文件名和重名附件测试**

在 `tests/feishu-delivery.test.ts` 增加：

```ts
it("sanitizes dangerous attachment names and avoids overwriting duplicates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "feishu-delivery-safe-"));
  try {
    const written: string[] = [];
    const api = {
      sendMessage: vi.fn().mockResolvedValue({ messageId: "om_reply" }),
      sendFile: vi.fn(),
      downloadAttachment: vi.fn(async (_attachment, targetPath: string) => {
        written.push(targetPath);
        await import("node:fs/promises").then(({ writeFile }) => writeFile(targetPath, "body", "utf8"));
      }),
    };
    const bridge = { handleAuthorizedMessage: vi.fn().mockResolvedValue({ text: "完成" }) };

    await handleFeishuMessage(message({
      attachments: [
        { id: "file/../1", name: "../../secret.txt", kind: "document" },
        { id: "file/../1", name: "../../secret.txt", kind: "document" },
        { id: "CON", name: "CON", kind: "document" },
      ],
    }), { api, bridge, inboxDir: root });

    expect(written).toHaveLength(3);
    expect(new Set(written).size).toBe(3);
    for (const file of written) {
      expect(file.startsWith(`${path.resolve(root)}${path.sep}`)).toBe(true);
      expect(path.basename(file)).not.toBe("CON");
    }
  } finally {
    await removeTempRoot(root);
  }
});
```

- [x] **Step 2: 写 API root containment 测试**

在 `tests/feishu-api.test.ts` 增加：

```ts
it("rejects attachment downloads outside the configured root directory", async () => {
  const api = new FeishuApi({ appId: "app", appSecret: "secret", fetchImpl: vi.fn() });
  await expect(api.downloadAttachment(
    { id: "file_v2_1", sourceMessageId: "om_1", resourceType: "file", kind: "document" },
    "/tmp/escape.bin",
    { rootDir: "/tmp/inbox" },
  )).rejects.toThrow("Feishu attachment target escaped root directory");
});
```

- [x] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/feishu-delivery.test.ts tests/feishu-api.test.ts`

Expected: FAIL，重名覆盖、Windows 保留名和 `downloadAttachment` 第三个参数未实现。

- [x] **Step 4: 实现 filename utility**

在 `src/feishu/delivery.ts` 内新增或抽出：

```ts
function safeFeishuFileName(input: { id: string; name?: string; index: number }): string
```

规则：

- 只保留 `[a-zA-Z0-9._-]`，其它变 `-`。
- basename 后如果为空，使用 `attachment`。
- Windows 保留名后追加 `-file`。
- 最大长度 160 字符，保留扩展名。
- 同一批附件按 index 加 `-2`、`-3` 后缀避免覆盖。

- [x] **Step 5: API download root containment**

扩展 `BridgeApi.downloadAttachment` 会影响 transport 接口，先不改接口；在 `FeishuApi.downloadAttachment()` 增加可选第三参：

```ts
async downloadAttachment(
  attachment: BridgeAttachment,
  targetPath: string,
  options?: { rootDir?: string },
): Promise<void>
```

如果 `options.rootDir` 存在：

```ts
const root = path.resolve(options.rootDir);
const target = path.resolve(targetPath);
if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
  throw new Error("Feishu attachment target escaped root directory");
}
```

delivery 层调用时传 `{ rootDir: inboxDir }`。

- [x] **Step 6: 运行测试确认通过**

Run: `npx vitest run tests/feishu-delivery.test.ts tests/feishu-api.test.ts`

Expected: PASS。

- [x] **Step 7: 提交**

```bash
git add src/feishu/delivery.ts src/feishu/api.ts tests/feishu-delivery.test.ts tests/feishu-api.test.ts
git commit -m "fix: harden Feishu attachment paths"
```

## Task 6: 集成验证和文档回填

**Files:**
- Modify: `README.zh-CN.md`
- Modify: `docs/superpowers/plans/2026-05-14-engine-provider-decoupling.md`
- Test: `tests/feishu-event-normalizer.test.ts`
- Test: `tests/webhook-server.test.ts`
- Test: `tests/feishu-delivery.test.ts`
- Test: `tests/feishu-api.test.ts`

- [x] **Step 1: 更新中文 README 的 Feishu 限制说明**

在 Feishu/Railway 部署说明附近增加：

```md
### 飞书群聊和文件

飞书群聊默认只响应已启用群或明确 @bot 的消息，避免普通群消息误触发。
文件和图片会通过飞书上传接口发送；附件下载会清洗文件名并限制在实例 inbox 目录内。
```

- [x] **Step 2: 回填 0514 主计划状态**

在 `docs/superpowers/plans/2026-05-14-engine-provider-decoupling.md` 的 Feishu Hardening 区域标注：

- Task 8-12 已拆分到 `2026-05-14-feishu-hardening.md`。
- 实现完成后同步勾选原 Task 8-12。

- [x] **Step 3: 跑 focused Feishu 测试**

Run:

```bash
npx vitest run tests/feishu-event-normalizer.test.ts tests/webhook-server.test.ts tests/feishu-delivery.test.ts tests/feishu-api.test.ts
```

Expected: PASS。

- [x] **Step 4: 跑全量验证**

Run:

```bash
npm test
npm run build
```

Expected: PASS。

- [x] **Step 5: 手工验收** *(2026-05-14 在 Railway production 上验证通过)*

真实飞书应用验证：

- [x] 私聊 text 能回复 (DeepSeek v4-flash)
- [x] 群聊普通消息不触发
- [x] 群聊 `@bot` 触发
- [x] managed group 无 `@bot` 可以触发
- [x] 图片 / PDF / post 富文本被正常感知（DeepSeek 引擎无工具能力，以文字方式确认接收）

**实施中实际发现并修复的额外问题（不在原 plan 里）：**

1. Claude Code CLI 在容器内以 root 运行时会拒绝 `--dangerously-skip-permissions` —— 新增 `scripts/docker-entrypoint.sh` + `gosu` 把容器以 `node` 用户跑，并设 `IS_SANDBOX=1` 兜底。Commit `5fc8dcb`。
2. 容器内 PID 1 在 Railway 重启后被 instance lock 误判为「另一个活进程」，导致服务 crashloop —— 改 `isProcessAlive` 判定：同 PID 视为 stale。Commit `65c0e79`。
3. Railway env `FEISHU_ENGINE` / `FEISHU_PROVIDER` 在 volume 已存在 `config.json` 时不会触发 bootstrap 覆盖，需要手动删除 `/data/cc-bridge-feishu/config.json` 后重启才能让新 env 生效。这是设计约束，记录为运维 note。

- [x] **Step 6: 提交**

```bash
git add README.zh-CN.md docs/superpowers/plans/2026-05-14-engine-provider-decoupling.md docs/superpowers/plans/2026-05-14-feishu-hardening.md
git commit -m "docs: plan Feishu hardening work"
```

## 实施顺序

1. Task 1 mention 解析先做，因为群聊唤醒依赖 `mentionedBot`。
2. Task 2 群聊策略第二做，先防误唤醒。
3. Task 3 富文本提取第三做，提升输入质量。
4. Task 5 附件路径安全第四做，先补安全边界。
5. Task 4 文件真实发送第五做，涉及 multipart 和飞书 API 行为，独立验证。
6. Task 6 最后做文档和真实飞书验收。

## 验收标准

- Feishu 群聊默认 `managed_or_mention`，普通群消息不会误触发。
- Feishu mention 能解析 `open_id/user_id/union_id/name/key`，并能根据 bot identity 判断 `mentionedBot`。
- `post`、`interactive`、`share_chat`、`share_user`、`merge_forward` 都有稳定文本提取。
- `sendFile()` 不再把文件内容塞进 text，而是走飞书 image/file upload。
- 附件落盘不会目录逃逸，不会覆盖同名附件，不会生成 Windows 保留名。
- `npx vitest run tests/feishu-event-normalizer.test.ts tests/webhook-server.test.ts tests/feishu-delivery.test.ts tests/feishu-api.test.ts` 通过。
- `npm test` 和 `npm run build` 通过。
