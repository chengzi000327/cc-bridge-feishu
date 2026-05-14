import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { Bridge } from "../runtime/bridge.js";
import { handleBridgeMessage } from "../transport/delivery.js";
import type { BridgeApi, BridgeAttachment, BridgeMessage } from "../transport/types.js";

export type FeishuGroupPolicy = "managed_or_mention" | "managed_only" | "mention_only" | "all";

export interface FeishuDeliveryContext {
  api: Pick<BridgeApi, "sendMessage" | "sendFile" | "downloadAttachment">;
  bridge: Pick<Bridge, "handleAuthorizedMessage">;
  inboxDir: string;
  locale?: Parameters<Bridge["handleAuthorizedMessage"]>[0]["locale"];
  abortSignal?: AbortSignal;
  groupPolicy?: FeishuGroupPolicy;
  managedGroupIds?: number[];
}

function sanitizeFileNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function buildInboxFileName(attachment: BridgeAttachment): string {
  const safeId = sanitizeFileNamePart(attachment.id) || "attachment";
  const explicitName = attachment.name ? path.basename(attachment.name) : "";
  const safeName = explicitName ? sanitizeFileNamePart(explicitName) : "";
  return safeName ? `${safeId}-${safeName}` : safeId;
}

async function downloadAttachments(
  api: Pick<BridgeApi, "downloadAttachment">,
  inboxDir: string,
  attachments: BridgeAttachment[],
): Promise<string[]> {
  if (attachments.length === 0) {
    return [];
  }

  await mkdir(inboxDir, { recursive: true });
  const files: string[] = [];
  for (const attachment of attachments) {
    const targetPath = path.resolve(inboxDir, buildInboxFileName(attachment));
    const inboxRoot = path.resolve(inboxDir);
    if (targetPath !== inboxRoot && !targetPath.startsWith(`${inboxRoot}${path.sep}`)) {
      throw new Error("Feishu attachment path escaped inbox directory");
    }
    await api.downloadAttachment(attachment, targetPath);
    files.push(targetPath);
  }
  return files;
}

export function toFeishuBridgeNumericId(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = Math.imul(hash, 31) + char.charCodeAt(0);
    hash >>>= 0;
  }
  return hash;
}

function shouldDeliver(message: BridgeMessage, context: FeishuDeliveryContext): boolean {
  if (message.chatType !== "group") return true;

  const policy: FeishuGroupPolicy = context.groupPolicy ?? "managed_or_mention";
  if (policy === "all") return true;

  const managed = context.managedGroupIds?.includes(toFeishuBridgeNumericId(message.chatId)) ?? false;
  const mentioned = message.mentionedBot ?? false;

  switch (policy) {
    case "managed_only":
      return managed;
    case "mention_only":
      return mentioned;
    case "managed_or_mention":
    default:
      return managed || mentioned;
  }
}

export async function handleFeishuMessage(
  message: BridgeMessage,
  context: FeishuDeliveryContext,
): Promise<void> {
  if (!shouldDeliver(message, context)) {
    return;
  }
  await handleBridgeMessage(message, {
    ...context,
    toNumericId: toFeishuBridgeNumericId,
    downloadAttachments,
  });
}
