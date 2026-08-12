#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  AttemptSnapshotSchema,
  type ReviewDecision,
  ReviewDecisionSchema,
  type VerificationResult,
} from "@symphoneer/contracts";
import {
  CodexAppServerAdapter,
  GitHubIssuesAdapter,
  GitWorktreeDriver,
  loadProjectProfile,
  RuntimeHttpServer,
  RuntimeService,
  renderPrompt,
  VerificationRunner,
  WorkspaceManager,
} from "@symphoneer/runtime";

const execFile = promisify(execFileCallback);
const repositoryDefault = "icho648/symphoneer-fixtures";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface RealFixtureSmokeOptions {
  mode?: "single-agent";
  issueNumber: number;
  repository?: string;
  githubToken?: string;
  autoApprove?: boolean;
  reviewTimeoutMs?: number;
  uiDistDir?: string;
}

export interface RealFixtureSmokeReport {
  mode: "single-agent";
  root: string;
  repository: string;
  issue: {
    number: number;
    nativeId: string;
    url: string;
    updatedAt: string | null;
    versionToken: string | null;
  };
  attemptId: string;
  workspace: {
    id: string;
    path: string;
    branch: string;
    state: string;
    gitHead: string | null;
  };
  provider: {
    threadId: string;
    turnId: string;
    version: string;
    inputFingerprint: string;
    interventionCount: number;
    notificationCount: number;
  };
  verification: {
    result: VerificationResult;
    artifactPath: string;
    runtimeArtifactRef: string | null;
  };
  humanDecision: ReviewDecision;
  diff: { files: string[]; stat: string };
  cleanup: { state: "released" | "retained"; reason?: string };
  runtime: { endpoint: string; reviewUrl: string; dataDir: string; eventCount: number };
  reportPath: string;
}

export async function runRealFixture(
  options: RealFixtureSmokeOptions,
): Promise<RealFixtureSmokeReport> {
  if (options.mode !== undefined && options.mode !== "single-agent") {
    throw new Error(`Unsupported fixture smoke mode: ${options.mode}`);
  }
  if (!Number.isInteger(options.issueNumber) || options.issueNumber <= 0) {
    throw new Error("A positive fixture Issue number is required");
  }
  const repository = options.repository ?? repositoryDefault;
  const githubToken = options.githubToken ?? process.env.GITHUB_TOKEN;
  if (!githubToken) throw new Error("GITHUB_TOKEN is required for real GitHub Issue reads");

  const smokeRoot = await mkdtemp(join(tmpdir(), "symphoneer-fixture-smoke-"));
  const sourcePath = resolve(smokeRoot, "source");
  await run(
    "git",
    ["clone", "--quiet", `https://github.com/${repository}.git`, sourcePath],
    smokeRoot,
  );

  const workflow = await loadProjectProfile({ cwd: sourcePath });
  const check = workflow.config.symphoneer.verification[0];
  if (!check) throw new Error("Fixture WORKFLOW.md has no verification check");

  const tracker = new GitHubIssuesAdapter({ repository, token: githubToken });
  const taskSnapshot = await tracker.getTask(String(options.issueNumber));
  if (!taskSnapshot.task.dispatchable) {
    throw new Error("Fixture Issue is not dispatchable: it must be open with symphoneer:ready");
  }

  const dataDir = resolve(smokeRoot, "runtime");
  const service = new RuntimeService({
    dataDir,
    tracker,
  });
  await service.start();
  await service.refreshTracker();
  const sessionToken = randomBytes(24).toString("base64url");
  const uiDistDir = options.uiDistDir ?? resolve(root, "src/web/dist");
  await access(resolve(uiDistDir, "index.html"));
  const server = new RuntimeHttpServer(service, {
    sessionToken,
    uiDistDir,
  });
  const endpoint = await server.listen();
  const attemptId = `attempt:fixture:${options.issueNumber}:${randomUUID()}`;
  const manager = new WorkspaceManager({
    root: resolve(smokeRoot, "workspaces"),
    driver: new GitWorktreeDriver({ repositoryPath: sourcePath, repository, baseRevision: "HEAD" }),
  });
  const startedAt = new Date().toISOString();
  let workspace = (
    await manager.prepare({
      taskId: taskSnapshot.task.id,
      identifier: taskSnapshot.task.identifier,
      attemptId,
      repository,
      branch: `codex/fixture-${options.issueNumber}-${randomUUID().slice(0, 8)}`,
      host: "local",
    })
  ).workspace;
  let attempt = AttemptSnapshotSchema.parse({
    schemaVersion: 2,
    id: attemptId,
    taskId: taskSnapshot.task.id,
    sequence: 1,
    startReason: "dispatch",
    status: "preparing_workspace",
    workspaceId: workspace.id,
    providerSession: null,
    startedAt,
    updatedAt: startedAt,
  });

  try {
    await service.recordTask(taskSnapshot.task, `fixture:task:${taskSnapshot.task.id}`);
    const ready = await service.execute({
      kind: "set_task_status",
      taskId: taskSnapshot.task.id,
      workflowStatus: "ready",
      expectedEventSequence: service.snapshot().runtime.lastEventSequence,
      idempotencyKey: `fixture:ready:${taskSnapshot.task.id}`,
    });
    if (
      ready.snapshot.tasks.find((task) => task.id === taskSnapshot.task.id)?.workflowStatus !==
      "ready"
    ) {
      throw new Error("Fixture Smoke could not move the Task to Ready");
    }
    await service.recordAttempt(attempt, {
      workspace,
      idempotencyKey: `fixture:attempt:${attemptId}:preparing`,
    });
    await run("pnpm", ["install", "--frozen-lockfile"], workspace.path);

    attempt = AttemptSnapshotSchema.parse({
      ...attempt,
      status: "launching_agent",
      updatedAt: new Date().toISOString(),
    });
    await service.recordAttempt(attempt, {
      workspace,
      idempotencyKey: `fixture:attempt:${attemptId}:launching`,
    });

    const prompt = await renderPrompt(workflow, {
      issue: JSON.parse(JSON.stringify(taskSnapshot.task)) as Record<string, unknown>,
      attempt: 1,
    });
    const [command, ...args] = workflow.config.codex.command.trim().split(/\s+/);
    if (!command) throw new Error("Fixture WORKFLOW.md has an empty Codex command");
    const runner = new CodexAppServerAdapter({
      command,
      args,
      approvalPolicy: optionValue(
        workflow.config.codex.approvalPolicy,
        ["never", "on-request", "untrusted"],
        "on-request",
      ),
      sandbox: optionValue(
        workflow.config.codex.turnSandboxPolicy,
        ["danger-full-access", "read-only", "workspace-write"],
        "workspace-write",
      ),
      readTimeoutMs: Math.max(workflow.config.codex.readTimeoutMs, 30_000),
      turnTimeoutMs: workflow.config.codex.turnTimeoutMs,
      stallTimeoutMs: workflow.config.codex.stallTimeoutMs,
    });
    const handle = await runner.startOrContinue({
      attemptId,
      task: taskSnapshot.task,
      workspace,
      prompt,
      continuation: false,
    });
    let provider: {
      threadId: string;
      turnId: string;
      version: string;
      inputFingerprint: string;
    } | null = null;
    let interventionCount = 0;
    let notificationCount = 0;
    const events = (async () => {
      for await (const event of handle.events) {
        if (event.type === "session_started") {
          provider = {
            threadId: event.threadId,
            turnId: event.turnId,
            version: event.provider.version,
            inputFingerprint: event.provider.inputFingerprint,
          };
          attempt = AttemptSnapshotSchema.parse({
            ...attempt,
            status: "streaming_turn",
            activeTurn: { threadId: event.threadId, turnId: event.turnId },
            providerSession: { threadId: event.threadId, lastTurnId: event.turnId },
            updatedAt: new Date().toISOString(),
          });
          await service.recordAttempt(attempt, {
            workspace,
            idempotencyKey: `fixture:attempt:${attemptId}:streaming`,
          });
        } else if (event.type === "intervention_requested") {
          interventionCount += 1;
          if (!options.autoApprove) {
            throw new Error("Codex requested approval; rerun with --auto-approve for this Smoke");
          }
          if (event.kind === "approval") {
            await handle.respondToIntervention(event.requestRef, { decision: "approved" });
          } else {
            await handle.respondToIntervention(event.requestRef, {
              decision: "answered",
              responses: Object.fromEntries(
                (event.questionIds ?? []).map((questionId) => [questionId, ["yes"]]),
              ),
            });
          }
        } else {
          notificationCount += 1;
        }
      }
    })();
    let completion: Awaited<typeof handle.completion>;
    try {
      completion = await handle.completion;
      await events;
    } catch (error) {
      await handle.interrupt().catch(() => undefined);
      await handle.completion.catch(() => undefined);
      throw error;
    }
    if (completion.outcome !== "completed") {
      throw new Error(`Codex Turn did not complete: ${completion.error ?? completion.outcome}`);
    }
    if (provider === null) throw new Error("Codex completed without a session_started event");
    const session = provider as {
      threadId: string;
      turnId: string;
      version: string;
      inputFingerprint: string;
    };

    const { activeTurn: _activeTurn, ...withoutActiveTurn } = attempt;
    attempt = AttemptSnapshotSchema.parse({
      ...withoutActiveTurn,
      status: "finishing",
      updatedAt: new Date().toISOString(),
    });
    await service.recordAttempt(attempt, {
      workspace,
      idempotencyKey: `fixture:attempt:${attemptId}:finishing`,
    });

    const verification = await new VerificationRunner({
      artifactRoot: resolve(smokeRoot, "verification-artifacts"),
    }).run({
      attemptId,
      checkId: check.id,
      argv: check.argv,
      cwd: check.cwd,
      workspacePath: workspace.path,
      timeoutMs: check.timeoutMs,
    });
    const artifact = await readFile(verification.artifactPath);
    await service.recordVerification(verification.result, {
      artifact,
      idempotencyKey: `fixture:verification:${attemptId}:${check.id}`,
    });
    if (verification.result.status !== "passed") {
      throw new Error(`Fixture verification did not pass: ${verification.result.status}`);
    }

    const diff = await diffState(workspace.path);
    const unexpected = diff.files.filter((file) => !file.startsWith("src/"));
    if (unexpected.length > 0) {
      throw new Error(`Fixture Smoke changed files outside src/: ${unexpected.join(", ")}`);
    }

    const reviewUrl = new URL(`${endpoint.url}/zh-CN`);
    reviewUrl.searchParams.set("task", taskSnapshot.task.id);
    reviewUrl.searchParams.set("attempt", attemptId);
    const review = await waitForReview(
      service,
      attemptId,
      options.reviewTimeoutMs ?? 1_800_000,
      reviewUrl.toString(),
    );

    await rm(resolve(workspace.path, "node_modules"), { recursive: true, force: true });
    await rm(resolve(workspace.path, "dist"), { recursive: true, force: true });
    const finished = await manager.finish(workspace);
    workspace = finished.workspace;
    await service.recordWorkspace(workspace, `fixture:workspace:${workspace.id}:retained`);
    let cleanup: { state: "released" | "retained"; reason?: string };
    try {
      const released = await manager.remove(workspace);
      workspace = released.workspace;
      cleanup = { state: "released" };
      await service.recordWorkspace(workspace, `fixture:workspace:${workspace.id}:released`);
    } catch (error) {
      cleanup = {
        state: "retained",
        reason: error instanceof Error ? error.message : "Workspace was retained after Smoke",
      };
    }

    if (review.decision === "merge_close") {
      attempt = AttemptSnapshotSchema.parse({
        ...attempt,
        status: "succeeded",
        updatedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        failure: null,
      });
      await service.recordAttempt(attempt, {
        workspace,
        idempotencyKey: `fixture:attempt:${attemptId}:succeeded`,
      });
    }
    const snapshot = service.snapshot();
    const runtimeVerification = snapshot.verifications.find(
      (item) => item.attemptId === attemptId && item.checkId === check.id,
    );
    const report: RealFixtureSmokeReport = {
      mode: "single-agent",
      root: smokeRoot,
      repository,
      issue: {
        number: options.issueNumber,
        nativeId: taskSnapshot.task.source.nativeId,
        url: taskSnapshot.task.source.url,
        updatedAt: taskSnapshot.task.updatedAt ?? null,
        versionToken: taskSnapshot.versionToken,
      },
      attemptId,
      workspace: {
        id: workspace.id,
        path: workspace.path,
        branch: workspace.branch,
        state: workspace.state,
        gitHead: workspace.gitHead,
      },
      provider: {
        threadId: session.threadId,
        turnId: session.turnId,
        version: session.version,
        inputFingerprint: session.inputFingerprint,
        interventionCount,
        notificationCount,
      },
      verification: {
        result: verification.result,
        artifactPath: verification.artifactPath,
        runtimeArtifactRef: runtimeVerification?.artifactRef ?? null,
      },
      humanDecision: review,
      diff,
      cleanup,
      runtime: {
        endpoint: endpoint.url,
        reviewUrl: reviewUrl.toString(),
        dataDir,
        eventCount: snapshot.runtime.lastEventSequence,
      },
      reportPath: resolve(smokeRoot, "smoke-report.json"),
    };
    await writeFile(report.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await server.close();
    return report;
  } finally {
    await server.close().catch(() => undefined);
  }
}

async function waitForReview(
  service: RuntimeService,
  attemptId: string,
  timeoutMs: number,
  reviewUrl: string,
): Promise<ReviewDecision> {
  process.stdout.write(`Human review required at ${reviewUrl}\n`);
  const result = Promise.withResolvers<ReviewDecision>();
  const unsubscribe = service.subscribe((event) => {
    if (event.event.type !== "review.decided") return;
    const review = ReviewDecisionSchema.safeParse(event.event.payload.review);
    if (review.success && review.data.attemptId === attemptId) result.resolve(review.data);
  });
  const timeout = setTimeout(
    () => result.reject(new Error(`Human review timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );
  timeout.unref();
  try {
    return await result.promise;
  } finally {
    clearTimeout(timeout);
    unsubscribe();
  }
}

async function diffState(workspacePath: string): Promise<{ files: string[]; stat: string }> {
  const [status, stat] = await Promise.all([
    run("git", ["status", "--porcelain=v1"], workspacePath),
    run("git", ["diff", "--stat"], workspacePath),
  ]);
  return {
    files: status.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim()),
    stat: stat.stdout.trim(),
  };
}

async function run(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFile(command, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  } catch (error) {
    const failure = error as { code?: unknown; stderr?: unknown };
    const stderr = typeof failure.stderr === "string" ? failure.stderr.trim().slice(-800) : "";
    throw new Error(
      `${command} ${args[0] ?? "command"} failed${
        failure.code === undefined ? "" : ` with code ${String(failure.code)}`
      }${stderr ? `: ${stderr}` : ""}`,
    );
  }
}

function optionValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function parseArgs(args: string[]): RealFixtureSmokeOptions {
  const issueIndex = args.indexOf("--issue");
  const issueNumber = Number(issueIndex >= 0 ? args[issueIndex + 1] : "");
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    throw new Error("Usage: pnpm smoke:fixture --issue <number> [--auto-approve]");
  }
  const repositoryIndex = args.indexOf("--repository");
  const timeoutIndex = args.indexOf("--review-timeout-ms");
  return {
    issueNumber,
    ...(repositoryIndex >= 0 && args[repositoryIndex + 1]
      ? { repository: args[repositoryIndex + 1] }
      : {}),
    ...(timeoutIndex >= 0 && args[timeoutIndex + 1]
      ? { reviewTimeoutMs: Number(args[timeoutIndex + 1]) }
      : {}),
    autoApprove: args.includes("--auto-approve"),
  };
}

if (import.meta.main) {
  runRealFixture(parseArgs(process.argv.slice(2)))
    .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : "Fixture Smoke failed"}\n`);
      process.exitCode = 1;
    });
}
