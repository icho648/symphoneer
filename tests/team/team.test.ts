import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_SCHEMA_VERSION, type TaskSummary } from "@symphoneer/contracts";
import { FakeTeamOrchestrator } from "@symphoneer/runtime";

const task: TaskSummary = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "github:icho648/symphoneer:40",
  identifier: "#40",
  source: {
    kind: "github",
    nativeId: "40",
    url: "https://github.com/icho648/symphoneer/issues/40",
  },
  title: "Agent Team vertical slice",
  state: "open",
  labels: ["symphoneer:ready"],
  dispatchable: true,
  workflowStatus: "backlog",
  blocked: null,
};

function orchestrator() {
  return new FakeTeamOrchestrator({ now: () => new Date("2026-08-06T08:00:00.000Z") });
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    teamRunId: "team:happy",
    attemptId: "attempt:happy",
    task,
    ...overrides,
  } as Parameters<FakeTeamOrchestrator["startOrResume"]>[0];
}

test("LangGraph drives plan approval, three Fake AgentRuns, verification, and final decision", async () => {
  const handle = await orchestrator().startOrResume(request());
  const waiting = await handle.operation;

  assert.equal(waiting.teamRun.status, "awaiting_plan_approval");
  assert.equal(waiting.teamRun.currentNode, "approve_plan");
  assert.deepEqual(
    waiting.agentRuns.map((agent) => agent.role),
    ["planner"],
  );
  assert.equal((await handle.events[Symbol.asyncIterator]().next()).value?.type, "session_started");

  const implementing = await handle.resume("approve");
  assert.equal(implementing.teamRun.status, "awaiting_human_decision");
  assert.deepEqual(
    implementing.agentRuns.map((agent) => agent.role),
    ["planner", "implementer", "reviewer"],
  );
  assert.equal(implementing.teamRun.verificationStatus, "passed");
  assert.equal(
    implementing.events.some((event) => event.type === "tool_call"),
    true,
  );

  const completed = await handle.resume("accept");
  assert.equal(completed.teamRun.status, "completed");
  assert.equal(completed.teamRun.finalDecision, "accept");
  assert.equal(completed.teamRun.provider, "fake");
  await assert.doesNotReject(handle.completion);
});

test("LangGraph revise and request_changes paths remain bounded", async () => {
  const reviseHandle = await orchestrator().startOrResume(
    request({ teamRunId: "team:revise", attemptId: "attempt:revise" }),
  );
  assert.equal((await reviseHandle.operation).teamRun.status, "awaiting_plan_approval");
  assert.equal((await reviseHandle.resume("revise")).teamRun.status, "awaiting_plan_approval");
  assert.equal((await reviseHandle.resume("reject")).teamRun.status, "stopped");

  const loopHandle = await orchestrator().startOrResume(
    request({
      teamRunId: "team:loop",
      attemptId: "attempt:loop",
      scenario: { reviewDecisions: ["request_changes", "request_changes", "request_changes"] },
    }),
  );
  await loopHandle.operation;
  await loopHandle.resume("approve");
  const limit = await loopHandle.resume("stop");
  assert.equal(limit.teamRun.status, "stopped");
  assert.equal(limit.teamRun.reviewRound, 2);
});

test("verification failure remains separate from reviewer approval", async () => {
  const handle = await orchestrator().startOrResume(
    request({
      teamRunId: "team:fail",
      attemptId: "attempt:fail",
      scenario: { verification: "failed" },
    }),
  );
  await handle.operation;
  const waiting = await handle.resume("approve");
  assert.equal(waiting.teamRun.verificationStatus, "failed");
  assert.equal(waiting.teamRun.status, "awaiting_human_decision");
  const completed = await handle.resume("accept");
  assert.equal(completed.teamRun.status, "completed");
});
