import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  chatCompletionToResponses,
  responsesToChatCompletion,
  type ChatCompletionResponse,
  type ResponsesRequest,
} from "./responses-chat-transform.js";

export interface ResponsesChatProxyProvider {
  baseUrl?: string;
  model?: string;
  apiKeyEnv?: string;
}

export interface ResponsesChatProxyOptions {
  provider: ResponsesChatProxyProvider;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  port?: number;
  host?: string;
}

export interface ResponsesChatProxyHandle {
  baseUrl: string;
  close(): Promise<void>;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function writeText(response: ServerResponse, status: number, body: string): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(body);
}

function chatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

async function jsonOrError(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return { error: { message: `Upstream request failed with status ${response.status}` } };
  }
}

async function handleResponsesRequest(
  body: unknown,
  options: Required<Pick<ResponsesChatProxyOptions, "fetchImpl">> & ResponsesChatProxyOptions,
): Promise<{ status: number; body: unknown }> {
  const apiKeyEnv = options.provider.apiKeyEnv;
  const apiKey = apiKeyEnv ? options.env?.[apiKeyEnv] : undefined;
  if (!apiKeyEnv || !apiKey) {
    return {
      status: 500,
      body: { error: { message: `Missing provider API key env ${apiKeyEnv ?? "apiKeyEnv"}` } },
    };
  }

  if (!options.provider.baseUrl) {
    return { status: 500, body: { error: { message: "Missing provider baseUrl" } } };
  }

  const request = body as ResponsesRequest;
  const chatRequest = responsesToChatCompletion({
    ...request,
    model: request.model ?? options.provider.model,
  });
  const upstream = await options.fetchImpl(chatCompletionsUrl(options.provider.baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(chatRequest),
  });
  const upstreamBody = await jsonOrError(upstream);

  if (!upstream.ok) {
    return { status: upstream.status, body: upstreamBody };
  }

  return {
    status: 200,
    body: chatCompletionToResponses(upstreamBody as ChatCompletionResponse),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: Required<Pick<ResponsesChatProxyOptions, "fetchImpl">> & ResponsesChatProxyOptions,
): Promise<void> {
  const path = request.url?.split("?")[0] ?? "/";

  if (request.method === "GET" && path === "/health") {
    writeText(response, 200, "ok");
    return;
  }

  if (request.method !== "POST" || path !== "/v1/responses") {
    writeJson(response, 404, { error: { message: "not found" } });
    return;
  }

  try {
    const result = await handleResponsesRequest(await readJson(request), options);
    writeJson(response, result.status, result.body);
  } catch (error) {
    writeJson(response, 500, {
      error: { message: error instanceof Error ? error.message : String(error) },
    });
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function createResponsesChatProxy(options: ResponsesChatProxyOptions): Promise<ResponsesChatProxyHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const proxyOptions = {
    ...options,
    env: options.env ?? process.env,
    fetchImpl: options.fetchImpl ?? fetch,
  };
  const server = createServer((request, response) => {
    void handleRequest(request, response, proxyOptions);
  });

  await listen(server, port, host);
  const address = server.address();
  if (!address || typeof address === "string") {
    await close(server);
    throw new Error("Responses chat proxy did not bind to a TCP port");
  }

  return {
    baseUrl: `http://${host}:${address.port}`,
    close: () => close(server),
  };
}
