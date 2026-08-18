import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  CONTRACT_SCHEMA_VERSION,
  type RuntimeProject,
  type TaskSummary,
} from "@symphoneer/contracts";
import { RuntimeHttpServer, RuntimeService } from "@symphoneer/runtime";

const host = "127.0.0.1";
const port = 4321;
const token = "symphoneer-e2e-session-token";
const root = await mkdtemp(resolve(tmpdir(), "symphoneer-e2e-"));
const filledProjectId = "e2e-project-filled";
const taskId = "github:fixture/symphoneer:52";
const attemptId = "attempt-e2e-52";
const verificationId = "verification-e2e-52";
const projects: RuntimeProject[] = [
  {
    id: "e2e-project-empty",
    trackerKind: "github",
    repository: "fixture/empty",
    workspaceRoot: resolve(root, "empty-workspaces"),
  },
  {
    id: filledProjectId,
    trackerKind: "github",
    repository: "fixture/symphoneer",
    workspaceRoot: resolve(root, "workspaces"),
  },
];
let eventSequence = 0;
const runtime = new RuntimeService({
  dataDir: resolve(root, "data"),
  runtimeId: "runtime:e2e",
  now: () => new Date("2026-08-18T12:00:00.000Z"),
  idFactory: () => `e2e-event-${++eventSequence}`,
});

await runtime.start();
await seedRuntime(runtime);
const server = new RuntimeHttpServer(runtime, {
  host,
  port,
  sessionToken: token,
  uiDistDir: resolve("src/web/dist"),
  projects: async () => projects,
});
await server.listen();
process.stdout.write(`E2E Runtime and Web ready at http://${host}:${port}\n`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await server.close();
  await rm(root, { recursive: true, force: true });
};
process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));

async function seedRuntime(service: RuntimeService): Promise<void> {
  const task: TaskSummary = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    projectId: filledProjectId,
    id: taskId,
    identifier: "#52",
    source: {
      kind: "github",
      nativeId: "52",
      url: "https://github.com/fixture/symphoneer/issues/52",
    },
    title: "Deterministic browser acceptance",
    body: "Verify the public Workbench flow without external credentials.",
    state: "open",
    labels: ["symphoneer:review"],
    dispatchable: false,
  };
  await service.recordTask(task);
  await service.recordAttempt(
    {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      id: attemptId,
      taskId,
      sequence: 1,
      startReason: "dispatch",
      status: "succeeded",
      controller: "symphoneer",
      workspaceId: "workspace-e2e-52",
      providerSession: {
        provider: "fake",
        threadId: "thread-e2e-52",
        lastTurnId: "turn-e2e-52",
      },
      startedAt: "2026-08-18T11:58:00.000Z",
      updatedAt: "2026-08-18T11:59:00.000Z",
      finishedAt: "2026-08-18T11:59:00.000Z",
      failure: null,
    },
    {
      workspace: {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        id: "workspace-e2e-52",
        taskId,
        path: resolve(root, "workspaces", "issue-52"),
        repository: "fixture/symphoneer",
        branch: "agent/quality-e2e-baseline",
        gitHead: "a".repeat(40),
        worktreeFingerprint: "b".repeat(64),
        host: "local",
        state: "retained",
        ownerAttemptId: null,
      },
    },
  );
  await service.recordExecutionActivity({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "activity-e2e-52",
    attemptId,
    itemId: "message-e2e-52",
    kind: "message",
    status: "completed",
    title: "Agent message",
    content: "Deterministic fixture completed.",
    details: { role: "assistant" },
    occurredAt: "2026-08-18T11:58:30.000Z",
  });
  await service.recordVerification(
    {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      id: verificationId,
      attemptId,
      checkId: "pnpm-check",
      status: "passed",
      argv: ["pnpm", "check"],
      cwd: ".",
      gitHead: "a".repeat(40),
      worktreeFingerprint: "b".repeat(64),
      tool: { name: "node", version: process.version },
      inputFingerprint: "c".repeat(64),
      startedAt: "2026-08-18T11:58:40.000Z",
      finishedAt: "2026-08-18T11:58:50.000Z",
      exitCode: 0,
      artifactRef: null,
    },
    { artifact: "pnpm check passed" },
  );
  await service.recordReview({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "review-e2e-52",
    attemptId,
    decision: "continue",
    decidedBy: "fixture-reviewer",
    decidedAt: "2026-08-18T11:59:00.000Z",
    evidenceIds: [verificationId],
    nextAction: "Keep the Draft PR open",
  });
}
