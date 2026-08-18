import { ActivityPayloadSchema, type ExecutionSession } from "@symphoneer/contracts";
import type {
  AgentRunEvent,
  AgentRunRequest,
  InterventionResponse,
  RunHandle,
} from "../agent-runner.ts";
import { fingerprint } from "../input-fingerprint.ts";
import type { ClaudeInit } from "./protocol.ts";

type SessionTurn = ExecutionSession["turns"][number];

export function createClaudeRun(options: {
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
  const completion = Promise.withResolvers<Awaited<RunHandle["completion"]>>();
  const queued = new Set([options.turnId]);
  let controller!: ReadableStreamDefaultController<AgentRunEvent>;
  let stallTimer: NodeJS.Timeout | undefined;
  let started = false;
  let settled = false;
  let interrupted = false;
  let waiting = false;
  const events = new ReadableStream<AgentRunEvent>({
    start: (value) => {
      controller = value;
    },
  });
  const handle: RunHandle = {
    events,
    completion: completion.promise,
    interrupt: options.interrupt,
    steer: options.steer,
    respondToIntervention: options.respond,
  };
  const turnTimer = setTimeout(
    () => finish({ outcome: "failed", error: "claude_turn_timed_out" }),
    options.turnTimeoutMs,
  );

  function emit(event: AgentRunEvent): void {
    if (!settled) controller.enqueue(event);
  }

  function touch(): void {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = undefined;
    if (waiting || options.stallTimeoutMs === 0 || settled) return;
    stallTimer = setTimeout(
      () => finish({ outcome: "failed", error: "claude_turn_stalled" }),
      options.stallTimeoutMs,
    );
  }

  function finish(result: Awaited<RunHandle["completion"]>): void {
    if (settled) return;
    settled = true;
    options.turn.status = result.outcome;
    clearTimeout(turnTimer);
    if (stallTimer) clearTimeout(stallTimer);
    completion.resolve(result);
    controller.close();
  }

  touch();
  return {
    request: options.request,
    handle,
    get settled() {
      return settled;
    },
    get interrupted() {
      return interrupted;
    },
    set interrupted(value: boolean) {
      interrupted = value;
    },
    set waiting(value: boolean) {
      waiting = value;
      touch();
    },
    start(init: ClaudeInit): void {
      if (started || settled) return;
      started = true;
      emit({
        type: "session_started",
        occurredAt: options.now().toISOString(),
        threadId: init.sessionId,
        turnId: options.turnId,
        provider: {
          name: "claude-code",
          version: init.version,
          schema: "stream-json",
          inputFingerprint: fingerprint(options.request),
          model: init.model,
          permissionMode: init.permissionMode,
        },
      });
    },
    queue(uuid: string): void {
      queued.add(uuid);
      touch();
    },
    result(result: Awaited<RunHandle["completion"]>): void {
      const first = queued.values().next().value;
      if (first) queued.delete(first);
      if (queued.size === 0) finish(result);
    },
    activity(event: Extract<AgentRunEvent, { type: "activity" }>): void {
      options.turn.items.push({
        id: event.itemId,
        type: event.kind,
        status: event.status,
        data: { activity: ActivityPayloadSchema.parse(event) },
      });
      emit(event);
    },
    emit,
    touch,
    finish,
  };
}
