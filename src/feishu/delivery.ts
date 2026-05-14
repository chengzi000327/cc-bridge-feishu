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

const WINDOWS_RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

const MAX_FILE_NAME_LENGTH = 160;

function sanitizeFileNamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function avoidWindowsReserved(name: string): string {
  const dot = name.indexOf(".");
  const stem = dot >= 0 ? name.slice(0, dot) : name;
  if (stem && WINDOWS_RESERVED.has(stem.toUpperCase())) {
    const ext = dot >= 0 ? name.slice(dot) : "";
    return `${stem}-file${ext}`;
  }
  return name;
}

function truncateFileName(name: string, max: number): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  if (dot > 0 && name.length - dot <= 16) {
    const ext = name.slice(dot);
    const stem = name.slice(0, dot);
    const keep = Math.max(1, max - ext.length);
    return stem.slice(0, keep) + ext;
  }
  return name.slice(0, max);
}

export function safeFeishuFileName(attachment: BridgeAttachment): string {
  const safeId = sanitizeFileNamePart(attachment.id) || "attachment";
  const explicitName = attachment.name ? path.basename(attachment.name) : "";
  const safeName = explicitName ? sanitizeFileNamePart(explicitName) : "";
  const combined = safeName ? `${safeId}-${safeName}` : safeId;
  const cleaned = combined || "attachment";
  return truncateFileName(avoidWindowsReserved(cleaned), MAX_FILE_NAME_LENGTH);
}

function disambiguate(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2; i < 1000; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new Error("Could not disambiguate Feishu attachment filename");
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
  const inboxRoot = path.resolve(inboxDir);
  const files: string[] = [];
  const used = new Set<string>();
  for (const attachment of attachments) {
    const baseName = safeFeishuFileName(attachment);
    const finalName = disambiguate(baseName, used);
    const targetPath = path.resolve(inboxRoot, finalName);
    if (targetPath !== inboxRoot && !targetPath.startsWith(`${inboxRoot}${path.sep}`)) {
      throw new Error("Feishu attachment path escaped inbox directory");
    }
    await api.downloadAttachment(attachment, targetPath, { rootDir: inboxRoot });
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
