import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";

import { VerificationError, VerificationRunner } from "../../packages/adapters/src/index.ts";
import {
  readWorktreeFingerprint,
  splitNull,
} from "../../packages/adapters/src/worktree-fingerprint.ts";

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

test("Verification result identities frame attempt and check IDs independently", async (t) => {
  const fixture = await repositoryFixture(t);
  const runner = new VerificationRunner({ artifactRoot: fixture.artifacts });
  const results = await Promise.all(
    (
      [
        ["attempt:a", "check"],
        ["attempt", "a:check"],
      ] as Array<[string, string]>
    ).map(([attemptId, checkId]) =>
      runner.run({
        attemptId,
        checkId,
        argv: [process.execPath, "-e", "process.exit(0)"],
        cwd: ".",
        workspacePath: fixture.repository,
        timeoutMs: 5_000,
      }),
    ),
  );
  assert.notEqual(results[0]?.result.id, results[1]?.result.id);
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

test("Verification disables external Git diff drivers", async (t) => {
  const fixture = await repositoryFixture(t);
  await writeFile(
    resolve(fixture.repository, ".gitattributes"),
    "README.md diff=opaque filter=opaque\n",
  );
  execFileSync("git", ["-C", fixture.repository, "add", ".gitattributes"]);
  execFileSync("git", ["-C", fixture.repository, "commit", "-m", "configure diff driver"]);
  execFileSync("git", ["-C", fixture.repository, "config", "diff.opaque.command", "true"]);
  execFileSync("git", ["-C", fixture.repository, "config", "diff.opaque.textconv", "true"]);
  execFileSync("git", ["-C", fixture.repository, "config", "filter.opaque.clean", "true"]);

  const verification = await new VerificationRunner({ artifactRoot: fixture.artifacts }).run({
    attemptId: "attempt-external-diff-driver",
    checkId: "check",
    argv: [process.execPath, "-e", "require('node:fs').writeFileSync('README.md', 'changed\\n')"],
    cwd: ".",
    workspacePath: fixture.repository,
    timeoutMs: 5_000,
  });
  assert.equal(verification.result.exitCode, 0);
  assert.equal(verification.result.status, "failed");
});

test("Verification ignores Git replacement objects", async (t) => {
  const fixture = await repositoryFixture(t);
  const verification = await new VerificationRunner({ artifactRoot: fixture.artifacts }).run({
    attemptId: "attempt-replacement-object",
    checkId: "check",
    argv: [
      process.execPath,
      "-e",
      [
        "const fs=require('node:fs');",
        "const cp=require('node:child_process');",
        "fs.writeFileSync('README.md','changed\\n');",
        "cp.execFileSync('git',['add','README.md']);",
        "const tree=cp.execFileSync('git',['write-tree'],{encoding:'utf8'}).trim();",
        "const commit=cp.execFileSync('git',['commit-tree',tree,'-p','HEAD'],{input:'replacement\\n',encoding:'utf8'}).trim();",
        "cp.execFileSync('git',['replace','HEAD',commit]);",
      ].join(" "),
    ],
    cwd: ".",
    workspacePath: fixture.repository,
    timeoutMs: 5_000,
  });
  assert.equal(verification.result.exitCode, 0);
  assert.equal(verification.result.status, "failed");
  assert.equal(await readFile(resolve(fixture.repository, "README.md"), "utf8"), "changed\n");
});

test("Verification keeps artifact writes bound to the validated directory", async (t) => {
  const fixture = await repositoryFixture(t);
  const movedArtifacts = resolve(fixture.base, "moved-artifacts");
  await assert.rejects(
    new VerificationRunner({ artifactRoot: fixture.artifacts }).run({
      attemptId: "attempt-artifact-swap",
      checkId: "check",
      argv: [
        process.execPath,
        "-e",
        [
          "const fs=require('node:fs');",
          `fs.renameSync(${JSON.stringify(fixture.artifacts)},${JSON.stringify(movedArtifacts)});`,
          `fs.symlinkSync(process.cwd(),${JSON.stringify(fixture.artifacts)},'dir');`,
        ].join(" "),
      ],
      cwd: ".",
      workspacePath: fixture.repository,
      timeoutMs: 5_000,
    }),
    (error) => error instanceof VerificationError && error.code === "artifact_replaced",
  );
  assert.equal(
    execFileSync("git", ["-C", fixture.repository, "status", "--porcelain"]).toString(),
    "",
  );
  const [artifactName] = await readdir(movedArtifacts);
  assert.ok(artifactName);
  assert.match(await readFile(resolve(movedArtifacts, artifactName), "utf8"), /"status": "passed"/);
});

test("Verification rejects a replaced artifact file path", async (t) => {
  const fixture = await repositoryFixture(t);
  await assert.rejects(
    new VerificationRunner({ artifactRoot: fixture.artifacts }).run({
      attemptId: "attempt-artifact-file-replaced",
      checkId: "check",
      argv: [
        process.execPath,
        "-e",
        [
          "const fs=require('node:fs');",
          "const path=require('node:path');",
          `const root=${JSON.stringify(fixture.artifacts)};`,
          "const artifact=path.join(root,fs.readdirSync(root)[0]);",
          "fs.unlinkSync(artifact);",
          "fs.writeFileSync(artifact,'forged');",
        ].join(" "),
      ],
      cwd: ".",
      workspacePath: fixture.repository,
      timeoutMs: 5_000,
    }),
    (error) => error instanceof VerificationError && error.code === "artifact_replaced",
  );
  const [artifactName] = await readdir(fixture.artifacts);
  assert.ok(artifactName);
  assert.equal(await readFile(resolve(fixture.artifacts, artifactName), "utf8"), "forged");
});

test("Verification keeps zero exit from passing when ignored state changes", async (t) => {
  const fixture = await repositoryFixture(t);
  await writeFile(resolve(fixture.repository, ".gitignore"), "ignored.txt\n");
  execFileSync("git", ["-C", fixture.repository, "add", ".gitignore"]);
  execFileSync("git", ["-C", fixture.repository, "commit", "-m", "ignore local data"]);
  await writeFile(resolve(fixture.repository, "ignored.txt"), "before\n");

  const verification = await new VerificationRunner({ artifactRoot: fixture.artifacts }).run({
    attemptId: "attempt-ignored-change",
    checkId: "check",
    argv: [process.execPath, "-e", "require('node:fs').writeFileSync('ignored.txt', 'after\\n')"],
    cwd: ".",
    workspacePath: fixture.repository,
    timeoutMs: 5_000,
  });
  assert.equal(verification.result.exitCode, 0);
  assert.equal(verification.result.status, "failed");
});

test("Verification rejects tracked paths hidden by Git index flags", async (t) => {
  const fixture = await repositoryFixture(t);
  for (const flag of ["--assume-unchanged", "--skip-worktree"]) {
    execFileSync("git", [
      "-C",
      fixture.repository,
      "update-index",
      "--no-assume-unchanged",
      "--no-skip-worktree",
      "README.md",
    ]);
    execFileSync("git", ["-C", fixture.repository, "update-index", flag, "README.md"]);
    const marker = resolve(fixture.repository, `${flag.slice(2)}-must-not-run.txt`);

    await assert.rejects(
      new VerificationRunner({ artifactRoot: fixture.artifacts }).run({
        attemptId: `attempt-${flag.slice(2)}`,
        checkId: "check",
        argv: [
          process.execPath,
          "-e",
          `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`,
        ],
        cwd: ".",
        workspacePath: fixture.repository,
        timeoutMs: 5_000,
      }),
      /Tracked paths with hidden Git index flags cannot be fingerprinted safely/,
    );
    await assert.rejects(access(marker));
  }
});

test("Verification waits for detached descendants before observing the workspace", async (t) => {
  const fixture = await repositoryFixture(t);
  const worker = "setTimeout(() => require('node:fs').writeFileSync('late.txt', 'late\\n'), 500)";

  const verification = await new VerificationRunner({ artifactRoot: fixture.artifacts }).run({
    attemptId: "attempt-detached-descendant",
    checkId: "check",
    argv: [
      process.execPath,
      "-e",
      [
        "const { spawn } = require('node:child_process');",
        `const child = spawn(process.execPath, ['-e', ${JSON.stringify(worker)}], { stdio: 'ignore' });`,
        "child.unref();",
      ].join(" "),
    ],
    cwd: ".",
    workspacePath: fixture.repository,
    timeoutMs: 2_000,
  });
  assert.equal(verification.result.exitCode, 0);
  assert.equal(verification.result.status, "failed");
});

test("Verification waits for descendants that escape the process group", async (t) => {
  const fixture = await repositoryFixture(t);
  const worker =
    "setTimeout(() => require('node:fs').writeFileSync('escaped.txt', 'escaped\\n'), 500)";

  const verification = await new VerificationRunner({ artifactRoot: fixture.artifacts }).run({
    attemptId: "attempt-escaped-descendant",
    checkId: "check",
    argv: [
      process.execPath,
      "-e",
      [
        "const { spawn } = require('node:child_process');",
        `const child = spawn(process.execPath, ['-e', ${JSON.stringify(worker)}], { detached: true, stdio: 'ignore' });`,
        "child.unref();",
        "setTimeout(() => {}, 100);",
      ].join(" "),
    ],
    cwd: ".",
    workspacePath: fixture.repository,
    timeoutMs: 2_000,
  });
  assert.equal(verification.result.exitCode, 0);
  assert.equal(verification.result.status, "failed");
});

test("Verification frames untracked files independently", async (t) => {
  const fixture = await repositoryFixture(t);
  const ambiguous = resolve(fixture.repository, "A");
  await writeFile(ambiguous, "placeholder");
  const mode = (await lstat(ambiguous)).mode;
  await writeFile(ambiguous, `x\0B\0${mode}\0y`);

  const verification = await new VerificationRunner({ artifactRoot: fixture.artifacts }).run({
    attemptId: "attempt-untracked-framing",
    checkId: "check",
    argv: [
      process.execPath,
      "-e",
      "require('fs').writeFileSync('A', 'x'); require('fs').writeFileSync('B', 'y')",
    ],
    cwd: ".",
    workspacePath: fixture.repository,
    timeoutMs: 5_000,
  });
  assert.equal(verification.result.exitCode, 0);
  assert.equal(verification.result.status, "failed");
});

test("Verification fingerprints symlink targets as bytes", async (t) => {
  const fixture = await repositoryFixture(t);
  await symlink(Buffer.from([0x80]), resolve(fixture.repository, "link"));

  const verification = await new VerificationRunner({ artifactRoot: fixture.artifacts }).run({
    attemptId: "attempt-symlink-bytes",
    checkId: "check",
    argv: [
      process.execPath,
      "-e",
      "const fs=require('node:fs'); fs.unlinkSync('link'); fs.symlinkSync(Buffer.from([0x81]), 'link')",
    ],
    cwd: ".",
    workspacePath: fixture.repository,
    timeoutMs: 5_000,
  });
  assert.equal(verification.result.exitCode, 0);
  assert.equal(verification.result.status, "failed");
});

test("Fingerprint parser preserves raw untracked pathnames", () => {
  const paths = splitNull(Buffer.from([0x80, 0, 0xef, 0xbf, 0xbd, 0]));
  assert.deepEqual(
    paths.map((path) => [...path]),
    [[0x80], [0xef, 0xbf, 0xbd]],
  );
});

test("Verification rejects repositories with submodules", async (t) => {
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
    fixture.repository,
    "-c",
    "protocol.file.allow=always",
    "submodule",
    "add",
    submodule,
    "nested",
  ]);
  execFileSync("git", ["-C", fixture.repository, "commit", "-m", "add submodule"]);
  await assert.rejects(
    readWorktreeFingerprint(fixture.repository),
    /Git submodules are not supported by the V1 Workspace boundary/,
  );
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
