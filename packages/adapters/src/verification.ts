import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import {
  CONTRACT_SCHEMA_VERSION,
  type VerificationResult,
  VerificationResultSchema,
} from "@symphoneer/contracts";
import { readWorktreeFingerprint } from "./worktree-fingerprint.ts";

export class VerificationError extends Error {
  readonly code: "artifact_exists" | "invalid_workspace" | "git_failed" | "process_failed";

  constructor(code: VerificationError["code"], message: string) {
    super(message);
    this.name = "VerificationError";
    this.code = code;
  }
}

export interface VerificationRunInput {
  attemptId: string;
  checkId: string;
  argv: string[];
  cwd: string;
  workspacePath: string;
  timeoutMs: number;
}

export interface VerificationRunOutput {
  result: VerificationResult;
  artifactPath: string;
}

export class VerificationRunner {
  readonly #artifactRoot: string;
  readonly #toolVersion: string;
  readonly #now: () => Date;

  constructor(options: { artifactRoot: string; toolVersion?: string; now?: () => Date }) {
    this.#artifactRoot = resolve(options.artifactRoot);
    this.#toolVersion = options.toolVersion ?? `0.0.0+${process.version}`;
    this.#now = options.now ?? (() => new Date());
  }

  async run(input: VerificationRunInput): Promise<VerificationRunOutput> {
    if (input.argv.length === 0 || input.argv.some((argument) => argument.length === 0)) {
      throw new VerificationError("process_failed", "Verification argv must not be empty");
    }
    if (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0) {
      throw new VerificationError("process_failed", "Verification timeout must be positive");
    }
    const workspace = await realpath(input.workspacePath);
    const requestedCwd = resolve(workspace, input.cwd);
    const cwd = await realpath(requestedCwd);
    const child = relative(workspace, cwd);
    if (child.startsWith("..") || isAbsolute(child)) {
      throw new VerificationError("invalid_workspace", "Verification cwd escapes its Workspace");
    }
    const artifactRoot = await this.#artifactRootOutside(workspace);

    const gitHead = await readGitHead(workspace);
    const worktreeFingerprint = await readWorktreeFingerprint(workspace);
    const inputFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          attemptId: input.attemptId,
          checkId: input.checkId,
          argv: input.argv,
          cwd: child || ".",
          gitHead,
          worktreeFingerprint,
          toolVersion: this.#toolVersion,
        }),
      )
      .digest("hex");
    const artifactName = `${createHash("sha256")
      .update(`${input.attemptId}\0${input.checkId}\0${inputFingerprint}`)
      .digest("hex")}.json`;
    const artifactRef = `artifacts/${artifactName}`;
    const artifactPath = resolve(artifactRoot, artifactName);
    const startedAt = this.#now().toISOString();
    const execution = await execute(input.argv, cwd, input.timeoutMs);
    const finishedAt = this.#now().toISOString();
    let gitHeadAfter: string | null = null;
    let worktreeFingerprintAfter: string | null = null;
    let observationError: "git_observation_failed" | null = null;
    try {
      gitHeadAfter = await readGitHead(workspace);
      worktreeFingerprintAfter = await readWorktreeFingerprint(workspace);
    } catch {
      observationError = "git_observation_failed";
    }
    const revisionMatched =
      observationError === null &&
      gitHeadAfter === gitHead &&
      worktreeFingerprintAfter === worktreeFingerprint;
    const status = execution.timedOut
      ? "timed_out"
      : execution.exitCode === 0 && revisionMatched
        ? "passed"
        : "failed";
    const result = VerificationResultSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      id: verificationId(input.attemptId, input.checkId),
      attemptId: input.attemptId,
      checkId: input.checkId,
      status,
      argv: [basename(input.argv[0] as string), ...input.argv.slice(1).map(() => "<redacted>")],
      cwd: child || ".",
      gitHead,
      worktreeFingerprint,
      tool: { name: "symphoneer-verification", version: this.#toolVersion },
      inputFingerprint,
      startedAt,
      finishedAt,
      exitCode: execution.exitCode,
      artifactRef,
    });
    try {
      await writeFile(
        artifactPath,
        `${JSON.stringify(
          {
            ...result,
            gitHeadAfter,
            worktreeFingerprintAfter,
            revisionMatched,
            observationError,
            startFailed: execution.startFailed,
            output: {
              stdoutBytes: execution.stdoutBytes,
              stdoutSha256: execution.stdoutSha256,
              stderrBytes: execution.stderrBytes,
              stderrSha256: execution.stderrSha256,
            },
          },
          null,
          2,
        )}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new VerificationError("artifact_exists", "Verification artifact already exists");
      }
      throw error;
    }
    return { result, artifactPath };
  }

  async #artifactRootOutside(workspace: string): Promise<string> {
    const potential = await canonicalPotentialPath(this.#artifactRoot);
    assertOutsideWorkspace(workspace, potential);
    await mkdir(this.#artifactRoot, { recursive: true, mode: 0o700 });
    const actual = await realpath(this.#artifactRoot);
    assertOutsideWorkspace(workspace, actual);
    return actual;
  }
}

function verificationId(attemptId: string, checkId: string): string {
  return `verification:${encodeURIComponent(attemptId)}:${encodeURIComponent(checkId)}`;
}

interface ExecutionResult {
  exitCode: number | null;
  timedOut: boolean;
  startFailed: boolean;
  stdoutBytes: number;
  stdoutSha256: string;
  stderrBytes: number;
  stderrSha256: string;
}

function execute(argv: string[], cwd: string, timeoutMs: number): Promise<ExecutionResult> {
  return new Promise((resolvePromise) => {
    const stdoutHash = createHash("sha256");
    const stderrHash = createHash("sha256");
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;
    const processHandle = spawn(argv[0] as string, argv.slice(1), {
      cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    processHandle.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      stdoutHash.update(chunk);
    });
    processHandle.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      stderrHash.update(chunk);
    });
    const trackedPids = new Set<number>();
    let processTrackingFailed = false;
    const trackProcessTree = () => {
      const pid = processHandle.pid;
      if (pid == null) return;
      trackingPromise = trackingPromise.then(async () => {
        try {
          await trackDescendants(pid, trackedPids);
        } catch {
          processTrackingFailed = true;
        }
      });
    };
    let trackingPromise = Promise.resolve();
    trackProcessTree();
    const trackingInterval = setInterval(trackProcessTree, 10);
    const timeout = setTimeout(() => {
      timedOut = true;
      if (processHandle.pid == null) return;
      try {
        process.kill(-processHandle.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") processHandle.kill("SIGKILL");
      }
      killTrackedProcesses(trackedPids);
    }, timeoutMs);
    const finish = (exitCode: number | null, startFailed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise({
        exitCode,
        timedOut,
        startFailed,
        stdoutBytes,
        stdoutSha256: stdoutHash.digest("hex"),
        stderrBytes,
        stderrSha256: stderrHash.digest("hex"),
      });
    };
    processHandle.once("error", () => {
      clearInterval(trackingInterval);
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      resolvePromise({
        exitCode: null,
        timedOut: false,
        startFailed: true,
        stdoutBytes,
        stdoutSha256: stdoutHash.digest("hex"),
        stderrBytes,
        stderrSha256: stderrHash.digest("hex"),
      });
    });
    processHandle.once("close", (code) => {
      clearInterval(trackingInterval);
      void (async () => {
        if (settled) return;
        await trackingPromise;
        const pid = processHandle.pid;
        const descendantsExited =
          pid == null ||
          (!processTrackingFailed &&
            (await waitForTrackedProcessesExit(pid, trackedPids, timeoutMs + 1_000)));
        finish(descendantsExited ? code : null);
      })();
    });
  });
}

async function waitForTrackedProcessesExit(
  rootPid: number,
  trackedPids: Set<number>,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await trackDescendants(rootPid, trackedPids);
    } catch {
      return false;
    }
    if (!processGroupExists(rootPid) && ![...trackedPids].some(processExists)) return true;
    await delay(10);
  }
  return false;
}

// ponytail: POSIX process-table snapshots avoid a process-tree dependency; use
// OS job/cgroup isolation when verification must contain adversarial processes.
async function trackDescendants(rootPid: number, trackedPids: Set<number>): Promise<void> {
  const childrenByParent = new Map<number, number[]>();
  const output = await readProcessTable();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const parentPid = Number(match[2]);
    const children = childrenByParent.get(parentPid) ?? [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }
  const pending = [rootPid, ...trackedPids];
  const visited = new Set<number>();
  while (pending.length > 0) {
    const parentPid = pending.pop() as number;
    if (visited.has(parentPid)) continue;
    visited.add(parentPid);
    for (const childPid of childrenByParent.get(parentPid) ?? []) {
      trackedPids.add(childPid);
      pending.push(childPid);
    }
  }
}

function readProcessTable(): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "ps",
      ["-axo", "pid=,ppid="],
      { encoding: "utf8", maxBuffer: 4 * 2 ** 20 },
      (error, stdout) => {
        if (error) reject(error);
        else resolvePromise(stdout);
      },
    );
  });
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function processGroupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function killTrackedProcesses(trackedPids: Set<number>): void {
  for (const pid of trackedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may have exited between the snapshot and the kill.
    }
  }
}

function readGitHead(cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const processHandle = spawn("git", ["-C", cwd, "rev-parse", "--verify", "HEAD"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    processHandle.stdout.setEncoding("utf8");
    processHandle.stdout.on("data", (chunk: string) => {
      output += chunk;
    });
    processHandle.once("error", () =>
      reject(new VerificationError("git_failed", "Verification Git revision could not be read")),
    );
    processHandle.once("close", (code) => {
      const head = output.trim();
      if (code === 0 && head) resolvePromise(head);
      else
        reject(new VerificationError("git_failed", "Verification Git revision could not be read"));
    });
  });
}

async function canonicalPotentialPath(path: string): Promise<string> {
  const suffix: string[] = [];
  let ancestor = resolve(path);
  for (;;) {
    try {
      return resolve(await realpath(ancestor), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) return resolve(path);
      suffix.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}

function assertOutsideWorkspace(workspace: string, artifactRoot: string): void {
  const child = relative(workspace, artifactRoot);
  if (!child || (!child.startsWith("..") && !isAbsolute(child))) {
    throw new VerificationError(
      "invalid_workspace",
      "Verification artifacts must be outside the Workspace",
    );
  }
}
