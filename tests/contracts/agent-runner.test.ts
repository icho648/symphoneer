import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTRACT_SCHEMA_VERSION,
  RuntimeCommandSchema,
  type TaskSummary,
} from "@symphoneer/contracts";
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
  workflowStatus: "ready",
  blocked: null,
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

test("the Runtime start command retains the selected Codex settings", () => {
  const command = RuntimeCommandSchema.parse({
    kind: "start_run",
    mode: "single-agent",
    idempotencyKey: "start-with-codex-settings",
    task,
    model: "gpt-5.6-codex",
    sandbox: "read-only",
    effort: "high",
  });

  if (command.kind !== "start_run") assert.fail("start_run command missing");
  assert.equal(command.model, "gpt-5.6-codex");
  assert.equal(command.sandbox, "read-only");
  assert.equal(command.effort, "high");
});

test("the Runtime input command retains settings for the next Codex turn", () => {
  const command = RuntimeCommandSchema.parse({
    kind: "send_attempt_input",
    idempotencyKey: "continue-with-codex-settings",
    attemptId: "attempt-13",
    prompt: "Continue with broader access",
    model: "gpt-5.6-codex",
    sandbox: "danger-full-access",
    effort: "xhigh",
  });

  if (command.kind !== "send_attempt_input") assert.fail("send_attempt_input command missing");
  assert.equal(command.model, "gpt-5.6-codex");
  assert.equal(command.sandbox, "danger-full-access");
  assert.equal(command.effort, "xhigh");
});

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
