import assert from "node:assert/strict";
import test from "node:test";

import {
  ApiErrorSchema,
  CONTRACT_SCHEMA_VERSION,
  DomainEventEnvelopeSchema,
  EligibilityResultSchema,
  InterventionSchema,
  PROJECTION_SCHEMA_VERSION,
  ReviewDecisionSchema,
} from "@symphoneer/contracts";

test("human decisions and interventions have explicit authority and resolution state", () => {
  const review = ReviewDecisionSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "review-13",
    attemptId: "attempt-13",
    decision: "continue",
    decidedBy: "icho648",
    decidedAt: "2026-08-02T12:05:00.000Z",
    evidenceIds: ["verification-13"],
    nextAction: "Address the failed check",
  });
  const intervention = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "intervention-13",
    attemptId: "attempt-13",
    requestRef: "request-13",
    kind: "approval",
    state: "pending",
    prompt: "Allow command?",
    createdAt: "2026-08-02T12:03:00.000Z",
  };

  assert.equal(review.decidedBy, "icho648");
  assert.equal(InterventionSchema.parse(intervention).state, "pending");
  assert.throws(() => InterventionSchema.parse({ ...intervention, state: "resolved" }));
  assert.throws(() =>
    InterventionSchema.parse({
      ...intervention,
      state: "resolved",
      resolution: {
        decidedBy: "icho648",
        decidedAt: "2026-08-02T12:02:00.000Z",
        decision: "approved",
      },
    }),
  );
});

test("eligibility, events, projection versions, and API errors stay versioned", () => {
  assert.equal(
    EligibilityResultSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      taskId: "task-13",
      eligible: false,
      reasons: ["missing_required_label"],
    }).eligible,
    false,
  );
  for (const result of [
    { eligible: true, reasons: ["terminal_state"] },
    { eligible: false, reasons: [] },
  ]) {
    assert.throws(() =>
      EligibilityResultSchema.parse({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        taskId: "task-13",
        ...result,
      }),
    );
  }
  assert.equal(PROJECTION_SCHEMA_VERSION, 1);
  assert.equal(
    DomainEventEnvelopeSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      id: "event-13",
      type: "attempt.reserved",
      source: "symphony-core",
      occurredAt: "2026-08-02T12:00:00.000Z",
      aggregate: { kind: "attempt", id: "attempt-13" },
      taskId: "task-13",
      attemptId: "attempt-13",
      idempotencyKey: "dispatch-task-13",
      payload: { sequence: 1 },
    }).payload.sequence,
    1,
  );
  assert.equal(
    ApiErrorSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      code: "conflict",
      message: "Task already has an active Attempt",
      retryable: false,
    }).code,
    "conflict",
  );
});
