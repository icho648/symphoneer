import { createHash } from "node:crypto";

import type {
  AgentRunCompletion,
  AgentRunEvent,
  AgentRunner,
  AgentRunRequest,
  InterventionResponse,
  RunHandle,
} from "@symphoneer/symphony-core";

import {
  type CodexServerMessage,
  type CodexTransport,
  type JsonRpcId,
  StdioCodexTransport,
} from "./transport.ts";

const CODEX_PROTOCOL = "v2";

type PendingIntervention =
  | { id: JsonRpcId; method: "approval" }
  | { id: JsonRpcId; method: "input"; questionIds: string[] };

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const stringField = (value: unknown, field: string): string | null => {
  const record = asRecord(value);
  return record && typeof record[field] === "string" ? record[field] : null;
};

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
    let threadId: string;
    let turnId: string;
    try {
      await transport.request("initialize", {
        clientInfo: { name: "symphoneer", title: "Symphoneer", version: "0.0.0" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      transport.notify("initialized");
      const threadResponse = await transport.request(
        request.continuation ? "thread/resume" : "thread/start",
        request.continuation
          ? {
              threadId: request.threadId,
              cwd: request.workspace.path,
              runtimeWorkspaceRoots: [request.workspace.path],
              approvalPolicy: this.#approvalPolicy,
              sandbox: this.#sandbox,
              excludeTurns: true,
            }
          : {
              cwd: request.workspace.path,
              runtimeWorkspaceRoots: [request.workspace.path],
              approvalPolicy: this.#approvalPolicy,
              sandbox: this.#sandbox,
            },
      );
      threadId = stringField(asRecord(threadResponse)?.thread, "id") ?? "";
      if (!threadId || (request.threadId && request.threadId !== threadId)) {
        throw new Error("Codex returned an invalid thread identity");
      }
      const turnResponse = await transport.request("turn/start", {
        threadId,
        input: [{ type: "text", text: request.prompt, text_elements: [] }],
        cwd: request.workspace.path,
        runtimeWorkspaceRoots: [request.workspace.path],
        approvalPolicy: this.#approvalPolicy,
      });
      turnId = stringField(asRecord(turnResponse)?.turn, "id") ?? "";
      if (!turnId) throw new Error("Codex returned an invalid turn identity");
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw error;
    }

    const completion = Promise.withResolvers<AgentRunCompletion>();
    const pending = new Map<string, PendingIntervention>();
    let controller!: ReadableStreamDefaultController<AgentRunEvent>;
    let eventsCanceled = false;
    const stream = new ReadableStream<AgentRunEvent>({
      start: (value) => {
        controller = value;
      },
      cancel: () => {
        eventsCanceled = true;
      },
    });
    const emit = (event: AgentRunEvent) => {
      if (!eventsCanceled) controller.enqueue(event);
    };
    let settled = false;
    let stallTimer: NodeJS.Timeout | undefined;
    const turnTimer = setTimeout(() => {
      void transport.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
      finish({ outcome: "failed", error: "turn_timed_out" });
    }, this.#turnTimeoutMs);
    const resetStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      if (this.#stallTimeoutMs === 0) return;
      stallTimer = setTimeout(() => {
        void transport.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
        finish({ outcome: "failed", error: "turn_stalled" });
      }, this.#stallTimeoutMs);
    };
    const finish = (result: AgentRunCompletion) => {
      if (settled) return;
      settled = true;
      clearTimeout(turnTimer);
      if (stallTimer) clearTimeout(stallTimer);
      completion.resolve(result);
      void transport.close().catch(() => undefined);
      if (!eventsCanceled) {
        try {
          controller.close();
        } catch {
          // Event consumption is non-authoritative after completion settles.
        }
      }
    };

    emit({
      type: "session_started",
      occurredAt: this.#now().toISOString(),
      threadId,
      turnId,
      provider: {
        name: "codex-app-server",
        version: transport.toolVersion,
        schema: CODEX_PROTOCOL,
        inputFingerprint: fingerprint(request),
      },
    });
    resetStall();
    void this.#pump(transport, threadId, turnId, pending, emit, resetStall, finish);
    void transport.closed.then(() => {
      if (!settled) finish({ outcome: "failed", error: "codex_app_server_exited" });
    });

    return {
      events: stream,
      completion: completion.promise,
      async interrupt() {
        await transport.request("turn/interrupt", { threadId, turnId });
      },
      async respondToIntervention(requestRef, decision) {
        const intervention = pending.get(requestRef);
        if (!intervention) throw new Error(`Unknown Codex intervention ${requestRef}`);
        if (intervention.method === "approval") {
          transport.respond(intervention.id, { decision: approvalDecision(decision) });
        } else {
          transport.respond(intervention.id, {
            answers: inputAnswers(intervention.questionIds, decision),
          });
        }
        pending.delete(requestRef);
      },
    };
  }

  async #pump(
    transport: CodexTransport,
    threadId: string,
    turnId: string,
    pending: Map<string, PendingIntervention>,
    emit: (event: AgentRunEvent) => void,
    resetStall: () => void,
    finish: (result: AgentRunCompletion) => void,
  ): Promise<void> {
    try {
      for await (const message of transport.messages) {
        if (!belongsToTurn(message, threadId, turnId)) continue;
        resetStall();
        if (message.kind === "request") {
          this.#requestIntervention(transport, message, pending, emit);
          continue;
        }
        if (message.method === "turn/completed") {
          const status = stringField(asRecord(message.params)?.turn, "status");
          finish({
            outcome:
              status === "completed"
                ? "completed"
                : status === "interrupted"
                  ? "interrupted"
                  : "failed",
            ...(status === "failed"
              ? { error: "codex_turn_failed" }
              : status !== "completed" && status !== "interrupted"
                ? { error: "codex_turn_invalid_status" }
                : {}),
          });
          return;
        }
        if (message.method !== "turn/started") {
          emit({
            type: "notification",
            occurredAt: this.#now().toISOString(),
            message: message.method,
          });
        }
      }
    } catch {
      finish({ outcome: "failed", error: "codex_protocol_failed" });
    }
  }

  #requestIntervention(
    transport: CodexTransport,
    message: Extract<CodexServerMessage, { kind: "request" }>,
    pending: Map<string, PendingIntervention>,
    emit: (event: AgentRunEvent) => void,
  ): void {
    const requestRef = `${typeof message.id}:${message.id}`;
    if (
      message.method === "item/commandExecution/requestApproval" ||
      message.method === "item/fileChange/requestApproval"
    ) {
      pending.set(requestRef, { id: message.id, method: "approval" });
      emit({
        type: "intervention_requested",
        occurredAt: this.#now().toISOString(),
        requestRef,
        kind: "approval",
        prompt: "Codex requests approval for a workspace action.",
      });
      return;
    }
    if (message.method === "item/tool/requestUserInput") {
      const rawQuestions = asRecord(message.params)?.questions;
      const questions = Array.isArray(rawQuestions)
        ? rawQuestions
            .map((question) => ({
              id: stringField(question, "id"),
              prompt: stringField(question, "question"),
            }))
            .filter((question): question is { id: string; prompt: string } =>
              Boolean(question.id && question.prompt),
            )
        : [];
      if (questions.length === 0) {
        transportError(message, "Invalid request_user_input payload");
        return;
      }
      pending.set(requestRef, {
        id: message.id,
        method: "input",
        questionIds: questions.map(({ id }) => id),
      });
      emit({
        type: "intervention_requested",
        occurredAt: this.#now().toISOString(),
        requestRef,
        kind: "input",
        prompt: questions.map(({ prompt }) => prompt).join("\n"),
      });
      return;
    }
    transportError(message, "Unsupported Codex server request");

    function transportError(request: typeof message, error: string) {
      // The caller will keep the Turn paused until Codex acknowledges the protocol error.
      // Do not include the Provider payload in the error response.
      transport.reject(request.id, -32601, error);
    }
  }
}

function belongsToTurn(message: CodexServerMessage, threadId: string, turnId: string): boolean {
  const requiresOwnership =
    message.method.startsWith("turn/") || message.method.startsWith("item/");
  const params = asRecord(message.params);
  if (!params) return !requiresOwnership;
  const messageThreadId =
    (typeof params.threadId === "string" ? params.threadId : null) ??
    stringField(params.thread, "id");
  const messageTurnId =
    (typeof params.turnId === "string" ? params.turnId : null) ?? stringField(params.turn, "id");
  if (requiresOwnership) {
    return messageThreadId === threadId && messageTurnId === turnId;
  }
  return (
    (messageThreadId === null || messageThreadId === threadId) &&
    (messageTurnId === null || messageTurnId === turnId)
  );
}

function approvalDecision(decision: InterventionResponse): "accept" | "cancel" | "decline" {
  if (decision.decision === "approved") return "accept";
  if (decision.decision === "rejected") return "decline";
  if (decision.decision === "canceled") return "cancel";
  throw new Error("Approval interventions require approved, rejected, or canceled");
}

function inputAnswers(
  questionIds: string[],
  decision: InterventionResponse,
): Record<string, { answers: string[] }> {
  if (decision.decision === "canceled" || decision.decision === "rejected") return {};
  if (decision.decision !== "answered") throw new Error("Input interventions require an answer");
  const responses =
    decision.responses ??
    (decision.response && questionIds.length === 1
      ? { [questionIds[0] as string]: [decision.response] }
      : undefined);
  if (!responses || questionIds.some((id) => !responses[id])) {
    throw new Error("Input intervention answers must cover every Codex question");
  }
  return Object.fromEntries(questionIds.map((id) => [id, { answers: responses[id] as string[] }]));
}

function fingerprint(request: AgentRunRequest): string {
  const promptDigest = createHash("sha256").update(request.prompt).digest("hex");
  return createHash("sha256")
    .update(
      JSON.stringify({
        attemptId: request.attemptId,
        taskId: request.task.id,
        taskUpdatedAt: request.task.updatedAt ?? null,
        workspaceId: request.workspace.id,
        repository: request.workspace.repository,
        branch: request.workspace.branch,
        gitHead: request.workspace.gitHead,
        worktreeFingerprint: request.workspace.worktreeFingerprint,
        continuation: request.continuation,
        threadId: request.threadId ?? null,
        promptDigest,
      }),
    )
    .digest("hex");
}
