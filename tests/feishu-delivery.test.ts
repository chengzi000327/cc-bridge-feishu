import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { handleFeishuMessage, toFeishuBridgeNumericId } from "../src/feishu/delivery.js";
import type { BridgeMessage } from "../src/transport/types.js";
import { removeTempRoot } from "./helpers/temp-files.js";

function message(overrides: Partial<BridgeMessage> = {}): BridgeMessage {
  return {
    platform: "feishu",
    updateId: "evt_1",
    chatId: "oc_1",
    userId: "ou_1",
    chatType: "private",
    conversationKey: "feishu:oc_1",
    text: "你好",
    attachments: [],
    ...overrides,
  };
}

describe("handleFeishuMessage", () => {
  it("routes text through bridge and replies to Feishu", async () => {
    const api = {
      sendMessage: vi.fn().mockResolvedValue({ messageId: "om_reply" }),
      sendFile: vi.fn(),
      downloadAttachment: vi.fn(),
    };
    const bridge = {
      handleAuthorizedMessage: vi.fn().mockResolvedValue({ text: "完成" }),
    };

    await handleFeishuMessage(message(), {
      api,
      bridge,
      inboxDir: "/tmp/inbox",
    });

    expect(bridge.handleAuthorizedMessage).toHaveBeenCalledWith(expect.objectContaining({
      chatId: toFeishuBridgeNumericId("oc_1"),
      userId: toFeishuBridgeNumericId("ou_1"),
      chatType: "private",
      conversationKey: "feishu:oc_1",
      text: "你好",
      files: [],
    }));
    expect(api.sendMessage).toHaveBeenCalledWith("oc_1", "完成", undefined);
  });

  it("ignores non-managed group messages without bot mention by default", async () => {
    const api = {
      sendMessage: vi.fn(),
      sendFile: vi.fn(),
      downloadAttachment: vi.fn(),
    };
    const bridge = {
      handleAuthorizedMessage: vi.fn(),
    };

    await handleFeishuMessage(message({
      chatType: "group",
      chatId: "oc_random",
      conversationKey: "feishu:oc_random",
      mentionedBot: false,
    }), {
      api,
      bridge,
      inboxDir: "/tmp/inbox",
    });

    expect(bridge.handleAuthorizedMessage).not.toHaveBeenCalled();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

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
      managedGroupIds: [toFeishuBridgeNumericId("oc_managed")],
    });

    expect(bridge.handleAuthorizedMessage).toHaveBeenCalledOnce();
  });

  it("processes mention-only group messages when bot is mentioned", async () => {
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
      chatId: "oc_random",
      conversationKey: "feishu:oc_random",
      mentionedBot: true,
    }), {
      api,
      bridge,
      inboxDir: "/tmp/inbox",
      groupPolicy: "mention_only",
    });

    expect(bridge.handleAuthorizedMessage).toHaveBeenCalledOnce();
  });

  it("processes any group message when policy is all", async () => {
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
      chatId: "oc_random",
      conversationKey: "feishu:oc_random",
      mentionedBot: false,
    }), {
      api,
      bridge,
      inboxDir: "/tmp/inbox",
      groupPolicy: "all",
    });

    expect(bridge.handleAuthorizedMessage).toHaveBeenCalledOnce();
  });

  it("downloads attachments into the inbox before invoking bridge", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "feishu-delivery-"));
    try {
      const api = {
        sendMessage: vi.fn().mockResolvedValue({ messageId: "om_reply" }),
        sendFile: vi.fn(),
        downloadAttachment: vi.fn(async (_attachment, targetPath: string) => {
          await import("node:fs/promises").then(({ writeFile }) => writeFile(targetPath, "file-body", "utf8"));
        }),
      };
      const bridge = {
        handleAuthorizedMessage: vi.fn().mockResolvedValue({ text: "完成" }),
      };

      await handleFeishuMessage(message({
        attachments: [{ id: "file_v2_1", name: "report.pdf", kind: "document" }],
      }), {
        api,
        bridge,
        inboxDir: root,
      });

      const payload = bridge.handleAuthorizedMessage.mock.calls[0]?.[0];
      expect(payload.files).toHaveLength(1);
      expect(payload.files[0]).toMatch(/file_v2_1-report\.pdf$/);
      await expect(readFile(payload.files[0], "utf8")).resolves.toBe("file-body");
    } finally {
      await removeTempRoot(root);
    }
  });
});
