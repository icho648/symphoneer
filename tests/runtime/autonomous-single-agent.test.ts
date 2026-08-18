import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  type AttemptSnapshot,
  CONTRACT_SCHEMA_VERSION,
  ExecutionSessionSchema,
  type TaskSummary,
  type WorkspaceReference,
} from "@symphoneer/contracts";
import {
  type AgentRunCompletion,
  type AgentRunner,
  RealSingleAgentOrchestration,
  RuntimeService,
  type Tracker,
} from "@symphoneer/runtime";
import { FakeAgentRunner } from "../fixtures/fake-agent-runner.ts";

test("Tracker refresh dispatches one production Worker and preserves injected failure", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "symphoneer-autonomous-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = resolve(root, "repository");
  const workspaceRoot = resolve(root, "workspaces");
  const dataDir = resolve(root, "data");
  execFileSync("git", ["init", "-b", "main", repository]);
  execFileSync("git", ["-C", repository, "config", "user.name", "Symphoneer Test"]);
  execFileSync("git", ["-C", repository, "config", "user.email", "test@example.com"]);
  await writeFile(
    resolve(repository, "package.json"),
    '{"name":"fixture","private":true,"packageManager":"pnpm@11.15.1"}\n',
  );
  await writeFile(
    resolve(repository, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n",
  );
  await mkdir(resolve(repository, ".symphoneer"));
  await writeFile(
    resolve(repository, ".symphoneer", "WORKFLOW.md"),
    `---
tracker:
  kind: github
  active_states: [open]
  terminal_states: [closed]
agent:
  max_concurrent_agents: 1
  max_turns: 2
codex:
  model: gpt-5.4
symphoneer:
  eligibility:
    required_labels: [symphoneer:ready]
    excluded_labels: [symphoneer:review]
workspace:
  root: ${workspaceRoot}
---
Implement {{ issue.identifier }}: {{ issue.title }}.

{{ issue.body }}

Labels: {{ issue.labels | join: ", " }}
Attempt: {% if attempt == nil %}first{% else %}{{ attempt }}{% endif %}
`,
  );
  execFileSync("git", ["-C", repository, "add", "."]);
  execFileSync("git", ["-C", repository, "commit", "-m", "fixture"]);

  const ready: TaskSummary = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "github:icho648/fixture:47",
    identifier: "#47",
    source: {
      kind: "github",
      nativeId: "47",
      url: "https://github.com/icho648/fixture/issues/47",
    },
    title: "Autonomous fixture",
    body: "Add the requested marker and run the acceptance check.",
    state: "open",
    labels: ["symphoneer:ready"],
    dispatchable: true,
    workflowStatus: "backlog",
    blocked: null,
  };
  let reads = 0;
  const tracker: Tracker = {
    kind: "github",
    listTasks: async () => ({ tasks: [{ task: ready, versionToken: null }], nextCursor: null }),
    getTask: async () => {
      reads += 1;
      return {
        task: reads < 3 ? ready : { ...ready, labels: ["symphoneer:ready", "symphoneer:review"] },
        versionToken: null,
      };
    },
  };
  const runner = new FakeAgentRunner([
    {
      events: [
        {
          type: "session_started",
          occurredAt: "2026-08-12T10:00:00.000Z",
          threadId: "thread-47",
          turnId: "turn-47",
          provider: {
            name: "fake",
            version: "fixture",
            schema: "fixture",
            inputFingerprint: "fixture",
          },
        },
      ],
      completion: { outcome: "completed" },
    },
    {
      events: [
        {
          type: "session_started",
          occurredAt: "2026-08-12T10:00:01.000Z",
          threadId: "thread-47",
          turnId: "turn-47-2",
          provider: {
            name: "fake",
            version: "fixture",
            schema: "fixture",
            inputFingerprint: "fixture-2",
          },
        },
      ],
      completion: { outcome: "completed" },
    },
  ]);
  const orchestration = new RealSingleAgentOrchestration({
    dataDir,
    tracker,
    projectRoot: repository,
    workspaceRoot,
    runnerFactory: () => runner,
  });
  const service = new RuntimeService({
    dataDir,
    tracker,
    defaultOrchestration: orchestration,
  });
  await service.start();

  await service.refreshTracker();
  for (
    let index = 0;
    index < 300 && service.snapshot().attempts[0]?.finishedAt == null;
    index += 1
  ) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }

  const attempt = service.snapshot().attempts[0];
  assert.equal(attempt?.status, "succeeded");
  assert.equal(attempt?.providerSession?.threadId, "thread-47");
  assert.equal(runner.openWorkerCount, 1);
  assert.equal(runner.closeWorkerCount, 1);
  assert.equal(runner.requests.length, 2);
  assert.equal(runner.requests[0]?.model, "gpt-5.4");
  assert.equal(runner.requests[0]?.threadId, undefined);
  assert.equal(runner.requests[1]?.threadId, "thread-47");
  assert.match(
    runner.requests[0]?.prompt ?? "",
    /Add the requested marker and run the acceptance check\.[\s\S]*Labels: symphoneer:ready[\s\S]*Attempt: first/,
  );
  assert.equal(
    runner.requests[1]?.prompt,
    "Continue working on the same issue. Re-read its current tracker state, finish any remaining acceptance work, and report the result.",
  );
  assert.equal(service.attemptDetail(attempt?.id ?? "")?.workspace?.id, `workspace:${ready.id}`);
  assert.equal(
    service.attemptDetail(attempt?.id ?? "")?.workspace?.path,
    resolve(workspaceRoot, "issue-47"),
  );
  assert.equal(service.attemptDetail(attempt?.id ?? "")?.workspace?.branch, "symphoneer/issue-47");
  await service.stop();

  const failedTask: TaskSummary = {
    ...ready,
    id: "github:icho648/fixture:48",
    identifier: "#48",
    source: {
      kind: "github",
      nativeId: "48",
      url: "https://github.com/icho648/fixture/issues/48",
    },
  };
  const failedTracker: Tracker = {
    kind: "github",
    listTasks: async () => ({
      tasks: [{ task: failedTask, versionToken: null }],
      nextCursor: null,
    }),
    getTask: async () => ({ task: failedTask, versionToken: null }),
  };
  const failedDataDir = resolve(root, "failed-data");
  const failedService = new RuntimeService({
    dataDir: failedDataDir,
    tracker: failedTracker,
    defaultOrchestration: new RealSingleAgentOrchestration({
      dataDir: failedDataDir,
      tracker: failedTracker,
      projectRoot: repository,
      workspaceRoot: resolve(root, "failed-workspaces"),
      runnerFactory: () => ({
        openWorker: async () => {
          throw new Error("deterministic_injected_worker_failure");
        },
      }),
    }),
  });
  await failedService.start();
  await failedService.refreshTracker();
  for (
    let index = 0;
    index < 300 && failedService.snapshot().attempts[0]?.finishedAt == null;
    index += 1
  ) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  const failedAttempt = failedService.snapshot().attempts[0];
  assert.equal(failedAttempt?.status, "failed");
  assert.match(failedAttempt?.failure ?? "", /deterministic_injected_worker_failure/);
  assert.equal(failedService.attemptDetail(failedAttempt?.id ?? "")?.workspace?.state, "retained");
  await failedService.stop();

  let retryReads = 0;
  const retryTracker: Tracker = {
    kind: "github",
    listTasks: async () => ({
      tasks: [{ task: failedTask, versionToken: null }],
      nextCursor: null,
    }),
    getTask: async () => {
      retryReads += 1;
      throw new Error("transient_tracker_failure");
    },
  };
  const retryNow = () => new Date("2099-08-12T10:00:00.000Z");
  const retryOrchestration = new RealSingleAgentOrchestration({
    dataDir: failedDataDir,
    tracker: retryTracker,
    projectRoot: repository,
    workspaceRoot: resolve(root, "failed-workspaces"),
    now: retryNow,
  });
  const retryService = new RuntimeService({
    dataDir: failedDataDir,
    tracker: retryTracker,
    defaultOrchestration: retryOrchestration,
    now: retryNow,
  });
  await retryService.start();
  await retryService.refreshTracker();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  assert.equal(retryReads, 1);
  await retryService.stop();

  const recoveryDataDir = resolve(root, "recovery-data");
  const recoveryWorkspaceRoot = resolve(root, "recovery-workspaces");
  const lostAttempt: AttemptSnapshot = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "attempt-lost-47",
    taskId: ready.id,
    sequence: 1,
    startReason: "dispatch",
    status: "launching_agent",
    controller: "symphoneer",
    workspaceId: `workspace:${ready.id}`,
    providerSession: null,
    startedAt: "2026-08-12T10:00:00.000Z",
    updatedAt: "2026-08-12T10:00:01.000Z",
  };
  const lostWorkspace: WorkspaceReference = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: lostAttempt.workspaceId,
    taskId: ready.id,
    path: resolve(recoveryWorkspaceRoot, "issue-47"),
    repository: "icho648/fixture",
    branch: "codex/issue-47",
    gitHead: "a".repeat(40),
    worktreeFingerprint: "b".repeat(64),
    host: "local",
    state: "ready",
    ownerAttemptId: lostAttempt.id,
  };
  const recoverySeed = new RuntimeService({ dataDir: recoveryDataDir });
  await recoverySeed.start();
  await recoverySeed.recordTask(ready);
  await recoverySeed.recordAttempt(lostAttempt, { workspace: lostWorkspace });
  await recoverySeed.stop();

  let recoveryReads = 0;
  const recoveryTracker: Tracker = {
    kind: "github",
    listTasks: async () => ({ tasks: [{ task: ready, versionToken: null }], nextCursor: null }),
    getTask: async () => {
      recoveryReads += 1;
      return { task: ready, versionToken: null };
    },
  };
  const recoveryOrchestration = new RealSingleAgentOrchestration({
    dataDir: recoveryDataDir,
    tracker: recoveryTracker,
    projectRoot: repository,
    workspaceRoot: recoveryWorkspaceRoot,
    runnerFactory: () => ({
      openWorker: async () => {
        throw new Error("blocked_task_must_not_dispatch");
      },
    }),
  });
  const recoveryService = new RuntimeService({
    dataDir: recoveryDataDir,
    tracker: recoveryTracker,
    defaultOrchestration: recoveryOrchestration,
  });
  await recoveryService.start();
  await recoveryService.refreshTracker();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  assert.equal(recoveryService.snapshot().attempts.length, 1);
  assert.equal(recoveryService.snapshot().attempts[0]?.status, "canceled_by_reconciliation");
  assert.match(recoveryService.snapshot().tasks[0]?.blocked?.reason ?? "", /Workspace/);
  assert.equal(recoveryReads, 0);
  await recoveryService.stop();

  const emptyTracker: Tracker = {
    kind: "github",
    getTask: async () => {
      throw new Error("No Task");
    },
    listTasks: async () => ({ tasks: [], nextCursor: null }),
  };
  const reloadDataDir = resolve(root, "reload-data");
  const reloadLog = resolve(root, "reload-operator.jsonl");
  const reloadOrchestration = new RealSingleAgentOrchestration({
    dataDir: reloadDataDir,
    tracker: emptyTracker,
    projectRoot: repository,
    workspaceRoot: resolve(root, "reload-workspaces"),
    operatorLogPath: reloadLog,
  });
  const reloadService = new RuntimeService({
    dataDir: reloadDataDir,
    tracker: emptyTracker,
    defaultOrchestration: reloadOrchestration,
  });
  await reloadService.start();
  await reloadService.refreshTracker();
  await writeFile(
    resolve(repository, ".symphoneer", "WORKFLOW.md"),
    "---\n- invalid\n---\nprompt\n",
  );
  await reloadService.refreshTracker();
  assert.match(await readFile(reloadLog, "utf8"), /"operation":"workflow.reload"/);
  await reloadService.stop();

  const invalidDataDir = resolve(root, "invalid-data");
  const invalidService = new RuntimeService({
    dataDir: invalidDataDir,
    tracker: emptyTracker,
    defaultOrchestration: new RealSingleAgentOrchestration({
      dataDir: invalidDataDir,
      tracker: emptyTracker,
      projectRoot: repository,
      workspaceRoot: resolve(root, "invalid-workspaces"),
    }),
  });
  await invalidService.start();
  await assert.rejects(invalidService.refreshTracker());
  await invalidService.stop();
});

test("Runtime blocks automatic continuation at max_attempts and retains the Workspace", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "symphoneer-attempt-limit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = resolve(root, "repository");
  const workspaceRoot = resolve(root, "workspaces");
  const dataDir = resolve(root, "data");
  execFileSync("git", ["init", "-b", "main", repository]);
  execFileSync("git", ["-C", repository, "config", "user.name", "Symphoneer Test"]);
  execFileSync("git", ["-C", repository, "config", "user.email", "test@example.com"]);
  await writeFile(resolve(repository, "package.json"), '{"name":"fixture","private":true}\n');
  await writeFile(
    resolve(repository, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nimporters:\n  .: {}\n",
  );
  await mkdir(resolve(repository, ".symphoneer"));
  await writeFile(
    resolve(repository, ".symphoneer", "WORKFLOW.md"),
    `---
tracker:
  kind: github
  active_states: [open]
  terminal_states: [closed]
agent:
  max_attempts: 1
  max_turns: 1
symphoneer:
  eligibility:
    required_labels: [symphoneer:ready]
workspace:
  root: ${workspaceRoot}
---
Implement {{ issue.identifier }}.
`,
  );
  execFileSync("git", ["-C", repository, "add", "."]);
  execFileSync("git", ["-C", repository, "commit", "-m", "fixture"]);

  const ready: TaskSummary = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "github:icho648/fixture:49",
    identifier: "#49",
    source: {
      kind: "github",
      nativeId: "49",
      url: "https://github.com/icho648/fixture/issues/49",
    },
    title: "Bound automatic attempts",
    state: "open",
    labels: ["symphoneer:ready"],
    dispatchable: true,
    workflowStatus: "backlog",
    blocked: null,
  };
  const tracker: Tracker = {
    kind: "github",
    listTasks: async () => ({ tasks: [{ task: ready, versionToken: null }], nextCursor: null }),
    getTask: async () => ({ task: ready, versionToken: null }),
  };
  const runner = new FakeAgentRunner([
    {
      events: [
        {
          type: "session_started",
          occurredAt: "2026-08-16T10:00:00.000Z",
          threadId: "thread-49",
          turnId: "turn-49",
          provider: {
            name: "fake",
            version: "fixture",
            schema: "fixture",
            inputFingerprint: "fixture",
          },
        },
      ],
      completion: { outcome: "completed" },
    },
  ]);
  const service = new RuntimeService({
    dataDir,
    tracker,
    defaultOrchestration: new RealSingleAgentOrchestration({
      dataDir,
      tracker,
      projectRoot: repository,
      workspaceRoot,
      runnerFactory: () => runner,
    }),
  });
  await service.start();
  await service.refreshTracker();
  for (let index = 0; index < 300 && service.snapshot().tasks[0]?.blocked == null; index += 1) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }

  assert.equal(service.snapshot().attempts.length, 1);
  assert.match(service.snapshot().tasks[0]?.blocked?.reason ?? "", /Attempt limit.*1/);
  assert.equal(
    service.attemptDetail(service.snapshot().attempts[0]?.id ?? "")?.workspace?.state,
    "retained",
  );
  assert.equal(runner.openWorkerCount, 1);
  await service.stop();
});

test("Tracker reconciliation waits for the active Turn before applying Review", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "symphoneer-turn-reconciliation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = resolve(root, "repository");
  const workspaceRoot = resolve(root, "workspaces");
  const dataDir = resolve(root, "data");
  execFileSync("git", ["init", "-b", "main", repository]);
  execFileSync("git", ["-C", repository, "config", "user.name", "Symphoneer Test"]);
  execFileSync("git", ["-C", repository, "config", "user.email", "test@example.com"]);
  await writeFile(
    resolve(repository, "package.json"),
    '{"name":"fixture","private":true,"packageManager":"pnpm@11.15.1"}\n',
  );
  await writeFile(
    resolve(repository, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n",
  );
  await mkdir(resolve(repository, ".symphoneer"));
  await writeFile(
    resolve(repository, ".symphoneer", "WORKFLOW.md"),
    `---
tracker:
  kind: github
  active_states: [open]
  terminal_states: [closed]
agent:
  max_concurrent_agents: 1
  max_turns: 2
symphoneer:
  eligibility:
    required_labels: [symphoneer:ready]
    excluded_labels: [symphoneer:review]
workspace:
  root: ${workspaceRoot}
---
Implement {{ issue.identifier }}.
`,
  );
  execFileSync("git", ["-C", repository, "add", "."]);
  execFileSync("git", ["-C", repository, "commit", "-m", "fixture"]);

  const ready: TaskSummary = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "github:icho648/fixture:47",
    identifier: "#47",
    source: {
      kind: "github",
      nativeId: "47",
      url: "https://github.com/icho648/fixture/issues/47",
    },
    title: "Review during Turn",
    state: "open",
    labels: ["symphoneer:ready"],
    dispatchable: true,
    workflowStatus: "backlog",
    blocked: null,
  };
  let trackerTask = ready;
  const tracker: Tracker = {
    kind: "github",
    listTasks: async () => ({
      tasks: [{ task: trackerTask, versionToken: null }],
      nextCursor: null,
    }),
    getTask: async () => ({ task: trackerTask, versionToken: null }),
  };
  const turnStarted = Promise.withResolvers<void>();
  const turnCompletion = Promise.withResolvers<AgentRunCompletion>();
  let interruptCount = 0;
  let closeCount = 0;
  const runner: AgentRunner = {
    async openWorker(context) {
      return {
        processIdentity: { pid: 47, toolVersion: "fake" },
        async startTurn() {
          turnStarted.resolve();
          return {
            events: {
              async *[Symbol.asyncIterator]() {
                yield {
                  type: "session_started" as const,
                  occurredAt: "2026-08-12T10:00:00.000Z",
                  threadId: "thread-47",
                  turnId: "turn-47",
                  provider: {
                    name: "fake" as const,
                    version: "fixture",
                    schema: "fixture",
                    inputFingerprint: "fixture",
                  },
                };
              },
            },
            completion: turnCompletion.promise,
            async interrupt() {
              interruptCount += 1;
            },
            async steer() {},
            async respondToIntervention() {},
          };
        },
        async readSession(threadId, capturedAt) {
          return ExecutionSessionSchema.parse({
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            attemptId: context.attemptId,
            provider: "fake",
            threadId,
            turns: [],
            capturedAt,
          });
        },
        async close() {
          closeCount += 1;
        },
      };
    },
  };
  const service = new RuntimeService({
    dataDir,
    tracker,
    defaultOrchestration: new RealSingleAgentOrchestration({
      dataDir,
      tracker,
      projectRoot: repository,
      workspaceRoot,
      runnerFactory: () => runner,
    }),
  });
  await service.start();
  await service.refreshTracker();
  await turnStarted.promise;
  for (
    let index = 0;
    index < 300 && service.snapshot().attempts[0]?.status !== "streaming_turn";
    index += 1
  ) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }

  trackerTask = { ...ready, labels: ["symphoneer:review"] };
  await service.refreshTracker();
  assert.equal(service.snapshot().attempts[0]?.status, "streaming_turn");
  assert.equal(interruptCount, 0);

  turnCompletion.resolve({ outcome: "completed" });
  for (
    let index = 0;
    index < 300 && service.snapshot().attempts[0]?.finishedAt == null;
    index += 1
  ) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  assert.equal(service.snapshot().attempts[0]?.status, "succeeded");
  assert.equal(interruptCount, 0);
  assert.equal(closeCount, 1);
  await service.stop();
});
