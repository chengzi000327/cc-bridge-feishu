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
});
