import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  CONTRACT_SCHEMA_VERSION,
  type TaskSummary,
  WorkspaceReferenceSchema,
} from "@symphoneer/contracts";
import type { AgentRunEvent, RunHandle } from "../src/runtime/executor/agent-runner.ts";
import { ClaudeCodeAdapter } from "../src/runtime/executor/claude-code/runner.ts";

const execFile = promisify(execFileCallback);

async function main(): Promise<void> {
  const directory = await mkdtemp(resolve(tmpdir(), "symphoneer-claude-smoke-"));
  let firstWorker: Awaited<ReturnType<ClaudeCodeAdapter["openWorker"]>> | undefined;
  let resumedWorker: Awaited<ReturnType<ClaudeCodeAdapter["openWorker"]>> | undefined;
  try {
    await writeFile(resolve(directory, "README.md"), "# Isolated Claude Code smoke fixture\n");
    await git(directory, "init", "-q");
    await git(directory, "config", "user.name", "Symphoneer Smoke");
    await git(directory, "config", "user.email", "smoke@symphoneer.invalid");
    await git(directory, "add", "README.md");
    await git(directory, "commit", "-qm", "Initialize smoke fixture");
    const workspaceHead = (await git(directory, "rev-parse", "HEAD")).trim();
    const task = smokeTask();
    const workspace = WorkspaceReferenceSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      id: "workspace:claude-smoke",
      taskId: task.id,
      path: directory,
      repository: "local/claude-smoke",
      branch: "smoke/claude-code",
      gitHead: workspaceHead,
      worktreeFingerprint: null,
      host: "local",
      state: "ready",
      ownerAttemptId: "attempt:claude-smoke",
    });
    const adapter = () =>
      new ClaudeCodeAdapter({
        command: process.env.SYMPHONEER_CLAUDE_COMMAND ?? "claude",
        permissionMode: "acceptEdits",
        turnTimeoutMs: 600_000,
        stallTimeoutMs: 180_000,
      });

    firstWorker = await adapter().openWorker({
      attemptId: "attempt:claude-smoke",
      task,
      workspace,
    });
    const claudeVersion = firstWorker.processIdentity.toolVersion;
    const created = await runTurn(
      await firstWorker.startTurn({
        prompt:
          "In this isolated fixture workspace, create proof.txt containing exactly one line: created. Use file tools only and do not access outside the current working directory.",
      }),
    );
    const sessionId = sessionIdFrom(created.events);
    const continued = await runTurn(
      await firstWorker.startTurn({
        prompt:
          "Append exactly one second line, continued, to proof.txt. Use file tools only and do not access outside the current working directory.",
        threadId: sessionId,
      }),
    );
    const firstSession = await firstWorker.readSession(sessionId, new Date().toISOString());
    await firstWorker.close();
    firstWorker = undefined;

    resumedWorker = await adapter().openWorker({
      attemptId: "attempt:claude-smoke",
      task,
      workspace,
      sessionId,
    });
    const resumed = await runTurn(
      await resumedWorker.startTurn({
        prompt:
          "Read proof.txt, then append exactly one third line, resumed. Use file tools only and do not access outside the current working directory.",
        threadId: sessionId,
      }),
    );
    const resumedSessionId = sessionIdFrom(resumed.events);
    const resumedSession = await resumedWorker.readSession(
      resumedSessionId,
      new Date().toISOString(),
    );
    await resumedWorker.close();
    resumedWorker = undefined;

    const proof = await readFile(resolve(directory, "proof.txt"), "utf8");
    if (proof.trim() !== "created\ncontinued\nresumed") {
      throw new Error("Claude smoke produced an unexpected fixture result");
    }
    const evidence = JSON.stringify({ firstSession, resumedSession, proof });
    assertNoCredentialBytes(evidence);
    process.stdout.write(
      `${JSON.stringify(
        {
          claudeVersion,
          sessionId,
          resumedSessionId,
          workspaceHead,
          outcomes: [
            created.completion.outcome,
            continued.completion.outcome,
            resumed.completion.outcome,
          ],
          sameSession: sessionId === resumedSessionId,
          processRestarted: true,
          credentialScan: "clean",
          proofSha256: createHash("sha256").update(proof).digest("hex"),
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await firstWorker?.close().catch(() => undefined);
    await resumedWorker?.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

async function runTurn(handle: RunHandle) {
  const events = collect(handle.events);
  const completion = await handle.completion;
  const observed = await events;
  if (completion.outcome !== "completed") {
    const providerError = observed.find(
      (event): event is Extract<AgentRunEvent, { type: "activity" }> =>
        event.type === "activity" && event.kind === "error",
    );
    throw new Error(
      `Claude smoke Turn failed: ${providerError?.content ?? completion.error ?? completion.outcome}`,
    );
  }
  return { completion, events: observed };
}

function sessionIdFrom(events: AgentRunEvent[]): string {
  const started = events.find(
    (event): event is Extract<AgentRunEvent, { type: "session_started" }> =>
      event.type === "session_started",
  );
  if (!started) throw new Error("Claude smoke did not observe a Session identity");
  return started.threadId;
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  return (await execFile("git", args, { cwd, encoding: "utf8" })).stdout;
}

function assertNoCredentialBytes(value: string): void {
  for (const [name, secret] of Object.entries(process.env)) {
    if (!/(?:key|token|secret|password|credential|authorization)/i.test(name)) continue;
    if (secret && secret.length >= 8 && value.includes(secret)) {
      throw new Error("Claude smoke evidence contained credential bytes");
    }
  }
}

function smokeTask(): TaskSummary {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "task:claude-smoke",
    identifier: "#50-smoke",
    source: {
      kind: "github",
      nativeId: "50",
      url: "https://github.com/icho648/symphoneer/issues/50",
    },
    title: "Claude Code isolated smoke",
    state: "open",
    labels: [],
    dispatchable: false,
  };
}

await main();
