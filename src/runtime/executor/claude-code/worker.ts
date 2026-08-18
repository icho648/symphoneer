import {
  CONTRACT_SCHEMA_VERSION,
  type ExecutionSession,
  ExecutionSessionSchema,
} from "@symphoneer/contracts";
import type {
  AgentRunRequest,
  AgentTurnRequest,
  AgentWorkerRequest,
  AttemptWorker,
  InterventionResponse,
  RunHandle,
} from "../agent-runner.ts";
import {
  type ClaudeInit,
  type ClaudePermissionRequest,
  claudeActivities,
  claudeCompletion,
  claudeSessionId,
  parseClaudeInit,
  parsePermissionRequest,
} from "./protocol.ts";
import { createClaudeRun } from "./run.ts";
import type { ClaudeMessage, ClaudePermissionMode, ClaudeTransport } from "./transport.ts";

type SessionTurn = ExecutionSession["turns"][number];

interface ClaudeWorkerOptions {
  transport: ClaudeTransport;
  request: AgentWorkerRequest;
  permissionMode: ClaudePermissionMode;
  turnTimeoutMs: number;
  stallTimeoutMs: number;
  now: () => Date;
}

export class ClaudeAttemptWorker implements AttemptWorker {
  readonly processIdentity: AttemptWorker["processIdentity"];
  readonly #options: ClaudeWorkerOptions;
  readonly #turns: SessionTurn[] = [];
  readonly #permissions = new Map<string, ClaudePermissionRequest>();
  #init: ClaudeInit | undefined;
  #active: ReturnType<typeof createClaudeRun> | undefined;
  #closed = false;

  constructor(options: ClaudeWorkerOptions) {
    this.#options = options;
    this.processIdentity = {
      pid: options.transport.processIdentity.pid,
      toolVersion: options.transport.toolVersion,
    };
    void this.#pump();
    void options.transport.closed.then(({ code }) => {
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
    const expectedSessionId =
      request.threadId ?? this.#options.request.sessionId ?? this.#init?.sessionId;
    if (request.threadId && this.#init && request.threadId !== this.#init.sessionId) {
      throw new Error("Attempt Worker cannot switch Claude Sessions");
    }
    const runRequest: AgentRunRequest = {
      ...this.#options.request,
      prompt: request.prompt,
      continuation: expectedSessionId !== undefined,
      ...(expectedSessionId ? { threadId: expectedSessionId } : {}),
    };
    const turnId = crypto.randomUUID();
    const turn: SessionTurn = { id: turnId, status: "running", items: [] };
    this.#turns.push(turn);
    const run = createClaudeRun({
      request: runRequest,
      turn,
      turnId,
      turnTimeoutMs: this.#options.turnTimeoutMs,
      stallTimeoutMs: this.#options.stallTimeoutMs,
      now: this.#options.now,
      interrupt: () => this.#interrupt(),
      steer: (prompt) => this.#steer(prompt),
      respond: (requestRef, decision) => this.#respond(requestRef, decision),
    });
    this.#active = run;
    if (this.#init) run.start(this.#init);
    this.#options.transport.send(userMessage(request.prompt, turnId));
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
      attemptId: this.#options.request.attemptId,
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
    await this.#options.transport.close();
  }

  async #pump(): Promise<void> {
    try {
      for await (const message of this.#options.transport.messages) this.#receive(message);
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
      if (init.version !== this.#options.transport.toolVersion) {
        run.finish({ outcome: "failed", error: "claude_version_changed" });
        return;
      }
      const expected = this.#options.request.sessionId ?? run.request.threadId;
      if (expected && init.sessionId !== expected) {
        run.finish({ outcome: "failed", error: "claude_resume_session_mismatch" });
        return;
      }
      if (init.permissionMode !== this.#options.permissionMode) {
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
      await this.#options.transport.request({ subtype: "interrupt" });
      return;
    }
    await this.#options.transport.terminate();
    run.finish({ outcome: "interrupted" });
  }

  async #steer(prompt: string): Promise<void> {
    const run = this.#active;
    if (!run || run.settled) throw new Error("Claude Turn is not active");
    const uuid = crypto.randomUUID();
    run.queue(uuid);
    this.#options.transport.send(userMessage(prompt, uuid));
  }

  async #respond(requestRef: string, decision: InterventionResponse): Promise<void> {
    const permission = this.#permissions.get(requestRef);
    if (!permission) throw new Error(`Unknown Claude intervention ${requestRef}`);
    if (!["approved", "rejected", "canceled"].includes(decision.decision)) {
      throw new Error("Claude permission interventions require an approval decision");
    }
    const allowed = decision.decision === "approved";
    this.#options.transport.send({
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
    return this.#options.now().toISOString();
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
