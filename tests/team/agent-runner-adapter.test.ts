import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_SCHEMA_VERSION, type TaskSummary } from "@symphoneer/contracts";
import { AgentRunnerTeamAdapter } from "@symphoneer/runtime";
import { createWorkspaceReference } from "../../src/runtime/workspace/index.ts";
import { FakeAgentRunner } from "../fixtures/fake-agent-runner.ts";

const task: TaskSummary = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "task-40",
  identifier: "#40",
  source: {
    kind: "github",
    nativeId: "40",
    url: "https://github.com/icho648/symphoneer/issues/40",
  },
  title: "Workflow adapter",
  state: "open",
  labels: [],
  dispatchable: true,
  workflowStatus: "ready",
  blocked: null,
};

test("the workflow executor can be swapped to the existing AgentRunner seam", async () => {
  const runner = new FakeAgentRunner([
    {
      events: [
        {
          type: "session_started",
          occurredAt: "2026-08-06T08:00:00.000Z",
          threadId: "thread-40",
          turnId: "turn-40",
          provider: {
            name: "fake",
            version: "test",
            schema: "test",
            inputFingerprint: "a".repeat(64),
          },
        },
        {
          type: "notification",
          occurredAt: "2026-08-06T08:00:01.000Z",
          message: "executor progress",
        },
      ],
      completion: { outcome: "completed" },
    },
  ]);
  const adapter = new AgentRunnerTeamAdapter(runner);
  const result = await adapter.run({
    teamRunId: "workflow:40",
    attemptId: "attempt:40",
    task,
    workspace: createWorkspaceReference({
      root: "/tmp/symphoneer-workspaces",
      taskId: task.id,
      identifier: task.identifier,
      attemptId: "attempt:40",
      repository: "icho648/symphoneer",
      branch: "codex/issue-40",
      host: "local",
    }),
    prompt: "Implement the workflow",
    continuation: false,
    role: "planner",
    reviewRound: 0,
    eventIndex: 0,
    now: "2026-08-06T08:00:00.000Z",
    scenario: { reviewDecisions: ["approve"], verification: "passed" },
  });

  assert.equal(result.agentRun.providerSession?.threadId, "thread-40");
  assert.equal(result.agentRun.status, "completed");
  assert.deepEqual(
    result.events.map((event) => event.type),
    ["session_started", "progress_summary", "session_completed"],
  );
  assert.equal(runner.requests[0]?.continuation, false);
});
