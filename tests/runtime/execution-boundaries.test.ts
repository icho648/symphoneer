import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { CONTRACT_SCHEMA_VERSION, type TaskSummary } from "@symphoneer/contracts";
import {
  CodexAppServerAdapter,
  type CodexServerMessage,
  type CodexTransport,
  CoreScheduler,
  GitHubIssuesAdapter,
  GitWorktreeDriver,
  type JsonRpcId,
  VerificationRunner,
  WorkspaceManager,
} from "@symphoneer/runtime";

class CompletingCodexTransport implements CodexTransport {
  readonly toolVersion = "codex-cli integration-test";
  readonly messages: AsyncIterable<CodexServerMessage>;
  readonly closed: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  readonly #done = Promise.withResolvers<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>();
  #controller!: ReadableStreamDefaultController<CodexServerMessage>;

  constructor() {
    this.closed = this.#done.promise;
    this.messages = new ReadableStream({
      start: (controller) => {
        this.#controller = controller;
      },
    });
  }

  async request(method: string): Promise<unknown> {
    if (method === "initialize") return {};
    if (method === "thread/start") return { thread: { id: "thread-14" } };
    if (method === "turn/start") {
      queueMicrotask(() => {
        this.#controller.enqueue({
          kind: "notification",
          method: "turn/completed",
          params: { threadId: "thread-14", turn: { id: "turn-14", status: "completed" } },
        });
      });
      return { turn: { id: "turn-14" } };
    }
    throw new Error(`Unexpected Codex request ${method}`);
  }

  notify(): void {}
  respond(_id: JsonRpcId): void {}
  reject(_id: JsonRpcId): void {}

  async close(): Promise<void> {
    this.#controller.close();
    this.#done.resolve({ code: 0, signal: null });
  }
}

async function repositoryFixture(t: TestContext) {
  const base = await mkdtemp(resolve(tmpdir(), "symphoneer-issue14-boundaries-"));
  const repository = resolve(base, "repository");
  execFileSync("git", ["init", "-b", "main", repository]);
  execFileSync("git", ["-C", repository, "config", "user.name", "Symphoneer Test"]);
  execFileSync("git", ["-C", repository, "config", "user.email", "test@example.com"]);
  await writeFile(resolve(repository, "README.md"), "baseline\n");
  execFileSync("git", ["-C", repository, "add", "README.md"]);
  execFileSync("git", ["-C", repository, "commit", "-m", "baseline"]);
  t.after(() => rm(base, { recursive: true, force: true }));
  return { base, repository };
}

test("Issue, worktree, Codex, and independent Verification form one minimal closure", async (t) => {
  const fixture = await repositoryFixture(t);
  const tracker = new GitHubIssuesAdapter({
    repository: "icho648/symphoneer",
    token: "test-token",
    fetch: (async () =>
      new Response(
        JSON.stringify({
          id: 1_014,
          number: 14,
          html_url: "https://github.com/icho648/symphoneer/issues/14",
          title: "Connect execution boundaries",
          state: "open",
          labels: ["symphoneer:ready"],
          created_at: "2026-08-03T12:00:00Z",
          updated_at: "2026-08-03T12:00:01Z",
        }),
      )) as typeof fetch,
  });
  const task = (await tracker.getTask("14")).task;
  const manager = new WorkspaceManager({
    root: resolve(fixture.base, "workspaces"),
    driver: new GitWorktreeDriver({
      repositoryPath: fixture.repository,
      repository: "icho648/symphoneer",
      baseRevision: "HEAD",
    }),
  });
  const prepared = await manager.prepare({
    taskId: task.id,
    identifier: task.identifier,
    attemptId: "attempt-14",
    repository: "icho648/symphoneer",
    branch: "codex/issue-14",
    host: "local",
  });
  const scheduler = new CoreScheduler({
    activeStates: ["open"],
    terminalStates: ["closed"],
    requiredLabels: ["symphoneer:ready"],
    excludedLabels: ["symphoneer:review"],
    maxConcurrentAgents: 1,
    maxConcurrentAgentsByState: { open: 1 },
    maxRetryBackoffMs: 300_000,
  });
  assert.equal(
    scheduler.reserveAttempt({
      task,
      attemptId: "attempt-14",
      sequence: 1,
      startReason: "dispatch",
      workspace: prepared.workspace,
      startedAt: "2026-08-03T12:00:02.000Z",
      idempotencyKey: "dispatch-14",
    }).kind,
    "reserved",
  );

  const handle = await new CodexAppServerAdapter({
    transportFactory: async () => new CompletingCodexTransport(),
  }).startOrContinue({
    attemptId: "attempt-14",
    task,
    workspace: prepared.workspace,
    prompt: "Implement Issue #14",
    continuation: false,
  });
  for await (const event of handle.events) {
    if (event.type === "session_started") {
      scheduler.attachTurn({
        attemptId: "attempt-14",
        threadId: event.threadId,
        turnId: event.turnId,
        updatedAt: "2026-08-03T12:00:03.000Z",
        idempotencyKey: "turn-14",
      });
    }
  }
  assert.deepEqual(await handle.completion, { outcome: "completed" });
  const verification = await new VerificationRunner({
    artifactRoot: resolve(fixture.base, "artifacts"),
    toolVersion: "integration-verifier-1",
  }).run({
    attemptId: "attempt-14",
    checkId: "node-exit",
    argv: [process.execPath, "-e", "process.exit(0)"],
    cwd: ".",
    workspacePath: prepared.workspace.path,
    timeoutMs: 5_000,
  });
  assert.equal(verification.result.status, "passed");
  const retained = await manager.finish(prepared.workspace);
  scheduler.finishAttempt({
    attemptId: "attempt-14",
    status: "succeeded",
    finishedAt: "2026-08-03T12:00:04.000Z",
    workspace: retained.workspace,
    idempotencyKey: "finish-14",
  });
  assert.equal((await manager.remove(retained.workspace)).workspace.state, "released");
});

test("dirty worktree pause, restart recovery, and resume share the latest observation", async (t) => {
  const fixture = await repositoryFixture(t);
  const task: TaskSummary = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "github:icho648/symphoneer:2014",
    identifier: "#2014",
    source: {
      kind: "github",
      nativeId: "2014",
      url: "https://github.com/icho648/symphoneer/issues/2014",
    },
    title: "Pause and resume dirty work",
    state: "open",
    labels: ["symphoneer:ready"],
    dispatchable: true,
  };
  const driver = new GitWorktreeDriver({
    repositoryPath: fixture.repository,
    repository: "icho648/symphoneer",
    baseRevision: "HEAD",
  });
  const workspaceRoot = resolve(fixture.base, "workspaces");
  const manager = new WorkspaceManager({ root: workspaceRoot, driver });
  const prepared = await manager.prepare({
    taskId: task.id,
    identifier: task.identifier,
    attemptId: "attempt-2014",
    repository: "icho648/symphoneer",
    branch: "codex/issue-2014",
    host: "local",
  });
  const scheduler = new CoreScheduler({
    activeStates: ["open"],
    terminalStates: ["closed"],
    requiredLabels: ["symphoneer:ready"],
    excludedLabels: ["symphoneer:review"],
    maxConcurrentAgents: 1,
    maxConcurrentAgentsByState: { open: 1 },
    maxRetryBackoffMs: 300_000,
  });
  scheduler.reserveAttempt({
    task,
    attemptId: "attempt-2014",
    sequence: 1,
    startReason: "dispatch",
    workspace: prepared.workspace,
    startedAt: "2026-08-03T12:10:00.000Z",
    idempotencyKey: "dispatch-2014",
  });
  scheduler.attachTurn({
    attemptId: "attempt-2014",
    threadId: "thread-2014",
    turnId: "turn-2014",
    updatedAt: "2026-08-03T12:10:01.000Z",
    idempotencyKey: "turn-2014",
  });
  const agentFile = resolve(prepared.workspace.path, "agent-change.txt");
  await writeFile(agentFile, "keep across pause\n");
  const retained = await manager.finish(prepared.workspace);
  const paused = scheduler.pauseAttempt({
    attemptId: "attempt-2014",
    pausedAt: "2026-08-03T12:10:02.000Z",
    workspace: retained.workspace,
    idempotencyKey: "pause-2014",
  });
  assert.equal(paused.workspace.worktreeFingerprint, retained.workspace.worktreeFingerprint);

  const restarted = new WorkspaceManager({ root: workspaceRoot, driver });
  const recovered = await restarted.recover(retained.workspace, "attempt-2014");
  assert.equal(
    scheduler.resumePausedAttempt({
      attemptId: "attempt-2014",
      task,
      workspace: recovered.workspace,
      resumedAt: "2026-08-03T12:10:03.000Z",
      idempotencyKey: "resume-2014",
    }).status,
    "launching_agent",
  );
  await rm(agentFile);
  const finalRetained = await restarted.finish(recovered.workspace);
  scheduler.finishAttempt({
    attemptId: "attempt-2014",
    status: "succeeded",
    finishedAt: "2026-08-03T12:10:04.000Z",
    workspace: finalRetained.workspace,
    idempotencyKey: "finish-2014",
  });
  assert.equal((await restarted.remove(finalRetained.workspace)).workspace.state, "released");
});
