import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";

import {
  type AttemptSnapshot,
  CONTRACT_SCHEMA_VERSION,
  type ExecutionActivity,
  type ExecutionSession,
  type TaskSummary,
  type VerificationResult,
  type WorkspaceReference,
} from "@symphoneer/contracts";
import {
  ApplicationData,
  DesktopRuntimeHost,
  ImmutableArtifactStore,
  JsonlEventStore,
  RuntimeError,
  RuntimeHttpServer,
  RuntimeService,
} from "@symphoneer/runtime";
import type { Tracker } from "../../src/runtime/tracker/tracker.ts";

const execFileAsync = promisify(execFile);

const task: TaskSummary = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "github:icho648/symphoneer:15",
  identifier: "#15",
  source: {
    kind: "github",
    nativeId: "15",
    url: "https://github.com/icho648/symphoneer/issues/15",
  },
  title: "Build the Runtime and Task Board",
  state: "open",
  labels: [],
  dispatchable: true,
  workflowStatus: "ready",
  blocked: null,
};

const workspace: WorkspaceReference = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "workspace-15",
  taskId: task.id,
  path: "/tmp/symphoneer-workspace-15",
  repository: "icho648/symphoneer",
  branch: "codex/issue-15-jsonl-runtime-web",
  gitHead: null,
  worktreeFingerprint: null,
  host: "local",
  state: "ready",
  ownerAttemptId: "attempt-15",
};

const attempt: AttemptSnapshot = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "attempt-15",
  taskId: task.id,
  sequence: 1,
  startReason: "dispatch",
  status: "preparing_workspace",
  controller: "symphoneer",
  workspaceId: workspace.id,
  providerSession: null,
  startedAt: "2026-08-04T08:00:00.000Z",
  updatedAt: "2026-08-04T08:00:01.000Z",
};

const verification: VerificationResult = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "verification-15",
  attemptId: attempt.id,
  checkId: "pnpm-check",
  status: "passed",
  argv: ["pnpm", "check"],
  cwd: ".",
  gitHead: "a".repeat(40),
  worktreeFingerprint: "b".repeat(64),
  tool: { name: "node", version: "24.0.0" },
  inputFingerprint: "c".repeat(64),
  startedAt: "2026-08-04T08:01:00.000Z",
  finishedAt: "2026-08-04T08:01:01.000Z",
  exitCode: 0,
  artifactRef: null,
};

async function runtimeFixture(t: TestContext): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "symphoneer-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function runtime(root: string, runtimeId: string): RuntimeService {
  let id = 0;
  return new RuntimeService({
    dataDir: root,
    runtimeId,
    now: () => new Date("2026-08-04T08:00:00.000Z"),
    idFactory: () => `event-${++id}`,
  });
}

test("Runtime projection replays Tasks, Attempts, Workspaces, and immutable Verification artifacts", async (t) => {
  const root = await runtimeFixture(t);
  const service = runtime(root, "runtime:test");
  await service.start();
  await service.recordTask(task);
  await service.recordAttempt(attempt, { workspace });
  const activity: ExecutionActivity = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "activity:attempt-15:message-1",
    attemptId: attempt.id,
    itemId: "message-1",
    kind: "message",
    status: "completed",
    title: "Agent message",
    content: "Implemented and verified the change.",
    details: {},
    occurredAt: "2026-08-04T08:00:30.000Z",
  };
  await service.recordExecutionActivity(activity);
  const session: ExecutionSession = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    attemptId: attempt.id,
    provider: "codex-app-server",
    threadId: "thread-15",
    turns: [
      {
        id: "turn-15",
        status: "completed",
        items: [
          {
            id: "user-15",
            type: "userMessage",
            status: null,
            data: { id: "user-15", type: "userMessage", text: "Implement #15" },
          },
        ],
      },
    ],
    capturedAt: "2026-08-04T08:00:31.000Z",
  };
  await service.recordExecutionSession(session);
  const recorded = await service.recordVerification(verification, { artifact: "check output" });

  assert.equal(service.health().process.status, "running");
  assert.equal(service.health().process.pid, process.pid);
  assert.equal(service.snapshot().tasks[0]?.id, task.id);
  assert.equal(service.attemptDetail(attempt.id)?.workspace?.branch, workspace.branch);
  assert.equal(service.attemptDetail(attempt.id)?.activities[0]?.content, activity.content);
  assert.equal(service.attemptDetail(attempt.id)?.session?.turns[0]?.items[0]?.type, "userMessage");
  assert.match(
    service.snapshot().verifications[0]?.artifactRef ?? "",
    /^artifacts\/[a-f0-9]{64}\.json$/,
  );
  assert.match(recorded.event.type, /^verification\.recorded$/);

  const artifactRef = service.snapshot().verifications[0]?.artifactRef;
  assert.ok(artifactRef);
  assert.equal(
    await new ImmutableArtifactStore(root).read(artifactRef).then((value) => value.toString()),
    "check output",
  );

  const restarted = runtime(root, "runtime:restarted");
  await restarted.start();
  const snapshot = restarted.snapshot();
  assert.equal(snapshot.tasks[0]?.identifier, "#15");
  assert.equal(snapshot.attempts[0]?.status, "preparing_workspace");
  assert.equal(restarted.attemptDetail(attempt.id)?.workspace?.path, workspace.path);
  assert.equal(restarted.attemptDetail(attempt.id)?.activities[0]?.id, activity.id);
  assert.deepEqual(restarted.attemptDetail(attempt.id)?.session, session);
  assert.equal(snapshot.verifications[0]?.status, "passed");
});

test("Runtime imports a missing Codex session once and persists the complete record", async (t) => {
  const root = await runtimeFixture(t);
  const initial = runtime(root, "runtime:activity-history-initial");
  const historicalAttempt: AttemptSnapshot = {
    ...attempt,
    providerSession: { threadId: "thread-history", lastTurnId: "turn-history" },
  };
  await initial.start();
  await initial.recordTask(task);
  await initial.recordAttempt(historicalAttempt, { workspace });
  await initial.stop();

  let reads = 0;
  const restoredSession: ExecutionSession = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    attemptId: historicalAttempt.id,
    provider: "codex-app-server",
    threadId: "thread-history",
    turns: [
      {
        id: "turn-history",
        status: "completed",
        items: [
          {
            id: "user-history",
            type: "userMessage",
            status: null,
            data: { id: "user-history", type: "userMessage", text: "Persist the session" },
          },
        ],
      },
    ],
    capturedAt: "2026-08-04T08:00:00.001Z",
  };
  const restored = new RuntimeService({
    dataDir: root,
    sessionHistory: async (candidate) => {
      reads += 1;
      assert.equal(candidate.id, historicalAttempt.id);
      return restoredSession;
    },
  });
  await restored.start();
  assert.equal(reads, 1);
  assert.equal(restored.attemptDetail(historicalAttempt.id)?.session?.turns.length, 1);
  await restored.stop();

  const replayed = runtime(root, "runtime:activity-history-replayed");
  await replayed.start();
  assert.deepEqual(replayed.attemptDetail(historicalAttempt.id)?.session, restoredSession);
});

test("Runtime commands are durable, idempotent, and do not fake Provider state", async (t) => {
  const root = await runtimeFixture(t);
  const service = runtime(root, "runtime:commands");
  await service.start();
  await service.recordTask(task);
  await service.recordAttempt(attempt, { workspace });
  const expectedEventSequence = service.snapshot().runtime.lastEventSequence;
  const command = {
    kind: "pause_attempt" as const,
    idempotencyKey: "pause-attempt-15",
    expectedEventSequence,
    expectedAttemptUpdatedAt: attempt.updatedAt,
    attemptId: attempt.id,
  };

  const accepted = await service.execute(command);
  const repeated = await service.execute(command);
  assert.equal(accepted.accepted, true);
  assert.equal(repeated.eventSequence, accepted.eventSequence);
  assert.equal(accepted.snapshot.attempts[0]?.status, "preparing_workspace");
  assert.equal(accepted.snapshot.runtime.lastEventSequence, expectedEventSequence + 1);
});

test("DesktopRuntimeHost keeps one isolated Symphony runtime per project", async (t) => {
  const root = await runtimeFixture(t);
  const alphaRoot = resolve(root, "repositories", "alpha");
  const bravoRoot = resolve(root, "repositories", "bravo");
  await initializeRepository(alphaRoot);
  await initializeRepository(bravoRoot);
  const projectTask = (project: string, nativeId: string): TaskSummary => ({
    ...task,
    id: `github:${project}:${nativeId}`,
    identifier: `#${nativeId}`,
    source: {
      kind: "github",
      nativeId,
      url: `https://github.com/${project}/issues/${nativeId}`,
    },
    title: `${project} task`,
  });
  const taskA = projectTask("alpha/repo", "1");
  const taskB = projectTask("bravo/repo", "2");
  let projectACalls = 0;
  let projectBCalls = 0;
  let activePolls = 0;
  let peakPolls = 0;
  const tracker = (current: TaskSummary, count: () => void): Tracker => ({
    kind: "github",
    getTask: async () => ({ task: current, versionToken: null }),
    listTasks: async () => {
      count();
      activePolls += 1;
      peakPolls = Math.max(peakPolls, activePolls);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activePolls -= 1;
      return { tasks: [{ task: current, versionToken: null }], nextCursor: null };
    },
  });
  let allocated = 0;
  const applicationData = new ApplicationData({
    dataDir: resolve(root, "data"),
    cacheDir: resolve(root, "cache"),
    logDir: resolve(root, "logs"),
    workspaceRoot: resolve(root, "workspaces"),
    idFactory: () => `project-${++allocated}`,
  });
  await applicationData.registerProject({
    trackerKind: "github",
    repository: "alpha/repo",
    projectRoot: alphaRoot,
  });
  const service = new DesktopRuntimeHost({
    applicationData,
    createRuntime: ({ project, layout }) => ({
      runtime: new RuntimeService({
        dataDir: layout.root,
        tracker:
          project.repository === "alpha/repo"
            ? tracker(taskA, () => projectACalls++)
            : tracker(taskB, () => projectBCalls++),
      }),
      pollingIntervalMs: 1_000,
    }),
  });

  await service.start();
  assert.equal(projectACalls, 1);
  assert.deepEqual(
    service.snapshot().tasks.map((candidate) => candidate.id),
    [taskA.id],
  );

  const bravo = await service.addProject({
    trackerKind: "github",
    repository: "bravo/repo",
    projectRoot: bravoRoot,
  });
  assert.equal(projectBCalls, 1);
  assert.deepEqual(
    service.snapshot().tasks.map((candidate) => [candidate.projectId, candidate.id]),
    [
      ["project-1", taskA.id],
      [bravo.id, taskB.id],
    ],
  );
  assert.notEqual(
    applicationData.project("project-1").root,
    applicationData.project(bravo.id).root,
  );

  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.equal(projectACalls, 2);
  assert.equal(projectBCalls, 2);
  assert.equal(peakPolls, 1);

  await service.removeProject("project-1");
  assert.deepEqual(
    service.snapshot().tasks.map((candidate) => candidate.id),
    [taskB.id],
  );
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  assert.equal(projectACalls, 2);
  assert.equal(projectBCalls, 3);
  await service.stop();

  const restarted = new DesktopRuntimeHost({
    applicationData: new ApplicationData({
      dataDir: resolve(root, "data"),
      cacheDir: resolve(root, "cache"),
      logDir: resolve(root, "logs"),
      workspaceRoot: resolve(root, "workspaces"),
    }),
    createRuntime: ({ layout }) => ({ runtime: new RuntimeService({ dataDir: layout.root }) }),
  });
  await restarted.start();
  assert.deepEqual(
    (await restarted.listProjects()).map((project) => project.id),
    [bravo.id],
  );
  assert.deepEqual(
    restarted.snapshot().tasks.map((candidate) => candidate.id),
    [taskB.id],
  );
  await restarted.stop();
});

test("Runtime records a human ReviewDecision through the public command", async (t) => {
  const root = await runtimeFixture(t);
  const service = runtime(root, "runtime:review-command");
  await service.start();
  await service.recordTask({ ...task, workflowStatus: "in_review" });
  const reviewedAttempt: AttemptSnapshot = {
    ...attempt,
    status: "succeeded",
    finishedAt: attempt.updatedAt,
  };
  await service.recordAttempt(reviewedAttempt);
  const command = {
    kind: "record_review" as const,
    idempotencyKey: "review-command-15",
    expectedEventSequence: service.snapshot().runtime.lastEventSequence,
    expectedAttemptUpdatedAt: reviewedAttempt.updatedAt,
    attemptId: attempt.id,
    decision: "merge_close" as const,
    decidedBy: "human",
    evidenceIds: ["verification:attempt-15:pnpm-check"],
    nextAction: null,
  };

  const accepted = await service.execute(command);
  const repeated = await service.execute(command);

  assert.equal(accepted.accepted, true);
  assert.equal(accepted.snapshot.reviews[0]?.decision, "merge_close");
  assert.equal(accepted.snapshot.reviews[0]?.evidenceIds[0], command.evidenceIds[0]);
  assert.equal(repeated.eventSequence, accepted.eventSequence);
});

test("Runtime routes and persists an intervention answer by its global identity", async (t) => {
  const root = await runtimeFixture(t);
  const responses: unknown[] = [];
  const service = new RuntimeService({
    dataDir: root,
    defaultOrchestration: {
      async start() {},
      async respond(input) {
        responses.push(input);
      },
    },
  });
  await service.start();
  await service.recordTask(task);
  await service.recordAttempt(attempt);
  await service.recordIntervention({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "intervention-15",
    attemptId: attempt.id,
    requestRef: "number:1",
    kind: "input",
    state: "pending",
    prompt: "Which scope should be used?",
    createdAt: attempt.updatedAt,
    resolution: null,
  });

  const accepted = await service.execute({
    kind: "respond_intervention",
    idempotencyKey: "intervention-answer-15",
    expectedEventSequence: service.snapshot().runtime.lastEventSequence,
    interventionId: "intervention-15",
    decidedBy: "local-human",
    decision: "answered",
    response: "Only src/**",
  });

  assert.deepEqual(responses, [
    {
      interventionId: "intervention-15",
      requestRef: "number:1",
      decision: { decision: "answered", response: "Only src/**" },
    },
  ]);
  assert.equal(accepted.snapshot.interventions[0]?.resolution?.response, "Only src/**");
});

test("Runtime persists the local WorkflowStatus through an idempotent public command", async (t) => {
  const root = await runtimeFixture(t);
  const service = runtime(root, "runtime:workflow-status");
  await service.start();
  await service.recordTask(task);

  const command = {
    kind: "set_task_status" as const,
    idempotencyKey: "task-status-ready-15",
    expectedEventSequence: service.snapshot().runtime.lastEventSequence,
    taskId: task.id,
    workflowStatus: "ready" as const,
  };
  const accepted = await service.execute(command);
  const repeated = await service.execute(command);

  assert.equal(accepted.snapshot.tasks[0]?.workflowStatus, "ready");
  assert.equal(accepted.snapshot.tasks[0]?.blocked, null);
  assert.equal(repeated.eventSequence, accepted.eventSequence);

  const restarted = runtime(root, "runtime:workflow-status-restarted");
  await restarted.start();
  assert.equal(restarted.snapshot().tasks[0]?.workflowStatus, "ready");
});

test("Runtime enables dispatch through the Tracker and immediately updates its projection", async (t) => {
  const root = await runtimeFixture(t);
  const blockedTask = {
    ...task,
    labels: [],
    dispatchable: false,
    workflowStatus: "backlog" as const,
  };
  let enableCalls = 0;
  const tracker: Tracker = {
    kind: "fake",
    getTask: async () => ({ task: blockedTask, versionToken: '"task-v1"' }),
    enableTaskDispatch: async () => {
      enableCalls += 1;
      return {
        task: { ...blockedTask, labels: ["symphoneer:ready"], dispatchable: true },
        versionToken: '"task-v2"',
      };
    },
  };
  const service = new RuntimeService({ dataDir: root, tracker });
  await service.start();
  await service.recordTask(blockedTask);

  const command = {
    kind: "enable_task_dispatch" as const,
    taskId: blockedTask.id,
    idempotencyKey: "enable-task-dispatch-15",
  };
  const accepted = await service.execute(command);
  const repeated = await service.execute(command);

  assert.equal(enableCalls, 1);
  assert.equal(accepted.snapshot.tasks[0]?.dispatchable, true);
  assert.deepEqual(accepted.snapshot.tasks[0]?.labels, ["symphoneer:ready"]);
  assert.equal(repeated.eventSequence, accepted.eventSequence);
});

test("Runtime projects the complete WorkflowStatus lifecycle and preserves blocked markers", async (t) => {
  const root = await runtimeFixture(t);
  const service = runtime(root, "runtime:workflow-lifecycle");
  await service.start();
  await service.recordTask({ ...task, workflowStatus: "backlog" });
  await service.recordAttempt(attempt);
  assert.equal(service.snapshot().tasks[0]?.workflowStatus, "in_progress");

  await service.recordVerification(verification, { artifact: "passed" });
  assert.equal(service.snapshot().tasks[0]?.workflowStatus, "in_progress");

  const succeededAttempt: AttemptSnapshot = {
    ...attempt,
    status: "succeeded",
    updatedAt: "2026-08-04T08:01:02.000Z",
    finishedAt: "2026-08-04T08:01:02.000Z",
    failure: null,
  };
  await service.recordAttempt(succeededAttempt);
  assert.equal(service.snapshot().tasks[0]?.workflowStatus, "in_review");

  await service.execute({
    kind: "record_review",
    idempotencyKey: "review-lifecycle-15",
    expectedEventSequence: service.snapshot().runtime.lastEventSequence,
    expectedAttemptUpdatedAt: succeededAttempt.updatedAt,
    attemptId: attempt.id,
    decision: "merge_close",
    decidedBy: "local-human",
    evidenceIds: [verification.id],
    nextAction: null,
  });
  assert.equal(service.snapshot().tasks[0]?.workflowStatus, "done");

  const failed = {
    ...attempt,
    status: "failed" as const,
    updatedAt: "2026-08-04T08:01:03.000Z",
    finishedAt: "2026-08-04T08:01:03.000Z",
    failure: "timeout",
  };
  await service.recordAttempt(failed);
  assert.equal(service.snapshot().tasks[0]?.workflowStatus, "done");
  assert.equal(service.snapshot().tasks[0]?.blocked?.reason, "timeout");
});

test("Runtime delegates Codex handoff and deletes an Attempt only after orchestration cleanup", async (t) => {
  const root = await runtimeFixture(t);
  const operations: string[] = [];
  const service = new RuntimeService({
    dataDir: root,
    runtimeId: "runtime:attempt-lifecycle",
    defaultOrchestration: {
      start: async () => undefined,
      handoff: async ({ attempt: current }) => {
        operations.push(`handoff:${current.id}`);
      },
      delete: async ({ attempt: current }) => {
        operations.push(`delete:${current.id}`);
      },
    },
  });
  await service.start();
  await service.recordTask(task);
  const handoffAttempt: AttemptSnapshot = {
    ...attempt,
    status: "succeeded",
    providerSession: { threadId: "thread-15", lastTurnId: "turn-15" },
    finishedAt: attempt.updatedAt,
  };
  await service.recordAttempt(handoffAttempt, { workspace });

  const handedOff = await service.execute({
    kind: "handoff_attempt",
    idempotencyKey: "handoff-attempt-15",
    expectedEventSequence: service.snapshot().runtime.lastEventSequence,
    expectedAttemptUpdatedAt: handoffAttempt.updatedAt,
    attemptId: attempt.id,
  });
  const deleted = await service.execute({
    kind: "delete_attempt",
    idempotencyKey: "delete-attempt-15",
    expectedEventSequence: service.snapshot().runtime.lastEventSequence,
    expectedAttemptUpdatedAt: handedOff.snapshot.attempts[0]?.updatedAt,
    attemptId: attempt.id,
    confirmDiscard: true,
  });

  assert.deepEqual(operations, [`handoff:${attempt.id}`, `delete:${attempt.id}`]);
  assert.equal(
    deleted.snapshot.attempts.some((item) => item.id === attempt.id),
    false,
  );
  assert.equal(service.attemptDetail(attempt.id), null);
});

test("Runtime hides Codex control and resumes input only after the external Turn is idle", async (t) => {
  const root = await runtimeFixture(t);
  const operations: string[] = [];
  let inputSettings: unknown;
  let turnStatus = "inProgress";
  let capturedAt = "2026-08-04T08:03:00.000Z";
  const session = (): ExecutionSession => ({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    attemptId: attempt.id,
    provider: "codex-app-server",
    threadId: "thread-15",
    turns: [{ id: "turn-15", status: turnStatus, items: [] }],
    capturedAt,
  });
  const service = new RuntimeService({
    dataDir: root,
    runtimeId: "runtime:codex-control",
    defaultOrchestration: {
      start: async () => undefined,
      input: async ({ effort, model, prompt, sandbox }) => {
        operations.push(`input:${prompt}`);
        inputSettings = { effort, model, sandbox };
      },
      handoff: async () => {
        operations.push("handoff");
      },
      sync: async () => {
        operations.push(`sync:${turnStatus}`);
        return session();
      },
    },
  });
  await service.start();
  await service.recordTask(task);
  const paused: AttemptSnapshot = {
    ...attempt,
    status: "paused",
    providerSession: { threadId: "thread-15", lastTurnId: "turn-15" },
    updatedAt: "2026-08-04T08:02:00.000Z",
  };
  await service.recordAttempt(paused, {
    workspace: { ...workspace, state: "retained", ownerAttemptId: null },
  });

  const handedOff = await service.execute({
    kind: "handoff_attempt",
    attemptId: paused.id,
    idempotencyKey: "handoff-control-attempt-15",
    expectedEventSequence: service.snapshot().runtime.lastEventSequence,
    expectedAttemptUpdatedAt: paused.updatedAt,
  });
  assert.equal(handedOff.snapshot.attempts[0]?.controller, "codex");

  await assert.rejects(
    service.execute({
      kind: "send_attempt_input",
      attemptId: paused.id,
      prompt: "Focus on the failing test.",
      idempotencyKey: "input-busy-attempt-15",
      expectedEventSequence: handedOff.snapshot.runtime.lastEventSequence,
      expectedAttemptUpdatedAt: handedOff.snapshot.attempts[0]?.updatedAt,
    }),
    /Codex is still processing this Attempt/,
  );

  turnStatus = "completed";
  capturedAt = "2026-08-04T08:03:01.000Z";
  const resumed = await service.execute({
    kind: "send_attempt_input",
    attemptId: paused.id,
    prompt: "Focus on the failing test.",
    model: "gpt-5.6-codex",
    sandbox: "workspace-write",
    effort: "high",
    idempotencyKey: "input-idle-attempt-15",
    expectedEventSequence: service.snapshot().runtime.lastEventSequence,
    expectedAttemptUpdatedAt: handedOff.snapshot.attempts[0]?.updatedAt,
  });

  assert.deepEqual(operations, [
    "handoff",
    "sync:inProgress",
    "sync:completed",
    "input:Focus on the failing test.",
  ]);
  assert.equal(resumed.snapshot.attempts[0]?.controller, "symphoneer");
  assert.deepEqual(inputSettings, {
    effort: "high",
    model: "gpt-5.6-codex",
    sandbox: "workspace-write",
  });
  assert.deepEqual(service.attemptDetail(paused.id)?.session, session());
});

test("Runtime blocks timed-out Attempts without changing their WorkflowStatus", async (t) => {
  const root = await runtimeFixture(t);
  const service = runtime(root, "runtime:workflow-timeout");
  await service.start();
  await service.recordTask(task);
  await service.recordAttempt(attempt);
  const timedOut = {
    ...attempt,
    status: "timed_out" as const,
    updatedAt: "2026-08-04T08:01:04.000Z",
    finishedAt: "2026-08-04T08:01:04.000Z",
    failure: "agent timeout",
  };
  await service.recordAttempt(timedOut);
  assert.equal(service.snapshot().tasks[0]?.workflowStatus, "in_progress");
  assert.equal(service.snapshot().tasks[0]?.blocked?.reason, "agent timeout");
});

test("Runtime starts the default orchestration mode from the public workflow command", async (t) => {
  const root = await runtimeFixture(t);
  const startedTasks: TaskSummary[] = [];
  const service = new RuntimeService({
    dataDir: root,
    runtimeId: "runtime:default-orchestration",
    defaultOrchestration: {
      start: async ({ task: requestedTask }) => {
        startedTasks.push(requestedTask);
      },
    },
  });
  await service.start();
  const backlogTask = { ...task, workflowStatus: "backlog" as const };
  await service.recordTask(backlogTask);

  const accepted = await service.execute({
    kind: "start_run",
    mode: "single-agent",
    idempotencyKey: "start-orchestration-15",
    expectedEventSequence: service.snapshot().runtime.lastEventSequence,
    task: backlogTask,
  });

  assert.equal(accepted.accepted, true);
  assert.equal(startedTasks[0]?.id, backlogTask.id);
  assert.equal(accepted.snapshot.runtime.lastEventSequence, 2);
});

test("Runtime commands serialize optimistic concurrency for the same snapshot", async (t) => {
  const root = await runtimeFixture(t);
  const service = runtime(root, "runtime:command-race");
  await service.start();
  await service.recordTask(task);
  await service.recordAttempt(attempt, { workspace });
  const expectedEventSequence = service.snapshot().runtime.lastEventSequence;
  const base = {
    kind: "pause_attempt" as const,
    expectedEventSequence,
    expectedAttemptUpdatedAt: attempt.updatedAt,
    attemptId: attempt.id,
  };

  const results = await Promise.allSettled([
    service.execute({ ...base, idempotencyKey: "pause-race-a" }),
    service.execute({ ...base, idempotencyKey: "pause-race-b" }),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(service.snapshot().runtime.lastEventSequence, expectedEventSequence + 1);
  assert.match(
    String(rejected[0]?.status === "rejected" ? rejected[0].reason : ""),
    /projection changed/i,
  );
});

test("Runtime accepts retry on finished Attempts but rejects pause", async (t) => {
  const root = await runtimeFixture(t);
  const service = runtime(root, "runtime:retry-finished");
  await service.start();
  await service.recordTask(task);
  const finishedAttempt: AttemptSnapshot = {
    ...attempt,
    status: "failed",
    finishedAt: "2026-08-04T08:02:00.000Z",
    updatedAt: "2026-08-04T08:02:00.000Z",
  };
  await service.recordAttempt(finishedAttempt, { workspace });
  const expectedEventSequence = service.snapshot().runtime.lastEventSequence;

  await assert.rejects(
    service.execute({
      kind: "pause_attempt",
      idempotencyKey: "pause-finished",
      expectedEventSequence,
      expectedAttemptUpdatedAt: finishedAttempt.updatedAt,
      attemptId: finishedAttempt.id,
    }),
    (error) => error instanceof RuntimeError && error.code === "conflict",
  );

  const retried = await service.execute({
    kind: "retry_attempt",
    idempotencyKey: "retry-finished",
    expectedEventSequence,
    expectedAttemptUpdatedAt: finishedAttempt.updatedAt,
    attemptId: finishedAttempt.id,
  });
  assert.equal(retried.accepted, true);
  assert.equal(retried.snapshot.runtime.lastEventSequence, expectedEventSequence + 1);

  await service.recordAttempt({
    ...attempt,
    id: "attempt-active",
    sequence: 2,
    workspaceId: "workspace-active",
    updatedAt: "2026-08-04T08:03:00.000Z",
  });
  await assert.rejects(
    service.execute({
      kind: "retry_attempt",
      idempotencyKey: "retry-while-active",
      expectedEventSequence: service.snapshot().runtime.lastEventSequence,
      expectedAttemptUpdatedAt: finishedAttempt.updatedAt,
      attemptId: finishedAttempt.id,
    }),
    (error) => error instanceof RuntimeError && error.code === "conflict",
  );
});

test("Runtime HTTP exposes snapshot, event history, and SSE without leaving loopback", async (t) => {
  const root = await runtimeFixture(t);
  const service = runtime(root, "runtime:http");
  await service.start();
  await service.recordTask(task);
  const server = new RuntimeHttpServer(service);
  const endpoint = await server.listen();

  const health = await fetch(`${endpoint.url}/healthz`);
  assert.equal(health.status, 200);
  const healthBody = (await health.json()) as {
    status: string;
    process: { status: string; pid: number };
  };
  assert.equal(healthBody.status, "ok");
  assert.equal(healthBody.process.status, "running");
  assert.equal(healthBody.process.pid, process.pid);

  const history = await fetch(`${endpoint.url}/v1/events?after=0`);
  assert.equal((await history.json()).events.length, 1);

  const streamResponse = await fetch(`${endpoint.url}/v1/events/stream?after=0`);
  assert.equal(streamResponse.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const reader = streamResponse.body?.getReader();
  assert.ok(reader);
  let body = "";
  for (let index = 0; index < 4 && !body.includes("event: domain"); index += 1) {
    const chunk = await reader.read();
    if (chunk.done) break;
    body += new TextDecoder().decode(chunk.value);
  }
  assert.match(body, /event: snapshot/);
  assert.match(body, /event: domain/);

  // Close must finish even while the SSE response is still open; otherwise `pnpm check` hangs.
  await Promise.race([
    server.close(),
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error("RuntimeHttpServer.close hung with an open SSE client")),
        1_000,
      );
    }),
  ]);
  await reader.cancel().catch(() => undefined);
});

test("JSONL replay fails closed for corrupt and unknown records", async (t) => {
  const corruptRoot = await runtimeFixture(t);
  const eventPath = resolve(corruptRoot, "events/domain-events.jsonl");
  await mkdir(resolve(corruptRoot, "events"), { recursive: true });
  await writeFile(eventPath, "not-json\n");
  await assert.rejects(
    new JsonlEventStore(corruptRoot).replay(),
    (error) => error instanceof RuntimeError && error.code === "corrupt_event",
  );

  const unknownRoot = await runtimeFixture(t);
  const unknownPath = resolve(unknownRoot, "events/domain-events.jsonl");
  await mkdir(resolve(unknownRoot, "events"), { recursive: true });
  await appendFile(
    unknownPath,
    `${JSON.stringify({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      id: "future-event",
      type: "future.event",
      source: "runtime",
      occurredAt: "2026-08-04T08:00:00.000Z",
      aggregate: { kind: "task", id: task.id },
      payload: {},
    })}\n`,
  );
  await assert.rejects(
    new JsonlEventStore(unknownRoot).replay(),
    (error) => error instanceof RuntimeError && error.code === "unknown_event",
  );
});

async function initializeRepository(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
  await execFileAsync("git", ["-C", path, "init", "--initial-branch=main"]);
  await execFileAsync("git", ["-C", path, "config", "user.name", "Symphoneer Test"]);
  await execFileAsync("git", ["-C", path, "config", "user.email", "test@symphoneer.local"]);
  await execFileAsync("git", ["-C", path, "commit", "--allow-empty", "-m", "Initial"]);
}
