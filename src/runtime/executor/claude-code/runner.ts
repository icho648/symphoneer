import type { AgentRunner, AgentWorkerRequest, AttemptWorker } from "../agent-runner.ts";
import {
  type ClaudePermissionMode,
  type ClaudeTransport,
  type ClaudeTransportOptions,
  StdioClaudeTransport,
} from "./transport.ts";
import { ClaudeAttemptWorker } from "./worker.ts";

type TransportFactory = (options: ClaudeTransportOptions) => Promise<ClaudeTransport>;

interface ClaudeCodeAdapterOptions {
  permissionMode: ClaudePermissionMode;
  transportFactory?: TransportFactory;
  command?: string;
  argv?: string[];
  model?: string;
  turnTimeoutMs?: number;
  stallTimeoutMs?: number;
  now?: () => Date;
}

interface ResolvedClaudeCodeOptions {
  permissionMode: ClaudePermissionMode;
  transportFactory: TransportFactory;
  command: string;
  argv: string[];
  model: string | undefined;
  turnTimeoutMs: number;
  stallTimeoutMs: number;
  now: () => Date;
}

export class ClaudeCodeAdapter implements AgentRunner {
  readonly #options: ResolvedClaudeCodeOptions;

  constructor(options: ClaudeCodeAdapterOptions) {
    const command = options.command ?? "claude";
    const turnTimeoutMs = options.turnTimeoutMs ?? 3_600_000;
    const stallTimeoutMs = options.stallTimeoutMs ?? 300_000;
    if (!command.trim()) throw new Error("Claude command cannot be empty");
    if (!Number.isInteger(turnTimeoutMs) || turnTimeoutMs <= 0) {
      throw new Error("Claude turn timeout must be a positive integer");
    }
    if (!Number.isInteger(stallTimeoutMs) || stallTimeoutMs < 0) {
      throw new Error("Claude stall timeout must be a non-negative integer");
    }
    this.#options = {
      permissionMode: options.permissionMode,
      transportFactory: options.transportFactory ?? StdioClaudeTransport.start,
      command,
      argv: options.argv ?? [],
      model: options.model,
      turnTimeoutMs,
      stallTimeoutMs,
      now: options.now ?? (() => new Date()),
    };
  }

  async openWorker(request: AgentWorkerRequest): Promise<AttemptWorker> {
    const model = request.model ?? this.#options.model;
    const transport = await this.#options.transportFactory({
      command: this.#options.command,
      argv: this.#options.argv,
      cwd: request.workspace.path,
      permissionMode: this.#options.permissionMode,
      ...(model ? { model } : {}),
      ...(request.sessionId ? { resumeSessionId: request.sessionId } : {}),
    });
    return new ClaudeAttemptWorker({
      transport,
      request,
      permissionMode: this.#options.permissionMode,
      turnTimeoutMs: this.#options.turnTimeoutMs,
      stallTimeoutMs: this.#options.stallTimeoutMs,
      now: this.#options.now,
    });
  }
}
