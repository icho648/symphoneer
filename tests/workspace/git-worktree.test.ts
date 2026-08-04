import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import {
  GitWorktreeDriver,
  WorkspaceError,
  WorkspaceManager,
} from "../../src/runtime/workspace/index.ts";

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

test("Git worktree cleanup streams large tracked blobs", async (t) => {
  const fixture = await repositoryFixture(t);
  await writeFile(resolve(fixture.repositoryPath, "large.bin"), Buffer.alloc(5 * 2 ** 20, 0x61));
  execFileSync("git", ["-C", fixture.repositoryPath, "add", "large.bin"]);
  execFileSync("git", ["-C", fixture.repositoryPath, "commit", "-m", "add large blob"]);

  const driver = new GitWorktreeDriver({
    repositoryPath: fixture.repositoryPath,
    repository: "icho648/symphoneer",
    baseRevision: "HEAD",
  });
  const manager = new WorkspaceManager({ root: fixture.workspaceRoot, driver });
  const prepared = await manager.prepare(workspaceInput("codex/large-blob"));
  const retained = await manager.finish(prepared.workspace);
  assert.equal((await manager.remove(retained.workspace)).workspace.state, "released");
});

test("Git worktree cleanup rejects aliases outside the configured Workspace root", async (t) => {
  const fixture = await repositoryFixture(t);
  const driver = new GitWorktreeDriver({
    repositoryPath: fixture.repositoryPath,
    repository: "icho648/symphoneer",
    baseRevision: "HEAD",
  });
  const externalRoot = resolve(fixture.base, "external-workspaces");
  const external = new WorkspaceManager({ root: externalRoot, driver });
  const prepared = await external.prepare(workspaceInput("codex/alias"));
  const retained = await external.finish(prepared.workspace);

  const configuredRoot = resolve(fixture.base, "configured-workspaces");
  await mkdir(configuredRoot);
  const aliasRoot = resolve(configuredRoot, "alias");
  await symlink(externalRoot, aliasRoot, "dir");
  const alias = resolve(aliasRoot, basename(prepared.workspace.path));

  await assert.rejects(
    new WorkspaceManager({ root: configuredRoot, driver }).remove({
      ...retained.workspace,
      path: alias,
    }),
    (error) => error instanceof WorkspaceError && error.code === "workspace_outside_root",
  );
  await access(prepared.workspace.path);
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

test("Git worktree removal refuses tracked bytes hidden by a clean filter", async (t) => {
  const fixture = await repositoryFixture(t);
  await writeFile(resolve(fixture.repositoryPath, "filtered.txt"), "");
  await writeFile(
    resolve(fixture.repositoryPath, ".gitattributes"),
    "filtered.txt filter=opaque\n",
  );
  execFileSync("git", ["-C", fixture.repositoryPath, "add", ".gitattributes", "filtered.txt"]);
  execFileSync("git", ["-C", fixture.repositoryPath, "commit", "-m", "add clean filter"]);
  execFileSync("git", ["-C", fixture.repositoryPath, "config", "filter.opaque.clean", "true"]);

  const driver = new GitWorktreeDriver({
    repositoryPath: fixture.repositoryPath,
    repository: "icho648/symphoneer",
    baseRevision: "HEAD",
  });
  const manager = new WorkspaceManager({ root: fixture.workspaceRoot, driver });
  const prepared = await manager.prepare(workspaceInput("codex/filtered"));
  const retained = await manager.finish(prepared.workspace);
  const filtered = resolve(prepared.workspace.path, "filtered.txt");
  await writeFile(filtered, "changed but normalized by clean filter\n");

  await assert.rejects(
    manager.remove(retained.workspace),
    (error) => error instanceof WorkspaceError && error.code === "workspace_dirty",
  );
  await access(filtered);
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

test("Git worktree preparation refreshes identity after a hook failure", async (t) => {
  const fixture = await repositoryFixture(t);
  const driver = new GitWorktreeDriver({
    repositoryPath: fixture.repositoryPath,
    repository: "icho648/symphoneer",
    baseRevision: "HEAD",
  });
  const manager = new WorkspaceManager({
    root: fixture.workspaceRoot,
    driver,
    hooks: {
      afterCreate: "printf changed > after-create.txt",
      beforeRun: "[ -f .before-run-failed ] || { touch .before-run-failed; exit 9; }",
    },
  });
  const input = workspaceInput("codex/hook-failure");

  await assert.rejects(
    manager.prepare(input),
    (error) => error instanceof WorkspaceError && error.code === "hook_failed",
  );
  const retried = await manager.prepare({ ...input, attemptId: "attempt-hook-retry" });
  assert.equal(retried.createdNow, false);
  assert.equal(retried.workspace.ownerAttemptId, "attempt-hook-retry");
  await access(resolve(retried.workspace.path, "after-create.txt"));
});

test("Git worktree preparation rolls back when Workspace registration rejects identity", async (t) => {
  const fixture = await repositoryFixture(t);
  const driver = new GitWorktreeDriver({
    repositoryPath: fixture.repositoryPath,
    repository: "icho648/symphoneer",
    baseRevision: "HEAD",
  });
  const manager = new WorkspaceManager({ root: fixture.workspaceRoot, driver });
  const initial = await manager.prepare(workspaceInput("codex/registration-old"));
  const retained = await manager.finish(initial.workspace);
  const changed = {
    ...workspaceInput("codex/registration-new", "attempt-registration-new"),
    identifier: "ISSUE-14-renamed",
  };

  await assert.rejects(
    manager.prepare(changed),
    (error) => error instanceof WorkspaceError && error.code === "workspace_identity_mismatch",
  );
  const worktreeList = execFileSync(
    "git",
    ["-C", fixture.repositoryPath, "worktree", "list", "--porcelain"],
    { encoding: "utf8" },
  );
  assert.doesNotMatch(worktreeList, /registration-new/);
  await access(retained.workspace.path);
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
