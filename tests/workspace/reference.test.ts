import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { createWorkspaceReference, workspaceKey } from "../../src/runtime/workspace/index.ts";

test("workspace keys are deterministic, collision-resistant, and contained by their root", () => {
  assert.equal(workspaceKey("ISSUE-13"), "ISSUE-13");
  assert.equal(workspaceKey("#13"), "issue-13");
  assert.match(workspaceKey("ISSUE/13"), /^ISSUE_13-[a-f0-9]{16}$/);
  assert.notEqual(workspaceKey("ISSUE/13"), workspaceKey("ISSUE?13"));

  const attemptId =
    "attempt:github%3Aicho648%2Fsymphoneer%3A13:3c1e7c66-95a7-4fd1-af0a-4265ed445ae9";
  const workspace = createWorkspaceReference({
    root: "/tmp/symphoneer-workspaces",
    taskId: "task-13",
    identifier: "#13",
    attemptId,
    repository: "icho648/symphoneer",
    branch: "codex/issue-13",
    host: "local",
  });

  assert.equal(workspace.path, resolve("/tmp/symphoneer-workspaces", "issue-13"));
  assert.equal(workspace.id, "workspace:task-13");
  assert.equal(workspace.ownerAttemptId, attemptId);

  const retry = createWorkspaceReference({
    root: "/tmp/symphoneer-workspaces",
    taskId: "task-13",
    identifier: "#13",
    attemptId: "attempt-14",
    repository: "icho648/symphoneer",
    branch: "codex/issue-13",
    host: "local",
  });
  assert.equal(retry.id, workspace.id);
  assert.equal(retry.path, workspace.path);
  assert.equal(retry.branch, workspace.branch);
  assert.equal(retry.ownerAttemptId, "attempt-14");
  assert.throws(() =>
    createWorkspaceReference({
      root: "/tmp/symphoneer-workspaces",
      taskId: "task-dotdot",
      identifier: "..",
      attemptId: "attempt-dotdot",
      repository: "icho648/symphoneer",
      branch: "codex/dotdot",
      host: "local",
    }),
  );
});
