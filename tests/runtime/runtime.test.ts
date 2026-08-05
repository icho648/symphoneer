import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { type TestContext } from "node:test";

import {
  type AttemptSnapshot,
  CONTRACT_SCHEMA_VERSION,
  type TaskSummary,
  type VerificationResult,
  type WorkspaceReference,
} from "@symphoneer/contracts";
import {
  ImmutableArtifactStore,
  JsonlEventStore,
  RuntimeError,
  RuntimeHttpServer,
  RuntimeService,
} from "@symphoneer/runtime";

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
  const recorded = await service.recordVerification(verification, { artifact: "check output" });

  assert.equal(service.health().process.status, "running");
  assert.equal(service.health().process.pid, process.pid);
  assert.equal(service.snapshot().tasks[0]?.id, task.id);
  assert.equal(service.attemptDetail(attempt.id)?.workspace?.branch, workspace.branch);
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
  assert.equal(snapshot.verifications[0]?.status, "passed");
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

test("Runtime HTTP exposes snapshot, event history, and SSE without leaving loopback", async (t) => {
  const root = await runtimeFixture(t);
  const service = runtime(root, "runtime:http");
  await service.start();
  await service.recordTask(task);
  const server = new RuntimeHttpServer(service);
  const endpoint = await server.listen();
  t.after(() => server.close());

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

  const controller = new AbortController();
  const streamResponse = await fetch(`${endpoint.url}/v1/events/stream?after=0`, {
    signal: controller.signal,
  });
  assert.equal(streamResponse.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const reader = streamResponse.body?.getReader();
  assert.ok(reader);
  let body = "";
  for (let index = 0; index < 4 && !body.includes("event: domain"); index += 1) {
    const chunk = await reader.read();
    if (chunk.done) break;
    body += new TextDecoder().decode(chunk.value);
  }
  controller.abort();
  await reader.cancel().catch(() => undefined);
  assert.match(body, /event: snapshot/);
  assert.match(body, /event: domain/);
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
