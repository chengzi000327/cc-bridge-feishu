import { getConversationKey } from "../transport/conversation-key.js";
import type { BridgeAttachment, BridgeMessage } from "../transport/types.js";

export type NormalizedFeishuEvent =
  | { kind: "challenge"; challenge: string }
  | { kind: "message"; message: BridgeMessage }
  | { kind: "ignore" };

function parseContent(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.trim() === "") return {};

  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function normalizeText(messageType: string, content: Record<string, unknown>): string {
  if (messageType === "text" && typeof content.text === "string") return content.text;
  if (messageType === "post") return JSON.stringify(content);
  return "";
}

function optionalName(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeAttachments(messageType: string, content: Record<string, unknown>): BridgeAttachment[] {
  if (messageType === "image" && typeof content.image_key === "string") {
    return [{ id: content.image_key, kind: "image" }];
  }

  if (messageType === "audio" && typeof content.file_key === "string") {
    return [{ id: content.file_key, name: optionalName(content.file_name), kind: "audio" }];
  }

  if (messageType === "file" && typeof content.file_key === "string") {
    return [{ id: content.file_key, name: optionalName(content.file_name), kind: "document" }];
  }

  return [];
}

export function normalizeFeishuEvent(body: unknown): NormalizedFeishuEvent {
  const raw = body as {
    type?: unknown;
    challenge?: unknown;
    header?: { event_id?: unknown; event_type?: unknown };
    event?: {
      sender?: { sender_id?: { open_id?: unknown } };
      message?: {
        chat_id?: unknown;
        chat_type?: unknown;
        message_id?: unknown;
        message_type?: unknown;
        content?: unknown;
        thread_id?: unknown;
      };
    };
  };

  if (raw?.type === "url_verification" && typeof raw.challenge === "string") {
    return { kind: "challenge", challenge: raw.challenge };
  }

  if (raw?.header?.event_type !== "im.message.receive_v1") {
    return { kind: "ignore" };
  }

  const eventId = raw.header.event_id;
  const message = raw.event?.message;
  const userId = raw.event?.sender?.sender_id?.open_id;

  if (
    typeof eventId !== "string" ||
    typeof message !== "object" ||
    message === null ||
    typeof message.chat_id !== "string" ||
    typeof userId !== "string" ||
    typeof message.message_id !== "string" ||
    typeof message.message_type !== "string"
  ) {
    return { kind: "ignore" };
  }

  const chatId = message.chat_id;
  const messageType = message.message_type;
  const content = parseContent(message.content);
  const threadId = typeof message.thread_id === "string" ? message.thread_id : undefined;
  const chatType = message.chat_type === "p2p" ? "private" : "group";
  const conversationKey = getConversationKey({ platform: "feishu", chatId, threadId });

  return {
    kind: "message",
    message: {
      platform: "feishu",
      updateId: eventId,
      chatId,
      userId,
      chatType,
      threadId,
      conversationKey,
      text: normalizeText(messageType, content),
      attachments: normalizeAttachments(messageType, content),
    },
  };
}
