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
          content: "{\"text\":\"你好\"}",
        },
      },
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
        attachments: [],
      },
    });
  });

  it("normalizes file messages as document attachments", () => {
    const normalized = normalizeFeishuEvent({
      header: { event_id: "evt_2", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_1" } },
        message: {
          chat_id: "oc_1",
          chat_type: "group",
          message_id: "om_2",
          message_type: "file",
          content: "{\"file_key\":\"file_v2_1\",\"file_name\":\"report.pdf\"}",
        },
      },
    });

    expect(normalized).toMatchObject({
      kind: "message",
      message: {
        chatType: "group",
        text: "",
        attachments: [{ id: "file_v2_1", name: "report.pdf", kind: "document", sourceMessageId: "om_2", resourceType: "file" }],
      },
    });
  });

  it("normalizes image messages as image attachments", () => {
    const normalized = normalizeFeishuEvent({
      header: { event_id: "evt_3", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_1" } },
        message: {
          chat_id: "oc_1",
          chat_type: "group",
          message_id: "om_3",
          message_type: "image",
          content: "{\"image_key\":\"img_v2_1\"}",
        },
      },
    });

    expect(normalized).toMatchObject({
      kind: "message",
      message: {
        text: "",
        attachments: [{ id: "img_v2_1", kind: "image", sourceMessageId: "om_3", resourceType: "image" }],
      },
    });
  });

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

  it("falls back to mention name match when bot identity is name only", () => {
    const normalized = normalizeFeishuEvent({
      header: { event_id: "evt_mention2", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_sender" } },
        message: {
          chat_id: "oc_group",
          chat_type: "group",
          message_id: "om_mention2",
          message_type: "text",
          content: JSON.stringify({
            text: "<at user_id=\"@_user_1\">BridgeBot</at> 早",
          }),
          mentions: [{
            key: "@_user_1",
            id: {},
            name: "BridgeBot",
          }],
        },
      },
    }, { botName: "BridgeBot" });

    expect(normalized).toMatchObject({
      kind: "message",
      message: { mentionedBot: true, text: "早" },
    });
  });

  it("does not flag mentionedBot when bot identity does not match", () => {
    const normalized = normalizeFeishuEvent({
      header: { event_id: "evt_mention3", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_sender" } },
        message: {
          chat_id: "oc_group",
          chat_type: "group",
          message_id: "om_mention3",
          message_type: "text",
          content: JSON.stringify({
            text: "<at user_id=\"ou_other\">Other</at> hi",
          }),
          mentions: [{ key: "@_user_1", id: { open_id: "ou_other" }, name: "Other" }],
        },
      },
    }, { botOpenId: "ou_bot", botName: "BridgeBot" });

    expect(normalized).toMatchObject({
      kind: "message",
      message: { mentionedBot: false },
    });
    expect((normalized as { message: { mentions: unknown[] } }).message.mentions).toHaveLength(1);
  });

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
            zh_cn: {
              title: "日报",
              content: [[
                { tag: "text", text: "完成 A" },
                { tag: "a", text: "链接", href: "https://example.com" },
                { tag: "at", user_name: "张三" },
              ]],
            },
          }),
        },
      },
    });

    expect(normalized).toMatchObject({
      kind: "message",
      message: { text: "日报\n完成 A 链接 https://example.com @张三" },
    });
  });

  it("extracts text from interactive card messages", () => {
    const normalized = normalizeFeishuEvent({
      header: { event_id: "evt_card", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_1" } },
        message: {
          chat_id: "oc_1",
          chat_type: "p2p",
          message_id: "om_card",
          message_type: "interactive",
          content: JSON.stringify({
            title: "审批卡片",
            elements: [{ tag: "markdown", content: "**请审批**" }],
          }),
        },
      },
    });

    expect(normalized).toMatchObject({
      kind: "message",
      message: { text: "审批卡片\n请审批" },
    });
  });

  it("extracts text from share_chat messages", () => {
    const normalized = normalizeFeishuEvent({
      header: { event_id: "evt_sc", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_1" } },
        message: {
          chat_id: "oc_1",
          chat_type: "p2p",
          message_id: "om_sc",
          message_type: "share_chat",
          content: JSON.stringify({ chat_id: "oc_shared", name: "项目群" }),
        },
      },
    });

    expect(normalized).toMatchObject({
      kind: "message",
      message: { text: "分享群聊：项目群 (oc_shared)" },
    });
  });

  it("extracts text from share_user messages", () => {
    const normalized = normalizeFeishuEvent({
      header: { event_id: "evt_su", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_1" } },
        message: {
          chat_id: "oc_1",
          chat_type: "p2p",
          message_id: "om_su",
          message_type: "share_user",
          content: JSON.stringify({ user_id: "ou_shared", name: "李四" }),
        },
      },
    });

    expect(normalized).toMatchObject({
      kind: "message",
      message: { text: "分享用户：李四 (ou_shared)" },
    });
  });

  it("extracts text from merge_forward messages", () => {
    const normalized = normalizeFeishuEvent({
      header: { event_id: "evt_mf", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_1" } },
        message: {
          chat_id: "oc_1",
          chat_type: "p2p",
          message_id: "om_mf",
          message_type: "merge_forward",
          content: JSON.stringify({
            title: "聊天记录",
            messages: [{ sender: "A", text: "hello" }],
          }),
        },
      },
    });

    expect(normalized).toMatchObject({
      kind: "message",
      message: { text: "聊天记录\nA: hello" },
    });
  });

  it("ignores text messages with no body and no attachments", () => {
    const normalized = normalizeFeishuEvent({
      header: { event_id: "evt_empty", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_1" } },
        message: {
          chat_id: "oc_1",
          chat_type: "p2p",
          message_id: "om_empty",
          message_type: "text",
          content: JSON.stringify({ text: "" }),
        },
      },
    });

    expect(normalized).toEqual({ kind: "ignore" });
  });

  it("normalizes audio messages as audio attachments", () => {
    const normalized = normalizeFeishuEvent({
      header: { event_id: "evt_4", event_type: "im.message.receive_v1" },
      event: {
        sender: { sender_id: { open_id: "ou_1" } },
        message: {
          chat_id: "oc_1",
          chat_type: "group",
          message_id: "om_4",
          message_type: "audio",
          content: "{\"file_key\":\"audio_v2_1\",\"file_name\":\"voice.opus\"}",
        },
      },
    });

    expect(normalized).toMatchObject({
      kind: "message",
      message: {
        text: "",
        attachments: [{ id: "audio_v2_1", name: "voice.opus", kind: "audio", sourceMessageId: "om_4", resourceType: "file" }],
      },
    });
  });
});
