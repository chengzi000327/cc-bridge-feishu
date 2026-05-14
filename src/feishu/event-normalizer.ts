import { getConversationKey } from "../transport/conversation-key.js";
import type { BridgeAttachment, BridgeMention, BridgeMessage } from "../transport/types.js";

export interface FeishuBotIdentity {
  botOpenId?: string;
  botUserId?: string;
  botUnionId?: string;
  botName?: string;
}

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

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

interface RawMention {
  key?: unknown;
  id?: { open_id?: unknown; user_id?: unknown; union_id?: unknown } | unknown;
  name?: unknown;
}

function extractRawMentions(message: Record<string, unknown>): BridgeMention[] {
  const list = message.mentions;
  if (!Array.isArray(list)) return [];

  const mentions: BridgeMention[] = [];
  for (const entry of list as RawMention[]) {
    const id = entry?.id && typeof entry.id === "object" ? (entry.id as Record<string, unknown>) : undefined;
    mentions.push({
      key: optionalString(entry?.key),
      openId: optionalString(id?.open_id),
      userId: optionalString(id?.user_id),
      unionId: optionalString(id?.union_id),
      name: optionalString(entry?.name),
    });
  }
  return mentions;
}

interface TextMentionTag {
  raw: string;
  userId?: string;
  name?: string;
}

function findTextMentions(text: string): TextMentionTag[] {
  if (!text) return [];
  const re = /<at\s+([^>]*?)>([^<]*)<\/at>/g;
  const result: TextMentionTag[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const attrs = match[1] ?? "";
    const userIdMatch = /\buser_id\s*=\s*"([^"]+)"/.exec(attrs);
    result.push({
      raw: match[0],
      userId: userIdMatch?.[1],
      name: (match[2] ?? "").trim() || undefined,
    });
  }
  return result;
}

function mergeTextMentions(base: BridgeMention[], tags: TextMentionTag[]): BridgeMention[] {
  const merged = [...base];
  for (const tag of tags) {
    const existing = merged.find((m) => {
      if (tag.userId && (m.openId === tag.userId || m.userId === tag.userId || m.unionId === tag.userId || m.key === tag.userId)) {
        return true;
      }
      if (tag.name && m.name === tag.name) return true;
      return false;
    });
    if (existing) continue;
    merged.push({
      userId: tag.userId,
      name: tag.name,
    });
  }
  return merged;
}

function isBotMention(mention: BridgeMention, identity: FeishuBotIdentity): boolean {
  const hasStrongId = Boolean(identity.botOpenId || identity.botUserId || identity.botUnionId);
  if (identity.botOpenId && mention.openId === identity.botOpenId) return true;
  if (identity.botUserId && (mention.userId === identity.botUserId || mention.openId === identity.botUserId)) return true;
  if (identity.botUnionId && mention.unionId === identity.botUnionId) return true;
  if (!hasStrongId && identity.botName && mention.name === identity.botName) return true;
  return false;
}

function stripBotMentions(text: string, tags: TextMentionTag[], identity: FeishuBotIdentity, mentions: BridgeMention[]): string {
  let result = text;
  for (const tag of tags) {
    const matched = mentions.find((m) => {
      if (tag.userId && (m.openId === tag.userId || m.userId === tag.userId || m.unionId === tag.userId || m.key === tag.userId)) {
        return true;
      }
      if (tag.name && m.name === tag.name) return true;
      return false;
    });
    if (matched && isBotMention(matched, identity)) {
      result = result.split(tag.raw).join("").replace(/\s+/g, " ").trim();
    } else if (tag.name) {
      result = result.split(tag.raw).join(`@${tag.name}`);
    } else {
      result = result.split(tag.raw).join("");
    }
  }
  return result.replace(/\s+/g, " ").trim();
}

function extractPostText(content: Record<string, unknown>): string {
  const post = content.post && typeof content.post === "object" ? (content.post as Record<string, unknown>) : content;
  const localePicked = pickLocalePost(post);
  if (!localePicked) return "";

  const lines: string[] = [];
  const title = optionalString((localePicked as Record<string, unknown>).title);
  if (title) lines.push(title);

  const contentRows = (localePicked as Record<string, unknown>).content;
  if (Array.isArray(contentRows)) {
    for (const row of contentRows as unknown[]) {
      if (!Array.isArray(row)) continue;
      const segments: string[] = [];
      for (const node of row as Array<Record<string, unknown>>) {
        const tag = optionalString(node?.tag);
        if (tag === "text" && typeof node.text === "string") {
          segments.push(node.text);
        } else if (tag === "a") {
          const text = optionalString(node.text) ?? "";
          const href = optionalString(node.href) ?? "";
          segments.push([text, href].filter(Boolean).join(" "));
        } else if (tag === "at") {
          const name = optionalString(node.user_name);
          segments.push(name ? `@${name}` : "@?");
        } else if (tag === "img") {
          const key = optionalString(node.image_key);
          if (key) segments.push(`[image:${key}]`);
        }
      }
      const joined = segments.join(" ").trim();
      if (joined) lines.push(joined);
    }
  }

  return lines.join("\n").trim();
}

function pickLocalePost(post: Record<string, unknown>): Record<string, unknown> | undefined {
  const candidates = ["zh_cn", "zh-cn", "en_us", "en-us", "ja_jp", "ja-jp"];
  for (const key of candidates) {
    const value = post[key];
    if (value && typeof value === "object") return value as Record<string, unknown>;
  }
  if ("title" in post || "content" in post) return post;
  for (const value of Object.values(post)) {
    if (value && typeof value === "object" && ("title" in (value as object) || "content" in (value as object))) {
      return value as Record<string, unknown>;
    }
  }
  return undefined;
}

function flattenMarkdown(text: string): string {
  return text.replace(/`+/g, "").replace(/\*\*/g, "").trim();
}

function extractInteractiveText(content: Record<string, unknown>): string {
  const lines: string[] = [];
  const title = optionalString(content.title)
    ?? optionalString((content.header as Record<string, unknown> | undefined)?.title)
    ?? optionalString(((content.header as Record<string, unknown> | undefined)?.title as Record<string, unknown> | undefined)?.content);
  if (title) lines.push(title);

  const elements = content.elements;
  if (Array.isArray(elements)) {
    for (const element of elements as Array<Record<string, unknown>>) {
      const tag = optionalString(element?.tag);
      if (tag === "markdown" && typeof element.content === "string") {
        lines.push(flattenMarkdown(element.content));
      } else if (tag === "plain_text" && typeof element.content === "string") {
        lines.push(element.content);
      } else if (tag === "div" || tag === "note") {
        const text = (element.text as Record<string, unknown> | undefined)?.content;
        if (typeof text === "string") lines.push(flattenMarkdown(text));
      }
    }
  }

  return lines.join("\n").trim();
}

function extractShareChatText(content: Record<string, unknown>): string {
  const name = optionalString(content.name) ?? "未知群聊";
  const chatId = optionalString(content.chat_id);
  return chatId ? `分享群聊：${name} (${chatId})` : `分享群聊：${name}`;
}

function extractShareUserText(content: Record<string, unknown>): string {
  const name = optionalString(content.name) ?? "未知用户";
  const userId = optionalString(content.user_id);
  return userId ? `分享用户：${name} (${userId})` : `分享用户：${name}`;
}

function extractMergeForwardText(content: Record<string, unknown>): string {
  const lines: string[] = [];
  const title = optionalString(content.title);
  if (title) lines.push(title);
  const messages = content.messages;
  if (Array.isArray(messages)) {
    for (const item of messages as Array<Record<string, unknown>>) {
      const sender = optionalString(item?.sender) ?? optionalString((item?.sender as Record<string, unknown> | undefined)?.name);
      const text = optionalString(item?.text) ?? optionalString(item?.content);
      if (sender && text) lines.push(`${sender}: ${text}`);
      else if (text) lines.push(text);
    }
  }
  return lines.join("\n").trim();
}

function normalizeText(messageType: string, content: Record<string, unknown>): string {
  switch (messageType) {
    case "text":
      return typeof content.text === "string" ? content.text : "";
    case "post":
      return extractPostText(content);
    case "interactive":
      return extractInteractiveText(content);
    case "share_chat":
      return extractShareChatText(content);
    case "share_user":
      return extractShareUserText(content);
    case "merge_forward":
      return extractMergeForwardText(content);
    default:
      return "";
  }
}

function normalizeAttachments(messageId: string, messageType: string, content: Record<string, unknown>): BridgeAttachment[] {
  if (messageType === "image" && typeof content.image_key === "string") {
    return [{ id: content.image_key, kind: "image", sourceMessageId: messageId, resourceType: "image" }];
  }

  if (messageType === "audio" && typeof content.file_key === "string") {
    return [{ id: content.file_key, name: optionalString(content.file_name), kind: "audio", sourceMessageId: messageId, resourceType: "file" }];
  }

  if (messageType === "file" && typeof content.file_key === "string") {
    return [{ id: content.file_key, name: optionalString(content.file_name), kind: "document", sourceMessageId: messageId, resourceType: "file" }];
  }

  return [];
}

export function normalizeFeishuEvent(body: unknown, identity: FeishuBotIdentity = {}): NormalizedFeishuEvent {
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
        mentions?: unknown;
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

  const rawMentions = extractRawMentions(message as Record<string, unknown>);
  const initialText = normalizeText(messageType, content);
  const textTags = findTextMentions(initialText);
  const mentions = mergeTextMentions(rawMentions, textTags);
  const mentionedBot = mentions.some((m) => isBotMention(m, identity));
  const cleanedText = stripBotMentions(initialText, textTags, identity, mentions);

  const attachments = normalizeAttachments(message.message_id, messageType, content);

  if (cleanedText === "" && attachments.length === 0) {
    return { kind: "ignore" };
  }

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
      text: cleanedText,
      attachments,
      mentions,
      mentionedBot,
    },
  };
}
