import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";

export type JsonRpcId = number | string;

export type CodexServerMessage =
  | { kind: "notification"; method: string; params: unknown }
  | { kind: "request"; id: JsonRpcId; method: string; params: unknown };

export interface CodexTransport {
  readonly toolVersion: string;
  readonly processIdentity?: { pid: number | null };
  readonly messages: AsyncIterable<CodexServerMessage>;
  readonly closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  respond(id: JsonRpcId, result: unknown): void;
  reject(id: JsonRpcId, code: number, message: string): void;
  close(): Promise<void>;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

export class CodexTransportError extends Error {
  readonly code: "invalid_message" | "process_failed" | "request_failed" | "request_timed_out";

  constructor(code: CodexTransportError["code"], message: string) {
    super(message);
    this.name = "CodexTransportError";
    this.code = code;
  }
}

export class StdioCodexTransport implements CodexTransport {
  readonly toolVersion: string;
  readonly processIdentity: { pid: number | null };
  readonly messages: AsyncIterable<CodexServerMessage>;
  readonly closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #readTimeoutMs: number;
  readonly #pending = new Map<JsonRpcId, PendingRequest>();
  readonly #closedResolver = Promise.withResolvers<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>();
  #controller!: ReadableStreamDefaultController<CodexServerMessage>;
  #nextId = 1;
  #ended = false;

  private constructor(
    child: ChildProcessWithoutNullStreams,
    toolVersion: string,
    readTimeoutMs: number,
  ) {
    this.#child = child;
    this.toolVersion = toolVersion;
    this.processIdentity = { pid: child.pid ?? null };
    this.#readTimeoutMs = readTimeoutMs;
    this.closed = this.#closedResolver.promise;
    const stream = new ReadableStream<CodexServerMessage>({
      start: (controller) => {
        this.#controller = controller;
      },
    });
    this.messages = stream;
    this.#listen();
  }

  static async start(
    options: {
      command?: string;
      args?: string[];
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      readTimeoutMs?: number;
    } = {},
  ): Promise<StdioCodexTransport> {
    const command = options.command ?? "codex";
    const args = options.args ?? ["app-server"];
    const readTimeoutMs = options.readTimeoutMs ?? 5_000;
    if (!Number.isInteger(readTimeoutMs) || readTimeoutMs <= 0) {
      throw new CodexTransportError("request_failed", "Codex read timeout must be positive");
    }
    const env = codexEnvironment(options.env ?? process.env);
    const toolVersion = await readToolVersion(command, options.cwd, env);
    const child = spawn(command, args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.resume();
    return new StdioCodexTransport(child, toolVersion, readTimeoutMs);
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.#nextId++;
    let pending: PendingRequest | undefined;
    const result = new Promise<unknown>((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new CodexTransportError(
            "request_timed_out",
            `Codex request ${method} exceeded ${this.#readTimeoutMs}ms`,
          ),
        );
      }, this.#readTimeoutMs);
      pending = { resolve: resolvePromise, reject, timeout };
      this.#pending.set(id, pending);
    });
    try {
      this.#write({ id, method, params });
    } catch (error) {
      this.#pending.delete(id);
      if (pending) {
        clearTimeout(pending.timeout);
        pending.reject(error as Error);
      }
    }
    return result;
  }

  notify(method: string, params?: unknown): void {
    this.#write(params === undefined ? { method } : { method, params });
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.#write({ id, result });
  }

  reject(id: JsonRpcId, code: number, message: string): void {
    this.#write({ id, error: { code, message } });
  }

  async close(): Promise<void> {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) {
      await this.closed;
      return;
    }
    this.#child.kill("SIGTERM");
    const force = setTimeout(() => this.#child.kill("SIGKILL"), 1_000);
    force.unref();
    await this.closed;
    clearTimeout(force);
  }

  #listen(): void {
    const lines = createInterface({ input: this.#child.stdout });
    lines.on("line", (line) => this.#receive(line));
    this.#child.stdin.on("error", () => {
      this.#streamError(
        new CodexTransportError("process_failed", "Codex app-server input pipe failed"),
      );
      if (this.#child.exitCode === null && this.#child.signalCode === null) {
        this.#child.kill("SIGKILL");
      }
    });
    this.#child.once("error", () => this.#finish(null, null));
    this.#child.once("close", (code, signal) => this.#finish(code, signal));
  }

  #receive(line: string): void {
    if (this.#ended) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.#streamError(new CodexTransportError("invalid_message", "Codex emitted invalid JSONL"));
      this.#child.kill("SIGKILL");
      return;
    }
    if (typeof message !== "object" || message === null) {
      this.#streamError(
        new CodexTransportError("invalid_message", "Codex emitted an invalid JSON-RPC message"),
      );
      this.#child.kill("SIGKILL");
      return;
    }
    const envelope = message as Record<string, unknown>;
    const id = envelope.id;
    if ((typeof id === "number" || typeof id === "string") && typeof envelope.method !== "string") {
      const pending = this.#pending.get(id);
      if (!pending) return;
      this.#pending.delete(id);
      clearTimeout(pending.timeout);
      if (envelope.error === undefined) pending.resolve(envelope.result);
      else pending.reject(new CodexTransportError("request_failed", "Codex request failed"));
      return;
    }
    if (typeof envelope.method !== "string") return;
    if (typeof id === "number" || typeof id === "string") {
      this.#controller.enqueue({
        kind: "request",
        id,
        method: envelope.method,
        params: envelope.params,
      });
    } else {
      this.#controller.enqueue({
        kind: "notification",
        method: envelope.method,
        params: envelope.params,
      });
    }
  }

  #write(message: object): void {
    if (this.#ended || !this.#child.stdin.writable) {
      throw new CodexTransportError("process_failed", "Codex app-server is not writable");
    }
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #streamError(error: Error): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#controller.error(error);
  }

  #finish(code: number | null, signal: NodeJS.Signals | null): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new CodexTransportError("process_failed", "Codex app-server exited"));
    }
    this.#pending.clear();
    if (!this.#ended) {
      this.#ended = true;
      try {
        this.#controller.close();
      } catch {
        // A consumer may cancel the stream while the child process is stopping.
      }
    }
    this.#closedResolver.resolve({ code, signal });
  }
}

function readToolVersion(
  command: string,
  cwd: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      ["--version"],
      { ...(cwd ? { cwd } : {}), env, encoding: "utf8", maxBuffer: 64 * 1024 },
      (error, stdout) => {
        const version = stdout.trim().split("\n", 1)[0];
        if (error || !version) {
          reject(
            new CodexTransportError("process_failed", "Codex CLI version could not be determined"),
          );
          return;
        }
        resolvePromise(version);
      },
    );
  });
}

function codexEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  delete env.GITHUB_TOKEN;
  delete env.GH_TOKEN;
  return env;
}
