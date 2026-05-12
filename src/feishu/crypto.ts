import { createDecipheriv, createHash } from "node:crypto";

export interface FeishuCryptoOptions {
  verificationToken?: string;
  encryptKey?: string;
}

export function assertFeishuToken(body: unknown, expectedToken?: string): void {
  if (!expectedToken) return;

  const payload = body as { token?: unknown; header?: { token?: unknown } } | undefined;
  const token = payload?.token ?? payload?.header?.token;
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
  const encrypt = (body as { encrypt?: unknown } | undefined)?.encrypt;
  if (typeof encrypt === "string") {
    if (!options.encryptKey) {
      throw new Error("Feishu encrypted event received but FEISHU_ENCRYPT_KEY is not configured");
    }

    const decrypted = decryptFeishuPayload(encrypt, options.encryptKey);
    assertFeishuToken(decrypted, options.verificationToken);
    return decrypted;
  }

  assertFeishuToken(body, options.verificationToken);
  return body;
}
