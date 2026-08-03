import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  WorkspaceError,
  WorkspaceManager,
} from "../../../packages/symphony-core/src/workspace/index.ts";

test("Workspace lifecycle creates, reuses, runs hooks, and removes deterministically", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "symphoneer-workspaces-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manager = new WorkspaceManager({
    root,
    hooks: {
      afterCreate: "printf 'after_create\\n' >> hooks.log",
      beforeRun: "printf 'before_run\\n' >> hooks.log",
      afterRun: "exit 9",
      beforeRemove: "exit 8",
      timeoutMs: 100,
    },
  });
  const input = {
    taskId: "task-13",
    identifier: "ISSUE-13",
    attemptId: "attempt-13",
    repository: "icho648/symphoneer",
    branch: "codex/issue-13",
    host: "local",
  };

  const created = await manager.prepare(input);
  assert.equal(created.createdNow, true);
  await assert.rejects(
    manager.prepare({ ...input, attemptId: "attempt-13-concurrent" }),
    (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
  );
  const firstFinished = await manager.finish(created.workspace);
  const reused = await manager.prepare({ ...input, attemptId: "attempt-13-retry" });
  assert.equal(reused.createdNow, false);
  assert.equal(reused.workspace.ownerAttemptId, "attempt-13-retry");
  assert.equal(
    await readFile(resolve(reused.workspace.path, "hooks.log"), "utf8"),
    "after_create\nbefore_run\nbefore_run\n",
  );
  await assert.rejects(
    manager.finish(created.workspace),
    (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
  );
  await assert.rejects(
    manager.remove(firstFinished.workspace),
    (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
  );
  await assert.rejects(
    manager.prepare({ ...input, taskId: "task-other", attemptId: "attempt-other" }),
    (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
  );

  const finished = await manager.finish(reused.workspace);
  assert.equal(finished.workspace.state, "retained");
  assert.deepEqual(
    finished.hookFailures.map(({ hook }) => hook),
    ["after_run"],
  );
  await assert.rejects(
    manager.remove({ ...finished.workspace, id: "workspace:forged", taskId: "task-forged" }),
    (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
  );
  await access(reused.workspace.path);
  const removed = await manager.remove(finished.workspace);
  assert.equal(removed.workspace.state, "released");
  assert.deepEqual(
    removed.hookFailures.map(({ hook }) => hook),
    ["before_remove"],
  );
  await assert.rejects(access(reused.workspace.path));
});
