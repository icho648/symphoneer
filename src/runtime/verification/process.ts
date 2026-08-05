import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const CONTAINMENT_TIMEOUT_MS = 1_000;

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
    // `detached` gives the check its own process group so descendants can be contained together.
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
    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessGroup(processHandle.pid);
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
    processHandle.once("error", () => finish(null, true));
    processHandle.once("close", (code) => {
      void (async () => {
        const contained = await containProcessGroup(processHandle.pid);
        finish(contained ? code : null);
      })();
    });
  });
}

// A check that leaves its own process group (`setsid`) is not contained here; binding such
// descendants needs OS-level isolation, which the V1 Verification boundary does not provide.
async function containProcessGroup(pid: number | undefined): Promise<boolean> {
  if (pid == null) return true;
  const deadline = Date.now() + CONTAINMENT_TIMEOUT_MS;
  while (processGroupExists(pid)) {
    if (Date.now() >= deadline) return false;
    killProcessGroup(pid);
    await delay(10);
  }
  return true;
}

function killProcessGroup(pid: number | undefined): void {
  if (pid == null) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group is already gone or cannot be signaled; the caller re-observes its state.
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
