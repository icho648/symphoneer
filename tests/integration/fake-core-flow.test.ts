import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { CONTRACT_SCHEMA_VERSION, type TaskSummary } from "@symphoneer/contracts";
import {
  CoreScheduler,
  createWorkspaceReference,
  loadWorkflow,
  renderPrompt,
} from "@symphoneer/runtime";
import { FakeAgentRunner } from "../fixtures/fake-agent-runner.ts";

test("the Fake Runner drives one deterministic core Attempt without Provider claims", async () => {
  const workflow = await loadWorkflow({
    workspaceRoot: resolve(tmpdir(), "symphoneer-integration-workspaces"),
  });
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
    workflowStatus: "ready",
    blocked: null,
  };
  const workspace = createWorkspaceReference({
    root: workflow.config.workspace.root,
    taskId: task.id,
    identifier: task.identifier,
    attemptId: "attempt-13",
    repository: "icho648/symphoneer",
    branch: "codex/issue-13",
    host: "local",
  });
  const scheduler = new CoreScheduler({
    activeStates: workflow.config.tracker.activeStates,
    terminalStates: workflow.config.tracker.terminalStates,
    requiredLabels: [
      ...workflow.config.tracker.requiredLabels,
      ...workflow.config.symphoneer.eligibility.requiredLabels,
    ],
    excludedLabels: workflow.config.symphoneer.eligibility.excludedLabels,
    maxConcurrentAgents: workflow.config.agent.maxConcurrentAgents,
    maxConcurrentAgentsByState: workflow.config.agent.maxConcurrentAgentsByState,
    maxRetryBackoffMs: workflow.config.agent.maxRetryBackoffMs,
  });
  const reservation = scheduler.reserveAttempt({
    task,
    attemptId: "attempt-13",
    sequence: 1,
    startReason: "dispatch",
    workspace,
    startedAt: "2026-08-02T12:00:00.000Z",
    idempotencyKey: "dispatch-13",
  });
  assert.equal(reservation.kind, "reserved");

  const runner = new FakeAgentRunner([
    {
      events: [
        {
          type: "session_started",
          occurredAt: "2026-08-02T12:00:01.000Z",
          threadId: "thread-13",
          turnId: "turn-13",
          provider: {
            name: "fake",
            version: "test",
            schema: "test",
            inputFingerprint: "a".repeat(64),
          },
        },
      ],
      completion: { outcome: "completed" },
    },
  ]);
  const handle = await runner.startOrContinue({
    attemptId: "attempt-13",
    task,
    workspace,
    prompt: await renderPrompt(workflow, { issue: task, attempt: null }),
    continuation: false,
  });
  for await (const event of handle.events) {
    if (event.type === "session_started") {
      scheduler.attachTurn({
        attemptId: "attempt-13",
        threadId: event.threadId,
        turnId: event.turnId,
        updatedAt: event.occurredAt,
        idempotencyKey: "attach-turn-13",
      });
    }
  }
  const completion = await handle.completion;
  const result = scheduler.finishAttempt({
    attemptId: "attempt-13",
    status: completion.outcome === "completed" ? "succeeded" : "failed",
    finishedAt: "2026-08-02T12:00:02.000Z",
    workspace: { ...workspace, state: "retained", ownerAttemptId: null },
    idempotencyKey: "finish-13",
  });

  assert.equal(result.retry?.kind, "continuation");
  assert.equal(scheduler.snapshot().activeAttempts.length, 0);
  assert.equal(runner.requests.length, 1);
});
