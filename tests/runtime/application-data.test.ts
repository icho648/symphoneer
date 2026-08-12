import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { ApplicationData } from "@symphoneer/runtime";

const execFileAsync = promisify(execFile);

test("ApplicationData resolves paths once and keeps stable project identity across restarts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "symphoneer-application-data-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = join(root, "data");
  const repositories = join(root, "repositories");
  const alphaRoot = join(repositories, "alpha");
  const alphaAlias = join(repositories, "alpha-alias");
  const alphaWorktree = join(repositories, "alpha-worktree");
  const bravoRoot = join(repositories, "bravo");
  const movedBravoRoot = join(repositories, "bravo-moved");
  await initializeRepository(alphaRoot);
  await initializeRepository(bravoRoot);
  await symlink(alphaRoot, alphaAlias, "dir");
  await execFileAsync("git", ["-C", alphaRoot, "worktree", "add", "--detach", alphaWorktree]);
  let allocated = 0;
  const applicationData = new ApplicationData({
    dataDir,
    logDir: join(root, "logs"),
    cacheDir: join(root, "cache"),
    workspaceRoot: join(root, "workspaces"),
    idFactory: () => `project-${++allocated}`,
  });
  await applicationData.initialize();

  const alpha = await applicationData.registerProject({
    trackerKind: "github",
    repository: "example/alpha",
    projectRoot: alphaRoot,
  });
  const alphaAgain = await applicationData.registerProject({
    trackerKind: "github",
    repository: "example/alpha",
    projectRoot: alphaAlias,
  });
  const alphaFromWorktree = await applicationData.registerProject({
    trackerKind: "github",
    repository: "example/alpha",
    projectRoot: alphaWorktree,
  });
  const bravo = await applicationData.registerProject({
    trackerKind: "github",
    repository: "example/bravo",
    projectRoot: bravoRoot,
  });

  assert.equal(alphaAgain.id, alpha.id);
  assert.equal(alphaFromWorktree.id, alpha.id);
  assert.match(alpha.gitCommonDir ?? "", /\.git$/);
  assert.deepEqual(
    (await applicationData.listProjects()).map((project) => project.id),
    [alpha.id, bravo.id],
  );
  assert.deepEqual(applicationData.project(alpha.id), {
    root: join(dataDir, "projects", alpha.id),
    configPath: join(dataDir, "projects", alpha.id, "config.json"),
    eventsRoot: join(dataDir, "projects", alpha.id),
    artifactsRoot: join(dataDir, "projects", alpha.id),
    checkpointPath: join(dataDir, "projects", alpha.id, "orchestration", "checkpoints.sqlite"),
    workspaceRoot: join(root, "workspaces", alpha.id),
    operatorLogPath: join(root, "logs", alpha.id, "operator.jsonl"),
  });

  await rename(bravoRoot, movedBravoRoot);
  const reboundBravo = await applicationData.rebindProject(bravo.id, movedBravoRoot);
  assert.equal(reboundBravo.id, bravo.id);
  assert.equal(reboundBravo.projectRoot, await realpath(movedBravoRoot));
  assert.equal(applicationData.project(reboundBravo.id).root, join(dataDir, "projects", bravo.id));

  await applicationData.removeProject(alpha.id);
  const restarted = new ApplicationData({
    dataDir,
    logDir: join(root, "logs"),
    cacheDir: join(root, "cache"),
    workspaceRoot: join(root, "workspaces"),
  });
  await restarted.initialize();
  assert.deepEqual(await restarted.listProjects(), [reboundBravo]);
  assert.equal(
    JSON.parse(await readFile(applicationData.project(alpha.id).configPath, "utf8")).repository,
    "example/alpha",
  );
  await assert.rejects(readFile(join(dataDir, "project-id"), "utf8"), { code: "ENOENT" });
});

async function initializeRepository(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await execFileAsync("git", ["-C", path, "init", "--initial-branch=main"]);
  await execFileAsync("git", ["-C", path, "config", "user.name", "Symphoneer Test"]);
  await execFileAsync("git", ["-C", path, "config", "user.email", "test@symphoneer.local"]);
  await execFileAsync("git", ["-C", path, "commit", "--allow-empty", "-m", "Initial"]);
}
