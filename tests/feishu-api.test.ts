import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { FeishuApi } from "../src/feishu/api.js";

describe("FeishuApi", () => {
  it("fetches and caches tenant access token when sending text messages", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, tenant_access_token: "tat", expire: 7200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { message_id: "om_reply_1" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, data: { message_id: "om_reply_2" } }), { status: 200 }));

    const api = new FeishuApi({ appId: "app", appSecret: "secret", fetchImpl });

    await expect(api.sendMessage("oc_1", "你好")).resolves.toEqual({ messageId: "om_reply_1" });
    await expect(api.sendMessage("oc_1", "第二条")).resolves.toEqual({ messageId: "om_reply_2" });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ app_id: "app", app_secret: "secret" }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tat" }),
        body: JSON.stringify({
          receive_id: "oc_1",
          msg_type: "text",
          content: JSON.stringify({ text: "你好" }),
        }),
      }),
    );
  });

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
    const sendCall = fetchImpl.mock.calls[2];
    expect(sendCall?.[0]).toBe("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id");
    expect(JSON.parse(sendCall?.[1]?.body as string)).toEqual({
      receive_id: "oc_1",
      msg_type: "image",
      content: JSON.stringify({ image_key: "img_uploaded" }),
    });
  });

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
    expect(JSON.parse(fetchImpl.mock.calls[2]?.[1]?.body as string)).toEqual({
      receive_id: "oc_1",
      msg_type: "file",
      content: JSON.stringify({ file_key: "file_uploaded" }),
    });
  });

  it("does not fall back to text when file upload fails", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, tenant_access_token: "tat", expire: 7200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 999, msg: "upload denied" }), { status: 400 }));
    const api = new FeishuApi({ appId: "app", appSecret: "secret", fetchImpl });

    await expect(api.sendFile("oc_1", "secret.pdf", new Uint8Array([1, 2, 3])))
      .rejects.toThrow("Feishu file upload failed: upload denied");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("downloads attachment bytes to the target path", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, tenant_access_token: "tat", expire: 7200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(bytes, { status: 200 }));
    const api = new FeishuApi({ appId: "app", appSecret: "secret", fetchImpl });
    const dir = path.join(tmpdir(), `feishu-api-${process.pid}-${Date.now()}`);
    const targetPath = path.join(dir, "nested", "voice.bin");
    await mkdir(dir, { recursive: true });

    await api.downloadAttachment({ id: "file_v2_1", sourceMessageId: "om_1", resourceType: "file", kind: "voice" }, targetPath);

    expect(await readFile(targetPath)).toEqual(Buffer.from(bytes));
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://open.feishu.cn/open-apis/im/v1/messages/om_1/resources/file_v2_1?type=file",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tat" }),
      }),
    );
  });

  it("rejects attachment downloads outside the configured root directory", async () => {
    const fetchImpl = vi.fn();
    const api = new FeishuApi({ appId: "app", appSecret: "secret", fetchImpl });
    await expect(api.downloadAttachment(
      { id: "file_v2_1", sourceMessageId: "om_1", resourceType: "file", kind: "document" },
      "/tmp/escape.bin",
      { rootDir: "/tmp/feishu-inbox-root" },
    )).rejects.toThrow("Feishu attachment target escaped root directory");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses image resource type when downloading image attachments", async () => {
    const bytes = new Uint8Array([5, 6]);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, tenant_access_token: "tat", expire: 7200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(bytes, { status: 200 }));
    const api = new FeishuApi({ appId: "app", appSecret: "secret", fetchImpl });
    const dir = path.join(tmpdir(), `feishu-api-image-${process.pid}-${Date.now()}`);
    const targetPath = path.join(dir, "image.bin");

    await api.downloadAttachment({ id: "img_v2_1", sourceMessageId: "om_img", kind: "image", resourceType: "image" }, targetPath);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      "https://open.feishu.cn/open-apis/im/v1/messages/om_img/resources/img_v2_1?type=image",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer tat" }),
      }),
    );
  });
});
