import http from "node:http";

import { parseFeishuEventBody } from "./crypto.js";
import { normalizeFeishuEvent } from "./event-normalizer.js";
import type { BridgeMessage } from "../transport/types.js";

export interface FeishuWebhookOptions {
  verificationToken?: string;
  encryptKey?: string;
  onMessage(message: BridgeMessage): Promise<void>;
  onMessageError?(error: unknown, message: BridgeMessage): void;
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function handleRequest(
  input: { method: string; path: string; body?: unknown },
  options: FeishuWebhookOptions,
): Promise<{ status: number; body: unknown }> {
  if (input.method === "GET" && input.path === "/health") {
    return { status: 200, body: "ok" };
  }

  if (input.method !== "POST" || input.path !== "/feishu/events") {
    return { status: 404, body: { error: "not found" } };
  }

  const parsed = parseFeishuEventBody(input.body, {
    verificationToken: options.verificationToken,
    encryptKey: options.encryptKey,
  });
  const event = normalizeFeishuEvent(parsed);

  if (event.kind === "challenge") {
    return { status: 200, body: { challenge: event.challenge } };
  }

  if (event.kind === "message") {
    void Promise.resolve(options.onMessage(event.message)).catch((error) => {
      options.onMessageError?.(error, event.message);
    });
  }

  return { status: 200, body: { ok: true } };
}

function responseFromResult(result: { status: number; body: unknown }): Response {
  const isText = typeof result.body === "string";
  const body: string = isText ? result.body as string : JSON.stringify(result.body) ?? "";
  return new Response(body, {
    status: result.status,
    headers: {
      "Content-Type": isText ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    },
  });
}

export function createFeishuWebhookServer(options: FeishuWebhookOptions) {
  return {
    async inject(input: { method: string; path: string; body?: string }): Promise<Response> {
      const result = await handleRequest({
        method: input.method,
        path: input.path,
        body: input.body ? JSON.parse(input.body) : undefined,
      }, options);
      return responseFromResult(result);
    },

    listen(port: number, host = "0.0.0.0"): http.Server {
      const server = http.createServer(async (req, res) => {
        try {
          const body = req.method === "POST" ? await readJson(req) : undefined;
          const result = await handleRequest({
            method: req.method ?? "GET",
            path: req.url?.split("?")[0] ?? "/",
            body,
          }, options);
          const response = responseFromResult(result);
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(await response.text());
        } catch (error) {
          console.error(`Feishu webhook request failed: ${error instanceof Error ? error.message : String(error)}`);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
      });
      server.listen(port, host);
      return server;
    },
  };
}
