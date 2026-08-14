import assert from "node:assert/strict";
import test from "node:test";

import {
  ActivityOccurrenceSchema,
  ActivityPayloadSchema,
  CONTRACT_SCHEMA_VERSION,
  ExecutionActivitySchema,
  ExecutionSessionSchema,
} from "@symphoneer/contracts";

test("Codex and Pi activity projections share one bounded display contract", () => {
  const codex = ActivityPayloadSchema.parse({
    kind: "command",
    status: "completed",
    title: "pnpm check",
    content: null,
    details: { command: "pnpm check", exitCode: 0 },
  });
  const pi = ActivityPayloadSchema.parse({
    kind: "tool",
    status: "running",
    title: "read",
    content: null,
    details: { input: "src/counter.ts" },
  });

  assert.equal(codex.kind, "command");
  assert.equal(pi.kind, "tool");
  assert.throws(() => ActivityPayloadSchema.parse({ ...pi, kind: "provider_session" }));
});

test("execution sessions retain the observed Executor identity", () => {
  for (const provider of ["fake", "codex-app-server", "claude-code"] as const) {
    assert.equal(
      ExecutionSessionSchema.parse({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        attemptId: "attempt-1",
        provider,
        threadId: "session-1",
        turns: [],
        capturedAt: "2026-08-14T12:00:00.000Z",
      }).provider,
      provider,
    );
  }
});

test("an activity occurrence gains Attempt identity only when persisted", () => {
  const occurrence = ActivityOccurrenceSchema.parse({
    itemId: "tool-1",
    occurredAt: "2026-08-10T12:00:00.000Z",
    kind: "tool",
    status: "completed",
    title: "read",
    content: "Loaded src/counter.ts",
    details: {},
  });
  const execution = ExecutionActivitySchema.parse({
    ...occurrence,
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "activity:attempt-1:tool-1",
    attemptId: "attempt-1",
  });

  assert.equal(execution.itemId, occurrence.itemId);
  assert.equal(execution.attemptId, "attempt-1");
});
