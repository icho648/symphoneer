import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    manager.remove(created.workspace),
    (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
  );
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
  await assert.rejects(
    manager.remove({ ...finished.workspace, path: resolve(root, "..", "outside-workspace") }),
    (error) => error instanceof WorkspaceError && error.code === "workspace_outside_root",
  );
  await assert.rejects(
    new WorkspaceManager({ root }).remove({
      ...finished.workspace,
      gitHead: "0".repeat(40),
      worktreeFingerprint: "0".repeat(64),
    }),
    (error) => error instanceof WorkspaceError && error.code === "workspace_dirty",
  );
  await access(finished.workspace.path);
  const arbitrary = resolve(root, "arbitrary-empty-directory");
  await mkdir(arbitrary);
  await assert.rejects(
    new WorkspaceManager({ root }).remove({
      ...finished.workspace,
      id: "workspace:arbitrary",
      taskId: "task-arbitrary",
      path: arbitrary,
      gitHead: "0".repeat(40),
      worktreeFingerprint: "0".repeat(64),
    }),
    (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
  );
  await access(arbitrary);
  await assert.rejects(
    new WorkspaceManager({ root }).recover(
      {
        ...finished.workspace,
        id: "workspace:arbitrary",
        taskId: "task-arbitrary",
        path: arbitrary,
      },
      "attempt-arbitrary",
    ),
    (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
  );
  await assert.rejects(
    manager.remove(finished.workspace),
    (error) => error instanceof WorkspaceError && error.code === "workspace_dirty",
  );
  await rm(resolve(finished.workspace.path, "hooks.log"));
  await access(reused.workspace.path);
  const removed = await manager.remove(finished.workspace);
  assert.equal(removed.workspace.state, "released");
  assert.deepEqual(
    removed.hookFailures.map(({ hook }) => hook),
    ["before_remove"],
  );
  assert.equal((await manager.remove(removed.workspace)).workspace.state, "released");
  await assert.rejects(access(reused.workspace.path));
});

test("concurrent identical preparation waits for workspace initialization", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "symphoneer-workspaces-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const started = resolve(root, "after-create.started");
  const release = resolve(root, "after-create.release");
  const manager = new WorkspaceManager({
    root,
    hooks: {
      afterCreate: `touch '${started}'; while [ ! -f '${release}' ]; do sleep 0.01; done`,
      timeoutMs: 1_000,
    },
  });
  const input = {
    taskId: "task-14",
    identifier: "ISSUE-14",
    attemptId: "attempt-14",
    repository: "icho648/symphoneer",
    branch: "codex/issue-14",
    host: "local",
  };

  const first = manager.prepare(input);
  for (;;) {
    try {
      await access(started);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  let secondSettled = false;
  const second = manager.prepare(input).finally(() => {
    secondSettled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const settledBeforeRelease = secondSettled;

  await writeFile(release, "release\n");
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(settledBeforeRelease, false);
  assert.equal(firstResult.createdNow, true);
  assert.deepEqual(secondResult, firstResult);
});

test("cleanup cannot remove a workspace prepared by the next Attempt", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "symphoneer-workspaces-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const started = resolve(root, "before-remove.started");
  const release = resolve(root, "before-remove.release");
  const manager = new WorkspaceManager({
    root,
    hooks: {
      beforeRemove: `touch '${started}'; while [ ! -f '${release}' ]; do sleep 0.01; done`,
      timeoutMs: 1_000,
    },
  });
  const input = {
    taskId: "task-race",
    identifier: "ISSUE-RACE",
    attemptId: "attempt-old",
    repository: "icho648/symphoneer",
    branch: "codex/issue-race",
    host: "local",
  };
  const prepared = await manager.prepare(input);
  const retained = await manager.finish(prepared.workspace);
  const removal = manager.remove(retained.workspace);
  for (;;) {
    try {
      await access(started);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  let nextSettled = false;
  const next = manager.prepare({ ...input, attemptId: "attempt-next" }).finally(() => {
    nextSettled = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(nextSettled, false);
  await writeFile(release, "release\n");

  assert.equal((await removal).workspace.state, "released");
  const preparedNext = await next;
  assert.equal(preparedNext.workspace.ownerAttemptId, "attempt-next");
  await access(preparedNext.workspace.path);
});
