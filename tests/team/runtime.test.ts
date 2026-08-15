import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";

import { CONTRACT_SCHEMA_VERSION, type TaskSummary } from "@symphoneer/contracts";
import { RuntimeError, RuntimeService } from "@symphoneer/runtime";

const task: TaskSummary = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "github:icho648/symphoneer:40",
  identifier: "#40",
  source: {
    kind: "github",
    nativeId: "40",
    url: "https://github.com/icho648/symphoneer/issues/40",
  },
  title: "LangGraph workflow vertical slice",
  state: "open",
  labels: [],
  dispatchable: true,
  workflowStatus: "backlog",
  blocked: null,
};

async function root(t: TestContext): Promise<string> {
  const value = await mkdtemp(resolve(tmpdir(), "symphoneer-workflow-"));
  t.after(() => rm(value, { recursive: true, force: true }));
  return value;
}

function service(dataDir: string, prefix: string): RuntimeService {
  let id = 0;
  return new RuntimeService({
    dataDir,
    runtimeId: `runtime:${prefix}`,
    idFactory: () => `${prefix}-${++id}`,
    now: () => new Date("2026-08-06T08:00:00.000Z"),
  });
}

test("Runtime persists LangGraph workflow checkpoints and resumes from the projection", async (t) => {
  const dataDir = await root(t);
  const first = service(dataDir, "first");
  await first.start();
  await first.recordTask(task);
  const started = await first.execute({
    kind: "start_run",
    mode: "team",
    idempotencyKey: "web:start-workflow-40",
    task,
  });
  const waiting = started.snapshot.teamRuns[0];
  assert.equal(waiting?.workflow, "plan-implement-review");
  assert.equal(waiting?.definitionId, "plan-implement-review");
  assert.equal(waiting?.definitionVersion, 1);
  assert.match(waiting?.definitionHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(waiting?.status, "awaiting_plan_approval");
  assert.equal(started.snapshot.attempts.length, 1);

  const restarted = service(dataDir, "restarted");
  await restarted.start();
  const resumed = await restarted.execute({
    kind: "approve_plan",
    idempotencyKey: "web:approve-workflow-40",
    teamRunId: waiting?.id,
    expectedTeamRevision: waiting?.revision,
    expectedEventSequence: started.snapshot.runtime.lastEventSequence,
  });
  const awaitingDecision = resumed.snapshot.teamRuns[0];
  assert.equal(awaitingDecision?.status, "awaiting_human_decision");
  assert.equal(awaitingDecision?.verificationStatus, "failed");
  assert.equal(resumed.snapshot.verifications.length, 1);

  const completed = await restarted.execute({
    kind: "final_decision",
    idempotencyKey: "web:accept-workflow-40",
    teamRunId: awaitingDecision?.id,
    expectedTeamRevision: awaitingDecision?.revision,
    expectedEventSequence: resumed.snapshot.runtime.lastEventSequence,
    decision: "accept",
  });
  assert.equal(completed.snapshot.teamRuns[0]?.status, "completed");
  assert.equal(completed.snapshot.attempts[0]?.status, "succeeded");
  assert.equal(completed.snapshot.tasks[0]?.workflowStatus, "in_progress");
  assert.equal(completed.snapshot.tasks[0]?.blocked?.reason, "Verification failed");
});

test("Runtime rejects team commands that do not match the pending human gate", async (t) => {
  const dataDir = await root(t);
  const runtime = service(dataDir, "gate-match");
  await runtime.start();
  await runtime.recordTask(task);
  const started = await runtime.execute({
    kind: "start_run",
    mode: "team",
    idempotencyKey: "web:start-mismatched-gate",
    task,
  });
  const waiting = started.snapshot.teamRuns[0];
  assert.equal(waiting?.status, "awaiting_plan_approval");
  assert.equal(waiting?.pendingHumanInput?.kind, "plan_approval");

  await assert.rejects(
    () =>
      runtime.execute({
        kind: "final_decision",
        idempotencyKey: "web:final-while-plan",
        teamRunId: waiting?.id,
        expectedTeamRevision: waiting?.revision,
        expectedEventSequence: started.snapshot.runtime.lastEventSequence,
        decision: "accept",
      }),
    (error) => error instanceof RuntimeError && error.code === "invalid_request",
  );

  const stillWaiting = runtime.snapshot().teamRuns[0];
  assert.equal(stillWaiting?.status, "awaiting_plan_approval");
  assert.equal(stillWaiting?.revision, waiting?.revision);
});

test("Runtime stop at the plan approval gate terminates the workflow", async (t) => {
  const dataDir = await root(t);
  const runtime = service(dataDir, "stop-plan");
  await runtime.start();
  await runtime.recordTask(task);
  const started = await runtime.execute({
    kind: "start_run",
    mode: "team",
    idempotencyKey: "web:start-stop-plan",
    task,
  });
  const waiting = started.snapshot.teamRuns[0];
  assert.equal(waiting?.status, "awaiting_plan_approval");

  const stopped = await runtime.execute({
    kind: "stop_team_session",
    idempotencyKey: "web:stop-at-plan",
    teamRunId: waiting?.id,
    expectedTeamRevision: waiting?.revision,
    expectedEventSequence: started.snapshot.runtime.lastEventSequence,
  });
  assert.equal(stopped.snapshot.teamRuns[0]?.status, "stopped");
  assert.equal(stopped.snapshot.attempts[0]?.status, "failed");
});

test("Runtime rejects start_run when the Attempt ID already exists", async (t) => {
  const dataDir = await root(t);
  const runtime = service(dataDir, "attempt-collision");
  await runtime.start();
  await runtime.recordTask(task);
  await runtime.execute({
    kind: "start_run",
    mode: "team",
    idempotencyKey: "web:start-attempt-1",
    task,
    attemptId: "attempt:shared",
    teamRunId: "team:shared-1",
  });

  await assert.rejects(
    () =>
      runtime.execute({
        kind: "start_run",
        mode: "team",
        idempotencyKey: "web:start-attempt-2",
        task,
        attemptId: "attempt:shared",
        teamRunId: "team:shared-2",
      }),
    (error) => error instanceof RuntimeError && error.code === "conflict",
  );

  assert.equal(runtime.snapshot().teamRuns.length, 1);
  assert.equal(runtime.snapshot().attempts.length, 1);
});
