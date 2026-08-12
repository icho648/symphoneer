import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  createWorkspaceReference,
  WorkspaceError,
  WorkspaceManager,
} from "../../src/runtime/workspace/index.ts";

test("Workspace lifecycle rejects non-directories and times out fatal hooks", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "symphoneer-workspaces-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = {
    taskId: "task-blocked",
    identifier: "BLOCKED",
    attemptId: "attempt-blocked",
    repository: "icho648/symphoneer",
    branch: "codex/blocked",
    host: "local",
  };
  const blockedPath = createWorkspaceReference({ root, ...input }).path;
  await mkdir(resolve(blockedPath, ".."), { recursive: true });
  await writeFile(blockedPath, "not a directory");

  await assert.rejects(
    new WorkspaceManager({ root }).prepare(input),
    (error) => error instanceof WorkspaceError && error.code === "workspace_not_directory",
  );

  const timed = new WorkspaceManager({
    root,
    hooks: { afterCreate: "while :; do :; done", timeoutMs: 10 },
  });
  const timedInput = { ...input, taskId: "task-timed", identifier: "TIMED" };
  await assert.rejects(
    timed.prepare(timedInput),
    (error) => error instanceof WorkspaceError && error.code === "hook_timed_out",
  );
  await assert.rejects(access(createWorkspaceReference({ root, ...timedInput }).path));
});

test("Workspace hooks terminate descendants and reject a symlink swap", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "symphoneer-workspaces-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = {
    taskId: "task-guarded",
    identifier: "GUARDED",
    attemptId: "attempt-guarded",
    repository: "icho648/symphoneer",
    branch: "codex/guarded",
    host: "local",
  };
  const hookTarget = resolve(root, "hook-target");
  await mkdir(hookTarget);
  await writeFile(resolve(hookTarget, "keep.txt"), "keep");
  const swappedInput = {
    ...input,
    taskId: "task-swapped",
    identifier: "SWAPPED",
    attemptId: "attempt-swapped",
  };
  const swappedPath = createWorkspaceReference({ root, ...swappedInput }).path;
  const swappedName = swappedPath.split("/").at(-1);
  const swapped = new WorkspaceManager({
    root,
    hooks: {
      afterCreate: `cd .. && rm -rf '${swappedName}' && ln -s '../hook-target' '${swappedName}'`,
    },
  });
  await assert.rejects(
    swapped.prepare(swappedInput),
    (error) => error instanceof WorkspaceError && error.code === "workspace_not_directory",
  );
  assert.equal(await readFile(resolve(hookTarget, "keep.txt"), "utf8"), "keep");
  const manager = new WorkspaceManager({
    root,
    hooks: {
      beforeRun: "sleep 30 & printf '%s\\n' \"$!\" >> child-pids.txt; wait",
      timeoutMs: 20,
    },
  });
  await assert.rejects(
    manager.prepare(input),
    (error) => error instanceof WorkspaceError && error.code === "hook_timed_out",
  );
  await assert.rejects(
    manager.prepare({ ...input, attemptId: "attempt-guarded-retry" }),
    (error) => error instanceof WorkspaceError && error.code === "hook_timed_out",
  );
  const path = createWorkspaceReference({ root, ...input }).path;
  const childPids = (await readFile(resolve(path, "child-pids.txt"), "utf8"))
    .trim()
    .split("\n")
    .map(Number);
  assert.equal(childPids.length, 2);
  await delay(50);
  for (const pid of childPids) {
    assert.throws(
      () => process.kill(pid, 0),
      (error) => (error as NodeJS.ErrnoException).code === "ESRCH",
    );
  }

  const safeManager = new WorkspaceManager({ root });
  const prepared = await safeManager.prepare({ ...input, attemptId: "attempt-safe" });
  const finished = await safeManager.finish(prepared.workspace);
  const target = resolve(root, "symlink-target");
  await mkdir(target);
  await writeFile(resolve(target, "keep.txt"), "keep");
  await rm(prepared.workspace.path, { recursive: true });
  await symlink(target, prepared.workspace.path, "dir");
  await assert.rejects(
    safeManager.remove(finished.workspace),
    (error) => error instanceof WorkspaceError && error.code === "workspace_not_directory",
  );
  assert.equal(await readFile(resolve(target, "keep.txt"), "utf8"), "keep");
});
