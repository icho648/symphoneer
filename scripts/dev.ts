import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const runtimeHost = process.env.SYMPHONEER_RUNTIME_HOST ?? "127.0.0.1";
const runtimePort = process.env.SYMPHONEER_RUNTIME_PORT ?? "4318";
const webHost = process.env.SYMPHONEER_WEB_HOST ?? "127.0.0.1";
const webPort = process.env.SYMPHONEER_WEB_PORT ?? "3000";
const runtimeUrl = process.env.SYMPHONEER_RUNTIME_URL ?? `http://${runtimeHost}:${runtimePort}`;
const dataDir =
  process.env.SYMPHONEER_DATA_DIR ??
  (process.platform === "darwin"
    ? path.join(os.homedir(), "Library", "Application Support", "Symphoneer", "Development")
    : path.join(os.homedir(), ".symphoneer", "development"));
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

/** Discover the token Runtime persisted under `dataDir/runtime-token`. */
export async function readStoredRuntimeToken(
  dir: string,
  reader: (filePath: string, encoding: "utf8") => Promise<string> = (filePath, encoding) =>
    readFile(filePath, encoding),
): Promise<string | undefined> {
  try {
    const token = (await reader(path.join(dir, "runtime-token"), "utf8")).trim();
    return token.length >= 16 ? token : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the session token for the local stack.
 * When reusing a healthy Runtime, read its stored token — never invent a new one.
 */
export async function resolveDevSessionToken(options: {
  envToken?: string;
  dataDir: string;
  reuseHealthyRuntime: boolean;
  readStoredToken?: (dir: string) => Promise<string | undefined>;
  createToken?: () => string;
}): Promise<string> {
  if (options.envToken) return options.envToken;
  if (options.reuseHealthyRuntime) {
    const readStored = options.readStoredToken ?? readStoredRuntimeToken;
    const stored = await readStored(options.dataDir);
    if (stored) return stored;
    throw new Error(
      `Runtime is healthy at the default endpoint but its session token was not found at ${path.join(options.dataDir, "runtime-token")}. Set SYMPHONEER_RUNTIME_TOKEN to reuse it.`,
    );
  }
  return (options.createToken ?? (() => randomBytes(24).toString("base64url")))();
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
  const reuseHealthyRuntime = canReuseRuntime && (await runtimeIsHealthy(runtimeUrl));
  const envToken = process.env.SYMPHONEER_RUNTIME_TOKEN;
  const sessionToken = await resolveDevSessionToken({
    ...(envToken ? { envToken } : {}),
    dataDir,
    reuseHealthyRuntime,
  });
  const sharedEnv = {
    SYMPHONEER_DATA_DIR: dataDir,
    SYMPHONEER_RUNTIME_HOST: runtimeHost,
    SYMPHONEER_RUNTIME_PORT: runtimePort,
    SYMPHONEER_RUNTIME_URL: runtimeUrl,
    SYMPHONEER_RUNTIME_TOKEN: sessionToken,
    VITE_RUNTIME_TOKEN: sessionToken,
    SYMPHONEER_WEB_HOST: webHost,
    SYMPHONEER_WEB_PORT: webPort,
  };
  if (reuseHealthyRuntime) {
    process.stdout.write(`Runtime already healthy; reusing ${runtimeUrl}\n`);
  } else {
    start("Runtime", ["run", "runtime:dev"], sharedEnv);
  }
  start("Web", ["run", "web:dev"], sharedEnv);
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Dev launcher failed"}\n`);
    process.exitCode = 1;
  });
}
