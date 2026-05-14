import { describe, expect, it, vi } from "vitest";

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
      body: JSON.stringify({ token: "t", type: "url_verification", challenge: "abc" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "abc" });
  });

  it("passes normalized messages to the handler", async () => {
    const onMessage = vi.fn();
    const server = createFeishuWebhookServer({ verificationToken: "t", onMessage });

    const response = await server.inject({
      method: "POST",
      path: "/feishu/events",
      body: JSON.stringify({
        token: "t",
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
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
      platform: "feishu",
      updateId: "evt_1",
      text: "你好",
    }));
  });

  it("propagates bot identity so the bot mention is detected", async () => {
    const onMessage = vi.fn();
    const server = createFeishuWebhookServer({
      verificationToken: "t",
      botOpenId: "ou_bot",
      botName: "BridgeBot",
      onMessage,
    });

    await server.inject({
      method: "POST",
      path: "/feishu/events",
      body: JSON.stringify({
        token: "t",
        header: { event_id: "evt_b", event_type: "im.message.receive_v1" },
        event: {
          sender: { sender_id: { open_id: "ou_sender" } },
          message: {
            chat_id: "oc_g",
            chat_type: "group",
            message_id: "om_b",
            message_type: "text",
            content: JSON.stringify({
              text: "<at user_id=\"ou_bot\">BridgeBot</at> hi",
            }),
            mentions: [{ key: "@_user_1", id: { open_id: "ou_bot" }, name: "BridgeBot" }],
          },
        },
      }),
    });

    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
      mentionedBot: true,
      text: "hi",
    }));
  });

  it("acknowledges message events before the handler finishes", async () => {
    let resolveHandler: (() => void) | undefined;
    const onMessage = vi.fn(() => new Promise<void>((resolve) => {
      resolveHandler = resolve;
    }));
    const server = createFeishuWebhookServer({ verificationToken: "t", onMessage });

    const response = await server.inject({
      method: "POST",
      path: "/feishu/events",
      body: JSON.stringify({
        token: "t",
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
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(onMessage).toHaveBeenCalledOnce();
    resolveHandler?.();
  });
});
