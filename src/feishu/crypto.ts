import { createDecipheriv, createHash } from "node:crypto";

export interface FeishuCryptoOptions {
  verificationToken?: string;
  encryptKey?: string;
}

export function assertFeishuToken(body: unknown, expectedToken?: string): void {
  if (!expectedToken) return;

  const token = (body as { token?: unknown })?.token;
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
  if (options.encryptKey && typeof (body as { encrypt?: unknown })?.encrypt === "string") {
    const decrypted = decryptFeishuPayload((body as { encrypt: string }).encrypt, options.encryptKey);
    assertFeishuToken(decrypted, options.verificationToken);
    return decrypted;
  }

  assertFeishuToken(body, options.verificationToken);
  return body;
}
