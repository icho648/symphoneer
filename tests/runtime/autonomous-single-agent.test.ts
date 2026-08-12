import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { CONTRACT_SCHEMA_VERSION, type TaskSummary } from "@symphoneer/contracts";
import { RealSingleAgentOrchestration, RuntimeService, type Tracker } from "@symphoneer/runtime";
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
  await writeFile(
    resolve(repository, "WORKFLOW.md"),
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
Implement {{ issue.identifier }} and follow its acceptance criteria.
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
    index < 100 && service.snapshot().attempts[0]?.finishedAt == null;
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
  assert.equal(runner.requests[0]?.threadId, undefined);
  assert.equal(runner.requests[1]?.threadId, "thread-47");
  assert.equal(service.attemptDetail(attempt?.id ?? "")?.workspace?.id, `workspace:${ready.id}`);
  assert.equal(
    service.attemptDetail(attempt?.id ?? "")?.workspace?.path,
    resolve(workspaceRoot, "issue-47"),
  );
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
    index < 100 && failedService.snapshot().attempts[0]?.finishedAt == null;
    index += 1
  ) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  const failedAttempt = failedService.snapshot().attempts[0];
  assert.equal(failedAttempt?.status, "failed");
  assert.match(failedAttempt?.failure ?? "", /deterministic_injected_worker_failure/);
  assert.equal(failedService.attemptDetail(failedAttempt?.id ?? "")?.workspace?.state, "retained");
  await failedService.stop();

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
  await writeFile(resolve(repository, "WORKFLOW.md"), "---\n- invalid\n---\nprompt\n");
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
