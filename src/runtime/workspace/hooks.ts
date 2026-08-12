import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";

import { WorkspaceError } from "./error.ts";
import {
  type WorkspaceHook,
  type WorkspaceHookFailure,
  type WorkspaceHooks,
  workspaceHookNames,
} from "./types.ts";

export async function assertWorkspaceDirectory(path: string): Promise<void> {
  try {
    if ((await lstat(path)).isDirectory()) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  throw new WorkspaceError("workspace_not_directory", `Workspace path is not a directory: ${path}`);
}

export class WorkspaceHookRunner {
  readonly #hooks: WorkspaceHooks;
  readonly #timeoutMs: number;

  constructor(hooks: WorkspaceHooks = {}) {
    this.#hooks = hooks;
    this.#timeoutMs = hooks.timeoutMs ?? 60_000;
    if (!Number.isInteger(this.#timeoutMs) || this.#timeoutMs <= 0) {
      throw new WorkspaceError("hook_failed", "Hook timeout must be a positive integer");
    }
  }

  async runBestEffort(hook: WorkspaceHook, cwd: string): Promise<WorkspaceHookFailure[]> {
    try {
      await this.run(hook, cwd);
      return [];
    } catch (error) {
      return [{ hook: workspaceHookNames[hook], error: error as WorkspaceError }];
    }
  }

  async run(hook: WorkspaceHook, cwd: string): Promise<void> {
    const command = this.#hooks[hook];
    if (!command || typeof command !== "string") return;
    await assertWorkspaceDirectory(cwd);

    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn("/bin/sh", ["-lc", command], {
        cwd,
        detached: true,
        stdio: "ignore",
      });
      let timedOut = false;
      let settled = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        if (child.pid == null) return;
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, this.#timeoutMs);
      const finish = (error?: WorkspaceError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolvePromise();
      };
      child.once("error", (error) =>
        finish(
          new WorkspaceError("hook_failed", `${workspaceHookNames[hook]} hook could not start`, {
            cause: error,
          }),
        ),
      );
      child.once("close", (code) => {
        if (timedOut) {
          finish(
            new WorkspaceError(
              "hook_timed_out",
              `${workspaceHookNames[hook]} hook exceeded ${this.#timeoutMs}ms`,
            ),
          );
        } else if (code !== 0) {
          finish(
            new WorkspaceError(
              "hook_failed",
              `${workspaceHookNames[hook]} hook exited with code ${code}`,
            ),
          );
        } else {
          finish();
        }
      });
    });
  }
}
