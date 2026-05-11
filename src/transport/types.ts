export type BridgePlatform = "telegram" | "feishu";

export interface BridgeAttachment {
  id: string;
  name?: string;
  kind: "audio" | "document" | "image" | "voice";
  mimeType?: string;
  sourceMessageId?: string;
  resourceType?: "file" | "image";
}

export interface BridgeReplyContext {
  messageId: string;
  text: string;
  attachments: BridgeAttachment[];
}

export interface BridgeMessage {
  platform: BridgePlatform;
  updateId: string;
  chatId: string;
  userId: string;
  chatType: "private" | "group";
  threadId?: string;
  conversationKey: string;
  text: string;
  replyContext?: BridgeReplyContext;
  attachments: BridgeAttachment[];
}

export interface BridgeSendOptions {
  threadId?: string;
  disableNotification?: boolean;
  inlineActions?: Array<Array<{ text: string; value: string }>>;
}

export interface BridgeApi {
  sendMessage(chatId: string, text: string, options?: BridgeSendOptions): Promise<{ messageId: string }>;
  sendFile(chatId: string, filename: string, contents: string | Uint8Array, options?: BridgeSendOptions): Promise<{ messageId: string }>;
  downloadAttachment(attachment: BridgeAttachment, targetPath: string): Promise<void>;
}
