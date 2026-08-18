import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";

import { CONTRACT_SCHEMA_VERSION, type TaskSummary } from "@symphoneer/contracts";
import { RuntimeService, TrackerSynchronizer } from "@symphoneer/runtime";
import { EventLog } from "../../src/runtime/service/event-log.ts";
import type { Tracker } from "../../src/runtime/tracker/tracker.ts";

const task: TaskSummary = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "github:fixtures:17",
  identifier: "#17",
  source: {
    kind: "github",
    nativeId: "17",
    url: "https://github.com/icho648/symphoneer-fixtures/issues/17",
  },
  title: "Tracker poller task",
  state: "open",
  labels: ["symphoneer:ready"],
  dispatchable: true,
};

async function dataDir(t: TestContext): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "symphoneer-poller-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("TrackerSynchronizer derives display state from current Tracker facts", async (t) => {
  const root = await dataDir(t);
  let current = task;
  let listCalls = 0;
  const tracker: Tracker = {
    kind: "github",
    getTask: async () => ({ task: current, versionToken: '"v1"' }),
    listTasks: async () => {
      listCalls += 1;
      return { tasks: [{ task: current, versionToken: `"v${listCalls}"` }], nextCursor: null };
    },
  };
  const service = new RuntimeService({
    dataDir: root,
    tracker,
  });
  await service.start();
  await service.refreshTracker();
  assert.equal(listCalls, 1);
  assert.equal(service.snapshot().tasks[0]?.displayState, "ready");

  current = { ...current, state: "closed", updatedAt: "2026-08-07T10:00:00Z" };
  const refreshed = await service.execute({
    kind: "refresh_tracker",
    idempotencyKey: "poller-refresh",
    expectedEventSequence: service.snapshot().runtime.lastEventSequence,
  });
  assert.equal(refreshed.snapshot.tasks[0]?.state, "closed");
  assert.equal(refreshed.snapshot.tasks[0]?.displayState, "done");

  await service.recordAttempt({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "attempt-17",
    taskId: task.id,
    sequence: 1,
    startReason: "dispatch",
    status: "preparing_workspace",
    controller: "symphoneer",
    workspaceId: "workspace-17",
    startedAt: "2026-08-07T10:01:00Z",
    updatedAt: "2026-08-07T10:01:00Z",
  });
  current = {
    ...current,
    labels: ["symphoneer:review"],
    dispatchable: false,
    updatedAt: "2026-08-07T10:02:00Z",
  };
  await service.refreshTracker();
  assert.equal(service.snapshot().tasks[0]?.displayState, "done");
  await service.stop();
});

test("Runtime runs one production orchestration tick after a full Tracker refresh", async (t) => {
  const root = await dataDir(t);
  const ticks: TaskSummary[][] = [];
  const tracker: Tracker = {
    kind: "github",
    getTask: async () => ({ task, versionToken: null }),
    listTasks: async () => ({ tasks: [{ task, versionToken: null }], nextCursor: null }),
  };
  const service = new RuntimeService({
    dataDir: root,
    tracker,
    defaultOrchestration: {
      start: async () => undefined,
      tick: async ({ tasks }) => {
        ticks.push([...tasks]);
      },
    },
  });
  await service.start();

  await service.refreshTracker();

  assert.deepEqual(ticks, [[task]]);
  await service.stop();
});

test("TrackerSynchronizer coalesces overlapping refreshes", async (t) => {
  const root = await dataDir(t);
  const log = new EventLog({
    dataDir: root,
    now: () => new Date("2026-08-07T10:00:00.000Z"),
    idFactory: (() => {
      let sequence = 0;
      return () => `event:${++sequence}`;
    })(),
  });
  await log.start();
  const gate = Promise.withResolvers<void>();
  let calls = 0;
  const tracker: Tracker = {
    kind: "github",
    getTask: async () => ({ task, versionToken: null }),
    listTasks: async () => {
      calls += 1;
      await gate.promise;
      return { tasks: [{ task, versionToken: null }], nextCursor: null };
    },
  };
  const synchronizer = new TrackerSynchronizer({ log, tracker });
  const first = synchronizer.refresh();
  await Promise.resolve();
  const second = synchronizer.refresh();
  assert.equal(calls, 1);
  gate.resolve();
  assert.deepEqual(await first, { taskCount: 1, pageCount: 1 });
  assert.deepEqual(await second, { taskCount: 1, pageCount: 1 });
  await synchronizer.stop();
});

test("Runtime refresh command joins an in-flight project synchronization", async (t) => {
  const root = await dataDir(t);
  const gate = Promise.withResolvers<void>();
  let calls = 0;
  const tracker: Tracker = {
    kind: "github",
    getTask: async () => ({ task, versionToken: null }),
    listTasks: async () => {
      calls += 1;
      await gate.promise;
      return { tasks: [{ task, versionToken: null }], nextCursor: null };
    },
  };
  const service = new RuntimeService({ dataDir: root, tracker });
  await service.start();
  const scheduled = service.refreshTracker();
  const manual = service.execute({
    kind: "refresh_tracker",
    idempotencyKey: "manual-refresh",
  });
  await Promise.resolve();
  assert.equal(calls, 1);
  gate.resolve();
  await scheduled;
  await manual;
  assert.equal(calls, 1);
  await service.stop();
});

test("TrackerSynchronizer disables Tasks missing from a full refresh", async (t) => {
  const root = await dataDir(t);
  const log = new EventLog({
    dataDir: root,
    now: () => new Date("2026-08-07T10:00:00.000Z"),
    idFactory: (() => {
      let sequence = 0;
      return () => `event:${++sequence}`;
    })(),
  });
  await log.start();
  let listed = true;
  const tracker: Tracker = {
    kind: "github",
    getTask: async () => ({ task, versionToken: null }),
    listTasks: async () => ({
      tasks: listed ? [{ task, versionToken: null }] : [],
      nextCursor: null,
    }),
  };
  const synchronizer = new TrackerSynchronizer({ log, tracker });
  await synchronizer.refresh();
  listed = false;
  await synchronizer.refresh();
  assert.equal(log.projection.getTask(task.id)?.dispatchable, false);
  listed = true;
  await synchronizer.refresh();
  assert.equal(log.projection.getTask(task.id)?.dispatchable, true);
  await synchronizer.stop();
});
