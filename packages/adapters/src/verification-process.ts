import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export interface ExecutionResult {
  exitCode: number | null;
  timedOut: boolean;
  startFailed: boolean;
  stdoutBytes: number;
  stdoutSha256: string;
  stderrBytes: number;
  stderrSha256: string;
}

export function execute(argv: string[], cwd: string, timeoutMs: number): Promise<ExecutionResult> {
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
