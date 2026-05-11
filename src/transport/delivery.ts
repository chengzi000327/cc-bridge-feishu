import type { Bridge } from "../runtime/bridge.js";
import type { BridgeApi, BridgeAttachment, BridgeMessage, BridgeSendOptions } from "./types.js";

export interface BridgeMessageDeliveryContext {
  api: Pick<BridgeApi, "sendMessage" | "sendFile" | "downloadAttachment">;
  bridge: Pick<Bridge, "handleAuthorizedMessage">;
  inboxDir: string;
  locale?: Parameters<Bridge["handleAuthorizedMessage"]>[0]["locale"];
  abortSignal?: AbortSignal;
  toNumericId(value: string): number;
  downloadAttachments(
    api: Pick<BridgeApi, "downloadAttachment">,
    inboxDir: string,
    attachments: BridgeAttachment[],
  ): Promise<string[]>;
}

function toReplyContext(
  message: BridgeMessage,
  toNumericId: (value: string) => number,
): Parameters<Bridge["handleAuthorizedMessage"]>[0]["replyContext"] {
  if (!message.replyContext) {
    return undefined;
  }

  return {
    messageId: toNumericId(message.replyContext.messageId),
    text: message.replyContext.text,
  };
}

function sendOptionsFor(message: BridgeMessage): BridgeSendOptions | undefined {
  return message.threadId ? { threadId: message.threadId } : undefined;
}

export async function handleBridgeMessage(
  message: BridgeMessage,
  context: BridgeMessageDeliveryContext,
): Promise<void> {
  const files = await context.downloadAttachments(context.api, context.inboxDir, message.attachments);
  const response = await context.bridge.handleAuthorizedMessage({
    chatId: context.toNumericId(message.chatId),
    userId: context.toNumericId(message.userId),
    chatType: message.chatType,
    locale: context.locale,
    text: message.text,
    replyContext: toReplyContext(message, context.toNumericId),
    conversationKey: message.conversationKey,
    files,
    abortSignal: context.abortSignal,
  });

  if (response.text.trim()) {
    await context.api.sendMessage(message.chatId, response.text, sendOptionsFor(message));
  }
}
