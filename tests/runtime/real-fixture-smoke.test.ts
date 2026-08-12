import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { GitWorktreeDriver, WorkspaceManager } from "@symphoneer/runtime";
import {
  cleanupWorkspace,
  fixtureCleanupOutcome,
  fixtureOutcome,
  type RealFixtureSmokeReport,
} from "../../scripts/real-fixture-smoke.ts";

test("fixture Smoke waits through a finished Attempt while the Task remains dispatchable", () => {
  assert.equal(
    fixtureOutcome(
      { dispatchable: true, labels: ["symphoneer:ready"] },
      { status: "failed", finishedAt: "2026-08-12T10:00:00.000Z" },
    ),
    null,
  );
  assert.equal(
    fixtureOutcome(
      { dispatchable: false, labels: ["symphoneer:review"] },
      { status: "succeeded", finishedAt: "2026-08-12T10:00:01.000Z" },
    ),
    "passed",
  );
  assert.equal(
    fixtureOutcome(
      { dispatchable: true, labels: ["symphoneer:review"] },
      { status: "failed", finishedAt: "2026-08-12T10:00:02.000Z" },
    ),
    "failed",
  );
});

test("fixture cleanup validates the retained fingerprint before discarding known ignored files", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "symphoneer-fixture-cleanup-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = resolve(root, "source");
  const workspaceRoot = resolve(root, "workspaces");
  execFileSync("git", ["init", "-b", "main", sourcePath]);
  execFileSync("git", ["-C", sourcePath, "config", "user.name", "Symphoneer Test"]);
  execFileSync("git", ["-C", sourcePath, "config", "user.email", "test@example.com"]);
  await writeFile(resolve(sourcePath, ".gitignore"), "node_modules/\n");
  execFileSync("git", ["-C", sourcePath, "add", ".gitignore"]);
  execFileSync("git", ["-C", sourcePath, "commit", "-m", "fixture"]);
  const repository = "icho648/fixture";
  const manager = new WorkspaceManager({
    root: workspaceRoot,
    driver: new GitWorktreeDriver({
      repositoryPath: sourcePath,
      repository,
      baseRevision: "HEAD",
    }),
  });
  const prepared = await manager.prepare({
    taskId: "task-47",
    identifier: "#47",
    attemptId: "attempt-47",
    repository,
    branch: "codex/issue-47",
    host: "local",
  });
  await mkdir(resolve(prepared.workspace.path, "node_modules"));
  await writeFile(resolve(prepared.workspace.path, "node_modules", "fixture.txt"), "known\n");
  const retained = await manager.finish(prepared.workspace);
  const report: RealFixtureSmokeReport = {
    status: "passed",
    repository,
    issueNumber: 47,
    issueUrl: "https://github.com/icho648/fixture/issues/47",
    root,
    manifestPath: resolve(root, "manifest.json"),
    taskId: "task-47",
    attemptId: "attempt-47",
    workspace: {
      id: retained.workspace.id,
      path: retained.workspace.path,
      repository: retained.workspace.repository,
      branch: retained.workspace.branch,
      gitHead: retained.workspace.gitHead,
      worktreeFingerprint: retained.workspace.worktreeFingerprint,
      state: retained.workspace.state,
    },
    provider: null,
    operatorLogPath: null,
    cleanup: "not_attempted",
    failure: null,
  };

  assert.equal(await cleanupWorkspace(report, sourcePath, repository, workspaceRoot), "released");
  await assert.rejects(access(prepared.workspace.path));
});

test("fixture cleanup rejection fails the run and keeps it unarchived", () => {
  assert.deepEqual(fixtureCleanupOutcome("retained"), {
    status: "failed",
    failure: "fixture_cleanup_rejected",
    archive: false,
  });
  assert.deepEqual(fixtureCleanupOutcome("released"), {
    status: "passed",
    failure: null,
    archive: true,
  });
});
