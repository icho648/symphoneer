#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  ApplicationData,
  DesktopRuntimeHost,
  GitHubIssuesAdapter,
  GitWorktreeDriver,
  loadProjectProfile,
  RealSingleAgentOrchestration,
  RuntimeService,
  type Tracker,
  WorkspaceManager,
} from "@symphoneer/runtime";

const execFile = promisify(execFileCallback);
const repositoryDefault = "icho648/symphoneer-fixtures";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface RealFixtureSmokeOptions {
  repository?: string;
  githubToken?: string;
  timeoutMs?: number;
  injectWorkerFailure?: boolean;
}

export interface RealFixtureSmokeReport {
  status: "passed" | "failed" | "timed_out";
  repository: string;
  issueNumber: number;
  issueUrl: string;
  root: string;
  manifestPath: string;
  taskId: string | null;
  attemptId: string | null;
  workspace: {
    id: string;
    path: string;
    repository: string;
    branch: string;
    gitHead: string | null;
    worktreeFingerprint: string | null;
    state: string;
  } | null;
  provider: { threadId: string; turnId: string } | null;
  operatorLogPath: string | null;
  cleanup: "released" | "retained" | "not_attempted";
  failure: string | null;
}

export async function runRealFixture(
  options: RealFixtureSmokeOptions = {},
): Promise<RealFixtureSmokeReport> {
  const repository = options.repository ?? repositoryDefault;
  const token =
    options.githubToken ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? (await ghToken());
  if (!token) throw new Error("GITHUB_TOKEN or GH_TOKEN is required for real fixture Smoke");
  const root = await mkdtemp(join(tmpdir(), "symphoneer-fixture-smoke-"));
  const sourcePath = resolve(root, "source");
  await run("git", ["clone", "--quiet", `https://github.com/${repository}.git`, sourcePath], root);
  const marker = randomUUID().slice(0, 8);
  const issue = await createFixtureIssue(repository, token, marker);
  const dataDir = resolve(root, "application-data");
  const logDir = resolve(root, "logs");
  const cacheDir = resolve(root, "cache");
  const workspaceRoot = resolve(root, "workspaces");
  const applicationData = new ApplicationData({ dataDir, logDir, cacheDir, workspaceRoot });
  const host = new DesktopRuntimeHost({
    applicationData,
    createRuntime: async ({ project, layout }) => {
      if (!project.projectRoot) throw new Error("Fixture project checkout is unavailable");
      const projectRoot = project.projectRoot;
      const github = new GitHubIssuesAdapter({ repository, token });
      const tracker: Tracker = {
        kind: github.kind,
        getTask: (nativeId, readOptions) => github.getTask(nativeId, readOptions),
        listTasks: async (readOptions) => ({
          tasks: [
            await github.getTask(String(issue.number), {
              ...(readOptions?.signal ? { signal: readOptions.signal } : {}),
            }),
          ],
          nextCursor: null,
        }),
      };
      const profile = await loadProjectProfile({
        cwd: projectRoot,
        workspaceRoot: project.workspaceRoot,
      });
      const orchestration = new RealSingleAgentOrchestration({
        dataDir: layout.root,
        tracker,
        projectRoot,
        workspaceRoot: project.workspaceRoot,
        operatorLogPath: layout.operatorLogPath,
        ...(options.injectWorkerFailure
          ? {
              runnerFactory: () => ({
                openWorker: async () => {
                  throw new Error("deterministic_injected_worker_failure");
                },
              }),
            }
          : {}),
      });
      return {
        runtime: new RuntimeService({
          dataDir: layout.root,
          tracker,
          defaultOrchestration: orchestration,
          sessionHistory: (attempt) => orchestration.readSession(attempt),
        }),
        pollingIntervalMs: Math.min(profile.config.polling.intervalMs, 1_000),
      };
    },
  });
  const report: RealFixtureSmokeReport = {
    status: "timed_out",
    repository,
    issueNumber: issue.number,
    issueUrl: issue.url,
    root,
    manifestPath: resolve(root, "manifest.json"),
    taskId: null,
    attemptId: null,
    workspace: null,
    provider: null,
    operatorLogPath: null,
    cleanup: "not_attempted",
    failure: null,
  };

  try {
    await host.start();
    const project = await host.addProject({
      trackerKind: "github",
      repository,
      projectRoot: sourcePath,
    });
    const layout = applicationData.project(project.id);
    report.operatorLogPath = layout.operatorLogPath;
    const deadline = Date.now() + (options.timeoutMs ?? 1_800_000);
    while (Date.now() < deadline) {
      const snapshot = host.snapshot();
      const task = snapshot.tasks.find(
        (candidate) =>
          candidate.source.kind === "github" && candidate.source.nativeId === String(issue.number),
      );
      if (task) report.taskId = task.id;
      const attempt = task
        ? snapshot.attempts
            .filter((candidate) => candidate.taskId === task.id)
            .sort((left, right) => right.sequence - left.sequence)[0]
        : undefined;
      if (attempt) {
        report.attemptId = attempt.id;
        report.provider =
          attempt.activeTurn || attempt.providerSession
            ? {
                threadId: attempt.activeTurn?.threadId ?? attempt.providerSession?.threadId ?? "",
                turnId: attempt.activeTurn?.turnId ?? attempt.providerSession?.lastTurnId ?? "",
              }
            : null;
        const detail = host.attemptDetail(attempt.id);
        if (detail?.workspace) {
          report.workspace = {
            id: detail.workspace.id,
            path: detail.workspace.path,
            repository: detail.workspace.repository,
            branch: detail.workspace.branch,
            gitHead: detail.workspace.gitHead,
            worktreeFingerprint: detail.workspace.worktreeFingerprint,
            state: detail.workspace.state,
          };
        }
        if (attempt.finishedAt != null) {
          const reviewed = task?.labels.includes("symphoneer:review") ?? false;
          report.status = attempt.status === "succeeded" && reviewed ? "passed" : "failed";
          report.failure = report.status === "passed" ? null : (attempt.failure ?? attempt.status);
          break;
        }
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
    }
    if (report.status === "timed_out") report.failure = "fixture_timeout";
    await writeManifest(report);
    if (report.status === "passed" && report.workspace && report.taskId) {
      report.cleanup = await cleanupWorkspace(report, sourcePath, repository, workspaceRoot);
      await archiveFixtureIssue(repository, token, issue.number);
      await writeManifest(report);
    } else {
      report.cleanup = "retained";
      await writeManifest(report);
    }
    return report;
  } finally {
    await host.stop().catch(() => undefined);
  }
}

async function cleanupWorkspace(
  report: RealFixtureSmokeReport,
  sourcePath: string,
  repository: string,
  workspaceRoot: string,
): Promise<"released" | "retained"> {
  if (!report.workspace || !report.taskId) return "retained";
  await rm(resolve(report.workspace.path, "node_modules"), { recursive: true, force: true });
  await rm(resolve(report.workspace.path, "dist"), { recursive: true, force: true });
  const manager = new WorkspaceManager({
    root: workspaceRoot,
    driver: new GitWorktreeDriver({ repositoryPath: sourcePath, repository, baseRevision: "HEAD" }),
  });
  try {
    await manager.remove({
      schemaVersion: 2,
      taskId: report.taskId,
      ownerAttemptId: null,
      host: "local",
      ...report.workspace,
      state: "retained",
    });
    return "released";
  } catch {
    return "retained";
  }
}

async function createFixtureIssue(repository: string, token: string, marker: string) {
  const response = await github(repository, token, "/issues", {
    method: "POST",
    body: JSON.stringify({
      title: `[Smoke ${marker}] autonomous delivery`,
      labels: ["symphoneer:ready"],
      body: `Issue #47 fixture run ${marker}.

Create \`src/smoke-${marker}.ts\` exporting \`const smokeMarker = "${marker}"\`. Run the repository checks, commit and push the stable Issue branch. Then remove \`symphoneer:ready\`, add \`symphoneer:review\`, and leave a short evidence comment. Do not close or merge this Issue.`,
    }),
  });
  const value = (await response.json()) as { number?: unknown; html_url?: unknown };
  if (!Number.isInteger(value.number) || typeof value.html_url !== "string") {
    throw new Error("GitHub returned an invalid fixture Issue");
  }
  return { number: value.number as number, url: value.html_url };
}

async function archiveFixtureIssue(repository: string, token: string, issueNumber: number) {
  await github(repository, token, `/issues/${issueNumber}/comments`, {
    method: "POST",
    body: JSON.stringify({ body: "Archived after the Issue #47 autonomous fixture Smoke." }),
  });
  await github(repository, token, `/issues/${issueNumber}`, {
    method: "PATCH",
    body: JSON.stringify({ state: "closed", labels: [] }),
  });
}

async function github(
  repository: string,
  token: string,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub fixture write failed with status ${response.status}`);
  return response;
}

async function writeManifest(report: RealFixtureSmokeReport): Promise<void> {
  await writeFile(report.manifestPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function run(command: string, args: string[], cwd: string): Promise<void> {
  await execFile(command, args, { cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
}

async function ghToken(): Promise<string | undefined> {
  try {
    const result = await execFile("gh", ["auth", "token"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024,
    });
    return String(result.stdout).trim() || undefined;
  } catch {
    return undefined;
  }
}

function parseArgs(args: string[]): RealFixtureSmokeOptions {
  const repositoryIndex = args.indexOf("--repository");
  const timeoutIndex = args.indexOf("--timeout-ms");
  return {
    ...(repositoryIndex >= 0 && args[repositoryIndex + 1]
      ? { repository: args[repositoryIndex + 1] }
      : {}),
    ...(timeoutIndex >= 0 && args[timeoutIndex + 1]
      ? { timeoutMs: Number(args[timeoutIndex + 1]) }
      : {}),
    injectWorkerFailure: args.includes("--inject-worker-failure"),
  };
}

if (import.meta.main) {
  await access(resolve(repositoryRoot, "WORKFLOW.md"));
  runRealFixture(parseArgs(process.argv.slice(2)))
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (report.status !== "passed") process.exitCode = 1;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Fixture Smoke failed"}\n`);
      process.exitCode = 1;
    });
}
