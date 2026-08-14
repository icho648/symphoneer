import {
  ActivityPayloadSchema,
  CONTRACT_SCHEMA_VERSION,
  type ExecutionSession,
  ExecutionSessionSchema,
} from "@symphoneer/contracts";
import type {
  AgentRunEvent,
  AgentRunner,
  AgentRunRequest,
  AgentTurnRequest,
  AgentWorkerRequest,
  AttemptWorker,
  InterventionResponse,
  RunHandle,
} from "../agent-runner.ts";
import { fingerprint } from "../input-fingerprint.ts";
import {
  type ClaudeInit,
  type ClaudePermissionRequest,
  claudeActivities,
  claudeCompletion,
  claudeSessionId,
  parseClaudeInit,
  parsePermissionRequest,
} from "./protocol.ts";
import {
  type ClaudeMessage,
  type ClaudeTransport,
  type ClaudeTransportOptions,
  StdioClaudeTransport,
} from "./transport.ts";

type SessionTurn = ExecutionSession["turns"][number];
type PermissionMode = "acceptEdits" | "auto" | "bypassPermissions" | "manual" | "dontAsk" | "plan";

export class ClaudeCodeAdapter implements AgentRunner {
  readonly #transportFactory: (options: ClaudeTransportOptions) => Promise<ClaudeTransport>;
  readonly #command: string;
  readonly #argv: string[];
  readonly #model: string | undefined;
  readonly #permissionMode: PermissionMode;
  readonly #turnTimeoutMs: number;
  readonly #stallTimeoutMs: number;
  readonly #now: () => Date;

  constructor(options: {
    permissionMode: PermissionMode;
    transportFactory?: (options: ClaudeTransportOptions) => Promise<ClaudeTransport>;
    command?: string;
    argv?: string[];
    model?: string;
    turnTimeoutMs?: number;
    stallTimeoutMs?: number;
    now?: () => Date;
  }) {
    this.#transportFactory = options.transportFactory ?? StdioClaudeTransport.start;
    this.#command = options.command ?? "claude";
    this.#argv = options.argv ?? [];
    this.#model = options.model;
    this.#permissionMode = options.permissionMode;
    this.#turnTimeoutMs = options.turnTimeoutMs ?? 3_600_000;
    this.#stallTimeoutMs = options.stallTimeoutMs ?? 300_000;
    this.#now = options.now ?? (() => new Date());
    if (!this.#command.trim()) throw new Error("Claude command cannot be empty");
    if (!Number.isInteger(this.#turnTimeoutMs) || this.#turnTimeoutMs <= 0) {
      throw new Error("Claude turn timeout must be a positive integer");
    }
    if (!Number.isInteger(this.#stallTimeoutMs) || this.#stallTimeoutMs < 0) {
      throw new Error("Claude stall timeout must be a non-negative integer");
    }
  }

  async openWorker(request: AgentWorkerRequest): Promise<AttemptWorker> {
    const model = request.model ?? this.#model;
    const transport = await this.#transportFactory({
      command: this.#command,
      argv: this.#argv,
      cwd: request.workspace.path,
      permissionMode: this.#permissionMode,
      ...(model ? { model } : {}),
      ...(request.sessionId ? { resumeSessionId: request.sessionId } : {}),
    });
    return new ClaudeAttemptWorker({
      transport,
      request,
      permissionMode: this.#permissionMode,
      turnTimeoutMs: this.#turnTimeoutMs,
      stallTimeoutMs: this.#stallTimeoutMs,
      now: this.#now,
    });
  }
}

class ClaudeAttemptWorker implements AttemptWorker {
  readonly processIdentity: AttemptWorker["processIdentity"];
  readonly #transport: ClaudeTransport;
  readonly #request: AgentWorkerRequest;
  readonly #permissionMode: PermissionMode;
  readonly #turnTimeoutMs: number;
  readonly #stallTimeoutMs: number;
  readonly #now: () => Date;
  readonly #turns: SessionTurn[] = [];
  readonly #permissions = new Map<string, ClaudePermissionRequest>();
  #init: ClaudeInit | undefined;
  #active: ClaudeRun | undefined;
  #closed = false;

  constructor(options: {
    transport: ClaudeTransport;
    request: AgentWorkerRequest;
    permissionMode: PermissionMode;
    turnTimeoutMs: number;
    stallTimeoutMs: number;
    now: () => Date;
  }) {
    this.#transport = options.transport;
    this.#request = options.request;
    this.#permissionMode = options.permissionMode;
    this.#turnTimeoutMs = options.turnTimeoutMs;
    this.#stallTimeoutMs = options.stallTimeoutMs;
    this.#now = options.now;
    this.processIdentity = {
      pid: options.transport.processIdentity.pid,
      toolVersion: options.transport.toolVersion,
    };
    void this.#pump();
    void this.#transport.closed.then(({ code }) => {
      if (this.#active?.settled) return;
      this.#active?.finish(
        this.#active.interrupted
          ? { outcome: "interrupted" }
          : { outcome: "failed", error: code === 0 ? "claude_stream_ended" : "claude_code_exited" },
      );
    });
  }

  async startTurn(request: AgentTurnRequest): Promise<RunHandle> {
    if (this.#closed) throw new Error("Attempt Worker is closed");
    if (this.#active && !this.#active.settled) {
      throw new Error("Attempt Worker already has an active Turn");
    }
    const expectedSessionId = request.threadId ?? this.#request.sessionId ?? this.#init?.sessionId;
    if (request.threadId && this.#init && request.threadId !== this.#init.sessionId) {
      throw new Error("Attempt Worker cannot switch Claude Sessions");
    }
    const runRequest: AgentRunRequest = {
      ...this.#request,
      prompt: request.prompt,
      continuation: expectedSessionId !== undefined,
      ...(expectedSessionId ? { threadId: expectedSessionId } : {}),
    };
    const turnId = crypto.randomUUID();
    const turn: SessionTurn = { id: turnId, status: "running", items: [] };
    this.#turns.push(turn);
    const run = new ClaudeRun({
      request: runRequest,
      turn,
      turnId,
      turnTimeoutMs: this.#turnTimeoutMs,
      stallTimeoutMs: this.#stallTimeoutMs,
      now: this.#now,
      interrupt: () => this.#interrupt(),
      steer: (prompt) => this.#steer(prompt),
      respond: (requestRef, decision) => this.#respond(requestRef, decision),
    });
    this.#active = run;
    if (this.#init) run.start(this.#init);
    this.#transport.send(userMessage(request.prompt, turnId));
    return run.handle;
  }

  async readSession(threadId: string, capturedAt: string): Promise<ExecutionSession | null> {
    if (this.#closed) throw new Error("Attempt Worker is closed");
    if (this.#active && !this.#active.settled) {
      throw new Error("Attempt Worker cannot read an active Turn");
    }
    if (!this.#init || threadId !== this.#init.sessionId) return null;
    return ExecutionSessionSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      attemptId: this.#request.attemptId,
      provider: "claude-code",
      threadId,
      turns: this.#turns,
      capturedAt,
    });
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#active && !this.#active.settled) {
      this.#active.interrupted = true;
      this.#active.finish({ outcome: "interrupted" });
    }
    await this.#transport.close();
  }

  async #pump(): Promise<void> {
    try {
      for await (const message of this.#transport.messages) this.#receive(message);
    } catch {
      this.#active?.finish({ outcome: "failed", error: "claude_protocol_failed" });
    }
  }

  #receive(message: ClaudeMessage): void {
    const run = this.#active;
    if (!run || run.settled) return;
    let init: ClaudeInit | null;
    try {
      init = parseClaudeInit(message);
    } catch {
      run.finish({ outcome: "failed", error: "claude_invalid_init" });
      return;
    }
    if (init) {
      if (init.version !== this.#transport.toolVersion) {
        run.finish({ outcome: "failed", error: "claude_version_changed" });
        return;
      }
      const expected = this.#request.sessionId ?? run.request.threadId;
      if (expected && init.sessionId !== expected) {
        run.finish({ outcome: "failed", error: "claude_resume_session_mismatch" });
        return;
      }
      if (init.permissionMode !== this.#permissionMode) {
        run.finish({ outcome: "failed", error: "claude_permission_mode_mismatch" });
        return;
      }
      this.#init = init;
      run.start(init);
    }
    const sessionId = claudeSessionId(message);
    if (sessionId && this.#init && sessionId !== this.#init.sessionId) {
      run.finish({ outcome: "failed", error: "claude_session_identity_changed" });
      return;
    }
    const permission = parsePermissionRequest(message, this.#timestamp());
    if (permission) {
      this.#permissions.set(permission.requestRef, permission);
      run.waiting = true;
      run.emit(permission.event);
      return;
    }
    run.touch();
    for (const activity of claudeActivities(message, this.#timestamp())) run.activity(activity);
    const completion = claudeCompletion(message, run.interrupted);
    if (completion) run.result(completion);
  }

  async #interrupt(): Promise<void> {
    const run = this.#active;
    if (!run || run.settled) return;
    run.interrupted = true;
    if (this.#init?.capabilities.includes("interrupt_receipt_v1")) {
      await this.#transport.request({ subtype: "interrupt" });
      return;
    }
    await this.#transport.terminate();
    run.finish({ outcome: "interrupted" });
  }

  async #steer(prompt: string): Promise<void> {
    const run = this.#active;
    if (!run || run.settled) throw new Error("Claude Turn is not active");
    const uuid = crypto.randomUUID();
    run.queue(uuid);
    this.#transport.send(userMessage(prompt, uuid));
  }

  async #respond(requestRef: string, decision: InterventionResponse): Promise<void> {
    const permission = this.#permissions.get(requestRef);
    if (!permission) throw new Error(`Unknown Claude intervention ${requestRef}`);
    if (!["approved", "rejected", "canceled"].includes(decision.decision)) {
      throw new Error("Claude permission interventions require an approval decision");
    }
    const allowed = decision.decision === "approved";
    this.#transport.send({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: requestRef,
        response: allowed
          ? {
              behavior: "allow",
              updatedInput: permission.input,
              toolUseID: permission.toolUseId,
              decisionClassification: "user_temporary",
            }
          : {
              behavior: "deny",
              message: "The user declined this tool request.",
              toolUseID: permission.toolUseId,
              decisionClassification: "user_reject",
            },
      },
    });
    this.#permissions.delete(requestRef);
    if (this.#permissions.size === 0 && this.#active) this.#active.waiting = false;
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }
}

class ClaudeRun {
  readonly request: AgentRunRequest;
  readonly handle: RunHandle;
  readonly #turn: SessionTurn;
  readonly #turnId: string;
  readonly #now: () => Date;
  readonly #completion = Promise.withResolvers<Awaited<RunHandle["completion"]>>();
  readonly #queued = new Set<string>();
  readonly #turnTimer: NodeJS.Timeout;
  readonly #stallTimeoutMs: number;
  #stallTimer: NodeJS.Timeout | undefined;
  #controller!: ReadableStreamDefaultController<AgentRunEvent>;
  #started = false;
  settled = false;
  interrupted = false;
  #waiting = false;

  constructor(options: {
    request: AgentRunRequest;
    turn: SessionTurn;
    turnId: string;
    turnTimeoutMs: number;
    stallTimeoutMs: number;
    now: () => Date;
    interrupt(): Promise<void>;
    steer(prompt: string): Promise<void>;
    respond(requestRef: string, decision: InterventionResponse): Promise<void>;
  }) {
    this.request = options.request;
    this.#turn = options.turn;
    this.#turnId = options.turnId;
    this.#now = options.now;
    this.#stallTimeoutMs = options.stallTimeoutMs;
    this.#queued.add(options.turnId);
    const events = new ReadableStream<AgentRunEvent>({
      start: (controller) => {
        this.#controller = controller;
      },
    });
    this.handle = {
      events,
      completion: this.#completion.promise,
      interrupt: options.interrupt,
      steer: options.steer,
      respondToIntervention: options.respond,
    };
    this.#turnTimer = setTimeout(
      () => this.finish({ outcome: "failed", error: "claude_turn_timed_out" }),
      options.turnTimeoutMs,
    );
    this.touch();
  }

  set waiting(value: boolean) {
    this.#waiting = value;
    this.touch();
  }

  get waiting(): boolean {
    return this.#waiting;
  }

  start(init: ClaudeInit): void {
    if (this.#started || this.settled) return;
    this.#started = true;
    this.emit({
      type: "session_started",
      occurredAt: this.#now().toISOString(),
      threadId: init.sessionId,
      turnId: this.#turnId,
      provider: {
        name: "claude-code",
        version: init.version,
        schema: "stream-json",
        inputFingerprint: fingerprint(this.request),
        model: init.model,
        permissionMode: init.permissionMode,
      },
    });
  }

  queue(uuid: string): void {
    this.#queued.add(uuid);
    this.touch();
  }

  result(completion: Awaited<RunHandle["completion"]>): void {
    const first = this.#queued.values().next().value;
    if (first) this.#queued.delete(first);
    if (this.#queued.size === 0) this.finish(completion);
  }

  activity(event: Extract<AgentRunEvent, { type: "activity" }>): void {
    this.#turn.items.push({
      id: event.itemId,
      type: event.kind,
      status: event.status,
      data: { activity: ActivityPayloadSchema.parse(event) },
    });
    this.emit(event);
  }

  emit(event: AgentRunEvent): void {
    if (!this.settled) this.#controller.enqueue(event);
  }

  touch(): void {
    if (this.#stallTimer) clearTimeout(this.#stallTimer);
    this.#stallTimer = undefined;
    if (this.#waiting || this.#stallTimeoutMs === 0 || this.settled) return;
    this.#stallTimer = setTimeout(
      () => this.finish({ outcome: "failed", error: "claude_turn_stalled" }),
      this.#stallTimeoutMs,
    );
  }

  finish(result: Awaited<RunHandle["completion"]>): void {
    if (this.settled) return;
    this.settled = true;
    this.#turn.status = result.outcome;
    clearTimeout(this.#turnTimer);
    if (this.#stallTimer) clearTimeout(this.#stallTimer);
    this.#completion.resolve(result);
    this.#controller.close();
  }
}

function userMessage(prompt: string, uuid: string): ClaudeMessage {
  return {
    type: "user",
    session_id: "",
    message: { role: "user", content: [{ type: "text", text: prompt }] },
    parent_tool_use_id: null,
    uuid,
  };
}
