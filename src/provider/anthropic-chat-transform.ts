export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicTextBlock[];
}

export interface AnthropicMessagesRequest {
  model?: string;
  system?: string | AnthropicTextBlock[];
  messages?: AnthropicMessage[];
  max_tokens?: number;
  temperature?: number;
}

export interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  max_tokens?: number;
  temperature?: number;
  stream: false;
}

export interface ChatCompletionResponse {
  id?: string;
  choices?: Array<{
    message?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  error?: {
    type?: string;
    message?: string;
  };
}

function textFromContent(content: string | AnthropicTextBlock[] | undefined): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is AnthropicTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function stopReasonFrom(finishReason: string | undefined): string {
  if (finishReason === "length") return "max_tokens";
  if (finishReason === "tool_calls") return "tool_use";
  return "end_turn";
}

export function anthropicMessagesToChat(
  request: AnthropicMessagesRequest,
  modelOverride?: string,
): ChatCompletionRequest {
  const messages: ChatCompletionRequest["messages"] = [];
  const system = textFromContent(request.system).trim();
  if (system) {
    messages.push({ role: "system", content: system });
  }

  for (const message of request.messages ?? []) {
    const content = textFromContent(message.content).trim();
    if (content) {
      messages.push({ role: message.role, content });
    }
  }

  return {
    model: modelOverride ?? request.model ?? "deepseek-chat",
    messages,
    temperature: request.temperature,
    max_tokens: request.max_tokens,
    stream: false,
  };
}

export function chatCompletionToAnthropicMessage(
  response: ChatCompletionResponse,
  model: string,
) {
  const choice = response.choices?.[0];
  const text = choice?.message?.content ?? "";
  return {
    id: response.id ?? "msg_deepseek_proxy",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text }],
    stop_reason: stopReasonFrom(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  };
}
