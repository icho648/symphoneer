import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";

import { VerificationError, VerificationRunner } from "../../packages/adapters/src/index.ts";

async function repositoryFixture(t: TestContext) {
  const base = await mkdtemp(resolve(tmpdir(), "symphoneer-verification-"));
  const repository = resolve(base, "repository");
  const artifacts = resolve(base, "artifacts");
  execFileSync("git", ["init", "-b", "main", repository]);
  execFileSync("git", ["-C", repository, "config", "user.name", "Symphoneer Test"]);
  execFileSync("git", ["-C", repository, "config", "user.email", "test@example.com"]);
  await writeFile(resolve(repository, "README.md"), "baseline\n");
  execFileSync("git", ["-C", repository, "add", "README.md"]);
  execFileSync("git", ["-C", repository, "commit", "-m", "baseline"]);
  t.after(() => rm(base, { recursive: true, force: true }));
  return { base, repository, artifacts };
}

test("Verification runs independently and writes a minimal immutable artifact", async (t) => {
  const fixture = await repositoryFixture(t);
  const runner = new VerificationRunner({
    artifactRoot: fixture.artifacts,
    toolVersion: "test-runner-1",
  });
  const input = {
    attemptId: "attempt-14",
    checkId: "check",
    argv: [
      process.execPath,
      "-e",
      "process.stdout.write('sensitive-output')",
      "super-secret-token",
    ],
    cwd: ".",
    workspacePath: fixture.repository,
    timeoutMs: 5_000,
  };
  const verification = await runner.run(input);
  assert.equal(verification.result.status, "passed");
  assert.equal(verification.result.exitCode, 0);
  assert.equal(verification.result.tool.version, "test-runner-1");
  assert.match(verification.result.inputFingerprint, /^[a-f0-9]{64}$/);
  const artifact = await readFile(verification.artifactPath, "utf8");
  assert.doesNotMatch(artifact, /sensitive-output/);
  assert.doesNotMatch(artifact, /super-secret-token/);
  assert.deepEqual(verification.result.argv, ["node", "<redacted>", "<redacted>", "<redacted>"]);
  assert.match(artifact, /stdoutSha256/);
  await assert.rejects(
    runner.run(input),
    (error) => error instanceof VerificationError && error.code === "artifact_exists",
  );
});

test("Verification keeps zero exit from passing when the checked revision changes", async (t) => {
  const fixture = await repositoryFixture(t);
  const runner = new VerificationRunner({ artifactRoot: fixture.artifacts });
  const verification = await runner.run({
    attemptId: "attempt-revision-change",
    checkId: "check",
    argv: ["git", "commit", "--allow-empty", "-m", "changed during verification"],
    cwd: ".",
    workspacePath: fixture.repository,
    timeoutMs: 5_000,
  });
  assert.equal(verification.result.exitCode, 0);
  assert.equal(verification.result.status, "failed");
});

test("Verification keeps zero exit from passing when tracked or untracked state changes", async (t) => {
  const fixture = await repositoryFixture(t);
  const trackedRunner = new VerificationRunner({ artifactRoot: fixture.artifacts });
  const tracked = await trackedRunner.run({
    attemptId: "attempt-tracked-change",
    checkId: "check",
    argv: [process.execPath, "-e", "require('fs').writeFileSync('README.md', 'changed\\n')"],
    cwd: ".",
    workspacePath: fixture.repository,
    timeoutMs: 5_000,
  });
  assert.equal(tracked.result.exitCode, 0);
  assert.equal(tracked.result.status, "failed");

  execFileSync("git", ["-C", fixture.repository, "restore", "README.md"]);
  const untracked = await trackedRunner.run({
    attemptId: "attempt-untracked-change",
    checkId: "check",
    argv: [process.execPath, "-e", "require('fs').writeFileSync('new.txt', 'new\\n')"],
    cwd: ".",
    workspacePath: fixture.repository,
    timeoutMs: 5_000,
  });
  assert.equal(untracked.result.exitCode, 0);
  assert.equal(untracked.result.status, "failed");
});

test("Verification binds the Workspace root when cwd is a nested Git repository", async (t) => {
  const fixture = await repositoryFixture(t);
  const nested = resolve(fixture.repository, "nested");
  await writeFile(resolve(fixture.repository, ".gitignore"), "nested/\n");
  execFileSync("git", ["-C", fixture.repository, "add", ".gitignore"]);
  execFileSync("git", ["-C", fixture.repository, "commit", "-m", "ignore nested repository"]);
  await mkdir(nested);
  execFileSync("git", ["init", "-b", "main", nested]);
  execFileSync("git", ["-C", nested, "config", "user.name", "Symphoneer Test"]);
  execFileSync("git", ["-C", nested, "config", "user.email", "test@example.com"]);
  await writeFile(resolve(nested, "nested.txt"), "nested\n");
  execFileSync("git", ["-C", nested, "add", "nested.txt"]);
  execFileSync("git", ["-C", nested, "commit", "-m", "nested"]);
  const verification = await new VerificationRunner({ artifactRoot: fixture.artifacts }).run({
    attemptId: "attempt-nested-repository",
    checkId: "check",
    argv: [process.execPath, "-e", "require('fs').writeFileSync('../README.md', 'changed\\n')"],
    cwd: "nested",
    workspacePath: fixture.repository,
    timeoutMs: 5_000,
  });
  assert.equal(verification.result.exitCode, 0);
  assert.equal(verification.result.status, "failed");
});

test("Verification records a failed artifact when the check cannot start", async (t) => {
  const fixture = await repositoryFixture(t);
  const runner = new VerificationRunner({ artifactRoot: fixture.artifacts });
  const verification = await runner.run({
    attemptId: "attempt-missing-command",
    checkId: "check",
    argv: [resolve(fixture.base, "missing-command")],
    cwd: ".",
    workspacePath: fixture.repository,
    timeoutMs: 5_000,
  });
  assert.equal(verification.result.status, "failed");
  assert.equal(verification.result.exitCode, null);
  assert.equal(JSON.parse(await readFile(verification.artifactPath, "utf8")).startFailed, true);
});

test("Verification records a failed artifact when the check damages Git metadata", async (t) => {
  const fixture = await repositoryFixture(t);
  const verification = await new VerificationRunner({ artifactRoot: fixture.artifacts }).run({
    attemptId: "attempt-damaged-git",
    checkId: "check",
    argv: [process.execPath, "-e", "require('fs').renameSync('.git', '.git-broken')"],
    cwd: ".",
    workspacePath: fixture.repository,
    timeoutMs: 5_000,
  });
  assert.equal(verification.result.exitCode, 0);
  assert.equal(verification.result.status, "failed");
  assert.equal(
    JSON.parse(await readFile(verification.artifactPath, "utf8")).observationError,
    "git_observation_failed",
  );
});

test("Verification enforces timeout and rejects a symlink cwd escape", async (t) => {
  const fixture = await repositoryFixture(t);
  const runner = new VerificationRunner({ artifactRoot: fixture.artifacts });
  const timed = await runner.run({
    attemptId: "attempt-timeout",
    checkId: "check",
    argv: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
    cwd: ".",
    workspacePath: fixture.repository,
    timeoutMs: 20,
  });
  assert.equal(timed.result.status, "timed_out");

  const outside = resolve(fixture.base, "outside");
  await writeFile(outside, "not a directory");
  await symlink(fixture.base, resolve(fixture.repository, "escape"));
  await assert.rejects(
    runner.run({
      attemptId: "attempt-escape",
      checkId: "check",
      argv: [process.execPath, "-e", "process.exit(0)"],
      cwd: "escape",
      workspacePath: fixture.repository,
      timeoutMs: 5_000,
    }),
    (error) => error instanceof VerificationError && error.code === "invalid_workspace",
  );
});

test("Verification rejects an artifact root inside the Workspace before executing", async (t) => {
  const fixture = await repositoryFixture(t);
  const marker = resolve(fixture.repository, "must-not-run.txt");
  const runner = new VerificationRunner({
    artifactRoot: resolve(fixture.repository, ".artifacts"),
  });
  await assert.rejects(
    runner.run({
      attemptId: "attempt-artifact-inside",
      checkId: "check",
      argv: [process.execPath, "-e", "require('fs').writeFileSync('must-not-run.txt', 'ran')"],
      cwd: ".",
      workspacePath: fixture.repository,
      timeoutMs: 5_000,
    }),
    (error) => error instanceof VerificationError && error.code === "invalid_workspace",
  );
  await assert.rejects(readFile(marker));
  await assert.rejects(access(resolve(fixture.repository, ".artifacts")));

  const link = resolve(fixture.base, "artifact-link");
  await symlink(fixture.repository, link, "dir");
  await assert.rejects(
    new VerificationRunner({ artifactRoot: resolve(link, "through-symlink") }).run({
      attemptId: "attempt-artifact-symlink",
      checkId: "check",
      argv: [process.execPath, "-e", "process.exit(0)"],
      cwd: ".",
      workspacePath: fixture.repository,
      timeoutMs: 5_000,
    }),
    (error) => error instanceof VerificationError && error.code === "invalid_workspace",
  );
});
