export interface ResponsesRequest {
  model?: string;
  input?: unknown;
  instructions?: string;
  temperature?: number;
  stream?: boolean;
}

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessage[];
  temperature?: number;
  stream: false;
}

export interface ChatCompletionResponse {
  id?: string;
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface ResponsesLikePayload {
  id: string;
  object: "response";
  output: Array<{
    type: "message";
    role: "assistant";
    content: Array<{ type: "output_text"; text: string }>;
  }>;
  output_text: string;
  status: "completed";
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const value = part as { text?: unknown };
      return typeof value.text === "string" ? value.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function messagesFromInput(input: unknown): ChatCompletionMessage[] {
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }

  if (!Array.isArray(input)) {
    return [];
  }

  return input.flatMap((item): ChatCompletionMessage[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as { type?: unknown; role?: unknown; content?: unknown };
    if (value.type !== "message") return [];
    if (value.role !== "user" && value.role !== "assistant" && value.role !== "system") return [];

    const content = textFromContent(value.content);
    if (!content) return [];
    return [{ role: value.role, content }];
  });
}

export function responsesToChatCompletion(request: ResponsesRequest): ChatCompletionRequest {
  const messages = messagesFromInput(request.input);
  const chatMessages: ChatCompletionMessage[] = request.instructions
    ? [{ role: "system", content: request.instructions }, ...messages]
    : messages;

  return {
    model: request.model ?? "",
    messages: chatMessages,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    stream: false,
  };
}

export function chatCompletionToResponses(response: ChatCompletionResponse): ResponsesLikePayload {
  const outputText = response.choices?.[0]?.message?.content ?? "";
  const payload: ResponsesLikePayload = {
    id: response.id ?? "resp_chat_completion",
    object: "response",
    output: [{
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: outputText }],
    }],
    output_text: outputText,
    status: "completed",
  };

  if (response.usage) {
    payload.usage = {
      input_tokens: response.usage.prompt_tokens ?? 0,
      output_tokens: response.usage.completion_tokens ?? 0,
      total_tokens: response.usage.total_tokens ?? 0,
    };
  }

  return payload;
}
