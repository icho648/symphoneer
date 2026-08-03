import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import {
  createWorkspaceReference,
  workspaceKey,
} from "../../../packages/symphony-core/src/workspace/index.ts";

test("workspace keys are deterministic, collision-resistant, and contained by their root", () => {
  assert.equal(workspaceKey("ISSUE-13"), "ISSUE-13");
  assert.match(workspaceKey("ISSUE/13"), /^ISSUE_13-[a-f0-9]{16}$/);
  assert.notEqual(workspaceKey("ISSUE/13"), workspaceKey("ISSUE?13"));

  const workspace = createWorkspaceReference({
    root: "/tmp/symphoneer-workspaces",
    taskId: "task-13",
    identifier: "ISSUE/13",
    attemptId: "attempt-13",
    repository: "icho648/symphoneer",
    branch: "codex/issue-13",
    host: "local",
  });

  assert.equal(workspace.path, resolve("/tmp/symphoneer-workspaces", workspaceKey("ISSUE/13")));
  assert.equal(workspace.ownerAttemptId, "attempt-13");
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
