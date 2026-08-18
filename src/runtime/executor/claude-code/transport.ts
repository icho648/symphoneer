import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";

export type ClaudeMessage = Record<string, unknown>;

export type ClaudePermissionMode =
  | "acceptEdits"
  | "auto"
  | "bypassPermissions"
  | "manual"
  | "dontAsk"
  | "plan";

export interface ClaudeTransport {
  readonly toolVersion: string;
  readonly processIdentity: { pid: number | null };
  readonly messages: AsyncIterable<ClaudeMessage>;
  readonly closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  send(message: ClaudeMessage): void;
  request(request: ClaudeMessage): Promise<unknown>;
  terminate(): Promise<void>;
  close(): Promise<void>;
}

export interface ClaudeTransportOptions {
  command: string;
  argv: string[];
  cwd: string;
  model?: string;
  permissionMode: ClaudePermissionMode;
  resumeSessionId?: string;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
}

export class ClaudeTransportError extends Error {
  readonly code: "invalid_message" | "process_failed" | "request_failed";

  constructor(code: ClaudeTransportError["code"], message: string) {
    super(message);
    this.name = "ClaudeTransportError";
    this.code = code;
  }
}

export class StdioClaudeTransport implements ClaudeTransport {
  readonly toolVersion: string;
  readonly processIdentity: { pid: number | null };
  readonly messages: AsyncIterable<ClaudeMessage>;
  readonly closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #closedResolver = Promise.withResolvers<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>();
  readonly #pending = new Map<string, PendingRequest>();
  #controller!: ReadableStreamDefaultController<ClaudeMessage>;
  #ended = false;

  private constructor(child: ChildProcessWithoutNullStreams, toolVersion: string) {
    this.#child = child;
    this.toolVersion = toolVersion;
    this.processIdentity = { pid: child.pid ?? null };
    this.closed = this.#closedResolver.promise;
    this.messages = new ReadableStream<ClaudeMessage>({
      start: (controller) => {
        this.#controller = controller;
      },
    });
    this.#listen();
  }

  static async start(options: ClaudeTransportOptions): Promise<StdioClaudeTransport> {
    const toolVersion = await readToolVersion(options.command, options.argv, options.cwd);
    const args = [
      ...options.argv,
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-prompt-tool",
      "stdio",
      "--permission-mode",
      options.permissionMode,
      ...(options.model ? ["--model", options.model] : []),
      ...(options.resumeSessionId ? [`--resume=${options.resumeSessionId}`] : []),
    ];
    return new StdioClaudeTransport(
      spawn(options.command, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] }),
      toolVersion,
    );
  }

  send(message: ClaudeMessage): void {
    if (this.#ended || !this.#child.stdin.writable) {
      throw new ClaudeTransportError("process_failed", "Claude Code is not writable");
    }
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(request: ClaudeMessage): Promise<unknown> {
    const requestId = crypto.randomUUID();
    const pending = Promise.withResolvers<unknown>();
    const timeout = setTimeout(() => {
      this.#pending.delete(requestId);
      pending.reject(
        new ClaudeTransportError("request_failed", "Claude control request timed out"),
      );
    }, 5_000);
    this.#pending.set(requestId, { ...pending, timeout });
    try {
      this.send({ type: "control_request", request_id: requestId, request });
    } catch (error) {
      clearTimeout(timeout);
      this.#pending.delete(requestId);
      pending.reject(error);
    }
    return pending.promise;
  }

  async terminate(): Promise<void> {
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

  async close(): Promise<void> {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) {
      await this.closed;
      return;
    }
    this.#child.stdin.end();
    let force: NodeJS.Timeout | undefined;
    const graceful = await Promise.race([
      this.closed.then(() => true),
      new Promise<false>((resolve) => {
        force = setTimeout(() => resolve(false), 2_000);
      }),
    ]);
    if (force) clearTimeout(force);
    if (!graceful) await this.terminate();
  }

  #listen(): void {
    const lines = createInterface({ input: this.#child.stdout });
    lines.on("line", (line) => this.#receive(line));
    this.#child.stderr.resume();
    this.#child.stdin.on("error", () => this.#fail("Claude Code input pipe failed"));
    this.#child.once("error", () => this.#finish(null, null));
    this.#child.once("close", (code, signal) => this.#finish(code, signal));
  }

  #receive(line: string): void {
    if (this.#ended || !line.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.#fail("Claude Code emitted invalid JSONL");
      return;
    }
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
      this.#fail("Claude Code emitted an invalid stream-json message");
      return;
    }
    const record = message as ClaudeMessage;
    if (record.type === "control_response") {
      const response = asRecord(record.response);
      const requestId = stringField(response, "request_id");
      const pending = requestId ? this.#pending.get(requestId) : undefined;
      if (!pending || !requestId) return;
      this.#pending.delete(requestId);
      clearTimeout(pending.timeout);
      if (response?.subtype === "success") pending.resolve(response.response);
      else pending.reject(new ClaudeTransportError("request_failed", "Claude request failed"));
      return;
    }
    this.#controller.enqueue(record);
  }

  #fail(message: string): void {
    if (this.#ended) return;
    this.#ended = true;
    this.#controller.error(new ClaudeTransportError("invalid_message", message));
    this.#child.kill("SIGTERM");
  }

  #finish(code: number | null, signal: NodeJS.Signals | null): void {
    for (const request of this.#pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new ClaudeTransportError("process_failed", "Claude Code exited"));
    }
    this.#pending.clear();
    if (!this.#ended) {
      this.#ended = true;
      this.#controller.close();
    }
    this.#closedResolver.resolve({ code, signal });
  }
}

function readToolVersion(command: string, argv: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...argv, "--version"],
      { cwd, encoding: "utf8", maxBuffer: 64 * 1024 },
      (error, stdout) => {
        const match = stdout.trim().match(/\b(\d+)\.(\d+)\.(\d+)\b/);
        if (
          error ||
          !match ||
          Number(match[1]) !== 2 ||
          Number(match[2]) < 1 ||
          (Number(match[2]) === 1 && Number(match[3]) < 218)
        ) {
          reject(
            new ClaudeTransportError(
              "process_failed",
              "Claude Code CLI version is missing or incompatible",
            ),
          );
          return;
        }
        resolve(match[0]);
      },
    );
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: unknown, field: string): string | null {
  const record = asRecord(value);
  return record && typeof record[field] === "string" ? record[field] : null;
}
