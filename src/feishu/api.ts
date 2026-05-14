import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BridgeApi, BridgeAttachment, BridgeDownloadOptions, BridgeSendOptions } from "../transport/types.js";

interface FeishuApiOptions {
  appId: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
  apiBaseUrl?: string;
}

interface FeishuEnvelope<T> {
  code?: number;
  msg?: string;
  data?: T;
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
    if (this.token && Date.now() < this.token.expiresAt) {
      return this.token.value;
    }

    const response = await this.fetchImpl(`${this.apiBaseUrl}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: this.options.appId, app_secret: this.options.appSecret }),
    });
    const json = await response.json() as {
      code?: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    };

    if (!response.ok || json.code !== 0 || !json.tenant_access_token) {
      throw new Error(`Feishu token request failed: ${json.msg ?? response.statusText}`);
    }

    const refreshWindowSeconds = Math.max(60, (json.expire ?? 7200) - 300);
    this.token = {
      value: json.tenant_access_token,
      expiresAt: Date.now() + refreshWindowSeconds * 1000,
    };
    return this.token.value;
  }

  private async postJson<T>(url: string, body: unknown): Promise<T> {
    const token = await this.tenantAccessToken();
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const json = await response.json() as FeishuEnvelope<T>;

    if (!response.ok || json.code !== 0 || json.data === undefined) {
      throw new Error(`Feishu API request failed: ${json.msg ?? response.statusText}`);
    }

    return json.data;
  }

  async sendMessage(chatId: string, text: string, _options?: BridgeSendOptions): Promise<{ messageId: string }> {
    const data = await this.postJson<{ message_id: string }>(
      `${this.apiBaseUrl}/im/v1/messages?receive_id_type=chat_id`,
      {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    );
    return { messageId: data.message_id };
  }

  async sendFile(
    chatId: string,
    filename: string,
    contents: string | Uint8Array,
    options?: BridgeSendOptions,
  ): Promise<{ messageId: string }> {
    const text = typeof contents === "string" ? contents : new TextDecoder().decode(contents);
    return this.sendMessage(chatId, `文件 ${filename}\n\n${text.slice(0, 30000)}`, options);
  }

  async downloadAttachment(attachment: BridgeAttachment, targetPath: string, options?: BridgeDownloadOptions): Promise<void> {
    if (options?.rootDir) {
      const root = path.resolve(options.rootDir);
      const target = path.resolve(targetPath);
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
        throw new Error("Feishu attachment target escaped root directory");
      }
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    const token = await this.tenantAccessToken();
    const messageId = attachment.sourceMessageId ?? attachment.id;
    const resourceType = attachment.resourceType ?? (attachment.kind === "image" ? "image" : "file");
    const response = await this.fetchImpl(
      `${this.apiBaseUrl}/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(attachment.id)}?type=${encodeURIComponent(resourceType)}`,
      {
      headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!response.ok) {
      throw new Error(`Feishu attachment download failed: ${response.status} ${response.statusText}`);
    }

    await writeFile(targetPath, new Uint8Array(await response.arrayBuffer()));
  }
}
