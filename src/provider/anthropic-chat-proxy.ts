import http from "node:http";
import type { AddressInfo } from "node:net";

import type { AnthropicMessagesRequest, ChatCompletionResponse } from "./anthropic-chat-transform.js";
import {
  anthropicMessagesToChat,
  chatCompletionToAnthropicMessage,
} from "./anthropic-chat-transform.js";

export interface AnthropicChatProxyProvider {
  baseUrl?: string;
  model?: string;
  apiKeyEnv?: string;
}

export interface AnthropicChatProxyOptions {
  provider: AnthropicChatProxyProvider;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  port?: number;
  host?: string;
}

export interface AnthropicChatProxy {
  baseUrl: string;
  close(): Promise<void>;
}

interface ProxyResult {
  status: number;
  body: unknown;
  contentType?: string;
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function baseUrlFor(provider: AnthropicChatProxyProvider): string {
  return (provider.baseUrl ?? "https://api.deepseek.com").replace(/\/+$/, "");
}

function modelFor(provider: AnthropicChatProxyProvider, request: AnthropicMessagesRequest): string {
  return provider.model ?? request.model ?? "deepseek-chat";
}

function errorBody(type: string, message: string): { error: { type: string; message: string } } {
  return { error: { type, message } };
}

function responseFromResult(result: ProxyResult): Response {
  const isText = typeof result.body === "string";
  const body = isText ? result.body as string : JSON.stringify(result.body) ?? "";
  return new Response(body, {
    status: result.status,
    headers: {
      "Content-Type": result.contentType
        ?? (isText ? "text/plain; charset=utf-8" : "application/json; charset=utf-8"),
    },
  });
}

async function handleRequest(
  input: { method: string; path: string; body?: unknown },
  options: Required<Pick<AnthropicChatProxyOptions, "fetchImpl" | "env">> & Pick<AnthropicChatProxyOptions, "provider">,
): Promise<ProxyResult> {
  if (input.method === "GET" && input.path === "/health") {
    return { status: 200, body: "ok" };
  }

  if (input.method !== "POST" || input.path !== "/v1/messages") {
    return { status: 404, body: errorBody("not_found_error", "not found") };
  }

  const apiKeyEnv = options.provider.apiKeyEnv ?? "DEEPSEEK_API_KEY";
  const apiKey = options.env[apiKeyEnv];
  if (!apiKey) {
    return {
      status: 500,
      body: errorBody("api_error", `${apiKeyEnv} is required for Anthropic chat proxy`),
    };
  }

  const anthropicRequest = input.body as AnthropicMessagesRequest;
  const model = modelFor(options.provider, anthropicRequest);
  const upstreamResponse = await options.fetchImpl(`${baseUrlFor(options.provider)}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(anthropicMessagesToChat(anthropicRequest, model)),
  });
  const json = await upstreamResponse.json() as ChatCompletionResponse;

  if (!upstreamResponse.ok || json.error) {
    return {
      status: upstreamResponse.status || 502,
      body: errorBody(
        json.error?.type ?? "api_error",
        json.error?.message ?? upstreamResponse.statusText ?? "upstream request failed",
      ),
    };
  }

  return {
    status: 200,
    body: chatCompletionToAnthropicMessage(json, model),
  };
}

export async function createAnthropicChatProxy(options: AnthropicChatProxyOptions): Promise<AnthropicChatProxy> {
  const host = options.host ?? "127.0.0.1";
  const fetchImpl = options.fetchImpl ?? fetch;
  const env = options.env ?? process.env;

  const server = http.createServer(async (req, res) => {
    try {
      const body = req.method === "POST" ? await readJson(req) : undefined;
      const result = await handleRequest({
        method: req.method ?? "GET",
        path: req.url?.split("?")[0] ?? "/",
        body,
      }, {
        provider: options.provider,
        env,
        fetchImpl,
      });
      const response = responseFromResult(result);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(await response.text());
    } catch (error) {
      const response = responseFromResult({
        status: 500,
        body: errorBody("api_error", error instanceof Error ? error.message : String(error)),
      });
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(await response.text());
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://${host}:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    }),
  };
}
