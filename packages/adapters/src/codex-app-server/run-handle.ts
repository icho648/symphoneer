import type {
  AgentRunCompletion,
  AgentRunEvent,
  AgentRunRequest,
  RunHandle,
} from "@symphoneer/symphony-core";

import { fingerprint } from "./input-fingerprint.ts";
import {
  approvalDecision,
  inputAnswers,
  type PendingIntervention,
  requestIntervention,
} from "./interventions.ts";
import { asRecord, belongsToTurn, stringField } from "./protocol.ts";
import type { CodexTransport } from "./transport.ts";

const CODEX_PROTOCOL = "v2";

export function createRunHandle(options: {
  transport: CodexTransport;
  request: AgentRunRequest;
  threadId: string;
  turnId: string;
  turnTimeoutMs: number;
  stallTimeoutMs: number;
  now: () => Date;
}): RunHandle {
  const { transport, request, threadId, turnId, turnTimeoutMs, stallTimeoutMs, now } = options;
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
  }, turnTimeoutMs);
  const resetStall = () => {
    if (stallTimer) {
      clearTimeout(stallTimer);
      stallTimer = undefined;
    }
    if (pending.size > 0 || stallTimeoutMs === 0) return;
    stallTimer = setTimeout(() => {
      void transport.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
      finish({ outcome: "failed", error: "turn_stalled" });
    }, stallTimeoutMs);
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
    occurredAt: now().toISOString(),
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
  void pump(transport, threadId, turnId, pending, emit, resetStall, finish, now);
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
      resetStall();
    },
  };
}

async function pump(
  transport: CodexTransport,
  threadId: string,
  turnId: string,
  pending: Map<string, PendingIntervention>,
  emit: (event: AgentRunEvent) => void,
  resetStall: () => void,
  finish: (result: AgentRunCompletion) => void,
  now: () => Date,
): Promise<void> {
  try {
    for await (const message of transport.messages) {
      if (!belongsToTurn(message, threadId, turnId)) continue;
      resetStall();
      if (message.kind === "request") {
        requestIntervention(transport, message, pending, emit, now);
        resetStall();
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
          occurredAt: now().toISOString(),
          message: message.method,
        });
      }
    }
  } catch {
    finish({ outcome: "failed", error: "codex_protocol_failed" });
  }
}
