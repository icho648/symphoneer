import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";

import {
  ApiErrorSchema,
  CONTRACT_SCHEMA_VERSION,
  type RuntimeProject,
  RuntimeProjectSchema,
} from "@symphoneer/contracts";
import { RuntimeError } from "./errors.ts";
import {
  assertAllowedOrigin,
  assertLoopbackHost,
  assertSessionToken,
  isApiPath,
  tryServeStaticUi,
} from "./host/index.ts";
import type { RuntimeControlPlane } from "./service/index.ts";

const MAX_BODY_BYTES = 64 * 1024;

export interface RuntimeHttpServerOptions {
  host?: "127.0.0.1" | "localhost" | "::1";
  port?: number;
  uiDistDir?: string;
  sessionToken?: string;
  projects?: () => Promise<RuntimeProject[]>;
  addProject?: () => Promise<RuntimeProject>;
  removeProject?: (projectId: string) => Promise<RuntimeProject[]>;
  openCodexThread?: (threadId: string) => Promise<void>;
  assistantHandler?: (
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
  ) => Promise<boolean>;
}

export class RuntimeHttpServer {
  readonly #service: RuntimeControlPlane;
  readonly #host: RuntimeHttpServerOptions["host"];
  readonly #port: number;
  readonly #uiDistDir: string | undefined;
  readonly #sessionToken: string | undefined;
  readonly #projects: RuntimeHttpServerOptions["projects"];
  readonly #addProject: RuntimeHttpServerOptions["addProject"];
  readonly #removeProject: RuntimeHttpServerOptions["removeProject"];
  readonly #openCodexThread: RuntimeHttpServerOptions["openCodexThread"];
  readonly #assistantHandler: RuntimeHttpServerOptions["assistantHandler"];
  readonly #server: Server;
  readonly #streams = new Set<ServerResponse>();

  constructor(service: RuntimeControlPlane, options: RuntimeHttpServerOptions = {}) {
    this.#service = service;
    this.#host = options.host ?? "127.0.0.1";
    this.#port = options.port ?? 0;
    this.#uiDistDir = options.uiDistDir;
    this.#sessionToken = options.sessionToken;
    this.#projects = options.projects;
    this.#addProject = options.addProject;
    this.#removeProject = options.removeProject;
    this.#openCodexThread = options.openCodexThread;
    this.#assistantHandler = options.assistantHandler;
    this.#server = createServer((request, response) => {
      void this.#handle(request, response);
    });
  }

  async listen(): Promise<{ host: string; port: number; url: string }> {
    await this.#service.start();
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        this.#server.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.#server.off("error", onError);
        resolve();
      };
      this.#server.once("error", onError);
      this.#server.once("listening", onListening);
      this.#server.listen(this.#port, this.#host);
    });
    const address = this.#server.address();
    if (!address || typeof address === "string") {
      throw new RuntimeError("conflict", "Runtime did not expose a loopback address");
    }
    const host = address.address === "::" ? "127.0.0.1" : address.address;
    const urlHost = host.includes(":") ? `[${host}]` : host;
    const url = `http://${urlHost}:${address.port}`;
    this.#service.setEndpoint(url);
    return { host, port: address.port, url };
  }

  async close(): Promise<void> {
    for (const stream of [...this.#streams]) {
      stream.end();
      stream.destroy();
    }
    this.#streams.clear();
    await this.#service.stop();
    if (!this.#server.listening) return;
    this.#server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.#server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      assertLoopbackHost(request.headers.host);
      assertAllowedOrigin(request.headers.origin, { requireOrigin: false });
      if (isApiPath(url.pathname) && url.pathname !== "/healthz") {
        assertSessionToken(request, this.#sessionToken);
      }

      if (
        request.method === "GET" &&
        url.pathname === "/v1/assistant/status" &&
        !this.#assistantHandler
      ) {
        sendJson(response, 200, { state: "disabled", reason: "missing_config" });
        return;
      }

      if (
        url.pathname.startsWith("/v1/assistant/") &&
        this.#assistantHandler &&
        (await this.#assistantHandler(request, response, url))
      ) {
        return;
      }

      if (request.method === "GET") {
        await this.#get(url, request, response);
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/commands") {
        const body = await readJson(request);
        sendJson(response, 200, await this.#service.execute(body));
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/projects") {
        if (!this.#addProject) {
          throw new RuntimeError("unsupported", "Adding projects is not available");
        }
        sendJson(response, 200, RuntimeProjectSchema.parse(await this.#addProject()));
        return;
      }
      if (request.method === "POST" && url.pathname === "/v1/host/codex-thread") {
        if (!this.#openCodexThread) {
          throw new RuntimeError("unsupported", "Opening Codex is not available");
        }
        const body = await readJson(request);
        await this.#openCodexThread(readCodexThreadId(body));
        sendJson(response, 200, { opened: true });
        return;
      }
      if (request.method === "DELETE" && url.pathname.startsWith("/v1/projects/")) {
        if (!this.#removeProject) {
          throw new RuntimeError("unsupported", "Removing projects is not available");
        }
        const projectId = decodeURIComponent(url.pathname.slice("/v1/projects/".length));
        if (!projectId) throw new RuntimeError("invalid_request", "Project ID is required");
        sendJson(
          response,
          200,
          (await this.#removeProject(projectId)).map((project) =>
            RuntimeProjectSchema.parse(project),
          ),
        );
        return;
      }
      response.setHeader("Allow", "GET, POST, DELETE");
      sendError(response, 405, "invalid_request", "Method is not supported");
    } catch (error) {
      const { status, code, message } = toHttpError(error);
      sendError(response, status, code, message);
    }
  }

  async #get(url: URL, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (url.pathname === "/healthz") {
      sendJson(response, 200, this.#service.health());
      return;
    }
    if (url.pathname === "/v1/snapshot") {
      response.setHeader("Cache-Control", "no-store");
      sendJson(response, 200, this.#service.snapshot());
      return;
    }
    if (url.pathname === "/v1/projects") {
      if (!this.#projects) {
        throw new RuntimeError("unsupported", "Project listing is not available");
      }
      sendJson(
        response,
        200,
        (await this.#projects()).map((project) => RuntimeProjectSchema.parse(project)),
      );
      return;
    }
    if (url.pathname === "/v1/codex/models") {
      response.setHeader("Cache-Control", "no-store");
      sendJson(
        response,
        200,
        await this.#service.listModels(url.searchParams.get("projectId") ?? undefined),
      );
      return;
    }
    if (url.pathname === "/v1/events") {
      const after = parseSequence(url.searchParams.get("after"));
      sendJson(response, 200, { events: this.#service.events(after) });
      return;
    }
    if (url.pathname === "/v1/events/stream") {
      this.#stream(url, request, response);
      return;
    }
    const attemptPrefix = "/v1/attempts/";
    if (url.pathname.startsWith(attemptPrefix)) {
      const attemptId = decodeURIComponent(url.pathname.slice(attemptPrefix.length));
      const detail = this.#service.attemptDetail(attemptId);
      if (!detail) throw new RuntimeError("not_found", "Attempt was not found");
      sendJson(response, 200, detail);
      return;
    }
    const reviewSuffix = "/review-target";
    if (url.pathname.startsWith("/v1/tasks/") && url.pathname.endsWith(reviewSuffix)) {
      const taskId = decodeURIComponent(
        url.pathname.slice("/v1/tasks/".length, -reviewSuffix.length),
      );
      if (!taskId) throw new RuntimeError("invalid_request", "Task ID is required");
      sendJson(
        response,
        200,
        await this.#service.reviewTarget(taskId, url.searchParams.get("projectId") ?? undefined),
      );
      return;
    }

    if (this.#uiDistDir && !isApiPath(url.pathname)) {
      if (!this.#sessionToken) {
        throw new RuntimeError("invalid_request", "UI hosting requires a session token");
      }
      await tryServeStaticUi(response, {
        uiDistDir: this.#uiDistDir,
        pathname: url.pathname,
        sessionToken: this.#sessionToken,
      });
      return;
    }

    throw new RuntimeError("not_found", "Runtime route was not found");
  }

  #stream(url: URL, request: IncomingMessage, response: ServerResponse): void {
    const after = parseSequence(url.searchParams.get("after"));
    response.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    });
    response.write("retry: 1000\n\n");
    this.#streams.add(response);
    let lastSequence = after;
    const send = (name: string, data: unknown, sequence?: number) => {
      if (sequence !== undefined) {
        if (sequence <= lastSequence) return;
        lastSequence = sequence;
      }
      response.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const unsubscribe = this.#service.subscribe((event) => send("domain", event, event.sequence));
    const cleanUp = () => {
      clearInterval(keepAlive);
      unsubscribe();
      this.#streams.delete(response);
    };
    const keepAlive = setInterval(() => response.write(": keepalive\n\n"), 15_000);
    keepAlive.unref();
    request.once("close", cleanUp);
    response.once("close", cleanUp);
    send("snapshot", this.#service.snapshot());
    for (const event of this.#service.events(after)) send("domain", event, event.sequence);
  }
}

function readCodexThreadId(body: unknown): string {
  if (!body || typeof body !== "object") {
    throw new RuntimeError("invalid_request", "Codex Thread ID is required");
  }
  const threadId = (body as { threadId?: unknown }).threadId;
  if (typeof threadId !== "string" || !threadId.trim()) {
    throw new RuntimeError("invalid_request", "Codex Thread ID is required");
  }
  return threadId.trim();
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES)
      throw new RuntimeError("invalid_request", "Request body is too large");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RuntimeError("invalid_request", "Request body must be JSON");
  }
}

function parseSequence(value: string | null): number {
  if (value === null || value === "") return 0;
  const sequence = Number(value);
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new RuntimeError("invalid_request", "Event sequence must be a non-negative integer");
  }
  return sequence;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(payload);
}

function sendError(response: ServerResponse, status: number, code: string, message: string): void {
  sendJson(
    response,
    status,
    ApiErrorSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      code,
      message,
      retryable: status >= 500 && status !== 501,
    }),
  );
}

function toHttpError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof RuntimeError) {
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "invalid_request"
          ? 400
          : error.code === "unsupported"
            ? 501
            : error.code === "conflict" ||
                error.code === "duplicate_event" ||
                error.code === "artifact_conflict"
              ? 409
              : 500;
    return { status, code: error.code, message: error.message };
  }
  return {
    status: 500,
    code: "runtime_error",
    message: error instanceof Error && error.message ? error.message : "Runtime request failed",
  };
}
