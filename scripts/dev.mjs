import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const runtimeHost = process.env.SYMPHONEER_RUNTIME_HOST ?? "127.0.0.1";
const runtimePort = process.env.SYMPHONEER_RUNTIME_PORT ?? "4318";
const webHost = process.env.SYMPHONEER_WEB_HOST ?? "127.0.0.1";
const webPort = process.env.SYMPHONEER_WEB_PORT ?? "3000";
const runtimeUrl = process.env.SYMPHONEER_RUNTIME_URL ?? `http://${runtimeHost}:${runtimePort}`;
const dataDir = process.env.SYMPHONEER_DATA_DIR ?? path.join(os.tmpdir(), "symphoneer-runtime");

const children = new Map();
let shuttingDown = false;
let exitCode = 0;

function start(name, args, env) {
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

function shutdown(code) {
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

function signalChild(child, signal) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") child.kill(signal);
  }
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

process.stdout.write(`Runtime: ${runtimeUrl}\nWeb: ${webHost}:${webPort}\nData: ${dataDir}\n`);
start("Runtime", ["runtime:serve"], {
  SYMPHONEER_DATA_DIR: dataDir,
  SYMPHONEER_RUNTIME_HOST: runtimeHost,
  SYMPHONEER_RUNTIME_PORT: runtimePort,
});
start("Web", ["--filter", "@symphoneer/web", "dev", "--hostname", webHost, "--port", webPort], {
  SYMPHONEER_RUNTIME_URL: runtimeUrl,
});
