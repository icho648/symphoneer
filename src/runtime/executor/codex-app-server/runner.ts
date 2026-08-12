import type { AgentRunner, AgentRunRequest, RunHandle } from "../agent-runner.ts";

import { storedExecutionSession } from "./activities.ts";
import { listCodexModels } from "./models.ts";
import { createRunHandle } from "./run-handle.ts";
import { initializeCodexTransport, startCodexTurn } from "./session.ts";
import type { CodexTransport } from "./transport.ts";
import { StdioCodexTransport } from "./transport.ts";

export class CodexAppServerAdapter implements AgentRunner {
  readonly #transportFactory: () => Promise<CodexTransport>;
  readonly #approvalPolicy: "never" | "on-request" | "untrusted";
  readonly #sandbox: "danger-full-access" | "read-only" | "workspace-write";
  readonly #turnTimeoutMs: number;
  readonly #stallTimeoutMs: number;
  readonly #now: () => Date;

  constructor(
    options: {
      transportFactory?: () => Promise<CodexTransport>;
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
      (() =>
        StdioCodexTransport.start({
          ...(options.command === undefined ? {} : { command: options.command }),
          ...(options.args === undefined ? {} : { args: options.args }),
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

  async startOrContinue(request: AgentRunRequest): Promise<RunHandle> {
    if (request.continuation && !request.threadId) {
      throw new Error("A continuation requires its Codex threadId");
    }
    if (!request.continuation && request.threadId) {
      throw new Error("A new Codex session must not provide threadId");
    }

    const transport = await this.#transportFactory();
    try {
      const { threadId, turnId } = await startCodexTurn(transport, request, {
        approvalPolicy: this.#approvalPolicy,
        sandbox: this.#sandbox,
      });
      return createRunHandle({
        transport,
        request,
        threadId,
        turnId,
        turnTimeoutMs: this.#turnTimeoutMs,
        stallTimeoutMs: this.#stallTimeoutMs,
        now: this.#now,
      });
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw error;
    }
  }

  async listModels() {
    const transport = await this.#transportFactory();
    try {
      return await listCodexModels(transport);
    } finally {
      await transport.close().catch(() => undefined);
    }
  }

  async readSession(threadId: string, attemptId: string, capturedAt: string) {
    const transport = await this.#transportFactory();
    try {
      await initializeCodexTransport(transport);
      const response = await transport.request("thread/read", { threadId, includeTurns: true });
      return storedExecutionSession(response, attemptId, capturedAt);
    } finally {
      await transport.close().catch(() => undefined);
    }
  }
}
