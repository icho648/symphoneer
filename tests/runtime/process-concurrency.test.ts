import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { CONTRACT_SCHEMA_VERSION, type TaskSummary } from "@symphoneer/contracts";
import {
  type AgentRunCompletion,
  type AgentRunner,
  ApplicationData,
  DesktopRuntimeHost,
  RealSingleAgentOrchestration,
  RuntimeService,
  type Tracker,
} from "@symphoneer/runtime";

test("Desktop Runtime enforces one process execution slot across projects", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "symphoneer-process-capacity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const applicationData = new ApplicationData({
    dataDir: resolve(root, "data"),
    cacheDir: resolve(root, "cache"),
    logDir: resolve(root, "logs"),
    workspaceRoot: resolve(root, "workspaces"),
    idFactory: (() => {
      let sequence = 0;
      return () => `project-${++sequence}`;
    })(),
  });
  const controls = new Map<string, ReturnType<typeof Promise.withResolvers<AgentRunCompletion>>>();
  const started: string[] = [];
  const projects = [
    await createProject(applicationData, root, "alpha", 61),
    await createProject(applicationData, root, "bravo", 62),
  ];
  const host = new DesktopRuntimeHost({
    applicationData,
    maxConcurrentAgents: 1,
    createRuntime: ({ project, layout, executionCapacity }) => {
      const fixture = projects.find((candidate) => candidate.project.id === project.id);
      assert.ok(fixture);
      assert.ok(project.projectRoot);
      const orchestration = new RealSingleAgentOrchestration({
        dataDir: layout.root,
        tracker: fixture.tracker,
        projectRoot: project.projectRoot,
        workspaceRoot: project.workspaceRoot,
        executionCapacity,
        runnerFactory: () => controlledRunner(fixture.task.id, started, controls),
      });
      return {
        runtime: new RuntimeService({
          dataDir: layout.root,
          tracker: fixture.tracker,
          defaultOrchestration: orchestration,
        }),
        pollingIntervalMs: 60_000,
      };
    },
  });

  await host.start();
  t.after(() => host.stop());
  await waitFor(() => host.snapshot().tasks.length === 2);
  await waitFor(() => started.length > 0);

  assert.equal(started.length, 1);
  assert.equal(host.snapshot().tasks.filter((task) => task.executionState !== "idle").length, 1);
  const firstTaskId = started[0] as string;
  projects.find((fixture) => fixture.task.id === firstTaskId)?.markReview();
  controls.get(firstTaskId)?.resolve({ outcome: "completed" });
  await waitFor(() =>
    host
      .snapshot()
      .attempts.some((attempt) => attempt.taskId === firstTaskId && attempt.status === "succeeded"),
  );

  const second = host.snapshot().tasks.find((task) => task.id !== firstTaskId);
  assert.ok(second?.projectId);
  await host.execute({
    kind: "refresh_tracker",
    projectId: second.projectId,
    idempotencyKey: "refresh-second-project-after-capacity-release",
    expectedEventSequence: host.snapshot().runtime.lastEventSequence,
  });
  await waitFor(() => started.length === 2);
  assert.equal(started[1], second.id);
  projects.find((fixture) => fixture.task.id === second.id)?.markReview();
  controls.get(second.id)?.resolve({ outcome: "completed" });
  await waitFor(() =>
    host
      .snapshot()
      .attempts.some((attempt) => attempt.taskId === second.id && attempt.status === "succeeded"),
  );
});

async function createProject(
  applicationData: ApplicationData,
  root: string,
  name: string,
  issueNumber: number,
) {
  const projectRoot = resolve(root, name);
  await mkdir(resolve(projectRoot, ".symphoneer"), { recursive: true });
  await writeFile(
    resolve(projectRoot, "package.json"),
    `{"name":"${name}","private":true,"packageManager":"pnpm@11.15.1"}\n`,
  );
  await writeFile(
    resolve(projectRoot, "pnpm-lock.yaml"),
    "lockfileVersion: '9.0'\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\nimporters:\n  .: {}\n",
  );
  await writeFile(
    resolve(projectRoot, ".symphoneer", "WORKFLOW.md"),
    `---\ntracker:\n  kind: github\n  active_states: [open]\n  terminal_states: [closed]\nagent:\n  max_concurrent_agents: 2\n  max_turns: 1\nsymphoneer:\n  eligibility:\n    required_labels: [symphoneer:ready]\n    excluded_labels: [symphoneer:review]\n---\nImplement {{ issue.identifier }}.\n`,
  );
  execFileSync("git", ["init", "-b", "main", projectRoot]);
  execFileSync("git", ["-C", projectRoot, "config", "user.name", "Symphoneer Test"]);
  execFileSync("git", ["-C", projectRoot, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", projectRoot, "add", "."]);
  execFileSync("git", ["-C", projectRoot, "commit", "-m", "fixture"]);
  const repository = `example/${name}`;
  const project = await applicationData.registerProject({
    trackerKind: "github",
    repository,
    projectRoot,
  });
  let task: TaskSummary = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: `github:${repository}:${issueNumber}`,
    identifier: `#${issueNumber}`,
    source: {
      kind: "github",
      nativeId: String(issueNumber),
      url: `https://github.com/${repository}/issues/${issueNumber}`,
    },
    title: `Process capacity ${name}`,
    state: "open",
    labels: ["symphoneer:ready"],
    dispatchable: true,
  };
  const tracker: Tracker = {
    kind: "github",
    listTasks: async () => ({ tasks: [{ task, versionToken: null }], nextCursor: null }),
    getTask: async () => ({ task, versionToken: null }),
  };
  return {
    project,
    get task() {
      return task;
    },
    tracker,
    markReview() {
      task = { ...task, labels: ["symphoneer:review"], dispatchable: false };
    },
  };
}

function controlledRunner(
  taskId: string,
  started: string[],
  controls: Map<string, ReturnType<typeof Promise.withResolvers<AgentRunCompletion>>>,
): AgentRunner {
  return {
    async openWorker() {
      return {
        processIdentity: { pid: 1, toolVersion: "fixture" },
        async startTurn() {
          const completion = Promise.withResolvers<AgentRunCompletion>();
          controls.set(taskId, completion);
          started.push(taskId);
          return {
            events: {
              async *[Symbol.asyncIterator]() {
                yield {
                  type: "session_started" as const,
                  occurredAt: "2026-08-18T10:00:00.000Z",
                  threadId: `thread-${taskId}`,
                  turnId: `turn-${taskId}`,
                  provider: {
                    name: "fake" as const,
                    version: "fixture",
                    schema: "fixture",
                    inputFingerprint: "fixture",
                  },
                };
              },
            },
            completion: completion.promise,
            async interrupt() {},
            async steer() {},
            async respondToIntervention() {},
          };
        },
        async readSession() {
          return null;
        },
        async close() {},
      };
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for runtime state");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}
