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
        attachments: [{ id: "file_v2_1", name: "report.pdf", kind: "document" }],
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
        attachments: [{ id: "img_v2_1", kind: "image" }],
      },
    });
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
        attachments: [{ id: "audio_v2_1", name: "voice.opus", kind: "audio" }],
      },
    });
  });
});
