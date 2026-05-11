export function getConversationKey(input: { platform: string; chatId: string; threadId?: string }): string {
  return input.threadId ? `${input.platform}:${input.chatId}:${input.threadId}` : `${input.platform}:${input.chatId}`;
}
