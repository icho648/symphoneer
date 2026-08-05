import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_SCHEMA_VERSION, type TaskSummary } from "@symphoneer/contracts";
import type { AgentRunRequest } from "../../src/runtime/executor/agent-runner.ts";
import { createWorkspaceReference } from "../../src/runtime/workspace/index.ts";
import { FakeAgentRunner } from "../fixtures/fake-agent-runner.ts";

const task: TaskSummary = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "task-13",
  identifier: "#13",
  source: {
    kind: "github",
    nativeId: "13",
    url: "https://github.com/icho648/symphoneer/issues/13",
  },
  title: "Build the core",
  state: "open",
  labels: ["symphoneer:ready"],
  dispatchable: true,
};

const request: AgentRunRequest = {
  attemptId: "attempt-13",
  task,
  workspace: createWorkspaceReference({
    root: "/tmp/symphoneer-workspaces",
    taskId: task.id,
    identifier: task.identifier,
    attemptId: "attempt-13",
    repository: "icho648/symphoneer",
    branch: "codex/issue-13",
    host: "local",
  }),
  prompt: "Implement #13",
  continuation: false,
};

test("the deterministic Fake satisfies the Agent Runner public contract", async () => {
  const runner = new FakeAgentRunner([
    {
      events: [
        {
          type: "session_started",
          occurredAt: "2026-08-02T12:00:00.000Z",
          threadId: "thread-13",
          turnId: "turn-13",
          provider: {
            name: "fake",
            version: "test",
            schema: "test",
            inputFingerprint: "a".repeat(64),
          },
        },
        {
          type: "intervention_requested",
          occurredAt: "2026-08-02T12:00:01.000Z",
          requestRef: "approval-13",
          kind: "approval",
          prompt: "Allow command?",
        },
      ],
      completion: { outcome: "completed" },
    },
  ]);

  const handle = await runner.startOrContinue(request);
  const events = [];
  for await (const event of handle.events) events.push(event);
  await handle.respondToIntervention("approval-13", { decision: "approved" });
  await handle.interrupt();

  assert.deepEqual(
    events.map(({ type }) => type),
    ["session_started", "intervention_requested"],
  );
  assert.deepEqual(await handle.completion, { outcome: "completed" });
  assert.deepEqual(runner.requests, [request]);
  assert.deepEqual(runner.responses, [
    { requestRef: "approval-13", decision: { decision: "approved" } },
  ]);
  assert.equal(runner.interruptCount, 1);
});
