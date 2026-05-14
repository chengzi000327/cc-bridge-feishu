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
