import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";

import { GitWorktreeDriver } from "../../packages/adapters/src/index.ts";
import { WorkspaceError, WorkspaceManager } from "../../packages/symphony-core/src/index.ts";

async function repositoryFixture(t: TestContext) {
  const base = await mkdtemp(resolve(tmpdir(), "symphoneer-git-worktree-"));
  const repositoryPath = resolve(base, "repository");
  const workspaceRoot = resolve(base, "workspaces");
  execFileSync("git", ["init", "-b", "main", repositoryPath]);
  execFileSync("git", ["-C", repositoryPath, "config", "user.name", "Symphoneer Test"]);
  execFileSync("git", ["-C", repositoryPath, "config", "user.email", "test@example.com"]);
  await writeFile(resolve(repositoryPath, "README.md"), "baseline\n");
  execFileSync("git", ["-C", repositoryPath, "add", "README.md"]);
  execFileSync("git", ["-C", repositoryPath, "commit", "-m", "baseline"]);
  t.after(() => rm(base, { recursive: true, force: true }));
  return { base, repositoryPath, workspaceRoot };
}

const workspaceInput = (branch: string, attemptId = "attempt-14") => ({
  taskId: "task-14",
  identifier: "ISSUE-14",
  attemptId,
  repository: "icho648/symphoneer",
  branch,
  host: "local",
});

test("Git worktree lifecycle creates, recovers, retains, and safely releases", async (t) => {
  const fixture = await repositoryFixture(t);
  const driver = new GitWorktreeDriver({
    repositoryPath: fixture.repositoryPath,
    repository: "icho648/symphoneer",
    baseRevision: "HEAD",
  });
  const manager = new WorkspaceManager({ root: fixture.workspaceRoot, driver });
  const prepared = await manager.prepare(workspaceInput("codex/issue-14"));
  assert.equal(prepared.createdNow, true);
  assert.equal(
    execFileSync("git", ["-C", prepared.workspace.path, "branch", "--show-current"], {
      encoding: "utf8",
    }).trim(),
    "codex/issue-14",
  );
  const finished = await manager.finish(prepared.workspace);
  assert.equal(finished.workspace.state, "retained");
  const beforeRunMarker = resolve(fixture.base, "before-run-must-not-run");
  const cleanupAfterRestart = new WorkspaceManager({
    root: fixture.workspaceRoot,
    driver,
    hooks: { beforeRun: `touch '${beforeRunMarker}'` },
  });
  const released = await cleanupAfterRestart.remove(finished.workspace);
  assert.equal(released.workspace.state, "released");
  await assert.rejects(access(prepared.workspace.path));
  await assert.rejects(access(beforeRunMarker));
  execFileSync("git", [
    "-C",
    fixture.repositoryPath,
    "worktree",
    "add",
    released.workspace.path,
    released.workspace.branch,
  ]);
  await assert.rejects(
    cleanupAfterRestart.remove(released.workspace),
    (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
  );
  execFileSync("git", [
    "-C",
    fixture.repositoryPath,
    "worktree",
    "remove",
    released.workspace.path,
  ]);
  assert.equal(
    (await new WorkspaceManager({ root: fixture.workspaceRoot, driver }).remove(released.workspace))
      .workspace.state,
    "released",
  );
});

test("Git worktree removal refuses dirty state and records a failed cleanup hook", async (t) => {
  const fixture = await repositoryFixture(t);
  const driver = new GitWorktreeDriver({
    repositoryPath: fixture.repositoryPath,
    repository: "icho648/symphoneer",
    baseRevision: "HEAD",
  });
  const manager = new WorkspaceManager({
    root: fixture.workspaceRoot,
    driver,
    hooks: { beforeRemove: "printf dirty > hook-output.txt; exit 7" },
  });
  const prepared = await manager.prepare(workspaceInput("codex/dirty"));
  const retained = await manager.finish(prepared.workspace);
  await assert.rejects(
    manager.remove(retained.workspace),
    (error) =>
      error instanceof WorkspaceError &&
      error.code === "workspace_dirty" &&
      error.hookFailures.includes("before_remove"),
  );
  await access(prepared.workspace.path);

  await rm(resolve(prepared.workspace.path, "hook-output.txt"));
  await writeFile(resolve(prepared.workspace.path, "untracked.txt"), "keep\n");
  await assert.rejects(
    manager.remove(retained.workspace),
    (error) => error instanceof WorkspaceError && error.code === "workspace_dirty",
  );
});

test("Git worktree removal refuses ignored files", async (t) => {
  const fixture = await repositoryFixture(t);
  await writeFile(resolve(fixture.repositoryPath, ".gitignore"), "ignored.txt\n");
  execFileSync("git", ["-C", fixture.repositoryPath, "add", ".gitignore"]);
  execFileSync("git", ["-C", fixture.repositoryPath, "commit", "-m", "ignore local data"]);
  const driver = new GitWorktreeDriver({
    repositoryPath: fixture.repositoryPath,
    repository: "icho648/symphoneer",
    baseRevision: "HEAD",
  });
  const manager = new WorkspaceManager({ root: fixture.workspaceRoot, driver });
  const prepared = await manager.prepare(workspaceInput("codex/ignored"));
  const retained = await manager.finish(prepared.workspace);
  const ignored = resolve(prepared.workspace.path, "ignored.txt");
  await writeFile(ignored, "keep\n");

  await assert.rejects(
    manager.remove(retained.workspace),
    (error) => error instanceof WorkspaceError && error.code === "workspace_dirty",
  );
  await access(ignored);
});

test("Git worktree preparation rolls back after stale identity validation", async (t) => {
  const fixture = await repositoryFixture(t);
  const driver = new GitWorktreeDriver({
    repositoryPath: fixture.repositoryPath,
    repository: "icho648/symphoneer",
    baseRevision: "HEAD",
  });
  const manager = new WorkspaceManager({ root: fixture.workspaceRoot, driver });
  const input = workspaceInput("codex/stale-create");
  const prepared = await manager.prepare(input);
  const retained = await manager.finish(prepared.workspace);
  const released = await manager.remove(retained.workspace);

  execFileSync("git", ["-C", fixture.repositoryPath, "commit", "--allow-empty", "-m", "advance"]);
  const advanced = execFileSync("git", ["-C", fixture.repositoryPath, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  execFileSync("git", [
    "-C",
    fixture.repositoryPath,
    "update-ref",
    "refs/heads/codex/stale-create",
    advanced,
  ]);

  await assert.rejects(
    manager.prepare(input),
    (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
  );
  await assert.rejects(access(prepared.workspace.path));
  assert.doesNotMatch(
    execFileSync("git", ["-C", fixture.repositoryPath, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
    }),
    new RegExp(prepared.workspace.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.equal((await manager.remove(released.workspace)).workspace.state, "released");
});

test("Git worktree removal refuses populated deinitialized submodules", async (t) => {
  const fixture = await repositoryFixture(t);
  const submodule = resolve(fixture.base, "submodule");
  execFileSync("git", ["init", "-b", "main", submodule]);
  execFileSync("git", ["-C", submodule, "config", "user.name", "Symphoneer Test"]);
  execFileSync("git", ["-C", submodule, "config", "user.email", "test@example.com"]);
  await writeFile(resolve(submodule, "nested.txt"), "baseline\n");
  execFileSync("git", ["-C", submodule, "add", "nested.txt"]);
  execFileSync("git", ["-C", submodule, "commit", "-m", "nested baseline"]);
  execFileSync("git", [
    "-C",
    fixture.repositoryPath,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    submodule,
    "nested",
  ]);
  execFileSync("git", ["-C", fixture.repositoryPath, "commit", "-m", "add submodule"]);
  const driver = new GitWorktreeDriver({
    repositoryPath: fixture.repositoryPath,
    repository: "icho648/symphoneer",
    baseRevision: "HEAD",
  });
  const manager = new WorkspaceManager({ root: fixture.workspaceRoot, driver });
  const prepared = await manager.prepare(workspaceInput("codex/deinitialized"));
  const retained = await manager.finish(prepared.workspace);
  await rm(resolve(prepared.workspace.path, "nested", ".git"), { force: true });
  const localData = resolve(prepared.workspace.path, "nested", "local.txt");
  await writeFile(localData, "keep\n");

  await assert.rejects(
    manager.remove(retained.workspace),
    (error) => error instanceof WorkspaceError && error.code === "workspace_git_failed",
  );
  await access(localData);
});

test("Git worktree recovery rejects identity mismatches and reconciles complete absence", async (t) => {
  const fixture = await repositoryFixture(t);
  const driver = new GitWorktreeDriver({
    repositoryPath: fixture.repositoryPath,
    repository: "icho648/symphoneer",
    baseRevision: "HEAD",
  });
  const manager = new WorkspaceManager({ root: fixture.workspaceRoot, driver });
  const prepared = await manager.prepare(workspaceInput("codex/recovery"));
  const retained = await manager.finish(prepared.workspace);

  const recovering = new WorkspaceManager({ root: fixture.workspaceRoot, driver });
  const recovered = await recovering.recover(retained.workspace, "attempt-recovered");
  assert.equal(recovered.workspace.ownerAttemptId, "attempt-recovered");
  const retainedAgain = await recovering.finish(recovered.workspace);
  await assert.rejects(
    recovering.prepare(workspaceInput("codex/wrong", "attempt-wrong")),
    (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
  );
  await assert.rejects(
    recovering.prepare({
      ...workspaceInput("codex/recovery", "attempt-wrong-repository"),
      repository: "other/repository",
    }),
    (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
  );
  for (const mismatch of [
    { ...retainedAgain.workspace, gitHead: "0".repeat(40) },
    { ...retainedAgain.workspace, worktreeFingerprint: "0".repeat(64) },
    { ...retainedAgain.workspace, ownerAttemptId: "attempt-active", state: "ready" as const },
  ]) {
    const fresh = new WorkspaceManager({ root: fixture.workspaceRoot, driver });
    await assert.rejects(
      fresh.recover(mismatch, "attempt-rejected"),
      (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
    );
  }
  const retrying = new WorkspaceManager({ root: fixture.workspaceRoot, driver });
  await assert.rejects(
    retrying.recover({ ...retainedAgain.workspace, gitHead: "0".repeat(40) }, "attempt-invalid"),
    (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
  );
  const recoveredAfterMismatch = await retrying.recover(
    retainedAgain.workspace,
    "attempt-after-mismatch",
  );
  const finalRetained = await retrying.finish(recoveredAfterMismatch.workspace);

  execFileSync("git", [
    "-C",
    fixture.repositoryPath,
    "worktree",
    "remove",
    prepared.workspace.path,
  ]);
  await rm(fixture.workspaceRoot, { recursive: true });
  assert.equal(
    (
      await new WorkspaceManager({ root: fixture.workspaceRoot, driver }).remove(
        finalRetained.workspace,
      )
    ).workspace.state,
    "released",
  );
});

test("Git worktree cleanup rejects a clean but unexpected HEAD", async (t) => {
  const fixture = await repositoryFixture(t);
  const driver = new GitWorktreeDriver({
    repositoryPath: fixture.repositoryPath,
    repository: "icho648/symphoneer",
    baseRevision: "HEAD",
  });
  const manager = new WorkspaceManager({ root: fixture.workspaceRoot, driver });
  const prepared = await manager.prepare(workspaceInput("codex/head-mismatch"));
  const retained = await manager.finish(prepared.workspace);
  await writeFile(resolve(prepared.workspace.path, "next.txt"), "next\n");
  execFileSync("git", ["-C", prepared.workspace.path, "add", "next.txt"]);
  execFileSync("git", ["-C", prepared.workspace.path, "commit", "-m", "unexpected"]);

  await assert.rejects(
    manager.remove(retained.workspace),
    (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
  );
  await access(prepared.workspace.path);
});

test("Git worktree cleanup retains an inconsistent registered path", async (t) => {
  const fixture = await repositoryFixture(t);
  const driver = new GitWorktreeDriver({
    repositoryPath: fixture.repositoryPath,
    repository: "icho648/symphoneer",
    baseRevision: "HEAD",
  });
  const manager = new WorkspaceManager({ root: fixture.workspaceRoot, driver });
  const prepared = await manager.prepare(workspaceInput("codex/inconsistent"));
  const retained = await manager.finish(prepared.workspace);
  await rm(prepared.workspace.path, { recursive: true });

  await assert.rejects(
    manager.remove(retained.workspace),
    (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
  );
});
