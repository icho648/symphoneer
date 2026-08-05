import { type ChildProcess, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const runtimeHost = process.env.SYMPHONEER_RUNTIME_HOST ?? "127.0.0.1";
const runtimePort = process.env.SYMPHONEER_RUNTIME_PORT ?? "4318";
const webHost = process.env.SYMPHONEER_WEB_HOST ?? "127.0.0.1";
const webPort = process.env.SYMPHONEER_WEB_PORT ?? "3000";
const runtimeUrl = process.env.SYMPHONEER_RUNTIME_URL ?? `http://${runtimeHost}:${runtimePort}`;
const dataDir = process.env.SYMPHONEER_DATA_DIR ?? path.join(os.tmpdir(), "symphoneer-runtime");
const canReuseRuntime = process.env.SYMPHONEER_DATA_DIR === undefined;

const children = new Map<string, ChildProcess>();
let shuttingDown = false;
let exitCode = 0;

function start(name: string, args: string[], env: NodeJS.ProcessEnv): void {
  const child = spawn(pnpm, args, {
    detached: process.platform !== "win32",
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  children.set(name, child);
  child.once("error", (error) => {
    process.stderr.write(`${name} failed to start: ${error.message}\n`);
    shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (shuttingDown) signalChild(child, "SIGKILL");
    children.delete(name);
    if (!shuttingDown) {
      const failed = code ?? (signal ? 1 : 0);
      if (failed !== 0) process.stderr.write(`${name} exited with code ${failed}\n`);
      shutdown(failed);
    } else if (children.size === 0) {
      process.exit(exitCode);
    }
  });
}

function shutdown(code: number): void {
  if (shuttingDown) {
    exitCode = Math.max(exitCode, code);
    return;
  }
  shuttingDown = true;
  exitCode = code;
  for (const child of children.values()) signalChild(child, "SIGTERM");
  const forceStop = setTimeout(() => {
    for (const child of children.values()) signalChild(child, "SIGKILL");
  }, 2_000);
  forceStop.unref();
}

function signalChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") child.kill(signal);
  }
}

export async function runtimeIsHealthy(
  url: string | URL,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(new URL("/healthz", url), {
      signal: AbortSignal.timeout(750),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as {
      schemaVersion?: unknown;
      status?: unknown;
      runtime?: { status?: unknown };
      process?: { status?: unknown };
    };
    return (
      body.schemaVersion === 2 &&
      body.status === "ok" &&
      body.runtime?.status === "online" &&
      body.process?.status === "running"
    );
  } catch {
    return false;
  }
}

export async function main(): Promise<void> {
  process.once("SIGINT", () => shutdown(0));
  process.once("SIGTERM", () => shutdown(0));

  process.stdout.write(
    [
      "Symphoneer local stack",
      `  Runtime  ${runtimeUrl}`,
      `  Web      http://${webHost}:${webPort}`,
      `  Data     ${dataDir}`,
      "  MCP      Host-spawned (`pnpm mcp:serve`); keep Runtime up, do not start MCP here",
      "",
    ].join("\n"),
  );
  if (canReuseRuntime && (await runtimeIsHealthy(runtimeUrl))) {
    process.stdout.write(`Runtime already healthy; reusing ${runtimeUrl}\n`);
  } else {
    start("Runtime", ["runtime:serve"], {
      SYMPHONEER_DATA_DIR: dataDir,
      SYMPHONEER_RUNTIME_HOST: runtimeHost,
      SYMPHONEER_RUNTIME_PORT: runtimePort,
    });
  }
  start("Web", ["run", "web:dev", "--", "--hostname", webHost, "--port", webPort], {
    SYMPHONEER_RUNTIME_URL: runtimeUrl,
  });
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Dev launcher failed"}\n`);
    process.exitCode = 1;
  });
}
