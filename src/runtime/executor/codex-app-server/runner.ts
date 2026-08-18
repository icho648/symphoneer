import type {
  AgentRunner,
  AgentRunRequest,
  AgentTurnRequest,
  AgentWorkerRequest,
  AttemptWorker,
  RunHandle,
} from "../agent-runner.ts";

import { storedExecutionSession } from "./activities.ts";
import { listCodexModels } from "./models.ts";
import { createRunHandle } from "./run-handle.ts";
import { initializeCodexTransport, startCodexTurn } from "./session.ts";
import type { CodexTransport } from "./transport.ts";
import { StdioCodexTransport } from "./transport.ts";

export class CodexAppServerAdapter implements AgentRunner {
  readonly #transportFactory: (cwd: string) => Promise<CodexTransport>;
  readonly #approvalPolicy: "never" | "on-request" | "untrusted";
  readonly #sandbox: "danger-full-access" | "read-only" | "workspace-write";
  readonly #turnTimeoutMs: number;
  readonly #stallTimeoutMs: number;
  readonly #now: () => Date;

  constructor(
    options: {
      transportFactory?: (cwd: string) => Promise<CodexTransport>;
      command?: string;
      args?: string[];
      readTimeoutMs?: number;
      approvalPolicy?: "never" | "on-request" | "untrusted";
      sandbox?: "danger-full-access" | "read-only" | "workspace-write";
      turnTimeoutMs?: number;
      stallTimeoutMs?: number;
      now?: () => Date;
    } = {},
  ) {
    this.#transportFactory =
      options.transportFactory ??
      ((cwd) =>
        StdioCodexTransport.start({
          ...(options.command === undefined ? {} : { command: options.command }),
          ...(options.args === undefined ? {} : { args: options.args }),
          cwd,
          ...(options.readTimeoutMs === undefined ? {} : { readTimeoutMs: options.readTimeoutMs }),
        }));
    this.#approvalPolicy = options.approvalPolicy ?? "on-request";
    this.#sandbox = options.sandbox ?? "workspace-write";
    this.#turnTimeoutMs = options.turnTimeoutMs ?? 3_600_000;
    this.#stallTimeoutMs = options.stallTimeoutMs ?? 300_000;
    this.#now = options.now ?? (() => new Date());
    if (!Number.isInteger(this.#turnTimeoutMs) || this.#turnTimeoutMs <= 0) {
      throw new Error("Codex turn timeout must be a positive integer");
    }
    if (!Number.isInteger(this.#stallTimeoutMs) || this.#stallTimeoutMs < 0) {
      throw new Error("Codex stall timeout must be a non-negative integer");
    }
  }

  async openWorker(request: AgentWorkerRequest): Promise<AttemptWorker> {
    const transport = await this.#transportFactory(request.workspace.path);
    try {
      await initializeCodexTransport(transport);
      return new CodexAttemptWorker({
        transport,
        request,
        approvalPolicy: this.#approvalPolicy,
        sandbox: this.#sandbox,
        turnTimeoutMs: this.#turnTimeoutMs,
        stallTimeoutMs: this.#stallTimeoutMs,
        now: this.#now,
      });
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw error;
    }
  }

  /** @deprecated Open an Attempt Worker and own its lifecycle explicitly. */
  async startOrContinue(request: AgentRunRequest): Promise<RunHandle> {
    if (request.continuation && !request.threadId) {
      throw new Error("A continuation requires its Codex threadId");
    }
    if (!request.continuation && request.threadId) {
      throw new Error("A new Codex session must not provide threadId");
    }

    const worker = await this.openWorker(request);
    try {
      const handle = await worker.startTurn({
        prompt: request.prompt,
        ...(request.threadId ? { threadId: request.threadId } : {}),
      });
      return { ...handle, completion: handle.completion.finally(() => worker.close()) };
    } catch (error) {
      await worker.close().catch(() => undefined);
      throw error;
    }
  }

  async listModels() {
    const transport = await this.#transportFactory(process.cwd());
    try {
      return await listCodexModels(transport);
    } finally {
      await transport.close().catch(() => undefined);
    }
  }

  async readSession(threadId: string, attemptId: string, capturedAt: string) {
    const transport = await this.#transportFactory(process.cwd());
    try {
      await initializeCodexTransport(transport);
      const response = await transport.request("thread/read", { threadId, includeTurns: true });
      return storedExecutionSession(response, attemptId, capturedAt);
    } finally {
      await transport.close().catch(() => undefined);
    }
  }
}

class CodexAttemptWorker implements AttemptWorker {
  readonly processIdentity: AttemptWorker["processIdentity"];
  readonly #transport: CodexTransport;
  readonly #request: AgentWorkerRequest;
  readonly #approvalPolicy: "never" | "on-request" | "untrusted";
  readonly #sandbox: "danger-full-access" | "read-only" | "workspace-write";
  readonly #turnTimeoutMs: number;
  readonly #stallTimeoutMs: number;
  readonly #now: () => Date;
  #threadId: string | undefined;
  #instructionSources: string[] = [];
  #active = false;
  #closed = false;

  constructor(options: {
    transport: CodexTransport;
    request: AgentWorkerRequest;
    approvalPolicy: "never" | "on-request" | "untrusted";
    sandbox: "danger-full-access" | "read-only" | "workspace-write";
    turnTimeoutMs: number;
    stallTimeoutMs: number;
    now: () => Date;
  }) {
    this.#transport = options.transport;
    this.#request = options.request;
    this.#approvalPolicy = options.approvalPolicy;
    this.#sandbox = options.sandbox;
    this.#turnTimeoutMs = options.turnTimeoutMs;
    this.#stallTimeoutMs = options.stallTimeoutMs;
    this.#now = options.now;
    this.processIdentity = {
      pid: options.transport.processIdentity?.pid ?? null,
      toolVersion: options.transport.toolVersion,
    };
  }

  async startTurn(request: AgentTurnRequest): Promise<RunHandle> {
    if (this.#closed) throw new Error("Attempt Worker is closed");
    if (this.#active) throw new Error("Attempt Worker already has an active Turn");
    const threadId = request.threadId ?? this.#threadId;
    const runRequest: AgentRunRequest = {
      ...this.#request,
      prompt: request.prompt,
      continuation: threadId !== undefined,
      ...(threadId ? { threadId } : {}),
    };
    const started = await startCodexTurn(this.#transport, runRequest, {
      approvalPolicy: this.#approvalPolicy,
      sandbox: this.#sandbox,
      initialized: true,
      ...(this.#threadId ? { activeThreadId: this.#threadId } : {}),
    });
    this.#threadId = started.threadId;
    if (started.instructionSources.length > 0) {
      this.#instructionSources = started.instructionSources;
    }
    this.#active = true;
    const handle = createRunHandle({
      transport: this.#transport,
      request: runRequest,
      threadId: started.threadId,
      turnId: started.turnId,
      turnTimeoutMs: this.#turnTimeoutMs,
      stallTimeoutMs: this.#stallTimeoutMs,
      now: this.#now,
    });
    return {
      ...handle,
      completion: handle.completion.finally(() => {
        this.#active = false;
      }),
    };
  }

  async readSession(threadId: string, capturedAt: string) {
    if (this.#closed) throw new Error("Attempt Worker is closed");
    if (this.#active) throw new Error("Attempt Worker cannot read an active Turn");
    const response = await this.#transport.request("thread/read", { threadId, includeTurns: true });
    return storedExecutionSession(
      response,
      this.#request.attemptId,
      capturedAt,
      this.#instructionSources,
    );
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#transport.close();
  }
}
