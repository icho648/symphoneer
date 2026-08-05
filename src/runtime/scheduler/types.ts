import type {
  AttemptSnapshot,
  EligibilityReason,
  TaskSummary,
  WorkspaceReference,
} from "@symphoneer/contracts";

import type { EligibilityPolicy } from "./eligibility.ts";

export interface CorePolicy extends EligibilityPolicy {
  maxConcurrentAgents: number;
  maxConcurrentAgentsByState: Readonly<Record<string, number>>;
  maxRetryBackoffMs: number;
}

export interface ReserveAttemptRequest {
  task: TaskSummary;
  attemptId: string;
  sequence: number;
  startReason: AttemptSnapshot["startReason"];
  workspace: WorkspaceReference;
  startedAt: string;
  idempotencyKey: string;
}

export type ReserveDecision =
  | { kind: "reserved"; attempt: AttemptSnapshot }
  | { kind: "rejected"; reasons: EligibilityReason[] };

export interface RetryEntry {
  taskId: string;
  identifier: string;
  attempt: number;
  kind: "failure" | "continuation";
  dueAtMs: number;
  error: string | null;
}

export type RetryTransition =
  | { kind: "not_due"; retry: RetryEntry }
  | {
      kind: "released";
      reason: "terminal" | "missing" | "unroutable";
      cleanupWorkspaceIds: string[];
    }
  | { kind: "requeued"; retry: RetryEntry }
  | { kind: "reserved"; attempt: AttemptSnapshot };

export type TerminalAttemptStatus =
  | "succeeded"
  | "failed"
  | "timed_out"
  | "stalled"
  | "canceled_by_reconciliation";

export class CoreError extends Error {
  readonly code: "conflict" | "not_found" | "invalid_transition";

  constructor(code: CoreError["code"], message: string) {
    super(message);
    this.name = "CoreError";
    this.code = code;
  }
}
